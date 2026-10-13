// Stripe billing helpers for zepostia.
//
// Ported from kovala's server/src/billing.ts. Differences:
// - The user table is `users` (not `accounts`).
// - The $19.88/month plan includes a 14-day free trial: the card is collected
//   at checkout and the first charge lands on day 15.
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
//   STRIPE_PRICE_ID        Price ID for the $19.88/month zepostia plan.
//   STRIPE_X_TIERS         Optional JSON array defining the X (Twitter)
//                          posting add-on tiers, e.g.
//                          [{"priceId":"price_…","name":"Starter",
//                            "postsPerMonth":100,"linkPostsPerMonth":25}]
//                          When unset/empty, the add-on is not offered
//                          anywhere in the app. X is never bundled into
//                          the base plan: X bills the owner's account
//                          per post (pay-per-use), so each tier's caps
//                          make the maximum X cost per customer known
//                          in advance.
//   APP_BASE_URL           Public base URL, e.g. https://zepostia.com.
//                          Used for checkout success/cancel + portal return
//                          URLs. Falls back to the request origin, then
//                          http://localhost:3000.
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

type Db = NodePgDatabase<typeof schema>;

/** Length of the zepostia free trial, in days. */
export const TRIAL_DAYS = 14;

/** Subscription statuses that count as "subscribed" across the app. */
export const SUBSCRIBED_STATUSES = ["trialing", "active", "past_due"];

/* ------------------------------------------------------------------ */
/* X (Twitter) posting add-on: tiered + capped                         */
/*                                                                     */
/* Tiers are defined ONLY by the STRIPE_X_TIERS env config (one Stripe */
/* price per tier, all under one "X Posting Add-on" product). A       */
/* workspace's active tier is whichever tier's priceId appears in its   */
/* Stripe subscription items — synced onto the user row by the webhook */
/* and the add/switch/remove actions. Plain posts and posts with      */
/* links are capped (and counted) separately because X bills them at   */
/* different rates ($0.015 vs $0.20 per post creation).               */
/* ------------------------------------------------------------------ */

export interface XAddonTier {
  priceId: string;
  name: string;
  postsPerMonth: number;
  linkPostsPerMonth: number;
}

/** Parsed + validated STRIPE_X_TIERS config. Malformed config means the
 *  add-on is simply not offered (same as unset) — never a boot failure. */
export function xAddonTiers(): XAddonTier[] {
  const raw = process.env.STRIPE_X_TIERS;
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("STRIPE_X_TIERS is not valid JSON — X add-on disabled.");
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.warn("STRIPE_X_TIERS is not a JSON array — X add-on disabled.");
    return [];
  }
  const tiers: XAddonTier[] = [];
  for (const entry of parsed) {
    const e = entry as Partial<XAddonTier> | null;
    if (
      e &&
      typeof e.priceId === "string" && e.priceId.length > 0 &&
      typeof e.name === "string" && e.name.length > 0 &&
      Number.isInteger(e.postsPerMonth) && (e.postsPerMonth as number) >= 0 &&
      Number.isInteger(e.linkPostsPerMonth) && (e.linkPostsPerMonth as number) >= 0
    ) {
      tiers.push({
        priceId: e.priceId,
        name: e.name,
        postsPerMonth: e.postsPerMonth as number,
        linkPostsPerMonth: e.linkPostsPerMonth as number,
      });
    } else {
      console.warn("STRIPE_X_TIERS entry skipped (invalid shape):", JSON.stringify(entry));
    }
  }
  return tiers;
}

/** True when at least one X add-on tier is configured. */
export function isXAddonConfigured(): boolean {
  return xAddonTiers().length > 0;
}

/** The configured tier for a Stripe price ID, or undefined. */
export function xAddonTierForPriceId(priceId: string | null | undefined): XAddonTier | undefined {
  if (!priceId) return undefined;
  return xAddonTiers().find((tier) => tier.priceId === priceId);
}

/** The workspace's active tier from a Stripe subscription: the configured
 *  tier whose priceId appears in the subscription items, provided the
 *  subscription itself is in a live status. Null = no X entitlement. */
export function xAddonTierForSubscription(subscription: Stripe.Subscription): XAddonTier | null {
  if (!SUBSCRIBED_STATUSES.includes(subscription.status)) return null;
  const itemPriceIds = new Set((subscription.items?.data ?? []).map((item) => item.price?.id));
  return xAddonTiers().find((tier) => itemPriceIds.has(tier.priceId)) ?? null;
}

/** The subscription item carrying any configured X tier price, if present. */
export function xAddonSubscriptionItem(subscription: Stripe.Subscription): Stripe.SubscriptionItem | undefined {
  const tiers = xAddonTiers();
  return (subscription.items?.data ?? []).find((item) => tiers.some((tier) => tier.priceId === item.price?.id));
}

export interface BillingPeriod {
  start: Date;
  end: Date;
}

export interface XAddonUsageSnapshot {
  postsUsed: number;
  linkPostsUsed: number;
  periodStart: Date | null;
  periodEnd: Date | null;
}

function sameInstant(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return false;
  return a.getTime() === b.getTime();
}

/**
 * Read the workspace's X add-on usage for the given billing period.
 * Usage is anchored to the subscription's current period: if the stored
 * row belongs to an older period (or there is no period), the counters
 * read as zero — a lapsed period never leaks counts into the next one.
 */
