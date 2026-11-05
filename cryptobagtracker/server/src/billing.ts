// Stripe billing helpers for CryptoBagTracker.
//
// PRODUCT ANCHOR (billing redo, Nov 5, 2026 — owner order): every app the
// owner runs shares ONE Stripe account, and a single Stripe customer can
// hold subscriptions for several of her products at once. This module
// therefore recognises a subscription as CryptoBagTracker's plan ONLY when
// one of its items carries the CryptoBagTracker plan price (STRIPE_PRICE_ID,
// the price checkout sells). Subscriptions for any other product — and
// their webhook events — are invisible here: they never write the user
// row's plan state. When Stripe, successfully queried, holds no plan
// subscription for the customer, the stored plan state clears to no-plan
// instead of leaving a phantom "active" behind. This module stands on its
// own anchor; nothing in it is inherited from another product's billing.
//
// All Stripe access is lazy: nothing is constructed at import time, and every
// entry point fails with a clear "Billing is not configured yet." message when
// STRIPE_SECRET_KEY is absent — the app boots and runs fine without Stripe.
//
// Env vars (server-side only, never exposed to the client):
//   STRIPE_SECRET_KEY      Stripe API secret key (sk_live_... / sk_test_...).
//   STRIPE_WEBHOOK_SECRET  Signing secret for the /webhooks/stripe endpoint.
//   STRIPE_PRICE_ID        Price ID for the $8.88/month CryptoAlerts plan.
//                          This is the product anchor: the only price whose
//                          subscriptions count as this product's plan.
//   APP_BASE_URL           Public base URL, e.g. https://<app>.up.railway.app.
//                          Used for checkout success/cancel + portal return
//                          URLs. Falls back to the request origin, then
//                          http://localhost:3000.
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

type Db = NodePgDatabase<typeof schema>;

type UserRow = typeof schema.users.$inferSelect;

/** Statuses that mean the customer has a live plan (matches the read side). */
const SUBSCRIBED_STATUSES: string[] = ["trialing", "active", "past_due"];

/** Per-user read-time reconcile throttle: user id → last sync time. */
const lastReconcileAtByUser = new Map<number, number>();
const RECONCILE_MIN_INTERVAL_MS = 60_000;

function sameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.getTime() === b.getTime();
}

/** Stripe client, or a user-facing error when billing is not configured. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Billing is not configured yet.");
  return new Stripe(key);
}

/** Absolute base URL for Stripe redirects. */
export function baseUrl(origin: string | null): string {
  const raw = process.env.APP_BASE_URL || origin || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/** The CryptoBagTracker plan price ID — the product anchor. */
export function planPriceId(): string | null {
  return process.env.STRIPE_PRICE_ID || null;
}

/**
 * True when this subscription IS the CryptoBagTracker plan: one of its
 * items carries the plan price. Every other subscription on the shared
 * Stripe account (other products, add-ons, anything else) returns false
 * and must be treated as if it did not exist.
 */
export function isPlanSubscription(sub: Stripe.Subscription): boolean {
  const priceId = planPriceId();
  if (!priceId) return false;
  return (sub.items?.data ?? []).some((item) => item.price?.id === priceId);
}

/** Best available "current period end" under the current Stripe billing model:
 *  during a trial it's the trial end (first charge date); otherwise it's the
 *  first subscription item's period end. */
function periodEnd(sub: Stripe.Subscription): Date | null {
  if (sub.status === "trialing" && sub.trial_end) return new Date(sub.trial_end * 1000);
  const end = sub.items?.data?.[0]?.current_period_end;
  return end ? new Date(end * 1000) : null;
}

/** Copy a Stripe subscription's state onto the matching user row.
 *  Foreign-product subscriptions are ignored outright — their state is
 *  not this product's business and must never land on the user row. */
export async function syncSubscription(db: Db, subscription: Stripe.Subscription): Promise<void> {
  if (!isPlanSubscription(subscription)) return;
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.stripeCustomerId, customerId))
    .limit(1);
  const user = rows[0];
  if (!user) {
    console.warn(`stripe webhook: no user found for customer ${customerId}`);
    return;
  }
  await db
    .update(schema.users)
    .set({
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      currentPeriodEnd: periodEnd(subscription),
      subscriptionCancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    })
    .where(eq(schema.users.id, user.id));
}

