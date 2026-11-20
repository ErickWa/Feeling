-- The site's database (D1 `feeling`). protocol/participant-accounts.md is the why.
--
-- NOTHING HERE IS A READABLE IDENTITY. Names and emails arrive sealed in the
-- browser (site/seal.js) and only the vault can open them; an address is found
-- again by `email_hmac`, a keyed one-way fingerprint whose key is a Pages
-- secret. Country, role type and age band are plaintext because the panel's
-- choices need them; the privacy policy says so. Sealed columns are nullable
-- because the vault export (#27) prunes them once the vault holds them.

CREATE TABLE participants (
  id TEXT PRIMARY KEY,                 -- P001, P002 ... as in the vault
  email_hmac TEXT NOT NULL UNIQUE,
  sealed_email TEXT,
  sealed_name TEXT,
  lang TEXT NOT NULL,
  country TEXT NOT NULL,               -- 'US', 'CN' (mainland China) or 'XX' (elsewhere)
  role TEXT NOT NULL,
  age_band TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Append-only: a change of mind is a new row, never an edit.
CREATE TABLE consents (
  id INTEGER PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants (id),
  form TEXT NOT NULL,
  form_version TEXT NOT NULL,
  lang TEXT NOT NULL,
  panel INTEGER NOT NULL,
  oral_history INTEGER NOT NULL,
  future_studies INTEGER NOT NULL,
  updates INTEGER NOT NULL,
  cross_border INTEGER,                -- NULL unless the participant is in mainland China
  at TEXT NOT NULL
);

-- One-use links, stored only as SHA-256 hashes, so a database read cannot
-- sign anybody in. `sealed_email` rides on a join token until the join finishes.
CREATE TABLE tokens (
  hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('join', 'signin')),
  email_hmac TEXT NOT NULL,
  sealed_email TEXT,
  lang TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  hash TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants (id),
  expires_at INTEGER NOT NULL
);

-- Hourly counters for the email-sending endpoint, keyed by HMACs of the
-- address and of the IP, never the values themselves.
CREATE TABLE rate (
  key TEXT NOT NULL,
  win INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (key, win)
);

-- `next_participant` must start above the highest P-number the vault already
-- holds from email sign-ups. Check it at go-live (#28).
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO meta (key, value) VALUES ('next_participant', 1);
