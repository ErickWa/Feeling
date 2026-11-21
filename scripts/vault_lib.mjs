// What scripts/export_to_vault.mjs does, without the I/O, so tests can run it
// against node:sqlite and a temporary vault. protocol/participant-accounts.md
// ("Into the vault") is the why.
//
// ONE RUN, IN THIS ORDER, so that a failure anywhere is fixed by running again:
//   1. read the site; open every sealed name and email with the vault keys
//   2. check each opened email against the site's fingerprint of the address
//      the person actually received a link at; a mismatch is reported and
//      that participant is left alone, on the site and in the vault
//   3. write the vault's CSVs (contact log, consent register, withdrawal log),
//      each upserted by a key, so a second run changes nothing
//   4. only then tell the site: mark requests done, drop sealed values the
//      vault now holds, and drop finished delete tombstones
//
// NOTHING HERE PRINTS A NAME OR AN ADDRESS. The report carries IDs and counts;
// a terminal's scrollback is outside the vault.
//
// WHAT THIS CANNOT SEE: the key vault (03_key/key.csv lives in a separate
// vault this script never opens, so a deletion there is a reminder, not an
// action), and whether the person who asked is the person who joined.

import { normalizeEmail, hmacHex } from "../lib/accounts.js";
import { open } from "../site/seal.js";

// ---------- CSV (RFC 4180), with formula-injection defence ----------

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", i = 0, quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ",") { row.push(cell); cell = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
    cell += c; i++;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [header = [], ...body] = rows;
  return { header, rows: body.filter((r) => r.some((v) => v !== "")).map((r) => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ""]))) };
}

/** A participant-typed cell that a spreadsheet would run as a formula is defused with a leading apostrophe. */
export const defuse = (v) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

const quote = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function writeCsv(header, rows) {
  return [header, ...rows.map((r) => header.map((h) => String(r[h] ?? "")))].map((r) => r.map(quote).join(",")).join("\n") + "\n";
}

// ---------- the sync ----------

const COUNTRY = { US: "United States", CN: "Mainland China", XX: "Elsewhere" };
const yn = (v) => (v ? "yes" : "no");

/**
 * Plan and (unless dryRun) apply one sync.
 *   db      { query(sql, params) -> Promise<rows> } over the site's D1
 *   files   { read(name) -> string|null, write(name, text) } relative to FeelingTheMachine/
 *   keys    the Map from vaultKeys(); hmacKey the site's HMAC_KEY
 * Returns a report of IDs and counts only.
 */
