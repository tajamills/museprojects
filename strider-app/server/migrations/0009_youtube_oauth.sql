-- 0009_youtube_oauth.sql — Real YouTube OAuth connections.
--
-- YouTube publishing goes through the YouTube Data API v3 resumable upload
-- flow and requires a video file plus a title. The owner's Google Cloud
-- OAuth client (YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET) covers every
-- customer; per-user tokens live encrypted here.
--
-- youtube_connections holds the access token and refresh token (AES-256-GCM
-- encrypted, see TOKEN_ENCRYPTION_KEY) plus the channel the user picked at
-- connect time. Raw tokens are never stored in plaintext.

CREATE TABLE IF NOT EXISTS youtube_connections (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
