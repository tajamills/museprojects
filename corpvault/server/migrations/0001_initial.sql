-- Port of drizzle/0001_initial.sql (SQLite → Postgres).
-- Legacy table, dropped by 0002. Kept so migration history mirrors the source.
CREATE TABLE entries (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
