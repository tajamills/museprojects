-- 0005_alert_delivery.sql — fields for real price-alert delivery.
-- telegram_chat_id: the user's Telegram chat id (they find it via @userinfobot).
-- last_triggered_at: cooldown bookkeeping so a still-crossed alert doesn't
-- re-fire every scheduler tick.
ALTER TABLE alert_settings ADD COLUMN telegram_chat_id TEXT;
--> statement-breakpoint
ALTER TABLE price_alerts ADD COLUMN last_triggered_at TIMESTAMPTZ;
