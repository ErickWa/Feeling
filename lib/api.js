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
//   MAIL_MODE      "console" in .dev.vars only: print links instead of sending
//
// WHAT THIS CANNOT SEE: Cloudflare's own request logs, which hold IPs; and
// whether a seal holds the address it claims. A participant could seal a
// different address from the one they typed; the link still goes to the typed
// one, and the vault export (#27) is where the two get compared.

import { FORM, formatId, hmacHex, linkMessage, normalizeEmail, randomToken, sealedFor, sha256Hex, validateJoin } from "./accounts.js";

const TOKEN_TTL = 30 * 60 * 1000;
const SESSION_TTL = 24 * 60 * 60 * 1000;
const PER_ADDRESS_PER_HOUR = 3;
const PER_IP_PER_HOUR = 10;
const COOKIE = "__Host-ftm";

const now = () => Date.now();

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
  });
}

const isLocal = (request) => ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname);

/** Every /api request passes here first (functions/api/_middleware.js). */
export async function gate(request, env, next) {
  if (env.ACCOUNTS_OPEN !== "true") return json(503, { error: "not_open" });
  if (env.MAIL_MODE === "console" && !isLocal(request)) return json(500, { error: "misconfigured" });
  if (!env.VAULT_KID || !env.HMAC_KEY) return json(503, { error: "not_configured" });
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
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT * FROM tokens WHERE hash = ?1 AND purpose = ?2 AND expires_at >= ?3")
    .bind(hash, purpose, now()).first();
  return row ? { ...row, hash } : null;
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
  const lang = body.lang === "zh" ? "zh" : "en";
  if (!email || !sealedFor(body.sealedEmail, env.VAULT_KID)) return json(400, { error: "invalid" });

  const emailHmac = await hmacHex(env.HMAC_KEY, email);
  const ipHmac = await hmacHex(env.HMAC_KEY, `ip:${request.headers.get("cf-connecting-ip") ?? "local"}`);
  if ((await overLimit(env, `em:${emailHmac}`, PER_ADDRESS_PER_HOUR)) || (await overLimit(env, `ip:${ipHmac}`, PER_IP_PER_HOUR))) {
    return json(429, { error: "slow_down" });
  }
  await sweep(env);

  const known = await env.DB.prepare("SELECT id FROM participants WHERE email_hmac = ?1").bind(emailHmac).first();
  const purpose = known ? "signin" : "join";
  const token = randomToken();
  await env.DB.prepare("INSERT INTO tokens (hash, purpose, email_hmac, sealed_email, lang, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(await sha256Hex(token), purpose, emailHmac, known ? null : body.sealedEmail, lang, now() + TOKEN_TTL).run();

  // The token rides in the fragment, which browsers never send to a server or in a Referer.
  const url = `${new URL(request.url).origin}/account#${purpose}=${token}`;
  await sendMail(env, { to: email, ...linkMessage(purpose, lang, url) });
  return json(202, { ok: true });
}

/** POST /api/join { token, sealedName, role, ageBand, country, panel, readAgreement, crossBorder?, oralHistory?, futureStudies?, updates?, lang } */
export async function join(request, env) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const pending = await takeToken(env, body.token, "join");
  if (!pending) return json(410, { error: "link_expired" });
  const checked = validateJoin(body, env.VAULT_KID);
  if (checked.error) return json(400, { error: checked.error });
  const v = checked.value;

  // Joined meanwhile, from another link: use up this one and say so.
  if (await env.DB.prepare("SELECT 1 FROM participants WHERE email_hmac = ?1").bind(pending.email_hmac).first()) {
    await env.DB.prepare("DELETE FROM tokens WHERE hash = ?1").bind(pending.hash).run();
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
    env.DB.prepare("DELETE FROM tokens WHERE hash = ?1").bind(pending.hash),
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
  await env.DB.prepare("DELETE FROM tokens WHERE hash = ?1").bind(pending.hash).run();
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

/** GET /api/me: the participant's own record, as the site holds it. #26 builds the page on this. */
export async function me(request, env) {
  const who = await signedIn(request, env);
  if (!who) return json(401, { error: "signed_out" });
  const p = await env.DB.prepare("SELECT id, lang, country, role, age_band, created_at, sealed_name IS NOT NULL AS name_on_site, sealed_email IS NOT NULL AS email_on_site FROM participants WHERE id = ?1").bind(who.id).first();
  const { results } = await env.DB.prepare("SELECT form, form_version, lang, panel, oral_history, future_studies, updates, cross_border, at FROM consents WHERE participant_id = ?1 ORDER BY id").bind(who.id).all();
  return json(200, { participant: p, consents: results });
}

/** POST /api/signout */
export async function signout(request, env) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const who = await signedIn(request, env);
  if (who) await env.DB.prepare("DELETE FROM sessions WHERE hash = ?1").bind(who.hash).run();
  return json(200, { ok: true }, { "set-cookie": `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0` });
}
