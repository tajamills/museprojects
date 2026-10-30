// CryptoBagTracker server actions — ported from the Hatch TS space to plain
// Express-dispatchable functions.
//
// The original used `defineAction` from "@hatch/space-sdk" and a `Ctx` whose
// `db()` accessor returned the space's SQLite drizzle instance. Here each
// action is a plain `{ request, response, handler }` object; `Ctx` carries a
// Postgres-backed drizzle db directly, and `invalidateQueries()` is a no-op
// (the React client invalidates its react-query cache itself).
//
// POST /actions dispatches `{action, args}` to `Actions[action].handler`
// after validating `args` against the action's zod `request` schema.
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { normalizePhoneNumber, smsAlertsEnabled } from "./sms.js";
import { fetchTransactions as fetchCoinbaseTransactions } from "./exchanges/coinbase.js";
import { fetchTransactions as fetchKrakenTransactions } from "./exchanges/kraken.js";
import { fetchTransactions as fetchUpholdTransactions } from "./exchanges/uphold.js";
import type { ExchangeFetcher, NormalizedTx } from "./exchanges/types.js";
import { baseUrl, getStripe, reconcileSubscriptionFromStripe } from "./billing.js";
import { computeEntitlement, getEntitlement } from "./entitlement.js";
import {
  build8949,
  buildScheduleD,
  processTransactions,
  type CostBasisMethod,
  type EngineTransaction,
} from "./taxEngine.js";

export interface Ctx {
  db: NodePgDatabase<typeof schema>;
  /** No-op outside the Hatch runtime. */
  invalidateQueries: () => void;
  /** Request origin, for building absolute URLs (e.g. Stripe redirects). */
  origin: string | null;
}

type Method = "FIFO" | "LIFO" | "HIFO";
type TxRow = typeof schema.transactions.$inferSelect;
type Lot = { asset: string; amount: number; basis: number; acquiredAt: number; walletId: number | null };
type GainLine = { description: string; dateAcquired: string; dateSold: string; proceeds: number; basis: number; gain: number; term: "short" | "long" };

async function requireUser(ctx: Ctx, token: string) {
  const db = ctx.db;
  const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.token, token)).limit(1);
  const session = rows[0];
  if (!session) throw new Error("Your session has expired. Sign in again.");
  const users = await db.select().from(schema.users).where(eq(schema.users.id, session.userId)).limit(1);
  const user = users[0];
  if (!user) throw new Error("Account not found.");
  return user;
}

export const SUBSCRIPTION_REQUIRED_MESSAGE =
  "Subscription required: your 7-day free trial has ended. Subscribe for $8.88/month on the Billing page to keep adding and changing your data. Your records stay saved, and you can still view everything.";

/**
 * requireUser + the entitlement gate (entitlement.ts). Every mutating
 * action goes through here: comped accounts, live Stripe subscribers, and
 * accounts still inside the 7-day signup trial pass; everyone else gets a
 * plain "subscription required" refusal. Read actions keep using
 * requireUser — a locked account's data is never held hostage.
 */
async function requireEntitledUser(ctx: Ctx, token: string) {
  const user = await requireUser(ctx, token);
  const { entitlement } = await getEntitlement(ctx.db, user);
  if (!entitlement.entitled) throw new Error(SUBSCRIPTION_REQUIRED_MESSAGE);
  return user;
}

