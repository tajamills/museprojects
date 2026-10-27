// Accounts + sessions + book entitlements store.
//
// Production path: Postgres via DATABASE_URL (the Railway Postgres plugin,
// same pattern as the other museprojects apps). Tables are created on boot
// with CREATE TABLE IF NOT EXISTS — no migration files to manage.
//
// Fallback: when DATABASE_URL is not set, a JSON file store (DATA_FILE,
// default ./data/store.json) keeps local dev and the live deploy functional.
// WARNING: on Railway without a volume the container filesystem is
// ephemeral — entitlements in the file store can be lost on redeploy.
// Lifetime access needs the Postgres path; see DEPLOY.md.
//
// Entitlements are LIFETIME (Layla's model, Oct 27, 2026): a grant has no
// expiry and no subscription behind it. A grant matches a user by user_id
// OR by email, so a Stripe webhook that only knows the buyer's email still
// lands on the right account when they sign up with that email.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface Entitlement {
  bookId: string;
  source: string;
  grantedAt: string;
}

export interface Store {
  readonly kind: string;
  init(): Promise<void>;
  findUserByEmail(email: string): Promise<User | null>;
  findUserById(id: string): Promise<User | null>;
  createUser(email: string, passwordHash: string): Promise<User>;
  createSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void>;
  findUserBySession(tokenHash: string): Promise<User | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Returns true when a NEW grant was inserted, false when deduped. */
  grantEntitlement(opts: {
    userId?: string | null;
    email?: string | null;
    bookId: string;
    source: string;
    stripeSessionId?: string | null;
  }): Promise<boolean>;
  revokeEntitlement(user: User, bookId: string): Promise<void>;
  listEntitlements(user: User): Promise<Entitlement[]>;
  hasEntitlement(user: User, bookId: string): Promise<boolean>;
}

// ---------------------------------------------------------------- Postgres
class PgStore implements Store {
  readonly kind = "postgres";
  private pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }
  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entitlements (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        email TEXT,
        book_id TEXT NOT NULL,
        source TEXT NOT NULL,
        stripe_session_id TEXT UNIQUE,
        granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS entitlements_user_idx ON entitlements(user_id);
      CREATE INDEX IF NOT EXISTS entitlements_email_idx ON entitlements(lower(email));
    `);
  }
  private rowToUser(r: Record<string, unknown>): User {
    return {
      id: String(r.id),
      email: String(r.email),
      passwordHash: String(r.password_hash),
      createdAt: new Date(r.created_at as string).toISOString(),
    };
  }
  async findUserByEmail(email: string): Promise<User | null> {
    const { rows } = await this.pool.query("SELECT * FROM users WHERE email = $1", [email]);
    return rows[0] ? this.rowToUser(rows[0]) : null;
  }
  async findUserById(id: string): Promise<User | null> {
    const { rows } = await this.pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] ? this.rowToUser(rows[0]) : null;
  }
  async createUser(email: string, passwordHash: string): Promise<User> {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      "INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) RETURNING *",
      [id, email, passwordHash],
    );
    return this.rowToUser(rows[0]);
  }
  async createSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
      [tokenHash, userId, expiresAt.toISOString()],
    );
  }
  async findUserBySession(tokenHash: string): Promise<User | null> {
    const { rows } = await this.pool.query(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash],
    );
    return rows[0] ? this.rowToUser(rows[0]) : null;
  }
  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }
  async grantEntitlement(opts: {
    userId?: string | null;
    email?: string | null;
    bookId: string;
    source: string;
    stripeSessionId?: string | null;
  }): Promise<boolean> {
    // Idempotent per Stripe session; also skip if an equivalent grant exists.
    if (opts.stripeSessionId) {
      const dup = await this.pool.query(
        "SELECT 1 FROM entitlements WHERE stripe_session_id = $1",
        [opts.stripeSessionId],
      );
      if (dup.rowCount) return false;
    }
    const existing = await this.pool.query(
      `SELECT 1 FROM entitlements WHERE book_id = $1 AND (
         ($2::text IS NOT NULL AND user_id = $2) OR
         ($3::text IS NOT NULL AND lower(email) = lower($3)))`,
      [opts.bookId, opts.userId ?? null, opts.email ?? null],
    );
    if (existing.rowCount) return false;
    await this.pool.query(
      "INSERT INTO entitlements (id, user_id, email, book_id, source, stripe_session_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [randomUUID(), opts.userId ?? null, opts.email ?? null, opts.bookId, opts.source, opts.stripeSessionId ?? null],
    );
    return true;
  }
  async revokeEntitlement(user: User, bookId: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM entitlements WHERE book_id = $1 AND (user_id = $2 OR lower(email) = lower($3))",
      [bookId, user.id, user.email],
    );
  }
  async listEntitlements(user: User): Promise<Entitlement[]> {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (book_id) book_id, source, granted_at FROM entitlements
       WHERE user_id = $1 OR lower(email) = lower($2) ORDER BY book_id, granted_at ASC`,
      [user.id, user.email],
    );
    return rows.map((r) => ({
      bookId: String(r.book_id),
      source: String(r.source),
      grantedAt: new Date(r.granted_at as string).toISOString(),
    }));
  }
  async hasEntitlement(user: User, bookId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      "SELECT 1 FROM entitlements WHERE book_id = $1 AND (user_id = $2 OR lower(email) = lower($3)) LIMIT 1",
      [bookId, user.id, user.email],
    );
    return rows.length > 0;
  }
}

