# abisolawrites — deploy notes

Rebuild of abisolawrites.com (The Abisola Writes Library) off Emergent,
mirroring the other museprojects apps: Node 20 + Express + React 19 +
Tailwind v4, esbuild bundles, multi-stage Dockerfile.

## Railway setup (owner steps)

1. New service in the museprojects project, source repo `tajamills/museprojects`,
   **Root Directory: `abisolawrites`**.
2. Variables:
   - `SITE_URL` — the public URL (Railway domain first, `https://abisolawrites.com` after DNS).
   - `STRIPE_SECRET_KEY` — when ready to take payments. Until set, all buy/book
     buttons land on the honest "checkout is being reconnected" notice.
   - `STRIPE_WEBHOOK_SECRET` — after creating the webhook endpoint
     `{SITE_URL}/webhooks/stripe` in the Stripe Dashboard.
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — later, when Google sign-in
     is connected (the route is a placeholder seam until then).
   - `PORT` is injected by Railway automatically.
3. No database is required for the current build (catalog/content are static
   data files). Add Postgres later for accounts/entitlements.

## DNS cutover (registrar — owner step)

Point the domain at the Railway service (Railway → service → Settings →
Networking → Custom Domain gives the exact CNAME/A target). Verify the new
site live on the Railway domain first; cancel Emergent only after the custom
domain serves the new build.

## Local run

```sh
npm install
npm run build
npm start          # http://localhost:3000
# or dev-style: PORT=3100 node dist/server.js
```

## Seams left intentionally

- **Manuscript text** — chapter bodies are placeholder slots in
  `client/src/data/books.ts` ("CONTENT FROM MANUSCRIPT — TO BE INSERTED").
  Paste each chapter's text into its `text` field; no other code changes.
- **Stripe** — env-var only; see `.env.example`.
- **Google sign-in** — `/auth/google` placeholder page; entitlements are not
  enforced yet because there are no accounts.
- **Booking** — calendar/slot/details flow is front-end complete; confirming
  routes into the same Stripe checkout seam (item `booking-1to1`).
