// Postgres connection + migrate-on-boot runner.
//
// DATABASE_URL comes from the Railway Postgres plugin. On boot the server
// applies any migrations in server/migrations/*.sql that have not been
// recorded in the __migrations table yet, in filename order. Statements are
// split on the drizzle-style `--> statement-breakpoint` separator.

import pg from "pg";
import type { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export function createDb(): { db: Db; pool: Pool } {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/** Absolute path of the bundled migrations directory at runtime (dist/server/migrations). */
export function migrationsDir(): string {
  return join(import.meta.dirname, "migrations");
}

export async function runMigrations(pool: Pool, dir: string = migrationsDir()): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS __migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    const applied = new Set(
      (await client.query<{ name: string }>("SELECT name FROM __migrations")).rows.map(
        (row) => row.name,
      ),
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(dir, file), "utf8");
      const statements = sql
        .split(/--> statement-breakpoint/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      await client.query("BEGIN");
      try {
        for (const statement of statements) {
          await client.query(statement);
        }
        await client.query("INSERT INTO __migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      console.log(`Applied migration ${file}`);
    }
  } finally {
    client.release();
  }
}
