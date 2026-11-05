// Tests for the billing redo (Nov 5, 2026): product-anchored billing.
// Run from the repo root:
//   npx esbuild server/src/billing.test.ts --bundle --platform=node --format=esm \
//     --alias:stripe=./server/src/billing.fake-stripe.ts \
//     --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
//     --outfile=/tmp/zepostia-billing-test.mjs && node /tmp/zepostia-billing-test.mjs
//
// The "stripe" package is aliased to billing.fake-stripe.ts, a fake
// modeling the owner's SHARED Stripe account: several products'
// subscriptions side by side on one customer. Requires a throwaway
// Postgres at 127.0.0.1:55432 (postgres/testpw — the local rig); the
// database below is dropped and recreated on every run.
import assert from "node:assert";
import path from "node:path";
import pg from "pg";
import type Stripe from "stripe";
import { createDb, createPool, migrate } from "./db.js";
import * as schema from "./schema.js";
import { createCtx } from "./ctx.js";
import {
  handleStripeEvent,
  reconcileSubscriptionFromStripe,
  syncBillingForCustomer,
} from "./billing.js";
import { actions } from "./actions.js";
import FakeStripe, { fakeStripeStore } from "./billing.fake-stripe.js";
import { eq } from "drizzle-orm";

const TEST_DB = "zepostia_billing_redo_test";
const ADMIN_URL = "postgres://postgres:testpw@127.0.0.1:55432/postgres";

process.env.DATABASE_URL = `postgres://postgres:testpw@127.0.0.1:55432/${TEST_DB}`;
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_PRICE_ID = "price_zepostia_base";
process.env.STRIPE_X_TIERS = JSON.stringify([
  { priceId: "price_x_starter", name: "Starter", postsPerMonth: 100, linkPostsPerMonth: 25 },
  { priceId: "price_x_growth", name: "Growth", postsPerMonth: 300, linkPostsPerMonth: 75 },
  { priceId: "price_x_pro", name: "Pro", postsPerMonth: 1000, linkPostsPerMonth: 250 },
]);
process.env.COMP_EMAILS = "comp2@test.dev";

const BASE = "price_zepostia_base";
const TIER_STARTER = "price_x_starter";
const TIER_GROWTH = "price_x_growth";
const TIER_PRO = "price_x_pro";
const PRICE_AMOUNTS: Record<string, number> = {
  [BASE]: 1988,
  [TIER_STARTER]: 1500,
  [TIER_GROWTH]: 3000,
  [TIER_PRO]: 10000,
  price_cryptoalerts: 888,
  price_kovala_plan: 19988,
  price_kovala_sync: 888,
};

const NOW = Math.floor(Date.now() / 1000);
const stripe = new FakeStripe() as unknown as Stripe;

let pool: pg.Pool;
let db: ReturnType<typeof createDb>;
let userSeq = 0;

function seedPrices() {
  for (const [id, unit_amount] of Object.entries(PRICE_AMOUNTS)) {
    fakeStripeStore.prices.set(id, { id, unit_amount, currency: "usd", product: `prod_for_${id}` });
  }
}

function resetStripe() {
  fakeStripeStore.reset();
  seedPrices();
}

type SubOpts = {
  id: string;
  customer: string;
  status?: string;
  prices: string[];
  metadata?: Record<string, string>;
  trialEnd?: number | null;
  periodStartSec?: number;
  periodEndSec?: number;
};

function addSub(opts: SubOpts) {
  const start = opts.periodStartSec ?? NOW - 86400;
  const end = opts.periodEndSec ?? NOW + 29 * 86400;
  const sub: Record<string, unknown> = {
    id: opts.id,
    customer: opts.customer,
    status: opts.status ?? "active",
    created: NOW - 86400,
    trial_end: opts.trialEnd ?? null,
    cancel_at_period_end: false,
    metadata: opts.metadata ?? {},
    default_payment_method: "pm_fake",
    items: {
      data: opts.prices.map((pid, i) => ({
        id: `${opts.id}_it${i}`,
        price: { id: pid, unit_amount: PRICE_AMOUNTS[pid] ?? 100, currency: "usd" },
        current_period_start: start,
        current_period_end: end,
      })),
    },
  };
  fakeStripeStore.subscriptions.push(sub);
  return sub;
}

