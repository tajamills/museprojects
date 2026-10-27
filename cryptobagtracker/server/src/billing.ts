// Stripe billing helpers for CryptoBagTracker.
//
// All Stripe access is lazy: nothing is constructed at import time, and every
// entry point fails with a clear "Billing is not configured yet." message when
// STRIPE_SECRET_KEY is absent — the app boots and runs fine without Stripe.
//
// Env vars (server-side only, never exposed to the client):
//   STRIPE_SECRET_KEY      Stripe API secret key (sk_live_... / sk_test_...).
//   STRIPE_WEBHOOK_SECRET  Signing secret for the /webhooks/stripe endpoint.
//   STRIPE_PRICE_ID        Price ID for the $8.88/month Premium plan.
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

/** Best available "current period end" under the current Stripe billing model:
 *  during a trial it's the trial end (first charge date); otherwise it's the
 *  first subscription item's period end. */
function periodEnd(sub: Stripe.Subscription): Date | null {
  if (sub.status === "trialing" && sub.trial_end) return new Date(sub.trial_end * 1000);
  const end = sub.items?.data?.[0]?.current_period_end;
  return end ? new Date(end * 1000) : null;
}

/** Copy a Stripe subscription's state onto the matching user row. */
export async function syncSubscription(db: Db, subscription: Stripe.Subscription): Promise<void> {
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
    })
    .where(eq(schema.users.id, user.id));
}

/**
 * Authoritative billing sync: recompute a user's local billing state
 * from Stripe's actual subscriptions in one pass and write it onto the
 * user row. Returns true when the persisted fields actually changed.
 * Ported from Zepostia's syncBillingForCustomer (single-plan version).
 */
export async function syncBillingForCustomer(
  db: Db,
  stripe: Stripe,
  customerId: string,
): Promise<boolean> {
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
  // Prefer a live subscription (the recorded one first, then any live
  // one — a re-subscription must win over a recorded-but-canceled
  // predecessor), falling back to the recorded / newest candidate.
  const chosen =
    subs.find((s) => s.id === user.stripeSubscriptionId && SUBSCRIBED_STATUSES.includes(s.status)) ??
    subs.find((s) => SUBSCRIBED_STATUSES.includes(s.status)) ??
    subs.find((s) => s.id === user.stripeSubscriptionId) ??
    subs[0] ??
    null;

  const next = {
    stripeSubscriptionId: chosen ? chosen.id : user.stripeSubscriptionId,
    subscriptionStatus: chosen
      ? chosen.status
      : user.subscriptionStatus === "none"
        ? "none"
        : "canceled",
    currentPeriodEnd: chosen ? periodEnd(chosen) : null,
  };
  const changed =
    next.stripeSubscriptionId !== user.stripeSubscriptionId ||
    next.subscriptionStatus !== user.subscriptionStatus ||
    !sameDate(next.currentPeriodEnd, user.currentPeriodEnd);
  if (changed) {
    await db.update(schema.users).set(next).where(eq(schema.users.id, user.id));
  }
  return changed;
}

/**
 * Read-time reconciliation: rebuild a user's local billing state from
 * Stripe's actual state. This makes billing self-healing — the webhook
 * (see handleStripeEvent) is still the primary sync path, but a completed
 * checkout must never be stranded by a webhook endpoint that was never
 * registered in the Stripe dashboard or a signing-secret mismatch: the
 * next billing read repairs the local row from Stripe.
 *
 * Billing reads invoke this at most once per minute per user
 * (in-process throttle): in the steady state it costs one
 * subscriptions.list for the customer (plus a customer lookup when the
 * row has no Stripe customer ID yet).
 *
 * Returns true when local state was created or repaired. Never throws —
 * a Stripe outage must not break the billing page; the caller falls back
 * to the local state it already had. When no Stripe customer or
 * subscription exists for the user, the local row is left exactly
 * as-is — a grant is never fabricated.
 */
export async function reconcileSubscriptionFromStripe(db: Db, user: UserRow): Promise<boolean> {
  const nowMs = Date.now();
  const last = lastReconcileAtByUser.get(user.id) ?? 0;
  if (nowMs - last < RECONCILE_MIN_INTERVAL_MS) return false;
  if (!process.env.STRIPE_SECRET_KEY) return false;
  lastReconcileAtByUser.set(user.id, nowMs);
  try {
    const stripe = getStripe();

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      // The row never got its Stripe customer bound (checkout completed
      // without the binding webhook and the session-time write was
      // lost). Find the customer by email: prefer one that carries a
      // live subscription, else the newest customer with any
      // subscription on file.
      const customers = await stripe.customers.list({ email: user.email, limit: 10 });
      let fallbackCustomerId: string | null = null;
      for (const customer of customers.data) {
        if (customer.deleted) continue;
        const subs = await stripe.subscriptions.list({ customer: customer.id, status: "all", limit: 10 });
        if (subs.data.some((sub) => SUBSCRIBED_STATUSES.includes(sub.status))) {
          customerId = customer.id;
          break;
        }
        if (!fallbackCustomerId && subs.data.length > 0) fallbackCustomerId = customer.id;
      }
      customerId = customerId ?? fallbackCustomerId;
      if (!customerId) return false;
      await db
        .update(schema.users)
        .set({ stripeCustomerId: customerId })
        .where(eq(schema.users.id, user.id));
    }

    return await syncBillingForCustomer(db, stripe, customerId);
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
  await db
    .update(schema.users)
    .set({
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: "canceled",
      currentPeriodEnd: periodEnd(subscription),
    })
    .where(eq(schema.users.id, user.id));
}

async function markPastDue(db: Db, invoice: Stripe.Invoice): Promise<void> {
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
  await db
    .update(schema.users)
    .set({ subscriptionStatus: "past_due" })
    .where(eq(schema.users.id, user.id));
}

/**
 * Handle a verified Stripe webhook event. The caller is responsible for
 * signature verification; this only applies the business logic.
 */
export async function handleStripeEvent(db: Db, stripe: Stripe, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = Number(session.client_reference_id);
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (userId && customerId) {
        await db
          .update(schema.users)
          .set({
            stripeCustomerId: customerId,
            ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
          })
          .where(eq(schema.users.id, userId));
      }
      if (subscriptionId) {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        await syncSubscription(db, sub);
      }
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
      await markPastDue(db, event.data.object as Stripe.Invoice);
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
