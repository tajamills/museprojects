// Billing anchor for Abisola Writes (billing redo, Nov 5, 2026 — owner
// order: "Redo billing for ALL").
//
// Layla's apps share ONE Stripe account. The rule for this module, in her
// framing: this product's billing sees ONLY its own Stripe product.
// Nothing from another product may create, alter, or revoke anything here.
//
// What "its own" means for this app: Abisola checkout creates one-time
// payment sessions with inline price_data taken from the server catalog
// (server/src/catalog.ts) — there are no pre-created Stripe Price objects
// for these books, so the durable identity of an Abisola purchase on a
// Checkout Session is the combination verified below:
//
//   1. session.mode === "payment"            (never a subscription/setup)
//   2. session.status === "complete"
//   3. session.payment_status is "paid" or "no_payment_required"
//      (the latter is the 100%-off promotion-code case, $0 due — the
//      owner deliberately keeps that path grant-eligible)
//   4. session.metadata.itemId names a book in the server catalog
//   5. the session's line items, read back from Stripe, are EXACTLY one
//      item of quantity 1 whose price is the catalog amount in USD and
//      whose product name is the catalog item's name
//
// Checks 1–4 are free (fields on the session object); check 5 is one
// Stripe read made only for sessions that pass 1–4. A session failing ANY
// check grants nothing — a CryptoAlerts subscription completion, a Kovala
// checkout, or any other product's event arriving at this app's webhook
// endpoint is invisible to the entitlement logic.
//
// Every grant path (Stripe webhook, per-user reconcile, global sweep)
// funnels through grantVerifiedCheckoutSession below, so the anchor is
// enforced identically everywhere and entitlements are always rebuildable
// from Stripe's own records, never from webhook delivery alone.
//
// Refund rule (UNCHANGED, pre-existing product behavior): refunds and
// chargebacks do NOT revoke access — no charge.refunded / dispute handler
// exists and none is added here. Lifetime access is removed only by the
// owner through POST /api/admin/revoke. Manual comp grants via
// POST /api/admin/grant (source "manual") are likewise untouched.
import { BOOK_ITEM_IDS, CATALOG, type CatalogItem } from "./catalog.js";
import { normalizeEmail } from "./auth.js";
import type { Store } from "./store.js";

/** Build marker surfaced on /healthz so a deploy is provable from outside. */
export const BUILD_TAG = "2026-11-05-abisola-billing-product-anchor";

/** The subset of a Stripe Checkout Session this module reads. */
export interface CheckoutSessionLike {
  id: string;
  mode?: string | null;
  status?: string | null;
  payment_status?: string | null;
  client_reference_id?: string | null;
  customer_email?: string | null;
  customer_details?: { email?: string | null } | null;
  metadata?: Record<string, string> | null;
}

/** The subset of a Stripe checkout LineItem this module reads. */
export interface LineItemLike {
  quantity?: number | null;
  description?: string | null;
  price?: {
    unit_amount?: number | null;
    currency?: string | null;
    product?: string | { name?: string | null } | null;
  } | null;
}

/** Reads a session's line items back from Stripe (expanded price.product). */
export type LineItemsFetcher = (sessionId: string) => Promise<LineItemLike[]>;

const PAID_STATUSES: ReadonlySet<string> = new Set(["paid", "no_payment_required"]);

/** The catalog entry a session claims to be for, or null. */
export function claimedBookItem(session: CheckoutSessionLike): CatalogItem | null {
  const itemId = session.metadata?.itemId ?? "";
  if (!BOOK_ITEM_IDS.has(itemId)) return null;
  return CATALOG[itemId] ?? null;
}

/**
 * Verify, against Stripe's own records, that a completed Checkout Session
 * is a genuine Abisola Writes book purchase. Returns the verified catalog
 * item, or null when the session is anything else — foreign product,
 * subscription, unpaid, or not matching the catalog anchor. Never throws:
 * a Stripe read failure verifies nothing (the reconcile/sweep paths will
 * retry later), it must never crash the caller.
 */
export async function verifyAbisolaBookSession(
  fetchLineItems: LineItemsFetcher | null,
  session: CheckoutSessionLike,
): Promise<CatalogItem | null> {
  const item = claimedBookItem(session);
  if (!item) return null;
  if (session.mode !== "payment") return null;
  if (session.status !== "complete") return null;
  if (!PAID_STATUSES.has(session.payment_status ?? "")) return null;
  if (!fetchLineItems) return null;
  let lineItems: LineItemLike[];
  try {
    lineItems = await fetchLineItems(session.id);
  } catch {
    return null;
  }
  if (lineItems.length !== 1) return null;
  const li = lineItems[0];
  if ((li.quantity ?? 0) !== 1) return null;
  const price = li.price;
  if (!price) return null;
  if (price.currency !== "usd") return null;
  if (price.unit_amount !== item.amountCents) return null;
  const productName =
    li.description ??
    (typeof price.product === "object" && price.product ? price.product.name : null);
  if (productName !== item.name) return null;
  return item;
}

export interface GrantDeps {
  /** Null when Stripe is not configured — then nothing can be verified. */
  fetchLineItems: LineItemsFetcher | null;
  store: Store;
}

/**
 * THE grant seam: verify a completed session against the Abisola anchor,
 * then record the lifetime entitlement. Identity comes from
 * client_reference_id / metadata.userId (set by /api/checkout for signed-in
 * buyers) with the Stripe-collected email as fallback. Idempotency lives
 * in the store (dedupe on stripe_session_id and on book+user/email), so
 * webhook + reconcile + sweep can all call this for the same session.
 * Returns true only when a NEW entitlement was inserted.
 */
export async function grantVerifiedCheckoutSession(
  deps: GrantDeps,
  session: CheckoutSessionLike,
  via: "webhook" | "reconciled" | "sweep",
): Promise<boolean> {
  const item = await verifyAbisolaBookSession(deps.fetchLineItems, session);
  if (!item) return false;
  const userId = session.client_reference_id || session.metadata?.userId || null;
  const email = normalizeEmail(
    session.customer_details?.email ?? session.customer_email ?? session.metadata?.email ?? "",
  );
  const inserted = await deps.store.grantEntitlement({
    userId,
    email: email || null,
    bookId: item.id,
    source: "stripe",
    stripeSessionId: session.id,
  });
  if (inserted) {
    console.log(
      `[abisolawrites] entitlement granted via ${via}: ${item.id} -> ${userId ?? email ?? "?"} (session ${session.id})`,
    );
  }
  return inserted;
}
