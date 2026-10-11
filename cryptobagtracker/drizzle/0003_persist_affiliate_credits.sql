-- 0003_persist_affiliate_credits.sql (Postgres port of the original SQLite migration)
ALTER TABLE users ADD COLUMN affiliate_referral_count INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN affiliate_earnings DOUBLE PRECISION NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Backfill credits for referrals that happened before these columns existed.
-- Users with no referrals keep the DEFAULT 0 values from the ADD COLUMN above.
WITH counts AS (
  SELECT referred_by, COUNT(*) AS cnt
  FROM users
  WHERE referred_by IS NOT NULL
  GROUP BY referred_by
)
UPDATE users AS u
SET affiliate_referral_count = counts.cnt,
    affiliate_earnings = ROUND(counts.cnt * 4.44, 2)
FROM counts
WHERE counts.referred_by = u.referral_code;
