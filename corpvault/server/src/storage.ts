// Local-disk blob storage for uploaded documents.
//
// The TS-space used the SDK's blob store (`ctx.blobs.put` / `ctx.blobs.getUrl`).
// The port writes files under DATA_DIR (default ./data) using the same blob
// keys (`documents/<accountId>/<uuid>`), so a single Railway volume mounted at
// DATA_DIR makes uploads persistent across deploys. See DEPLOY.md.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface BlobStore {
  put(key: string, bytes: Uint8Array, opts: { contentType: string }): Promise<void>;
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

export function createLocalBlobStore(dataDir: string, token: string | null): BlobStore {
  return {
    async put(key, bytes) {
      const full = resolveBlobPath(dataDir, key);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, bytes);
    },
    getUrl(key) {
      return `/files/${key}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    },
  };
}
