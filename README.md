# Feeling the Machine

Administration repo for *Feeling the Machine*, a long-term oral history and research project on how people who build AI experience its growing abilities: awe, threat, and the self.

> **Golden rule: no participant data ever goes in this repo.**
> No names, contact details, recordings, transcripts, signed forms or answers. Those live only in the encrypted vault (see `protocol/data-management.md`). This repo holds the *machinery*: templates, protocols, form versions, scripts, the public website and the task list.

## What's here

| Folder | Contents |
| --- | --- |
| `site/` | The public bilingual website, served by Cloudflare Pages at https://feelingthemachine.com |
| `forms/` | Released versions of consent and release forms (PDF), with a changelog |
| `protocol/` | Oral history themes, data-management rules, the participant-accounts design |
| `templates/` | Blank logs and sheets to copy *into the vault* before filling in |
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

## Day-to-day

- **Tasks:** each timeline step is an issue; close it when its "done when" is met. The Path to a PhD doc's status column mirrors this.
- **Decisions:** open an issue with the *Decision* template, so the reasoning is dated. Summarise it in the vault's decision log too.
- **New interview:** `scripts/new_interview.sh /path/to/vault OH003`.
- **Form changes:** export the PDF to `forms/vX.Y/`, add a line to `forms/CHANGELOG.md`, and record which version each person signed in the vault's consent register.

## Website

`site/` is served as it is, with no build step, by the Cloudflare Pages project `feeling` at https://feelingthemachine.com. A push to `master` runs `npm run check` and then deploys from the same CI job (once the `CLOUDFLARE_API_TOKEN` secret is set). To deploy by hand: `npx wrangler@4.152.0 pages deploy site --project-name=feeling --branch=master`.

Mail to any address at feelingthemachine.com is forwarded to the researcher's own inbox by a Cloudflare Email Routing catch-all (set up 2026-11-20). The page and the privacy policy name `hello@`; routing has to work before either names an address.

Fonts are served from the site itself (no Google), so nothing on the page depends on a service blocked in mainland China. Cloudflare can still be slow from China, so send Chinese participants the PDF information sheet directly as well.
