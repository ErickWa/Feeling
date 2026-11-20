# Participant accounts (design, v0.1, 2026-11-20)

Self-service sign-up, consent and preferences on feelingthemachine.com.
Decided by Erick on 2026-11-20 (see the Decision issue "Participant accounts").

## The five decisions

1. **E-consent replaces the emailed, signed Form 1.** A candidate can be sent
   to the website and join the panel without any other step.
2. **People in China may register themselves**, with a separate cross-border
   consent.
3. **Names are collected, and exist in readable form only in the vault.** The
   site assigns each person an ID and knows them only by it.
4. **The vault is the record.** The site's database is a front door that is
   copied into the vault and pruned.
5. **The site's promise changes now**: participants own their record, and the
   project is a conduit into the formal study.

## The principle, and what it costs

The website must hold nothing it can read back about who someone is. Name and
email address are **encrypted in the participant's browser** with the vault's
public key before they are sent. The matching private key lives only inside
the encrypted vault. A full compromise of the site, Cloudflare account
included, yields IDs, choices and ciphertext.

What that costs, stated so nobody mistakes it for more:

- **The site cannot email anyone on its own initiative.** Panel updates,
  reminders and the written withdrawal confirmation go out from Erick, using
  addresses decrypted in the vault. The site only sends a sign-in link, to an
  address the person has just typed.
- **Lose the private key and the names are gone.** It is backed up under the
  data-management rule (three copies, two media, one off-site), like everything
  else in the vault.
- **Pseudonymous is not anonymous.** An ID with its choices is still personal
  data under GDPR and PIPL, and the privacy policy says so.

What Cloudflare can still see, and the policy must say: the plaintext email
for the moment a sign-in link is requested (TLS ends at Cloudflare, and it
sends the mail), and visitors' IP addresses in its logs.

## How it works

**Joining** (two steps, so nobody can sign up someone else's address)

1. The visitor types an email address. The browser seals it (encrypts to the
   vault key) and sends both the plaintext and the sealed copy. The server
   computes `HMAC(email)` with a server secret, stores the sealed copy and the
   HMAC against a one-time token, emails the link, and drops the plaintext.
   The response is the same whether or not the address is already registered.
2. The link opens the consent page: Form 1's released text in the chosen
   language, the choices (oral history, future studies, updates, preferred
   language), country, and the cross-border consent box for China. The name
   is sealed in the browser. On submit the server creates the participant with
   the next ID (P001, P002 ... as in the vault) and shows it to them.

**Signing in**: email, then a link. The server HMACs the address to find the
account and never stores the plaintext. No passwords.

**What a participant can do once signed in**

- See their ID, every choice and the full consent history (form, version,
  language, date).
- Change any choice. Each change is a new consent row, never an edit.
- Download everything the site holds about them as JSON.
- Withdraw, with Form 4's options, or delete their account. Deletion removes
  their rows at once and leaves a tombstone (ID, request, date; nothing else)
  so the vault export can act on it within the 14 days the protocol promises.

They cannot see their own name or email echoed back, because the site cannot
read them. A request for what the vault holds goes to Erick, who answers from
the vault.

**Built (#26)**: `POST /api/choices` (a new consent row; leaving zeroes every
interest and logs a `leave` request; rejoining needs the agreement again, and
the cross-border consent again in mainland China, and is recorded against the
current form version), `POST /api/delete` (every row about the person goes at
once, leaving a `delete` request), and `GET /api/me`, which returns every
column the site holds, sealed values included, and is what the download
saves. The `requests` table (`migrations/0002_requests.sql`) is the vault's
to-do list; #27 marks each one done.

**Into the vault**: `scripts/export_to_vault.mjs`, run by Erick with the vault
mounted. It pulls new rows with a read-only token, decrypts sealed fields with
the vault's private key, writes `contact-log.csv`, `consent-register.csv` and
`withdrawal-log.csv`, acts on tombstones, then deletes from the site whatever
the vault now holds that the site no longer needs (sealed fields and processed
tombstones). Like `make_vault.sh`, it refuses to write inside this repo.

## Shape

- Cloudflare Pages Functions (the site stays static) and a D1 database.
  Sign-in links sent with Cloudflare Email Sending from a no-reply address at
  this domain.
- Encryption with WebCrypto's ECDH P-256 + HKDF + AES-GCM, which every browser
  at the portfolio floor (Safari 16.4, Chrome 111) has. X25519 would be nicer
  but is not at the floor. `site/seal.js` is the one implementation, imported
  by the page to seal and by the vault scripts to open; the field name is bound
  in, so a sealed email cannot be opened as a name. Tested in
  `tests/seal.test.mjs`; a Chrome-made seal was opened in Node on 2026-11-20.
  Safari is untried.
- The key: `scripts/vault_keygen.mjs` writes the private half to
  `07_admin/site-keys/<kid>.private.json` in the vault and the public half to
  `site/vault-key.json`. Rotation keeps old private keys, so old seals open.
- Session cookie: `HttpOnly; Secure; SameSite=Lax`, short-lived. Sign-in
  tokens are single-use and stored only as hashes.
- Rate limits per IP and per address HMAC on the two email-sending endpoints.
- No analytics, no third-party scripts. The CSP gains `connect-src 'self'`
  and `form-action 'self'` and nothing else.
- Nothing logs a request body.

## Before it goes live

- `hello@feelingthemachine.com` routing works (the policy names it).
- A privacy policy, EN and ZH, at this domain, describing exactly the above.
- Forms v1.0 frozen, Chinese reviewed: e-consent shows the released text and
  records its version.
- Sign-in mail tested end to end with QQ, 163 and Gmail inboxes, because
  Chinese providers often filter this kind of mail.
- `curl -sI` against production after the CSP change.
