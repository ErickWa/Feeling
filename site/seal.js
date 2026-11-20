// Sealing: how a participant's name and email leave their browser readable by
// nobody but the vault. protocol/participant-accounts.md is the why.
//
// One module for both ends. The browser imports it to SEAL; the vault scripts
// import it in Node to OPEN. Both use only WebCrypto (`crypto.subtle`), so the
// code that encrypts is the code the tests run.
//
// The scheme is ECIES over P-256: a fresh ECDH key pair per seal, agreed with
// the vault's public key, stretched by HKDF-SHA-256 into an AES-256-GCM key.
// P-256 rather than X25519 because X25519 is not in WebCrypto at the
// portfolio's browser floor (Safari 16.4, Chrome 111); everything here is.
//
// A sealed value is one ASCII string:
//
//   v1.<kid>.<ephemeral public key>.<iv>.<ciphertext>     (base64url parts)
//
// `kid` names the vault key that can open it, so a rotated key does not strand
// what the old one sealed. The FIELD ("name", "email") is bound into the
// AES-GCM additional data, so a sealed email moved into the name column fails
// to open rather than opening as somebody's name.
//
// WHAT THIS CANNOT SEE: whether the page that calls it is the page we wrote.
// Anyone who can change site/ can change this file to send plaintext instead;
// the CSP and the repo's review are what stand in the way, not this code.

const VERSION = "v1";
const INFO = new TextEncoder().encode("feeling-the-machine/seal/v1");
const P256 = { name: "ECDH", namedCurve: "P-256" };

const subtle = () => globalThis.crypto.subtle;

function toB64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("sealed value is not base64url");
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const aad = (kid, field) => new TextEncoder().encode(`${VERSION}|${kid}|${field}`);

/** The key id: the first 8 bytes of SHA-256 over the raw public key, hex. */
export async function keyId(publicKey) {
  const raw = new Uint8Array(await subtle().exportKey("raw", publicKey));
  const hash = new Uint8Array(await subtle().digest("SHA-256", raw));
  return [...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fresh vault key pair. Only scripts/vault_keygen.mjs should call this. */
export async function generateVaultKey() {
  const pair = await subtle().generateKey(P256, true, ["deriveBits"]);
  const kid = await keyId(pair.publicKey);
  return {
    kid,
    publicJwk: { ...(await subtle().exportKey("jwk", pair.publicKey)), kid },
    privateJwk: { ...(await subtle().exportKey("jwk", pair.privateKey)), kid },
  };
}

/** Import the published public key (site/vault-key.json). Refuses a private one. */
export async function importPublicKey(jwk) {
  if ("d" in jwk) throw new Error("refusing a private key where a public one belongs");
  const { kid, ...bare } = jwk;
  const key = await subtle().importKey("jwk", { ...bare, key_ops: [] }, P256, true, []);
  if ((await keyId(key)) !== kid) throw new Error("public key does not match its kid");
  return { kid, key };
}

/** Import the vault's private key (Node only, from inside the vault). */
export async function importPrivateKey(jwk) {
  const { kid, ...bare } = jwk;
  const key = await subtle().importKey("jwk", { ...bare, key_ops: ["deriveBits"] }, P256, false, ["deriveBits"]);
  return { kid, key };
}

async function aesKey(privateKey, publicKey, ephemeralRaw, recipientRaw) {
  const shared = await subtle().deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const hkdf = await subtle().importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: concat(ephemeralRaw, recipientRaw), info: INFO },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Seal `text` for the vault, bound to `field`. Runs in the browser. */
export async function seal(vault, field, text) {
  if (typeof text !== "string" || text.length === 0) throw new Error(`nothing to seal for ${field}`);
  const recipientRaw = new Uint8Array(await subtle().exportKey("raw", vault.key));
  const eph = await subtle().generateKey(P256, true, ["deriveBits"]);
  const ephemeralRaw = new Uint8Array(await subtle().exportKey("raw", eph.publicKey));
  const key = await aesKey(eph.privateKey, vault.key, ephemeralRaw, recipientRaw);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv, additionalData: aad(vault.kid, field) },
    key,
    new TextEncoder().encode(text),
  );
  return [VERSION, vault.kid, toB64url(ephemeralRaw), toB64url(iv), toB64url(ct)].join(".");
}

/**
 * Open a sealed value with the vault's private key. Runs in Node, in the
 * vault. `keys` maps kid to { key, publicRaw }, so rotated keys still open old seals.
 */
export async function open(keys, field, sealed) {
  const parts = String(sealed).split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) throw new Error("not a v1 sealed value");
  const [, kid, eph, ivText, ctText] = parts;
  const vault = keys.get(kid);
  if (!vault) throw new Error(`no vault key ${kid} to open this`);
  const ephemeralRaw = fromB64url(eph);
  const ephemeral = await subtle().importKey("raw", ephemeralRaw, P256, false, []);
  const key = await aesKey(vault.key, ephemeral, ephemeralRaw, vault.publicRaw);
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: fromB64url(ivText), additionalData: aad(kid, field) },
    key,
    fromB64url(ctText),
  );
  return new TextDecoder().decode(plain);
}

/** Build the `keys` map open() takes from private JWKs (each carries its kid). */
export async function vaultKeys(privateJwks) {
  const keys = new Map();
  for (const jwk of privateJwks) {
    const { kid, key } = await importPrivateKey(jwk);
    const { kid: pubKid, key: pub } = await importPublicKey({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid });
    if (pubKid !== kid) throw new Error(`private key ${kid} is mislabelled`);
    keys.set(kid, { key, publicRaw: new Uint8Array(await subtle().exportKey("raw", pub)) });
  }
  return keys;
}
