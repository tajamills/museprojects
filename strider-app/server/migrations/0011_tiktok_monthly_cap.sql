CREATE TABLE IF NOT EXISTS tiktok_monthly_usage (
  user_id INTEGER NOT NULL,
  year_month TEXT NOT NULL,
  post_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, year_month)
);
