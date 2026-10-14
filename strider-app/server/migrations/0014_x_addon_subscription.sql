-- 0014_x_addon_subscription.sql — X (Twitter) posting add-on: the tier
-- gets its own Stripe subscription so it can bill from day one even
-- while the base plan is on its free trial (a single shared
-- subscription would trial — or bill — both items together).
--
-- stripe_x_addon_subscription_id records the workspace's add-on
-- subscription (metadata-marked in Stripe); x_addon_period_start/end
-- mirror that subscription's tier-item billing period so X usage
-- counters anchor to the tier's own cycle. All three are synced from
-- Stripe only. Legacy workspaces whose tier rides as an item on the
-- base subscription keep working: sync falls back to the base period.
ALTER TABLE users ADD COLUMN stripe_x_addon_subscription_id TEXT;
ALTER TABLE users ADD COLUMN x_addon_period_start TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN x_addon_period_end TIMESTAMPTZ;
