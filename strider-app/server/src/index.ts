import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { actions } from "./actions.js";
import { createCtx, resolveMediaDir } from "./ctx.js";
import { createDb, createPool, migrate } from "./db.js";
import { startScheduler } from "./scheduler.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// When bundled to dist/server.js: __dirname=dist, so ../.. no —
// dist layout: dist/server.js, dist/client/, dist/migrations/
const CLIENT_DIR = process.env.CLIENT_DIR ?? path.join(here, "client");
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? path.join(here, "migrations");
const mediaDir = resolveMediaDir();

async function main() {
  const pool = createPool();
  await migrate(pool, MIGRATIONS_DIR);
  const db = createDb(pool);
  const ctx = createCtx(db, mediaDir);

  const app = express();
  app.disable("x-powered-by");
  // Media uploads travel as base64 inside action JSON (max 12 MB files).
  app.use(express.json({ limit: "20mb" }));

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // Action RPC: POST /actions { action, args } -> { data } | { error }.
  // Same wire protocol the SDK's createActionClient used ("./actions").
  app.post("/actions", async (req, res) => {
    const { action, args } = req.body ?? {};
    const def = typeof action === "string" ? actions[action] : undefined;
    if (!def) {
      res.status(404).json({ error: `Unknown action: ${String(action)}` });
      return;
    }
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
