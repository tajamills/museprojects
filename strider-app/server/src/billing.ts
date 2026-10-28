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

/** One-time price of the 1:1 setup session with Layla, in cents. */
export const SETUP_SESSION_PRICE_CENTS = 12500;

/** Checkout-session metadata marker for setup-session purchases. */
export const SETUP_BOOKING_KIND = "setup_booking";

/* ------------------------------------------------------------------ */
/* Black Friday launch (waitlist playbook, Oct 2026)                   */
/*                                                                     */
/* Tripwire: the one-time $8.88 "90 Plug-and-Post Captions" pack,     */
/* sold from the /black-friday/youre-in confirmation page during the  */
/* runway. Its Stripe price comes ONLY from STRIPE_TRIPWIRE_PRICE_ID  */
/* (one price on the "90 Plug-and-Post Captions" product) — unset     */
/* means the pack is not offered anywhere.                            */
/*                                                                     */
/* Deal (PREP ONLY): a $10.00-off, duration-"once" Stripe coupon      */
/* (STRIPE_BF_COUPON_ID) applied by a SEPARATE Black Friday checkout  */
/* action, only inside the cart window Fri Nov 27 – Mon Nov 30,       */
/* 2026 (America/New_York). First month $19.88 − $10.00 = $9.88,      */
/* renewals at the regular $19.88. The regular checkout never sees    */
/* the coupon, and nothing links to the BF checkout yet.              */
/* ------------------------------------------------------------------ */

/** One-time price of the captions pack, in cents. */
export const BF_TRIPWIRE_PRICE_CENTS = 888;

/** Checkout-session metadata marker for captions-pack purchases. */
export const BF_TRIPWIRE_KIND = "bf_tripwire";

/** Stripe price ID for the captions pack, or null when not configured. */
export function bfTripwirePriceId(): string | null {
  return process.env.STRIPE_TRIPWIRE_PRICE_ID?.trim() || null;
}

/** Stripe coupon ID for the Black Friday deal, or null when not configured. */
export function bfCouponId(): string | null {
  return process.env.STRIPE_BF_COUPON_ID?.trim() || null;
}

/** Cart window, America/New_York (EST = UTC−5 in late November):
 *  opens Fri Nov 27, 2026 00:00 ET, closes at Tue Dec 1, 2026 00:00 ET
 *  (i.e. the deal runs through Mon Nov 30, 23:59 ET). */
export const BF_WINDOW_START = new Date("2026-11-27T05:00:00.000Z");
export const BF_WINDOW_END = new Date("2026-12-01T05:00:00.000Z");

export function isBfWindowOpen(now: Date = new Date()): boolean {
  return now >= BF_WINDOW_START && now < BF_WINDOW_END;
}

/**
 * Where the pack PDF is served from once payment is verified. The
 * path segment is unguessable and the path is only ever RETURNED by
 * the server after a Stripe read-back confirms the session is paid —
 * the file itself sits in the client's static assets (see
 * client/build.mjs), like the tutorial videos.
 */
export const BF_PACK_DOWNLOAD_PATH = "/bf-pack-f111d5619e2e249b/captions-pack-90.pdf";

/** Subscription statuses that count as "subscribed" across the app. */
export const SUBSCRIBED_STATUSES = ["trialing", "active", "past_due"];

/* ------------------------------------------------------------------ */
/* Complimentary lifetime accounts (owner-granted)                     */
/*                                                                     */
/* These emails hold a gifted account: no Stripe subscription exists   */
/* or is ever required, and no Stripe state may overwrite the grant.   */
/* Billing reads and syncs short-circuit to "active" for them.         */
/* COMP_EMAILS (comma-separated) can add more without a code change.   */
/* ------------------------------------------------------------------ */

const COMP_EMAILS_BUILTIN = ["tam@taminspires.com"];

export function isCompEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const extra = (process.env.COMP_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return COMP_EMAILS_BUILTIN.includes(normalized) || extra.includes(normalized);
}

