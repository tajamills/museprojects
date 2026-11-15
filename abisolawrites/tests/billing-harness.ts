// Billing-redo harness (Nov 5, 2026): proves the Abisola anchor on the
// shared Stripe account. Runs against the REAL billing module and the
// REAL file store — only Stripe's line-item reads are faked, from
// fixtures. Bundled+run by scripts/run-billing-tests.mjs; DATA_FILE must
// point at a throwaway path.
import {
  collectSessions,
  confirmCheckoutReturn,
  constructEventWithSecrets,
  grantVerifiedCheckoutSession,
  parseWebhookSecrets,
  sessionMatchesUser,
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
    // (b) Genuine FB Guide purchase (added Nov 15, 2026 with the product):
    // $0.99 one-time, its own catalog amount + product name.
    genuineFbGuide: {
      session: {
        id: `cs_fbguide_${userId}`, mode: "payment", ...base,
        client_reference_id: userId, metadata: { itemId: "fbguide", userId, email }, customer_details: { email },
      },
      lines: LI(99, "How to Get Muse to Write Your Facebook Posts (full unlock)"),
    },
    // (a) Foreign payment carrying the guide's metadata but another
    // product's amount/name: must grant nothing.
    foreignFbGuideWrongAmount: {
      session: {
        id: `cs_ffb_${userId}`, mode: "payment", ...base,
        client_reference_id: userId, metadata: { itemId: "fbguide", userId }, customer_details: { email },
      },
      lines: LI(999, "Some Other Guide"),
    },
  };
}

