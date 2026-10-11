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
import { stripeWebhookHandler } from "./billing.js";
import { db } from "./db.js";
import { runMigrations } from "./migrate.js";

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
      res.status(400).json({ error: result.error ?? "Webhook error" });
      return;
    }
    res.json({ received: true });
  });

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "cryptobagtracker" });
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
}

main().catch((err) => {
  console.error("fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
