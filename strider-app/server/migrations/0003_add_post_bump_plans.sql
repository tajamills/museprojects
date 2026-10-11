-- Converted from the original SQLite 0003_add_post_bump_plans.sql.
ALTER TABLE posts ADD COLUMN bump_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE bump_comments (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  body TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  error_message TEXT,
  UNIQUE(post_id, sequence)
);

CREATE INDEX idx_bump_comments_due ON bump_comments(status, scheduled_at);