async function runPath(
  store: Store,
  userId: string,
  email: string,
  via: "webhook" | "reconciled" | "sweep" | "return",
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
  check("genuine FB Guide grants", wa.get("genuineFbGuide") === true);
  check("foreign amount w/ guide metadata grants nothing", wa.get("foreignFbGuideWrongAmount") === false);
  const aBooks = await booksOf(store, a.id, a.email);
  check("buyer A owns exactly {doors1, fbguide, quietlyready}", JSON.stringify(aBooks) === JSON.stringify(["doors1", "fbguide", "quietlyready"]), aBooks.join(","));

  console.log("reconcile path (same fixtures, fresh buyer):");
  const rb = await runPath(store, b.id, b.email, "reconciled");
  check("reconcile grants genuine items", rb.get("genuineQuietly") === true && rb.get("promoDoors") === true && rb.get("genuineFbGuide") === true);
  check(
    "reconcile grants no foreign items",
    ["foreignSubscription", "foreignSubWithBookMetadata", "foreignWrongAmount", "foreignWrongName", "foreignFbGuideWrongAmount", "unpaid", "stripeReadFails"].every(
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
    JSON.stringify(cBooks) === JSON.stringify(["doors1", "fbguide", "quietlyready", "trust"]),
    cBooks.join(","),
  );

  // Verifier unit sanity: no stripe fetcher -> nothing verifies.
  const noFetch = await verifyAbisolaBookSession(null, fxA.genuineQuietly.session);
  check("no Stripe configured verifies nothing", noFetch === null);

  // ---------------------------------------------------------------
  // Nov 15, 2026 incident reproductions: a REAL purchase of the FB
  // Guide completed but never showed as bought. Each block below pins
  // one failure mode found in the grant machinery that day.
  console.log("incident reproductions (Nov 15, 2026):");

  // (1) LIVE-SHAPE line item: the line item's `description` carries the
  // product DESCRIPTION text (which this app's checkout sets:
  // "All 8 chapters, yours to keep, forever.") while the catalog name
  // lives on the expanded price.product.name. The pre-fix verifier read
  // `description` first, so this shape verified as NOTHING on every
  // path at once. It must grant.
  const d = await store.createUser("buyer-d@example.com", "hash");
  const liveShapeSession: CheckoutSessionLike = {
    id: "cs_live_shape_fbguide",
    mode: "payment", status: "complete", payment_status: "paid",
    client_reference_id: d.id,
    metadata: { itemId: "fbguide", userId: d.id, email: d.email },
    customer_details: { email: "Buyer-D@Example.com" }, // buyer typed it mixed-case
  };
  const liveShapeLines: LineItemLike[] = [
    {
      quantity: 1,
      description: "All 8 chapters, yours to keep, forever.",
      price: {
        unit_amount: 99, currency: "usd",
        product: { name: "How to Get Muse to Write Your Facebook Posts (full unlock)" },
      },
    },
  ];
  const fetchLiveShape = async (sid: string): Promise<LineItemLike[]> => {
    if (sid === liveShapeSession.id) return liveShapeLines;
    throw new Error("unknown session (fixture)");
  };
  check(
    "live-shape line item (description = product description, name on expanded product) verifies",
    (await verifyAbisolaBookSession(fetchLiveShape, liveShapeSession))?.id === "fbguide",
  );
  check(
    "live-shape FB Guide purchase grants via webhook",
    (await grantVerifiedCheckoutSession({ fetchLineItems: fetchLiveShape, store }, liveShapeSession, "webhook")) === true,
  );
  check(
    "buyer D owns fbguide after the live-shape grant",
    JSON.stringify(await booksOf(store, d.id, d.email)) === JSON.stringify(["fbguide"]),
  );

  // (1b) Name available ONLY from the expanded product (description
  // null) must also grant; name available from NEITHER source (product
  // unexpanded + description carrying prose) must fail closed.
  const e = await store.createUser("buyer-e@example.com", "hash");
  const expansionOnlySession: CheckoutSessionLike = {
    id: "cs_expansion_only_doors",
    mode: "payment", status: "complete", payment_status: "paid",
    client_reference_id: e.id,
    metadata: { itemId: "doors1", userId: e.id, email: e.email },
    customer_details: { email: e.email },
  };
  const fetchExpansionOnly = async (): Promise<LineItemLike[]> => [
    {
      quantity: 1, description: null,
      price: { unit_amount: 299, currency: "usd", product: { name: "Doors — Book One (full unlock)" } },
    },
  ];
  check(
    "name from expanded product only (description null) grants",
    (await grantVerifiedCheckoutSession({ fetchLineItems: fetchExpansionOnly, store }, expansionOnlySession, "webhook")) === true,
  );
  const noNameSession: CheckoutSessionLike = { ...expansionOnlySession, id: "cs_no_name_doors" };
  const fetchNoName = async (): Promise<LineItemLike[]> => [
    {
      quantity: 1, description: "All 18 chapters, yours to keep, forever.",
      price: { unit_amount: 299, currency: "usd", product: "prod_unexpanded" },
    },
  ];
  check(
    "no name source matches (unexpanded product + prose description) grants nothing",
    (await grantVerifiedCheckoutSession({ fetchLineItems: fetchNoName, store }, noNameSession, "webhook")) === false,
  );

  // (2) DUPLICATE WEBHOOK ENDPOINTS, two signing secrets: Stripe
  // delivers one copy per endpoint, each signed with that endpoint's
  // secret. Verification must accept a payload signed by ANY
  // configured secret, reject when none matches, and the duplicate
  // delivery of the same event must still grant exactly once.
  check(
    "parseWebhookSecrets merges, trims, dedupes",
    JSON.stringify(parseWebhookSecrets(" whsec_a , whsec_b ", "whsec_b,whsec_c", undefined)) ===
      JSON.stringify(["whsec_a", "whsec_b", "whsec_c"]),
  );
  const fakeConstruct = (goodSecret: string) => (secret: string) => {
    if (secret !== goodSecret) throw new Error("No signatures found matching the expected signature for payload.");
    return { type: "checkout.session.completed" };
  };
  check(
    "event signed with the SECOND endpoint's secret verifies when both are configured",
    constructEventWithSecrets(fakeConstruct("whsec_b"), parseWebhookSecrets("whsec_a,whsec_b")).type ===
      "checkout.session.completed",
  );
  let rejected = false;
  try {
    constructEventWithSecrets(fakeConstruct("whsec_b"), parseWebhookSecrets("whsec_a"));
  } catch {
    rejected = true;
  }
  check("event signed with an unconfigured secret is rejected", rejected);
  check(
    "duplicate delivery of the same session (second endpoint's copy) dedupes",
    (await grantVerifiedCheckoutSession({ fetchLineItems: fetchLiveShape, store }, liveShapeSession, "webhook")) === false &&
      JSON.stringify(await booksOf(store, d.id, d.email)) === JSON.stringify(["fbguide"]),
  );

  // (3) IDENTITY MATCHING for the reconcile: the session must find its
  // buyer by client_reference_id or metadata.userId even when the
  // emails differ, and by email across case differences (a buyer who
  // signed up as Tmara@Gmail.com vs the session's tmara@gmail.com).
  const idSession: CheckoutSessionLike = {
    id: "cs_identity", mode: "payment", status: "complete", payment_status: "paid",
    client_reference_id: "user-123", metadata: { itemId: "fbguide", userId: "user-123" },
    customer_details: { email: "someone-else@example.com" },
  };
  check("session matches by client_reference_id despite a different email",
    sessionMatchesUser(idSession, "user-123", "tmara@gmail.com") === true);
  check("session matches by metadata.userId",
    sessionMatchesUser({ ...idSession, client_reference_id: null }, "user-123", "x@example.com") === true);
  check("session matches by email across case (Tmara@Gmail.com vs tmara@gmail.com)",
    sessionMatchesUser(
      { id: "cs_email", customer_details: { email: "Tmara@Gmail.com" }, metadata: {} },
      "user-999", "tmara@gmail.com",
    ) === true);
  check("session does not match a stranger",
    sessionMatchesUser(idSession, "user-999", "nobody@example.com") === false);

  // (4) SHARED-ACCOUNT WINDOW: on a Stripe account shared by four
  // stores, a buyer's completed session can sit far below the newest
  // 100 completes. A newest-100 scan (the reconcile's window) misses
  // it; the paginated collector the sweep uses (max 500) finds it, and
  // a sweep-style grant pass over the collected sessions lands the
  // book with NO buyer action at all.
  const f = await store.createUser("buyer-f@example.com", "hash");
  const windowSessions: CheckoutSessionLike[] = [];
  for (let i = 0; i < 250; i++) {
    windowSessions.push({
      id: `cs_win_${String(i).padStart(4, "0")}`,
      mode: "payment", status: "complete", payment_status: "paid", metadata: {},
    });
  }
  const buriedGuide: CheckoutSessionLike = {
    id: "cs_win_buried_fbguide",
    mode: "payment", status: "complete", payment_status: "paid",
    client_reference_id: f.id,
    metadata: { itemId: "fbguide", userId: f.id, email: f.email },
    customer_details: { email: f.email },
  };
  windowSessions[230] = buriedGuide;
  const fakePager = async (startingAfter?: string) => {
    const start = startingAfter
      ? windowSessions.findIndex((s) => s.id === startingAfter) + 1
      : 0;
    const data = windowSessions.slice(start, start + 100);
    return { data, has_more: start + data.length < windowSessions.length };
  };
  const newest100 = await collectSessions(fakePager, 100);
  check("newest-100 scan misses the session buried at position 230",
    newest100.length === 100 && !newest100.some((s) => s.id === buriedGuide.id));
  const deepScan = await collectSessions(fakePager, 500);
  check("paginated 500 scan finds the buried session",
    deepScan.length === 250 && deepScan.some((s) => s.id === buriedGuide.id));
  const fetchBuried = async (sid: string): Promise<LineItemLike[]> => {
    if (sid === buriedGuide.id) return liveShapeLines;
    throw new Error("not a book session (fixture)");
  };
  let sweepGrants = 0;
  for (const s of deepScan) {
    if (await grantVerifiedCheckoutSession({ fetchLineItems: fetchBuried, store }, s, "sweep")) sweepGrants++;
  }
  check("sweep-style pass over the deep scan grants the buried purchase exactly once",
    sweepGrants === 1 && JSON.stringify(await booksOf(store, f.id, f.email)) === JSON.stringify(["fbguide"]));

  // ---------------------------------------------------------------
  // INSTANT OPEN (Nov 15, 2026): the buyer returns from Stripe with
  // ?checkout=success&session_id=cs_… and the reader confirms the
  // session server-side. The grant must land on that FIRST view — no
  // refresh — and the confirm must be exactly as strict as every other
  // path: only a session Stripe itself reports as this user's paid,
  // genuine Abisola book purchase grants anything.
  console.log("checkout return — instant open (Nov 15, 2026):");

  const g = await store.createUser("buyer-g@example.com", "hash");
  const fxG = fixtures(g.id, g.email);
  const returnDeps = {
    fetchLineItems: async (sid: string): Promise<LineItemLike[]> => {
      const fx = Object.values(fxG).find((x) => x.session.id === sid);
      if (!fx || fx.lines === "throws") throw new Error("stripe read failed (fixture)");
      return fx.lines;
    },
    store,
    retrieveSession: async (sid: string): Promise<CheckoutSessionLike | null> => {
      const fx = Object.values(fxG).find((x) => x.session.id === sid);
      return fx ? fx.session : null; // unknown id: Stripe has no such session
    },
  };

  // (i) Paid session return: grants on the spot, and the outcome the
  // endpoint answers with already says owned — the first view shows it.
  const ret1 = await confirmCheckoutReturn(returnDeps, fxG.genuineFbGuide.session.id, g);
  check("paid session return grants instantly (outcome owned, granted)",
    ret1.status === "owned" && ret1.granted === true && ret1.bookId === "fbguide");
  check("buyer G owns fbguide immediately after the return confirm",
    JSON.stringify(await booksOf(store, g.id, g.email)) === JSON.stringify(["fbguide"]));
  // (ii) Re-confirming the same return (reader poll, double submit):
  // still owned, no duplicate grant.
  const ret2 = await confirmCheckoutReturn(returnDeps, fxG.genuineFbGuide.session.id, g);
  check("re-confirm of the same session: owned, deduped (granted=false)",
    ret2.status === "owned" && ret2.granted === false && ret2.bookId === "fbguide");

  // (iii) Unpaid session: the buyer bailed mid-payment — nothing.
  const retUnpaid = await confirmCheckoutReturn(returnDeps, fxG.unpaid.session.id, g);
  check("unpaid session return grants nothing", retUnpaid.status === "rejected" && retUnpaid.bookId === null);
  check("buyer G state unchanged after the unpaid return",
    JSON.stringify(await booksOf(store, g.id, g.email)) === JSON.stringify(["fbguide"]));

  // (iv) Forged / unknown / malformed ids: Stripe has no such session,
  // or the id isn't a session id at all — nothing, and no crash.
  check("forged session id (well-shaped, unknown to Stripe) grants nothing",
    (await confirmCheckoutReturn(returnDeps, "cs_live_forged000000", g)).status === "rejected");
  check("malformed session id grants nothing",
    (await confirmCheckoutReturn(returnDeps, "fbguide", g)).status === "rejected");
  check("no Stripe configured: return confirm grants nothing",
    (await confirmCheckoutReturn({ ...returnDeps, retrieveSession: null }, fxG.genuineQuietly.session.id, g)).status === "rejected");

  // (v) Foreign-product sessions presented at the return: a Kovala /
  // CryptoAlerts-shaped session carrying book metadata at the wrong
  // amount, and a subscription completion — both rejected even though
  // they carry buyer G's own identifiers.
  check("foreign session (book metadata, wrong amount/name) grants nothing at return",
    (await confirmCheckoutReturn(returnDeps, fxG.foreignWrongAmount.session.id, g)).status === "rejected");
  check("foreign subscription session grants nothing at return",
    (await confirmCheckoutReturn(returnDeps, fxG.foreignSubWithBookMetadata.session.id, g)).status === "rejected");
  check("buyer G still owns exactly {fbguide} after the foreign returns",
    JSON.stringify(await booksOf(store, g.id, g.email)) === JSON.stringify(["fbguide"]));

  // (vi) SOMEONE ELSE'S paid session: buyer H presents buyer G's (now
  // granted) session id — the identity matcher refuses; and a fresh
  // paid session keyed to G presented by H also grants H nothing.
  const h = await store.createUser("buyer-h@example.com", "hash");
  check("another buyer's session id confirms nothing for the presenter",
    (await confirmCheckoutReturn(returnDeps, fxG.genuineFbGuide.session.id, h)).status === "rejected");
  check("buyer H owns nothing after presenting G's session",
    JSON.stringify(await booksOf(store, h.id, h.email)) === JSON.stringify([]));
  const retOther = await confirmCheckoutReturn(returnDeps, fxG.genuineQuietly.session.id, h);
  check("G's paid Quietly Ready session presented by H grants H nothing",
    retOther.status === "rejected" &&
      JSON.stringify(await booksOf(store, h.id, h.email)) === JSON.stringify([]));

  // (vii) EMAIL-ONLY identity across case (the Tmara shape): the
  // session carries no client_reference_id / metadata.userId — only
  // the email Stripe collected, typed in mixed case — and the account
  // email is lower-case. The return confirm must still match + grant.
  const tmara = await store.createUser("tmara@gmail.com", "hash");
  const tmaraSession: CheckoutSessionLike = {
    id: "cs_tmara_fbguide",
    mode: "payment", status: "complete", payment_status: "paid",
    metadata: { itemId: "fbguide" },
    customer_details: { email: "Tmara@Gmail.com" },
  };
  const tmaraDeps = {
    fetchLineItems: async (sid: string): Promise<LineItemLike[]> => {
      if (sid === tmaraSession.id) return liveShapeLines;
      throw new Error("unknown session (fixture)");
    },
    store,
    retrieveSession: async (sid: string): Promise<CheckoutSessionLike | null> =>
      sid === tmaraSession.id ? tmaraSession : null,
  };
  const retTmara = await confirmCheckoutReturn(tmaraDeps, tmaraSession.id, tmara);
  check("email-only session matches across case (Tmara@Gmail.com) and grants at return",
    retTmara.status === "owned" && retTmara.granted === true && retTmara.bookId === "fbguide");
  check("Tmara-shaped buyer owns fbguide after the return confirm",
    JSON.stringify(await booksOf(store, tmara.id, tmara.email)) === JSON.stringify(["fbguide"]));

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("harness crashed", err);
  process.exit(2);
});
