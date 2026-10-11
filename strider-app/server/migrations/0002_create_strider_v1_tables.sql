-- Converted from the original SQLite 0002_create_strider_v1_tables.sql:
-- INTEGER PRIMARY KEY AUTOINCREMENT -> GENERATED ALWAYS AS IDENTITY,
-- epoch-millisecond INTEGER timestamps -> TIMESTAMPTZ, BOOLEAN for flags.
CREATE TABLE users (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  demo_mode BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE sessions (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE platform_configs (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  client_id TEXT NOT NULL,
  secret_reference TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, platform)
);

CREATE TABLE connected_accounts (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  status TEXT NOT NULL,
  auth_mode TEXT NOT NULL,
  token_hint TEXT,
  retry_after TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, platform)
);

CREATE TABLE posts (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  youtube_title TEXT,
  media_blob_key TEXT,
  media_name TEXT,
  media_type TEXT,
  publish_mode TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE post_targets (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  remote_id TEXT,
  published_at TIMESTAMPTZ,
  UNIQUE(post_id, account_id)
);

CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_posts_user_created ON posts(user_id, created_at DESC);
CREATE INDEX idx_posts_user_scheduled ON posts(user_id, scheduled_at);
DROP TABLE entries;
