# Go-live checklist: participant accounts

The steps between "built and closed" and "open to participants" (#28).
Written 2026-11-21. Tick each box in the commit that completes it.

Parts A–C can run in parallel once A1–A3 are done. Never paste a token,
password or secret into a chat, an issue or this file.

## A. The vault (outside mainland China)

- [x] **A1. Create two encrypted vaults** (Cryptomator or VeraCrypt): the
  **main vault** (e.g. `FeelingTheMachine`) and the **key vault** with a
  different password, for `03_key/key.csv` (ID to name). Store them only
  where nothing syncs to a device that goes to Xi'an (decision #29).
- [x] **A2. Lay out the folders**, from the repo folder, main vault mounted:
  ```
  scripts/make_vault.sh /path/to/mounted/vault
  ```
- [x] **A3. Create the site's sealing key:**
  ```
  node scripts/vault_keygen.mjs /path/to/mounted/vault
  ```
  Run it with `node`, not `bash` or `sudo`. The path is the **main** vault's
  mount point (Cryptomator: `~/Library/Application Support/Cryptomator/mnt/<vault>`),
  never the key vault, and it must hold the `FeelingTheMachine` folder that A2
  made, under exactly that name. It prints `Key <kid>`. Don't commit `site/vault-key.json` yourself; tell
  Claude "key done" (it commits the file and sets `VAULT_KID` in
  `wrangler.toml`).
- [x] **A4. Create the fingerprint secret**, written to the vault and to
  Cloudflare without being shown (run `npx wrangler@4.152.0 login` first if
  asked):
  ```
  openssl rand -base64 48 | tee /path/to/mounted/vault/FeelingTheMachine/07_admin/hmac_key.txt | npx wrangler@4.152.0 pages secret put HMAC_KEY --project-name=feeling
  ```
- [ ] **A5. Back up the vault** (three copies, two kinds of media, one
  off-site, none in mainland China). From here on, losing the vault loses
  every name participants have sealed.

## B. Email sending (Cloudflare dashboard)

- [x] **B1. Plan.** Workers & Pages → Plans: Email Sending needs **Workers
  Paid** ($5/month, 3,000 emails included).
- [x] **B2. Onboard the sending domain.** Compute → Email Service → Email
  Sending → **Onboard Domain** → `feelingthemachine.com`. Cloudflare adds DNS
  records under `cf-bounce`, and a DMARC record with `p=reject` (the domain
  has none). The inbound catch-all keeps working. Wait until it shows as
  verified (usually 5–15 minutes).
- [x] **B3. Sending token.** My Profile → API Tokens → Create Token → Start
  from scratch → Account policy, scoped to your account, permission **Email
  Sending: Edit** only, named "feeling mail (Pages Function)". Copy it, then
  paste it when asked:
  ```
  npx wrangler@4.152.0 pages secret put MAIL_TOKEN --project-name=feeling
  ```

## C. Content

- [ ] **C1. Form 1 final**, EN, ZH and DE (German reviewed by a native speaker). Export the PDFs to `forms/v1.0/` (names
  in `forms/README.md`) and add a line to `forms/CHANGELOG.md`. Give Claude
  the final text: it goes into the consent box on `/account`, and
  `FORM1_VERSION` becomes `1.0`.
- [ ] **C2. Chinese review** of every Chinese passage on:
  - `/`: especially sections 03 and 05 and the FAQ
  - `/privacy`: all of it
  - `/account`: every state, plus the sign-in email text in `lib/accounts.js`

  Corrections go to Claude, which applies them and re-cuts the font
  (`scripts/subset_han.sh`).
- [ ] **C3. Starting P-number.** The highest P-number already given to email
  sign-ups in the vault, or "none". The site's `next_participant` is set
  above it.
- [ ] **C4. German review** by a native speaker, of every German passage on
  `/`, `/privacy` and `/account` (every state), the German sign-in emails in
  `lib/accounts.js`, and German Forms 1-4 and the invitation email in the
  forms doc. All of it was drafted by Claude on 2026-11-21. Corrections go to
  Claude, which applies them in the same commit as nothing else.
- [ ] **C5. Legal review** by a German data-protection lawyer (issue #31):
  the privacy policy's open points and Form 3, point 2.

## D. Testing in production

- [ ] **D1. Soft launch (Claude).** `ACCOUNTS_OPEN = "true"`, `/account`
  still unlinked from the home page; the CI check flips from "must refuse" to
  "must answer".
- [ ] **D2. Delivery test.** From real inboxes at **QQ**, **163**, **Gmail**
  and **GMX** (or web.de: the two largest German providers, with their own
  spam filtering), join at `https://feelingthemachine.com/account`, in the
  inbox's language: Chinese for QQ and 163, German for GMX. For each:
  arrived? how long? inbox or spam?
  - [ ] QQ
  - [ ] 163
  - [ ] Gmail
  - [ ] GMX or web.de
- [ ] **D3. The whole cycle** with one test account: change choices, leave,
  rejoin, download (check the file saves), delete. Keep a second one joined.
- [ ] **D4. First vault run**, main vault mounted, outside mainland China:
  ```
  CLOUDFLARE_API_TOKEN=$(npx wrangler@4.152.0 auth token) node scripts/export_to_vault.mjs /path/to/mounted/vault --dry-run
  ```
  then again without `--dry-run`. Check the test person's name and email in
  `01_panel/contact-log.csv`; do the hand-work it lists. The printed summary
  holds IDs only and can be shared.
- [ ] **D5. Clean up.** Delete the remaining test account on the site, run
  the export again, remove the test rows from the vault's logs by hand.

## E. Go-live (Claude, after the owner's OK)

- [ ] **E1.** Privacy policy: new effective date; section 04 loses "Not open
  yet".
- [ ] **E2.** Home page section 06: from "send an email" to the sign-up link,
  EN and ZH.
- [ ] **E3.** Close #28; the weekly export (#30) starts.
