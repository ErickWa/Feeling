// The account endpoints. functions/api/*.js are one-line routes into here, so
// tests/accounts.test.mjs can drive every flow against real SQL (node:sqlite
// standing in for D1) without a server.
//
// Environment (wrangler.toml and Pages secrets):
//   DB             D1 binding
//   ACCOUNTS_OPEN  "true" to serve; anything else answers 503 (go-live is #28)
//   VAULT_KID      the kid in site/vault-key.json; seals for another key are refused
//   HMAC_KEY       secret: keys the email and IP fingerprints
//   FORM1_VERSION  the panel agreement version recorded with each consent
//   MAIL_TOKEN     secret: Cloudflare API token with Email Sending permission
//   ACCOUNT_ID, MAIL_FROM
//   SITE_ORIGIN    https://feelingthemachine.com: the only host /api answers on, and
//                  the host every emailed link names
//   MAIL_MODE      "console" in .dev.vars only: print links instead of sending
//
// WHAT THIS CANNOT SEE: Cloudflare's own request logs, which hold IPs; and
// whether a seal holds the address it claims. A participant could seal a
// different address from the one they typed; the link still goes to the typed
// one, and the vault export (#27) is where the two get compared.

import { FORM, digestMessage, formatId, hmacHex, langOf, linkMessage, normalizeEmail, randomToken, rateEmail, rateIp, sealedFor, sha256Hex, validateChoices, validateJoin } from "./accounts.js";

const TOKEN_TTL = 30 * 60 * 1000;
const SESSION_TTL = 24 * 60 * 60 * 1000;
const PER_ADDRESS_PER_HOUR = 3;
const PER_IP_PER_HOUR = 10;
// Every address together. A panel of tens of people never comes near it; a
// script rotating addresses does, and is then refused before it can spend the
// domain's sending reputation. It fails closed: past it, nobody gets mail for
// the rest of the hour.
const ALL_PER_HOUR = 60;
const COOKIE = "__Host-ftm";

const now = () => Date.now();

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
  });
}

const isLocal = (request) => ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname);
const bare = (host) => host.replace(/^www\./, "");

/**
 * The origin links are built on: SITE_ORIGIN, except on localhost. Never the
 * request's own host, or a request through feeling.pages.dev or a preview
 * alias would mail out links to that host, teaching people to trust a domain
 * that is not the project's (security review, 2026-11-24).
 */
const siteOrigin = (request, env) => (isLocal(request) ? new URL(request.url).origin : env.SITE_ORIGIN);

/** Every /api request passes here first (functions/api/_middleware.js). */
export async function gate(request, env, next) {
  if (env.ACCOUNTS_OPEN !== "true") return json(503, { error: "not_open" });
  if (env.MAIL_MODE === "console" && !isLocal(request)) return json(500, { error: "misconfigured" });
  if (!env.VAULT_KID || !env.HMAC_KEY || !env.SITE_ORIGIN) return json(503, { error: "not_configured" });
  // pages.dev and preview hosts share this D1 binding, so /api answers on the
  // project's own domain (with or without www) and nowhere else.
  if (!isLocal(request) && bare(new URL(request.url).hostname) !== bare(new URL(env.SITE_ORIGIN).hostname)) {
    return json(404, { error: "host" });
  }
  try {
    return await next();
  } catch {
    // Never log the error: it may carry a request body.
    return json(500, { error: "server" });
  }
}

/** JSON from this origin only. A cross-site page cannot send this without a CORS preflight we never answer. */
async function readJson(request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) return json(403, { error: "origin" });
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json(415, { error: "json" });
  const text = await request.text();
  if (text.length > 8000) return json(413, { error: "too_large" });
  try {
    return JSON.parse(text);
  } catch {
    return json(400, { error: "json" });
  }
}

async function overLimit(env, key, limit) {
  const win = Math.floor(now() / 3600000);
  const row = await env.DB.prepare(
    "INSERT INTO rate (key, win, n) VALUES (?1, ?2, 1) ON CONFLICT (key, win) DO UPDATE SET n = n + 1 RETURNING n",
  ).bind(key, win).first();
  return row.n > limit;
}

async function sweep(env) {
  const t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tokens WHERE expires_at < ?1").bind(t),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(t),
    env.DB.prepare("DELETE FROM rate WHERE win < ?1").bind(Math.floor(t / 3600000) - 1),
  ]);
}

