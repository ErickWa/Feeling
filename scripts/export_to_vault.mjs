#!/usr/bin/env node
// Copy the website's participant records into the vault, then let the site
// forget what the vault now holds. scripts/vault_lib.mjs is the logic and says
// what one run does, in what order, and why it is safe to run twice.
//
// Usage:
//   CLOUDFLARE_API_TOKEN=... node scripts/export_to_vault.mjs /path/to/mounted/vault [--dry-run]
//
// The token needs D1 Edit on the account (it marks requests done and clears
// sealed values). Your wrangler login works:
//   CLOUDFLARE_API_TOKEN=$(npx wrangler@4.152.0 auth token | tail -n 1) node scripts/export_to_vault.mjs ...
//
// Reads from the vault: 07_admin/site-keys/*.private.json (scripts/vault_keygen.mjs)
// and 07_admin/hmac_key.txt (the site's HMAC_KEY secret, kept here when it was
// set). Writes: 01_panel/contact-log.csv, 07_admin/consent-register.csv,
// 07_admin/withdrawal-log.csv. Run --dry-run first: it changes nothing.
//
// The vault never enters mainland China (protocol/data-management.md), and
// neither does this run.

import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { vaultKeys } from "../site/seal.js";
import { sync } from "./vault_lib.mjs";

const ACCOUNT = "6010d070417dea8ddd87556f1ecf622c";
const DATABASE = "0da66a67-0a25-4d59-9a2a-54b2c4caf506"; // D1 `feeling`, as wrangler.toml says

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const vaultArg = args.find((a) => !a.startsWith("--"));
if (!vaultArg) {
  console.error("Usage: CLOUDFLARE_API_TOKEN=... node scripts/export_to_vault.mjs /path/to/mounted/vault [--dry-run]");
  process.exit(2);
}
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error("Set CLOUDFLARE_API_TOKEN (a token with D1 Edit, or $(npx wrangler@4.152.0 auth token | tail -n 1)).");
  process.exit(2);
}

const repo = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const root = join(realpathSync(vaultArg), "FeelingTheMachine");
if (root === repo || root.startsWith(repo + sep)) {
  console.error("Refusing: the vault must not be inside the git repo.");
  process.exit(1);
}
const keyDir = join(root, "07_admin", "site-keys");
const hmacPath = join(root, "07_admin", "hmac_key.txt");
if (!existsSync(keyDir) || !existsSync(hmacPath)) {
  console.error(`Need ${keyDir} (scripts/vault_keygen.mjs) and ${hmacPath} (the site's HMAC_KEY).`);
  process.exit(1);
}

const keys = await vaultKeys(readdirSync(keyDir).filter((f) => f.endsWith(".private.json")).map((f) => JSON.parse(readFileSync(join(keyDir, f), "utf8"))));
const hmacKey = readFileSync(hmacPath, "utf8").trim();

const db = {
  async query(sql, params = []) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) throw new Error(`D1 query failed (${res.status}): ${JSON.stringify(body.errors ?? [])}`);
    return body.result[0].results;
  },
};

const files = {
  read: (name) => (existsSync(join(root, name)) ? readFileSync(join(root, name), "utf8") : null),
  // Write beside, then rename: a crash never leaves a half-written log.
  write: (name, text) => {
    const path = join(root, name);
    writeFileSync(`${path}.tmp`, text, { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  },
};

const report = await sync({ db, files, keys, hmacKey, today: new Date().toISOString().slice(0, 10), dryRun });

const line = (label, list) => console.log(`${label}: ${list.length ? list.join(", ") : "none"}`);
console.log(dryRun ? "DRY RUN: nothing written, nothing changed on the site.\n" : "Synced.\n");
line("New in the contact log", report.added);
line("Contact details refreshed", report.updated);
console.log(`Consent rows added to the register: ${report.consents}`);
line("Requests handled", report.requests);
line(dryRun ? "Would clear sealed values on the site for" : "Sealed values cleared on the site for", dryRun ? [...report.added, ...report.updated] : report.pruned);
if (report.mismatched.length) line("NOT COPIED, sealed email does not match the verified address (investigate)", report.mismatched);
if (report.unreadable.length) line("NOT COPIED, no vault key opens their seal", report.unreadable);
if (report.reminders.length) console.log(`\nTo do by hand, within 14 days:\n  ${report.reminders.join("\n  ")}`);
