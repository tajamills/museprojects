-- 0002_crypto_portfolio_core.sql (Postgres port of the original SQLite migration)
--
-- Type mapping notes (SQLite -> Postgres):
--   INTEGER PRIMARY KEY AUTOINCREMENT -> INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY
--   INTEGER storing millisecond epoch timestamps -> TIMESTAMPTZ
--     (SQLite INTEGER is 64-bit; Postgres INTEGER is 32-bit and would overflow
--      millisecond timestamps, so timestamps move to a native timestamp type)
--   INTEGER used as boolean (mode "boolean") -> BOOLEAN
--   REAL -> DOUBLE PRECISION
--   TEXT -> TEXT (unchanged)
DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE users (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  referral_code TEXT NOT NULL UNIQUE,
  referred_by TEXT,
  cost_basis_method TEXT NOT NULL DEFAULT 'FIFO',
  trial_started_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
--> statement-breakpoint
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
--> statement-breakpoint
CREATE TABLE wallets (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  owned BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL
);
--> statement-breakpoint
CREATE TABLE exchange_connections (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'configured',
  created_at TIMESTAMPTZ NOT NULL
);
--> statement-breakpoint
CREATE TABLE transactions (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  classification TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  price_usd DOUBLE PRECISION NOT NULL,
  fee_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  received_asset TEXT,
  received_amount DOUBLE PRECISION,
  received_price_usd DOUBLE PRECISION,
  from_wallet_id INTEGER,
  to_wallet_id INTEGER,
  note TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
--> statement-breakpoint
CREATE TABLE alert_settings (
  user_id INTEGER PRIMARY KEY,
  telegram_hint TEXT,
  phone_hint TEXT,
  push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL
);
--> statement-breakpoint
CREATE TABLE price_alerts (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL,
  asset TEXT NOT NULL,
  direction TEXT NOT NULL,
  target_price DOUBLE PRECISION NOT NULL,
  channels TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL
);
--> statement-breakpoint
CREATE TABLE alert_history (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL,
  alert_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  delivered_at TIMESTAMPTZ NOT NULL
);
--> statement-breakpoint
CREATE INDEX wallets_user_idx ON wallets(user_id);
--> statement-breakpoint
CREATE INDEX transactions_user_time_idx ON transactions(user_id, occurred_at);
--> statement-breakpoint
CREATE INDEX alerts_user_idx ON price_alerts(user_id);
