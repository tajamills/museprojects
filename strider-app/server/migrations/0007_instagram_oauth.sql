-- 0007_instagram_oauth.sql — Real Instagram OAuth connections.
--
-- Instagram publishing goes through the Instagram Graph API and requires the
-- Instagram professional (business/creator) account to be connected to a
-- Facebook Page the user manages. The same Meta app as Facebook covers it.
--
-- instagram_connections holds the long-lived user token (AES-256-GCM
-- encrypted, see TOKEN_ENCRYPTION_KEY) plus the selected IG business
-- account and the Page it is linked through. Raw tokens are never stored
-- in plaintext.

CREATE TABLE IF NOT EXISTS instagram_connections (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  ig_user_id TEXT NOT NULL,
  ig_username TEXT NOT NULL,
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  user_token_encrypted TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
