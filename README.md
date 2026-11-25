# Feeling the Machine

*Feeling the Machine* (感受机器) is a long-term oral history and research project on how people who build AI experience its growing abilities: awe, threat, and the self. This repository holds its public website, [feelingthemachine.com](https://feelingthemachine.com), the participant-accounts system behind it, and the project's protocols, forms and templates. It is run by Erick Watson as an independent researcher.

> **Golden rule: no participant data ever goes in this repo.**
> No names, contact details, recordings, transcripts, signed forms or answers. Those live only in an encrypted, offline vault (see `protocol/data-management.md`). This repo holds the *machinery*: templates, protocols, form versions, scripts and the public website.

## Why the code is public

The site asks people for their name and email address, and promises that it cannot read either: both are encrypted in the participant's own browser with the vault's public key before they are sent, and only the offline vault holds the key that opens them. Publishing the code lets anyone check that promise rather than take it on trust.

- **The sealing** happens in [`site/seal.js`](site/seal.js), called from [`site/account.js`](site/account.js). The public key it seals to is [`site/vault-key.json`](site/vault-key.json).
- **The server** ([`lib/api.js`](lib/api.js), [`lib/accounts.js`](lib/accounts.js)) stores the sealed values and a keyed one-way fingerprint of the email address, never the address. The test named "THE PROMISE" in [`tests/accounts.test.mjs`](tests/accounts.test.mjs) turns red if a change makes a name or email readable in the database.
- **What is live is what is here.** `site/` is deployed byte for byte, with no build step, by the same CI job that runs the tests ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)); that job then confirms production serves this commit's `index.html` before it passes. You can compare any file yourself, for example `curl -s https://feelingthemachine.com/seal.js | diff - site/seal.js`.

What this cannot show you: that the deployed Functions are this commit (they deploy in the same step, but nothing public fetches them back), or anything about the offline vault, which is by design not on the internet.

## Licensing

- **Code** is under the [Apache License 2.0](LICENSE).
- **Research and documentation materials** (`protocol/`, `forms/`, `templates/`, `docs/` and the Markdown files) are under [CC BY 4.0](LICENSE-CC-BY-4.0).
- **Not covered by either:** six tooling files delivered from a separate proprietary repository, the self-hosted fonts (SIL OFL 1.1), and the project's name and logo. [NOTICE](NOTICE) lists them and says how to attribute.

You are welcome to reuse the consent forms, the sealing design or anything else here for your own research. A copy must not present itself as this project or collect anyone's details in its name.

## Reporting a problem

- **A security issue:** please report it privately through GitHub's [private vulnerability reporting](../../security/advisories/new), or write to hello@feelingthemachine.com. See [SECURITY.md](SECURITY.md).
- **Anything else:** open an issue. **Never put personal information in an issue**, yours or anyone else's. If you are a participant, write to hello@feelingthemachine.com instead.

## What's here

| Folder | Contents |
| --- | --- |
| `site/` | The public website, in English, Chinese and German, served by Cloudflare Pages at https://feelingthemachine.com |
| `functions/`, `lib/`, `migrations/` | The participant-accounts API (Cloudflare Pages Functions over a D1 database) |
| `forms/` | Released versions of consent and release forms (PDF), with a changelog |
| `protocol/` | Oral history themes, data-management rules, the participant-accounts design, and the research references behind the framing |
| `templates/` | Blank logs and sheets to copy *into the vault* before filling in, and invitation drafts |
| `docs/` | `GO-LIVE.md`, the checklist that opened participant accounts |
| `scripts/` | Vault setup, the vault export, and new-interview folders |
| `tests/` | The checks behind `npm run check` |
| `.github/` | CI, and issue templates for tasks and decisions |

The project's planning documents (methods guide, timeline, interview guide drafts) are kept outside this repository; released versions of anything participants see are exported here.

## Running it

`npm run check` is the whole gate: lint, the tests, then budget, licence and dependency checks. It needs Node and nothing else; there is no build.

To run the accounts locally, with sign-in links printed instead of emailed:

1. Make a throwaway vault key in a scratch copy, never this repo's `site/`: `node scripts/vault_keygen.mjs /path/to/scratch-vault`.
2. Create `.dev.vars` (gitignored) with `ACCOUNTS_OPEN=true`, `VAULT_KID=<kid>`, `HMAC_KEY=<anything>`, `MAIL_MODE=console`.
3. `npx wrangler@4.152.0 d1 migrations apply feeling --local`, then `npx wrangler@4.152.0 pages dev`.

`MAIL_MODE=console` is refused anywhere but localhost.

## Operating notes (for the researcher)

**First-time setup**, done once:

1. Create the encrypted vault (Cryptomator or VeraCrypt), then run `scripts/make_vault.sh /path/to/mounted/vault`.
2. Create the site's sealing key: `node scripts/vault_keygen.mjs /path/to/mounted/vault`. The private key goes into the vault; commit the `site/vault-key.json` it writes. Back the vault up straight afterwards: without that private key, nothing participants seal on the site can ever be read.

**Day-to-day:**

- **Tasks:** each timeline step is an issue; close it when its "done when" is met.
- **Decisions:** open an issue with the *Decision* template, so the reasoning is dated. Summarise it in the vault's decision log too.
- **New interview:** `scripts/new_interview.sh /path/to/vault OH003`.
- **Website sign-ups:** weekly, `CLOUDFLARE_API_TOKEN=<token with D1 access> node scripts/export_to_vault.mjs /path/to/vault --dry-run`, then again without `--dry-run`. It prints IDs only, never names.
- **Form changes:** export the PDF to `forms/vX.Y/`, add a line to `forms/CHANGELOG.md`, and record which version each person signed in the vault's consent register.

**Website:** a push to `master` runs `npm run check` and then deploys from the same CI job. To deploy by hand: `npx wrangler@4.152.0 pages deploy site --project-name=feeling --branch=master`. Mail to any address at feelingthemachine.com is forwarded to the researcher's inbox by Cloudflare Email Routing; the pages name `hello@`, and routing has to work before a page names an address. Fonts are served from the site itself, so nothing depends on a service blocked in mainland China.
