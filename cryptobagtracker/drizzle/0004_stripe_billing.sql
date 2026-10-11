-- 0004_stripe_billing.sql — Stripe billing fields on users.
-- subscription_status values: none | trialing | active | past_due | canceled
-- (plus any other raw Stripe subscription status the webhook reports).
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN current_period_end TIMESTAMPTZ;
