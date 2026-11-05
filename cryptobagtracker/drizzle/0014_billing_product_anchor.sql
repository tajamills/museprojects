-- 0014_billing_product_anchor.sql — billing redo (Nov 5, 2026).
-- Billing now anchors plan state to the CryptoBagTracker plan price
-- (STRIPE_PRICE_ID): subscriptions for the owner's other products on the
-- shared Stripe account never write a user row, and a subscription that
-- is set to cancel at period end must render as "ends <date>", not as a
-- renewal. That needs the cancel flag stored next to the status.
ALTER TABLE users ADD COLUMN subscription_cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;
