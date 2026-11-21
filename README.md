# Feeling the Machine

Administration repo for *Feeling the Machine*, a long-term oral history and research project on how people who build AI experience its growing abilities: awe, threat, and the self.

> **Golden rule: no participant data ever goes in this repo.**
> No names, contact details, recordings, transcripts, signed forms or answers. Those live only in the encrypted vault (see `protocol/data-management.md`). This repo holds the *machinery*: templates, protocols, form versions, scripts, the public website and the task list.

## What's here

| Folder | Contents |
| --- | --- |
| `site/` | The public website (EN and ZH; DE on the home and privacy pages), served by Cloudflare Pages at https://feelingthemachine.com |
| `forms/` | Released versions of consent and release forms (PDF), with a changelog |
| `protocol/` | Oral history themes, data-management rules, the participant-accounts design |
| `templates/` | Blank logs and sheets to copy *into the vault* before filling in |
| `docs/` | `GO-LIVE.md`, the checklist for opening participant accounts |
| `scripts/` | Vault setup and new-interview folders |
| `tests/` | The site checks behind `npm run check` |
| `.github/` | Issue templates for tasks and decisions |

## Living documents (source of truth)

These are edited in Claude and exported here when a version is frozen:

- Groundwork Methods Guide: https://claude.ai/artifact/GHjKfAETLh5Tt1E8E2cq2R
- Consent and Release Forms: https://claude.ai/artifact/WSJRn9X7Jt5RJUFxh1VfnF
- Path to a PhD (timeline and logistics): https://claude.ai/artifact/9aZuNovJptEGnjB1V3rqVY
- Thesis: https://claude.ai/artifact/L9Mu1YPqp8uXwMoYovYnQT
- Pilot Interview Guide: https://claude.ai/artifact/7EN6erdFi6qNQHNEJ4b8bT

## First-time setup

Done on 2026-11-20: the repo, the labels, milestones and timeline issues, the Pages project and the domain. What is left:

1. Create your encrypted vault (Cryptomator or VeraCrypt), then run `scripts/make_vault.sh /path/to/mounted/vault`.
2. Create the site's sealing key: `node scripts/vault_keygen.mjs /path/to/mounted/vault`. The private key goes to `07_admin/site-keys/` in the vault; commit the `site/vault-key.json` it writes. Back the vault up straight afterwards: without that private key, nothing participants seal on the site can ever be read.

## Day-to-day

- **Tasks:** each timeline step is an issue; close it when its "done when" is met. The Path to a PhD doc's status column mirrors this.
- **Decisions:** open an issue with the *Decision* template, so the reasoning is dated. Summarise it in the vault's decision log too.
- **New interview:** `scripts/new_interview.sh /path/to/vault OH003`.
- **Website sign-ups:** weekly, `CLOUDFLARE_API_TOKEN=$(npx wrangler@4.152.0 auth token) node scripts/export_to_vault.mjs /path/to/vault --dry-run`, then again without `--dry-run`. It prints IDs only, never names.
- **Form changes:** export the PDF to `forms/vX.Y/`, add a line to `forms/CHANGELOG.md`, and record which version each person signed in the vault's consent register.

## Website

`site/` is served as it is, with no build step, by the Cloudflare Pages project `feeling` at https://feelingthemachine.com. A push to `master` runs `npm run check` and then deploys from the same CI job (once the `CLOUDFLARE_API_TOKEN` secret is set). To deploy by hand: `npx wrangler@4.152.0 pages deploy site --project-name=feeling --branch=master`.

Mail to any address at feelingthemachine.com is forwarded to the researcher's own inbox by a Cloudflare Email Routing catch-all (set up 2026-11-20). The page and the privacy policy name `hello@`; routing has to work before either names an address.

Fonts are served from the site itself (no Google), so nothing on the page depends on a service blocked in mainland China. Cloudflare can still be slow from China, so send Chinese participants the PDF information sheet directly as well.

## Participant accounts (behind a switch until go-live)

`functions/api/` routes into `lib/api.js`; the rules are in `lib/accounts.js`; the schema is `migrations/`; the page is `site/account.html`. Every `/api` route answers 503 until `ACCOUNTS_OPEN` in `wrangler.toml` is `"true"` (go-live, #28), and CI checks that production still refuses.

To run it locally, with links printed instead of emailed:

1. Make a throwaway vault key in a scratch copy, never this repo's `site/` (or use the real one once it exists).
2. Create `.dev.vars` (gitignored) with `ACCOUNTS_OPEN=true`, `VAULT_KID=<kid>`, `HMAC_KEY=<anything>`, `MAIL_MODE=console`.
3. `npx wrangler@4.152.0 d1 migrations apply feeling --local`, then `npx wrangler@4.152.0 pages dev`.

`MAIL_MODE=console` is refused anywhere but localhost.