// -------------------------------------------------------------------- file
interface FileData {
  users: User[];
  sessions: { tokenHash: string; userId: string; expiresAt: string }[];
  entitlements: {
    userId: string | null;
    email: string | null;
    bookId: string;
    source: string;
    stripeSessionId: string | null;
    grantedAt: string;
  }[];
}

class FileStore implements Store {
  readonly kind = "file";
  private file: string;
  private data: FileData = { users: [], sessions: [], entitlements: [] };
  constructor(file: string) {
    this.file = file;
  }
  async init(): Promise<void> {
    try {
      this.data = JSON.parse(await readFile(this.file, "utf8")) as FileData;
    } catch {
      this.data = { users: [], sessions: [], entitlements: [] };
      await this.persist();
    }
  }
  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data, null, 1));
    await rename(tmp, this.file);
  }
  async findUserByEmail(email: string): Promise<User | null> {
    return this.data.users.find((u) => u.email === email) ?? null;
  }
  async findUserById(id: string): Promise<User | null> {
    return this.data.users.find((u) => u.id === id) ?? null;
  }
  async createUser(email: string, passwordHash: string): Promise<User> {
    const user: User = { id: randomUUID(), email, passwordHash, createdAt: new Date().toISOString() };
    this.data.users.push(user);
    await this.persist();
    return user;
  }
  async createSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
    this.data.sessions.push({ tokenHash, userId, expiresAt: expiresAt.toISOString() });
    await this.persist();
  }
  async findUserBySession(tokenHash: string): Promise<User | null> {
    const s = this.data.sessions.find(
      (x) => x.tokenHash === tokenHash && new Date(x.expiresAt) > new Date(),
    );
    return s ? this.findUserById(s.userId) : null;
  }
  async deleteSession(tokenHash: string): Promise<void> {
    this.data.sessions = this.data.sessions.filter((x) => x.tokenHash !== tokenHash);
    await this.persist();
  }
  private matches(e: FileData["entitlements"][number], userId?: string | null, email?: string | null): boolean {
    return (
      (userId != null && e.userId === userId) ||
      (email != null && e.email != null && e.email.toLowerCase() === email.toLowerCase())
    );
  }
  async grantEntitlement(opts: {
    userId?: string | null;
    email?: string | null;
    bookId: string;
    source: string;
    stripeSessionId?: string | null;
  }): Promise<boolean> {
    if (opts.stripeSessionId && this.data.entitlements.some((e) => e.stripeSessionId === opts.stripeSessionId)) return false;
    if (this.data.entitlements.some((e) => e.bookId === opts.bookId && this.matches(e, opts.userId, opts.email))) return false;
    this.data.entitlements.push({
      userId: opts.userId ?? null,
      email: opts.email ?? null,
      bookId: opts.bookId,
      source: opts.source,
      stripeSessionId: opts.stripeSessionId ?? null,
      grantedAt: new Date().toISOString(),
    });
    await this.persist();
    return true;
  }
  async revokeEntitlement(user: User, bookId: string): Promise<void> {
    this.data.entitlements = this.data.entitlements.filter(
      (e) => !(e.bookId === bookId && this.matches(e, user.id, user.email)),
    );
    await this.persist();
  }
  async listEntitlements(user: User): Promise<Entitlement[]> {
    const seen = new Map<string, Entitlement>();
    for (const e of this.data.entitlements) {
      if (this.matches(e, user.id, user.email) && !seen.has(e.bookId)) {
        seen.set(e.bookId, { bookId: e.bookId, source: e.source, grantedAt: e.grantedAt });
      }
    }
    return [...seen.values()];
  }
  async hasEntitlement(user: User, bookId: string): Promise<boolean> {
    return this.data.entitlements.some((e) => e.bookId === bookId && this.matches(e, user.id, user.email));
  }
}

export function createStore(): Store {
  const url = process.env.DATABASE_URL ?? "";
  if (url) return new PgStore(url);
  const file = process.env.DATA_FILE ?? path.join(process.cwd(), "data", "store.json");
  return new FileStore(file);
}
