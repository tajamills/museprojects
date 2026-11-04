-- 0010_document_blobs.sql — document bytes move into Postgres (Nov 4, 2026).
-- Until now the blob store wrote uploaded files to local disk under
-- DATA_DIR (see server/src/storage.ts). No Railway volume is attached,
-- so every redeploy wiped the files while the documents rows survived —
-- document links then returned 404 "File not found" even though the
-- vault still listed them. Storing the bytes in Postgres next to the
-- rows makes uploads survive redeploys with no volume to manage.
-- blob_key matches documents.blob_key (`documents/<accountId>/<uuid>`);
-- rows written before this migration have no entry here and their files
-- are already gone, so nothing is backfilled.
CREATE TABLE document_blobs (
  blob_key TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
