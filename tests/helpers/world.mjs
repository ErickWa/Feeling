// Shared by tests/accounts.test.mjs and tests/vault.test.mjs: the site's real
// handlers over the real schema, in node:sqlite standing in for D1.
//
// WHAT THIS CANNOT SEE: D1 itself. The adapter implements only the calls
// lib/api.js and scripts/vault_lib.mjs make, and a transaction where D1 batches.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { gate, join, start } from "../../lib/api.js";
import { generateVaultKey, importPublicKey, seal, vaultKeys } from "../../site/seal.js";

export const ORIGIN = "https://feelingthemachine.com";
const schema = readdirSync(new URL("../../migrations/", import.meta.url)).sort()
  .map((f) => readFileSync(new URL(`../../migrations/${f}`, import.meta.url), "utf8")).join("\n");

export function fakeD1() {
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

export async function world() {
  const k = await generateVaultKey();
  const outbox = [];
  const env = {
    DB: fakeD1(), ACCOUNTS_OPEN: "true", VAULT_KID: k.kid, HMAC_KEY: "test-hmac-key", FORM1_VERSION: "1.0-test", SITE_ORIGIN: ORIGIN,
    MAIL_SENDER: (m) => outbox.push(m),
  };
  return { env, outbox, pub: await importPublicKey(k.publicJwk), keys: await vaultKeys([k.privateJwk]) };
}

export const call = (env, handler, path, body, headers = {}) => {
  const req = new Request(`${ORIGIN}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return gate(req, env, () => handler(req, env));
};

export const linkToken = (mail, purpose) => new RegExp(`/account#${purpose}=([A-Za-z0-9_-]+)`).exec(mail.text)?.[1];
export const cookieOf = (res) => /__Host-ftm=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];

export async function joinOne(w, email, extra = {}) {
  const r1 = await call(w.env, start, "/api/start", { email, sealedEmail: await seal(w.pub, "email", email.trim().toLowerCase()), lang: "en" });
  assert.equal(r1.status, 202);
  const token = linkToken(w.outbox.at(-1), "join");
  assert.ok(token, "a join link was mailed");
  return call(w.env, join, "/api/join", {
    token, sealedName: await seal(w.pub, "name", "Ada Lovelace"), role: "research", ageBand: "30-39", country: "US",
    panel: true, readAgreement: true, oralHistory: true, lang: "en", ...extra,
  });
}

