-- 0005_entity_archived.sql — Soft archive for businesses.
-- Archived businesses keep all of their data; they leave the default
-- Businesses views and the Overview attention rollup, and no new
-- auto-generated deadlines are created for them. Reversible from the
-- Businesses page overflow menu. No hard delete exists anywhere.
ALTER TABLE entities ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
