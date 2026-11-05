// Billing-redo harness (Nov 5, 2026): proves the Abisola anchor on the
// shared Stripe account. Runs against the REAL billing module and the
// REAL file store — only Stripe's line-item reads are faked, from
// fixtures. Bundled+run by scripts/run-billing-tests.mjs; DATA_FILE must
// point at a throwaway path.
import {
  grantVerifiedCheckoutSession,
  verifyAbisolaBookSession,
  type CheckoutSessionLike,
  type LineItemLike,
} from "../server/src/billing.js";
import { createStore, type Store } from "../server/src/store.js";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type Fixture = { session: CheckoutSessionLike; lines: LineItemLike[] | "throws" };

const LI = (unit_amount: number, name: string, quantity = 1): LineItemLike[] => [
  { quantity, description: name, price: { unit_amount, currency: "usd", product: { name } } },
];

function fixtures(userId: string, email: string): Record<string, Fixture> {
  const base = { status: "complete", payment_status: "paid" } as const;
  return {
    // (a) Foreign product: a CryptoAlerts SUBSCRIPTION completion on the
    // shared account — the Kovala incident shape, mirrored.
    foreignSubscription: {
      session: { id: `cs_fsub_${userId}`, mode: "subscription", ...base, metadata: {}, customer_details: { email } },
      lines: LI(888, "CryptoAlerts"),
    },
    // (a) Hostile collision: subscription mode but carrying book metadata.
    foreignSubWithBookMetadata: {
      session: {
        id: `cs_fsubm_${userId}`, mode: "subscription", ...base,
        client_reference_id: userId, metadata: { itemId: "doors1", userId }, customer_details: { email },
      },
      lines: LI(299, "Doors — Book One (full unlock)"),
    },
    // (a) Foreign payment, right metadata, wrong amount + wrong product.
    foreignWrongAmount: {
      session: {
        id: `cs_famt_${userId}`, mode: "payment", ...base,
        client_reference_id: userId, metadata: { itemId: "doors1", userId }, customer_details: { email },
      },
      lines: LI(888, "CryptoAlerts"),
    },
    // (a) Foreign payment, right metadata + amount, wrong product name
    // (e.g. a Kovala-priced item).
    foreignWrongName: {
      session: {
        id: `cs_fname_${userId}`, mode: "payment", ...base,
        client_reference_id: userId, metadata: { itemId: "trust", userId }, customer_details: { email },
      },
      lines: LI(1888, "Kovala Plan"),
    },
    // (a) Unpaid async session must not grant before money exists.
    unpaid: {
      session: {
        id: `cs_unpaid_${userId}`, mode: "payment", status: "complete", payment_status: "unpaid",
        client_reference_id: userId, metadata: { itemId: "doors1", userId }, customer_details: { email },
      },
      lines: LI(299, "Doors — Book One (full unlock)"),
    },
    // (a) Stripe line-item read fails -> fail closed, grant nothing.
    stripeReadFails: {
      session: {
        id: `cs_throws_${userId}`, mode: "payment", ...base,
        client_reference_id: userId, metadata: { itemId: "trust", userId }, customer_details: { email },
      },
      lines: "throws",
    },
    // (b) Genuine Quietly Ready purchase (the Meta-ad landing's book).
    genuineQuietly: {
      session: {
        id: `cs_qr_${userId}`, mode: "payment", ...base,
        client_reference_id: userId, metadata: { itemId: "quietlyready", userId, email }, customer_details: { email },
      },
      lines: LI(1888, "Quietly Ready (full unlock)"),
    },
    // (b) Genuine Doors purchase paid with a 100%-off promo code: $0 due,
    // payment_status "no_payment_required", catalog unit_amount intact.
    promoDoors: {
      session: {
        id: `cs_doors_${userId}`, mode: "payment", status: "complete", payment_status: "no_payment_required",
        metadata: { itemId: "doors1", email }, customer_details: { email },
      },
      lines: LI(299, "Doors — Book One (full unlock)"),
    },
  };
}

async function runPath(
  store: Store,
  userId: string,
  email: string,
  via: "webhook" | "reconciled" | "sweep",
): Promise<Map<string, boolean>> {
  const fx = fixtures(userId, email);
  const fetchLineItems = async (sessionId: string): Promise<LineItemLike[]> => {
    const f = Object.values(fx).find((x) => x.session.id === sessionId);
    if (!f || f.lines === "throws") throw new Error("stripe read failed (fixture)");
    return f.lines;
  };
  const results = new Map<string, boolean>();
  for (const [name, f] of Object.entries(fx)) {
    results.set(name, await grantVerifiedCheckoutSession({ fetchLineItems, store }, f.session, via));
  }
  return results;
}

