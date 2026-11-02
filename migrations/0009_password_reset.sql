-- 0009_password_reset.sql: one-time codes for the "quên mật khẩu" flow.
-- Additive and safely applicable BEFORE the code that uses it is deployed.
--
-- A reset code is emailed to the address on the user's profile (users.email, added by a
-- separate migration). Only a PBKDF2 hash of the 6-digit code is stored, never the code
-- itself: a database read cannot yield a usable code. The code is single use (used_at), and
-- a new request deletes the user's previous outstanding rows.
--
-- datastore-class: aggregate
CREATE TABLE password_reset_codes (
  id         TEXT PRIMARY KEY,       -- UUID v4 of this request
  user_id    TEXT NOT NULL REFERENCES users(id),
  code_hash  TEXT NOT NULL,          -- PBKDF2-SHA256 of the 6-digit code (lib/auth.ts#hashPassword)
  code_salt  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,  -- wrong guesses; at 5 the code is invalidated
  expires_at TEXT NOT NULL,          -- created_at + 10 minutes
  used_at    TEXT,                   -- single-use marker; also set when the attempt cap is hit
  created_at TEXT NOT NULL
);

-- The verify path reads exactly one row: the user's newest. A new request deletes the user's
-- older rows first, so this index keeps that read and delete keyed on user_id.
CREATE INDEX IF NOT EXISTS idx_password_reset_codes_user
  ON password_reset_codes(user_id, created_at DESC);
