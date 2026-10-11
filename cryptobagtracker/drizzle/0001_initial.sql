-- 0001_initial.sql (Postgres port of the original SQLite migration)
CREATE TABLE entries (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
