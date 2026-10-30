// Subscription entitlement — the single gate every mutating action and the
// price-alert engine consult before doing paid work.
//
// An account is entitled when ANY of these hold:
//   1. It is comped (the comped flag on the user row — see migration 0010;
//      the owner's email is also matched directly below as a second lock on
//      the door, so the owner cannot be locked out by a data mistake).
//   2. Stripe says it has a live subscription. The status is read from the
//      user row only AFTER a read-time reconcile from Stripe
//      (reconcileSubscriptionFromStripe in billing.ts), so a completed
//      checkout counts even when the webhook never landed — the webhook is
//      never the only source of truth.
//   3. It is still inside the signup free-trial window: 7 days from
//      trialStartedAt, matching the Stripe checkout trial_period_days: 7.
//
// A locked account keeps full READ access — sign-in, viewing its records,
// the billing page, account settings — but cannot add or change data, and
// its price alerts do not fire.
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import { reconcileSubscriptionFromStripe } from "./billing.js";

type Db = NodePgDatabase<typeof schema>;
type UserRow = typeof schema.users.$inferSelect;

export const TRIAL_DAYS = 7;
export const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

/** The owner's account. Comped in the data by migration 0010 AND matched
 *  here, so the owner stays exempt even if the flag is ever cleared. */
export const OWNER_COMP_EMAIL = "tmills142009@gmail.com";

/** Stripe statuses that count as a live subscription for ENTITLEMENT.
 *  past_due is deliberately NOT in this set (owner ruling, Oct 30, 2026:
 *  "they dont pay they dont get access") — a customer whose card failed
 *  locks like any unpaid account. Reads stay open, so they can still
 *  reach the Billing page, see its "Payment needed — update your card"
 *  state (the display reads the raw status, not this set), update their
 *  card through checkout/portal, and come back.
 *  billing.ts keeps its own wider set for reconcile bookkeeping
 *  (picking which Stripe subscription is the live one); that set does
 *  not decide access and is intentionally separate from this one. */
const SUBSCRIBED_STATUSES: string[] = ["trialing", "active"];

export interface Entitlement {
  entitled: boolean;
  comped: boolean;
  subscriptionStatus: string;
  /** End of the signup free-trial window. */
  trialEndsAt: Date;
  /** Whole days of signup trial left (0 once it has ended). */
  trialDaysLeft: number;
  /** Why the account is entitled — or "trial-ended" when it is not. */
  reason: "comped" | "subscribed" | "trial" | "trial-ended";
}

export function isComped(user: Pick<UserRow, "email" | "comped">): boolean {
  return user.comped === true || user.email.trim().toLowerCase() === OWNER_COMP_EMAIL;
}

/** Pure verdict from a user row. nowMs is injectable for tests. */
export function computeEntitlement(user: UserRow, nowMs: number = Date.now()): Entitlement {
  const trialEndsAt = new Date(user.trialStartedAt.getTime() + TRIAL_MS);
  const trialDaysLeft = Math.max(
    0,
    Math.ceil((trialEndsAt.getTime() - nowMs) / (24 * 60 * 60 * 1000)),
  );
  const base = {
    comped: isComped(user),
    subscriptionStatus: user.subscriptionStatus,
    trialEndsAt,
    trialDaysLeft,
  };
  if (base.comped) return { ...base, entitled: true, reason: "comped" as const };
  if (SUBSCRIBED_STATUSES.includes(user.subscriptionStatus)) {
    return { ...base, entitled: true, reason: "subscribed" as const };
  }
  if (nowMs < trialEndsAt.getTime()) return { ...base, entitled: true, reason: "trial" as const };
  return { ...base, entitled: false, reason: "trial-ended" as const };
}

/**
 * Entitlement from reconciled Stripe state: reconcile the user row from
 * Stripe first (throttled inside billing.ts; never throws — a Stripe outage
 * falls back to the local row), re-read the row when the reconcile changed
 * anything, then compute the verdict. Returns the freshest user row
 * alongside the verdict so callers never act on stale billing fields.
 */
export async function getEntitlement(
  db: Db,
  user: UserRow,
): Promise<{ user: UserRow; entitlement: Entitlement }> {
  let fresh = user;
  const changed = await reconcileSubscriptionFromStripe(db, user);
  if (changed) {
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
    if (rows[0]) fresh = rows[0];
  }
  return { user: fresh, entitlement: computeEntitlement(fresh) };
}
