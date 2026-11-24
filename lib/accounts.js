// The rules of participant accounts, as pure functions and WebCrypto helpers.
// No request, no database: lib/api.js is the wiring. Tested in
// tests/accounts.test.mjs.

const enc = new TextEncoder();

export const FORM = "F1";
export const ROLES = ["research", "engineering", "product-data", "leadership", "other"];
export const AGE_BANDS = ["18-29", "30-39", "40-49", "50-59", "60+"];
// Mainland China is its own entry because it alone needs cross-border consent.
export const COUNTRIES = ["US", "CN", "XX"];

/** Lower-cased and trimmed, or null if it cannot be an address. */
export function normalizeEmail(raw) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(email)) return null;
  return email;
}

/**
 * The address as the rate limiter counts it: plus-tags dropped everywhere, and
 * for Gmail the dots as well, so victim+1@, victim+2@ and v.ictim@ share the
 * one quota of the inbox they all reach. Only the limiter uses it; accounts
 * keep the address as typed. An ordinary address comes back unchanged, which
 * is what lets /api/delete still find and remove its counter.
 */
export function rateEmail(email) {
  const at = email.lastIndexOf("@");
  let local = email.slice(0, at).split("+")[0];
  let domain = email.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replaceAll(".", "");
  return `${local}@${domain}`;
}

/**
 * The client as the limiter counts it: an IPv4 address, or the /64 an IPv6
 * address sits in, since one home or server is given a whole /64 and could
 * otherwise present a new address for every request.
 */
export function rateIp(ip) {
  if (!ip) return "local";
  const v4 = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (v4) return v4[1];
  if (!ip.includes(":")) return ip;
  const [head, tail] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(":")}::/64`;
}

/** True when `value` is a v1 seal (site/seal.js) made for vault key `kid`. */
export function sealedFor(value, kid) {
  if (!kid || typeof value !== "string" || value.length > 2000) return false;
  const m = /^v1\.([0-9a-f]{16})\.[A-Za-z0-9_-]{87}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/.exec(value);
  return Boolean(m) && m[1] === kid;
}

export const formatId = (n) => `P${String(n).padStart(3, "0")}`;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function hmacHex(key, text) {
  if (!key) throw new Error("HMAC_KEY is not set");
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(text)));
}

export const sha256Hex = async (text) => hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));

/** 32 random bytes, base64url: a one-use link token or a session. */
export function randomToken() {
  let s = "";
  for (const b of crypto.getRandomValues(new Uint8Array(32))) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const bool = (v) => v === true;

/**
 * Check the consent form. Returns { value } or { error }. The panel agreement
 * and the privacy policy must be accepted; the three interests are optional;
 * mainland China requires the separate cross-border consent (PIPL).
 */
export function validateJoin(body, kid) {
  if (!body || typeof body !== "object") return { error: "invalid" };
  if (!sealedFor(body.sealedName, kid)) return { error: "name" };
  if (!ROLES.includes(body.role)) return { error: "role" };
  if (!AGE_BANDS.includes(body.ageBand)) return { error: "age" };
  if (!COUNTRIES.includes(body.country)) return { error: "country" };
  if (!bool(body.panel) || !bool(body.readAgreement)) return { error: "consent" };
  if (body.country === "CN" && !bool(body.crossBorder)) return { error: "cross_border" };
  return {
    value: {
      sealedName: body.sealedName,
      role: body.role,
      ageBand: body.ageBand,
      country: body.country,
      lang: langOf(body.lang),
      oralHistory: bool(body.oralHistory) ? 1 : 0,
      futureStudies: bool(body.futureStudies) ? 1 : 0,
      updates: bool(body.updates) ? 1 : 0,
      crossBorder: body.country === "CN" ? 1 : null,
    },
  };
}

/**
 * The site's languages. Anything else is recorded as English, the language the
 * page falls back to; the consent row's lang says which text was on screen.
 */
export const LANGS = ["en", "zh", "de"];
export const langOf = (v) => (LANGS.includes(v) ? v : "en");

const MESSAGES = {
  en: {
    join: ["Join the Feeling the Machine panel", (url) => `Hello,\n\nOpen this link to read the agreement and finish joining (it works for 30 minutes):\n\n${url}\n\nIf this wasn't you, ignore this email and nothing is recorded.\n\nFeeling the Machine\nhttps://feelingthemachine.com`],
    signin: ["Sign in to Feeling the Machine", (url) => `Hello,\n\nOpen this link to sign in (it works once, for 30 minutes):\n\n${url}\n\nIf this wasn't you, ignore this email.\n\nFeeling the Machine\nhttps://feelingthemachine.com`],
  },
  zh: {
    join: ["加入《感受机器》联系名单", (url) => `你好，\n\n请点击下面的链接，阅读同意书并完成加入（30分钟内有效）：\n\n${url}\n\n如果这不是你本人的操作，请忽略本邮件，不会记录任何信息。\n\n《感受机器》\nhttps://feelingthemachine.com`],
    signin: ["登录《感受机器》", (url) => `你好，\n\n请点击下面的链接登录（30分钟内有效，只能使用一次）：\n\n${url}\n\n如果这不是你本人的操作，请忽略本邮件。\n\n《感受机器》\nhttps://feelingthemachine.com`],
  },
  de: {
    join: ["Dem Panel von Feeling the Machine beitreten", (url) => `Guten Tag,\n\nöffnen Sie diesen Link, um die Vereinbarung zu lesen und Ihren Beitritt abzuschließen (er gilt 30 Minuten):\n\n${url}\n\nWenn Sie das nicht waren, ignorieren Sie diese E-Mail; es wird nichts gespeichert.\n\nFeeling the Machine\nhttps://feelingthemachine.com`],
    signin: ["Bei Feeling the Machine anmelden", (url) => `Guten Tag,\n\nöffnen Sie diesen Link, um sich anzumelden (er funktioniert einmal, 30 Minuten lang):\n\n${url}\n\nWenn Sie das nicht waren, ignorieren Sie diese E-Mail.\n\nFeeling the Machine\nhttps://feelingthemachine.com`],
  },
};