async function sendMail(env, message) {
  if (typeof env.MAIL_SENDER === "function") return env.MAIL_SENDER(message); // tests only
  if (env.MAIL_MODE === "console") {
    console.log(`[dev mail] ${message.subject}\n${message.text}`);
    return;
  }
  if (!env.MAIL_TOKEN || !env.MAIL_FROM || !env.ACCOUNT_ID) throw new Error("mail is not configured");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/email/sending/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.MAIL_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ to: message.to, from: env.MAIL_FROM, subject: message.subject, text: message.text }),
  });
  // Status only: the response body may echo the address.
  if (!res.ok) throw new Error(`mail send failed: ${res.status}`);
}

async function session(env, participantId) {
  const token = randomToken();
  const stmt = env.DB.prepare("INSERT INTO sessions (hash, participant_id, expires_at) VALUES (?1, ?2, ?3)")
    .bind(await sha256Hex(token), participantId, now() + SESSION_TTL);
  const cookie = `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`;
  return { stmt, cookie };
}

async function takeToken(env, token, purpose) {
  if (typeof token !== "string" || token.length > 100) return null;
  // Found and spent in one statement, so two requests racing on one link
  // cannot both succeed (security review, 2026-11-24).
  return env.DB.prepare("DELETE FROM tokens WHERE hash = ?1 AND purpose = ?2 AND expires_at >= ?3 RETURNING *")
    .bind(await sha256Hex(token), purpose, now()).first();
}

/**
 * POST /api/start { email, sealedEmail, lang }
 * Emails a sign-in link if the address has an account, a join link if not.
 * The answer is the same either way, so it reveals nothing about who is registered.
 */
export async function start(request, env) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const email = normalizeEmail(body.email);
  const lang = langOf(body.lang);
  if (!email || !sealedFor(body.sealedEmail, env.VAULT_KID)) return json(400, { error: "invalid" });

  const emailHmac = await hmacHex(env.HMAC_KEY, email);
  const ipHmac = await hmacHex(env.HMAC_KEY, `ip:${rateIp(request.headers.get("cf-connecting-ip"))}`);
  // The IP first and the shared cap last, each counted only once the one
  // before it has passed: a request refused for its IP never spends the
  // address's quota, which one IP could otherwise use to lock a chosen
  // participant out of signing in (security review, 2026-11-24).
  if (
    (await overLimit(env, `ip:${ipHmac}`, PER_IP_PER_HOUR)) ||
    (await overLimit(env, `em:${await hmacHex(env.HMAC_KEY, rateEmail(email))}`, PER_ADDRESS_PER_HOUR)) ||
    (await overLimit(env, "all", ALL_PER_HOUR))
  ) {
    return json(429, { error: "slow_down" });
  }
  await sweep(env);

  const known = await env.DB.prepare("SELECT id FROM participants WHERE email_hmac = ?1").bind(emailHmac).first();
  const purpose = known ? "signin" : "join";
  const token = randomToken();
  await env.DB.prepare("INSERT INTO tokens (hash, purpose, email_hmac, sealed_email, lang, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(await sha256Hex(token), purpose, emailHmac, known ? null : body.sealedEmail, lang, now() + TOKEN_TTL).run();

  // The token rides in the fragment, which browsers never send to a server or in a Referer.
  const url = `${siteOrigin(request, env)}/account#${purpose}=${token}`;
  await sendMail(env, { to: email, ...linkMessage(purpose, lang, url) });
  return json(202, { ok: true });
}

