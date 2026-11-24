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
2. **EN, ZH and DE move together.** Every user-facing string on the site is
   a `<span class="t" lang="en">` / `lang="zh-CN"` / `lang="de"` triple
   (German added 2026-11-21, on every page). Changing one changes the others
   in the same commit, and so do the sign-in emails in `lib/accounts.js`. The
   test counts them, all or nothing per page; it cannot read them, so Chinese
   wording that matters goes to a native Chinese reviewer for review, as the forms do, and
   German wording that matters (above all the privacy policy and Form 1)
   needs a native speaker's review too. The German was drafted by Claude and
   reviewed by a native speaker on 2026-11-22 (GO-LIVE C4); text added since
   then has not been. **A consent row's `lang` is the record of which text the
   person agreed to**, so sign-up may not open in a language whose Form 1 is
   not released. Form 1 v1.0 was released in all three on 2026-11-22; v1.1, which
   matches the website, the same day after review; sign-up opens on v1.1.
3. **No inline script or style.** The CSP has no `'unsafe-inline'`; behaviour
   goes in `site/site.js`, styling in `site/site.css`.
4. **The site holds nothing it can read back about who someone is.**
   Participant accounts (`protocol/participant-accounts.md`, decided
   2026-11-20) seal name and email in the browser with the vault's public key;
   the private key never leaves the vault. No analytics, and nothing loaded
   from another origin: fonts are self-hosted in `site/fonts/`. Cloudflare
   (hosting, database, mail) and Proton (the mailbox panel mail is forwarded
   to) are the only companies in the loop, and the privacy policy at
   `/privacy` names both and says exactly what they see; change what the site
   does, or where mail goes, and that page changes in the same commit. Until
   2026-11-21 this line said Cloudflare alone, and so did the policy: the
   forwarding target's MX records were the only place Proton appeared.
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

## Shared gates

Enrolled in devkit on 2026-11-24 (GO-LIVE F1). `npm run check` is lint, the
tests in `tests/`, then devkit's `budget`, `legal` and `audit`, configured in
`budget.json` and `legal.json`; each config says what its rows cannot see.
`scripts/headers.mjs` is delivered too and runs in CI after the deploy, never
in `check`. The delivered files are listed in `devkit.files.json`: never edit
them here; change them in devkit and run `npm run sync` there. Not taken, each
argued in devkit's `targets.json`: `consent.js` (nothing here needs consent),
`smoke`, `coverage`, and a licence (its own decision). The portfolio's
conventions name this repo as shipping EN, ZH and DE, and bind it to the
security-header floor.
