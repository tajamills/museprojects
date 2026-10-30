-- 0010_subscription_entitlement.sql — subscription enforcement (Oct 30, 2026).
-- Until now nothing in the app checked whether anyone paid: the 7-day
-- trial never locked and the full product worked free forever. The server
-- now gates every mutating action and the alert engine on entitlement
-- (server/src/entitlement.ts): comped OR a live Stripe subscription
-- (reconciled from Stripe on read) OR still inside the 7-day signup trial.
-- comped: owner/comp accounts that never lock and are never charged.
ALTER TABLE users ADD COLUMN comped BOOLEAN NOT NULL DEFAULT false;
--> statement-breakpoint
-- The owner's account is comped. Keyed by email and safe to re-run: this
-- only ever sets the flag on that one account.
UPDATE users SET comped = true WHERE lower(email) = 'tmills142009@gmail.com';
