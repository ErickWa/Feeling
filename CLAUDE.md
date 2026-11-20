# Feeling the Machine: standing rules

This file overrides the portfolio conventions (`~/.claude/CLAUDE.md`) for this
repo. Where it is silent, those apply.

## What this is

The administration repo for *Feeling the Machine* (感受机器), Erick's long-term
oral history and research project on how people who build AI experience its
growing abilities. It holds the machinery (protocols, form versions, templates,
vault scripts, the task list as GitHub issues) and the public site in `site/`,
served at **https://feelingthemachine.com** by the Cloudflare Pages project
`feeling`. The living planning documents are Claude artifacts linked from
`README.md`; they are the source of truth and this repo receives frozen exports.

## Invariants

1. **No participant data, ever.** No names, contact details, recordings,
   transcripts, signed forms or answers, in a file, a commit, an issue, a log
   or a test fixture. They live in the encrypted vault (`protocol/data-management.md`).
   `.gitignore` is a safety net, not the rule.
2. **Bilingual: EN and ZH move together.** Every user-facing string on the
   site is a pair of `<span class="t" lang="en">` / `lang="zh-CN"`; changing
   one changes the other in the same commit. The test counts the pairs; it
   cannot read them, so Chinese wording that matters goes to a native Chinese reviewer for
   review, as the forms do.
3. **No inline script or style.** The CSP has no `'unsafe-inline'`; behaviour
   goes in `site/site.js`, styling in `site/site.css`.
4. **The site holds nothing it can read back about who someone is.**
   Participant accounts (`protocol/participant-accounts.md`, decided
   2026-11-20) seal name and email in the browser with the vault's public key;
   the private key never leaves the vault. No analytics, and nothing loaded
   from another origin: fonts are self-hosted in `site/fonts/`. Cloudflare is
   the only company in the loop, and the privacy policy at `/privacy` says
   exactly what it sees; change what the site does and that page changes in
   the same commit.
5. **Chinese text changes need the font re-cut.** `scripts/subset_han.sh`
   rebuilds Noto Serif SC from the pages; `tests/fonts.test.mjs` fails until
   you run it.
6. **Released forms are never edited.** A change is a new `forms/vX.Y/`.

## Accounts code

`lib/accounts.js` holds the rules (pure functions), `lib/api.js` the wiring,
`functions/api/` one-line routes, `migrations/` the D1 schema, `site/seal.js`
the sealing used by both `site/account.js` and the vault scripts. The
privacy promise has its own test (`tests/accounts.test.mjs`, "THE PROMISE"):
any change that makes a name or email readable in the database turns it red.

## Not yet

Not enrolled in devkit (`targets.json`), so none of the shared gates
(`budget`, `smoke`, `headers`, `legal`, `audit`) run here; `npm run check` is
lint plus the tests in `tests/`. The portfolio's bilingual-repo list does not
name this repo yet either.
