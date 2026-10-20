-- 0016_setup_bookings.sql — one-time $125 setup-session bookings:
-- Layla's done-with-you setup help, sold from the public Services
-- page and the in-app Billing page. One row per PAID Stripe checkout
-- session, written by the completion webhook and repaired by
-- read-time reconciliation from Stripe, exactly like subscription
-- state. Scheduling happens by email; status starts 'booked'.
CREATE TABLE setup_bookings (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'booked',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_setup_bookings_user ON setup_bookings(user_id, created_at);
