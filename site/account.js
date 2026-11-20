// /account: one page whose state comes from the link and the server. All the
// words are in account.html, in both languages; this only chooses which part
// shows, seals what must be sealed, and talks to /api.
//
// WHAT THIS CANNOT SEE: whether it is the code the visitor actually got. The
// CSP keeps other scripts out; nothing here can prove its own integrity.

import { importPublicKey, seal } from "./seal.js";

const $ = (sel) => document.querySelector(sel);
const lang = () => (document.documentElement.getAttribute("data-lang") === "zh" ? "zh" : "en");

function show(state) {
  for (const s of document.querySelectorAll("[data-state]")) s.hidden = s.dataset.state !== state;
}

function say(key) {
  const box = $("#msg");
  let found = false;
  for (const p of box.querySelectorAll("[data-msg]")) {
    p.hidden = p.dataset.msg !== key;
    found ||= !p.hidden;
  }
  if (!found) box.querySelector('[data-msg="server"]').hidden = false;
  box.hidden = !key;
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

function renderMe({ participant, consents }) {
  $("#pid").textContent = participant.id;
  const latest = consents.at(-1) ?? {};
  for (const dd of document.querySelectorAll("[data-field]")) {
    dd.replaceChildren($(latest[dd.dataset.field] ? "#yes" : "#no").content.cloneNode(true));
  }
  show("me");
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
    return loadMe();
  }
  if (r.status === 410 || r.status === 409) show("start");
  say(r.data.error);
});

$("#signout").addEventListener("click", async () => {
  await api("/api/signout", {});
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
