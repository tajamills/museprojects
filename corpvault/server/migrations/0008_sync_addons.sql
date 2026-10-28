-- 0008_sync_addons.sql — Bank Sync add-on billing state (Books Phase 2
-- pricing): $8.88/month PER ENTITY, a separate Stripe subscription per
-- business, identified by subscription metadata (addon='bank_sync',
-- entityId). This row mirrors Stripe's state the same way the accounts
-- row mirrors the base plan: the webhook is the primary writer and a
-- throttled read-time reconcile repairs misses. No row (or a canceled
-- one) means sync is off for that business; imported transactions are
-- never touched by add-on state.
CREATE TABLE bk_sync_addons (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT,
  stripe_item_id TEXT,
  status TEXT NOT NULL DEFAULT 'none',
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX bk_sync_addons_entity_idx ON bk_sync_addons (entity_id);
