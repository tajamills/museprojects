// Blob storage for uploaded documents.
//
// The TS-space used the SDK's blob store (`ctx.blobs.put` / `ctx.blobs.getUrl`).
// The port originally wrote files under DATA_DIR (default ./data) using the
// same blob keys (`documents/<accountId>/<uuid>`) — but no Railway volume is
// attached, so every redeploy wiped the files while the `documents` rows in
// Postgres survived and the download links 404'd. The app now uses the
// Postgres-backed store (createDbBlobStore, migration 0010), which keeps the
// bytes in the `document_blobs` table next to the rows. The local-disk store
// is kept for offline/dev use only.

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { documentBlobs } from "./schema.js";

export interface BlobStore {
  put(key: string, bytes: Uint8Array, opts: { contentType: string }): Promise<void>;
  /** Fetch a stored blob's bytes and content type. Missing keys return null. */
  get(key: string): Promise<{ bytes: Buffer; contentType: string } | null>;
  /** Remove a stored blob. Missing keys are not an error. */
  delete(key: string): Promise<void>;
  /** Signed download URL handed to the browser (token-scoped). */
  getUrl(key: string): string;
}

/** Throws if `key` would escape `base` (path traversal guard). */
export function resolveBlobPath(base: string, key: string): string {
  const full = resolve(join(base, key));
  const root = resolve(base);
  if (full !== root && !full.startsWith(`${root}/`)) {
    throw new Error("Invalid file path.");
  }
  return full;
}

/**
 * Path-traversal guard equivalent for key-based (non-filesystem) stores:
 * blob keys are server-generated (`documents/<accountId>/<uuid>`), so any
 * key containing a `..` segment or an absolute path is rejected the same
 * way resolveBlobPath rejects an escaping path.
 */
export function assertSafeBlobKey(key: string): void {
  if (key.length === 0 || key.startsWith("/") || key.split("/").includes("..")) {
    throw new Error("Invalid file path.");
  }
}

export function createLocalBlobStore(dataDir: string, token: string | null): BlobStore {
  return {
    async put(key, bytes) {
      const full = resolveBlobPath(dataDir, key);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, bytes);
    },
    async get(key) {
      const full = resolveBlobPath(dataDir, key);
      try {
        const bytes = await readFile(full);
        // The disk store does not persist content types; the /files route
        // serves the documents row's mime type, so this is only a fallback.
        return { bytes, contentType: "application/octet-stream" };
      } catch {
        return null;
      }
    },
    async delete(key) {
      const full = resolveBlobPath(dataDir, key);
      await unlink(full).catch(() => undefined);
    },
    getUrl(key) {
      return `/files/${key}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    },
  };
}

export function createDbBlobStore(db: Db, token: string | null): BlobStore {
  return {
    async put(key, bytes, opts) {
      assertSafeBlobKey(key);
      const data = Buffer.from(bytes);
      await db
        .insert(documentBlobs)
        .values({ blobKey: key, contentType: opts.contentType, data })
        .onConflictDoUpdate({
          target: documentBlobs.blobKey,
          set: { contentType: opts.contentType, data },
        });
    },
    async get(key) {
      assertSafeBlobKey(key);
      const rows = await db
        .select({ data: documentBlobs.data, contentType: documentBlobs.contentType })
        .from(documentBlobs)
        .where(eq(documentBlobs.blobKey, key))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return { bytes: Buffer.from(row.data), contentType: row.contentType };
    },
    async delete(key) {
      assertSafeBlobKey(key);
      await db.delete(documentBlobs).where(eq(documentBlobs.blobKey, key));
    },
    getUrl(key) {
      return `/files/${key}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    },
  };
}
