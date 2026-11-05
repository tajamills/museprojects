// Stripe billing helpers for kovala — this module is Kovala's own
// billing implementation, written for Kovala's Stripe product and no
// other. (An earlier version classified subscriptions by exclusion and
// adopted another product's subscription as the plan; see planPriceId.)
//
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
import { isAdminEmail } from "./admin.js";
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

/**
 * The Kovala plan price: the $199.88/year price on the Kovala product in
 * Stripe, configured via STRIPE_PRICE_ID — the same source the checkout
 * flow (createCheckoutSession in actions.ts) charges for the plan.
 * Plan state is anchored on THIS price, positively: a subscription is
 * the base plan only when one of its items carries the Kovala plan
 * price. Never classify by exclusion — the owner's Stripe account is
 * shared across her products, so "not a Bank Sync add-on" is not
 * evidence a subscription is the Kovala plan (a CryptoBagTracker
 * subscription on the shared customer once posed as the plan and its
 * period end rendered as the plan's renewal date).
 */
export function planPriceId(): string | null {
  return process.env.STRIPE_PRICE_ID || null;
}

/** True when the subscription carries the Kovala plan price on any item. */
export function isPlanSubscription(sub: Stripe.Subscription): boolean {
  const priceId = planPriceId();
  if (!priceId) return false;
  return (sub.items?.data ?? []).some((item) => item.price?.id === priceId);
}

/**
 * The owner's account is comped: stored admin role OR an email on the
 * admin list (ADMIN_EMAILS / code list in admin.js). A comped account is
 * never charged and never sent to checkout, for the base plan and the
 * Bank Sync add-on alike. Every billing surface (status read, checkout
 * creation, add-on entitlement) honors this one check.
 */