export async function sync({ db, files, keys, hmacKey, today, dryRun = false }) {
  const report = { added: [], updated: [], mismatched: [], unreadable: [], consents: 0, requests: [], pruned: [], reminders: [] };

  const contact = parseCsv(files.read("01_panel/contact-log.csv") ?? "");
  const register = parseCsv(files.read("07_admin/consent-register.csv") ?? "");
  const withdrawals = parseCsv(files.read("07_admin/withdrawal-log.csv") ?? "");
  for (const [name, t] of [["contact-log.csv", contact], ["consent-register.csv", register], ["withdrawal-log.csv", withdrawals]]) {
    if (!t.header.length) throw new Error(`${name} is missing or empty: run scripts/make_vault.sh first`);
  }
  const byId = new Map(contact.rows.map((r) => [r.panel_id, r]));

  const participants = await db.query("SELECT * FROM participants ORDER BY id");
  const consents = await db.query("SELECT * FROM consents ORDER BY id");
  const requests = await db.query("SELECT * FROM requests WHERE done_at IS NULL ORDER BY id");
  const latest = new Map();
  for (const c of consents) latest.set(c.participant_id, c);
  const prune = [];

  for (const p of participants) {
    const c = latest.get(p.id) ?? {};
    let row = byId.get(p.id);
    if (p.sealed_email || p.sealed_name) {
      let email, name;
      try {
        email = p.sealed_email ? await open(keys, "email", p.sealed_email) : null;
        name = p.sealed_name ? await open(keys, "name", p.sealed_name) : null;
      } catch {
        report.unreadable.push(p.id); // a missing or wrong key: leave it on the site for next time
        continue;
      }
      if (email !== null && (await hmacHex(hmacKey, normalizeEmail(email) ?? "")) !== p.email_hmac) {
        report.mismatched.push(p.id);
        continue;
      }
      if (row && email !== null && row.email && row.email !== email) {
        // The same P-number already belongs to somebody else in the vault:
        // the site's counter started too low. Stop before overwriting anyone.
        throw new Error(`${p.id} is already in the contact log with a different address; raise next_participant on the site and investigate`);
      }
      if (!row) {
        row = { panel_id: p.id, messaging_id: "", last_contact: "", notes: "joined on the website" };
        contact.rows.push(row);
        byId.set(p.id, row);
        report.added.push(p.id);
      } else {
        report.updated.push(p.id);
      }
      if (email !== null) row.email = defuse(email);
      if (name !== null) row.name = defuse(name);
      prune.push(p.id);
    }
    if (row) {
      Object.assign(row, {
        country: COUNTRY[p.country] ?? p.country,
        role_type: p.role,
        age_band: p.age_band,
        agreed_oral_history: yn(c.oral_history),
        agreed_future_studies: yn(c.future_studies),
        agreed_updates: yn(c.updates),
        form_version: c.form_version ? `${c.form} v${c.form_version}` : row.form_version ?? "",
        date_signed: row.date_signed || (p.created_at ?? "").slice(0, 10),
        preferred_language: p.lang,
      });
    }
  }

  const recorded = new Set(register.rows.map((r) => r.record_id));
  for (const c of consents) {
    const record_id = `site-${c.id}`;
    if (recorded.has(record_id)) continue;
    register.rows.push({
      record_id, participant_id: c.participant_id, form: c.form, form_version: c.form_version, language: c.lang,
      date_signed: c.at.slice(0, 10), access_choice: "", closed_until: "",
      cross_border_consent: c.cross_border === null || c.cross_border === undefined ? "not applicable" : yn(c.cross_border),
      stored_at: "website consent row", notes: `panel ${yn(c.panel)}; oral history ${yn(c.oral_history)}; studies ${yn(c.future_studies)}; updates ${yn(c.updates)}`,
    });
    report.consents++;
  }

  const logged = new Set(withdrawals.rows.map((r) => r.notes));
  for (const q of requests) {
    const ref = `site request ${q.id}`;
    if (q.kind === "delete") {
      const row = byId.get(q.participant_id);
      if (row) contact.rows.splice(contact.rows.indexOf(row), 1);
      byId.delete(q.participant_id);
      report.reminders.push(`${q.participant_id}: remove from the key vault (03_key/key.csv) and delete any panel emails; confirm in writing`);
    }
    if (q.kind !== "rejoin" && !logged.has(ref)) {
      withdrawals.rows.push({
        date_received: q.at.slice(0, 10), participant_id: q.participant_id,
        request: q.kind === "delete" ? "delete account (website)" : "leave the panel (website)",
        action_taken: q.kind === "delete" ? "removed from the contact log; consent records kept without contact details" : `contact stopped; contact details due for deletion ${addMonths(q.at, 12)}`,
        date_actioned: today, confirmed_in_writing: "no", notes: ref,
      });
    }
    if (q.kind === "leave") report.reminders.push(`${q.participant_id}: left the panel; confirm in writing`);
    report.requests.push(`${q.participant_id} ${q.kind}`);
  }

  if (dryRun) return report;

  files.write("01_panel/contact-log.csv", writeCsv(contact.header, contact.rows));
  files.write("07_admin/consent-register.csv", writeCsv(register.header, register.rows));
  files.write("07_admin/withdrawal-log.csv", writeCsv(withdrawals.header, withdrawals.rows));

  // The vault now holds it all; only now does the site let go.
  for (const id of prune) {
    await db.query("UPDATE participants SET sealed_email = NULL, sealed_name = NULL WHERE id = ?1", [id]);
    report.pruned.push(id);
  }
  for (const q of requests) {
    if (q.kind === "delete") await db.query("DELETE FROM requests WHERE id = ?1", [q.id]);
    else await db.query("UPDATE requests SET done_at = ?1 WHERE id = ?2", [today, q.id]);
  }
  return report;
}

function addMonths(iso, n) {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
