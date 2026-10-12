-- 0006_affiliate_payout_info.sql
ALTER TABLE users ADD COLUMN payout_method TEXT;
ALTER TABLE users ADD COLUMN payout_zelle_info TEXT;
ALTER TABLE users ADD COLUMN payout_tax_name TEXT;
ALTER TABLE users ADD COLUMN payout_tax_address TEXT;
