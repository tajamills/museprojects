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
    description: "A watched child. A hidden inheritance. A door that opens only for the one it recognizes. 18 chapters, ~63k words. Read the Prologue and Chapter One free; unlock the full book for $2.99, one-time.",
  },
  "/book/trust": {
    title: "The Trust I Built Before I Needed It — Abisola Writes",
    description: "One investor's honest journey from buying assets to protecting them — trusts, jurisdictions, and an actual irrevocable trust built before it was ever needed. 10 chapters. Read Chapter One free; unlock for $18.88, one-time.",
  },
  "/reader/doors1": {
    title: "Read Doors — Book One — Abisola Writes",
    description: "Read Doors — Book One in the Abisola Writes Library. The Prologue and Chapter One are free; unlock all 18 chapters for $2.99, one-time.",
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
 * `via` is "webhook" for the Stripe webhook and "reconciled" for the
 * self-healing lookup below — the grant itself (store call + idempotency
 * on stripe_session_id) is identical either way.
 */
async function grantFromCheckoutSession(
  session: Stripe.Checkout.Session,
  via: "webhook" | "reconciled" | "sweep" = "webhook",
): Promise<boolean> {
  const itemId = session.metadata?.itemId ?? "";
  if (!BOOK_ITEM_IDS.has(itemId)) return false; // only books are entitlements
  const userId = session.client_reference_id || session.metadata?.userId || null;
  const email = normalizeEmail(
    session.customer_details?.email ?? session.customer_email ?? session.metadata?.email ?? "",
  );
  const inserted = await store.grantEntitlement({
    userId,
    email: email || null,
    bookId: itemId,
    source: "stripe",
    stripeSessionId: session.id,
  });
  if (inserted) {
    console.log(
      `[abisolawrites] entitlement granted via ${via}: ${itemId} -> ${userId ?? email ?? "?"} (session ${session.id})`,
    );
  }
  return inserted;
}

/**
 * Self-healing reconciliation (Oct 27, 2026): a completed purchase must not
 * depend solely on the webhook arriving. When a signed-in user is missing
 * a book, look up their completed Stripe Checkout sessions — FIRST those
 * carrying their user id as client_reference_id, SECOND those Stripe
 * recorded under their account email — and grant any book they paid for
 * but don't own yet, through the same grant path as the webhook.
 *
 * Cost control: an in-memory per-user throttle (at most one scan per user
 * per RECONCILE_MIN_INTERVAL_MS) plus an early exit when the user already
 * owns every book, so this is never a Stripe call on every page load. The
 * buyer's post-checkout return (?checkout=success) hits /api/me, which
 * reconciles before answering, so the unlock heals on that first load.
 * Failures are logged and swallowed — reconciliation must never break the
 * request that triggered it.
 */
const RECONCILE_MIN_INTERVAL_MS = 5 * 60 * 1000;
const lastReconcileAtByUser = new Map<string, number>();

async function reconcileEntitlements(user: User): Promise<void> {
  if (!stripe) return;
  const now = Date.now();
  if (now - (lastReconcileAtByUser.get(user.id) ?? 0) < RECONCILE_MIN_INTERVAL_MS) return;
  lastReconcileAtByUser.set(user.id, now); // set before awaiting: no stampede
  try {
    const owned = new Set((await store.listEntitlements(user)).map((e) => e.bookId));
    const missing = [...BOOK_ITEM_IDS].filter((id) => !owned.has(id));
    if (missing.length === 0) return;

    // ONE list call, matched client-side. Diagnosis (Oct 27, 2026, after a
    // real buyer's heal failed twice): the original code made a SECOND
    // list call filtered by customer_details.email BEFORE granting
    // anything, so any error from that call aborted the whole reconcile —
    // including client_reference_id matches already in hand — and the
    // pre-set throttle timestamp then suppressed every retry for 5
    // minutes (e.g. a pre-purchase /api/me burned the window the
    // post-purchase refresh needed). Server-side email filtering is also
    // not relied on anymore: matching is done here, by normalized email,
    // against the session's own recorded emails.
    const recent = await stripe.checkout.sessions.list({ status: "complete", limit: 100 });
    const sessionEmail = (s: Stripe.Checkout.Session): string =>
      normalizeEmail(s.customer_details?.email ?? s.customer_email ?? s.metadata?.email ?? "");
    const matches = recent.data.filter(
      (s) => s.client_reference_id === user.id || (sessionEmail(s) !== "" && sessionEmail(s) === user.email),
    );
    // client_reference_id matches first (strongest identity), then email.
    matches.sort((a, b) =>
      (b.client_reference_id === user.id ? 1 : 0) - (a.client_reference_id === user.id ? 1 : 0),
    );
    for (const s of matches) {
      const itemId = s.metadata?.itemId ?? "";
      if (!BOOK_ITEM_IDS.has(itemId) || owned.has(itemId)) continue;
      try {
        if (await grantFromCheckoutSession(s, "reconciled")) owned.add(itemId);
      } catch (err) {
        console.error(`[abisolawrites] reconcile grant failed for session ${s.id}`, err);
      }
    }
  } catch (err) {
    // A failed scan must not burn the throttle window: clear the timestamp
    // so the buyer's very next request retries instead of waiting 5 min.
    lastReconcileAtByUser.delete(user.id);
    console.error("[abisolawrites] entitlement reconciliation failed", err);
  }
}

/**
 * GLOBAL entitlement sweep (Oct 27, 2026): the per-user reconcile above
 * still depends on the buyer showing up signed in as the exact account
 * the purchase was keyed to, inside a throttle window, with her session
 * in the newest 100 completes on a Stripe account shared by four stores.
 * A real buyer (Layla herself) completed TWO Trust purchases — one paid,
 * one $0 via promo code — and stayed locked through all of it. The sweep
 * removes the trigger and the framing entirely: it scans completed
 * Checkout sessions newest-first (paginated, up to SWEEP_MAX_SESSIONS)
 * and grants every book session through the SAME grant path as the
 * webhook, keyed by the identifiers stored on the session itself
 * (client_reference_id / customer email). The store dedupes on
 * stripe_session_id and on book+user/email, so re-running is harmless
 * and open/unpaid sessions are never touched (status filter is
 * "complete" only). Runs once shortly after boot and on demand via the
 * ADMIN_TOKEN-guarded endpoint. Never throws to its caller.
 */
const SWEEP_MAX_SESSIONS = 500;
const SWEEP_PAGE_SIZE = 100;

interface SweepSummary {
  scanned: number;
  bookSessions: number;
  grants: string[];
}

async function sweepCompletedSessions(trigger: string): Promise<SweepSummary> {
  const summary: SweepSummary = { scanned: 0, bookSessions: 0, grants: [] };
  if (!stripe) {
    console.log(`[abisolawrites] entitlement sweep (${trigger}): skipped — Stripe not configured`);
    return summary;
  }
  try {
    let startingAfter: string | undefined;
    while (summary.scanned < SWEEP_MAX_SESSIONS) {
      const page = await stripe.checkout.sessions.list({
        status: "complete",
        limit: SWEEP_PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      if (page.data.length === 0) break;
      for (const s of page.data) {
        summary.scanned++;
        const itemId = s.metadata?.itemId ?? "";
        if (!BOOK_ITEM_IDS.has(itemId)) continue;
        summary.bookSessions++;
        try {
          if (await grantFromCheckoutSession(s, "sweep")) {
            const target = s.client_reference_id || s.metadata?.userId || normalizeEmail(
              s.customer_details?.email ?? s.customer_email ?? s.metadata?.email ?? "",
            ) || "?";
            summary.grants.push(`${itemId} -> ${target}`);
          }
        } catch (err) {
          console.error(`[abisolawrites] sweep grant failed for session ${s.id}`, err);
        }
      }
      if (!page.has_more) break;
      startingAfter = page.data[page.data.length - 1].id;
    }
    console.log(
      `[abisolawrites] entitlement sweep (${trigger}): scanned ${summary.scanned} complete sessions, ` +
      `${summary.bookSessions} book sessions, ${summary.grants.length} new grants` +
      (summary.grants.length ? `: ${summary.grants.join("; ")}` : ""),
    );
  } catch (err) {
    console.error(`[abisolawrites] entitlement sweep (${trigger}) failed`, err);
  }
  return summary;
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
        await grantFromCheckoutSession(event.data.object as Stripe.Checkout.Session, "webhook");
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
    // Heal first (throttled): if Stripe says this user completed a book
    // checkout the webhook never delivered, grant it before answering.
    await reconcileEntitlements(user);
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
      if (!user) {
        res.status(403).json({ error: "locked", ...meta });
        return;
      }
      if (!(await store.hasEntitlement(user, req.params.bookId))) {
        // One heal attempt (throttled) before refusing: the buyer may have
        // completed checkout while the webhook didn't land.
        await reconcileEntitlements(user);
        if (!(await store.hasEntitlement(user, req.params.bookId))) {
          res.status(403).json({ error: "locked", ...meta });
          return;
        }
      }
    }
    if (chapter.text == null) {
      // Structure exists but the manuscript text is not loaded yet
      // (see scripts/build-content.mjs).
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

  // Global entitlement sweep on demand — same ADMIN_TOKEN guard as the
  // other admin routes (404 when the token is unset or wrong). Also
  // reachable as POST /admin/sweep (alias registered below).
  const sweepHandler = async (_req: Request, res: express.Response) => {
    if (!adminGuard(_req)) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const summary = await sweepCompletedSessions("admin");
    res.json({ ok: true, ...summary, grantCount: summary.grants.length });
  };
  app.post("/api/admin/sweep", sweepHandler);
  app.post("/admin/sweep", sweepHandler);

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
        // Let buyers enter a Stripe promotion code at checkout (Oct 27, 2026:
        // enables a 100%-off code so the purchase chain can be test-run
        // without a card). A $0 session completes as
        // payment_status "no_payment_required" — the webhook grant does not
        // gate on payment_status, so the entitlement still lands.
        allow_promotion_codes: true,
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
    // Boot sweep: heal every completed book purchase ~15s after boot,
    // whether or not its buyer ever triggers the per-user reconcile.
    // Fire-and-forget with full error capture — a sweep failure must
    // never affect serving (sweepCompletedSessions already swallows its
    // own errors; the .catch here is belt-and-braces).
    const timer = setTimeout(() => {
      sweepCompletedSessions("boot").catch((err) =>
        console.error("[abisolawrites] boot entitlement sweep failed", err),
      );
    }, 15_000);
    timer.unref?.();
  });
}

main().catch((err) => {
  console.error("[abisolawrites] failed to start", err);
  process.exit(1);
});