export function isCompedAccount(account: Pick<AccountRow, "role" | "email">): boolean {
  return account.role === "admin" || isAdminEmail(account.email);
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
  // Shared Stripe account: a subscription that is neither this
  // account's recorded plan subscription nor carrying the Kovala plan
  // price belongs to another product — its lifecycle must never write
  // this account's plan state.
  if (subscription.id !== account.stripeSubscriptionId && !isPlanSubscription(subscription)) {
    console.warn(
      `stripe webhook: ignoring subscription ${subscription.id} for account ${account.id} — not the recorded plan subscription and not the Kovala plan price`,
    );
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
 *
 * The plan is identified by the Kovala plan price (see planPriceId),
 * never by exclusion: on the owner's shared Stripe account, other
 * products' subscriptions sit on the same customer and must not be
 * mistaken for the plan. When Stripe's list (successfully fetched)
 * holds no plan subscription for the customer, the row is cleared to
 * match — a stale recorded grant must not survive as a phantom
 * "active" with another product's renewal date.
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
  // Bank Sync add-on subscriptions are reconciled separately (per
  // entity); among the rest, ONLY a subscription carrying the Kovala
  // plan price is the base plan.
  const planSubs = subs.filter((s) => s.metadata?.addon !== "bank_sync" && isPlanSubscription(s));
  if (!planSubs.length) {
    // Stripe answered and holds no Kovala-plan subscription for this
    // customer (none at all, only Bank Sync add-ons, or only other
    // products' subscriptions). The local row must say so — mirror the
    // add-on reconcile's rule that when Stripe shows none, the local
    // row is cleared to match.
    const next = {
      stripeSubscriptionId: null,
      subscriptionStatus: "none",
      currentPeriodEnd: null,
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
 * subscriptions.list for the customer.
 *
 * Returns true when local state was created or repaired. Never throws —
 * a Stripe outage must not break the billing page; the caller falls back
 * to the local state it already had. When no Stripe customer exists for
 * the account, the local row is left exactly as-is — a grant is never
 * fabricated. When Stripe answers but holds no Kovala-plan subscription
 * for the customer, syncBillingForCustomer clears any stale recorded
 * grant, so a phantom one never survives either.
 */
export async function reconcileSubscriptionFromStripe(db: Db, account: AccountRow): Promise<boolean> {
  const nowMs = Date.now();
  const last = lastReconcileAtByAccount.get(account.id) ?? 0;
  if (nowMs - last < RECONCILE_MIN_INTERVAL_MS) return false;
  if (!process.env.STRIPE_SECRET_KEY) return false;
  // No Stripe customer bound: nothing to reconcile. The customer is
  // bound ONLY by Kovala's own checkout flow (the checkout actions
  // create and record it, or a verified Kovala checkout-session webhook
  // does). This function deliberately never searches Stripe by email:
  // the Stripe account is shared across the owner's products, and the
  // same email owns customers in several of them — adopting one by
  // email is how another product's customer (and its subscriptions)
  // once became this account's billing identity.
  if (!account.stripeCustomerId) return false;
  lastReconcileAtByAccount.set(account.id, nowMs);
  try {
    const stripe = getStripe();
    return await syncBillingForCustomer(db, stripe, account.stripeCustomerId);
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
 * ADMIN_EMAILS pattern — never charged, never revenue). The comp is
 * honored by stored admin role OR by the account's email passing
 * isAdminEmail(), so an owner/test account whose role was never
 * promoted in the database is still comped at this shared check —
 * every caller (Books UI state, Plaid link token, sync) flows through
 * here. Everyone else needs a live add-on subscription for that entity.
 */
export function bankSyncEntitled(addon: AddonRow | null, account: AccountRow): boolean {
  if (isCompedAccount(account)) return true;
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
  // Shared Stripe account: another product's subscription ending must
  // not cancel this account's plan — only the recorded plan
  // subscription or one carrying the Kovala plan price can.
  if (subscription.id !== account.stripeSubscriptionId && !isPlanSubscription(subscription)) {
    console.warn(
      `stripe webhook: ignoring cancel of subscription ${subscription.id} for account ${account.id} — not the recorded plan subscription and not the Kovala plan price`,
    );
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

async function markPastDue(db: Db, stripe: Stripe, invoice: Stripe.Invoice): Promise<void> {
  // A failed payment on a Bank Sync add-on pauses only that add-on.
  const subRef = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
  const subId = typeof subRef === "string" ? subRef : subRef?.id;
  let invoiceSub: Stripe.Subscription | null = null;
  if (subId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subId);
      invoiceSub = sub;
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
  // Shared Stripe account: when the invoice's subscription is known and
  // it is neither the recorded plan subscription nor carrying the
  // Kovala plan price, the failed payment is another product's — it
  // must not mark this account's plan past due.
  if (invoiceSub && invoiceSub.id !== account.stripeSubscriptionId && !isPlanSubscription(invoiceSub)) {
    console.warn(
      `stripe webhook: ignoring failed payment on subscription ${invoiceSub.id} for account ${account.id} — not the recorded plan subscription and not the Kovala plan price`,
    );
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
      // Retrieve the subscription BEFORE binding anything: on the
      // shared Stripe account, another product's checkout session can
      // land on this endpoint, and its customer + subscription must
      // never become this account's billing identity. The customer is
      // bound only when the session's subscription is provably
      // Kovala's own — the Kovala plan price, or a Bank Sync add-on
      // (subscription or session metadata) — matching the rule that a
      // Kovala account's Stripe customer comes from Kovala's flow only.
      const sub = subscriptionId ? await stripe.subscriptions.retrieve(subscriptionId) : null;
      const kovalaSession = Boolean(
        sub && (isPlanSubscription(sub) || sub.metadata?.addon === "bank_sync" || session.metadata?.addon === "bank_sync"),
      );
      if (accountId && customerId && kovalaSession && sub) {
        await db
          .update(schema.accounts)
          .set({
            stripeCustomerId: customerId,
            // An add-on checkout must not rebind the account's recorded
            // base-plan subscription; syncSubscription routes it below.
            ...(session.metadata?.addon !== "bank_sync" && isPlanSubscription(sub)
              ? { stripeSubscriptionId: sub.id }
              : {}),
          })
          .where(eq(schema.accounts.id, accountId));
      }
      if (sub) {
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

/** One invoice row for the Billing page's in-app invoice list. */
export interface BillingInvoice {
  id: string;
  createdAt: string;
  amountCents: number;
  currency: string;
  status: string;
  hostedUrl: string | null;
}

/** The subscription an invoice belongs to, across Stripe API shapes. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const inv = invoice as unknown as {
    subscription?: string | { id: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  };
  const ref = inv.subscription ?? inv.parent?.subscription_details?.subscription ?? null;
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

/** Price IDs charged on an invoice's lines, across Stripe API shapes. */
function invoiceLinePriceIds(invoice: Stripe.Invoice): string[] {
  const inv = invoice as unknown as {
    lines?: {
      data?: Array<{
        price?: { id?: string } | null;
        pricing?: { price_details?: { price?: string } | null } | null;
      }>;
    };
  };
  const ids: string[] = [];
  for (const line of inv.lines?.data ?? []) {
    const id = line.price?.id ?? line.pricing?.price_details?.price;
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * The customer's KOVALA invoices: only invoices belonging to a Kovala
 * plan subscription or a Bank Sync add-on subscription. The Stripe
 * account (and often the customer) is shared across the owner's
 * products, and the Stripe customer portal cannot be scoped per
 * product — so the Billing page's invoice list is built here instead:
 * an invoice counts when its subscription is one of this customer's
 * Kovala subscriptions, or when any of its lines charges the Kovala
 * plan price or the Bank Sync price (the line check still recognizes
 * invoices whose subscription has since been deleted). Other products'
 * invoices are invisible, exactly like their subscriptions.
 */
export async function listKovalaInvoices(stripe: Stripe, account: AccountRow): Promise<BillingInvoice[]> {
  if (!account.stripeCustomerId) return [];
  const customerId = account.stripeCustomerId;
  const subs = (await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })).data;
  const kovalaSubIds = new Set(
    subs
      .filter((s) => isPlanSubscription(s) || s.metadata?.addon === "bank_sync")
      .map((s) => s.id),
  );
  const kovalaPriceIds = new Set([planPriceId(), bankSyncPriceId()].filter((p): p is string => Boolean(p)));
  const invoices = (await stripe.invoices.list({ customer: customerId, limit: 100 })).data;
  return invoices
    .filter((inv) => {
      const subId = invoiceSubscriptionId(inv);
      if (subId && kovalaSubIds.has(subId)) return true;
      return invoiceLinePriceIds(inv).some((id) => kovalaPriceIds.has(id));
    })
    .map((inv) => ({
      id: inv.id ?? "",
      createdAt: new Date((inv.created ?? 0) * 1000).toISOString(),
      amountCents: inv.total ?? inv.amount_due ?? 0,
      currency: inv.currency ?? "usd",
      status: inv.status ?? "unknown",
      hostedUrl: inv.hosted_invoice_url ?? null,
    }));
}
