-- 0007_user_bank_profile.sql: the receiving bank account becomes a USER's profile field.
-- EXPAND step: apply this BEFORE deploying the code that selects these columns.
-- Apply order: 0007 (before deploy) -> deploy the new code -> 0008_drop_member_bank.sql.
--
-- The account is the account owner's, not a group member's: only that signed-in user may edit
-- it (PUT /api/profile/bank), and a member row linked to them renders it. The three columns are
-- either all set (a usable account) or all NULL (no bank profile), exactly as the old member
-- columns were.
--
-- No data is copied from group_members: any active member could PATCH anyone's account there,
-- so those values are untrusted and must be re-entered by their owner. 0008 drops them.
ALTER TABLE users ADD COLUMN bank_bin TEXT;
ALTER TABLE users ADD COLUMN bank_account_no TEXT;
ALTER TABLE users ADD COLUMN bank_account_name TEXT;
