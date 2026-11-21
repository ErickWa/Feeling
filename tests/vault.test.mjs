// scripts/vault_lib.mjs: the site → vault sync, against participants made by
// the site's real handlers and a temporary vault laid out by make_vault.sh's
// templates.
//
// WHAT THIS CANNOT SEE: the CLI's own I/O (the D1 REST call, the vault path
// checks, the atomic rename), which a dry run against production will be the
// first to exercise; and a real encrypted volume.

import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as path } from "node:path";
import { choices, remove } from "../lib/api.js";
import { generateVaultKey, seal, vaultKeys } from "../site/seal.js";
import { defuse, parseCsv, sync, writeCsv } from "../scripts/vault_lib.mjs";
import { call, cookieOf, joinOne, world } from "./helpers/world.mjs";

const templates = new URL("../templates/", import.meta.url);

function tempVault() {
  const root = mkdtempSync(path(tmpdir(), "ftm-vault-"));
  mkdirSync(path(root, "01_panel"));
  mkdirSync(path(root, "07_admin"));
  copyFileSync(new URL("contact-log.csv", templates), path(root, "01_panel/contact-log.csv"));
  copyFileSync(new URL("consent-register.csv", templates), path(root, "07_admin/consent-register.csv"));
  copyFileSync(new URL("withdrawal-log.csv", templates), path(root, "07_admin/withdrawal-log.csv"));
  return {
    root,
    read: (n) => (existsSync(path(root, n)) ? readFileSync(path(root, n), "utf8") : null),
    write: (n, t) => writeFileSync(path(root, n), t),
    table: (n) => parseCsv(readFileSync(path(root, n), "utf8")).rows,
  };
}

const dbOf = (w) => ({ query: async (sql, params = []) => w.env.DB.raw.prepare(sql).all(...params) });

async function setup() {
  const w = await world();
  const vault = tempVault();
  const run = (opts = {}) => sync({ db: dbOf(w), files: vault, keys: w.keys, hmacKey: w.env.HMAC_KEY, today: "2026-11-21", ...opts });
  return { w, vault, run };
}

test("CSV round-trips commas, quotes, newlines and Chinese", () => {
  const rows = [{ a: 'Ada "the first", Countess', b: "line one\nline two" }, { a: "王小明", b: "" }];
  assert.deepEqual(parseCsv(writeCsv(["a", "b"], rows)).rows, rows);
});

test("a cell a spreadsheet would run as a formula is defused", () => {
  for (const evil of ["=HYPERLINK(\"http://x\")", "+1", "-2", "@SUM(A1)"]) assert.equal(defuse(evil), `'${evil}`);
  assert.equal(defuse("Ada"), "Ada");
});

test("a new participant lands in the contact log and the register, and the site lets go of the seals", async () => {
  const { w, vault, run } = await setup();
  await joinOne(w, "ada@example.com", { oralHistory: true });
  const report = await run();
  assert.deepEqual(report.added, ["P001"]);
  assert.deepEqual(report.pruned, ["P001"]);
  const [row] = vault.table("01_panel/contact-log.csv");
  assert.equal(row.name, "Ada Lovelace");
  assert.equal(row.email, "ada@example.com");
  assert.equal(row.country, "United States");
  assert.equal(row.agreed_oral_history, "yes");
  assert.equal(row.agreed_updates, "no");
  assert.equal(row.form_version, "F1 v1.0-test");
  const [reg] = vault.table("07_admin/consent-register.csv");
  assert.equal(reg.record_id, "site-1");
  assert.equal(reg.cross_border_consent, "not applicable");
  const p = w.env.DB.raw.prepare("SELECT sealed_email, sealed_name FROM participants").get();
  assert.deepEqual({ ...p }, { sealed_email: null, sealed_name: null });
  assert.doesNotMatch(JSON.stringify(report), /Ada|example/, "the report names nobody");
});

test("running twice changes nothing the second time", async () => {
  const { w, vault, run } = await setup();
  await joinOne(w, "ada@example.com");
  await run();
  const before = ["01_panel/contact-log.csv", "07_admin/consent-register.csv", "07_admin/withdrawal-log.csv"].map(vault.read);
  const second = await run();
  assert.deepEqual([second.added, second.consents, second.requests], [[], 0, []]);
  assert.deepEqual(["01_panel/contact-log.csv", "07_admin/consent-register.csv", "07_admin/withdrawal-log.csv"].map(vault.read), before);
});

