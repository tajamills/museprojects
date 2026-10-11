# CryptoBagTracker — Railway deployment guide

Standalone Node.js + Express + Postgres port of the CryptoBagTracker Hatch TS
space. The React client is bundled to static files and served by the same
Express process that exposes `POST /actions`.

## Required environment variables

| Variable       | Required | Default | Notes                                                        |
| -------------- | -------- | ------- | ------------------------------------------------------------ |
| `DATABASE_URL` | Yes      | —       | Postgres connection string.                                  |
| `PORT`         | No       | `3000`  | Railway injects this automatically.                          |
| `CLIENT_DIR`   | No       | `./client/dist` | Override where the server finds the built client bundle. |
| `MIGRATIONS_DIR` | No     | `./drizzle`     | Override where the server finds the SQL migrations.  |

The server code references **no other** environment variables. A full
`grep` of `server/src` shows zero `process.env` reads besides the four above.
In particular the app needs **no** chain-data, Stripe, PayPal, SMS, or
Telegram API keys to run — see "Not yet wired up" below.

## Railway setup

1. Create a new Railway project from this directory (or connect the repo).
2. **Add the Postgres plugin** to the project. Railway automatically sets
   `DATABASE_URL` on the service — no manual value needed.
3. Deploy. The Dockerfile builds the client + server, then starts
   `node dist/server.js`.
4. **Migrations run on boot**: on startup the server applies every
   `drizzle/*.sql` file in order (tracked in the `_migrations` table, so each
   runs once). No manual `drizzle-kit` step is needed.
5. Health check: `GET /health` returns `{ok: true}`.

The app is then live: landing page, signup/login (7-day trial messaging),
wallets, transactions, tax center (FIFO/LIFO/HIFO, CSV + Form 8949 /
Schedule D views), price alerts, and the $4.44 affiliate program.

## Local development

```bash
npm install
# point at a local Postgres, e.g.:
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cryptobagtracker
npm run build   # tsc server -> dist/ ; esbuild + tailwind client -> client/dist/
npm start       # node dist/server.js (migrations run automatically)
```

Useful scripts:

- `npm run build:server` — `tsc` only (`dist/server.js`)
- `npm run build:client` — `node client/build.mjs` (esbuild + Tailwind CLI)
- `npm run typecheck` — `tsc --noEmit` for server and client

## Architecture

- `server/src/server.ts` — Express app. `POST /actions` validates `{action,
  args}` with zod and dispatches to `Actions[action].handler`. Serves
  `client/dist` statically with an SPA fallback to `index.html`.
- `server/src/actions.ts` — all business logic (auth, wallets, transactions,
  tax lots, alerts, affiliate, tax forms). Same action names the original
  client called, plus a new `getTaxForms` action (see below).
- `server/src/taxEngine.ts` — TypeScript port of the canonical
  `tax-engine.js` (Tax Engine v2): FIFO/LIFO/HIFO lot consumption,
  transfer-aware custody moves, staking/airdrop ordinary income, and
  server-side Form 8949 / Schedule D builders.
- `server/src/schema.ts` — drizzle `pg-core` schema (Postgres port of the
  SQLite schema).
- `drizzle/*.sql` — the 3 original migrations translated to Postgres
  (`INTEGER PRIMARY KEY AUTOINCREMENT` → `INTEGER GENERATED ALWAYS AS
  IDENTITY PRIMARY KEY`, ms-epoch `INTEGER` → `TIMESTAMPTZ`, `REAL` →
  `DOUBLE PRECISION`, boolean `INTEGER` → `BOOLEAN`).
- `client/src/api.ts` — tiny fetch-based RPC client replacing
  `@hatch/space-sdk/client`; same `{action, args}` contract, same typed
  `api.<name>(args)` surface. `ApiRequest`/`ApiResponse` helper types are
  preserved (the app itself only imports `api`).

## Could not port (dropped or changed with reason)

1. **`@hatch/space-sdk` RPC transport** — proprietary `file:` dependency;
   replaced by `POST /actions` + the fetch client in `client/src/api.ts`.
   Same action names, same `{action, args}` JSON contract, same zod
   validation.
2. **`ctx.invalidateQueries()`** — an SDK hook that told the hosted client to
   refetch. It is a server-side no-op here; the React client already
   invalidates its own react-query caches after every mutation, so behavior
   is unchanged.
3. **`spaceQueryClient` / `hatch-space-root` SDK chrome** — replaced with a
   plain `QueryClient`. The wrapper div's SDK-specific safe-area styling is
   unnecessary; the theme's own `env(safe-area-inset-bottom)` CSS handles
   mobile insets.
4. **SQLite → Postgres** — `drizzle-orm/sqlite-core` replaced with
   `drizzle-orm/pg-core` + `drizzle-orm/node-postgres` (`pg` Pool). Timestamps
   that were millisecond-epoch `INTEGER`s are now `TIMESTAMPTZ` (Postgres
   `INTEGER` is 32-bit and would overflow ms epochs); drizzle returns `Date`
   objects either way, so all action code is behavior-identical.
5. **Server-side Form 8949 / Schedule D** — the original server never
   generated these; the React client rendered them from `getAppData`'s gain
   lines. The port keeps that client rendering untouched and **adds** a
   `getTaxForms` action backed by the canonical Tax Engine v2
   (`server/src/taxEngine.ts`, ported from the rebuild's `tax-engine.js`),
   so 8949/Schedule D are now also available as server-generated JSON.
6. **Alert delivery (Telegram / SMS / push)** — not dropped, but never
   existed: the source only *stored* alert settings (as `••••last4` hints)
   and alert rules; nothing ever sent a notification, evaluated prices, or
   wrote `alert_history`. Ported as-is. Actually sending alerts needs a price
   poller + delivery worker — see below.
7. **Exchange API import** — the source stored only a key hint and discarded
   the secret; no import/sync logic existed. Ported as-is.
8. **Billing ($8.88/mo from day 8) and PayPal affiliate payouts** — UI/marketing
   copy only in the source; no Stripe or PayPal code existed. Not implemented.

## Not yet wired up (TODO, needs keys + code)

None of these are referenced by the current server code — they are listed here
so the gaps are explicit, not as required env vars:

- `TELEGRAM_BOT_TOKEN` — TODO: required if/when Telegram alert delivery is
  implemented (settings are stored, nothing sends today).
- `SMS_PROVIDER_API_KEY` (e.g. Twilio) — TODO: required if/when SMS alert
  delivery is implemented.
- Push delivery provider credentials — TODO: the app stores a
  `pushEnabled` flag only.
- Price-feed API key (e.g. CoinGecko) + a scheduled worker — TODO: required
  to actually evaluate price alerts and write `alert_history`.
- `STRIPE_SECRET_KEY` (+ webhook secret) — TODO: required to bill the
  $8.88/mo Premium plan after the 7-day trial.
- PayPal credentials — TODO: required to automate the quarterly $4.44
  affiliate payouts.
- Exchange API import jobs — TODO: the app stores connection hints only;
  live balance/transaction import per provider is unimplemented.