async function booksOf(store: Store, userId: string, email: string): Promise<string[]> {
  const user = (await store.findUserById(userId)) ?? (await store.findUserByEmail(email));
  if (!user) return ["<no user>"];
  return (await store.listEntitlements(user)).map((e) => e.bookId).sort();
}

async function main() {
  const store: Store = createStore();
  await store.init();
  console.log(`store kind: ${store.kind}`);

  // Two buyers run the SAME fixture set: one through the webhook path,
  // one through the reconcile path (c: both must land identical state).
  const a = await store.createUser("buyer-a@example.com", "hash");
  const b = await store.createUser("buyer-b@example.com", "hash");

  console.log("webhook path:");
  const wa = await runPath(store, a.id, a.email, "webhook");
  check("foreign subscription grants nothing", wa.get("foreignSubscription") === false);
  check("subscription w/ book metadata grants nothing", wa.get("foreignSubWithBookMetadata") === false);
  check("foreign amount grants nothing", wa.get("foreignWrongAmount") === false);
  check("foreign product name grants nothing", wa.get("foreignWrongName") === false);
  check("unpaid session grants nothing", wa.get("unpaid") === false);
  check("stripe read failure grants nothing (fail closed)", wa.get("stripeReadFails") === false);
  check("genuine Quietly Ready grants", wa.get("genuineQuietly") === true);
  check("100%-off promo Doors grants", wa.get("promoDoors") === true);
  const aBooks = await booksOf(store, a.id, a.email);
  check("buyer A owns exactly {doors1, quietlyready}", JSON.stringify(aBooks) === JSON.stringify(["doors1", "quietlyready"]), aBooks.join(","));

  console.log("reconcile path (same fixtures, fresh buyer):");
  const rb = await runPath(store, b.id, b.email, "reconciled");
  check("reconcile grants genuine items", rb.get("genuineQuietly") === true && rb.get("promoDoors") === true);
  check(
    "reconcile grants no foreign items",
    ["foreignSubscription", "foreignSubWithBookMetadata", "foreignWrongAmount", "foreignWrongName", "unpaid", "stripeReadFails"].every(
      (k) => rb.get(k) === false,
    ),
  );
  const bBooks = await booksOf(store, b.id, b.email);
  check("reconcile state == webhook state", JSON.stringify(bBooks) === JSON.stringify(aBooks), bBooks.join(","));

  console.log("idempotency + existing buyer:");
  const fxA = fixtures(a.id, a.email);
  const fetchA = async (sid: string) => {
    const f = Object.values(fxA).find((x) => x.session.id === sid);
    if (!f || f.lines === "throws") throw new Error("fixture");
    return f.lines;
  };
  const again = await grantVerifiedCheckoutSession({ fetchLineItems: fetchA, store }, fxA.genuineQuietly.session, "sweep");
  check("re-grant of the same session dedupes", again === false);
  check("buyer A state unchanged after re-run", JSON.stringify(await booksOf(store, a.id, a.email)) === JSON.stringify(aBooks));

  // (d) Existing buyer with a manual comp (admin grant) + an old stripe
  // grant: a sweep over the foreign fixtures must not remove or add.
  const c = await store.createUser("buyer-c@example.com", "hash");
  await store.grantEntitlement({ userId: c.id, email: c.email, bookId: "trust", source: "manual" });
  await store.grantEntitlement({ userId: c.id, email: c.email, bookId: "doors1", source: "stripe", stripeSessionId: "cs_legacy_1" });
  await runPath(store, c.id, c.email, "sweep");
  const cBooks = await booksOf(store, c.id, c.email);
  check(
    "existing buyer keeps comp + legacy grant, gains genuine sweep grants only",
    JSON.stringify(cBooks) === JSON.stringify(["doors1", "quietlyready", "trust"]),
    cBooks.join(","),
  );

  // Verifier unit sanity: no stripe fetcher -> nothing verifies.
  const noFetch = await verifyAbisolaBookSession(null, fxA.genuineQuietly.session);
  check("no Stripe configured verifies nothing", noFetch === null);

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("harness crashed", err);
  process.exit(2);
});