test("a dry run writes nothing and changes nothing on the site", async () => {
  const { w, vault, run } = await setup();
  await joinOne(w, "ada@example.com");
  const before = vault.read("01_panel/contact-log.csv");
  const report = await run({ dryRun: true });
  assert.deepEqual(report.added, ["P001"]);
  assert.equal(vault.read("01_panel/contact-log.csv"), before);
  assert.match(w.env.DB.raw.prepare("SELECT sealed_name FROM participants").get().sealed_name, /^v1\./);
});

test("choices made after the copy reach the vault without the seals", async () => {
  const { w, vault, run } = await setup();
  const res = await joinOne(w, "ada@example.com");
  const cookie = `__Host-ftm=${cookieOf(res)}`;
  await run();
  await call(w.env, choices, "/api/choices", { panel: true, updates: true }, { cookie });
  const report = await run();
  assert.equal(report.consents, 1);
  const [row] = vault.table("01_panel/contact-log.csv");
  assert.equal(row.agreed_updates, "yes");
  assert.equal(row.name, "Ada Lovelace", "kept from the first copy");
});

test("leaving is logged as a withdrawal and marked done; rejoining is not a withdrawal", async () => {
  const { w, vault, run } = await setup();
  const cookie = `__Host-ftm=${cookieOf(await joinOne(w, "ada@example.com"))}`;
  await call(w.env, choices, "/api/choices", { panel: false }, { cookie });
  await call(w.env, choices, "/api/choices", { panel: true, agree: true }, { cookie });
  const report = await run();
  assert.deepEqual(report.requests, ["P001 leave", "P001 rejoin"]);
  const log = vault.table("07_admin/withdrawal-log.csv");
  assert.equal(log.length, 1);
  assert.equal(log[0].request, "leave the panel (website)");
  assert.match(log[0].action_taken, /due for deletion 2027-11-2\d/);
  assert.equal(w.env.DB.raw.prepare("SELECT count(*) AS n FROM requests WHERE done_at IS NULL").get().n, 0);
});

test("a deletion removes the person from the contact log and the tombstone from the site", async () => {
  const { w, vault, run } = await setup();
  const cookie = `__Host-ftm=${cookieOf(await joinOne(w, "ada@example.com"))}`;
  await joinOne(w, "grace@example.com");
  await run();
  await call(w.env, remove, "/api/delete", { confirm: "delete" }, { cookie });
  const report = await run();
  assert.deepEqual(vault.table("01_panel/contact-log.csv").map((r) => r.panel_id), ["P002"]);
  assert.equal(vault.table("07_admin/withdrawal-log.csv")[0].request, "delete account (website)");
  assert.equal(w.env.DB.raw.prepare("SELECT count(*) AS n FROM requests").get().n, 0);
  assert.match(report.reminders.join(" "), /P001: remove from the key vault/);
  assert.equal(vault.table("07_admin/consent-register.csv").filter((r) => r.participant_id === "P001").length, 1, "consent proof kept, with no contact details");
});

test("a seal that is not the verified address is reported, not copied, and left on the site", async () => {
  const { w, vault, run } = await setup();
  await joinOne(w, "ada@example.com");
  const liar = await seal(w.pub, "email", "someone-else@example.com");
  w.env.DB.raw.prepare("UPDATE participants SET sealed_email = ?").run(liar);
  const report = await run();
  assert.deepEqual(report.mismatched, ["P001"]);
  assert.deepEqual(vault.table("01_panel/contact-log.csv"), []);
  assert.equal(w.env.DB.raw.prepare("SELECT sealed_email FROM participants").get().sealed_email, liar);
});

test("a P-number the vault already gave someone else stops the run before anything is written", async () => {
  const { w, vault, run } = await setup();
  await joinOne(w, "ada@example.com");
  vault.write("01_panel/contact-log.csv", vault.read("01_panel/contact-log.csv") + "P001,Earlier Person,earlier@example.org,,,,,,,,,,,,\n");
  const before = vault.read("01_panel/contact-log.csv");
  await assert.rejects(run(), /raise next_participant/);
  assert.equal(vault.read("01_panel/contact-log.csv"), before);
});

test("a name typed as a formula is stored defused", async () => {
  const { w, vault, run } = await setup();
  await joinOne(w, "ada@example.com", { sealedName: await seal(w.pub, "name", '=HYPERLINK("http://evil","x")') });
  await run();
  assert.equal(vault.table("01_panel/contact-log.csv")[0].name, `'=HYPERLINK("http://evil","x")`);
});

test("without the right vault key nothing is copied or cleared", async () => {
  const { w, run } = await setup();
  await joinOne(w, "ada@example.com");
  const other = await vaultKeys([(await generateVaultKey()).privateJwk]);
  const report = await run({ keys: other });
  assert.deepEqual(report.unreadable, ["P001"]);
  assert.deepEqual(report.pruned, []);
});
