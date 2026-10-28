-- 0007_bank_connections.sql — Phase 2 bookkeeping: optional Plaid bank
-- connections for Books (read-only Transactions + balances).
-- bk_transactions gains external_id (the Plaid transaction_id) with a
-- partial unique index per entity so re-syncs dedupe instead of
-- duplicating, and pending transactions can be updated in place when
-- they post. Manual and CSV rows keep external_id NULL and are untouched
-- by the index.
ALTER TABLE bk_transactions ADD COLUMN IF NOT EXISTS external_id TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX bk_transactions_external_idx ON bk_transactions (entity_id, external_id) WHERE external_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE bk_bank_connections (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  plaid_item_id TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  institution_name TEXT,
  accounts_json TEXT,
  transactions_cursor TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX bk_bank_connections_active_entity_idx ON bk_bank_connections (entity_id) WHERE status = 'active';
