// Checks on every page in site/ as it sits in the repo, which is exactly what gets deployed.
//
// WHAT THIS CANNOT SEE: what Cloudflare serves (the header floor here is the
// file's, not the response's), whether the mailbox the page names exists
// (Email Routing is configured in the dashboard), and whether the Chinese says
// the same thing as the English. It counts that both languages are present,
// pairwise; it cannot read them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../site/${p}`, import.meta.url), "utf8");
const pages = readdirSync(new URL("../site/", import.meta.url)).filter((f) => f.endsWith(".html"));
const headers = read("_headers");

for (const page of pages) {
  const html = read(page);

  test(`${page}: every English string has a Chinese partner`, () => {
    const en = html.match(/class="t" lang="en"/g)?.length ?? 0;
    const zh = html.match(/class="t" lang="zh-CN"/g)?.length ?? 0;
    assert.ok(en > 10, `only ${en} English strings: has the page's markup changed shape?`);
    assert.equal(zh, en, `${en} English strings but ${zh} Chinese`);
  });

  test(`${page}: the only contact address is at the project's own domain`, () => {
    const addrs = new Set(html.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g));
    assert.deepEqual([...addrs], ["hello@feelingthemachine.com"]);
  });

  test(`${page}: no inline script, style block or style attribute (the CSP refuses them)`, () => {
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/);
    assert.doesNotMatch(html, /<style[\s>]/);
    assert.doesNotMatch(html, /\sstyle="/);
    assert.doesNotMatch(html, /\son[a-z]+="/);
  });
}

// The policy's markers, after the portfolio's legal.mjs, which this repo does
// not take yet: an operator, an effective date in both languages, a contact at
// this domain (checked above). WHAT THIS CANNOT SEE: whether the policy is
// TRUE. It is written against protocol/participant-accounts.md and
// data-management.md; change either and re-read the policy by hand.
test("privacy.html names its operator and its effective date in both languages", () => {
  const html = read("privacy.html");
  assert.match(html, /Erick Watson/);
  assert.match(html, /in effect from \d{1,2} \w+ 20\d\d/i);
  assert.match(html, /自20\d\d年\d{1,2}月\d{1,2}日起生效/);
});

test("the home page links the privacy policy", () => {
  assert.match(read("index.html"), /href="\/privacy"/);
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
