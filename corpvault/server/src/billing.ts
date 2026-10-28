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

type AccountRow = typeof schema.accounts.$inferSelect;

/** Statuses that mean the customer has a live plan (matches the read side). */
const SUBSCRIBED_STATUSES: string[] = ["trialing", "active", "past_due"];

/** Per-account read-time reconcile throttle: account id → last sync time. */
const lastReconcileAtByAccount = new Map<number, number>();
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
  // Bank Sync add-on subscriptions belong to their per-entity row, never
  // to the account's base-plan fields.
  if (await syncBankSyncAddon(db, subscription)) return;
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

/**
 * Authoritative billing sync: recompute an account's local billing state
 * from Stripe's actual subscriptions in one pass and write it onto the
 * account row. Returns true when the persisted fields actually changed.
 * Ported from Zepostia's syncBillingForCustomer (single-plan version).
 */
export async function syncBillingForCustomer(
  db: Db,
  stripe: Stripe,
  customerId: string,
): Promise<boolean> {
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.stripeCustomerId, customerId))
    .limit(1);
  const account = rows[0];
  if (!account) {
    console.warn(`stripe billing sync: no account found for customer ${customerId}`);
    return false;
  }

  const subs = (await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 })).data;
  // Bank Sync add-on subscriptions are reconciled separately (per entity);
  // they must never be mistaken for the base plan here.
  const planSubs = subs.filter((s) => s.metadata?.addon !== "bank_sync");
  if (!planSubs.length) return false;
  // Prefer a live subscription (the recorded one first, then any live
  // one — a re-subscription must win over a recorded-but-canceled
  // predecessor), falling back to the recorded / newest candidate.
  const chosen =
    planSubs.find((s) => s.id === account.stripeSubscriptionId && SUBSCRIBED_STATUSES.includes(s.status)) ??
    planSubs.find((s) => SUBSCRIBED_STATUSES.includes(s.status)) ??
    planSubs.find((s) => s.id === account.stripeSubscriptionId) ??
    planSubs[0] ??
    null;

  const next = {
    stripeSubscriptionId: chosen ? chosen.id : account.stripeSubscriptionId,
    subscriptionStatus: chosen
      ? chosen.status
      : account.subscriptionStatus === "none"
        ? "none"
        : "canceled",
    currentPeriodEnd: chosen ? periodEnd(chosen) : null,
  };
  const changed =
    next.stripeSubscriptionId !== account.stripeSubscriptionId ||
    next.subscriptionStatus !== account.subscriptionStatus ||
    !sameDate(next.currentPeriodEnd, account.currentPeriodEnd);
  if (changed) {
    await db.update(schema.accounts).set(next).where(eq(schema.accounts.id, account.id));
  }
  return changed;
}

/**
 * Read-time reconciliation: rebuild an account's local billing state from
 * Stripe's actual state. This makes billing self-healing — the webhook
 * (see handleStripeEvent) is still the primary sync path, but a completed
 * checkout must never be stranded by a webhook endpoint that was never
 * registered in the Stripe dashboard or a signing-secret mismatch: the
 * next billing read repairs the local row from Stripe.
 *
 * Billing reads invoke this at most once per minute per account
 * (in-process throttle): in the steady state it costs one
 * subscriptions.list for the customer (plus a customer lookup when the
 * row has no Stripe customer ID yet).
 *
 * Returns true when local state was created or repaired. Never throws —
 * a Stripe outage must not break the billing page; the caller falls back
 * to the local state it already had. When no Stripe customer or
 * subscription exists for the account, the local row is left exactly
 * as-is — a grant is never fabricated.
 */