async function makeUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const inserted = await db
    .insert(schema.users)
    .values({
      email: `user${++userSeq}@test.dev`,
      displayName: "Test User",
      passwordHash: "hash",
      passwordSalt: "salt",
      createdAt: new Date(),
      subscriptionStatus: "none",
      ...overrides,
    })
    .returning();
  return inserted[0];
}

async function getUser(id: number) {
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return rows[0];
}

function billingFields(u: typeof schema.users.$inferSelect) {
  return {
    subscriptionStatus: u.subscriptionStatus,
    stripeCustomerId: u.stripeCustomerId,
    stripeSubscriptionId: u.stripeSubscriptionId,
    currentPeriodEnd: u.currentPeriodEnd?.getTime() ?? null,
    currentPeriodStart: u.currentPeriodStart?.getTime() ?? null,
    stripeXAddonSubscriptionId: u.stripeXAddonSubscriptionId,
    xAddonTierPriceId: u.xAddonTierPriceId,
    xAddonPeriodStart: u.xAddonPeriodStart?.getTime() ?? null,
    xAddonPeriodEnd: u.xAddonPeriodEnd?.getTime() ?? null,
  };
}

async function main() {
  // Fresh throwaway database.
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  pool = createPool();
  await migrate(pool, path.resolve(process.cwd(), "server/migrations"));
  db = createDb(pool);
  seedPrices();

  // (a) Phantom active plan + ONLY foreign subscriptions in Stripe →
  // the stored state clears; no foreign subscription is adopted.
  {
    resetStripe();
    const u = await makeUser({
      stripeCustomerId: "cus_a",
      subscriptionStatus: "active",
      stripeSubscriptionId: "sub_phantom",
      currentPeriodStart: new Date((NOW - 86400) * 1000),
      currentPeriodEnd: new Date((NOW + 29 * 86400) * 1000),
    });
    addSub({ id: "sub_crypto_a", customer: "cus_a", prices: ["price_cryptoalerts"] });
    addSub({ id: "sub_kovala_a", customer: "cus_a", prices: ["price_kovala_plan"] });
    addSub({ id: "sub_sync_a", customer: "cus_a", prices: ["price_kovala_sync"] });
    const summary = await syncBillingForCustomer(db, stripe, "cus_a");
    const row = billingFields(await getUser(u.id));
    assert.strictEqual(summary.changed, true, "a: sync reports a change");
    assert.strictEqual(row.subscriptionStatus, "canceled", "a: phantom active cleared to canceled");
    assert.strictEqual(row.stripeSubscriptionId, null, "a: recorded subscription id cleared");
    assert.strictEqual(row.currentPeriodEnd, null, "a: period end cleared");
    assert.strictEqual(row.currentPeriodStart, null, "a: period start cleared");
    assert.strictEqual(row.xAddonTierPriceId, null, "a: no tier from foreign subs");
    assert.strictEqual(row.stripeXAddonSubscriptionId, null, "a: no add-on sub from foreign subs");
    console.log("ok - (a) foreign-only Stripe state clears a phantom plan");
  }

  // (b) Base-priced subscription + foreign subscriptions → the base
  // syncs from its own subscription; the foreign ones are ignored.
  {
    resetStripe();
    const trialEnd = NOW + 14 * 86400;
    const u = await makeUser({ stripeCustomerId: "cus_b", subscriptionStatus: "none" });
    addSub({ id: "sub_crypto_b", customer: "cus_b", prices: ["price_cryptoalerts"] });
    addSub({ id: "sub_base_b", customer: "cus_b", status: "trialing", prices: [BASE], trialEnd });
    await syncBillingForCustomer(db, stripe, "cus_b");
    const row = billingFields(await getUser(u.id));
    assert.strictEqual(row.subscriptionStatus, "trialing", "b: base status syncs");
    assert.strictEqual(row.stripeSubscriptionId, "sub_base_b", "b: base subscription recorded");
    assert.strictEqual(row.currentPeriodEnd, trialEnd * 1000, "b: period end is the trial end");
    console.log("ok - (b) base-priced sub syncs, foreign subs ignored");
  }

  // (c) X add-on subscription ALONE → never read as the base plan.
  // The add-on is recognized as the add-on's own subscription, the
  // base state clears, and the standing product rule fires: a tier
  // never bills without a live base plan, so the orphaned add-on is
  // canceled and its entitlement clears in the same sync.
  {
    resetStripe();
    const u = await makeUser({
      stripeCustomerId: "cus_c",
      subscriptionStatus: "active",
      stripeSubscriptionId: "sub_gone",
    });
    addSub({ id: "sub_addon_c", customer: "cus_c", prices: [TIER_GROWTH], metadata: { zepostia_x_addon: "1" } });
    await syncBillingForCustomer(db, stripe, "cus_c");
    const row = billingFields(await getUser(u.id));
    assert.strictEqual(row.subscriptionStatus, "canceled", "c: base state NOT taken from the add-on sub");
    assert.strictEqual(row.stripeSubscriptionId, null, "c: add-on sub id never recorded as the base");
    assert.strictEqual(row.stripeXAddonSubscriptionId, "sub_addon_c", "c: add-on sub recognized as the add-on's own");
    assert.deepStrictEqual(fakeStripeStore.canceledSubscriptionIds, ["sub_addon_c"], "c: orphan add-on canceled (cascade preserved)");
    assert.strictEqual(row.xAddonTierPriceId, null, "c: entitlement clears with the cascade");
    console.log("ok - (c) add-on sub alone is never the base plan (orphan cascade preserved)");
  }

  // (c2) Base + add-on both live → the tier derives from the add-on
  // subscription's price, with the add-on's own period.
  {
    resetStripe();
    const addonEnd = NOW + 20 * 86400;
    const u = await makeUser({ stripeCustomerId: "cus_c2", subscriptionStatus: "none" });
    addSub({ id: "sub_base_c2", customer: "cus_c2", prices: [BASE] });
    addSub({ id: "sub_addon_c2", customer: "cus_c2", prices: [TIER_GROWTH], metadata: { zepostia_x_addon: "1" }, periodEndSec: addonEnd });
    await syncBillingForCustomer(db, stripe, "cus_c2");
    const row = billingFields(await getUser(u.id));
    assert.strictEqual(row.subscriptionStatus, "active", "c2: base active");
    assert.strictEqual(row.stripeSubscriptionId, "sub_base_c2", "c2: base recorded");
    assert.strictEqual(row.xAddonTierPriceId, TIER_GROWTH, "c2: tier derives from the add-on sub's price");
    assert.strictEqual(row.stripeXAddonSubscriptionId, "sub_addon_c2", "c2: add-on sub recorded");
    assert.strictEqual(row.xAddonPeriodEnd, addonEnd * 1000, "c2: add-on period from the add-on item");
    console.log("ok - (c2) live base + live add-on: tier from the add-on subscription");
  }

  // (c3) Selection is by PRICE in both directions: a tier-priced
  // subscription WITHOUT the metadata marker is still the add-on's,
  // and a base-priced subscription WITH the marker is still the base.
  {
    resetStripe();
    const u = await makeUser({ stripeCustomerId: "cus_c3", subscriptionStatus: "none" });
    addSub({ id: "sub_base_c3", customer: "cus_c3", prices: [BASE], metadata: { zepostia_x_addon: "1" } });
    addSub({ id: "sub_addon_c3", customer: "cus_c3", prices: [TIER_STARTER], metadata: {} });
    await syncBillingForCustomer(db, stripe, "cus_c3");
    const row = billingFields(await getUser(u.id));
    assert.strictEqual(row.stripeSubscriptionId, "sub_base_c3", "c3: base price wins over the add-on marker");
    assert.strictEqual(row.stripeXAddonSubscriptionId, "sub_addon_c3", "c3: tier price wins over missing marker");
    assert.strictEqual(row.xAddonTierPriceId, TIER_STARTER, "c3: tier from price alone");
    console.log("ok - (c3) classification is by price in both directions");
  }

  // (d) Base subscription alone → no add-on state is invented.
  {
    resetStripe();
    const u = await makeUser({ stripeCustomerId: "cus_d", subscriptionStatus: "none" });
    addSub({ id: "sub_base_d", customer: "cus_d", prices: [BASE] });
    await syncBillingForCustomer(db, stripe, "cus_d");
    const row = billingFields(await getUser(u.id));
    assert.strictEqual(row.subscriptionStatus, "active", "d: base active");
    assert.strictEqual(row.xAddonTierPriceId, null, "d: no tier from a base sub alone");
    assert.strictEqual(row.stripeXAddonSubscriptionId, null, "d: no add-on sub recorded");
    assert.strictEqual(row.xAddonPeriodStart, null, "d: no add-on period");
    console.log("ok - (d) base sub alone leaves add-on state empty");
  }

  // (d2) Legacy representation: a tier item riding on the base
  // subscription still yields the tier — off the BASE, which is not
  // mistaken for the add-on's own subscription.
  {
    resetStripe();
    const u = await makeUser({ stripeCustomerId: "cus_d2", subscriptionStatus: "none" });
    addSub({ id: "sub_base_d2", customer: "cus_d2", prices: [BASE, TIER_STARTER] });
    await syncBillingForCustomer(db, stripe, "cus_d2");
    const row = billingFields(await getUser(u.id));
    assert.strictEqual(row.xAddonTierPriceId, TIER_STARTER, "d2: legacy tier read off the base sub");
    assert.strictEqual(row.stripeXAddonSubscriptionId, null, "d2: base sub is not the add-on's own sub");
    console.log("ok - (d2) legacy tier item on the base subscription still honored");
  }

  // (e) Tier switch with TWO live add-on subscriptions in Stripe
  // (the pathological state): the real setXAddonTier action resolves
  // to exactly ONE live add-on subscription at the chosen tier —
  // the recorded survivor is switched in place, the extra is
  // canceled in the same operation, nothing stacks.
  {
    resetStripe();
    const u = await makeUser({
      email: "e@test.dev",
      stripeCustomerId: "cus_e",
      subscriptionStatus: "active",
      stripeSubscriptionId: "sub_base_e",
      stripeXAddonSubscriptionId: "sub_addon_e1",
      xAddonTierPriceId: TIER_STARTER,
    });
    await db.insert(schema.sessions).values({
      userId: u.id,
      token: "tok_e",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    });
    addSub({ id: "sub_base_e", customer: "cus_e", prices: [BASE] });
    addSub({ id: "sub_addon_e1", customer: "cus_e", prices: [TIER_STARTER], metadata: { zepostia_x_addon: "1" } });
    addSub({ id: "sub_addon_e2", customer: "cus_e", prices: [TIER_GROWTH], metadata: { zepostia_x_addon: "1" } });
    const ctx = createCtx(db, "/tmp/zepostia-billing-test-media");
    const result = (await actions.setXAddonTier.handler(ctx, { sessionToken: "tok_e", priceId: TIER_PRO })) as {
      activeTier: string | null;
    };
    assert.strictEqual(result.activeTier, "Pro", "e: switch reports the Pro tier");
    const liveAddons = fakeStripeStore.subscriptions.filter(
      (s) => s.customer === "cus_e" && s.id !== "sub_base_e" && ["trialing", "active", "past_due"].includes(s.status),
    );
    assert.strictEqual(liveAddons.length, 1, "e: exactly one live add-on subscription after the switch");
    assert.strictEqual(liveAddons[0].id, "sub_addon_e1", "e: the recorded add-on is the survivor");
    assert.strictEqual(liveAddons[0].items.data[0].price.id, TIER_PRO, "e: survivor carries the new tier price");
    assert.ok(fakeStripeStore.canceledSubscriptionIds.includes("sub_addon_e2"), "e: the extra add-on was canceled");
    assert.strictEqual(fakeStripeStore.settledInvoiceCount, 1, "e: the switch net was settled immediately, once");
    const row = billingFields(await getUser(u.id));
    assert.strictEqual(row.xAddonTierPriceId, TIER_PRO, "e: row tier is the chosen tier");
    assert.strictEqual(row.stripeXAddonSubscriptionId, "sub_addon_e1", "e: row add-on is the survivor");
    console.log("ok - (e) tier switch resolves two live add-ons to exactly one, at the chosen tier");
  }

  // (f) Webhook events for FOREIGN subscriptions change nothing;
  // the same events for zepostia's own subscriptions still work.
  {
    resetStripe();
    const u = await makeUser({
      stripeCustomerId: "cus_f",
      subscriptionStatus: "active",
      stripeSubscriptionId: "sub_base_f",
      // Seeded to match sub_base_f's item period exactly, so the row
      // is already the truthful synced state before any event fires.
      currentPeriodStart: new Date((NOW - 86400) * 1000),
      currentPeriodEnd: new Date((NOW + 29 * 86400) * 1000),
    });
    addSub({ id: "sub_base_f", customer: "cus_f", prices: [BASE] });
    const foreign = addSub({ id: "sub_crypto_f", customer: "cus_f", prices: ["price_cryptoalerts"] });
    const before = billingFields(await getUser(u.id));

    await handleStripeEvent(db, stripe, {
      type: "customer.subscription.deleted",
      data: { object: { ...foreign, status: "canceled" } },
    } as unknown as Stripe.Event);
    assert.deepStrictEqual(billingFields(await getUser(u.id)), before, "f: foreign subscription.deleted changes nothing");

    await handleStripeEvent(db, stripe, {
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_f", parent: { subscription_details: { subscription: "sub_crypto_f" } } } },
    } as unknown as Stripe.Event);
    assert.deepStrictEqual(billingFields(await getUser(u.id)), before, "f: foreign invoice.payment_failed changes nothing");

    // Positive control: the base plan's own failed invoice still
    // marks the user past due.
    await handleStripeEvent(db, stripe, {
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_f", parent: { subscription_details: { subscription: "sub_base_f" } } } },
    } as unknown as Stripe.Event);
    assert.strictEqual((await getUser(u.id)).subscriptionStatus, "past_due", "f: base invoice.payment_failed marks past_due");
    console.log("ok - (f) foreign webhook events change nothing; base events still apply");
  }

  // (f2) A failed ADD-ON invoice re-syncs instead of marking the
  // base plan past due.
  {
    resetStripe();
    const u = await makeUser({
      stripeCustomerId: "cus_f2",
      subscriptionStatus: "active",
      stripeSubscriptionId: "sub_base_f2",
      stripeXAddonSubscriptionId: "sub_addon_f2",
      xAddonTierPriceId: TIER_STARTER,
    });
    addSub({ id: "sub_base_f2", customer: "cus_f2", prices: [BASE] });
    addSub({ id: "sub_addon_f2", customer: "cus_f2", prices: [TIER_STARTER], metadata: { zepostia_x_addon: "1" } });
    await handleStripeEvent(db, stripe, {
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_f2", parent: { subscription_details: { subscription: "sub_addon_f2" } } } },
    } as unknown as Stripe.Event);
    const row = billingFields(await getUser(u.id));
    assert.strictEqual(row.subscriptionStatus, "active", "f2: add-on failure never marks the base past due");
    assert.strictEqual(row.xAddonTierPriceId, TIER_STARTER, "f2: tier survives its own failed invoice (sync-driven)");
    console.log("ok - (f2) add-on invoice failure re-syncs, base untouched");
  }

  // (g) Stripe failure during reconcile → local row untouched.
  // And a row with no bound customer is never bound by email lookup:
  // the fake's customers.list is a tripwire that throws if called.
  {
    resetStripe();
    const u = await makeUser({
      stripeCustomerId: "cus_g",
      subscriptionStatus: "active",
      stripeSubscriptionId: "sub_base_g",
    });
    const before = billingFields(await getUser(u.id));
    fakeStripeStore.throwOnSubscriptionList = true;
    const changed = await reconcileSubscriptionFromStripe(db, await getUser(u.id));
    assert.strictEqual(changed, false, "g: failed reconcile reports no change");
    assert.deepStrictEqual(billingFields(await getUser(u.id)), before, "g: row untouched when Stripe throws");
    fakeStripeStore.throwOnSubscriptionList = false;

    const u2 = await makeUser({ email: "g2@test.dev", subscriptionStatus: "none" });
    const changed2 = await reconcileSubscriptionFromStripe(db, await getUser(u2.id));
    assert.strictEqual(changed2, false, "g: unbound row reconciles to nothing");
    assert.strictEqual((await getUser(u2.id)).stripeCustomerId, null, "g: no customer bound by email lookup");
    console.log("ok - (g) Stripe errors fall back to the local row; no email binding");
  }

  // (h) Comp accounts (Tam Inspires) are entitled regardless of
  // Stripe state — Stripe is never even consulted for them.
  {
    resetStripe();
    const tam = await makeUser({ email: "tam@taminspires.com", subscriptionStatus: "none" });
    const changed = await reconcileSubscriptionFromStripe(db, tam);
    assert.strictEqual(changed, true, "h: comp reconcile activates the account");
    const tamRow = await getUser(tam.id);
    assert.strictEqual(tamRow.subscriptionStatus, "active", "h: comp account is active");
    assert.strictEqual(tamRow.stripeCustomerId, null, "h: comp account never binds a Stripe customer");

    const comp2 = await makeUser({
      email: "comp2@test.dev",
      subscriptionStatus: "active",
      stripeCustomerId: "cus_h2",
      stripeSubscriptionId: "sub_keep_h2",
    });
    fakeStripeStore.throwOnSubscriptionList = true; // any Stripe consult would throw
    addSub({ id: "sub_crypto_h2", customer: "cus_h2", prices: ["price_cryptoalerts"] });
    const summary = await syncBillingForCustomer(db, stripe, "cus_h2");
    assert.strictEqual(summary.baseLive, true, "h: comp sync reports a live plan");
    const comp2Row = await getUser(comp2.id);
    assert.strictEqual(comp2Row.subscriptionStatus, "active", "h: comp stays active");
    assert.strictEqual(comp2Row.stripeSubscriptionId, "sub_keep_h2", "h: Stripe state never overwrites the comp grant");
    fakeStripeStore.throwOnSubscriptionList = false;
    console.log("ok - (h) comp accounts entitled regardless of Stripe state");
  }

  // (i) A FOREIGN checkout session can no longer bind its customer
  // to a user via a colliding client_reference_id.
  {
    resetStripe();
    const u = await makeUser({ email: "i@test.dev", subscriptionStatus: "none" });
    addSub({ id: "sub_crypto_i", customer: "cus_foreign_i", prices: ["price_cryptoalerts"] });
    await handleStripeEvent(db, stripe, {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_foreign",
          mode: "subscription",
          client_reference_id: String(u.id),
          customer: "cus_foreign_i",
          subscription: "sub_crypto_i",
          metadata: {},
          payment_status: "paid",
        },
      },
    } as unknown as Stripe.Event);
    const row = await getUser(u.id);
    assert.strictEqual(row.stripeCustomerId, null, "i: foreign session binds no customer");
    assert.strictEqual(row.stripeSubscriptionId, null, "i: foreign session records no subscription");
    assert.strictEqual(row.subscriptionStatus, "none", "i: foreign session grants nothing");
    console.log("ok - (i) foreign checkout session cannot bind via client_reference_id");
  }

  // (j) Zepostia's OWN checkout sessions still bind: a subscription
  // session whose subscription carries the base price, and a
  // setup-booking session (its metadata kind).
  {
    resetStripe();
    const u = await makeUser({ email: "j@test.dev", subscriptionStatus: "none" });
    addSub({ id: "sub_base_j", customer: "cus_j", prices: [BASE] });
    await handleStripeEvent(db, stripe, {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_zepostia",
          mode: "subscription",
          client_reference_id: String(u.id),
          customer: "cus_j",
          subscription: "sub_base_j",
          metadata: {},
          payment_status: "paid",
        },
      },
    } as unknown as Stripe.Event);
    const row = billingFields(await getUser(u.id));
    assert.strictEqual(row.stripeCustomerId, "cus_j", "j: own checkout binds the customer");
    assert.strictEqual(row.stripeSubscriptionId, "sub_base_j", "j: own checkout records the subscription");
    assert.strictEqual(row.subscriptionStatus, "active", "j: own checkout syncs the plan");

    const u2 = await makeUser({ email: "j2@test.dev", subscriptionStatus: "none" });
    await handleStripeEvent(db, stripe, {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_setup_1",
          mode: "payment",
          client_reference_id: String(u2.id),
          customer: "cus_j2",
          subscription: null,
          metadata: { kind: "setup_booking" },
          payment_status: "paid",
          payment_intent: "pi_1",
          amount_total: 12500,
          currency: "usd",
          customer_details: { email: "j2@test.dev" },
        },
      },
    } as unknown as Stripe.Event);
    const row2 = await getUser(u2.id);
    assert.strictEqual(row2.stripeCustomerId, "cus_j2", "j: setup-booking session binds the customer");
    const bookings = await db.select().from(schema.setupBookings).where(eq(schema.setupBookings.userId, u2.id));
    assert.strictEqual(bookings.length, 1, "j: setup booking recorded");
    console.log("ok - (j) zepostia's own checkout sessions still bind + record");
  }

  await pool.end();
  console.log("ALL BILLING REDO TESTS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