/** POST /api/join { token, sealedName, role, ageBand, country, panel, readAgreement, crossBorder?, oralHistory?, futureStudies?, updates?, lang } */
export async function join(request, env) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  // Checked before the link is spent, so a form the browser let through with a
  // mistake does not cost the participant their link.
  const checked = validateJoin(body, env.VAULT_KID);
  if (checked.error) return json(400, { error: checked.error });
  const v = checked.value;
  const pending = await takeToken(env, body.token, "join");
  if (!pending) return json(410, { error: "link_expired" });

  // Joined meanwhile, from another link: this one is spent; say so.
  if (await env.DB.prepare("SELECT 1 FROM participants WHERE email_hmac = ?1").bind(pending.email_hmac).first()) {
    return json(409, { error: "already_joined" });
  }

  const { n } = await env.DB.prepare("UPDATE meta SET value = value + 1 WHERE key = 'next_participant' RETURNING value - 1 AS n").first();
  const id = formatId(n);
  const at = new Date(now()).toISOString();
  const s = await session(env, id);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO participants (id, email_hmac, sealed_email, sealed_name, lang, country, role, age_band, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
      .bind(id, pending.email_hmac, pending.sealed_email, v.sealedName, v.lang, v.country, v.role, v.ageBand, at),
    env.DB.prepare("INSERT INTO consents (participant_id, form, form_version, lang, panel, oral_history, future_studies, updates, cross_border, at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, ?9)")
      .bind(id, FORM, env.FORM1_VERSION ?? "unversioned", v.lang, v.oralHistory, v.futureStudies, v.updates, v.crossBorder, at),
    s.stmt,
  ]);
  return json(201, { id }, { "set-cookie": s.cookie });
}

/** POST /api/signin { token } */
export async function signin(request, env) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const pending = await takeToken(env, body.token, "signin");
  if (!pending) return json(410, { error: "link_expired" });
  const p = await env.DB.prepare("SELECT id FROM participants WHERE email_hmac = ?1").bind(pending.email_hmac).first();
  if (!p) return json(410, { error: "link_expired" });
  const s = await session(env, p.id);
  await s.stmt.run();
  return json(200, { id: p.id }, { "set-cookie": s.cookie });
}