/**
 * Authoritative billing sync: recompute a user's local billing state
 * from Stripe's actual subscriptions in one pass and write it onto the
 * user row. Only plan subscriptions (see isPlanSubscription) take part;
 * if Stripe holds none for this customer, the row clears to no-plan —
 * status "none" when the account never had a plan, "canceled" when a
 * plan it had is simply gone from Stripe — so no phantom state survives.
 * Returns true when the persisted fields actually changed.
 */
export async function syncBillingForCustomer(
  db: Db,
  stripe: Stripe,
  customerId: string,
): Promise<boolean> {
  // Without the anchor price there is no safe way to tell this product's
  // subscriptions from another product's: touch nothing.
  if (!planPriceId()) return false;
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.stripeCustomerId, customerId))
    .limit(1);
  const user = rows[0];
  if (!user) {
    console.warn(`stripe billing sync: no user found for customer ${customerId}`);
    return false;
  }

  const subs = (await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 })).data;
  const planSubs = subs.filter(isPlanSubscription);
  // Prefer a live plan subscription (the recorded one first, then any
  // live one — a re-subscription must win over a recorded-but-canceled
  // predecessor), falling back to the recorded / newest plan candidate.
  const chosen =
    planSubs.find((s) => s.id === user.stripeSubscriptionId && SUBSCRIBED_STATUSES.includes(s.status)) ??
    planSubs.find((s) => SUBSCRIBED_STATUSES.includes(s.status)) ??
    planSubs.find((s) => s.id === user.stripeSubscriptionId) ??
    planSubs[0] ??
    null;

  const next = {
    stripeSubscriptionId: chosen ? chosen.id : null,
    subscriptionStatus: chosen
      ? chosen.status
      : user.subscriptionStatus === "none"
        ? "none"
        : "canceled",
    currentPeriodEnd: chosen ? periodEnd(chosen) : null,
    subscriptionCancelAtPeriodEnd: chosen ? chosen.cancel_at_period_end === true : false,
  };
  const changed =
    next.stripeSubscriptionId !== user.stripeSubscriptionId ||
    next.subscriptionStatus !== user.subscriptionStatus ||
    !sameDate(next.currentPeriodEnd, user.currentPeriodEnd) ||
    next.subscriptionCancelAtPeriodEnd !== user.subscriptionCancelAtPeriodEnd;
  if (changed) {
    await db.update(schema.users).set(next).where(eq(schema.users.id, user.id));
  }
  return changed;
}

/**
 * Read-time reconciliation: rebuild a user's local billing state from
 * Stripe's actual state. This makes billing self-healing — the webhook
 * (see handleStripeEvent) is still a sync path, but a completed checkout
 * must never be stranded by a webhook endpoint that was never registered
 * in the Stripe dashboard or a signing-secret mismatch: the next billing
 * read repairs the local row from Stripe.
 *
 * Billing reads invoke this at most once per minute per user
 * (in-process throttle): in the steady state it costs one
 * subscriptions.list for the customer already bound to the user row.
 *
 * The Stripe customer is bound ONLY by this product's own checkout flow
 * (created at checkout with the user id in its metadata, then bound by
 * the anchored checkout.session.completed handler). There is deliberately
 * NO find-customer-by-email fallback: on the shared Stripe account an
 * email search can surface a customer created by another product's flow,
 * and binding it would import that product's billing history into this
 * account. A row with no bound customer has nothing to reconcile.
 *
 * Returns true when local state was created or repaired. Never throws —
 * a Stripe outage must not break the billing page; the caller falls back
 * to the local state it already had.
 */