/** The email each link arrives in, in the participant's language. */
export function linkMessage(purpose, lang, url) {
  const [subject, text] = MESSAGES[langOf(lang)][purpose === "join" ? "join" : "signin"];
  return { subject, text: text(url) };
}

/**
 * A change on the participant's page, against their latest consent row.
 * Returns { value: { row, request } } or { error }. Leaving zeroes every
 * interest; rejoining needs the agreement again, and in mainland China the
 * cross-border consent again, because both are given anew, not inherited.
 */
export function validateChoices(body, latest, country, formVersion) {
  if (!body || typeof body !== "object" || !latest) return { error: "invalid" };
  const lang = langOf(body.lang);
  if (body.panel !== true) {
    const row = { form_version: latest.form_version, lang, panel: 0, oral_history: 0, future_studies: 0, updates: 0, cross_border: latest.cross_border };
    return { value: { row, request: latest.panel ? "leave" : null } };
  }
  const rejoining = !latest.panel;
  if (rejoining && !bool(body.agree)) return { error: "consent" };
  if (rejoining && country === "CN" && !bool(body.crossBorder)) return { error: "cross_border" };
  const row = {
    form_version: rejoining ? formVersion ?? "unversioned" : latest.form_version,
    lang,
    panel: 1,
    oral_history: bool(body.oralHistory) ? 1 : 0,
    future_studies: bool(body.futureStudies) ? 1 : 0,
    updates: bool(body.updates) ? 1 : 0,
    cross_border: country === "CN" ? 1 : null,
  };
  return { value: { row, request: rejoining ? "rejoin" : null } };
}
