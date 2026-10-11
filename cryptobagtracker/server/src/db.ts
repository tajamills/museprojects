// Postgres connection via node-postgres. DATABASE_URL is provided by the
// Railway Postgres plugin (or set manually for local development).
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Add the Postgres plugin (Railway) or set DATABASE_URL to a Postgres connection string.",
  );
}

export const pool = new Pool({ connectionString, max: 10 });
export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });
