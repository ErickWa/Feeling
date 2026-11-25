// Checks on every page in site/ as it sits in the repo, which is exactly what gets deployed.
//
// WHAT THIS CANNOT SEE: what Cloudflare serves (the header floor here is the
// file's, not the response's), whether the mailbox the page names exists
// (Email Routing is configured in the dashboard), and whether the Chinese or
// German says the same thing as the English. It counts that every language is
// present, string for string; it cannot read them. Nor can it see what a link
// preview looks like: Slack, LinkedIn and WeChat each crop and cache og.png
// their own way.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../site/${p}`, import.meta.url), "utf8");
const pages = readdirSync(new URL("../site/", import.meta.url)).filter((f) => f.endsWith(".html"));
const headers = read("_headers");

for (const page of pages) {
  const html = read(page);

  test(`${page}: every English string has a Chinese partner, and a German one where German is offered`, () => {
    const count = (tag) => html.match(new RegExp(`class="t" lang="${tag}"`, "g"))?.length ?? 0;
    const en = count("en");
    assert.ok(en > 10, `only ${en} English strings: has the page's markup changed shape?`);
    assert.equal(count("zh-CN"), en, `${en} English strings but ${count("zh-CN")} Chinese`);
    // All or nothing: a half-German page would show blanks where strings are missing.
    const de = count("de");
    const offered = html.includes('id="lang-de"');
    assert.equal(de, offered ? en : 0, offered ? `${en} English strings but ${de} German` : "German strings on a page with no German button");
  });

  test(`${page}: the link preview names this page and an image that exists`, () => {
    const meta = (prop) => html.match(new RegExp(`<meta property="${prop}" content="([^"]+)">`))?.[1];
    assert.equal(meta("og:url"), html.match(/<link rel="canonical" href="([^"]+)">/)?.[1]);
    const image = meta("og:image") ?? "";
    assert.match(image, /^https:\/\/feelingthemachine\.com\//);
    assert.ok(existsSync(new URL(`../site/${image.slice(image.lastIndexOf("/") + 1)}`, import.meta.url)), `${image} is not in site/`);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  });

  test(`${page}: a tab title and a search description in every language`, () => {
    for (const l of ["zh", "de"]) assert.match(html, new RegExp(`<html[^>]* data-title-${l}="[^"]+"`), `no ${l} title`);
    const description = html.match(/<meta name="description" content="([^"]+)">/)?.[1] ?? "";
    assert.match(description, /\p{Script=Han}/u, "no Chinese in the description");
    assert.match(description, /\b(Sie|Ihre[nr]?|die|und)\b/, "no German in the description");
  });

  test(`${page}: every icon it links is in site/`, () => {
    const icons = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)" href="\/([^"]+)"/g)].map((m) => m[1]);
    assert.ok(icons.length >= 2, "no favicon linked");
    for (const f of icons) assert.ok(existsSync(new URL(`../site/${f}`, import.meta.url)), `${f} is missing`);
  });

  // A version DOI goes stale the day the next protocol version is published;
  // the all-versions DOI always resolves to the latest. WHAT THIS CANNOT SEE:
  // a Zenodo link written as a zenodo.org/records/ URL rather than a DOI.
  test(`${page}: any Zenodo DOI is the protocol's all-versions DOI`, () => {
    const dois = new Set(html.match(/10\.5281\/zenodo\.\d+/g));
    for (const d of dois) assert.equal(d, "10.5281/zenodo.24525240", `${d} is one version, not all of them`);
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
test("privacy.html names its operator and its effective date in all three languages", () => {
  const html = read("privacy.html");
  assert.match(html, /Erick Watson/);
  assert.match(html, /effective from \d{1,2} \w+ 20\d\d/i);
  assert.match(html, /自20\d\d年\d{1,2}月\d{1,2}日起生效/);
  assert.match(html, /gültig ab \d{1,2}\. \S+ 20\d\d/i);
});

test("the sitemap lists exactly the pages that may be indexed, and robots.txt points to it", () => {
  const path = (p) => (p === "index.html" ? "/" : `/${p.replace(/\.html$/, "")}`);
  const indexable = pages.filter((p) => !read(p).includes('<meta name="robots" content="noindex">')).map(path).sort();
  const listed = [...read("sitemap.xml").matchAll(/<loc>https:\/\/feelingthemachine\.com(\/[^<]*)<\/loc>/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed, indexable);
  assert.match(read("robots.txt"), /^Sitemap: https:\/\/feelingthemachine\.com\/sitemap\.xml$/m);
});

test("the home page links the privacy policy", () => {
  assert.match(read("index.html"), /href="\/privacy"/);
});

test("_headers declares the portfolio floor in its /* rule, one rule per path", () => {
  const rules = headers.split("\n").filter((l) => /^\S/.test(l) && !l.startsWith("#"));
  assert.equal(new Set(rules).size, rules.length, "two rules for one path: Pages keeps only one");
  assert.ok(rules.includes("/*"), "the floor lives in the /* rule");
  const floor = headers.slice(headers.indexOf("\n/*\n"));
  const csp = floor.match(/^\s+Content-Security-Policy: (.+)$/m)?.[1] ?? "";
  assert.match(floor, /^\s+X-Content-Type-Options: nosniff$/m);
  assert.match(floor, /^\s+Strict-Transport-Security: max-age=[1-9]\d{6,}/m);
  assert.match(floor, /^\s+Referrer-Policy: \S+/m);
  assert.ok(/^\s+X-Frame-Options: DENY$/m.test(floor) || /frame-ancestors 'none'/.test(csp), "framing refused");
  assert.match(csp, /base-uri /);
  assert.match(csp, /form-action /);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
});

// RFC 9116. Scanners treat a security.txt past its Expires as absent, so this
// goes red on the day it lapses rather than leaving a stale file looking fine;
// renew it by moving Expires on, at most a year ahead as the RFC recommends.
// WHAT THIS CANNOT SEE: whether Pages serves the dot-directory (check
// `curl -s https://feelingthemachine.com/.well-known/security.txt`), or
// whether anyone reads hello@.
test("security.txt names this domain's contact and has not expired", () => {
  const txt = read(".well-known/security.txt");
  assert.match(txt, /^Contact: mailto:hello@feelingthemachine\.com$/m);
  assert.match(txt, /^Canonical: https:\/\/feelingthemachine\.com\/\.well-known\/security\.txt$/m);
  const expires = Date.parse(txt.match(/^Expires: (\S+)$/m)?.[1] ?? "");
  assert.ok(expires > Date.now(), "security.txt has expired: move Expires on");
  assert.ok(expires - Date.now() <= 366 * 864e5, "Expires is more than a year ahead");
});
