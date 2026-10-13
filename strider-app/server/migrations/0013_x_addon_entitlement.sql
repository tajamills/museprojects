-- 0013_x_addon_entitlement.sql — X (Twitter) posting add-on: tiered,
-- capped entitlement + usage metering.
--
-- x_addon_tier_price_id mirrors the Stripe subscription: it holds the
-- price ID of the X add-on tier item currently on the workspace's
-- subscription (tiers are defined by the STRIPE_X_TIERS env config), or
-- NULL when the subscription carries no X tier. The webhook (and the
-- add/switch/remove actions) recompute it from Stripe state on every
-- subscription change; it is never toggled by hand.
--
-- current_period_start mirrors the subscription alongside the existing
-- current_period_end so X usage can be anchored to the billing period.
--
-- x_addon_usage holds the workspace's X counters for its CURRENT
-- billing period only (plain posts vs posts with links — X bills the
-- two differently). When the stored period no longer matches the
-- subscription's current period, the counters read as zero and the
-- next recorded post rewrites the row for the new period.
ALTER TABLE users ADD COLUMN x_addon_tier_price_id TEXT;
ALTER TABLE users ADD COLUMN current_period_start TIMESTAMPTZ;

CREATE TABLE x_addon_usage (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  posts_used INTEGER NOT NULL DEFAULT 0,
  link_posts_used INTEGER NOT NULL DEFAULT 0
);
