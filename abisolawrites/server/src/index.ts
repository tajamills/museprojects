import express from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import { z } from "zod";
import { CATALOG } from "./catalog.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// When bundled to dist/server.js: dist layout is dist/server.js + dist/client/.
const CLIENT_DIR = process.env.CLIENT_DIR ?? path.join(here, "client");
const SITE_URL = (process.env.SITE_URL ?? "https://abisolawrites.com").replace(/\/$/, "");
const PORT = Number(process.env.PORT ?? 3000);

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// Per-route SEO. Titles/descriptions come from the live site's captured copy.
interface RouteMeta { title: string; description: string; }
const ROUTE_META: Record<string, RouteMeta> = {
  "/": {
    title: "The Abisola Writes Library — Two books. One threshold.",
    description: "A spiritual mystery and a personal blueprint for lasting wealth. Read the opening of each for free — unlock the rest whenever you're ready. Yours to keep, forever.",
  },
  "/book/doors": {
    title: "Doors — Book One | A Spiritual Mystery — Abisola Writes",
    description: "A watched child. A hidden inheritance. A door that opens only for the one it recognizes. 18 chapters, ~63k words. Read the Prologue free; unlock the full book for $2.99, one-time.",
  },
  "/book/trust": {
    title: "The Trust I Built Before I Needed It — Abisola Writes",
    description: "One investor's honest journey from buying assets to protecting them — trusts, jurisdictions, and an actual irrevocable trust built before it was ever needed. 10 chapters. Read Chapter One free; unlock for $18.88, one-time.",
  },
  "/reader/doors1": {
    title: "Read Doors — Book One — Abisola Writes",
    description: "Read Doors — Book One in the Abisola Writes Library. The Prologue is free; unlock all 18 chapters for $2.99, one-time.",
  },
  "/reader/trust": {
    title: "Read The Trust I Built Before I Needed It — Abisola Writes",
    description: "Read The Trust I Built Before I Needed It in the Abisola Writes Library. Chapter One is free; unlock all 10 chapters for $18.88, one-time.",
  },
  "/services": {
    title: "Services — Choose your kind of magic. — Abisola Writes",
    description: "1:1, private, recorded sessions with Abisola: Strategy Session ($18.18), Manuscript Review ($55.55), and limited Ghostwriting ($144.44).",
  },
  "/resume": {
    title: "AI Resume Writer — Get hired with an AI-written resume. — Abisola Writes",
    description: "Get hired with an AI-written resume. Download the AI Resume Writer by Abisola Writes.",
  },
  "/music": {
    title: "Music — Abisola Writes",
    description: "Songs from Abisola Writes — listen on the Music page and follow the channel at youtube.com/@abisolawrites.",
  },
  "/booking": {
    title: "Book a 1-to-1 with Abisola — Abisola Writes",
    description: "Book a 30-minute 1-to-1 session with Abisola — $48.88, weekdays 9:00 AM–2:00 PM EDT.",
  },
  "/checkout-unavailable": {
    title: "Checkout is being reconnected — Abisola Writes",
    description: "Abisola Writes is moving to a new home and checkout is being reconnected. Nothing was charged.",
  },
};
const DEFAULT_META: RouteMeta = ROUTE_META["/"];
const SITEMAP_PATHS = ["/", "/book/doors", "/book/trust", "/reader/doors1", "/reader/trust", "/services", "/resume", "/music", "/booking"];

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function main() {
  const template = await readFile(path.join(CLIENT_DIR, "index.html"), "utf8");

  const app = express();
  app.disable("x-powered-by");

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // Stripe webhook: signature covers the raw request bytes, so this route
  // MUST use express.raw() and be registered before express.json(). Without
  // a webhook secret configured there is nothing trustworthy to verify
  // against, so the endpoint refuses rather than pretending.
  app.post("/webhooks/stripe", express.raw({ type: "application/json" }), (req, res) => {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
      res.status(503).json({ error: "Stripe webhook is not configured yet." });
      return;
    }
    const signature = req.headers["stripe-signature"] as string | undefined;
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature header." });
      return;
    }
    try {
      const event = stripe.webhooks.constructEvent(req.body as Buffer, signature, STRIPE_WEBHOOK_SECRET);
      // Entitlement grants land here once accounts exist (see /auth/google
      // seam). For now, acknowledge verified events so Stripe stops retrying.
      void event;
      res.json({ received: true });
    } catch {
      res.status(400).json({ error: "Webhook signature verification failed." });
    }
  });

  app.use(express.json({ limit: "256kb" }));

  // Public capability flags — the client uses these to choose between real
  // checkout and the honest "being reconnected" notice.
  app.get("/api/config", (_req, res) => {
    res.json({
      checkoutEnabled: stripe !== null,
      signInEnabled: GOOGLE_CLIENT_ID !== "",
    });
  });

  const checkoutBody = z.object({
    itemId: z.string().min(1).max(64),
    // Booking details are carried into Stripe metadata only; they never
    // influence the amount (which comes from the server catalog).
    note: z.string().max(500).optional(),
  });

  app.post("/api/checkout", async (req, res) => {
    const parsed = checkoutBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid checkout request." });
      return;
    }
    const item = CATALOG[parsed.data.itemId];
    if (!item) {
      res.status(404).json({ error: "Unknown item." });
      return;
    }
    if (!stripe) {
      // Honest seam: no keys yet -> no fake checkout, no fake success.
      res.status(503).json({ error: "checkout_unavailable" });
      return;
    }
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: item.amountCents,
              product_data: { name: item.name, description: item.description },
            },
          },
        ],
        metadata: parsed.data.note ? { note: parsed.data.note.slice(0, 500) } : undefined,
        success_url: `${SITE_URL}${item.returnPath}?checkout=success`,
        cancel_url: `${SITE_URL}${item.returnPath}?checkout=cancelled`,
      });
      res.json({ url: session.url });
    } catch {
      res.status(502).json({ error: "Stripe could not start checkout. Please try again shortly." });
    }
  });

  // --- Google sign-in seam -------------------------------------------------
  // The Emergent site used Google sign-in only. Until a Google Cloud OAuth
  // client exists (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in Railway), this
  // route serves an honest placeholder — it never fakes a logged-in state.
  app.get("/auth/google", (_req, res) => {
    res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in is being reconnected — Abisola Writes</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 560px; margin: 12vh auto; padding: 0 20px; line-height: 1.6;">
<h1>Sign-in is being reconnected</h1>
<p>Abisola Writes just moved to a new home. Google sign-in is being reconnected during the move, so accounts and library unlocks are paused for a short while.</p>
<p>The free opening chapters are still open to everyone — no sign-in needed.</p>
<p><a href="/">← Back to the Library</a></p>
</body></html>`);
  });

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send(`User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  });

  app.get("/sitemap.xml", (_req, res) => {
    const urls = SITEMAP_PATHS.map((p) => `  <url><loc>${SITE_URL}${p}</loc></url>`).join("\n");
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  });

  // Static bundle assets (bundle.js, theme.css, favicon.svg). index.html is
  // served by the shell handler below so each route gets its own meta.
  app.use(express.static(CLIENT_DIR, { index: false }));

  // SPA shell with per-route SEO meta.
  app.get("*", (req, res) => {
    const cleanPath = req.path.replace(/\/+$/, "") || "/";
    const meta = ROUTE_META[cleanPath] ?? DEFAULT_META;
    const html = template
      .replaceAll("__PAGE_TITLE__", escapeHtml(meta.title))
      .replaceAll("__PAGE_DESCRIPTION__", escapeHtml(meta.description))
      .replaceAll("__PAGE_URL__", escapeHtml(`${SITE_URL}${cleanPath === "/" ? "/" : cleanPath}`));
    res.type("html").send(html);
  });

  app.listen(PORT, () => {
    console.log(`[abisolawrites] listening on :${PORT} (checkout ${stripe ? "enabled" : "in reconnect mode"}, sign-in ${GOOGLE_CLIENT_ID ? "enabled" : "placeholder"})`);
  });
}

main().catch((err) => {
  console.error("[abisolawrites] failed to start", err);
  process.exit(1);
});
