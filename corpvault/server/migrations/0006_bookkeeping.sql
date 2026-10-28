-- 0006_bookkeeping.sql — Phase 1 bookkeeping for kovala.
-- Books are scoped PER ENTITY (and per account): the categories and
-- transactions of one business never mix with another's. Amounts are
-- integer cents; direction carries the sign (in | out) so a row is never
-- negative. Dates are TEXT 'YYYY-MM-DD' like every other date column in
-- this schema. Categories seed lazily per entity on first use (see the
-- books actions) — this migration only creates the tables.
CREATE TABLE bk_categories (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE bk_transactions (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  txn_date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  direction TEXT NOT NULL,
  category_id INTEGER REFERENCES bk_categories(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'cleared',
  receipt_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX bk_categories_entity_idx ON bk_categories (entity_id);
--> statement-breakpoint
CREATE INDEX bk_transactions_entity_idx ON bk_transactions (entity_id, txn_date);
