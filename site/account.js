// /account: one page whose state comes from the link and the server. All the
// words are in account.html, in both languages; this only chooses which part
// shows, seals what must be sealed, and talks to /api.
//
// WHAT THIS CANNOT SEE: whether it is the code the visitor actually got. The
// CSP keeps other scripts out; nothing here can prove its own integrity.

import { importPublicKey, seal } from "./seal.js";

const $ = (sel) => document.querySelector(sel);
// The language on screen; the server records anything it does not know as English.
const lang = () => document.documentElement.getAttribute("data-lang") || "en";

function show(state) {
  for (const s of document.querySelectorAll("[data-state]")) s.hidden = s.dataset.state !== state;
}

function say(key) {
  if (key) ok(null);
  const box = $("#msg");
  let found = false;
  for (const p of box.querySelectorAll("[data-msg]")) {
    p.hidden = p.dataset.msg !== key;
    found ||= !p.hidden;
  }
  if (!found) box.querySelector('[data-msg="server"]').hidden = false;
  box.hidden = !key;
  if (key) box.scrollIntoView({ block: "nearest" });
}

async function api(path, body) {
  const init = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(path, { credentials: "same-origin", ...init });
  let data = {};
  try { data = await res.json(); } catch { /* an empty or non-JSON answer: the status says enough */ }
  return { status: res.status, data };
}

async function vaultKey() {
  const res = await fetch("/vault-key.json");
  return res.ok ? importPublicKey(await res.json()) : null;
}

// The last record /api/me returned: the download is exactly this.
let record = null;

function yesNo(v) {
  return $(v ? "#yes" : "#no").content.cloneNode(true);
}

function renderMe(data) {
  record = data;
  const { participant, consents } = data;
  const latest = consents.at(-1) ?? {};
  const inPanel = Boolean(latest.panel);
  $("#pid").textContent = participant.id;
  for (const el of document.querySelectorAll("[data-when]")) el.hidden = (el.dataset.when === "in") !== inPanel;
  const f = $("#choices-form");
  f.oralHistory.checked = Boolean(latest.oral_history);
  f.futureStudies.checked = Boolean(latest.future_studies);
  f.updates.checked = Boolean(latest.updates);
  // The boxes show what is already saved, so there is nothing to save until one changes.
  $("#save-choices").disabled = true;
  $("#rejoin-form").reset();
  $("#rejoin-cross-border").hidden = participant.country !== "CN";
  $("#history").replaceChildren(...consents.slice().reverse().map((c) => {
    const li = $("#history-row").content.cloneNode(true);
    li.querySelector("time").textContent = c.at.slice(0, 10);
    li.querySelector("[data-version]").textContent = `${c.form} v${c.form_version}`;
    for (const el of li.querySelectorAll("[data-field]")) el.replaceChildren(yesNo(c[el.dataset.field]));
    return li;
  }));
  $("#delete-confirm").checked = false;
  $("#delete").disabled = true;
  show("me");
}

function ok(key) {
  for (const el of document.querySelectorAll("[data-ok]")) el.hidden = el.dataset.ok !== key;
  $("#ok").hidden = !key;
  if (key) $("#ok").scrollIntoView({ block: "nearest" });
}

async function loadMe() {
  const r = await api("/api/me");
  if (r.status === 200) return renderMe(r.data);
  if (r.status === 503) return show("closed");
  show("start");
}

$("#start-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  say(null);
  const email = $("#email").value.trim().toLowerCase();
  if (!$("#email").checkValidity() || !email) return say("invalid");
  const vault = await vaultKey();
  if (!vault) return show("closed");
  const r = await api("/api/start", { email, sealedEmail: await seal(vault, "email", email), lang: lang() });
  if (r.status === 202) return show("sent");
  if (r.status === 503) return show("closed");
  say(r.data.error);
});

$("#country").addEventListener("change", () => {
  $("#cross-border-row").hidden = $("#country").value !== "CN";
});

let joinToken = null;
$("#join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  say(null);
  const f = e.target;
  if (!f.checkValidity() || ($("#country").value === "CN" && !f.crossBorder.checked)) {
    f.reportValidity();
    return say("invalid");
  }
  const vault = await vaultKey();
  if (!vault) return show("closed");
  const r = await api("/api/join", {
    token: joinToken,
    sealedName: await seal(vault, "name", f.name.value.trim()),
    role: f.role.value, ageBand: f.ageBand.value, country: f.country.value,
    panel: f.panel.checked, readAgreement: f.readAgreement.checked, crossBorder: f.crossBorder.checked,
    oralHistory: f.oralHistory.checked, futureStudies: f.futureStudies.checked, updates: f.updates.checked,
    lang: lang(),
  });
  if (r.status === 201) {
    f.reset(); // don't leave the name sitting in the page once it is sealed and sent
    joinToken = null;
    await loadMe();
    return ok("joined");
  }
  if (r.status === 410 || r.status === 409) show("start");
  say(r.data.error);
});

async function saveChoices(body) {
  say(null);
  ok(null);
  const r = await api("/api/choices", { ...body, lang: lang() });
  if (r.status === 401) return show("start");
  if (r.status !== 200) return say(r.data.error);
  await loadMe();
  ok(r.data.request ?? "saved");
}

$("#choices-form").addEventListener("change", (e) => {
  const f = e.currentTarget, latest = record?.consents.at(-1) ?? {};
  $("#save-choices").disabled = f.oralHistory.checked === Boolean(latest.oral_history)
    && f.futureStudies.checked === Boolean(latest.future_studies)
    && f.updates.checked === Boolean(latest.updates);
});

$("#choices-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  saveChoices({ panel: true, oralHistory: f.oralHistory.checked, futureStudies: f.futureStudies.checked, updates: f.updates.checked });
});

$("#leave").addEventListener("click", () => saveChoices({ panel: false }));

$("#rejoin-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  if (!f.agree.checked || (!$("#rejoin-cross-border").hidden && !f.crossBorder.checked)) return say("invalid");
  saveChoices({ panel: true, agree: true, crossBorder: f.crossBorder.checked });
});

$("#download").addEventListener("click", () => {
  if (!record) return;
  const file = { exported: new Date().toISOString(), source: "https://feelingthemachine.com", ...record };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
  a.download = `feeling-the-machine-${record.participant.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$("#delete-confirm").addEventListener("change", (e) => {
  $("#delete").disabled = !e.target.checked;
});

$("#delete").addEventListener("click", async () => {
  if (!$("#delete-confirm").checked) return;
  say(null);
  const r = await api("/api/delete", { confirm: "delete" });
  if (r.status !== 200) return say(r.data.error);
  record = null;
  ok(null);
  show("deleted");
});

$("#signout").addEventListener("click", async () => {
  await api("/api/signout", {});
  record = null;
  ok(null);
  show("start");
});

// A link's token is in the fragment. Take it, then drop it from the address
// bar and history, so it is not bookmarked, shared or left behind.
const m = /^#(join|signin)=([A-Za-z0-9_-]{20,100})$/.exec(location.hash);
if (m) history.replaceState(null, "", location.pathname);

if (m && m[1] === "join") {
  joinToken = m[2];
  show("join");
} else if (m && m[1] === "signin") {
  const r = await api("/api/signin", { token: m[2] });
  if (r.status === 200) await loadMe();
  else { show("start"); say(r.data.error); }
} else {
  await loadMe();
}
