import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { actions, handleFacebookOAuthCallback, handleInstagramOAuthCallback, handleTikTokOAuthCallback, handleXOAuthCallback, handleYoutubeOAuthCallback } from "./actions.js";
import { stripeWebhookHandler } from "./billing.js";
import { createCtx, resolveMediaDir } from "./ctx.js";
import { createDb, createPool, migrate } from "./db.js";
import { startScheduler } from "./scheduler.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// When bundled to dist/server.js: __dirname=dist, so ../.. no —
// dist layout: dist/server.js, dist/client/, dist/migrations/
const CLIENT_DIR = process.env.CLIENT_DIR ?? path.join(here, "client");
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? path.join(here, "migrations");
const mediaDir = resolveMediaDir();

// OAuth popup completion page. The Connect buttons open the platform auth
// flow in a popup window; the platform redirects back to these callbacks
// inside the popup. This page notifies the opener via postMessage and closes
// itself. If opened without an opener (popup blocked -> full-page fallback),
// it falls back to the legacy /?oauth=... redirect.
function sendOAuthPopupResult(
  res: express.Response,
  platform: "facebook" | "instagram" | "x" | "youtube" | "tiktok",
  result: { ok: boolean; error?: string },
  successMessage: string,
): void {
  const payload = JSON.stringify({
    type: "zepostia-oauth",
    platform,
    ok: result.ok,
    message: successMessage,
    reason: result.ok ? null : (result.error ?? "unknown"),
  }).replace(/</g, "\\u003c");
  const fallback = result.ok
    ? `/?oauth=${platform}_ok`
    : `/?oauth=${platform}_error&reason=${encodeURIComponent(result.error ?? "unknown")}`;
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>Connecting&hellip;</title></head><body><p>Finishing connection&hellip;</p><script>
(function () {
  var payload = ${payload};
  var fallback = ${JSON.stringify(fallback)};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(payload, window.location.origin);
      window.close();
      return;
    }
  } catch (e) { /* fall through to redirect */ }
  window.location.replace(fallback);
})();
</script></body></html>`);
}

async function main() {
  const pool = createPool();
  await migrate(pool, MIGRATIONS_DIR);
  const db = createDb(pool);
  const ctx = createCtx(db, mediaDir);

  const app = express();
  app.disable("x-powered-by");

  // Stripe webhook: Stripe's signature covers the raw request bytes, so this
  // route MUST use express.raw() and MUST be registered before express.json().
  app.post("/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
    const result = await stripeWebhookHandler(
      db,
      req.body as Buffer,
      req.headers["stripe-signature"] as string | undefined,
    );
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? "Webhook error" });
      return;
    }
    res.json({ received: true });
  });

  // Media uploads travel as base64 inside action JSON (max 12 MB files).
  app.use(express.json({ limit: "20mb" }));

  app.get("/healthz", (_req, res) => res.json({ ok: true, build: "2026-10-28-promo-codes" }));

  // Facebook OAuth callback. Must be registered in the Meta app as a Valid
  // OAuth Redirect URI: {APP_BASE_URL}/oauth/facebook/callback
  app.get("/oauth/facebook/callback", async (req, res) => {
    const result = await handleFacebookOAuthCallback(db, req.query as Record<string, unknown>);
    sendOAuthPopupResult(res, "facebook", result, "Facebook connected — posting as your Page.");
  });

  // Instagram OAuth callback. Must be registered in the Meta app as a Valid
  // OAuth Redirect URI: {APP_BASE_URL}/oauth/instagram/callback
  app.get("/oauth/instagram/callback", async (req, res) => {
    const result = await handleInstagramOAuthCallback(db, req.query as Record<string, unknown>);
    sendOAuthPopupResult(res, "instagram", result, "Instagram connected — posting as your professional account.");
  });

  // X OAuth 2.0 callback. Must be registered in the X developer portal
  // (OAuth 2.0 settings -> Callback URI / Redirect URL):
  // {APP_BASE_URL}/oauth/x/callback
  app.get("/oauth/x/callback", async (req, res) => {
    const result = await handleXOAuthCallback(db, req.query as Record<string, unknown>);
    sendOAuthPopupResult(res, "x", result, "X connected — ready to post tweets.");
  });

  // YouTube OAuth callback. Must be registered in the Google Cloud OAuth
  // client as an Authorized redirect URI: {APP_BASE_URL}/oauth/youtube/callback
  app.get("/oauth/youtube/callback", async (req, res) => {
    const result = await handleYoutubeOAuthCallback(db, req.query as Record<string, unknown>);
    sendOAuthPopupResult(res, "youtube", result, "YouTube connected — ready to upload video.");
  });

  // TikTok OAuth callback. Must be registered in the TikTok app as a
  // Redirect URI: {APP_BASE_URL}/oauth/tiktok/callback
  app.get("/oauth/tiktok/callback", async (req, res) => {
    const result = await handleTikTokOAuthCallback(db, req.query as Record<string, unknown>);
    sendOAuthPopupResult(res, "tiktok", result, "TikTok connected — ready to post video.");
  });

  // Action RPC: POST /actions { action, args } -> { data } | { error }.
  // Same wire protocol the SDK's createActionClient used ("./actions").
  app.post("/actions", async (req, res) => {
    const { action, args } = req.body ?? {};
    const def = typeof action === "string" ? actions[action] : undefined;
    if (!def) {
      res.status(404).json({ error: `Unknown action: ${String(action)}` });
      return;
    }
    ctx.origin = req.get("origin") ?? null;
    try {
      const parsedArgs = def.request.parse(args ?? {});
      const data = await def.handler(ctx, parsedArgs);
      res.json({ data });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: "Invalid request arguments." });
      } else {
        console.error(`[actions] ${action} failed:`, err);
        res.status(500).json({ error: "The request could not be completed. Try again." });
      }
    }
  });

  // Uploaded media served at /media/<key> (same URLs getWorkspace returns).
  app.use("/media", express.static(mediaDir, { fallthrough: false }));

  // Built React client.
  app.use(express.static(CLIENT_DIR, { index: false }));
  app.get("*", (_req, res) => res.sendFile(path.join(CLIENT_DIR, "index.html")));

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    console.log(`[server] listening on :${port}`);
    console.log(`[server] client dir: ${CLIENT_DIR}`);
    console.log(`[server] media dir:  ${mediaDir}`);
  });

  startScheduler(ctx);

  const shutdown = async () => {
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
