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
- [x] **A5. Back up the vault** (three copies, two kinds of media, one
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

- [x] **C1. Form 1 final**, EN, ZH and DE (German reviewed by a native speaker). Export the PDFs to `forms/v1.0/` (names
  in `forms/README.md`) and add a line to `forms/CHANGELOG.md`. Give Claude
  the final text: it goes into the consent box on `/account`, and
  `FORM1_VERSION` becomes `1.0`.
- [x] **C2. Chinese review** of every Chinese passage on:
  - `/`: especially sections 03 and 05 and the FAQ
  - `/privacy`: all of it
  - `/account`: every state, plus the sign-in email text in `lib/accounts.js`

  Corrections go to Claude, which applies them and re-cuts the font
  (`scripts/subset_han.sh`).
- [x] **C3. Starting P-number.** The highest P-number already given to email
  sign-ups in the vault, or "none". The site's `next_participant` is set
  above it. "None" (2026-11-22): production already holds
  `next_participant = 1` and no participants, so the site starts at P001.
- [x] **C4. German review** by a native speaker, of every German passage on
  `/`, `/privacy` and `/account` (every state), the German sign-in emails in
  `lib/accounts.js`, and German Forms 1-4 and the invitation email in the
  forms doc. All of it was drafted by Claude on 2026-11-21. Corrections go to
  Claude, which applies them in the same commit as nothing else.
- [x] **C5. Legal review** by a German data-protection lawyer (issue #31):
  the privacy policy's open points and Form 3, point 2.
- [x] **C6. Form 1 v1.1.** v1.0 did not describe web sign-up (it promised a
  phone number, a signature and a file only Erick can read, while the website
  keeps country, kind of work and age band itself). v1.1, drafted 2026-11-22,
  was released the same day after review with no changes. Approve the
  English, have the Chinese and German reviewed as for v1.0, and give Claude
  the corrections: it exports `forms/v1.1/`, adds the changelog line and sets
  `FORM1_VERSION` to `1.1`. Sign-up (D1) opens on v1.1, not v1.0.

## D. Testing in production

- [x] **D1. Soft launch (Claude).** `ACCOUNTS_OPEN = "true"`, `/account`
  still unlinked from the home page; the CI check flips from "must refuse" to
  "must answer".
- [x] **D2. Delivery test.** From real inboxes at **QQ**, **163**, **Gmail**
  and **GMX** (or web.de: the two largest German providers, with their own
  spam filtering), join at `https://feelingthemachine.com/account`, in the
  inbox's language: Chinese for QQ and 163, German for GMX. For each:
  arrived? how long? inbox or spam?
  - [x] QQ
  - [x] 163
  - [x] Gmail
  - [x] GMX or web.de
- [x] **D3. The whole cycle** with one test account: change choices, leave,
  rejoin, download (check the file saves), delete. Keep a second one joined.
- [x] **D4. First vault run**, main vault mounted, outside mainland China.
  The script reads the site, opens the sealed names and emails with the
  vault's private key, writes three CSVs in the vault, and only then tells the
  site to drop its sealed copies. That last step changes production, so the
  dry run comes first.

  1. **Before you start.** Be outside mainland China. Unlock the **main**
     vault in Cryptomator (not the key vault). Check the wrangler login, and
     run `npx wrangler@4.152.0 login` if it says you are not logged in:
     ```
     cd ~/Documents/GitHub/Feeling
     npx wrangler@4.152.0 whoami
     ```
     Save the vault path in a variable. It has a space, so keep the quotes,
     and put no spaces around `=`. It prints nothing when it works, and it
     lasts only for this terminal window: in a new tab, set it again.
     ```
     VAULT="$HOME/Library/Application Support/Cryptomator/mnt/Feeling"
     ls "$VAULT/FeelingTheMachine/07_admin/site-keys" "$VAULT/FeelingTheMachine/07_admin/hmac_key.txt"
     ```
     You should see one `<kid>.private.json` and the `hmac_key.txt` path. If
     either is missing, stop: the path is wrong, or the key vault is mounted.
  2. **Dry run** (changes nothing anywhere; the token comes from your wrangler
     login and is never shown):
     ```
     CLOUDFLARE_API_TOKEN=$(npx wrangler@4.152.0 auth token | tail -n 1) node scripts/export_to_vault.mjs "$VAULT" --dry-run
     ```
     Keep the `| tail -n 1`: wrangler prints its `⛅️ wrangler …` banner on
     the same output as the token, and without it the banner becomes part of
     the token (`Cannot convert argument to a ByteString`).
     A `Proxy environment variables detected` warning above the output is
     harmless: it goes to stderr and never reaches the token.
     It prints `DRY RUN: nothing written…`, then P-numbers and counts only.
     What to expect after D2 and D3:
     - *New in the contact log*: every test account still joined (the D3
       account you kept, plus any D2 inbox accounts you did not delete).
     - *Contact details refreshed*: `none` on a first run.
     - *Consent rows added*: a small number, one per choice saved by the
       accounts still on the site. Deleting an account removes its rows, so
       the deleted one adds none.
     - *Requests handled*: the D3 account's `delete`, and possibly its earlier
       `leave` and `rejoin`.
     - *Would clear sealed values for*: the same P-numbers as "New".

     **Stop and send Claude the output** if you see `NOT COPIED, no vault key
     opens their seal` (the site's key does not match the vault's private
     key), `NOT COPIED, sealed email does not match` (should not happen;
     investigate), or an error such as `already in the contact log with a
     different address` or `D1 query failed`.
  3. **The real run**, the same command without `--dry-run`:
     ```
     CLOUDFLARE_API_TOKEN=$(npx wrangler@4.152.0 auth token | tail -n 1) node scripts/export_to_vault.mjs "$VAULT"
     ```
     It prints
     `Synced.` and the same lists, except the last line now reads "Sealed
     values cleared on the site for".
  4. **Check the vault.** Open
     `"$VAULT/FeelingTheMachine/01_panel/contact-log.csv"` in TextEdit, or in
     Numbers **without saving it back** (Numbers or Excel can rewrite the
     format).
     - Each test P-number has the right name and email, country, role, age
       band, consent choices, form version `1 v1.1` and language.
     - The deleted D3 account does **not** appear.
     - `07_admin/consent-register.csv` has rows starting `site-<n>`;
       `07_admin/withdrawal-log.csv` has one row per leave or delete request.
     - Run the dry run again: `none`, `none`, `0`, `none`. That shows a
       second run changes nothing.
  5. **The hand-work it lists.** The deleted account's line says "remove from
     the key vault and delete any panel emails; confirm in writing". It is a
     test account, so `03_key/key.csv` will not have it: delete the sign-in
     emails from that test inbox; no written confirmation is needed. A leave
     line, if one appears, is the same account: nothing to do. D5 removes the
     test rows from these logs by hand anyway.
  6. **Finish.** Lock the vault in Cryptomator. Give Claude the summary from
     step 3, which holds P-numbers and counts only and can be shared; never
     paste anything from the CSVs. Claude ticks D4.
- [ ] **D5. Clean up.** Delete the remaining test accounts on the site (the
  D3 account you kept, and any D2 inbox accounts still joined), run the
  export again, remove the test rows from the vault's logs by hand.

## E. Go-live (Claude, after the owner's OK)

- [ ] **E1.** Privacy policy: new effective date; section 04 loses "Not open
  yet".
- [ ] **E2.** Home page section 06: from "send an email" to the sign-up link,
  EN, ZH and DE.
- [ ] **E3.** Close #28; the weekly export (#30) starts.

## F. After go-live (Claude)

- [ ] **F1. Enrol in devkit**, as its own change and only once E3 is done:
  not during D–E, because a new gate's first run tends to go red and a red
  gate blocks the deploy a live launch may need in minutes. Take
  `headers.mjs`, `legal.mjs`, `audit.mjs` and `budget.mjs`. Leave out
  `consent.js` (the site has no cookies or adverts to consent to, and the
  privacy policy says so) and `LICENSE` / `COMMERCIAL.md` / the CLA (whether
  this private research repo carries a licence is its own decision). In the
  same change: this repo's entry in devkit's `targets.json`, the "Not yet"
  section of `CLAUDE.md`, and the portfolio's bilingual-repo list in devkit's
  `conventions.md`, which names this repo as EN, ZH and DE.
