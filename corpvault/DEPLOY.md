# kovala — Railway deployment guide

kovala is a Railway-deployable Node.js port of the Hatch TS-space
`bizkeep` (a business entity manager: entities, document vault, compliance
reminders, meeting minutes). One service serves the Express API and the
built React client.

## Required env vars

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `DATABASE_URL` | **yes** | — | Postgres connection string. Add Railway's **Postgres plugin** to the service and Railway provides this automatically as a service variable. The server refuses to boot without it. |
| `DATA_DIR` | no | `./data` | Directory where uploaded documents are stored on local disk. **Mount a Railway volume at this path** (e.g. `/app/data`) so uploads survive redeploys. |
| `PORT` | no | `3000` | Railway injects `PORT` automatically. |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` / `PLAID_ENV` | no | — | Optional Books bank connections (Phase 2, read-only Plaid). The connect option appears in Books ONLY when all three are set (`PLAID_ENV` = `sandbox` or `production`). |
| `STRIPE_BANK_SYNC_PRICE_ID` | no | — | Bank Sync add-on price ($8.88/mo per business; product "Kovala -Plaid- Bank Sync", prod_VWflyMfG9ZCmEE). The purchase flow appears only when a price ID resolves: this env var first, else the `BANK_SYNC_PRICE_ID_FALLBACK` constant in `server/src/billing.ts`. The owner's admin account is comped and never checks out. |
| `TOKEN_ENCRYPTION_KEY` | no | — | 64 hex chars (`openssl rand -hex 32`). Required alongside the Plaid vars: Plaid access tokens are stored AES-256-GCM encrypted under this key (same scheme as Zepostia). Never rotate casually — stored tokens become unreadable. |

See `.env.example` for a copy-paste template.

## Railway setup

1. Create a new Railway service from this repo (or from the Dockerfile).
2. Add the **Postgres plugin** to the project — `DATABASE_URL` is then
   injected automatically; no manual value needed.
3. Add a **volume** and mount it at the `DATA_DIR` path
   (default `/app/data`; set `DATA_DIR=/app/data` to be explicit).
4. Deploy. On boot the server runs any pending migrations in
   `server/migrations/*.sql` (tracked in the `__migrations` table), then
   listens on `PORT`. `GET /healthz` returns `{ok:true}` for health checks.

## How the port works

- **API**: `POST /actions` accepts `{action, args}` JSON and dispatches to
  the ported action handlers in `server/src/actions.ts`
  (`authStatus`, `signUp`, `signIn`, `getWorkspace`, `addEntity`,
  `addReminder`, `setReminderStatus`, `addDocument`, `addMeeting`).
  Success returns `{data}`, failures return `{error}` with a 400/401 status.
  All zod request/response validation from the original is preserved.
- **Database**: Postgres via `drizzle-orm` + `node-postgres` (`pg` pool).
  The SQLite schema was ported 1:1 to `drizzle-orm/pg-core`
  (`INTEGER PRIMARY KEY AUTOINCREMENT` →
  `INTEGER GENERATED ALWAYS AS IDENTITY`; ms-integer timestamps →
  `TIMESTAMPTZ`; integer booleans → `BOOLEAN`).
- **Document vault**: the SDK's blob store was replaced with local-disk
  storage under `DATA_DIR` using the same blob keys
  (`documents/<accountId>/<uuid>`). Downloads go through
  `GET /files/<key>?token=<session-token>` and are scoped to the owning
  account (no token → 401; another account's file → 404; path traversal
  is rejected).
- **Client**: the React app is unchanged apart from the rebrand and the
  SDK removal. `client/src/api.ts` is a tiny fetch-based RPC client with the
  same wire protocol (`{action, args}` → `{data}`) and the same
  `ApiRequest`/`ApiResponse` type helpers. The Tailwind theme is compiled
  with the Tailwind v4 CLI and esbuild bundles the TSX.

## Branding

The user-visible name is **kovala** everywhere (auth screen, nav,
title). The internal artifact slug `bizkeep` survives only in invisible
spots (browser `localStorage` keys), which is intentional.

## Could not port

- **`ctx.invalidateQueries()`** (server-pushed React Query invalidation from
  the space SDK): dropped. Over plain HTTP RPC there is no server→client
  push channel; the client already invalidates its `workspace` query on
  every mutation success, so behavior is unchanged.
- **Drizzle `meta/_journal.json` / drizzle-kit workflow**: replaced by the
  simple migrate-on-boot runner in `server/src/db.ts`. If you need
  drizzle-kit later, the schema in `server/src/schema.ts` is standard
  `pg-core` and works with it directly.
- **The space daemon's asset route** (`/spaces/v2/<slug>/assets/*`): not
  applicable; Express serves the built client from `/` directly.
- **SQLite `app.db` data migration**: the source database was not carried
  over (it belongs to the Hatch runtime). This deploy starts with a fresh
  Postgres database; users sign up again.
