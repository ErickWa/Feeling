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
   needs a native speaker's review too: the German was drafted by Claude and
   has had none. **A consent row's `lang` is the record of which text the
   person agreed to**, so sign-up may not open in a language whose Form 1 is
   not released: today that holds because accounts are closed and Form 1
   v1.0 is unreleased in all three.
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

## Not yet

Not enrolled in devkit (`targets.json`), so none of the shared gates
(`budget`, `smoke`, `headers`, `legal`, `audit`) run here; `npm run check` is
lint plus the tests in `tests/`. The portfolio's bilingual-repo list does not
name this repo yet either.
