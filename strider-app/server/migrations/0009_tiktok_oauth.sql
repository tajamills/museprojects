-- 0009_tiktok_oauth.sql — Real TikTok OAuth connections.
--
-- TikTok uses Login Kit (OAuth 2.0) + Content Posting API. One owner TikTok
-- app covers the whole site (TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET env);
-- per-user tokens live here.
--
-- TikTok access tokens expire after ~24h; the refresh token (~365d) is used
-- for transparent refresh. Both are stored AES-256-GCM encrypted (see
-- TOKEN_ENCRYPTION_KEY). Raw tokens are never stored in plaintext.
-- expires_at tracks access token expiry so publish can refresh proactively.

CREATE TABLE IF NOT EXISTS tiktok_connections (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tiktok_open_id TEXT NOT NULL,
  tiktok_display_name TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
