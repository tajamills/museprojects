import express, { type Request } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import { z } from "zod";
import { BOOK_CHECKOUT_ENABLED, BOOKING_ITEM_IDS, BOOK_ITEM_IDS, CATALOG } from "./catalog.js";
import { CONTENT } from "./content-data.js";
import { createStore, type Store, type User } from "./store.js";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  clearSessionCookie,
  hashPassword,
  isValidEmail,
  newSessionToken,
  normalizeEmail,
  parseCookies,
  sessionCookie,
  sessionTokenHash,
  verifyPassword,
} from "./auth.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// When bundled to dist/server.js: dist layout is dist/server.js + dist/client/.
const CLIENT_DIR = process.env.CLIENT_DIR ?? path.join(here, "client");
const SITE_URL = (process.env.SITE_URL ?? "https://abisolawrites.com").replace(/\/$/, "");
const PORT = Number(process.env.PORT ?? 3000);
const COOKIE_SECURE = SITE_URL.startsWith("https://");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const store: Store = createStore();

// Per-route SEO. Titles/descriptions come from the live site's captured copy.
interface RouteMeta { title: string; description: string; }
const ROUTE_META: Record<string, RouteMeta> = {
  "/": {
    title: "The Abisola Writes Library — Three books. One threshold.",
    description: "A spiritual mystery, a personal blueprint for lasting wealth, and a calm guide to household preparedness. Read the opening of each for free — unlock the rest whenever you're ready. Yours to keep, forever.",
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
  "/book/quietly-ready": {
    title: "Quietly Ready — A Calm, Staged Guide to Household Preparedness — Abisola Writes",
    description: "A calm, staged guide to household preparedness — food, water, and the layers that matter, built one layer at a time on an ordinary budget. 14 chapters plus worksheets. Read the opening free; unlock the full guide for $18.88, one-time.",
  },
  "/reader/quietlyready": {
    title: "Read Quietly Ready — Abisola Writes",
    description: "Read Quietly Ready in the Abisola Writes Library. The opening is free; unlock all 14 chapters plus the appendix worksheets for $18.88, one-time.",
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
  "/signin": {
    title: "Sign in — Abisola Writes",
    description: "Sign in to the Abisola Writes Library to read the books you've unlocked — yours to keep, forever.",
  },
  "/checkout-unavailable": {
    title: "Checkout is being reconnected — Abisola Writes",
    description: "Abisola Writes is moving to a new home and checkout is being reconnected. Nothing was charged.",
  },
};
const DEFAULT_META: RouteMeta = ROUTE_META["/"];
const SITEMAP_PATHS = ["/", "/book/doors", "/book/trust", "/book/quietly-ready", "/reader/doors1", "/reader/trust", "/reader/quietlyready", "/services", "/resume", "/music", "/booking"];

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function currentUser(req: Request): Promise<User | null> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  return store.findUserBySession(sessionTokenHash(token));
}

async function startSession(res: express.Response, userId: string): Promise<void> {
  const token = newSessionToken();
  await store.createSession(sessionTokenHash(token), userId, new Date(Date.now() + SESSION_TTL_MS));
  res.setHeader("Set-Cookie", sessionCookie(token, COOKIE_SECURE));
}

/**
 * Grant the book a completed Stripe checkout paid for. Identity comes from
 * client_reference_id / metadata.userId (set by /api/checkout for signed-in
 * buyers); the fallback is the email Stripe collected, so the entitlement
 * still lands when that buyer creates an account with the same email.
 */
async function grantFromCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
  const itemId = session.metadata?.itemId ?? "";
  if (!BOOK_ITEM_IDS.has(itemId)) return; // only books are entitlements
  const userId = session.client_reference_id || session.metadata?.userId || null;
  const email = normalizeEmail(
    session.customer_details?.email ?? session.customer_email ?? session.metadata?.email ?? "",
  );
  await store.grantEntitlement({
    userId,
    email: email || null,
    bookId: itemId,
    source: "stripe",
    stripeSessionId: session.id,
  });
  console.log(`[abisolawrites] entitlement granted: ${itemId} -> ${userId ?? email ?? "?"}`);
}

