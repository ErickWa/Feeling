#!/usr/bin/env node
// Create the vault's sealing key. The private half is written into the MOUNTED
// encrypted vault and never anywhere else; the public half goes to
// site/vault-key.json, which the sign-up page will publish.
//
// Usage: node scripts/vault_keygen.mjs /path/to/mounted/vault [--rotate]
//
// Run once, after scripts/make_vault.sh. --rotate makes a new key and points
// the site at it; old private keys stay in the vault (one file per kid), so
// whatever they sealed still opens. Back the vault up after either: a lost
// private key means every sealed name and email is gone for good.

import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { generateVaultKey, importPublicKey, open, seal, vaultKeys } from "../site/seal.js";

const [vaultArg, flag] = process.argv.slice(2);
if (!vaultArg || (flag && flag !== "--rotate")) {
  console.error("Usage: node scripts/vault_keygen.mjs /path/to/mounted/vault [--rotate]");
  process.exit(2);
}

const repo = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const root = join(realpathSync(vaultArg), "FeelingTheMachine");
if (root === repo || root.startsWith(repo + sep)) {
  console.error("Refusing: the vault must not be inside the git repo.");
  process.exit(1);
}
if (!existsSync(root)) {
  console.error(`${root} does not exist. Run scripts/make_vault.sh first.`);
  process.exit(1);
}

const publicPath = join(repo, "site", "vault-key.json");
if (existsSync(publicPath) && !flag) {
  const { kid } = JSON.parse(readFileSync(publicPath, "utf8"));
  console.error(`site/vault-key.json already holds key ${kid}. Pass --rotate to replace it.`);
  process.exit(1);
}

const { kid, publicJwk, privateJwk } = await generateVaultKey();
const keyDir = join(root, "07_admin", "site-keys");
mkdirSync(keyDir, { recursive: true });
const privatePath = join(keyDir, `${kid}.private.json`);
writeFileSync(privatePath, JSON.stringify(privateJwk, null, 2) + "\n", { flag: "wx", mode: 0o600 });

// Prove the pair works before the site ever publishes the public half.
const check = "试 test Ω";
const sealed = await seal(await importPublicKey(publicJwk), "selftest", check);
if ((await open(await vaultKeys([privateJwk]), "selftest", sealed)) !== check) {
  console.error("Self-test failed: the new key pair does not round-trip. Nothing published.");
  process.exit(1);
}

const { kty, crv, x, y } = publicJwk;
writeFileSync(publicPath, JSON.stringify({ kty, crv, x, y, kid, created: new Date().toISOString().slice(0, 10) }, null, 2) + "\n");

console.log(`Key ${kid}`);
console.log(`  private: ${privatePath}  (vault only; back the vault up now)`);
console.log(`  public:  site/vault-key.json  (commit this)`);