export async function reconcileSubscriptionFromStripe(db: Db, account: AccountRow): Promise<boolean> {
  const nowMs = Date.now();
  const last = lastReconcileAtByAccount.get(account.id) ?? 0;
  if (nowMs - last < RECONCILE_MIN_INTERVAL_MS) return false;
  if (!process.env.STRIPE_SECRET_KEY) return false;
  lastReconcileAtByAccount.set(account.id, nowMs);
  try {
    const stripe = getStripe();

    let customerId = account.stripeCustomerId;
    if (!customerId) {
      // The row never got its Stripe customer bound (checkout completed
      // without the binding webhook and the session-time write was
      // lost). Find the customer by email: prefer one that carries a
      // live subscription, else the newest customer with any
      // subscription on file.
      const customers = await stripe.customers.list({ email: account.email, limit: 10 });
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
        .update(schema.accounts)
        .set({ stripeCustomerId: customerId })
        .where(eq(schema.accounts.id, account.id));
    }

    return await syncBillingForCustomer(db, stripe, customerId);
  } catch (err) {
    // Refund the throttle on failure so the next billing read retries
    // promptly instead of waiting out the interval on stale state.
    lastReconcileAtByAccount.delete(account.id);
    console.error(
      `billing reconcile failed for account ${account.id}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Bank Sync add-on ($8.88/month per entity) — a SEPARATE Stripe
 * subscription per business, identified by subscription metadata
 * (addon='bank_sync', entityId). Its state mirrors onto bk_sync_addons
 * exactly the way the base plan mirrors onto the accounts row: webhook
 * first, throttled read-time reconcile as the repair path. The purchase
 * flow exists only while STRIPE_BANK_SYNC_PRICE_ID is set; the owner
 * creates that price in Stripe herself.
 */
/**
 * Fallback Bank Sync price ID, used only when STRIPE_BANK_SYNC_PRICE_ID
 * is not set in the environment. The product is "Kovala -Plaid- Bank
 * Sync" (prod_VWflyMfG9ZCmEE), $8.88/month recurring, created by the
 * owner in Stripe; this is its default price as read from the owner's
 * Stripe dashboard (transcribed from a screen photo — the resolved ID
 * is logged at server startup, and a "no such price" answer from Stripe
 * at checkout is treated as a server config error, so a transcription
 * slip is diagnosable instead of silently breaking purchases).
 */
export const BANK_SYNC_PRICE_ID_FALLBACK: string | null = "price_1UVbxVAXuTzNcQX7Ed0li4Ii";

export function bankSyncPriceId(): string | null {
  return process.env.STRIPE_BANK_SYNC_PRICE_ID || BANK_SYNC_PRICE_ID_FALLBACK;
}

type AddonRow = typeof schema.bkSyncAddons.$inferSelect;

/**
 * Upsert the per-entity add-on row from a Stripe subscription. Returns
 * false when the subscription is not a bank-sync add-on (so callers can
 * fall through to base-plan handling), true when it was routed here.
 */
export async function syncBankSyncAddon(db: Db, subscription: Stripe.Subscription): Promise<boolean> {
  if (subscription.metadata?.addon !== "bank_sync") return false;
  const entityId = Number(subscription.metadata?.entityId);
  if (!entityId) return false;
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
    return true;
  }
  const values = {
    accountId: account.id,
    entityId,
    stripeSubscriptionId: subscription.id,
    stripeItemId: subscription.items?.data?.[0]?.id ?? null,
    status: subscription.status,
    currentPeriodEnd: periodEnd(subscription),
    updatedAt: new Date(),
  };
  const existing = await db
    .select({ id: schema.bkSyncAddons.id })
    .from(schema.bkSyncAddons)
    .where(eq(schema.bkSyncAddons.entityId, entityId))
    .limit(1);
  if (existing[0]) {
    await db.update(schema.bkSyncAddons).set(values).where(eq(schema.bkSyncAddons.id, existing[0].id));
  } else {
    await db.insert(schema.bkSyncAddons).values(values);
  }
  return true;
}

/** Per-entity read-time reconcile throttle (same interval as accounts). */
const lastAddonReconcileAtByEntity = new Map<number, number>();

/**
 * Read-time reconciliation for one entity's add-on, mirroring
 * reconcileSubscriptionFromStripe: rebuild the local row from Stripe's
 * actual subscriptions for the account's customer, so a completed
 * add-on checkout stranded by a lost webhook is repaired on the next
 * Books read. Never throws; falls back to the local row.
 */
export async function reconcileBankSyncAddon(
  db: Db,
  account: AccountRow,
  entityId: number,
): Promise<AddonRow | null> {
  const readRow = async (): Promise<AddonRow | null> => {
    const rows = await db
      .select()
      .from(schema.bkSyncAddons)
      .where(eq(schema.bkSyncAddons.entityId, entityId))
      .limit(1);
    return rows[0] ?? null;
  };
  const current = await readRow();
  const nowMs = Date.now();
  const last = lastAddonReconcileAtByEntity.get(entityId) ?? 0;
  if (nowMs - last < RECONCILE_MIN_INTERVAL_MS) return current;
  if (!process.env.STRIPE_SECRET_KEY || !account.stripeCustomerId) return current;
  lastAddonReconcileAtByEntity.set(entityId, nowMs);
  try {
    const stripe = getStripe();
    const subs = (await stripe.subscriptions.list({ customer: account.stripeCustomerId, status: "all", limit: 20 })).data;
    const mine = subs
      .filter((s) => s.metadata?.addon === "bank_sync" && Number(s.metadata?.entityId) === entityId)
      .sort((a, b) => b.created - a.created);
    const chosen = mine.find((s) => SUBSCRIBED_STATUSES.includes(s.status)) ?? mine[0] ?? null;
    if (chosen) {
      await syncBankSyncAddon(db, chosen);
    } else if (current && SUBSCRIBED_STATUSES.includes(current.status)) {
      // Stripe shows no add-on subscription for this entity anymore (e.g.
      // canceled in the Stripe portal with the webhook missed): pause it
      // locally. The entity's imported transactions are never touched.
      await db
        .update(schema.bkSyncAddons)
        .set({ status: "canceled", updatedAt: new Date() })
        .where(eq(schema.bkSyncAddons.id, current.id));
    }
    return await readRow();
  } catch (err) {
    lastAddonReconcileAtByEntity.delete(entityId);
    console.error(
      `bank-sync reconcile failed for entity ${entityId}:`,
      err instanceof Error ? err.message : err,
    );
    return current;
  }
}

/**
 * Sync entitlement for one entity: the owner's account is comped (the
 * ADMIN_EMAILS pattern — admin role, never charged, never revenue);
 * everyone else needs a live add-on subscription for that entity.
 */
export function bankSyncEntitled(addon: AddonRow | null, account: AccountRow): boolean {
  if (account.role === "admin") return true;
  return Boolean(addon && SUBSCRIBED_STATUSES.includes(addon.status));
}

async function markCanceled(db: Db, subscription: Stripe.Subscription): Promise<void> {
  if (await syncBankSyncAddon(db, subscription)) return;
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
  // A failed payment on a Bank Sync add-on pauses only that add-on.
  const subRef = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
  const subId = typeof subRef === "string" ? subRef : subRef?.id;
  if (subId && process.env.STRIPE_SECRET_KEY) {
    try {
      const sub = await getStripe().subscriptions.retrieve(subId);
      if (sub.metadata?.addon === "bank_sync") {
        await db
          .update(schema.bkSyncAddons)
          .set({ status: "past_due", updatedAt: new Date() })
          .where(eq(schema.bkSyncAddons.stripeSubscriptionId, subId));
        return;
      }
    } catch {
      // Fall through to the base-plan handling.
    }
  }
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
            // An add-on checkout must not rebind the account's recorded
            // base-plan subscription; syncSubscription routes it below.
            ...(subscriptionId && session.metadata?.addon !== "bank_sync"
              ? { stripeSubscriptionId: subscriptionId }
              : {}),
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
    // Answer 5xx (via the caller's status mapping) so Stripe retries
    // this delivery. Returning ok here would mark a failed grant as
    // delivered, stranding it until a billing read happens to reconcile.
    return { ok: false, status: 500, error: "Webhook handler failed." };
  }
  return { ok: true };
}
