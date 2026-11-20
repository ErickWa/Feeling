// Every account flow, through lib/api.js, against the real schema
// (migrations/) in node:sqlite standing in for D1.
//
// WHAT THIS CANNOT SEE: D1 itself (the adapter below implements only the
// calls lib/api.js makes, and a transaction where D1 batches), Pages Functions
// routing (functions/api/ is one-line wiring), Cloudflare's Email Sending API
// (mail is captured, not sent), and the browser page. A local `wrangler pages
// dev` run covers the first two; the third waits on the sending domain.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { normalizeEmail, sealedFor, validateJoin } from "../lib/accounts.js";
import { choices, gate, join, me, remove, signin, signout, start } from "../lib/api.js";
import { generateVaultKey, importPublicKey, open, seal, vaultKeys } from "../site/seal.js";

const ORIGIN = "https://feelingthemachine.com";
const schema = readdirSync(new URL("../migrations/", import.meta.url)).sort()
  .map((f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8")).join("\n");

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => (db.prepare(sql).run(...args), { success: true }),
    exec: () => db.prepare(sql).run(...args),
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => {
      db.exec("BEGIN");
      try { for (const s of stmts) s.exec(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
      return [];
    },
  };
}

async function world() {
  const k = await generateVaultKey();
  const outbox = [];
  const env = {
    DB: fakeD1(), ACCOUNTS_OPEN: "true", VAULT_KID: k.kid, HMAC_KEY: "test-hmac-key", FORM1_VERSION: "1.0-test",
    MAIL_SENDER: (m) => outbox.push(m),
  };
  return { env, outbox, pub: await importPublicKey(k.publicJwk), keys: await vaultKeys([k.privateJwk]) };
}

const call = (env, handler, path, body, headers = {}) => {
  const req = new Request(`${ORIGIN}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return gate(req, env, () => handler(req, env));
};

const linkToken = (mail, purpose) => new RegExp(`/account#${purpose}=([A-Za-z0-9_-]+)`).exec(mail.text)?.[1];
const cookieOf = (res) => /__Host-ftm=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];

async function joinOne(w, email, extra = {}) {
  const r1 = await call(w.env, start, "/api/start", { email, sealedEmail: await seal(w.pub, "email", email.trim().toLowerCase()), lang: "en" });
  assert.equal(r1.status, 202);
  const token = linkToken(w.outbox.at(-1), "join");
  assert.ok(token, "a join link was mailed");
  return call(w.env, join, "/api/join", {
    token, sealedName: await seal(w.pub, "name", "Ada Lovelace"), role: "research", ageBand: "30-39", country: "US",
    panel: true, readAgreement: true, oralHistory: true, lang: "en", ...extra,
  });
}

test("normalizeEmail and sealedFor", () => {
  assert.equal(normalizeEmail("  Ada@Example.COM "), "ada@example.com");
  for (const bad of ["", "ada", "ada@", "@x.com", "a b@x.com", "ada@x", `${"a".repeat(250)}@x.com`]) assert.equal(normalizeEmail(bad), null, bad);
  assert.equal(sealedFor("v1.0123456789abcdef.x.y.z", "0123456789abcdef"), false);
});

test("validateJoin requires the agreement, and cross-border consent in mainland China", () => {
  const kid = "0123456789abcdef";
  const sealedName = `v1.${kid}.${"A".repeat(87)}.${"B".repeat(16)}.${"C".repeat(30)}`;
  const ok = { sealedName, role: "research", ageBand: "18-29", country: "US", panel: true, readAgreement: true };
  assert.ok(validateJoin(ok, kid).value);
  assert.equal(validateJoin({ ...ok, panel: false }, kid).error, "consent");
  assert.equal(validateJoin({ ...ok, readAgreement: "yes" }, kid).error, "consent");
  assert.equal(validateJoin({ ...ok, country: "CN" }, kid).error, "cross_border");
  assert.equal(validateJoin({ ...ok, country: "CN", crossBorder: true }, kid).value.crossBorder, 1);
  assert.equal(validateJoin({ ...ok, country: "US", crossBorder: true }, kid).value.crossBorder, null);
  assert.equal(validateJoin({ ...ok, ageBand: "13-17" }, kid).error, "age");
  assert.equal(validateJoin({ ...ok, sealedName: sealedName.replace(kid, "f".repeat(16)) }, kid).error, "name");
});

test("joining: a link by email, then the form, gives P001 and a session", async () => {
  const w = await world();
  const res = await joinOne(w, "Ada@Example.com");
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { id: "P001" });
  const cookie = cookieOf(res);
  assert.ok(cookie);
  assert.match(res.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);

  const mine = await (await call(w.env, me, "/api/me", undefined, { cookie: `__Host-ftm=${cookie}` })).json();
  assert.equal(mine.participant.id, "P001");
  assert.equal(mine.consents.length, 1);
  assert.equal(mine.consents[0].oral_history, 1);
  assert.equal(mine.consents[0].form_version, "1.0-test");
  assert.equal((await joinOne(w, "grace@example.com")).status, 201, "a second person");
  assert.deepEqual(w.env.DB.raw.prepare("SELECT id FROM participants ORDER BY id").all().map((r) => r.id), ["P001", "P002"]);
});

test("THE PROMISE: no readable email or name anywhere in the database, and the vault can read both", async () => {
  const w = await world();
  await joinOne(w, "ada.lovelace@example.com");
  await call(w.env, start, "/api/start", { email: "grace@example.com", sealedEmail: await seal(w.pub, "email", "grace@example.com") });
  const db = w.env.DB.raw;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  const everything = JSON.stringify(tables.map((t) => db.prepare(`SELECT * FROM ${t}`).all()));
  for (const secret of ["ada.lovelace", "example.com", "Ada Lovelace", "Lovelace", "grace"]) {
    assert.ok(!everything.includes(secret), `"${secret}" is readable in the database`);
  }
  const p = db.prepare("SELECT sealed_name, sealed_email FROM participants").get();
  assert.equal(await open(w.keys, "name", p.sealed_name), "Ada Lovelace");
  assert.equal(await open(w.keys, "email", p.sealed_email), "ada.lovelace@example.com");
});

test("a registered address gets a sign-in link, and the answer looks the same", async () => {
  const w = await world();
  await joinOne(w, "ada@example.com");
  const again = await call(w.env, start, "/api/start", { email: "ADA@example.com", sealedEmail: await seal(w.pub, "email", "ada@example.com") });
  assert.equal(again.status, 202);
  assert.deepEqual(await again.json(), { ok: true });
  const token = linkToken(w.outbox.at(-1), "signin");
  assert.ok(token);
  const res = await call(w.env, signin, "/api/signin", { token });
  assert.deepEqual(await res.json(), { id: "P001" });
  assert.equal((await call(w.env, signin, "/api/signin", { token })).status, 410, "a link works once");
});

test("links are single-use, purpose-bound and expire", async () => {
  const w = await world();
  await call(w.env, start, "/api/start", { email: "ada@example.com", sealedEmail: await seal(w.pub, "email", "ada@example.com") });
  const token = linkToken(w.outbox.at(-1), "join");
  assert.equal((await call(w.env, signin, "/api/signin", { token })).status, 410, "a join link cannot sign in");
  w.env.DB.raw.exec("UPDATE tokens SET expires_at = 0");
  const form = { token, sealedName: await seal(w.pub, "name", "Ada"), role: "research", ageBand: "30-39", country: "US", panel: true, readAgreement: true };
  assert.equal((await call(w.env, join, "/api/join", form)).status, 410);
});

test("mainland China cannot join without cross-border consent", async () => {
  const w = await world();
  assert.equal((await joinOne(w, "li@example.cn", { country: "CN" })).status, 400);
  const w2 = await world();
  const ok = await joinOne(w2, "li@example.cn", { country: "CN", crossBorder: true });
  assert.equal(ok.status, 201);
  assert.equal(w2.env.DB.raw.prepare("SELECT cross_border FROM consents").get().cross_border, 1);
});

test("a seal for another vault key is refused", async () => {
  const w = await world();
  const other = await importPublicKey((await generateVaultKey()).publicJwk);
  const res = await call(w.env, start, "/api/start", { email: "ada@example.com", sealedEmail: await seal(other, "email", "ada@example.com") });
  assert.equal(res.status, 400);
  assert.equal(w.outbox.length, 0);
});

test("rate limits: three links per address and ten per IP an hour", async () => {
  const w = await world();
  const send = async (email, ip) => (await call(w.env, start, "/api/start", { email, sealedEmail: await seal(w.pub, "email", email) }, { "cf-connecting-ip": ip })).status;
  for (let i = 0; i < 3; i++) assert.equal(await send("ada@example.com", `198.51.100.${i}`), 202);
  assert.equal(await send("ada@example.com", "198.51.100.99"), 429);
  for (let i = 0; i < 10; i++) await send(`p${i}@example.com`, "192.0.2.1");
  assert.equal(await send("new@example.com", "192.0.2.1"), 429);
  const keys = w.env.DB.raw.prepare("SELECT key FROM rate").all().map((r) => r.key).join(" ");
  assert.doesNotMatch(keys, /192\.0\.2|198\.51|example/, "rate keys hold no IP or address");
});

test("only same-origin JSON is accepted", async () => {
  const w = await world();
  const body = { email: "ada@example.com", sealedEmail: await seal(w.pub, "email", "ada@example.com") };
  assert.equal((await call(w.env, start, "/api/start", body, { origin: "https://evil.example" })).status, 403);
  assert.equal((await call(w.env, start, "/api/start", body, { "content-type": "text/plain" })).status, 415);
});

test("closed until go-live, and console mail only on localhost", async () => {
  const w = await world();
  const body = { email: "ada@example.com", sealedEmail: await seal(w.pub, "email", "ada@example.com") };
  assert.equal((await call({ ...w.env, ACCOUNTS_OPEN: "false" }, start, "/api/start", body)).status, 503);
  assert.equal((await call({ ...w.env, VAULT_KID: "" }, start, "/api/start", body)).status, 503);
  assert.equal((await call({ ...w.env, MAIL_MODE: "console", MAIL_SENDER: undefined }, start, "/api/start", body)).status, 500);
});

test("signing out ends the session", async () => {
  const w = await world();
  const cookie = `__Host-ftm=${cookieOf(await joinOne(w, "ada@example.com"))}`;
  assert.equal((await call(w.env, me, "/api/me", undefined, { cookie })).status, 200);
  await call(w.env, signout, "/api/signout", {}, { cookie });
  assert.equal((await call(w.env, me, "/api/me", undefined, { cookie })).status, 401);
});

test("a failure answers 500 without echoing the request", async () => {
  const w = await world();
  const res = await call({ ...w.env, MAIL_SENDER: () => { throw new Error("ada@example.com bounced"); } }, start, "/api/start",
    { email: "ada@example.com", sealedEmail: await seal(w.pub, "email", "ada@example.com") });
  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /ada/);
});

// ---- #26: the participant's own page ----

async function signedUp(w, email = "ada@example.com", extra = {}) {
  const res = await joinOne(w, email, extra);
  return { id: (await res.json()).id, cookie: `__Host-ftm=${cookieOf(res)}` };
}
const mine = async (w, cookie) => (await call(w.env, me, "/api/me", undefined, { cookie })).json();

test("me returns everything the site holds, sealed values included", async () => {
  const w = await world();
  const { cookie } = await signedUp(w);
  const r = await mine(w, cookie);
  assert.match(r.participant.sealed_name, /^v1\./);
  assert.match(r.participant.sealed_email, /^v1\./);
  assert.match(r.participant.email_hmac, /^[0-9a-f]{64}$/);
  assert.deepEqual(r.requests, []);
});

test("changing choices adds a consent row and never edits one", async () => {
  const w = await world();
  const { cookie } = await signedUp(w);
  const res = await call(w.env, choices, "/api/choices", { panel: true, oralHistory: false, futureStudies: true, updates: true }, { cookie });
  assert.equal(res.status, 200);
  const r = await mine(w, cookie);
  assert.equal(r.consents.length, 2);
  assert.deepEqual([r.consents[0].oral_history, r.consents[1].oral_history, r.consents[1].future_studies], [1, 0, 1]);
  assert.equal(r.consents[1].form_version, r.consents[0].form_version, "same agreement, so same version");
  assert.deepEqual(r.requests, [], "a change of interests is not a request for the vault");
});

test("leaving zeroes everything and logs a request; rejoining needs consent again", async () => {
  const w = await world();
  const { cookie } = await signedUp(w);
  await call(w.env, choices, "/api/choices", { panel: false, oralHistory: true }, { cookie });
  let r = await mine(w, cookie);
  assert.deepEqual([r.consents.at(-1).panel, r.consents.at(-1).oral_history], [0, 0]);
  assert.equal(r.requests[0].kind, "leave");
  assert.equal((await call(w.env, choices, "/api/choices", { panel: true }, { cookie })).status, 400, "rejoin without agreeing");
  w.env.FORM1_VERSION = "1.1";
  assert.equal((await call(w.env, choices, "/api/choices", { panel: true, agree: true, updates: true }, { cookie })).status, 200);
  r = await mine(w, cookie);
  assert.equal(r.consents.at(-1).panel, 1);
  assert.equal(r.consents.at(-1).form_version, "1.1", "a rejoin agrees to the current version");
  assert.deepEqual(r.requests.map((q) => q.kind), ["leave", "rejoin"]);
});

test("rejoining from mainland China needs the cross-border consent again", async () => {
  const w = await world();
  const { cookie } = await signedUp(w, "li@example.cn", { country: "CN", crossBorder: true });
  await call(w.env, choices, "/api/choices", { panel: false }, { cookie });
  assert.equal((await call(w.env, choices, "/api/choices", { panel: true, agree: true }, { cookie })).status, 400);
  assert.equal((await call(w.env, choices, "/api/choices", { panel: true, agree: true, crossBorder: true }, { cookie })).status, 200);
});

test("deleting removes every row about the person but the request, and the address can join anew", async () => {
  const w = await world();
  const { id, cookie } = await signedUp(w);
  await signedUp(w, "grace@example.com");
  assert.equal((await call(w.env, remove, "/api/delete", {}, { cookie })).status, 400, "needs confirm");
  const res = await call(w.env, remove, "/api/delete", { confirm: "delete" }, { cookie });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await call(w.env, me, "/api/me", undefined, { cookie })).status, 401);
  const db = w.env.DB.raw;
  for (const t of ["participants", "consents", "sessions"]) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${t} WHERE ${t === "participants" ? "id" : "participant_id"} = ?`).get(id).n, 0, t);
  }
  assert.deepEqual(db.prepare("SELECT participant_id, kind FROM requests").all().map((r) => ({ ...r })), [{ participant_id: id, kind: "delete" }]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM participants").get().n, 1, "the other participant is untouched");
  const again = await joinOne(w, "ada@example.com");
  assert.deepEqual(await again.json(), { id: "P003" }, "a new person with a new number");
});

test("the page's actions need a session", async () => {
  const w = await world();
  assert.equal((await call(w.env, choices, "/api/choices", { panel: true })).status, 401);
  assert.equal((await call(w.env, remove, "/api/delete", { confirm: "delete" })).status, 401);
});
