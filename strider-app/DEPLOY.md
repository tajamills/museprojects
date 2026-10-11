# zepostia — Railway deploy guide

Port of the Hatch TS-space social marketing automation app (write once, post
everywhere: Facebook / Instagram / TikTok / YouTube / X, with scheduling and
24-hour comment bump plans) to a standard Node.js + Postgres codebase.

## Required env vars

| Var | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Postgres connection string. On Railway, add the **Postgres plugin** to the service and this is injected automatically. |
| `PORT` | no | `3000` | Railway injects this automatically. |
| `APP_BASE_URL` | no | `http://localhost:3000` | Public URL of the deployment. Used in OAuth callback URLs once live OAuth handlers exist (e.g. `https://zepostia.up.railway.app/oauth/facebook/callback`). |
| `MEDIA_DIR` | no | `./media` | Where uploaded images/videos are stored; served at `/media`. |
| `SCHEDULER_INTERVAL_MS` | no | `30000` | How often the in-process scheduler checks for due posts/bump comments. |
| `FACEBOOK_CLIENT_SECRET` … `X_CLIENT_SECRET` | no | — | Optional overrides for the `vault://…` secret references stored in `platform_configs`. Only used by future live OAuth handlers; the app currently runs in demo mode. Never commit real values. |

See `.env.example` for the full list with comments.

## Railway setup

1. Create a new Railway service from this directory (Dockerfile build).
2. Add the **Postgres plugin** to the service → `DATABASE_URL` is provided automatically.
3. (Optional) Add a **volume** mounted at `/app/media` so uploaded media survives redeploys. Without it, uploads are ephemeral (see below).
4. Deploy. **Migrations run automatically on boot**: the server applies any
   `dist/migrations/*.sql` files not yet recorded in the `schema_migrations`
   table, inside a transaction each.

## How it runs

- Single Express process: serves the built React client (`/`), the action RPC
  (`POST /actions` with `{ action, args }` → `{ data }` or `{ error }`),
  uploaded media (`/media/*`), and `/healthz`.
- Auth is token-based, ported as-is from the original: `signup`/`login` create
  a random UUID session token in the `sessions` table (30-day expiry),
  passwords are SHA-256(`salt:password`). Every protected action validates the
  token server-side. Tokens are passed explicitly in action args and kept in
  `localStorage` on the client.
- **In-process scheduler (single replica):** the original Hatch app had no
  scheduler — scheduled posts stayed `pending` and demo bump comments only
  advanced on click. This port adds a `setInterval` worker loop in the Express
  process that, every `SCHEDULER_INTERVAL_MS`, publishes due scheduled posts,
  publishes due bump comments, and prunes expired sessions. Run **exactly one
  replica**; two processes ticking against the same DB would double-publish.
  Demo-mode semantics are preserved: "publishing" marks rows published with a
  `demo-` remote id — no external platform API is ever called.

## Secrets

- The `platform_configs` table stores client IDs and secret *references* only
  (e.g. `vault://marketing-app/facebook/client-secret`). Raw secret values are
  never stored in the DB, returned by any action, or written to logs.
- Real values can be supplied via the `*_CLIENT_SECRET` env vars; they are
  resolved through `server/src/secrets.ts` for the future live OAuth handlers.

## Could not port / intentionally dropped

- **`@hatch/space-sdk` (proprietary):** removed entirely. `defineAction` →
  plain async functions with zod validation; the SDK `Ctx` → a local context
  holding the pg-backed drizzle db; the client `createActionClient` → a small
  `fetch("/actions", …)` RPC proxy using the same `{action, args}` / `{data}` /
  `{error}` wire protocol.
- **Blob storage (`ctx.blobs`):** replaced with local-disk storage under
  `MEDIA_DIR`, served by Express at `/media`. On Railway the filesystem is
  ephemeral — mount a volume at `/app/media` (or move to object storage) if
  uploads must survive redeploys.
- **`ctx.invalidateQueries()`:** became a no-op; the React client already
  invalidates its own react-query caches after every mutation.
- **Live OAuth publishing:** not implemented in the original either (demo mode
  only — `connectDemoAccount` refuses non-demo users until a deployed callback
  URL and approved developer apps exist). The port keeps demo-mode behavior
  and adds the scheduler to drain the queue, but real token exchange and
  platform API calls are future work.
- **`recharts`:** listed in the original `package.json` but unused by any
  client code; dropped from dependencies.
- **Bun toolchain:** the original built with `bun build` / `bun ./client/build.mjs`.
  The port builds with esbuild under Node 20 (`npm run build`).
- **The `entries` table** from the original `0001_initial.sql` is preserved in
  migration 0001 (then dropped in 0002) purely to keep migration history
  faithful; it is unused by the app.
- **"Blastly" branding:** shelved per instructions (trademark conflict).
  Rebranded to **zepostia** (2026-10-11).
