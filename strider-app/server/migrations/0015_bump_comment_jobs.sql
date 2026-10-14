-- 0015_bump_comment_jobs.sql — 24-hour post bump (comments update):
-- execution moves from one plan row per post to one JOB per
-- (bump comment, published target) so each platform's follow-up comment
-- is scheduled from the target's actual publish time and its outcome
-- (posted / failed + customer-safe reason) is recorded per platform.
-- bump_comments stays the plan (body + slot); jobs carry the work.
-- TikTok never gets jobs: the Content Posting API has no comment
-- endpoint for third-party apps (no comment scope exists to grant).
CREATE TABLE bump_comment_jobs (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bump_comment_id INTEGER NOT NULL REFERENCES bump_comments(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES post_targets(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  error_message TEXT,
  remote_id TEXT,
  UNIQUE(bump_comment_id, target_id)
);

CREATE INDEX idx_bump_comment_jobs_due ON bump_comment_jobs(status, scheduled_at);
