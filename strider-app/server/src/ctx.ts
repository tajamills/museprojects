import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./db.js";

// Replaces the SDK `Ctx`. The original actions used three SDK-provided
// capabilities:
//   - ctx.db        -> drizzle db backed by the pg Pool (this.db)
//   - ctx.blobs     -> local-disk media store under MEDIA_DIR, served by
//                      Express at /media (this.blobs)
//   - ctx.invalidateQueries() -> no-op; the React client already invalidates
//                      its own react-query caches after every mutation.

function assertSafeKey(key: string): void {
  if (!key || key.includes("..") || path.isAbsolute(key) || key.includes("\\")) {
    throw new Error("Invalid media key");
  }
}

export interface AppCtx {
  db: Db;
  blobs: {
    put(key: string, bytes: Uint8Array, opts: { contentType: string }): Promise<void>;
    getUrl(key: string): Promise<string>;
  };
  invalidateQueries(): void;
}

export function createCtx(db: Db, mediaDir: string): AppCtx {
  return {
    db,
    blobs: {
      async put(key, bytes, _opts) {
        assertSafeKey(key);
        const dest = path.join(mediaDir, key);
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, bytes);
      },
      async getUrl(key) {
        assertSafeKey(key);
        return `/media/${key}`;
      },
    },
    invalidateQueries() {
      // No-op: the client invalidates its react-query caches itself after
      // each mutation. Kept so ported action code compiles unchanged.
    },
  };
}

export function resolveMediaDir(): string {
  return process.env.MEDIA_DIR ? path.resolve(process.env.MEDIA_DIR) : path.resolve("media");
}
