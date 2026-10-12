-- 0009_x_oauth.sql — Real X (Twitter) OAuth 2.0 + PKCE connections.
--
-- One X app owned by the site owner serves all customers (X_CLIENT_ID /
-- X_CLIENT_SECRET env vars). Customers never create an X app.
--
-- x_connections holds the access + refresh tokens (AES-256-GCM encrypted,
-- see TOKEN_ENCRYPTION_KEY) plus the authorizing X user. Raw tokens are
-- never stored in plaintext. X access tokens live ~2 hours, so expires_at
-- drives the refresh-before-publish logic in publish.ts.
--
-- The code_verifier column on oauth_states supports PKCE flows (X): the
-- verifier generated at authorize time is stored with the single-use CSRF
-- state and sent back to X at token exchange.

CREATE TABLE IF NOT EXISTS x_connections (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  x_user_id TEXT NOT NULL,
  x_username TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS code_verifier TEXT;