/* ------------------------------------------------------------------ */
/* X (Twitter) posting add-on: tiered + capped                         */
/*                                                                     */
/* Tiers are defined ONLY by the STRIPE_X_TIERS env config (one Stripe */
/* price per tier, each tier its own product). A workspace's active     */
/* tier is whichever tier's priceId appears in its Stripe subscription */
/* items — synced onto the user row from Stripe state. Plain posts     */
/* and posts with links are capped (and counted) separately because X  */
/* bills them at different rates ($0.015 vs $0.20 per post creation).  */
/*                                                                     */
/* Representation: a tier lives on its OWN Stripe subscription         */
/* (metadata zepostia_x_addon=1), never as an item on the base         */
/* subscription — a single shared subscription would trial (or bill)   */
/* both items together, but the product rule is that the base plan's   */
/* 14-day free trial NEVER covers a tier: tiers bill from day one.     */
/* At checkout the tier's first month is charged on the Checkout page  */
/* itself as a one-time line item on the tier's product (one-time      */
/* items are due at checkout even when the recurring items trial);     */
/* the add-on subscription is created at checkout completion with its  */
/* first renewal deferred to the end of that prepaid month. Adding a   */
/* tier after subscribing creates the same add-on subscription with    */
/* no deferral, so it charges immediately. Legacy subscriptions may    */
/* still carry a tier as an item on the base subscription — sync       */
/* honors that representation too. If the base plan dies, the add-on   */
/* subscription is canceled with it (see syncBillingForCustomer).      */
/* ------------------------------------------------------------------ */

/** Metadata key marking a Stripe subscription as the X add-on's own
 *  subscription (as opposed to the base plan's subscription). */
export const X_ADDON_SUBSCRIPTION_METADATA = "zepostia_x_addon";

/** True when the subscription is the X add-on's own subscription. */
export function isXAddonSubscription(subscription: Stripe.Subscription): boolean {
  return subscription.metadata?.[X_ADDON_SUBSCRIPTION_METADATA] === "1";
}

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

/** A subscription's X add-on billing period, from the tier item's own
 *  current period (falling back to the first item). This is the cycle
 *  X usage is metered against when the tier has its own subscription —
 *  during the checkout flow's prepaid first month it is exactly the
 *  window between the add-on subscription's start and its first
 *  renewal. */
export function xAddonPeriod(subscription: Stripe.Subscription): BillingPeriod | null {
  const item = xAddonSubscriptionItem(subscription) ?? subscription.items?.data?.[0];
  if (!item?.current_period_start || !item?.current_period_end) return null;
  return {
    start: new Date(item.current_period_start * 1000),
    end: new Date(item.current_period_end * 1000),
  };
}

/** The billing period X usage is anchored to for a user row: the
 *  add-on tier's own period when the tier has its own subscription,
 *  otherwise the base subscription's period (legacy representation). */
export function xAddonUsagePeriod(user: {
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  xAddonPeriodStart?: Date | null;
  xAddonPeriodEnd?: Date | null;
}): BillingPeriod | null {
  if (user.xAddonPeriodStart && user.xAddonPeriodEnd) {
    return { start: user.xAddonPeriodStart, end: user.xAddonPeriodEnd };
  }
  if (user.currentPeriodStart && user.currentPeriodEnd) {
    return { start: user.currentPeriodStart, end: user.currentPeriodEnd };
  }
  return null;
}

/** Add calendar months (UTC) — used to compute the end of the tier's
 *  prepaid first month from the base subscription's creation date. */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
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
  user: {
    id: number;
    xAddonTierPriceId: string | null;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    xAddonPeriodStart?: Date | null;
    xAddonPeriodEnd?: Date | null;
  },
  opts: { hasLink: boolean },
): Promise<CanPostToXResult> {
  if (!isXAddonConfigured()) {
    return { allowed: false, reason: "not_configured", tier: null, usage: null };
  }
  const tier = xAddonTierForPriceId(user.xAddonTierPriceId);
  if (!tier) {
    return { allowed: false, reason: "no_tier", tier: null, usage: null };
  }
  // Usage is metered over the tier's own billing period when the tier
  // has its own subscription, else the base subscription's period.
  const period = xAddonUsagePeriod(user);
  const usage = await getXAddonUsage(db, user.id, period);
  const used = opts.hasLink ? usage.linkPostsUsed : usage.postsUsed;
  const cap = opts.hasLink ? tier.linkPostsPerMonth : tier.postsPerMonth;
  if (used >= cap) {
    return { allowed: false, reason: "cap_reached", tier, usage };
  }
  return { allowed: true, tier, usage };
}

