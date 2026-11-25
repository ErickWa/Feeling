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
import { digestMessage, langOf, linkMessage, normalizeEmail, rateEmail, rateIp, sealedFor, validateJoin } from "../lib/accounts.js";
import { choices, digest, gate, join, me, remove, signin, signout, start } from "../lib/api.js";
import { generateVaultKey, importPublicKey, open, seal } from "../site/seal.js";
import { call, cookieOf, joinOne, linkToken, world } from "./helpers/world.mjs";

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

// The four tests below are the security review of 2026-11-24, one per finding.
test("rateEmail and rateIp: one quota per inbox and per IPv6 /64", () => {
  assert.equal(rateEmail("ada@example.com"), "ada@example.com", "an ordinary address is unchanged");
  assert.equal(rateEmail("ada+ftm@example.com"), "ada@example.com");
  assert.equal(rateEmail("a.d.a+x@googlemail.com"), "ada@gmail.com");
  assert.equal(rateEmail("a.da@example.com"), "a.da@example.com", "dots matter outside Gmail");
  assert.equal(rateIp("203.0.113.9"), "203.0.113.9");
  assert.equal(rateIp("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(rateIp("2001:db8:1:2:aaaa::1"), "2001:db8:1:2::/64");
  assert.equal(rateIp("2001:DB8:1:2:bbbb:cccc:dddd:eeee"), "2001:db8:1:2::/64");
  assert.equal(rateIp("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(rateIp(null), "local");
});

// Gmail addresses here have local parts under six characters, which Gmail
// never issues, so none of them can be anyone's inbox.
test("rate limits cannot be dodged with plus-tags, Gmail dots or fresh IPv6 addresses", async () => {
  const w = await world();
  const send = async (email, ip) => (await call(w.env, start, "/api/start", { email, sealedEmail: await seal(w.pub, "email", email) }, { "cf-connecting-ip": ip })).status;
  for (const [i, e] of ["ab@gmail.com", "a.b@gmail.com", "ab+1@gmail.com"].entries()) assert.equal(await send(e, `198.51.100.${i}`), 202);
  assert.equal(await send("a.b+2@googlemail.com", "198.51.100.9"), 429);
  for (let i = 0; i < 10; i++) assert.equal(await send(`p${i}@example.com`, `2001:db8:1:2::${i + 1}`), 202);
  assert.equal(await send("q@example.com", "2001:db8:1:2:ffff::1"), 429, "a new address in the same /64 is the same client");
});

test("a request refused for its IP does not spend the address's quota", async () => {
  const w = await world();
  const send = async (email, ip) => (await call(w.env, start, "/api/start", { email, sealedEmail: await seal(w.pub, "email", email) }, { "cf-connecting-ip": ip })).status;
  for (let i = 0; i < 10; i++) await send(`filler${i}@example.com`, "192.0.2.66");
  for (let i = 0; i < 5; i++) assert.equal(await send("ada@example.com", "192.0.2.66"), 429);
  assert.equal(await send("ada@example.com", "198.51.100.1"), 202, "the participant can still sign in");
});

test("past the shared hourly cap nobody is mailed", async () => {
  const w = await world();
  const send = async (email, ip) => (await call(w.env, start, "/api/start", { email, sealedEmail: await seal(w.pub, "email", email) }, { "cf-connecting-ip": ip })).status;
  for (let i = 0; i < 60; i++) assert.equal(await send(`p${i}@example.com`, `10.0.${i}.1`), 202);
  assert.equal(await send("late@example.com", "10.1.0.1"), 429);
  assert.equal(w.outbox.length, 60);
});

test("links always name SITE_ORIGIN, and /api answers on no other host", async () => {
  const w = await world();
  const body = { email: "ada@example.com", sealedEmail: await seal(w.pub, "email", "ada@example.com") };
  const res = await call(w.env, start, "/api/start", body, { "cf-connecting-ip": "198.51.100.7" });
  assert.equal(res.status, 202);
  assert.match(w.outbox.at(-1).text, /https:\/\/feelingthemachine\.com\/account#join=/);
  const elsewhere = new Request("https://feeling.pages.dev/api/start", { method: "POST", headers: { origin: "https://feeling.pages.dev", "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await gate(elsewhere, w.env, () => start(elsewhere, w.env))).status, 404);
  const www = new Request("https://www.feelingthemachine.com/api/start", { method: "POST", headers: { origin: "https://www.feelingthemachine.com", "content-type": "application/json", "cf-connecting-ip": "198.51.100.8" }, body: JSON.stringify({ ...body, email: "grace@example.com", sealedEmail: await seal(w.pub, "email", "grace@example.com") }) });
  assert.equal((await gate(www, w.env, () => start(www, w.env))).status, 202);
  assert.match(w.outbox.at(-1).text, /https:\/\/feelingthemachine\.com\/account#/, "even from www, the link names the bare domain");
});

test("a link works once, and a join refused for a mistake does not spend it", async () => {
  const w = await world();
  await call(w.env, start, "/api/start", { email: "ada@example.com", sealedEmail: await seal(w.pub, "email", "ada@example.com") });
  const token = linkToken(w.outbox.at(-1), "join");
  const good = { token, sealedName: await seal(w.pub, "name", "Ada"), role: "research", ageBand: "30-39", country: "US", panel: true, readAgreement: true, lang: "en" };
  assert.equal((await call(w.env, join, "/api/join", { ...good, readAgreement: false })).status, 400);
  assert.equal((await call(w.env, join, "/api/join", good)).status, 201, "the link survived the mistake");
  assert.equal((await call(w.env, join, "/api/join", good)).status, 410, "and is spent once used");
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

// The consent row's lang is the record of which text the person read when
// they agreed, so a German consent must not be filed as English.
test("German: the link arrives in German and the consent is recorded as German", async () => {
  const w = await world();
  const email = "lena@example.de";
  const r1 = await call(w.env, start, "/api/start", { email, sealedEmail: await seal(w.pub, "email", email), lang: "de" });
  assert.equal(r1.status, 202);
  const mail = w.outbox.at(-1);
  assert.match(mail.subject, /beitreten/);
  assert.match(mail.text, /Vereinbarung/);
  const res = await call(w.env, join, "/api/join", {
    token: linkToken(mail, "join"), sealedName: await seal(w.pub, "name", "Lena"), role: "research", ageBand: "30-39", country: "XX",
    panel: true, readAgreement: true, lang: "de",
  });
  assert.equal(res.status, 201);
  const cookie = `__Host-ftm=${cookieOf(res)}`;
  await call(w.env, choices, "/api/choices", { panel: true, updates: true, lang: "fr" }, { cookie });
  const db = w.env.DB.raw;
  assert.equal(db.prepare("SELECT lang FROM participants").get().lang, "de");
  assert.deepEqual(db.prepare("SELECT lang FROM consents ORDER BY rowid").all().map((r) => r.lang), ["de", "en"], "an unknown language is filed as English");
});

test("every language has both emails, each carrying the link", () => {
  for (const l of ["en", "zh", "de", "fr", undefined]) {
    for (const purpose of ["join", "signin"]) {
      const m = linkMessage(purpose, l, "https://feelingthemachine.com/account#x=1");
      assert.ok(m.subject && m.text.includes("#x=1"), `${l} ${purpose}`);
    }
  }
  assert.equal(langOf("de"), "de");
  assert.equal(langOf("zh-CN"), "en");
});

test("digestMessage: counts only, and nothing at all for a quiet day", () => {
  const base = { joined: 0, left: 0, rejoined: 0, deleted: 0, issued: 9, accounts: 8, onPanel: 7, since: new Date("2026-11-24T06:00:00Z") };
  assert.equal(digestMessage(base), null);
  const m = digestMessage({ ...base, joined: 2, deleted: 1 });
  assert.equal(m.subject, "Feeling the Machine: 2 joined, 1 deleted their account");
  assert.match(m.text, /^Since 2026-11-24 06:00 UTC:\n {2}2 joined\n {2}1 deleted their account\n/);
  assert.match(m.text, /issued so far: 9\nAccounts on the site: 8\nOn the panel now: 7/);
});

test("the daily summary: once a UTC day, to hello@ only, counts and nothing about who", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-25T09:00:00Z") });
  const nextDay = () => t.mock.timers.setTime(Date.now() + 86400000);
  const w = await world();
  const run = () => call(w.env, digest, "/api/digest", {});
  const mailed = () => w.outbox.filter((m) => m.to === "hello@feelingthemachine.com");

  assert.equal((await run()).status, 204);
  assert.equal(mailed().length, 0, "the first call only starts the count");
  const ada = await signedUp(w);
  const grace = await signedUp(w, "grace@example.com");
  await signedUp(w, "lena@example.de");
  assert.equal((await call(w.env, choices, "/api/choices", { panel: false }, { cookie: ada.cookie })).status, 200);
  assert.equal((await call(w.env, remove, "/api/delete", { confirm: "delete" }, { cookie: grace.cookie })).status, 200);
  await run();
  assert.equal(mailed().length, 0, "nothing until the UTC day has turned");

  nextDay();
  assert.equal((await run()).status, 204);
  assert.equal(mailed().length, 1);
  const { subject, text } = mailed()[0];
  assert.equal(subject, "Feeling the Machine: 3 joined, 1 left the panel, 1 deleted their account");
  assert.match(text, /^Since 2026-11-25 09:00 UTC:/);
  assert.match(text, /issued so far: 3\nAccounts on the site: 2\nOn the panel now: 1/);
  assert.doesNotMatch(subject + text, /P\d{3}|@|Ada|Grace|Lena|research|30-39|\bUS\b/, "no number, address, name or attribute");
  await run();
  assert.equal(mailed().length, 1, "a second call the same day sends nothing");

  nextDay();
  await run();
  assert.equal(mailed().length, 1, "a quiet day sends nothing");

  await signedUp(w, "new@example.com");
  nextDay();
  w.env.MAIL_SENDER = () => { throw new Error("down"); };
  assert.equal((await run()).status, 204, "a failed send still answers 204");
  w.env.MAIL_SENDER = (m) => w.outbox.push(m);
  nextDay();
  await run();
  assert.equal(mailed().at(-1).subject, "Feeling the Machine: 1 joined", "the failed window is reported on the retry");
});
