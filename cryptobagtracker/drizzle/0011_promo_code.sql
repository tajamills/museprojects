-- 0011_promo_code.sql — automatic promo-code capture (Oct 30, 2026).
-- A visitor who arrives through a promo link (/?promo=YB50) should never
-- have to type the code: the client captures it, signup stores it here,
-- and checkout resolves it against Stripe and pre-applies it (see
-- createCheckoutSession in server/src/actions.ts). The stored code is
-- cleared once the subscription starts or when it stops resolving in
-- Stripe. Generic by design — any active Stripe promotion code works.
ALTER TABLE users ADD COLUMN promo_code TEXT;
