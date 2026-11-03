CREATE TABLE IF NOT EXISTS watch_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reported_case_under_review',
  public_enabled BOOLEAN NOT NULL DEFAULT false,
  monitoring_enabled BOOLEAN NOT NULL DEFAULT false,
  alerts_enabled BOOLEAN NOT NULL DEFAULT false,
  is_test BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS watch_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS watch_case_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES watch_cases(id),
  claim_key TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  display_label TEXT NOT NULL,
  display_value TEXT NOT NULL,
  numeric_value NUMERIC,
  currency_or_asset TEXT,
  source_id UUID NOT NULL REFERENCES watch_sources(id),
  source_locator TEXT NOT NULL DEFAULT '',
  as_of_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'current',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, claim_key)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS watch_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES watch_cases(id),
  chain TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'mainnet',
  address TEXT NOT NULL,
  address_key TEXT NOT NULL,
  display_address TEXT NOT NULL,
  list_section TEXT NOT NULL DEFAULT 'reported',
  role_text TEXT,
  role_source_id UUID REFERENCES watch_sources(id),
  status TEXT NOT NULL DEFAULT 'reported_not_yet_checked',
  anchor_priority BOOLEAN NOT NULL DEFAULT false,
  frozen_state TEXT,
  baseline_status TEXT NOT NULL DEFAULT 'pending',
  baseline_height BIGINT,
  baseline_observed_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_successful_check_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  is_test BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, chain, network, address_key)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS watch_addresses_case_idx ON watch_addresses (case_id, list_section, chain);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS watch_address_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address_id UUID NOT NULL REFERENCES watch_addresses(id),
  source_id UUID NOT NULL REFERENCES watch_sources(id),
  source_locator TEXT NOT NULL DEFAULT '',
  reported_role_text TEXT,
  reported_snapshot_text TEXT,
  match_method TEXT NOT NULL DEFAULT 'full_string',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (address_id, source_id, source_locator)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS watch_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES watch_cases(id),
  seed_version TEXT NOT NULL,
  seed_sha256 TEXT NOT NULL,
  mode TEXT NOT NULL,
  report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS watch_address_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address_id UUID NOT NULL REFERENCES watch_addresses(id),
  provider_name TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  block_height BIGINT,
  native_balance_raw TEXT,
  native_balance_decimal TEXT,
  raw_payload_hash TEXT,
  is_baseline BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS watch_snapshots_address_idx ON watch_address_snapshots (address_id, observed_at DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS watch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES watch_cases(id),
  chain TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'mainnet',
  tx_hash TEXT NOT NULL,
  transaction_group_key TEXT NOT NULL,
  event_index TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisional',
  from_address_id UUID REFERENCES watch_addresses(id),
  to_address_id UUID REFERENCES watch_addresses(id),
  external_from_address TEXT,
  external_to_address TEXT,
  asset_symbol TEXT NOT NULL,
  asset_contract TEXT,
  amount_raw TEXT NOT NULL,
  amount_decimal NUMERIC NOT NULL,
  usd_value_at_event NUMERIC,
  price_source TEXT,
  price_observed_at TIMESTAMPTZ,
  block_height BIGINT,
  chain_observed_at TIMESTAMPTZ,
  confirmations INTEGER,
  is_anchor_event BOOLEAN NOT NULL DEFAULT false,
  severity TEXT NOT NULL DEFAULT 'low',
  public_note TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  public_visible_from TIMESTAMPTZ,
  retracted_at TIMESTAMPTZ,
  retraction_reason TEXT,
  provider_payload_hash TEXT,
  is_test BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS watch_events_idem_reported_idx
  ON watch_events (chain, network, tx_hash, event_index, from_address_id, event_kind)
  WHERE from_address_id IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS watch_events_idem_victim_idx
  ON watch_events (chain, network, tx_hash, event_index, to_address_id, event_kind)
  WHERE to_address_id IS NOT NULL AND from_address_id IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS watch_events_public_idx ON watch_events (case_id, status, public_visible_from);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS watch_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id),
  case_id UUID NOT NULL REFERENCES watch_cases(id),
  min_severity TEXT NOT NULL DEFAULT 'medium',
  telegram_enabled BOOLEAN NOT NULL DEFAULT true,
  in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  test_expires_at TIMESTAMPTZ,
  is_test BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, case_id)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS watch_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES watch_events(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  provider_message_id TEXT,
  failure_reason TEXT,
  is_internal BOOLEAN NOT NULL DEFAULT false,
  is_test BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id, channel)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS watch_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES watch_cases(id),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  source_id UUID REFERENCES watch_sources(id),
  corrected_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS watch_admin_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  before_json JSONB,
  after_json JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS watch_bounty_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES watch_cases(id),
  target TEXT NOT NULL,
  checked_by TEXT NOT NULL,
  method TEXT NOT NULL,
  result_summary TEXT NOT NULL,
  source_url TEXT,
  public_status_changed BOOLEAN NOT NULL DEFAULT false,
  approved_by TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_check_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

INSERT INTO watch_cases (slug, title, summary, status)
VALUES (
  'binance-hot-wallet-breach-2026',
  'Binance Hot-Wallet Breach — October 2026',
  'In late October 2026, funds were reported moved out of Binance hot wallets across multiple blockchains. Independent investigators published lists of addresses they reported as connected to the incident. This page collects those reported addresses in one place, shows the freeze and coverage figures exactly as each source reported them, and records confirmed on-chain movement after our monitoring began. Inclusion on this page means only that an address was reported in a cited source. It is not a finding of ownership, control, or wrongdoing.',
  'reported_case_under_review'
)
ON CONFLICT (slug) DO NOTHING;
