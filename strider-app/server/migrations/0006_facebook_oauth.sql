-- 0006_facebook_oauth.sql — Real Facebook OAuth state + connections.
--
-- oauth_states holds single-use CSRF states for the OAuth callback.
-- facebook_connections holds the long-lived user token and the selected
-- Page's token, both AES-256-GCM encrypted (see TOKEN_ENCRYPTION_KEY).
-- Raw tokens are never stored in plaintext.

CREATE TABLE IF NOT EXISTS oauth_states (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  state TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON oauth_states(state);

CREATE TABLE IF NOT EXISTS facebook_connections (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  fb_user_id TEXT NOT NULL,
  user_token_encrypted TEXT NOT NULL,
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  page_token_encrypted TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
