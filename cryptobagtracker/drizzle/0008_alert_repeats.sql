-- 0008_alert_repeats.sql — episode bookkeeping so a triggered alert keeps
-- re-notifying while price stays in its trigger zone, instead of going
-- silent under the old flat 24h cooldown.
-- episode_started_at: when the current trigger episode began (null = armed,
-- no open episode). last_notified_price: price at the most recent
-- notification; the step re-fire measures further movement from here.
ALTER TABLE price_alerts ADD COLUMN episode_started_at TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE price_alerts ADD COLUMN last_notified_price DOUBLE PRECISION;
