-- 0019_affiliates.sql — Affiliate program for zepostia, modeled on
-- CryptoBagTracker's (Layla's call, Oct 28 2026): every account gets a
-- referral code; a signup through it credits the referrer a flat $4.44,
-- once, at signup. Payout details (method + 1099 name/address) live on
-- the user row. Payouts are processed quarterly by hand from the owner
-- affiliate report — affiliate_paid_out tracks what has already been
-- paid so the report can show the amount still owed. referral_code
-- stays nullable: accounts that predate this migration get a code
-- generated lazily on their first workspace load; new signups always
-- get one at insert.
ALTER TABLE users ADD COLUMN referral_code TEXT;
ALTER TABLE users ADD COLUMN referred_by TEXT;
ALTER TABLE users ADD COLUMN affiliate_referral_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN affiliate_earnings DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN affiliate_paid_out DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN payout_method TEXT;
ALTER TABLE users ADD COLUMN payout_zelle_info TEXT;
ALTER TABLE users ADD COLUMN payout_tax_name TEXT;
ALTER TABLE users ADD COLUMN payout_tax_address TEXT;

CREATE UNIQUE INDEX idx_users_referral_code ON users (referral_code);