/**
 * Signed net amount (in cents) owed when switching tiers mid-period:
 * the new tier's price for the time REMAINING in the current period,
 * minus the unused part of the old tier's price for that same time —
 * each leg prorated by the second and rounded like a Stripe proration
 * line. Positive = the customer owes; negative = the customer is owed
 * a credit. The owner's rule: a tier switch bills IMMEDIATELY, net of
 * the fee already used — never parked onto a future invoice.
 */
export function tierSwitchNetCents(args: {
  oldAmountCents: number;
  newAmountCents: number;
  periodStartSec: number;
  periodEndSec: number;
  nowSec: number;
}): number {
  const total = args.periodEndSec - args.periodStartSec;
  if (total <= 0) return 0;
  const remaining = Math.min(Math.max(args.periodEndSec - args.nowSec, 0), total);
  const fraction = remaining / total;
  const newCoverage = Math.round(args.newAmountCents * fraction);
  const unusedOld = Math.round(args.oldAmountCents * fraction);
  return newCoverage - unusedOld;
}

/**
 * Settle a tier switch's net amount RIGHT NOW (see tierSwitchNetCents):
 * a positive net becomes a standalone invoice on the customer that is
 * finalized and charged immediately — the switch's one and only extra
 * invoice, never a proration parked onto the next renewal — and a
 * negative net becomes a customer balance credit. If the immediate
 * charge fails, the invoice is voided and the error propagates so the
 * caller can revert the switch: no switch without settlement.
 */
export async function settleTierSwitchNet(
  stripe: Stripe,
  customerId: string,
  netCents: number,
  currency: string,
  description: string,
): Promise<"charged" | "credited" | "none"> {
  if (netCents > 0) {
    await stripe.invoiceItems.create({
      customer: customerId,
      amount: netCents,
      currency,
      description,
    });
    const invoice = await stripe.invoices.create({
      customer: customerId,
      auto_advance: false,
      description,
    });
    try {
      const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
      const paid = await stripe.invoices.pay(finalized.id);
      if (paid.status !== "paid") {
        throw new Error("The switch charge did not complete.");
      }
    } catch (err) {
      await stripe.invoices.voidInvoice(invoice.id).catch(() => undefined);
      throw err;
    }
    return "charged";
  }
  if (netCents < 0) {
    await stripe.customers.createBalanceTransaction(customerId, {
      amount: netCents,
      currency,
      description,
    });
    return "credited";
  }
  return "none";
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

type UserRow = typeof schema.users.$inferSelect;

export interface BillingSyncSummary {
  /** True when the persisted billing fields actually changed. */
  changed: boolean;
  /** True when the base plan subscription is in a live status. */
  baseLive: boolean;
  /** The base plan subscription as classified from Stripe, if any. */
  baseSubscription: Stripe.Subscription | null;
  /** The active X add-on tier price ID after the sync, if any. */
  xAddonTierPriceId: string | null;
}

function sameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.getTime() === b.getTime();
}

/**
 * Authoritative billing sync: recompute a customer's ENTIRE local
 * billing state from Stripe in one pass — the base plan subscription
 * AND the X add-on's own subscription — and write it onto the user row.
 *
 * Classification: a subscription is the add-on's when it carries the
 * zepostia_x_addon metadata marker; the base is a live non-add-on
 * subscription (the recorded one preferred), else the recorded or
 * newest non-add-on one. The tier entitlement comes from the add-on
 * subscription when one exists; otherwise it falls back to the legacy
 * representation (a tier item riding on the base subscription).
 *
 * Cascade: a tier never bills without a live base plan — if the base
 * is gone or dead while the add-on subscription is still live, the
 * add-on subscription is canceled here and the entitlement clears in
 * the same write.
 */
