-- 0009_user_email.sql: a recovery email becomes a USER's profile field.
--
-- The address belongs to the account holder and is written only by its owner
-- (PUT /api/profile/email). It is the recovery channel for a forgotten password: a reset flow
-- may send mail TO it, but nothing in the API returns it for anyone other than that user.
--
-- NULLABLE with no default: an account without an email is normal.
--
-- ONE address per account, and one account per address. The column is COLLATE NOCASE because an
-- address is case-insensitive (the API already lowercases on write, so this is the guarantee
-- that a value arriving by another path still cannot alias an existing one), and the unique index
-- is PARTIAL because NULL means "not set yet": in SQL every NULL compares distinct, so an
-- unconditional unique index would technically allow them, but a partial index states that
-- intent in the schema and keeps the index to the rows that actually carry an address.
ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL;
