// Migrate-on-boot: applies every *.sql file in the drizzle/ directory, in
// filename order, splitting on drizzle's "--> statement-breakpoint" markers.
// Applied migrations are recorded in the _migrations table so each file runs
// exactly once. Safe to run on every boot and against an existing database.
import fs from "node:fs";
import path from "node:path";
import { pool } from "./db.js";

function findMigrationsDir(): string {
  const candidates = [process.env.MIGRATIONS_DIR, path.resolve(process.cwd(), "drizzle")].filter(
    (c): c is string => Boolean(c),
  );
  const dir = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isDirectory());
  if (!dir) {
    throw new Error(
      `Migrations directory not found. Looked in: ${candidates.join(", ")}. Set MIGRATIONS_DIR to override.`,
    );
  }
  return dir;
}

export async function runMigrations(): Promise<void> {
  const dir = findMigrationsDir();
  const client = await pool.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    const { rows } = await client.query<{ name: string }>(`SELECT name FROM _migrations`);
    const applied = new Set(rows.map((r) => r.name));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      await client.query("BEGIN");
      try {
        for (const statement of statements) {
          await client.query(statement);
        }
        await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [file]);
        await client.query("COMMIT");
        console.log(`migration applied: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    client.release();
  }
}
