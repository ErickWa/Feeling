// `npm run lint`, the first and cheapest step of `check`. The fleet shape:
// `js.configs.recommended`, no stylistic rules, environments declared per file.
//
// site/site.js is a classic script served raw to a visitor's browser, so it
// gets browser globals and nothing from Node: `process` there is a lint error.
// WHAT THIS CANNOT SEE: scripts/*.sh, and any script that creeps back inline
// into site/index.html (the CSP refuses that one at runtime instead).

import js from "@eslint/js";

export default [
  { ignores: ["node_modules/**", ".wrangler/**"] },
  js.configs.recommended,
  {
    name: "feeling/browser",
    files: ["site/site.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { document: "readonly", navigator: "readonly", localStorage: "readonly" },
    },
  },
  {
    // seal.js is imported by the account page AND by the vault scripts in
    // Node, so it may use only globals both have.
    name: "feeling/seal",
    files: ["site/seal.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { crypto: "readonly", btoa: "readonly", atob: "readonly", TextEncoder: "readonly", TextDecoder: "readonly" },
    },
  },
  {
    // account.js is a browser module (top-level await is at the floor).
    name: "feeling/account",
    files: ["site/account.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { document: "readonly", location: "readonly", history: "readonly", fetch: "readonly", URL: "readonly", Blob: "readonly", setTimeout: "readonly" },
    },
  },
  {
    // Pages Functions and the logic they call run on the Workers runtime:
    // fetch and WebCrypto are there, `process` is not.
    name: "feeling/worker",
    files: ["functions/**/*.js", "lib/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { crypto: "readonly", btoa: "readonly", fetch: "readonly", Response: "readonly", URL: "readonly", TextEncoder: "readonly", console: "readonly" },
    },
  },
  {
    name: "feeling/node",
    files: ["*.mjs", "tests/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { URL: "readonly", process: "readonly", console: "readonly", Request: "readonly" } },
  },
];
