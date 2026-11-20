// `npm run lint`, the first and cheapest step of `check`. The fleet shape:
// `js.configs.recommended`, no stylistic rules, environments declared per file.
//
// site/site.js is a classic script served raw to a visitor's browser, so it
// gets browser globals and nothing from Node: `process` there is a lint error.
// WHAT THIS CANNOT SEE: scripts/*.sh, and any script that creeps back inline
// into site/index.html (the CSP refuses that one at runtime instead).

import js from "@eslint/js";

export default [
  { ignores: ["node_modules/**"] },
  js.configs.recommended,
  {
    name: "feeling/browser",
    files: ["site/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { document: "readonly", navigator: "readonly", localStorage: "readonly" },
    },
  },
  {
    name: "feeling/node",
    files: ["*.mjs", "tests/**/*.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { URL: "readonly" } },
  },
];