export async function reconcileSubscriptionFromStripe(db: Db, user: UserRow): Promise<boolean> {
  const nowMs = Date.now();
  const last = lastReconcileAtByUser.get(user.id) ?? 0;
  if (nowMs - last < RECONCILE_MIN_INTERVAL_MS) return false;
  if (!process.env.STRIPE_SECRET_KEY) return false;
  // No customer bound through this product's own checkout → nothing to
  // reconcile. Never go looking for one by email (see header note).
  if (!user.stripeCustomerId) return false;
  lastReconcileAtByUser.set(user.id, nowMs);
  try {
    const stripe = getStripe();
    return await syncBillingForCustomer(db, stripe, user.stripeCustomerId);
  } catch (err) {
    // Refund the throttle on failure so the next billing read retries
    // promptly instead of waiting out the interval on stale state.
    lastReconcileAtByUser.delete(user.id);
    console.error(
      `billing reconcile failed for user ${user.id}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

async function markCanceled(db: Db, subscription: Stripe.Subscription): Promise<void> {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.stripeCustomerId, customerId))
    .limit(1);
  const user = rows[0];
  if (!user) {
    console.warn(`stripe webhook: no user found for customer ${customerId}`);
    return;
  }
  // A foreign product's subscription ending changes nothing here. The
  // deleted subscription counts only when it is the plan (price anchor)
  // or the very subscription recorded on this user.
  if (subscription.id !== user.stripeSubscriptionId && !isPlanSubscription(subscription)) return;
  await db
    .update(schema.users)
    .set({
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: "canceled",
      currentPeriodEnd: periodEnd(subscription),
      subscriptionCancelAtPeriodEnd: false,
    })
    .where(eq(schema.users.id, user.id));
}

/** The subscription ID an invoice belongs to, across Stripe API shapes:
 *  the legacy top-level field, or the current parent.subscription_details. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const inv = invoice as unknown as {
    subscription?: string | { id: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  };
  const ref = inv.subscription ?? inv.parent?.subscription_details?.subscription ?? null;
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

async function markPastDue(db: Db, stripe: Stripe, invoice: Stripe.Invoice): Promise<void> {
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.stripeCustomerId, customerId))
    .limit(1);
  const user = rows[0];
  if (!user) {
    console.warn(`stripe webhook: no user found for customer ${customerId}`);
    return;
  }
  // A failed payment marks this user past due only when the invoice is
  // for THIS product's plan: the recorded subscription, or a subscription
  // carrying the plan price. Another product's failed invoice must never
  // lock (or stain) this product's account.
  const subId = invoiceSubscriptionId(invoice);
  if (!subId) return;
  if (subId !== user.stripeSubscriptionId) {
    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.retrieve(subId);
    } catch {
      // Cannot verify the invoice's subscription — leave the row alone;
      // the read-time reconcile from Stripe remains the authority.
      return;
    }
    if (!isPlanSubscription(sub)) return;
  }
  await db
    .update(schema.users)
    .set({ subscriptionStatus: "past_due" })
    .where(eq(schema.users.id, user.id));
}

/**
 * Handle a verified Stripe webhook event. The caller is responsible for
 * signature verification; this only applies the business logic. The shared
 * Stripe account delivers events for ALL of the owner's products to this
 * endpoint — the product anchor inside each handler is what keeps other
 * products' events from touching this product's accounts.
 */
export async function handleStripeEvent(db: Db, stripe: Stripe, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (!subscriptionId) break;
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      // Only this product's checkout may bind a customer or write plan
      // state. Another product's session can carry a client_reference_id
      // that numerically matches one of this app's user ids — the price
      // anchor, not the reference, decides.
      if (!isPlanSubscription(sub)) break;
      const userId = Number(session.client_reference_id);
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (userId && customerId) {
        await db
          .update(schema.users)
          .set({ stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId })
          .where(eq(schema.users.id, userId));
      }
      await syncSubscription(db, sub);
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      await syncSubscription(db, event.data.object as Stripe.Subscription);
      break;
    }
    case "customer.subscription.deleted": {
      await markCanceled(db, event.data.object as Stripe.Subscription);
      break;
    }
    case "invoice.payment_failed": {
      await markPastDue(db, stripe, event.data.object as Stripe.Invoice);
      break;
    }
    default:
      // Ignore every other event type.
      break;
  }
}

/**
 * Express handler for POST /webhooks/stripe.
 * Must be mounted with express.raw({type: "application/json"}) BEFORE
 * express.json() — Stripe's signature covers the raw request bytes.
 * Returns {ok:true} on success. Config/signature failures carry no
 * explicit status (the caller maps them to HTTP 400); a failure while
 * APPLYING a verified event carries status 500 so the caller answers
 * 5xx and Stripe retries the delivery instead of treating it as done.
 */
export async function stripeWebhookHandler(
  db: Db,
  rawBody: Buffer,
  signature: string | undefined,
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!webhookSecret || !apiKey) return { ok: false, error: "Billing is not configured." };
  const stripe = new Stripe(apiKey);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature ?? "", webhookSecret);
  } catch {
    return { ok: false, error: "Invalid webhook signature." };
  }
  try {
    await handleStripeEvent(db, stripe, event);
  } catch (err) {
    console.error("stripe webhook handler error:", err instanceof Error ? err.message : err);
    // Answer 5xx (via the caller's status mapping) so Stripe retries
    // this delivery. Returning ok here would mark a failed grant as
    // delivered, stranding it until a billing read happens to reconcile.
    return { ok: false, status: 500, error: "Webhook handler failed." };
  }
  return { ok: true };
}
