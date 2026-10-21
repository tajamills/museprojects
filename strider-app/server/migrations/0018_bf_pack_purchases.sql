-- 0018_bf_pack_purchases.sql — paid purchases of the Black Friday
-- confirmation-page tripwire: the one-time $8.88 "90 Plug-and-Post
-- Captions" pack. One row per PAID Stripe checkout session, written
-- by the completion webhook AND by the pack page's read-time
-- verification (reconcile from Stripe on read — a purchase must
-- never depend on the webhook alone). The buyer needs no zepostia
-- account, so there is no user_id: the email Stripe collected is
-- the identity. Download access is granted only after the server
-- re-reads the checkout session from Stripe and sees it paid.
CREATE TABLE bf_pack_purchases (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'paid',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_bf_pack_purchases_created ON bf_pack_purchases(created_at);
