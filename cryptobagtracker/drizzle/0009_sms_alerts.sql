-- 0009_sms_alerts.sql — real per-customer SMS alerts, phase 1 (built Oct 27,
-- 2026; spec: ~/workspace/audits/cbt-real-sms-spec-oct27.md). Everything here
-- sits behind the SMS_ALERTS_ENABLED flag (default OFF): with the flag off
-- these columns are never read or written and the product behaves exactly
-- as before.
-- phone_number_enc: the customer's FULL phone number (E.164), AES-256-GCM
-- encrypted via server/src/crypto.ts (the EXCHANGE_ENC_KEY scheme already
-- used for exchange credentials). phone_hint remains the display-only
-- last-4 mask; the plaintext number is never stored.
-- sms_consent_at: TCPA opt-in record — when the customer ticked the SMS
-- consent box while saving their number. sms_opted_out / sms_opted_out_at:
-- set by the Twilio inbound webhook on STOP (cleared on START or on a
-- fresh consented save).
ALTER TABLE alert_settings ADD COLUMN phone_number_enc TEXT;
--> statement-breakpoint
ALTER TABLE alert_settings ADD COLUMN sms_consent_at TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE alert_settings ADD COLUMN sms_opted_out BOOLEAN NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE alert_settings ADD COLUMN sms_opted_out_at TIMESTAMPTZ;
--> statement-breakpoint
-- sms_sends: one row per attempted provider send (sent / failed / capped).
-- Doubles as the consent+delivery audit trail and the source for the
-- per-user monthly cap counter in server/src/alerts.ts.
CREATE TABLE sms_sends (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL,
  alert_id INTEGER NOT NULL,
  provider_sid TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX sms_sends_user_created_idx ON sms_sends (user_id, created_at);
