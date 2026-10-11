-- Stripe billing columns on accounts. $199/year plan, charged immediately
-- at checkout (no trial). Mirrors the CryptoBagTracker billing columns.
ALTER TABLE accounts ADD COLUMN stripe_customer_id TEXT;
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN stripe_subscription_id TEXT;
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN current_period_end TIMESTAMPTZ;