export async function syncBillingForCustomer(
  db: Db,
  stripe: Stripe,
  customerId: string,
): Promise<BillingSyncSummary> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.stripeCustomerId, customerId))
    .limit(1);
  const user = rows[0];
  if (!user) {
    console.warn(`stripe billing sync: no user found for customer ${customerId}`);
    return { changed: false, baseLive: false, baseSubscription: null, xAddonTierPriceId: null };
  }

  if (isCompEmail(user.email)) {
    // Complimentary lifetime account: Stripe state never applies.
    let changed = false;
    if (user.subscriptionStatus !== "active") {
      await db.update(schema.users).set({ subscriptionStatus: "active" }).where(eq(schema.users.id, user.id));
      changed = true;
    }
    return { changed, baseLive: true, baseSubscription: null, xAddonTierPriceId: user.xAddonTierPriceId ?? null };
  }

  const subs = (await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 })).data;
  const addonSubs = subs.filter(isXAddonSubscription);
  const baseCandidates = subs.filter((s) => !isXAddonSubscription(s));
  // Prefer a live base subscription (the recorded one first, then any
  // live one — a re-subscription must win over a recorded-but-canceled
  // predecessor), falling back to the recorded / newest candidate.
  const base =
    baseCandidates.find((s) => s.id === user.stripeSubscriptionId && SUBSCRIBED_STATUSES.includes(s.status)) ??
    baseCandidates.find((s) => SUBSCRIBED_STATUSES.includes(s.status)) ??
    baseCandidates.find((s) => s.id === user.stripeSubscriptionId) ??
    baseCandidates[0] ??
    null;
  let addon =
    addonSubs.find((s) => SUBSCRIBED_STATUSES.includes(s.status)) ?? addonSubs[0] ?? null;
  const baseLive = !!base && SUBSCRIBED_STATUSES.includes(base.status);

  // Cascade: cancel a live add-on subscription whose base plan is gone.
  if (addon && SUBSCRIBED_STATUSES.includes(addon.status) && !baseLive) {
    try {
      addon = await stripe.subscriptions.cancel(addon.id);
    } catch (err) {
      console.error(
        `billing sync: failed to cancel orphaned X add-on subscription ${addon.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  const addonLive = !!addon && SUBSCRIBED_STATUSES.includes(addon.status);

  let tierPriceId: string | null = null;
  let addonPeriod: BillingPeriod | null = null;
  if (addon && addonLive) {
    tierPriceId = xAddonTierForSubscription(addon)?.priceId ?? null;
    if (tierPriceId) addonPeriod = xAddonPeriod(addon);
  }
  if (!addon && base) {
    // Legacy representation: the tier item rides on the base
    // subscription; its period is the base subscription's period.
    tierPriceId = xAddonTierForSubscription(base)?.priceId ?? null;
    if (tierPriceId) {
      const start = periodStart(base);
      const end = periodEnd(base);
      addonPeriod = start && end ? { start, end } : null;
    }
  }

  const next = {
    stripeSubscriptionId: base ? base.id : user.stripeSubscriptionId,
    subscriptionStatus: base
      ? base.status
      : user.subscriptionStatus === "none"
        ? "none"
        : "canceled",
    currentPeriodEnd: base ? periodEnd(base) : null,
    currentPeriodStart: base ? periodStart(base) : null,
    stripeXAddonSubscriptionId: addon ? addon.id : null,
    xAddonTierPriceId: tierPriceId,
    xAddonPeriodStart: addonPeriod?.start ?? null,
    xAddonPeriodEnd: addonPeriod?.end ?? null,
  };
  const changed =
    next.stripeSubscriptionId !== user.stripeSubscriptionId ||
    next.subscriptionStatus !== user.subscriptionStatus ||
    next.stripeXAddonSubscriptionId !== user.stripeXAddonSubscriptionId ||
    next.xAddonTierPriceId !== user.xAddonTierPriceId ||
    !sameDate(next.currentPeriodEnd, user.currentPeriodEnd) ||
    !sameDate(next.currentPeriodStart, user.currentPeriodStart) ||
    !sameDate(next.xAddonPeriodStart, user.xAddonPeriodStart) ||
    !sameDate(next.xAddonPeriodEnd, user.xAddonPeriodEnd);
  if (changed) {
    await db.update(schema.users).set(next).where(eq(schema.users.id, user.id));
  }
  return { changed, baseLive, baseSubscription: base, xAddonTierPriceId: tierPriceId };
}

/** The payment method a new add-on subscription should charge: the
 *  base subscription's default, falling back to the customer's
 *  invoice default. */
export async function subscriptionDefaultPaymentMethod(
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<string | undefined> {
  const pm = subscription.default_payment_method;
  if (typeof pm === "string" && pm) return pm;
  if (pm && typeof pm === "object" && "id" in pm && pm.id) return pm.id;
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) return undefined;
    const cpm = customer.invoice_settings?.default_payment_method;
    if (typeof cpm === "string" && cpm) return cpm;
    if (cpm && typeof cpm === "object" && "id" in cpm && cpm.id) return cpm.id;
  } catch {
    // Fall through: Stripe will use the customer's default source.
  }
  return undefined;
}

/**
 * Create the X add-on's own subscription for a checkout that prepaid
 * the tier's first month on the Checkout page. The base subscription
 * carries the chosen tier in its metadata (xAddonTierPriceId); the
 * add-on subscription is created with its first renewal deferred to
 * the end of the prepaid month (base creation + one month) so the
 * customer is never double-charged for month one, and its usage
 * period covers the prepaid month from day one.
 *
 * Idempotent and self-healing: if ANY add-on subscription already
 * exists for the customer (live, or canceled after having been
 * delivered) this does nothing — recreation after a removal is the
 * explicit add-on action's job, never a background repair's. Never
 * throws. Returns true when a subscription was created.
 */
export async function ensureXAddonSubscription(
  db: Db,
  stripe: Stripe,
  user: UserRow,
  tierPriceId: string,
): Promise<boolean> {
  const tier = xAddonTierForPriceId(tierPriceId);
  if (!tier || !user.stripeCustomerId) return false;
  try {
    const subs = (await stripe.subscriptions.list({ customer: user.stripeCustomerId, status: "all", limit: 20 })).data;
    if (subs.some(isXAddonSubscription)) return false;
    const base =
      subs.find((s) => s.id === user.stripeSubscriptionId && !isXAddonSubscription(s)) ??
      subs.find((s) => !isXAddonSubscription(s) && SUBSCRIBED_STATUSES.includes(s.status));
    if (!base || !SUBSCRIBED_STATUSES.includes(base.status)) return false;

    const prepaidUntil = addMonths(new Date(base.created * 1000), 1);
    const nowSec = Math.floor(Date.now() / 1000);
    // Defer the first renewal to the end of the prepaid month. If that
    // moment has already passed (a very late repair), omit the
    // deferral — the tier then bills immediately, starting month two.
    const trialEnd =
      prepaidUntil.getTime() / 1000 > nowSec + 3600
        ? Math.floor(prepaidUntil.getTime() / 1000)
        : undefined;
    const paymentMethod = await subscriptionDefaultPaymentMethod(stripe, base);
    await stripe.subscriptions.create({
      customer: user.stripeCustomerId,
      items: [{ price: tier.priceId }],
      ...(trialEnd ? { trial_end: trialEnd } : {}),
      ...(paymentMethod ? { default_payment_method: paymentMethod } : {}),
      metadata: {
        [X_ADDON_SUBSCRIPTION_METADATA]: "1",
        userId: String(user.id),
        tierPriceId: tier.priceId,
      },
    });
    await syncBillingForCustomer(db, stripe, user.stripeCustomerId);
    return true;
  } catch (err) {
    console.error(
      `billing: failed to create X add-on subscription for user ${user.id}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Read-time reconciliation: rebuild a user's local billing state from
 * Stripe's actual state. This makes billing self-healing — the webhook
 * (see handleStripeEvent) is still the primary sync path, but a
 * completed checkout must never be stranded by a webhook endpoint that
 * was never registered in the Stripe dashboard or a signing-secret
 * mismatch: the next billing read repairs the local row from Stripe.
 * It also delivers the X add-on subscription for a checkout that
 * prepaid a tier whenever the completion webhook was missed.
 *
 * Billing reads invoke this on every call: in the steady state it
 * costs one subscriptions.list for the customer (plus a customer
 * lookup when the row has no Stripe customer ID yet).
 *
 * Returns true when local state was created or repaired. Never
 * throws — a Stripe outage must not break the billing page; the
 * caller falls back to the local state it already had.
 */
export async function reconcileSubscriptionFromStripe(db: Db, user: UserRow): Promise<boolean> {
  if (isCompEmail(user.email)) {
    // Complimentary lifetime account: hold "active" and never bind or
    // consult a Stripe customer for this user.
    if (user.subscriptionStatus !== "active") {
      await db.update(schema.users).set({ subscriptionStatus: "active" }).where(eq(schema.users.id, user.id));
      return true;
    }
    return false;
  }
  if (!process.env.STRIPE_SECRET_KEY) return false;
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

    const summary = await syncBillingForCustomer(db, stripe, customerId);
    let created = false;
    // A tier picked at checkout is recorded in the base subscription's
    // metadata; if its add-on subscription was never created (the
    // completion webhook was missed), create it now.
    const marker = summary.baseSubscription?.metadata?.xAddonTierPriceId;
    if (summary.baseLive && marker && xAddonTierForPriceId(marker)) {
      created = await ensureXAddonSubscription(
        db,
        stripe,
        { ...user, stripeCustomerId: customerId },
        marker,
      );
    }
    return summary.changed || created;
  } catch (err) {
    console.error(
      `billing reconcile failed for user ${user.id}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
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
 * Record a PAID setup-session checkout as a booking row. Idempotent:
 * the Stripe session ID is unique, so the webhook and the read-time
 * reconcile can both call this for the same purchase safely. Returns
 * true when a new row was inserted. Never throws to the webhook —
 * the caller logs and moves on; reconcile retries later.
 */
export async function recordSetupBooking(db: Db, session: Stripe.Checkout.Session): Promise<boolean> {
  if (session.metadata?.kind !== SETUP_BOOKING_KIND) return false;
  if (session.payment_status !== "paid") return false;
  const userId = Number(session.client_reference_id);
  if (!userId) return false;
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  const inserted = await db
    .insert(schema.setupBookings)
    .values({
      userId,
      email: session.customer_details?.email ?? "",
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
      amountCents: session.amount_total ?? SETUP_SESSION_PRICE_CENTS,
      currency: session.currency ?? "usd",
      status: "booked",
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: schema.setupBookings.stripeCheckoutSessionId })
    .returning({ id: schema.setupBookings.id });
  return inserted.length > 0;
}

/**
 * Read-time repair for setup bookings, mirroring
 * reconcileSubscriptionFromStripe: a completed setup checkout must
 * never be stranded by a webhook endpoint that isn't registered or a
 * signing-secret mismatch, so every billing read re-checks Stripe's
 * checkout sessions for this customer and records any paid setup
 * purchase that has no row yet. Never throws — a Stripe outage must
 * not break the billing page.
 */
export async function reconcileSetupBookingsFromStripe(db: Db, user: UserRow): Promise<boolean> {
  if (!process.env.STRIPE_SECRET_KEY || !user.stripeCustomerId) return false;
  try {
    const stripe = getStripe();
    const sessions = await stripe.checkout.sessions.list({ customer: user.stripeCustomerId, limit: 25 });
    let created = false;
    for (const session of sessions.data) {
      if (session.mode !== "payment") continue;
      if (await recordSetupBooking(db, session)) created = true;
    }
    return created;
  } catch (err) {
    console.error(
      `setup booking reconcile failed for user ${user.id}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Record a PAID captions-pack checkout as a purchase row. Idempotent
 * (the Stripe session ID is unique), so the webhook and the read-time
 * verification can both call this safely. Mirrors recordSetupBooking,
 * minus the user: pack buyers need no account, so the email Stripe
 * collected is the identity. Returns true when a new row landed.
 */
export async function recordBfPackPurchase(db: Db, session: Stripe.Checkout.Session): Promise<boolean> {
  if (session.metadata?.kind !== BF_TRIPWIRE_KIND) return false;
  if (session.payment_status !== "paid") return false;
  const email = session.customer_details?.email ?? session.customer_email ?? "";
  if (!email) return false;
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  const inserted = await db
    .insert(schema.bfPackPurchases)
    .values({
      email,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
      amountCents: session.amount_total ?? BF_TRIPWIRE_PRICE_CENTS,
      currency: session.currency ?? "usd",
      status: "paid",
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: schema.bfPackPurchases.stripeCheckoutSessionId })
    .returning({ id: schema.bfPackPurchases.id });
  return inserted.length > 0;
}

/**
 * The download gate for the captions pack, and the house billing rule
 * applied to a one-time purchase: NEVER trust a success redirect (or
 * a webhook) — re-read the checkout session from Stripe, and only a
 * session Stripe itself reports as paid, in payment mode, carrying
 * the tripwire marker, grants the download. A verified payment is
 * also recorded on the spot, so the purchase row exists even if the
 * completion webhook was missed. Never throws — a Stripe outage
 * reads as "not confirmed", not as a crash.
 */
export async function verifyBfPackSession(
  db: Db,
  sessionId: string,
): Promise<{ ok: boolean; email: string | null; downloadPath: string | null }> {
  if (!process.env.STRIPE_SECRET_KEY) return { ok: false, email: null, downloadPath: null };
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.mode !== "payment" || session.metadata?.kind !== BF_TRIPWIRE_KIND || session.payment_status !== "paid") {
      return { ok: false, email: null, downloadPath: null };
    }
    await recordBfPackPurchase(db, session);
    return {
      ok: true,
      email: session.customer_details?.email ?? session.customer_email ?? null,
      downloadPath: BF_PACK_DOWNLOAD_PATH,
    };
  } catch (err) {
    console.error("bf pack verification failed:", err instanceof Error ? err.message : err);
    return { ok: false, email: null, downloadPath: null };
  }
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
      if (customerId) {
        await syncBillingForCustomer(db, stripe, customerId);
        // A paid setup-session checkout becomes a booking row (the
        // read-time reconcile repairs this if the write ever fails).
        if (session.metadata?.kind === SETUP_BOOKING_KIND) {
          await recordSetupBooking(db, session);
        }
        // A tier picked at checkout prepaid its first month on the
        // Checkout page; create its add-on subscription now (the
        // read-time reconcile retries this if it ever fails here).
        const tierPriceId = session.metadata?.xAddonTierPriceId;
        if (tierPriceId && userId && xAddonTierForPriceId(tierPriceId)) {
          const rows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
          if (rows[0]) await ensureXAddonSubscription(db, stripe, rows[0], tierPriceId);
        }
      }
      // A paid captions-pack checkout becomes a purchase row (the
      // pack page's read-time verification repairs this if the write
      // ever fails). Recorded OUTSIDE the customer block above: pack
      // buyers check out as guests — no zepostia customer exists.
      if (session.metadata?.kind === BF_TRIPWIRE_KIND) {
        await recordBfPackPurchase(db, session);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
      if (customerId) await syncBillingForCustomer(db, stripe, customerId);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      const invoiceSub = invoice.parent?.subscription_details?.subscription;
      const invoiceSubId = typeof invoiceSub === "string" ? invoiceSub : invoiceSub?.id;
      if (customerId && invoiceSubId) {
        // A failed ADD-ON invoice must not mark the base plan past
        // due — re-sync from Stripe instead (the add-on subscription's
        // own status drives the entitlement).
        const rows = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.stripeCustomerId, customerId))
          .limit(1);
        if (rows[0] && rows[0].stripeXAddonSubscriptionId === invoiceSubId) {
          await syncBillingForCustomer(db, stripe, customerId);
          break;
        }
      }
      await markPastDue(db, invoice);
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
