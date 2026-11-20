// site/seal.js, run under Node's WebCrypto: the same calls a browser makes.
//
// WHAT THIS CANNOT SEE: a browser. Node's WebCrypto and a browser's implement
// the same standard, and a seal made in Chrome was opened by this code on
// 2026-11-20 (the slice's commit says how), but no gate runs a browser, so a
// browser-only difference would not show here. Safari at the floor (16.4) has
// not been tried at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { generateVaultKey, importPublicKey, keyId, open, seal, vaultKeys } from "../site/seal.js";

const fresh = async () => {
  const k = await generateVaultKey();
  return { ...k, pub: await importPublicKey(k.publicJwk), keys: await vaultKeys([k.privateJwk]) };
};

test("round-trips names and addresses in any script", async () => {
  const k = await fresh();
  for (const text of ["Ada Lovelace", "王小明", "ada+ftm@example.com", "Zoë Ñúñez-O'Brien 🙂", "x".repeat(2000)]) {
    assert.equal(await open(k.keys, "name", await seal(k.pub, "name", text)), text);
  }
});

test("a sealed value is ASCII, versioned, and names its key", async () => {
  const k = await fresh();
  const s = await seal(k.pub, "email", "a@example.com");
  assert.match(s, /^v1\.[0-9a-f]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(s.split(".")[1], k.kid);
  assert.doesNotMatch(s, /example/);
});

test("the same text seals differently every time", async () => {
  const k = await fresh();
  assert.notEqual(await seal(k.pub, "name", "Ada"), await seal(k.pub, "name", "Ada"));
});

test("a value sealed as one field does not open as another", async () => {
  const k = await fresh();
  const s = await seal(k.pub, "email", "a@example.com");
  await assert.rejects(open(k.keys, "name", s));
});

test("any change to the sealed value is refused", async () => {
  const k = await fresh();
  const s = await seal(k.pub, "name", "Ada");
  const parts = s.split(".");
  for (const i of [2, 3, 4]) {
    const p = [...parts];
    p[i] = (p[i][0] === "A" ? "B" : "A") + p[i].slice(1);
    await assert.rejects(open(k.keys, "name", p.join(".")), `part ${i} tampered`);
  }
});

test("another vault's key cannot open it, and says which key it needs", async () => {
  const a = await fresh();
  const b = await fresh();
  const s = await seal(a.pub, "name", "Ada");
  await assert.rejects(open(b.keys, "name", s), new RegExp(`no vault key ${a.kid}`));
});

test("rotated keys still open what the old key sealed", async () => {
  const old = await generateVaultKey();
  const now = await generateVaultKey();
  const keys = await vaultKeys([old.privateJwk, now.privateJwk]);
  const s1 = await seal(await importPublicKey(old.publicJwk), "name", "before");
  const s2 = await seal(await importPublicKey(now.publicJwk), "name", "after");
  assert.equal(await open(keys, "name", s1), "before");
  assert.equal(await open(keys, "name", s2), "after");
});

test("the public-key import refuses a private key and a wrong kid", async () => {
  const k = await generateVaultKey();
  await assert.rejects(importPublicKey(k.privateJwk), /refusing a private key/);
  await assert.rejects(importPublicKey({ ...k.publicJwk, kid: "0000000000000000" }), /does not match/);
  assert.equal(k.kid, await keyId((await importPublicKey(k.publicJwk)).key));
});

test("nothing is sealed when there is nothing to seal", async () => {
  const k = await fresh();
  await assert.rejects(seal(k.pub, "name", ""), /nothing to seal/);
});

// The one that matters most. A private key in git is in every clone and every
// backup of the repo forever; deleting it later does not unpublish it.
test("no private key is tracked anywhere in the repo", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const offenders = tracked.filter((f) => {
    if (!/\.(json|jwk|pem|key)$/.test(f) || !existsSync(f)) return false;
    const text = readFileSync(f, "utf8");
    return /"d"\s*:/.test(text) || /PRIVATE KEY/.test(text);
  });
  assert.deepEqual(offenders, []);
});

test("site/vault-key.json, once it exists, is a public P-256 key whose kid is right", async () => {
  if (!readdirSync(new URL("../site/", import.meta.url)).includes("vault-key.json")) return;
  const jwk = JSON.parse(readFileSync(new URL("../site/vault-key.json", import.meta.url), "utf8"));
  assert.equal(jwk.crv, "P-256");
  assert.ok(!("d" in jwk));
  await importPublicKey(jwk);
});
