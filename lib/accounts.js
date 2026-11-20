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
      lang: body.lang === "zh" ? "zh" : "en",
      oralHistory: bool(body.oralHistory) ? 1 : 0,
      futureStudies: bool(body.futureStudies) ? 1 : 0,
      updates: bool(body.updates) ? 1 : 0,
      crossBorder: body.country === "CN" ? 1 : null,
    },
  };
}

/** The email each link arrives in, in the participant's language. */
export function linkMessage(purpose, lang, url) {
  const zh = lang === "zh";
  if (purpose === "join") {
    return zh
      ? { subject: "加入《感受机器》联系名单", text: `你好，\n\n请点击下面的链接，阅读同意书并完成加入（30分钟内有效）：\n\n${url}\n\n如果这不是你本人的操作，请忽略本邮件，不会记录任何信息。\n\n《感受机器》\nhttps://feelingthemachine.com` }
      : { subject: "Join the Feeling the Machine panel", text: `Hello,\n\nOpen this link to read the agreement and finish joining (it works for 30 minutes):\n\n${url}\n\nIf this wasn't you, ignore this email and nothing is recorded.\n\nFeeling the Machine\nhttps://feelingthemachine.com` };
  }
  return zh
    ? { subject: "登录《感受机器》", text: `你好，\n\n请点击下面的链接登录（30分钟内有效，只能使用一次）：\n\n${url}\n\n如果这不是你本人的操作，请忽略本邮件。\n\n《感受机器》\nhttps://feelingthemachine.com` }
    : { subject: "Sign in to Feeling the Machine", text: `Hello,\n\nOpen this link to sign in (it works once, for 30 minutes):\n\n${url}\n\nIf this wasn't you, ignore this email.\n\nFeeling the Machine\nhttps://feelingthemachine.com` };
}