export async function getXAddonUsage(
  db: Db,
  userId: number,
  period: BillingPeriod | null,
): Promise<XAddonUsageSnapshot> {
  const rows = await db.select().from(schema.xAddonUsage).where(eq(schema.xAddonUsage.userId, userId)).limit(1);
  const row = rows[0];
  if (!row || !period || !sameInstant(row.periodStart, period.start) || !sameInstant(row.periodEnd, period.end)) {
    return { postsUsed: 0, linkPostsUsed: 0, periodStart: period?.start ?? null, periodEnd: period?.end ?? null };
  }
  return { postsUsed: row.postsUsed, linkPostsUsed: row.linkPostsUsed, periodStart: row.periodStart, periodEnd: row.periodEnd };
}

/**
 * Record one X post against the workspace's current-period counters.
 * `hasLink` selects the counter (X bills link posts at a higher rate,
 * and tiers cap them separately). If the stored row is for an older
 * period it is reset to the given period with this post as the first
 * count. Callers should gate with canPostToX first; this only counts.
 */
export async function recordXPost(
  db: Db,
  userId: number,
  period: BillingPeriod,
  opts: { hasLink: boolean },
): Promise<XAddonUsageSnapshot> {
  const rows = await db.select().from(schema.xAddonUsage).where(eq(schema.xAddonUsage.userId, userId)).limit(1);
  const row = rows[0];
  const current = row && sameInstant(row.periodStart, period.start) && sameInstant(row.periodEnd, period.end);
  const postsUsed = (current ? row.postsUsed : 0) + (opts.hasLink ? 0 : 1);
  const linkPostsUsed = (current ? row.linkPostsUsed : 0) + (opts.hasLink ? 1 : 0);
  if (row) {
    await db
      .update(schema.xAddonUsage)
      .set({ periodStart: period.start, periodEnd: period.end, postsUsed, linkPostsUsed })
      .where(eq(schema.xAddonUsage.userId, userId));
  } else {
    await db.insert(schema.xAddonUsage).values({
      userId,
      periodStart: period.start,
      periodEnd: period.end,
      postsUsed,
      linkPostsUsed,
    });
  }
  return { postsUsed, linkPostsUsed, periodStart: period.start, periodEnd: period.end };
}

export type CanPostToXResult =
  | { allowed: true; tier: XAddonTier; usage: XAddonUsageSnapshot }
  | { allowed: false; reason: "not_configured" | "no_tier" | "cap_reached"; tier: XAddonTier | null; usage: XAddonUsageSnapshot | null };

/**
 * The enforcement gate the X posting feature must call before every
 * post. Allowed only when the workspace has an active X add-on tier
 * (synced from Stripe) AND the relevant counter for THIS billing period
 * is below the tier cap: plain posts against postsPerMonth, posts with
 * a link against linkPostsPerMonth. Hitting the cap is a hard stop.
 *
 * `user` is the workspace's full user row (its xAddonTierPriceId and
 * currentPeriodStart/End are the Stripe-synced state).
 */
export async function canPostToX(
  db: Db,
  user: { id: number; xAddonTierPriceId: string | null; currentPeriodStart: Date | null; currentPeriodEnd: Date | null },
  opts: { hasLink: boolean },
): Promise<CanPostToXResult> {
  if (!isXAddonConfigured()) {
    return { allowed: false, reason: "not_configured", tier: null, usage: null };
  }
  const tier = xAddonTierForPriceId(user.xAddonTierPriceId);
  if (!tier) {
    return { allowed: false, reason: "no_tier", tier: null, usage: null };
  }
  const period: BillingPeriod | null =
    user.currentPeriodStart && user.currentPeriodEnd
      ? { start: user.currentPeriodStart, end: user.currentPeriodEnd }
      : null;
  const usage = await getXAddonUsage(db, user.id, period);
  const used = opts.hasLink ? usage.linkPostsUsed : usage.postsUsed;
  const cap = opts.hasLink ? tier.linkPostsPerMonth : tier.postsPerMonth;
  if (used >= cap) {
    return { allowed: false, reason: "cap_reached", tier, usage };
  }
  return { allowed: true, tier, usage };
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

/** Best available "current period end" under the current Stripe billing model:
 *  during a trial it's the trial end (first charge date); otherwise it's the
 *  first subscription item's period end. */
function periodEnd(sub: Stripe.Subscription): Date | null {
  if (sub.status === "trialing" && sub.trial_end) return new Date(sub.trial_end * 1000);
  const end = sub.items?.data?.[0]?.current_period_end;
  return end ? new Date(end * 1000) : null;
}

/** The subscription's current period start (first item), used to anchor
 *  X add-on usage to the billing period. */
function periodStart(sub: Stripe.Subscription): Date | null {
  const start = sub.items?.data?.[0]?.current_period_start;
  return start ? new Date(start * 1000) : null;
}

/** Copy a Stripe subscription's state onto the matching user row,
 *  including the X add-on tier entitlement recomputed from the
 *  subscription's price items (null when no configured tier price is
 *  present or the subscription is not in a live status). */
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
      currentPeriodStart: periodStart(subscription),
      xAddonTierPriceId: xAddonTierForSubscription(subscription)?.priceId ?? null,
    })
    .where(eq(schema.users.id, user.id));
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
      currentPeriodStart: null,
      xAddonTierPriceId: null,
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
