// CryptoBagTracker HTTP server.
//
//   POST /actions   JSON-RPC-style dispatch: {action, args} -> action result.
//                   Unknown actions -> 404; zod validation failures and handler
//                   errors -> 400 with {error: message}.
//   GET  /health    liveness probe.
//   GET  *          the built React client (static files + SPA fallback).
//
// Migrations in ./drizzle run automatically on boot (see migrate.ts).
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Actions, type Ctx } from "./actions.js";
import { checkPriceAlerts } from "./alerts.js";
import { stripeWebhookHandler } from "./billing.js";
import { handleTwilioInbound, smsAlertsEnabled, twilioConfig, twilioWebhookUrl, validateTwilioSignature } from "./sms.js";
import { db } from "./db.js";
import { runMigrations } from "./migrate.js";
import { and, eq, or } from "drizzle-orm";
import * as schema from "./schema.js";

type ActionDef = {
  request: z.ZodTypeAny;
  handler: (ctx: Ctx, args: never) => Promise<unknown>;
};

function actionErrorMessage(err: unknown): string {
  if (err instanceof z.ZodError) {
    return err.issues
      .map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`)
      .join("; ");
  }
  return err instanceof Error ? err.message : "Action failed";
}

function findClientDir(): string {
  const candidates = [
    process.env.CLIENT_DIR,
    path.resolve(process.cwd(), "client/dist"),
    path.resolve(process.cwd(), "dist", "..", "client", "dist"),
  ].filter((c): c is string => Boolean(c));
  const dir = candidates.find((c) => fs.existsSync(path.join(c, "index.html")));
  if (!dir) {
    console.warn(
      `Client bundle not found (looked in ${candidates.join(", ")}). ` +
        `API routes still work; set CLIENT_DIR to serve the UI.`,
    );
    return candidates[0] ?? path.resolve(process.cwd(), "client/dist");
  }
  return dir;
}

async function main(): Promise<void> {
  await runMigrations();

  const app = express();

  // Stripe webhook: Stripe's signature covers the raw request bytes, so this
  // route MUST use express.raw() and MUST be registered before express.json().
  app.post("/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
    const result = await stripeWebhookHandler(
      db,
      req.body as Buffer,
      req.headers["stripe-signature"] as string | undefined,
    );
    if (!result.ok) {
      // Signature/config problems stay 400; a failed grant application
      // carries status 500 so Stripe retries the delivery.
      res.status(result.status ?? 400).json({ error: result.error ?? "Webhook error" });
      return;
    }
    res.json({ received: true });
  });

  // Twilio inbound SMS webhook (STOP / START keywords). Twilio POSTs
  // form-encoded fields, so this route carries its own urlencoded parser.
  // Inert — 404 — unless SMS alerts are enabled AND Twilio credentials are
  // configured, so with the flag off this route does not exist in practice.
  app.post("/webhooks/twilio", express.urlencoded({ extended: false }), async (req, res) => {
    const cfg = twilioConfig();
    if (!smsAlertsEnabled() || !cfg) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const params = (req.body ?? {}) as Record<string, string>;
    const signature = req.headers["x-twilio-signature"] as string | undefined;
    const webhookUrl = twilioWebhookUrl();
    if (signature && webhookUrl) {
      if (!validateTwilioSignature(cfg.authToken, signature, webhookUrl, params)) {
        res.status(403).json({ error: "Invalid Twilio signature" });
        return;
      }
    } else {
      console.warn("twilio webhook: signature not validated (no signature header, or set TWILIO_WEBHOOK_URL / APP_BASE_URL to enable strict validation).");
    }
    try {
      const result = await handleTwilioInbound(db, params);
      if (result.matched) console.log(`twilio webhook: ${result.action} for user ${result.userId}`);
    } catch (err) {
      // Never 5xx a carrier webhook for a bookkeeping failure: Twilio and
      // the carriers still honor STOP at the network level, and a retry
      // storm helps nobody. Log and acknowledge.
      console.error("twilio webhook: inbound handling failed:", err instanceof Error ? err.message : err);
    }
    res.type("text/xml").send("<Response></Response>");
  });

  app.use(express.json({ limit: "1mb" }));

  // Health probe with a live read on the planted test alert's state, so its
  // kill switch is verifiable from outside (added 2026-10-28 after the
  // boot-only cleanup could not be confirmed). Cached 20s — health checks
  // must stay cheap. Remove once the test alert is confirmed gone.
  // v4 (2026-10-28): also lists EVERY active alert row — a "still above $1"
  // text landed after the probe read the known test alert inactive, so a
  // second test artifact on another account has to be visible here.
  type ActiveAlertRow = { id: number; userId: number; asset: string; direction: string; targetPrice: number };
  let testAlertProbe: { at: number; active: boolean | null; activeAlerts: ActiveAlertRow[] | null } = { at: 0, active: null, activeAlerts: null };
  app.get("/health", async (_req, res) => {
    if (Date.now() - testAlertProbe.at > 20_000) {
      let active: boolean | null = null;
      let activeAlerts: ActiveAlertRow[] | null = null;
      try {
        const testUsers = await db.select({ id: schema.users.id }).from(schema.users)
          .where(eq(schema.users.email, "sms-fix-test-oct27@cryptobagtracker.io"));
        const testUserId = testUsers.length > 0 ? testUsers[0].id : -1;
        const rows = await db.select({ id: schema.priceAlerts.id }).from(schema.priceAlerts)
          .where(and(
            eq(schema.priceAlerts.active, true),
            or(
              and(
                eq(schema.priceAlerts.userId, testUserId),
                eq(schema.priceAlerts.asset, "BTC"),
                eq(schema.priceAlerts.targetPrice, 1),
              ),
              eq(schema.priceAlerts.id, 4),
            ),
          ));
        active = rows.length > 0;
        activeAlerts = await db.select({
          id: schema.priceAlerts.id,
          userId: schema.priceAlerts.userId,
          asset: schema.priceAlerts.asset,
          direction: schema.priceAlerts.direction,
          targetPrice: schema.priceAlerts.targetPrice,
        }).from(schema.priceAlerts).where(eq(schema.priceAlerts.active, true));
      } catch {
        active = null;
        activeAlerts = null;
      }
      testAlertProbe = { at: Date.now(), active, activeAlerts };
    }
    res.json({ ok: true, service: "cryptobagtracker", build: "2026-10-30-account-crud", test_alert_active: testAlertProbe.active, active_alerts: testAlertProbe.activeAlerts });
  });

  app.post("/actions", async (req, res) => {
    const body = (req.body ?? {}) as { action?: unknown; args?: unknown };
    const def = (
      Actions as unknown as Record<string, ActionDef | undefined>
    )[typeof body.action === "string" ? body.action : ""];
    if (!def) {
      res.status(404).json({ error: `Unknown action: ${String(body.action)}` });
      return;
    }
    let parsed: unknown;
    try {
      parsed = def.request.parse(body.args ?? {});
    } catch (err) {
      res.status(400).json({ error: actionErrorMessage(err) });
      return;
    }
    try {
      const reqCtx: Ctx = { db, invalidateQueries: () => {}, origin: req.get("origin") ?? null };
      const result = await def.handler(reqCtx, parsed as never);
      res.json(result ?? null);
    } catch (err) {
      res.status(400).json({ error: actionErrorMessage(err) });
    }
  });

  const clientDir = findClientDir();
  app.use(express.static(clientDir, { maxAge: "1h", index: false }));
  // SPA fallback: serve index.html for extensionless navigations (e.g. /tax);
  // leave real 404s (missing assets, API paths) alone.
  app.use((req, res, next) => {
    if (req.method !== "GET" || !req.accepts("html") || path.extname(req.path)) {
      next();
      return;
    }
    res.sendFile(path.join(clientDir, "index.html"));
  });

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`cryptobagtracker listening on :${port}`);
  });

  // One-time cleanup (2026-10-28, at Layla's direction — "turn off the
  // alert"): deactivate the planted Oct 27 SMS test alert (BTC above $1 on
  // the throwaway test account sms-fix-test-oct27@cryptobagtracker.io).
  // The site API has no delete/deactivate action and that alert re-fires
  // on an episode loop until its 24h cap, so this boot step is its off
  // switch. Self-limiting: it matches only that account's still-active
  // BTC $1 alerts, so every later boot is a no-op. Safe to remove once
  // it has run in production.
  try {
    const testUsers = await db.select({ id: schema.users.id }).from(schema.users)
      .where(eq(schema.users.email, "sms-fix-test-oct27@cryptobagtracker.io"));
    if (testUsers.length > 0) {
      const off = await db.update(schema.priceAlerts).set({ active: false })
        .where(and(
          eq(schema.priceAlerts.userId, testUsers[0].id),
          eq(schema.priceAlerts.asset, "BTC"),
          eq(schema.priceAlerts.targetPrice, 1),
          eq(schema.priceAlerts.active, true),
        )).returning({ id: schema.priceAlerts.id });
      if (off.length > 0) {
        console.log(`cleanup: deactivated planted test alert(s): ${off.map((r) => r.id).join(", ")}`);
      }
    }
  } catch (err) {
    console.error("test-alert cleanup failed:", err instanceof Error ? err.message : err);
  }

  // Price-alert scheduler: poll CoinGecko for active alerts, deliver via
  // Telegram / outbound webhook, and record every trigger in alert_history.
  // Single-replica safe for Railway's default deployment; failures are logged
  // and never crash the server. Prices are fetched in one batched call per
  // tick, so the 60s default cadence stays at ~1 CoinGecko request/minute.
  const priceCheckMs = Number(process.env.PRICE_CHECK_INTERVAL_MS);
  const priceCheckInterval = Number.isFinite(priceCheckMs) && priceCheckMs > 0 ? priceCheckMs : 60 * 1000;
  let alertCheckRunning = false;
  const runAlertCheck = async () => {
    if (alertCheckRunning) return; // a slow tick skips the next one instead of stacking sends
    alertCheckRunning = true;
    try {
      const { checked, triggered } = await checkPriceAlerts(db);
      if (triggered > 0) console.log(`price alerts: ${triggered} triggered (${checked} active checked)`);
    } catch (err) {
      console.error("price alert check failed:", err instanceof Error ? err.message : err);
    } finally {
      alertCheckRunning = false;
    }
  };
  setTimeout(runAlertCheck, 30_000);
  setInterval(runAlertCheck, priceCheckInterval);
}

main().catch((err) => {
  console.error("fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