async function signedIn(request, env) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,100})`).exec(request.headers.get("cookie") ?? "");
  if (!m) return null;
  const row = await env.DB.prepare("SELECT participant_id FROM sessions WHERE hash = ?1 AND expires_at >= ?2")
    .bind(await sha256Hex(m[1]), now()).first();
  return row ? { id: row.participant_id, hash: await sha256Hex(m[1]) } : null;
}

/**
 * GET /api/me: EVERYTHING the site holds about the signed-in participant, sealed
 * values and fingerprint included, because "download all of it" must mean all
 * of it. Sessions are left out: they are the site's, not the participant's.
 */
export async function me(request, env) {
  const who = await signedIn(request, env);
  if (!who) return json(401, { error: "signed_out" });
  const participant = await env.DB.prepare("SELECT * FROM participants WHERE id = ?1").bind(who.id).first();
  const consents = (await env.DB.prepare("SELECT * FROM consents WHERE participant_id = ?1 ORDER BY id").bind(who.id).all()).results;
  const requests = (await env.DB.prepare("SELECT * FROM requests WHERE participant_id = ?1 ORDER BY id").bind(who.id).all()).results;
  return json(200, { participant, consents, requests });
}

/** POST /api/choices { panel, oralHistory, futureStudies, updates, agree?, crossBorder?, lang } */
export async function choices(request, env) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const who = await signedIn(request, env);
  if (!who) return json(401, { error: "signed_out" });
  const p = await env.DB.prepare("SELECT country FROM participants WHERE id = ?1").bind(who.id).first();
  const latest = await env.DB.prepare("SELECT * FROM consents WHERE participant_id = ?1 ORDER BY id DESC LIMIT 1").bind(who.id).first();
  const checked = validateChoices(body, latest, p?.country, env.FORM1_VERSION);
  if (checked.error) return json(400, { error: checked.error });
  const { row, request: kind } = checked.value;
  const at = new Date(now()).toISOString();
  const stmts = [
    env.DB.prepare("INSERT INTO consents (participant_id, form, form_version, lang, panel, oral_history, future_studies, updates, cross_border, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
      .bind(who.id, FORM, row.form_version, row.lang, row.panel, row.oral_history, row.future_studies, row.updates, row.cross_border, at),
  ];
  if (kind) stmts.push(env.DB.prepare("INSERT INTO requests (participant_id, kind, at) VALUES (?1, ?2, ?3)").bind(who.id, kind, at));
  await env.DB.batch(stmts);
  return json(200, { ok: true, request: kind });
}

/**
 * POST /api/delete { confirm: "delete" }
 * Removes every row about the participant at once, leaving one request row
 * (number, "delete", date) for the vault to act on. Their address can join
 * again afterwards, as somebody new.
 */
export async function remove(request, env) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const who = await signedIn(request, env);
  if (!who) return json(401, { error: "signed_out" });
  if (body.confirm !== "delete") return json(400, { error: "confirm" });
  const p = await env.DB.prepare("SELECT email_hmac FROM participants WHERE id = ?1").bind(who.id).first();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO requests (participant_id, kind, at) VALUES (?1, 'delete', ?2)").bind(who.id, new Date(now()).toISOString()),
    env.DB.prepare("DELETE FROM sessions WHERE participant_id = ?1").bind(who.id),
    env.DB.prepare("DELETE FROM tokens WHERE email_hmac = ?1").bind(p?.email_hmac ?? ""),
    env.DB.prepare("DELETE FROM rate WHERE key = ?1").bind(`em:${p?.email_hmac ?? ""}`),
    env.DB.prepare("DELETE FROM consents WHERE participant_id = ?1").bind(who.id),
    env.DB.prepare("DELETE FROM participants WHERE id = ?1").bind(who.id),
  ]);
  return json(200, { ok: true }, { "set-cookie": `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0` });
}

/** POST /api/signout */
export async function signout(request, env) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const who = await signedIn(request, env);
  if (who) await env.DB.prepare("DELETE FROM sessions WHERE hash = ?1").bind(who.hash).run();
  return json(200, { ok: true }, { "set-cookie": `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0` });
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * POST /api/digest, called once a day by the cron Worker in cron/. Mails the
 * project's own hello@ how many joined, left, came back and deleted since the
 * last summary, with the totals, and nothing about who; a day with none of
 * those sends nothing. Joins come from the participant-number counter (a
 * delete does not lower it), the rest from `requests`.
 *
 * Anyone may call it, and that is safe: it answers 204 whatever happened,
 * sends at most once per UTC day, and only to this domain's hello@. A
 * stranger learns nothing and can cause, at most, one summary a little early.
 *
 * WHAT THIS CANNOT SEE: whether the cron Worker is still deployed and firing.
 * A silent inbox means a quiet day or a dead trigger, and nothing here tells
 * the two apart.
 */
export async function digest(request, env) {
  const done = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  if (request.method !== "POST") return done();
  const meta = async (key) => (await env.DB.prepare("SELECT value FROM meta WHERE key = ?1").bind(key).first())?.value;
  const t = now();
  const last = await meta("digest_at");
  if (last === undefined) {
    // First call: start counting from here, rather than reporting history.
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('digest_at', ?1)").bind(t),
      env.DB.prepare("INSERT OR IGNORE INTO meta (key, value) SELECT 'digest_next', value FROM meta WHERE key = 'next_participant'"),
    ]);
    return done();
  }
  if (last >= t - (t % DAY)) return done();
  // Claim the run, so two calls racing past midnight cannot both send.
  if (!(await env.DB.prepare("UPDATE meta SET value = ?1 WHERE key = 'digest_at' AND value = ?2 RETURNING value").bind(t, last).first())) return done();
  const next = await meta("next_participant");
  const kinds = Object.fromEntries((await env.DB.prepare("SELECT kind, count(*) AS n FROM requests WHERE at >= ?1 AND at < ?2 GROUP BY kind")
    .bind(new Date(last).toISOString(), new Date(t).toISOString()).all()).results.map((r) => [r.kind, r.n]));
  const count = async (sql) => (await env.DB.prepare(sql).first()).n;
  const message = digestMessage({
    joined: next - (await meta("digest_next")), left: kinds.leave ?? 0, rejoined: kinds.rejoin ?? 0, deleted: kinds.delete ?? 0,
    issued: next - 1,
    accounts: await count("SELECT count(*) AS n FROM participants"),
    onPanel: await count("SELECT count(*) AS n FROM consents c WHERE panel = 1 AND id = (SELECT max(id) FROM consents WHERE participant_id = c.participant_id)"),
    since: new Date(last),
  });
  if (message) {
    try {
      await sendMail(env, { to: `hello@${new URL(env.SITE_ORIGIN).hostname}`, ...message });
    } catch {
      // Give the window back, so tomorrow's summary covers these days too.
      await env.DB.prepare("UPDATE meta SET value = ?1 WHERE key = 'digest_at'").bind(last).run();
      return done();
    }
  }
  await env.DB.prepare("UPDATE meta SET value = ?1 WHERE key = 'digest_next'").bind(next).run();
  return done();
}