function ymd(ms: number) { return new Date(ms).toISOString().slice(0, 10); }
function money(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function hex(bytes: Uint8Array) { return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function passwordHash(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, material, 256);
  return `pbkdf2$120000$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}
async function passwordVerify(password: string, stored: string) {
  const [kind, iterationsText, saltHex, expected] = stored.split("$");
  if (kind !== "pbkdf2" || !iterationsText || !saltHex || !expected) return false;
  const salt = new Uint8Array((saltHex.match(/.{2}/g) ?? []).map((part) => Number.parseInt(part, 16)));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: Number(iterationsText), hash: "SHA-256" }, material, 256);
  return hex(new Uint8Array(bits)) === expected;
}

function computeTax(rows: TxRow[], method: Method) {
  const lots: Lot[] = [];
  const gains: GainLine[] = [];
  const custody: Array<{ asset: string; amount: number; fromWalletId: number | null; toWalletId: number | null; occurredAt: string }> = [];
  let ordinaryIncome = 0;

  const addLot = (asset: string, amount: number, basis: number, acquiredAt: number, walletId: number | null) => {
    if (amount > 0) lots.push({ asset: asset.toUpperCase(), amount, basis, acquiredAt, walletId });
  };
  const eligible = (asset: string, walletId: number | null) => lots
    .map((lot, index) => ({ lot, index }))
    .filter(({ lot }) => lot.asset === asset.toUpperCase() && lot.amount > 1e-12 && (walletId == null || lot.walletId === walletId))
    .sort((a, b) => method === "FIFO" ? a.lot.acquiredAt - b.lot.acquiredAt : method === "LIFO" ? b.lot.acquiredAt - a.lot.acquiredAt : (b.lot.basis / b.lot.amount) - (a.lot.basis / a.lot.amount));
  const dispose = (asset: string, amount: number, totalProceeds: number, soldAt: number, walletId: number | null) => {
    let remaining = amount;
    for (const { lot } of eligible(asset, walletId)) {
      if (remaining <= 1e-12) break;
      const used = Math.min(remaining, lot.amount);
      const unitBasis = lot.amount > 0 ? lot.basis / lot.amount : 0;
      const usedBasis = unitBasis * used;
      const proceeds = amount > 0 ? totalProceeds * (used / amount) : 0;
      const term: "short" | "long" = soldAt - lot.acquiredAt > 365 * 24 * 60 * 60 * 1000 ? "long" : "short";
      gains.push({ description: `${used.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} ${asset.toUpperCase()}`, dateAcquired: ymd(lot.acquiredAt), dateSold: ymd(soldAt), proceeds: money(proceeds), basis: money(usedBasis), gain: money(proceeds - usedBasis), term });
      lot.amount -= used;
      lot.basis -= usedBasis;
      remaining -= used;
    }
  };
  const move = (asset: string, amount: number, fromWalletId: number | null, toWalletId: number | null, occurredAt: number) => {
    let remaining = amount;
    for (const { lot } of eligible(asset, fromWalletId)) {
      if (remaining <= 1e-12) break;
      const moved = Math.min(remaining, lot.amount);
      const unitBasis = lot.amount > 0 ? lot.basis / lot.amount : 0;
      const movedBasis = unitBasis * moved;
      if (Math.abs(moved - lot.amount) < 1e-12) {
        lot.walletId = toWalletId;
      } else {
        lot.amount -= moved;
        lot.basis -= movedBasis;
        addLot(lot.asset, moved, movedBasis, lot.acquiredAt, toWalletId);
      }
      remaining -= moved;
    }
    custody.push({ asset: asset.toUpperCase(), amount, fromWalletId, toWalletId, occurredAt: new Date(occurredAt).toISOString() });
  };

  for (const tx of [...rows].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    const at = tx.occurredAt.getTime();
    const type = tx.type.toUpperCase();
    if (type === "BUY") addLot(tx.asset, tx.amount, tx.amount * tx.priceUsd + tx.feeUsd, at, tx.toWalletId ?? tx.fromWalletId);
    else if (type === "RECEIVE") addLot(tx.asset, tx.amount, tx.amount * tx.priceUsd, at, tx.toWalletId);
    else if (type === "STAKING" || type === "AIRDROP") {
      const income = tx.amount * tx.priceUsd;
      ordinaryIncome += income;
      addLot(tx.asset, tx.amount, income, at, tx.toWalletId ?? tx.fromWalletId);
    } else if (type === "SELL") dispose(tx.asset, tx.amount, tx.amount * tx.priceUsd - tx.feeUsd, at, tx.fromWalletId);
    else if (type === "TRADE") {
      dispose(tx.asset, tx.amount, tx.amount * tx.priceUsd - tx.feeUsd, at, tx.fromWalletId);
      if (tx.receivedAsset && tx.receivedAmount && tx.receivedPriceUsd != null) addLot(tx.receivedAsset, tx.receivedAmount, tx.receivedAmount * tx.receivedPriceUsd, at, tx.toWalletId);
    } else if ((type === "SEND" || type === "TRANSFER") && tx.classification === "TRANSFER") {
      move(tx.asset, tx.amount, tx.fromWalletId, tx.toWalletId, at);
    } else if (type === "SEND" || type === "TRANSFER") {
      dispose(tx.asset, tx.amount, tx.amount * tx.priceUsd - tx.feeUsd, at, tx.fromWalletId);
    }
  }
  const shortTerm = gains.filter((g) => g.term === "short").reduce((s, g) => s + g.gain, 0);
  const longTerm = gains.filter((g) => g.term === "long").reduce((s, g) => s + g.gain, 0);
  return { lots: lots.filter((l) => l.amount > 1e-10).map((l) => ({ ...l, amount: Number(l.amount.toFixed(10)), basis: money(l.basis), acquiredAt: new Date(l.acquiredAt).toISOString() })), gains, custody, summary: { shortTerm: money(shortTerm), longTerm: money(longTerm), total: money(shortTerm + longTerm), ordinaryIncome: money(ordinaryIncome) } };
}

function runSelfTest() {
  const start = new Date("2025-01-15T12:00:00Z");
  const synthetic = [
    { id: 1, userId: 0, type: "BUY", classification: "ACQUISITION", asset: "ETH", amount: 1, priceUsd: 3000, feeUsd: 0, receivedAsset: null, receivedAmount: null, receivedPriceUsd: null, fromWalletId: null, toWalletId: 1, externalId: null, note: null, occurredAt: start, createdAt: start },
    { id: 2, userId: 0, type: "TRANSFER", classification: "TRANSFER", asset: "ETH", amount: 1, priceUsd: 3200, feeUsd: 0, receivedAsset: null, receivedAmount: null, receivedPriceUsd: null, fromWalletId: 1, toWalletId: 2, externalId: null, note: null, occurredAt: new Date(start.getTime() + 86400000), createdAt: start },
    { id: 3, userId: 0, type: "TRANSFER", classification: "TRANSFER", asset: "ETH", amount: 1, priceUsd: 3400, feeUsd: 0, receivedAsset: null, receivedAmount: null, receivedPriceUsd: null, fromWalletId: 2, toWalletId: 3, externalId: null, note: null, occurredAt: new Date(start.getTime() + 172800000), createdAt: start },
  ] satisfies TxRow[];
  const result = computeTax(synthetic, "FIFO");
  const lot = result.lots[0];
  const passed = result.lots.length === 1 && lot?.asset === "ETH" && lot.amount === 1 && lot.basis === 3000 && lot.walletId === 3 && lot.acquiredAt.startsWith("2025-01-15") && result.gains.length === 0 && result.summary.total === 0;
  return { passed, detail: passed ? "1 ETH · $3,000 basis · original date preserved · 0 disposals" : "Transfer regression failed" };
}

const EXCHANGE_FETCHERS: Record<string, ExchangeFetcher> = {
  Coinbase: fetchCoinbaseTransactions,
  Kraken: fetchKrakenTransactions,
  Uphold: fetchUpholdTransactions,
};

/**
 * Classification for imported exchange activity — mirrors addTransaction so
 * computeTax treats imports exactly like manual entries: BUY/RECEIVE open
 * lots (ACQUISITION), SELL/SEND dispose (DISPOSAL), TRADE does both.
 */
function importedClassification(type: NormalizedTx["type"]): string {
  if (type === "BUY" || type === "RECEIVE") return "ACQUISITION";
  if (type === "TRADE") return "TRADE";
  return "DISPOSAL";
}

const authResponse = z.object({ token: z.string(), user: z.object({ email: z.string(), trialStartedAt: z.string() }) });
const okResponse = z.object({ ok: z.literal(true) });

// The affiliate/referral program is closed (owner ruling, Oct 30, 2026).
// There is deliberately no referralCode field here: zod strips unknown
// keys, so a referral code sent anyway is ignored and never stored.
const signupRequest = z.object({ email: z.string().email(), password: z.string().min(8) });
const loginRequest = z.object({ email: z.string().email(), password: z.string().min(1) });
const tokenRequest = z.object({ token: z.string() });
const changePasswordRequest = z.object({ token: z.string(), currentPassword: z.string().min(1), newPassword: z.string().min(8) });
const changePasswordResponse = z.object({ ok: z.literal(true), token: z.string() });
const addWalletRequest = z.object({ token: z.string(), name: z.string().min(1).max(60), chain: z.string().min(2).max(10), address: z.string().min(3).max(200), owned: z.boolean() });
const addExchangeConnectionRequest = z.object({ token: z.string(), provider: z.enum(["Coinbase", "Kraken", "Uphold"]), label: z.string().min(1).max(60), apiKey: z.string().min(4).max(500), apiSecret: z.string().max(20000) });
const exchangeConnectionIdRequest = z.object({ token: z.string(), connectionId: z.number().int().positive() });
const syncExchangeResponse = z.object({ ok: z.literal(true), imported: z.number(), skipped: z.number() });
const addTransactionRequest = z.object({ token: z.string(), type: z.enum(["BUY", "SELL", "TRADE", "SEND", "RECEIVE", "STAKING", "AIRDROP"]), asset: z.string().min(2).max(12), amount: z.number().positive(), priceUsd: z.number().nonnegative(), feeUsd: z.number().nonnegative(), receivedAsset: z.string().max(12).optional(), receivedAmount: z.number().positive().optional(), receivedPriceUsd: z.number().nonnegative().optional(), fromWalletId: z.number().int().positive().optional(), toWalletId: z.number().int().positive().optional(), note: z.string().max(200).optional(), occurredAt: z.string() });
const addTransactionResponse = z.object({ ok: z.literal(true), classification: z.string() });
const setCostBasisMethodRequest = z.object({ token: z.string(), method: z.enum(["FIFO", "LIFO", "HIFO"]) });
const saveAlertSettingsRequest = z.object({ token: z.string(), telegramToken: z.string().optional(), telegramChatId: z.string().max(64).optional(), phone: z.string().optional(), smsConsent: z.boolean().optional(), pushEnabled: z.boolean() });
const createPriceAlertRequest = z.object({ token: z.string(), asset: z.string().min(2).max(12), direction: z.enum(["above", "below"]), targetPrice: z.number().positive(), channels: z.array(z.enum(["Telegram", "SMS", "Push"])).min(1) });
const priceAlertIdRequest = z.object({ token: z.string(), alertId: z.number().int().positive() });
const setPriceAlertActiveRequest = z.object({ token: z.string(), alertId: z.number().int().positive(), active: z.boolean() });
const walletIdRequest = z.object({ token: z.string(), walletId: z.number().int().positive() });
const transactionIdRequest = z.object({ token: z.string(), transactionId: z.number().int().positive() });
const taxFormsRequest = z.object({ token: z.string(), taxYear: z.number().int().min(2000).max(2100).default(2026), taxpayerName: z.string().max(120).optional() });
const billingStatusResponse = z.object({ status: z.string(), trialEndsAt: z.string().nullable(), currentPeriodEnd: z.string().nullable(), signupTrialEndsAt: z.string(), entitled: z.boolean(), comped: z.boolean() });
const redirectResponse = z.object({ url: z.string() });

export const Actions = {
  signup: {
    request: signupRequest,
    response: authResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof signupRequest>): Promise<z.infer<typeof authResponse>> => {
      const db = ctx.db;
      const email = args.email.trim().toLowerCase();
      const existing = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
      if (existing[0]) throw new Error("An account already exists for that email.");
      const passwordHashValue = await passwordHash(args.password);
      // referral_code is NOT NULL with no DB default, so a value is still
      // generated to satisfy the constraint — but it is never returned,
      // displayed, or used: the referral program is closed and no
      // attribution or crediting happens at signup.
      const referralCode = `CBT${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
      const now = new Date();
      const inserted = await db.insert(schema.users).values({ email, passwordHash: passwordHashValue, referralCode, trialStartedAt: now, createdAt: now }).returning();
      const user = inserted[0];
      if (!user) throw new Error("Account could not be created.");
      const token = crypto.randomUUID();
      await db.insert(schema.sessions).values({ token, userId: user.id, createdAt: now });
      ctx.invalidateQueries();
      return { token, user: { email: user.email, trialStartedAt: user.trialStartedAt.toISOString() } };
    },
  },
  login: {
    request: loginRequest,
    response: authResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof loginRequest>): Promise<z.infer<typeof authResponse>> => {
      const db = ctx.db;
      const found = await db.select().from(schema.users).where(eq(schema.users.email, args.email.trim().toLowerCase())).limit(1);
      const user = found[0];
      if (!user || !(await passwordVerify(args.password, user.passwordHash))) throw new Error("Email or password is incorrect.");
      const token = crypto.randomUUID();
      await db.insert(schema.sessions).values({ token, userId: user.id, createdAt: new Date() });
      return { token, user: { email: user.email, trialStartedAt: user.trialStartedAt.toISOString() } };
    },
  },
  logout: {
    request: tokenRequest,
    response: okResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof tokenRequest>): Promise<z.infer<typeof okResponse>> => {
      await ctx.db.delete(schema.sessions).where(eq(schema.sessions.token, args.token));
      return { ok: true };
    },
  },
  getAppData: {
    request: tokenRequest,
    response: z.any(),
    handler: async (ctx: Ctx, args: z.infer<typeof tokenRequest>) => {
      // Read access stays open for locked accounts; the entitlement verdict
      // (from reconciled Stripe state) rides along so the client can show
      // the locked state plainly instead of failing actions silently.
      const { user, entitlement } = await getEntitlement(ctx.db, await requireUser(ctx, args.token));
      const db = ctx.db;
      const [walletRows, txRows, exchanges, alerts, history, settings] = await Promise.all([
        db.select().from(schema.wallets).where(eq(schema.wallets.userId, user.id)).orderBy(asc(schema.wallets.id)),
        db.select().from(schema.transactions).where(eq(schema.transactions.userId, user.id)).orderBy(desc(schema.transactions.occurredAt)),
        db.select().from(schema.exchangeConnections).where(eq(schema.exchangeConnections.userId, user.id)).orderBy(desc(schema.exchangeConnections.id)),
        db.select().from(schema.priceAlerts).where(eq(schema.priceAlerts.userId, user.id)).orderBy(desc(schema.priceAlerts.id)),
        db.select().from(schema.alertHistory).where(eq(schema.alertHistory.userId, user.id)).orderBy(desc(schema.alertHistory.deliveredAt)),
        db.select().from(schema.alertSettings).where(eq(schema.alertSettings.userId, user.id)).limit(1),
      ]);
      const method = user.costBasisMethod as Method;
      const tax = computeTax(txRows, method);
      const balances = new Map<string, number>();
      const bump = (walletId: number | null, asset: string, amount: number) => { if (walletId == null) return; const key = `${walletId}:${asset.toUpperCase()}`; balances.set(key, (balances.get(key) ?? 0) + amount); };
      for (const tx of [...txRows].reverse()) {
        const type = tx.type.toUpperCase();
        if (["BUY", "RECEIVE", "STAKING", "AIRDROP"].includes(type)) bump(tx.toWalletId ?? tx.fromWalletId, tx.asset, tx.amount);
        else if (type === "SELL") bump(tx.fromWalletId, tx.asset, -tx.amount);
        else if (type === "TRADE") { bump(tx.fromWalletId, tx.asset, -tx.amount); if (tx.receivedAsset && tx.receivedAmount) bump(tx.toWalletId, tx.receivedAsset, tx.receivedAmount); }
        else if ((type === "SEND" || type === "TRANSFER") && tx.classification === "TRANSFER") { bump(tx.fromWalletId, tx.asset, -tx.amount); bump(tx.toWalletId, tx.asset, tx.amount); }
        else if (type === "SEND" || type === "TRANSFER") bump(tx.fromWalletId, tx.asset, -tx.amount);
      }
      const assetMap = new Map<string, { amount: number; value: number }>();
      for (const tx of txRows) {
        const key = tx.asset.toUpperCase(); const current = assetMap.get(key) ?? { amount: 0, value: 0 };
        if (["BUY", "RECEIVE", "STAKING", "AIRDROP"].includes(tx.type.toUpperCase())) current.amount += tx.amount;
        if (["SELL", "SEND"].includes(tx.type.toUpperCase()) && tx.classification !== "TRANSFER") current.amount -= tx.amount;
        if (tx.type.toUpperCase() === "TRADE") current.amount -= tx.amount;
        current.value = current.amount * tx.priceUsd; assetMap.set(key, current);
        if (tx.type.toUpperCase() === "TRADE" && tx.receivedAsset && tx.receivedAmount && tx.receivedPriceUsd != null) assetMap.set(tx.receivedAsset.toUpperCase(), { amount: tx.receivedAmount + (assetMap.get(tx.receivedAsset.toUpperCase())?.amount ?? 0), value: (tx.receivedAmount + (assetMap.get(tx.receivedAsset.toUpperCase())?.amount ?? 0)) * tx.receivedPriceUsd });
      }
      return {
        user: { email: user.email, trialStartedAt: user.trialStartedAt.toISOString(), costBasisMethod: method, subscriptionStatus: user.subscriptionStatus, entitlement: { entitled: entitlement.entitled, comped: entitlement.comped, reason: entitlement.reason, trialEndsAt: entitlement.trialEndsAt.toISOString(), trialDaysLeft: entitlement.trialDaysLeft } },
        wallets: walletRows.map((w) => ({ id: w.id, name: w.name, chain: w.chain, address: w.address, owned: w.owned, balances: [...balances.entries()].filter(([key]) => key.startsWith(`${w.id}:`)).map(([key, amount]) => ({ asset: key.split(":")[1] ?? "", amount: Number(amount.toFixed(10)) })) })),
        transactions: txRows.map((t) => ({ ...t, occurredAt: t.occurredAt.toISOString(), createdAt: t.createdAt.toISOString() })),
        exchanges: exchanges.map((e) => ({ id: e.id, provider: e.provider, label: e.label, keyHint: e.keyHint, status: e.status, lastSyncedAt: e.lastSyncedAt ? e.lastSyncedAt.toISOString() : null, syncError: e.syncError, createdAt: e.createdAt.toISOString() })),
        alerts: alerts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString(), lastTriggeredAt: a.lastTriggeredAt?.toISOString() ?? null, episodeStartedAt: a.episodeStartedAt?.toISOString() ?? null, channels: a.channels.split(",").filter(Boolean) })),
        alertHistory: history.map((h) => ({ ...h, deliveredAt: h.deliveredAt.toISOString() })),
        alertSettings: settings[0] ? { telegramHint: settings[0].telegramHint, telegramChatId: settings[0].telegramChatId, phoneHint: settings[0].phoneHint, pushEnabled: settings[0].pushEnabled, smsEnabled: smsAlertsEnabled(), phoneSaved: Boolean(settings[0].phoneNumberEnc), smsConsentAt: settings[0].smsConsentAt?.toISOString() ?? null, smsOptedOut: settings[0].smsOptedOut } : { telegramHint: null, telegramChatId: null, phoneHint: null, pushEnabled: false, smsEnabled: smsAlertsEnabled(), phoneSaved: false, smsConsentAt: null, smsOptedOut: false },
        portfolio: { assets: [...assetMap.entries()].filter(([, v]) => Math.abs(v.amount) > 1e-10).map(([asset, v]) => ({ asset, amount: Number(v.amount.toFixed(10)), value: money(v.value) })), totalValue: money([...assetMap.values()].reduce((s, v) => s + v.value, 0)) },
        tax, selfTest: runSelfTest(),
      };
    },
  },
  addWallet: {
    request: addWalletRequest,
    response: okResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof addWalletRequest>): Promise<z.infer<typeof okResponse>> => {
      const user = await requireEntitledUser(ctx, args.token);
      await ctx.db.insert(schema.wallets).values({ userId: user.id, name: args.name.trim(), chain: args.chain.toUpperCase(), address: args.address.trim(), owned: args.owned });
      ctx.invalidateQueries();
      return { ok: true };
    },
  },
  deleteWallet: {
    request: walletIdRequest,
    response: okResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof walletIdRequest>): Promise<z.infer<typeof okResponse>> => {
      const user = await requireEntitledUser(ctx, args.token);
      await ctx.db.delete(schema.wallets)
        .where(and(eq(schema.wallets.id, args.walletId), eq(schema.wallets.userId, user.id)));
      ctx.invalidateQueries();
      return { ok: true };
    },
  },
  addExchangeConnection: {
    request: addExchangeConnectionRequest,
    response: okResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof addExchangeConnectionRequest>): Promise<z.infer<typeof okResponse>> => {
      const user = await requireEntitledUser(ctx, args.token);
      const hint = `••••${args.apiKey.slice(-4)}`;
      // Credentials are encrypted at rest (AES-256-GCM, EXCHANGE_ENC_KEY);
      // only the masked hint is ever shown in the UI.
      const apiKeyEnc = encryptSecret(args.apiKey);
      const apiSecretEnc = encryptSecret(args.apiSecret);
      await ctx.db.insert(schema.exchangeConnections).values({ userId: user.id, provider: args.provider, label: args.label.trim(), keyHint: hint, apiKeyEnc, apiSecretEnc, status: "configured" });
      ctx.invalidateQueries();
      return { ok: true };
    },
  },
  syncExchangeConnection: {
    request: exchangeConnectionIdRequest,
    response: syncExchangeResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof exchangeConnectionIdRequest>): Promise<z.infer<typeof syncExchangeResponse>> => {
      const user = await requireEntitledUser(ctx, args.token);
      const db = ctx.db;
      const rows = await db.select().from(schema.exchangeConnections)
        .where(and(eq(schema.exchangeConnections.id, args.connectionId), eq(schema.exchangeConnections.userId, user.id)))
        .limit(1);
      const connection = rows[0];
      if (!connection) throw new Error("Exchange connection not found.");
      const fetcher = EXCHANGE_FETCHERS[connection.provider];
      const fail = async (message: string): Promise<never> => {
        await db.update(schema.exchangeConnections)
          .set({ status: "error", syncError: message.slice(0, 300) })
          .where(eq(schema.exchangeConnections.id, connection.id));
        ctx.invalidateQueries();
        throw new Error(message);
      };
      if (!fetcher) return fail(`Sync isn't available for ${connection.provider}.`);
      if (!connection.apiKeyEnc || !connection.apiSecretEnc) {
        return fail("This connection has no stored credentials. Delete it and add it again so the keys can be encrypted and saved.");
      }
      let imported = 0;
      let skipped = 0;
      try {
        const apiKey = decryptSecret(connection.apiKeyEnc);
        const apiSecret = decryptSecret(connection.apiSecretEnc);
        const fetched = await fetcher(apiKey, apiSecret);
        const existing = await db.select({ externalId: schema.transactions.externalId })
          .from(schema.transactions)
          .where(eq(schema.transactions.userId, user.id));
        const seen = new Set(existing.map((r) => r.externalId).filter((v): v is string => Boolean(v)));
        for (const tx of fetched) {
          // Namespace per provider so identical ids from two exchanges
          // never collide.
          const externalId = `${connection.provider.toLowerCase()}:${tx.externalId}`;
          if (seen.has(externalId)) { skipped++; continue; }
          seen.add(externalId);
          await db.insert(schema.transactions).values({
            userId: user.id,
            type: tx.type,
            classification: importedClassification(tx.type),
            asset: tx.asset.toUpperCase(),
            amount: tx.amount,
            priceUsd: tx.priceUsd,
            feeUsd: tx.feeUsd,
            receivedAsset: tx.receivedAsset?.toUpperCase() ?? null,
            receivedAmount: tx.receivedAmount ?? null,
            receivedPriceUsd: tx.receivedPriceUsd ?? null,
            externalId,
            note: `Imported from ${connection.provider}`,
            occurredAt: tx.occurredAt,
          });
          imported++;
        }
      } catch (err) {
        return fail(err instanceof Error ? err.message : "Exchange sync failed.");
      }
      await db.update(schema.exchangeConnections)
        .set({ lastSyncedAt: new Date(), status: "synced", syncError: null })
        .where(eq(schema.exchangeConnections.id, connection.id));
      ctx.invalidateQueries();
      return { ok: true as const, imported, skipped };
    },
  },
  deleteExchangeConnection: {
    request: exchangeConnectionIdRequest,
    response: okResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof exchangeConnectionIdRequest>): Promise<z.infer<typeof okResponse>> => {
      const user = await requireEntitledUser(ctx, args.token);
      await ctx.db.delete(schema.exchangeConnections)
        .where(and(eq(schema.exchangeConnections.id, args.connectionId), eq(schema.exchangeConnections.userId, user.id)));
      ctx.invalidateQueries();
      return { ok: true };
    },
  },
  addTransaction: {
    request: addTransactionRequest,
    response: addTransactionResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof addTransactionRequest>) => {
      const user = await requireEntitledUser(ctx, args.token);
      const db = ctx.db;
      const walletRows = await db.select().from(schema.wallets).where(eq(schema.wallets.userId, user.id));
      const from = walletRows.find((w) => w.id === args.fromWalletId);
      const to = walletRows.find((w) => w.id === args.toWalletId);
      let classification = ["BUY", "RECEIVE", "STAKING", "AIRDROP"].includes(args.type) ? "ACQUISITION" : "DISPOSAL";
      let storedType: string = args.type;
      if (args.type === "SEND" && from?.owned && to?.owned) { classification = "TRANSFER"; storedType = "TRANSFER"; }
      if (args.type === "TRADE") classification = "TRADE";
      const occurredAt = new Date(args.occurredAt);
      if (Number.isNaN(occurredAt.getTime())) throw new Error("Enter a valid transaction date.");
      await db.insert(schema.transactions).values({ userId: user.id, type: storedType, classification, asset: args.asset.toUpperCase(), amount: args.amount, priceUsd: args.priceUsd, feeUsd: args.feeUsd, receivedAsset: args.receivedAsset?.toUpperCase() || null, receivedAmount: args.receivedAmount ?? null, receivedPriceUsd: args.receivedPriceUsd ?? null, fromWalletId: args.fromWalletId ?? null, toWalletId: args.toWalletId ?? null, note: args.note?.trim() || null, occurredAt });
      ctx.invalidateQueries();
      return { ok: true as const, classification };
    },
  },
  deleteTransaction: {
    request: transactionIdRequest,
    response: okResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof transactionIdRequest>): Promise<z.infer<typeof okResponse>> => {
      const user = await requireEntitledUser(ctx, args.token);
      await ctx.db.delete(schema.transactions)
        .where(and(eq(schema.transactions.id, args.transactionId), eq(schema.transactions.userId, user.id)));
      ctx.invalidateQueries();
      return { ok: true };
    },
  },
  setCostBasisMethod: {
    request: setCostBasisMethodRequest,
    response: okResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof setCostBasisMethodRequest>): Promise<z.infer<typeof okResponse>> => {
      const user = await requireEntitledUser(ctx, args.token);
      await ctx.db.update(schema.users).set({ costBasisMethod: args.method }).where(eq(schema.users.id, user.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  },
  saveAlertSettings: {
    request: saveAlertSettingsRequest,
    response: okResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof saveAlertSettingsRequest>): Promise<z.infer<typeof okResponse>> => {
      const user = await requireEntitledUser(ctx, args.token);
      const db = ctx.db;
      const existing = await db.select().from(schema.alertSettings).where(eq(schema.alertSettings.userId, user.id)).limit(1);
      const telegramHint = args.telegramToken ? `••••${args.telegramToken.slice(-4)}` : existing[0]?.telegramHint ?? null;
      const telegramChatId = args.telegramChatId?.trim() ? args.telegramChatId.trim() : existing[0]?.telegramChatId ?? null;
      const phoneHint = args.phone ? `••••${args.phone.replace(/\D/g, "").slice(-4)}` : existing[0]?.phoneHint ?? null;
      // SMS columns (migration 0009): carried through untouched unless the
      // SMS flag is on AND a phone number is being saved — then the number
      // is validated, normalized to E.164, and stored encrypted, and an
      // explicit consent tick is required (it stamps the TCPA opt-in
      // record and clears any earlier STOP opt-out). With the flag off this
      // keeps the historical hint-only behavior exactly.
      let phoneNumberEnc = existing[0]?.phoneNumberEnc ?? null;
      let smsConsentAt = existing[0]?.smsConsentAt ?? null;
      let smsOptedOut = existing[0]?.smsOptedOut ?? false;
      let smsOptedOutAt = existing[0]?.smsOptedOutAt ?? null;
      if (args.phone && smsAlertsEnabled()) {
        const normalized = normalizePhoneNumber(args.phone);
        if (!normalized) throw new Error("That phone number doesn't look valid — enter it like +1 555 555 5555.");
        if (!args.smsConsent) throw new Error("Please tick the SMS consent box so we can save your number for text alerts.");
        phoneNumberEnc = encryptSecret(normalized);
        smsConsentAt = new Date();
        smsOptedOut = false;
        smsOptedOutAt = null;
      }
      if (existing[0]) await db.update(schema.alertSettings).set({ telegramHint, telegramChatId, phoneHint, phoneNumberEnc, smsConsentAt, smsOptedOut, smsOptedOutAt, pushEnabled: args.pushEnabled, updatedAt: new Date() }).where(eq(schema.alertSettings.userId, user.id));
      else await db.insert(schema.alertSettings).values({ userId: user.id, telegramHint, telegramChatId, phoneHint, phoneNumberEnc, smsConsentAt, smsOptedOut, smsOptedOutAt, pushEnabled: args.pushEnabled, updatedAt: new Date() });
      ctx.invalidateQueries();
      return { ok: true };
    },
  },
  createPriceAlert: {
    request: createPriceAlertRequest,
    response: okResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof createPriceAlertRequest>): Promise<z.infer<typeof okResponse>> => {
      const user = await requireEntitledUser(ctx, args.token);
      await ctx.db.insert(schema.priceAlerts).values({ userId: user.id, asset: args.asset.toUpperCase(), direction: args.direction, targetPrice: args.targetPrice, channels: args.channels.join(","), active: true });
      ctx.invalidateQueries();
      return { ok: true };
    },
  },
  deletePriceAlert: {
    request: priceAlertIdRequest,
    response: okResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof priceAlertIdRequest>): Promise<z.infer<typeof okResponse>> => {
      const user = await requireEntitledUser(ctx, args.token);
      await ctx.db.delete(schema.priceAlerts)
        .where(and(eq(schema.priceAlerts.id, args.alertId), eq(schema.priceAlerts.userId, user.id)));
      ctx.invalidateQueries();
      return { ok: true };
    },
  },
  setPriceAlertActive: {
    request: setPriceAlertActiveRequest,
    response: okResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof setPriceAlertActiveRequest>): Promise<z.infer<typeof okResponse>> => {
      const user = await requireEntitledUser(ctx, args.token);
      // Pausing also clears the episode state, so a resumed alert starts a
      // fresh episode instead of picking up mid-reminder-loop.
      await ctx.db.update(schema.priceAlerts)
        .set(args.active
          ? { active: true }
          : { active: false, episodeStartedAt: null, lastTriggeredAt: null, lastNotifiedPrice: null })
        .where(and(eq(schema.priceAlerts.id, args.alertId), eq(schema.priceAlerts.userId, user.id)));
      ctx.invalidateQueries();
      return { ok: true };
    },
  },
  /**
   * Server-side tax documents, powered by the canonical Tax Engine v2
   * (./taxEngine.ts — TypeScript port of the rebuild's tax-engine.js).
   *
   * The app's primary tax view (`getAppData` → `computeTax`) already handles
   * FIFO/LIFO/HIFO with transfer-aware lots; this action adds what the
   * original server lacked: server-generated Form 8949 and Schedule D
   * structures, plus per-lot disposal lines, income events, and custody
   * transfers from the v2 engine.
   */
  getTaxForms: {
    request: taxFormsRequest,
    response: z.any(),
    handler: async (ctx: Ctx, args: z.infer<typeof taxFormsRequest>) => {
      const user = await requireUser(ctx, args.token);
      const db = ctx.db;
      const [walletRows, txRows] = await Promise.all([
        db.select().from(schema.wallets).where(eq(schema.wallets.userId, user.id)),
        db.select().from(schema.transactions).where(eq(schema.transactions.userId, user.id)).orderBy(asc(schema.transactions.occurredAt)),
      ]);
      const owned = new Set(walletRows.filter((w) => w.owned).map((w) => w.id));
      const txs: EngineTransaction[] = txRows.map((t) => {
        const base = {
          id: t.id,
          date: t.occurredAt.toISOString(),
          asset: t.asset.toUpperCase(),
          amount: t.amount,
          priceUsd: t.priceUsd,
          feeUsd: t.feeUsd,
          note: t.note ?? undefined,
        };
        switch (t.type.toUpperCase()) {
          case "BUY": return { ...base, type: "buy" as const, walletId: t.toWalletId ?? t.fromWalletId ?? undefined };
          case "RECEIVE": return { ...base, type: "receive" as const, walletId: t.toWalletId ?? t.fromWalletId ?? undefined };
          case "STAKING": return { ...base, type: "staking" as const, walletId: t.toWalletId ?? t.fromWalletId ?? undefined };
          case "AIRDROP": return { ...base, type: "airdrop" as const, walletId: t.toWalletId ?? t.fromWalletId ?? undefined };
          case "SELL": return { ...base, type: "sell" as const, walletId: t.fromWalletId ?? undefined };
          case "TRADE": return { ...base, type: "trade" as const, walletId: t.fromWalletId ?? undefined, receivedAsset: t.receivedAsset ?? undefined, receivedAmount: t.receivedAmount ?? undefined, receivedPriceUsd: t.receivedPriceUsd ?? undefined };
          case "TRANSFER": return { ...base, type: "transfer" as const, walletId: t.fromWalletId ?? undefined, toWalletId: t.toWalletId ?? undefined };
          default: {
            // SEND. The v2 engine throws on sends from non-owned wallets, so
            // those map to plain disposals (same treatment as computeTax).
            const fromOwned = t.fromWalletId != null && owned.has(t.fromWalletId);
            return fromOwned
              ? { ...base, type: "send" as const, walletId: t.fromWalletId ?? undefined, toWalletId: t.toWalletId ?? undefined }
              : { ...base, type: "sell" as const, walletId: t.fromWalletId ?? undefined };
          }
        }
      });
      const method = user.costBasisMethod as CostBasisMethod;
      let result;
      try {
        result = processTransactions(txs, [...owned], method);
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : "Tax engine failed.");
      }
      const form8949 = build8949(result.disposals, args.taxpayerName ?? user.email, args.taxYear);
      return {
        taxYear: args.taxYear,
        method,
        totals: { shortTerm: result.shortGain, longTerm: result.longGain, net: result.totalGainLoss, ordinaryIncome: result.totalIncome },
        openLots: result.lots,
        disposals: result.disposals,
        incomeEvents: result.incomeEvents,
        transfers: result.transfers,
        form8949,
        scheduleD: buildScheduleD(form8949),
      };
    },
  },
  /**
   * Start a Stripe Checkout subscription with a 7-day trial (no charge until
   * day 8, matching the "no card required to start the trial" product copy —
   * the card is collected here, the first charge lands after the trial).
   * Creates and stores a Stripe customer on first use.
   */
  createCheckoutSession: {
    request: tokenRequest,
    response: redirectResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof tokenRequest>): Promise<z.infer<typeof redirectResponse>> => {
      const user = await requireUser(ctx, args.token);
      const stripe = getStripe();
      const priceId = process.env.STRIPE_PRICE_ID;
      if (!priceId) throw new Error("Billing is not configured yet.");
      if (["trialing", "active", "past_due"].includes(user.subscriptionStatus) && user.stripeCustomerId) {
        throw new Error("You already have a subscription — use Manage billing to update it.");
      }
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { userId: String(user.id) },
        });
        customerId = customer.id;
        await ctx.db.update(schema.users).set({ stripeCustomerId: customerId }).where(eq(schema.users.id, user.id));
      }
      const url = baseUrl(ctx.origin);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: String(user.id),
        // Lets customers enter a promotion code at checkout (e.g. the
        // owner's Black Friday code). The coupon/promotion code itself
        // lives in Stripe — nothing is discounted unless she creates it.
        allow_promotion_codes: true,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: { trial_period_days: 7 },
        success_url: `${url}/?billing=success`,
        cancel_url: `${url}/?billing=cancelled`,
      });
      if (!session.url) throw new Error("Could not start checkout. Try again.");
      return { url: session.url };
    },
  },
  /**
   * Stripe Customer Portal session so subscribers can update their card or
   * cancel without us handling payment details.
   */
  createPortalSession: {
    request: tokenRequest,
    response: redirectResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof tokenRequest>): Promise<z.infer<typeof redirectResponse>> => {
      const user = await requireUser(ctx, args.token);
      const stripe = getStripe();
      if (!user.stripeCustomerId) throw new Error("No billing account yet — subscribe first.");
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: baseUrl(ctx.origin),
      });
      return { url: session.url };
    },
  },
  /** Current subscription state for the signed-in user. */
  getBillingStatus: {
    request: tokenRequest,
    response: billingStatusResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof tokenRequest>): Promise<z.infer<typeof billingStatusResponse>> => {
      let user = await requireUser(ctx, args.token);
      // Self-heal: reconcile the local row from Stripe's actual state
      // (throttled) so a completed checkout stranded by a lost webhook
      // delivery is repaired on this read; re-read the row when the
      // reconcile changed anything.
      const changed = await reconcileSubscriptionFromStripe(ctx.db, user);
      if (changed) {
        user = await requireUser(ctx, args.token);
      }
      const status = user.subscriptionStatus || "none";
      const periodEnd = user.currentPeriodEnd ? user.currentPeriodEnd.toISOString() : null;
      // Entitlement is computed from the just-reconciled row so the Billing
      // page can say plainly whether the account is in its free trial, paid
      // up, comped, or locked with a fee owed.
      const entitlement = computeEntitlement(user);
      return {
        status,
        // During a trial, Stripe sets current_period_end to the trial's end.
        trialEndsAt: status === "trialing" ? periodEnd : null,
        currentPeriodEnd: periodEnd,
        signupTrialEndsAt: entitlement.trialEndsAt.toISOString(),
        entitled: entitlement.entitled,
        comped: entitlement.comped,
      };
    },
  },
  /**
   * Change the account password. Verifies the current password first, then
   * replaces the hash and invalidates EVERY session for the user — including
   * the current one — so a compromised password can't keep other devices
   * signed in. A fresh token is returned so this device stays signed in
   * seamlessly; the client should swap it into storage.
   */
  changePassword: {
    request: changePasswordRequest,
    response: changePasswordResponse,
    handler: async (ctx: Ctx, args: z.infer<typeof changePasswordRequest>): Promise<z.infer<typeof changePasswordResponse>> => {
      const db = ctx.db;
      const user = await requireUser(ctx, args.token);
      if (!(await passwordVerify(args.currentPassword, user.passwordHash))) {
        throw new Error("Current password is incorrect.");
      }
      const passwordHashValue = await passwordHash(args.newPassword);
      await db.update(schema.users).set({ passwordHash: passwordHashValue }).where(eq(schema.users.id, user.id));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
      const token = crypto.randomUUID();
      await db.insert(schema.sessions).values({ token, userId: user.id, createdAt: new Date() });
      ctx.invalidateQueries();
      return { ok: true, token };
    },
  },
};
