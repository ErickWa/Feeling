// The site's fonts are its own (site/site.css says why). These keep that true.
//
// WHAT THIS CANNOT SEE: whether the woff2 files really contain the characters
// han-chars.txt lists. It trusts scripts/subset_han.sh to have built both from
// the same list; reading a woff2's character map from Node needs a font parser
// this repo does not carry. A rebuilt font that dropped a glyph would pass,
// and the page would fall back to the system serif for that character.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const site = new URL("../site/", import.meta.url);
const read = (p) => readFileSync(new URL(p, site), "utf8");
const pages = readdirSync(site).filter((f) => f.endsWith(".html"));
const css = read("site.css");

// Must match the character class in scripts/subset_han.sh.
const HAN = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef\u201c\u201d\u2018\u2019\u00b7\u2026\u2014]/gu;

test("every Chinese character on a page is in the cut-down Noto Serif SC", () => {
  const have = new Set(read("fonts/han-chars.txt").trim());
  const used = new Set(pages.flatMap((p) => read(p).match(HAN) ?? []));
  const missing = [...used].filter((c) => !have.has(c));
  assert.deepEqual(missing, [], `run scripts/subset_han.sh: ${missing.join("")} not in the font`);
});

test("every @font-face source exists in site/fonts", () => {
  const urls = [...css.matchAll(/url\("(\/fonts\/[^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 9, `only ${urls.length} font files referenced`);
  for (const u of urls) assert.ok(existsSync(new URL(`.${u}`, site)), `${u} is missing`);
});

test("nothing is loaded from another origin", () => {
  assert.doesNotMatch(css, /url\(["']?(https?:)?\/\//, "site.css loads from another origin");
  for (const p of pages) {
    // rel="canonical" names this page's own address; it loads nothing.
    const html = read(p).replace(/<link rel="canonical"[^>]*>/g, "");
    assert.doesNotMatch(html, /<(link|script|img|iframe)\b[^>]*\s(href|src)="(https?:)?\/\//, `${p} loads from another origin`);
  }
});
