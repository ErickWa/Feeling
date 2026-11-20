// Checks on site/ as it sits in the repo, which is exactly what gets deployed.
//
// WHAT THIS CANNOT SEE: what Cloudflare serves (the header floor here is the
// file's, not the response's), whether the mailbox the page names exists
// (Email Routing is configured in the dashboard), and whether the Chinese says
// the same thing as the English. It counts that both languages are present,
// pairwise; it cannot read them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../site/${p}`, import.meta.url), "utf8");
const html = read("index.html");
const headers = read("_headers");

test("every English string has a Chinese partner", () => {
  const en = html.match(/class="t" lang="en"/g)?.length ?? 0;
  const zh = html.match(/class="t" lang="zh-CN"/g)?.length ?? 0;
  assert.ok(en > 20, `only ${en} English strings: has the page's markup changed shape?`);
  assert.equal(zh, en, `${en} English strings but ${zh} Chinese`);
});

test("the contact address is at the project's own domain", () => {
  const addrs = new Set(html.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g));
  assert.deepEqual([...addrs], ["hello@feelingthemachine.com"]);
});

test("no inline script, style block or style attribute (the CSP refuses them)", () => {
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/);
  assert.doesNotMatch(html, /<style[\s>]/);
  assert.doesNotMatch(html, /\sstyle="/);
  assert.doesNotMatch(html, /\son[a-z]+="/);
});

test("_headers declares the portfolio floor in one /* rule", () => {
  const rules = headers.split("\n").filter((l) => /^\S/.test(l) && !l.startsWith("#"));
  assert.deepEqual(rules, ["/*"], "exactly one rule per path, and only /*");
  const csp = headers.match(/^\s+Content-Security-Policy: (.+)$/m)?.[1] ?? "";
  assert.match(headers, /^\s+X-Content-Type-Options: nosniff$/m);
  assert.match(headers, /^\s+Strict-Transport-Security: max-age=[1-9]\d{6,}/m);
  assert.match(headers, /^\s+Referrer-Policy: \S+/m);
  assert.ok(/^\s+X-Frame-Options: DENY$/m.test(headers) || /frame-ancestors 'none'/.test(csp), "framing refused");
  assert.match(csp, /base-uri /);
  assert.match(csp, /form-action /);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
});
