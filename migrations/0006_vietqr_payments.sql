-- 0006_vietqr_payments.sql: per-member bank details (VietQR) and settlement payments.
-- Apply AFTER 0005 and BEFORE deploying the code that selects these columns.

-- The receiving account a member's transfers are paid into. The three columns are either all
-- set (a usable account) or all NULL (no bank info); a partial set reads as "no bank info".
ALTER TABLE group_members ADD COLUMN bank_bin TEXT;
ALTER TABLE group_members ADD COLUMN bank_account_no TEXT;
ALTER TABLE group_members ADD COLUMN bank_account_name TEXT;

-- 'expense' is a shared cost, 'payment' is a settlement transfer recorded as an ordinary
-- paid/share row. Existing rows are all expenses. Immutable after creation.
ALTER TABLE expenses ADD COLUMN kind TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense', 'payment'));
