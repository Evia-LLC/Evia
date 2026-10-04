-- P1-T04 — separate operator-managed shared products from user-owned submissions.
--
-- owner_id NULL means the row is part of the shared/operator catalogue, including
-- every historical row: ownership is never guessed after the fact. A non-null
-- owner_id means the row belongs to exactly one user and is visible only to
-- that user (plus, for deletion, to the account-deletion path).
--
-- The user FK cascades so deleting an account removes that account's owned
-- products (and, through products(id), their usage rows) while shared rows
-- survive. Usage rows also cascade from users(id), so a user's routine goes
-- with the account either way.

ALTER TABLE products ADD COLUMN IF NOT EXISTS owner_id TEXT NULL REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_products_owner ON products(owner_id);
