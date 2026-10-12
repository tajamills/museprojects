-- 0007_exchange_sync.sql
-- Real exchange sync: encrypted API credentials on connections, plus sync
-- bookkeeping (last sync time / last error), and an external id on
-- transactions so re-syncs can dedupe instead of double-importing.
ALTER TABLE exchange_connections ADD COLUMN api_key_enc TEXT;
--> statement-breakpoint
ALTER TABLE exchange_connections ADD COLUMN api_secret_enc TEXT;
--> statement-breakpoint
ALTER TABLE exchange_connections ADD COLUMN last_synced_at TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE exchange_connections ADD COLUMN sync_error TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN external_id TEXT;
--> statement-breakpoint
CREATE INDEX transactions_user_external_id_idx ON transactions (user_id, external_id) WHERE external_id IS NOT NULL;
