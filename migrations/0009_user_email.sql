-- 0009_user_email.sql: a recovery email becomes a USER's profile field.
--
-- The address belongs to the account holder and is written only by its owner
-- (PUT /api/profile/email). It is the recovery channel for a forgotten password: a reset flow
-- may send mail TO it, but nothing in the API returns it for anyone other than that user.
--
-- NULLABLE with no default (an account without an email is normal) and NOT UNIQUE: two accounts
-- may legitimately share one address, and a reset that matches several accounts is a problem the
-- reset flow must handle on its own, not a constraint violation here.
ALTER TABLE users ADD COLUMN email TEXT;