async function main() {
  await store.init();
  if (store.kind === "file") {
    console.warn(
      "[abisolawrites] WARNING: DATABASE_URL is not set — accounts/entitlements use the local file store. " +
      "On Railway this is ephemeral; add Postgres (DATABASE_URL) for durable lifetime entitlements.",
    );
  }
  const template = await readFile(path.join(CLIENT_DIR, "index.html"), "utf8");

  const app = express();
  app.disable("x-powered-by");

  app.get("/healthz", (_req, res) => res.json({ ok: true, store: store.kind }));

  // Stripe webhook: signature covers the raw request bytes, so this route
  // MUST use express.raw() and be registered before express.json(). Without
  // a webhook secret configured there is nothing trustworthy to verify
  // against, so the endpoint refuses rather than pretending.
  app.post("/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
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
      if (event.type === "checkout.session.completed") {
        await grantFromCheckoutSession(event.data.object as Stripe.Checkout.Session);
      }
      res.json({ received: true });
    } catch (err) {
      if (err instanceof Error && err.message.includes("signature")) {
        res.status(400).json({ error: "Webhook signature verification failed." });
      } else {
        console.error("[abisolawrites] webhook handling failed", err);
        res.status(500).json({ error: "Webhook handling failed." });
      }
    }
  });

  app.use(express.json({ limit: "256kb" }));

  // Public capability flags — the client uses these to choose between real
  // checkout/buttons and the honest paused states.
  app.get("/api/config", (_req, res) => {
    res.json({
      checkoutEnabled: stripe !== null,
      // Email sign-in is live (accounts + entitlements, Oct 27, 2026).
      // Google sign-in stays a seam until an OAuth client exists.
      signInEnabled: true,
      authEnabled: true,
      bookCheckoutEnabled: BOOK_CHECKOUT_ENABLED,
    });
  });

  // ------------------------------------------------------------- accounts
  const credentials = z.object({
    email: z.string().min(3).max(254),
    password: z.string().min(8).max(128),
  });

  app.post("/api/auth/signup", async (req, res) => {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success || !isValidEmail(normalizeEmail(parsed.success ? parsed.data.email : ""))) {
      res.status(400).json({ error: "Enter a valid email and a password of at least 8 characters." });
      return;
    }
    const email = normalizeEmail(parsed.data.email);
    if (await store.findUserByEmail(email)) {
      res.status(409).json({ error: "An account with that email already exists — sign in instead." });
      return;
    }
    const user = await store.createUser(email, await hashPassword(parsed.data.password));
    await startSession(res, user.id);
    res.json({ user: { email: user.email }, entitlements: [] });
  });

  app.post("/api/auth/signin", async (req, res) => {
    const parsed = credentials
      .extend({ password: z.string().min(1).max(128) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter your email and password." });
      return;
    }
    const email = normalizeEmail(parsed.data.email);
    const user = await store.findUserByEmail(email);
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    await startSession(res, user.id);
    const entitlements = await store.listEntitlements(user);
    res.json({ user: { email: user.email }, entitlements: entitlements.map((e) => e.bookId) });
  });

  app.post("/api/auth/signout", async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await store.deleteSession(sessionTokenHash(token));
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.json({ ok: true });
  });

  app.get("/api/me", async (req, res) => {
    const user = await currentUser(req);
    if (!user) {
      res.json({ user: null, entitlements: [] });
      return;
    }
    const entitlements = await store.listEntitlements(user);
    res.json({ user: { email: user.email }, entitlements: entitlements.map((e) => e.bookId) });
  });

  // ------------------------------------------------------- chapter delivery
  // Free chapters: served publicly (real text, server-side only).
  // Paid chapters: served ONLY to a signed-in account with a lifetime
  // entitlement for that book. Chapter text is never in the client bundle.
  app.get("/api/books/:bookId/chapters/:index", async (req, res) => {
    const book = CONTENT[req.params.bookId];
    const index = Number(req.params.index);
    if (!book || !Number.isInteger(index) || index < 0 || index >= book.chapters.length) {
      res.status(404).json({ error: "Unknown chapter." });
      return;
    }
    const chapter = book.chapters[index];
    const meta = { label: chapter.label, title: chapter.title ?? null, free: chapter.free };
    if (!chapter.free) {
      const user = await currentUser(req);
      if (!user || !(await store.hasEntitlement(user, req.params.bookId))) {
        res.status(403).json({ error: "locked", ...meta });
        return;
      }
    }
    if (chapter.text == null) {
      // Structure exists but the manuscript text is not loaded yet
      // (Doors Ch 15–17; all of Trust — see scripts/build-content.mjs).
      res.json({ ...meta, available: false, text: null });
      return;
    }
    res.json({ ...meta, available: true, text: chapter.text });
  });

  // ------------------------------------------------------------ admin seam
  // Manual grants/revokes (e.g. honoring a past buyer) — Bearer ADMIN_TOKEN.
  // Disabled entirely when ADMIN_TOKEN is not set.
  const adminBody = z.object({ email: z.string().min(3).max(254), bookId: z.string().min(1).max(64) });
  const adminGuard = (req: Request): boolean =>
    ADMIN_TOKEN !== "" && req.headers.authorization === `Bearer ${ADMIN_TOKEN}`;

  app.post("/api/admin/grant", async (req, res) => {
    if (!adminGuard(req)) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const parsed = adminBody.safeParse(req.body);
    if (!parsed.success || !BOOK_ITEM_IDS.has(parsed.data.bookId)) {
      res.status(400).json({ error: "Enter a buyer email and a book id (doors1, trust, quietlyready)." });
      return;
    }
    const email = normalizeEmail(parsed.data.email);
    const user = await store.findUserByEmail(email);
    await store.grantEntitlement({
      userId: user?.id ?? null,
      email,
      bookId: parsed.data.bookId,
      source: "manual",
    });
    res.json({ ok: true, bookId: parsed.data.bookId, email, accountExisted: user !== null });
  });

  app.post("/api/admin/revoke", async (req, res) => {
    if (!adminGuard(req)) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const parsed = adminBody.safeParse(req.body);
    if (!parsed.success || !BOOK_ITEM_IDS.has(parsed.data.bookId)) {
      res.status(400).json({ error: "Enter a buyer email and a book id (doors1, trust, quietlyready)." });
      return;
    }
    const email = normalizeEmail(parsed.data.email);
    const user = await store.findUserByEmail(email);
    if (!user) {
      res.status(404).json({ error: "No account with that email." });
      return;
    }
    await store.revokeEntitlement(user, parsed.data.bookId);
    res.json({ ok: true, bookId: parsed.data.bookId, email });
  });

  // -------------------------------------------------------------- checkout
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
    if (BOOKING_ITEM_IDS.has(item.id)) {
      // Audit fix (Oct 27, 2026): booking payment delivered nothing — no
      // record, no confirmation, no session link. Refused server-side
      // until the booking-delivery build exists.
      res.status(403).json({ error: "booking_checkout_disabled" });
      return;
    }
    const isBook = BOOK_ITEM_IDS.has(item.id);
    if (isBook && !BOOK_CHECKOUT_ENABLED) {
      // Defense in depth (Oct 27, 2026): the buy buttons are hidden in the
      // client (driven by /api/config), and the endpoint independently
      // refuses book sessions until the test purchase passes and
      // BOOK_CHECKOUT_ENABLED is flipped in catalog.ts.
      res.status(403).json({ error: "book_checkout_disabled" });
      return;
    }
    if (!stripe) {
      // Honest seam: no keys yet -> no fake checkout, no fake success.
      res.status(503).json({ error: "checkout_unavailable" });
      return;
    }
    // Book purchases must be tied to an account BEFORE payment so the
    // webhook grant lands on the buyer: the session carries the user id as
    // client_reference_id plus metadata the webhook reads back.
    let buyer: User | null = null;
    if (isBook) {
      buyer = await currentUser(req);
      if (!buyer) {
        res.status(401).json({ error: "sign_in_required" });
        return;
      }
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
        ...(buyer
          ? {
              client_reference_id: buyer.id,
              customer_email: buyer.email,
              metadata: { itemId: item.id, userId: buyer.id, email: buyer.email },
            }
          : {
              metadata: parsed.data.note ? { note: parsed.data.note.slice(0, 500) } : undefined,
            }),
        success_url: `${SITE_URL}${item.returnPath}?checkout=success`,
        cancel_url: `${SITE_URL}${item.returnPath}?checkout=cancelled`,
      });
      res.json({ url: session.url });
    } catch {
      res.status(502).json({ error: "Stripe could not start checkout. Please try again shortly." });
    }
  });

  // --- Sign-in -------------------------------------------------------------
  // Email sign-in lives at /signin (client page, /api/auth/* above).
  // /auth/google is kept as a route because older pages link to it: Google
  // sign-in itself is NOT connected (no Google Cloud OAuth client exists —
  // GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in Railway is the owner step),
  // so the route lands visitors on the working email sign-in instead of a
  // dead placeholder. It never fakes a Google login.
  app.get("/auth/google", (_req, res) => {
    res.redirect(302, "/signin");
  });

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send(`# Meta AI training crawler — blocked by owner's decision (Oct 24, 2026).\n# Link previews (facebookexternalhit) intentionally left allowed.\nUser-agent: meta-externalagent\nDisallow: /\n\nUser-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
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
    console.log(
      `[abisolawrites] listening on :${PORT} (store ${store.kind}, checkout ${stripe ? "enabled" : "in reconnect mode"}, ` +
      `book checkout ${BOOK_CHECKOUT_ENABLED ? "ENABLED" : "disabled"}, email sign-in enabled, google sign-in not connected)`,
    );
  });
}

main().catch((err) => {
  console.error("[abisolawrites] failed to start", err);
  process.exit(1);
});
