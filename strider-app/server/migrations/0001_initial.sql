-- Mirrors the original 0001_initial.sql. The `entries` table was a placeholder
-- from the first template migration; it is dropped again in 0002.
CREATE TABLE entries (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
