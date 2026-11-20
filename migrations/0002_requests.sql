-- Requests the vault must act on: leaving the panel and deleting an account.
-- The site acts at once (a leave is a consent row, a delete removes every
-- row); this table is what remains so the vault export (#27) can do its half
-- within the 14 days the protocol promises, then mark it done.
--
-- No foreign key to participants, on purpose: after a delete this row is all
-- that is left, and it must survive the participant row it names.

CREATE TABLE requests (
  id INTEGER PRIMARY KEY,
  participant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('leave', 'rejoin', 'delete')),
  at TEXT NOT NULL,
  done_at TEXT
);
