// kovala Express server (Node 20).
//
// - POST /actions   — JSON RPC: {action, args} → {data} | {error}
// - GET  /files/*   — token-scoped document downloads (local-disk blob store)
// - GET  /healthz   — Railway health check
// - Static files    — the built React client from dist/client

import express from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDb, runMigrations, type Db } from "./db.js";
import { actionDefs, type ActionName, type Ctx } from "./actions.js";
import { createLocalBlobStore, resolveBlobPath } from "./storage.js";
import { bankSyncPriceId, stripeWebhookHandler } from "./billing.js";
import * as schema from "./schema.js";

export const DATA_DIR =
  process.env.DATA_DIR && process.env.DATA_DIR.length > 0
    ? resolve(process.env.DATA_DIR)
    : resolve(process.cwd(), "data");

function zodMessage(err: unknown): string {
  if (err instanceof z.ZodError) {
    const first = err.issues[0];
    return first ? `Invalid request: ${first.path.join(".") || "body"} — ${first.message}` : "Invalid request.";
  }
  return err instanceof Error ? err.message : "Invalid request.";
}

export function createApp(db: Db, dataDir: string = DATA_DIR): express.Express {
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

  // Document uploads travel as base64 inside the JSON body (10 MB files →
  // ~13.4 MB base64), so the body limit must exceed the 14 MB zod cap.
  app.use(express.json({ limit: "20mb" }));

  app.get("/healthz", (_req, res) => res.json({ ok: true, build: "2026-10-30-kovala-account-crud" }));

  app.post("/actions", async (req, res) => {
    const { action, args } = (req.body ?? {}) as { action?: unknown; args?: unknown };
    if (typeof action !== "string" || !(action in actionDefs)) {
      res.status(404).json({ error: `Unknown action: ${String(action)}` });
      return;
    }
    const def = actionDefs[action as ActionName];
    let parsed: unknown;
    try {
      parsed = def.request.parse(args ?? {});
    } catch (err) {
      res.status(400).json({ error: zodMessage(err) });
      return;
    }

    const token =
      parsed && typeof parsed === "object" && "token" in parsed && typeof parsed.token === "string"
        ? parsed.token
        : null;
    const ctx: Ctx = { db, token, blobs: createLocalBlobStore(dataDir, token), origin: req.get("origin") ?? null };

    try {
      const result = await def.handler(ctx, parsed as never);
      res.json({ data: def.response.parse(result) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action failed.";
      const status = /session has expired|sign in again/i.test(message) ? 401 : 400;
      res.status(status).json({ error: message });
    }
  });

  // Token-scoped downloads. The download URLs issued by ctx.blobs.getUrl()
  // embed the caller's session token; the token is resolved to an account and
  // the blob key must belong to that account's document row.
  app.get("/files/*", async (req, res) => {
    try {
      const blobKey = (req.params as string[])[0] ?? "";
      const token = typeof req.query.token === "string" ? req.query.token : "";

      const sessionRows = await db
        .select({ accountId: schema.sessions.accountId, expiresAt: schema.sessions.expiresAt })
        .from(schema.sessions)
        .where(eq(schema.sessions.token, token))
        .limit(1);
      const session = sessionRows[0];
      if (!session || session.expiresAt.getTime() < Date.now()) {
        res.status(401).json({ error: "Your session has expired. Please sign in again." });
        return;
      }

      const docRows = await db
        .select({ filename: schema.documents.filename, mimeType: schema.documents.mimeType })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.blobKey, blobKey),
            eq(schema.documents.accountId, session.accountId),
          ),
        )
        .limit(1);
      const doc = docRows[0];
      if (!doc) {
        res.status(404).json({ error: "File not found." });
        return;
      }

      const fullPath = resolveBlobPath(dataDir, blobKey);
      res.setHeader("Content-Type", doc.mimeType);
      res.setHeader("Content-Disposition", `inline; filename="${doc.filename.replace(/"/g, "")}"`);
      res.sendFile(fullPath, (err) => {
        if (err && !res.headersSent) res.status(404).json({ error: "File not found." });
      });
    } catch (err) {
      if (!res.headersSent) res.status(400).json({ error: (err as Error).message });
    }
  });

  // Built client (dist/client).
  const clientDir = join(import.meta.dirname, "..", "client");
  app.use(express.static(clientDir, { index: false }));
  app.get("*", (_req, res) => {
    res.sendFile(join(clientDir, "index.html"));
  });

  return app;
}

async function main(): Promise<void> {
  const { db, pool } = createDb();
  await runMigrations(pool);
  // Log the resolved Bank Sync price ID at startup: it was transcribed
  // from a photo of the owner's Stripe dashboard, so if purchases ever
  // fail with "no such price", the exact ID the server is using is in
  // the logs (see the config-error branch in createBankSyncCheckout).
  console.log(
    `kovala bank sync add-on price: ${bankSyncPriceId() ?? "(not configured — purchase flow hidden)"} (env override: ${process.env.STRIPE_BANK_SYNC_PRICE_ID ? "set" : "unset"})`,
  );
  const app = createApp(db, DATA_DIR);
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    console.log(`kovala listening on :${port} (DATA_DIR=${DATA_DIR})`);
  });
}

// Auto-boot only when run directly (`node dist/server/index.js`), so the
// module can be imported for testing without side effects.
const invokedDirectly =
  process.argv[1] != null &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
