// Test double for the "stripe" package — used ONLY by billing.test.ts,
// which bundles billing.ts/actions.ts with an esbuild alias:
//   --alias:stripe=./server/src/billing.fake-stripe.ts
// Production code never imports this file; the real Stripe SDK is used
// everywhere else.
//
// All instances share one module-level store, because billing.ts's
// getStripe() constructs a fresh client per call while the tests need
// to seed and inspect a single fake Stripe account. The store models
// the SHARED Stripe account from the Nov 5 billing redo: several
// products' subscriptions living side by side on one customer.

type AnyRecord = Record<string, any>;

export const fakeStripeStore = {
  subscriptions: [] as AnyRecord[],
  prices: new Map<string, AnyRecord>(),
  customers: new Map<string, AnyRecord>(),
  throwOnSubscriptionList: false,
  canceledSubscriptionIds: [] as string[],
  createdSubscriptions: [] as AnyRecord[],
  settledInvoiceCount: 0,
  reset() {
    this.subscriptions = [];
    this.prices = new Map();
    this.customers = new Map();
    this.throwOnSubscriptionList = false;
    this.canceledSubscriptionIds = [];
    this.createdSubscriptions = [];
    this.settledInvoiceCount = 0;
  },
};

function findSub(id: string): AnyRecord {
  const sub = fakeStripeStore.subscriptions.find((s) => s.id === id);
  if (!sub) throw new Error(`No such subscription: ${id}`);
  return sub;
}

let invoiceSeq = 0;

export default class FakeStripe {
  subscriptions = {
    list: async (params: { customer?: string }) => {
      if (fakeStripeStore.throwOnSubscriptionList) {
        throw new Error("Fake Stripe outage (subscriptions.list)");
      }
      return {
        data: fakeStripeStore.subscriptions.filter((s) => s.customer === params.customer),
      };
    },
    retrieve: async (id: string) => findSub(id),
    cancel: async (id: string) => {
      const sub = findSub(id);
      sub.status = "canceled";
      fakeStripeStore.canceledSubscriptionIds.push(id);
      return sub;
    },
    create: async (params: AnyRecord) => {
      const now = Math.floor(Date.now() / 1000);
      const id = `sub_fake_${fakeStripeStore.createdSubscriptions.length + 1}`;
      const trialEnd = typeof params.trial_end === "number" ? params.trial_end : null;
      const sub: AnyRecord = {
        id,
        customer: params.customer,
        status: trialEnd && trialEnd > now ? "trialing" : "active",
        created: now,
        trial_end: trialEnd,
        cancel_at_period_end: false,
        metadata: params.metadata ?? {},
        default_payment_method: params.default_payment_method ?? null,
        items: {
          data: (params.items ?? []).map((item: AnyRecord, i: number) => {
            const price = fakeStripeStore.prices.get(item.price);
            return {
              id: `${id}_it${i}`,
              price: { id: item.price, unit_amount: price?.unit_amount ?? 0, currency: price?.currency ?? "usd" },
              current_period_start: now,
              current_period_end: trialEnd ?? now + 30 * 86400,
            };
          }),
        },
      };
      fakeStripeStore.subscriptions.push(sub);
      fakeStripeStore.createdSubscriptions.push(sub);
      return sub;
    },
  };

  subscriptionItems = {
    update: async (itemId: string, params: AnyRecord) => {
      for (const sub of fakeStripeStore.subscriptions) {
        const item = sub.items.data.find((it: AnyRecord) => it.id === itemId);
        if (item) {
          const price = fakeStripeStore.prices.get(params.price);
          item.price = { id: params.price, unit_amount: price?.unit_amount ?? item.price.unit_amount, currency: price?.currency ?? "usd" };
          return item;
        }
      }
      throw new Error(`No such subscription item: ${itemId}`);
    },
    del: async (itemId: string) => {
      for (const sub of fakeStripeStore.subscriptions) {
        const idx = sub.items.data.findIndex((it: AnyRecord) => it.id === itemId);
        if (idx >= 0) {
          sub.items.data.splice(idx, 1);
          return { id: itemId, deleted: true };
        }
      }
      throw new Error(`No such subscription item: ${itemId}`);
    },
  };

  customers = {
    // Tripwire: the billing redo removed the find-customer-by-email
    // fallback. Any call here means it came back — fail loudly.
    list: async () => {
      throw new Error("customers.list called — the email lookup must not exist");
    },
    retrieve: async (id: string) => {
      return fakeStripeStore.customers.get(id) ?? { id, deleted: false, invoice_settings: {} };
    },
    create: async (params: AnyRecord) => {
      const customer = { id: `cus_fake_${fakeStripeStore.customers.size + 1}`, ...params };
      fakeStripeStore.customers.set(customer.id, customer);
      return customer;
    },
  };

  prices = {
    retrieve: async (id: string) => {
      const price = fakeStripeStore.prices.get(id);
      if (!price) throw new Error(`No such price: ${id}`);
      return price;
    },
  };

  invoiceItems = {
    create: async (params: AnyRecord) => ({ id: `ii_fake_${++invoiceSeq}`, ...params }),
  };

  invoices = {
    create: async (params: AnyRecord) => ({ id: `in_fake_${++invoiceSeq}`, status: "draft", ...params }),
    finalizeInvoice: async (id: string) => ({ id, status: "open" }),
    pay: async (id: string) => {
      fakeStripeStore.settledInvoiceCount += 1;
      return { id, status: "paid" };
    },
    voidInvoice: async (id: string) => ({ id, status: "void" }),
    list: async () => ({ data: [] }),
  };

  checkout = {
    sessions: {
      list: async () => ({ data: [] }),
      retrieve: async () => {
        throw new Error("checkout.sessions.retrieve not modeled in the fake");
      },
    },
  };

  billingPortal = {
    sessions: {
      create: async () => ({ url: "https://example.invalid/portal" }),
    },
  };

  webhooks = {
    constructEvent: () => {
      throw new Error("constructEvent not modeled in the fake");
    },
  };
}
