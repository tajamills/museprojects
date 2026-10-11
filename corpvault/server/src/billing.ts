// Stripe billing helpers for kovala.
//
// Ported from CryptoBagTracker's server/src/billing.ts. Differences:
// - The user table is `accounts` (not `users`).
// - The $199/year plan charges IMMEDIATELY at checkout — no trial.
// - The webhook signing secret is read from STRIPE_WEBHOOK_SECRET first,
//   falling back to STRIPE_WEBHOOK (the name the owner used in Railway).
//
// All Stripe access is lazy: nothing is constructed at import time, and every
// entry point fails with a clear "Billing is not configured yet." message when
// STRIPE_SECRET_KEY is absent — the app boots and runs fine without Stripe.
//
// Env vars (server-side only, never exposed to the client):
//   STRIPE_SECRET_KEY      Stripe API secret key (sk_live_... / sk_test_...).
//   STRIPE_WEBHOOK_SECRET  Signing secret for the /webhooks/stripe endpoint
//                          (preferred).
//   STRIPE_WEBHOOK         Fallback signing secret (Railway variable name).
//   STRIPE_PRICE_ID        Price ID for the $199/year kovala plan.
//   APP_BASE_URL           Public base URL, e.g. https://kovala.io.
//                          Used for checkout success/cancel + portal return
//                          URLs. Falls back to the request origin, then
//                          http://localhost:3000.
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

type Db = NodePgDatabase<typeof schema>;

/** Stripe client, or a user-facing error when billing is not configured. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Billing is not configured yet.");
  return new Stripe(key);
}

/** Webhook signing secret: STRIPE_WEBHOOK_SECRET preferred, STRIPE_WEBHOOK fallback. */
export function getWebhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK || undefined;
}

/** Absolute base URL for Stripe redirects. */
export function baseUrl(origin: string | null): string {
  const raw = process.env.APP_BASE_URL || origin || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/** Best available "current period end" for the subscription. */
function periodEnd(sub: Stripe.Subscription): Date | null {
  const end = sub.items?.data?.[0]?.current_period_end;
  return end ? new Date(end * 1000) : null;
}

/** Copy a Stripe subscription's state onto the matching account row. */
export async function syncSubscription(db: Db, subscription: Stripe.Subscription): Promise<void> {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.stripeCustomerId, customerId))
    .limit(1);
  const account = rows[0];
  if (!account) {
    console.warn(`stripe webhook: no account found for customer ${customerId}`);
    return;
  }
  await db
    .update(schema.accounts)
    .set({
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      currentPeriodEnd: periodEnd(subscription),
    })
    .where(eq(schema.accounts.id, account.id));
}

async function markCanceled(db: Db, subscription: Stripe.Subscription): Promise<void> {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.stripeCustomerId, customerId))
    .limit(1);
  const account = rows[0];
  if (!account) {
    console.warn(`stripe webhook: no account found for customer ${customerId}`);
    return;
  }
  await db
    .update(schema.accounts)
    .set({
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: "canceled",
      currentPeriodEnd: periodEnd(subscription),
    })
    .where(eq(schema.accounts.id, account.id));
}

async function markPastDue(db: Db, invoice: Stripe.Invoice): Promise<void> {
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.stripeCustomerId, customerId))
    .limit(1);
  const account = rows[0];
  if (!account) {
    console.warn(`stripe webhook: no account found for customer ${customerId}`);
    return;
  }
  await db
    .update(schema.accounts)
    .set({ subscriptionStatus: "past_due" })
    .where(eq(schema.accounts.id, account.id));
}

/**
 * Handle a verified Stripe webhook event. The caller is responsible for
 * signature verification; this only applies the business logic.
 */
export async function handleStripeEvent(db: Db, stripe: Stripe, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const accountId = Number(session.client_reference_id);
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (accountId && customerId) {
        await db
          .update(schema.accounts)
          .set({
            stripeCustomerId: customerId,
            ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
          })
          .where(eq(schema.accounts.id, accountId));
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
 * Returns {ok:true} on success; the caller maps failures to HTTP 400.
 */
export async function stripeWebhookHandler(
  db: Db,
  rawBody: Buffer,
  signature: string | undefined,
): Promise<{ ok: boolean; error?: string }> {
  const webhookSecret = getWebhookSecret();
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
  }
  return { ok: true };
}
