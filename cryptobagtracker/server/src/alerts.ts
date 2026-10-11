// Price-alert delivery worker.
//
//   - CoinGecko free API (no key) for spot prices, cached 60s, graceful
//     backoff on 429s.
//   - Pure crossing/cooldown logic (shouldTrigger / isDue / evaluateAlerts)
//     so it can be unit-tested without network or DB.
//   - Telegram delivery via the app-level TELEGRAM_BOT_TOKEN and each user's
//     telegram_chat_id (from alert_settings).
//   - Generic outbound webhook: if ALERT_WEBHOOK_URL is set, every trigger
//     POSTs a JSON payload there (e.g. a Zapier "Catch Hook") fire-and-forget.
//
// checkPriceAlerts() is called on an interval from server.ts. It never throws
// for per-alert problems: undeliverable alerts are recorded in alert_history.
import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

type Db = NodePgDatabase<typeof schema>;
type AlertRow = typeof schema.priceAlerts.$inferSelect;
export type Direction = "above" | "below";

// ---------------------------------------------------------------------------
// Price feed (CoinGecko, no key)
// ---------------------------------------------------------------------------

const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  XLM: "stellar",
  ADA: "cardano",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  POL: "polygon-ecosystem-token",
  BNB: "binancecoin",
  BSC: "binancecoin",
  ARB: "arbitrum",
  OP: "optimism",
  LTC: "litecoin",
  DOGE: "dogecoin",
  LINK: "chainlink",
  UNI: "uniswap",
  ATOM: "cosmos",
  NEAR: "near",
  APT: "aptos",
  HBAR: "hedera-hashgraph",
  VET: "vechain",
  ALGO: "algorand",
  FIL: "filecoin",
  RNDR: "render-token",
  SHIB: "shiba-inu",
  PEPE: "pepe",
  TURBO: "turbo",
};

const PRICE_CACHE_TTL_MS = 60_000;
const priceCache = new Map<string, { price: number; fetchedAt: number }>();
let coingeckoBackoffUntil = 0;
const warnedSymbols = new Set<string>();

export function coingeckoIdFor(symbol: string): string | null {
  return COINGECKO_IDS[symbol.toUpperCase()] ?? null;
}

async function fetchJson(url: string, timeoutMs: number): Promise<{ status: number; json: unknown; retryAfterMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "CryptoBagTracker/1.0 (+price-alerts)", accept: "application/json" },
    });
    const retryAfterMs = Number(res.headers.get("retry-after")) * 1000 || 0;
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // non-JSON body: treat as failure below
    }
    return { status: res.status, json, retryAfterMs };
  } finally {
    clearTimeout(timer);
  }
}

/** Current USD price per symbol (upper-cased). Only fetches what is needed. */
export async function fetchPrices(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const now = Date.now();
  const idsNeeded = new Map<string, string>(); // coingecko id -> symbol
  for (const symbol of symbols) {
    const upper = symbol.toUpperCase();
    const cached = priceCache.get(upper);
    if (cached && now - cached.fetchedAt < PRICE_CACHE_TTL_MS) {
      out.set(upper, cached.price);
      continue;
    }
    const id = coingeckoIdFor(upper);
    if (!id) {
      if (!warnedSymbols.has(upper)) {
        warnedSymbols.add(upper);
        console.warn(`price alerts: no CoinGecko mapping for symbol ${upper}; its alerts will be skipped until one is added.`);
      }
      continue;
    }
    idsNeeded.set(id, upper);
  }
  if (!idsNeeded.size) return out;
  if (now < coingeckoBackoffUntil) {
    console.warn("price alerts: CoinGecko backoff active; serving cached prices only.");
    return out;
  }
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${[...idsNeeded.keys()].join(",")}&vs_currencies=usd`;
  try {
    const { status, json, retryAfterMs } = await fetchJson(url, 10_000);
    if (status === 429) {
      coingeckoBackoffUntil = now + (retryAfterMs > 0 ? retryAfterMs : 60_000);
      console.warn(`price alerts: CoinGecko rate-limited (429); backing off for ${Math.round((coingeckoBackoffUntil - now) / 1000)}s.`);
      return out;
    }
    if (status !== 200 || typeof json !== "object" || json === null) {
      console.warn(`price alerts: CoinGecko request failed (status ${status}); serving cached prices only.`);
      return out;
    }
    for (const [id, symbol] of idsNeeded) {
      const entry = (json as Record<string, { usd?: unknown }>)[id];
      const price = entry && typeof entry.usd === "number" ? entry.usd : null;
      if (price != null && Number.isFinite(price)) {
        priceCache.set(symbol, { price, fetchedAt: now });
        out.set(symbol, price);
      }
    }
  } catch (err) {
    console.warn("price alerts: CoinGecko request errored:", err instanceof Error ? err.message : err);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Crossing / cooldown logic (pure, unit-testable)
// ---------------------------------------------------------------------------

export function shouldTrigger(direction: Direction, price: number, target: number): boolean {
  return direction === "above" ? price >= target : price <= target;
}

export function isDue(lastTriggeredAt: Date | null, nowMs: number, cooldownMs: number): boolean {
  if (!lastTriggeredAt) return true;
  return nowMs - lastTriggeredAt.getTime() >= cooldownMs;
}

export interface TriggeredAlert {
  alert: AlertRow;
  price: number;
}

/** Alerts that are crossed right now and past their cooldown. Pure. */
export function evaluateAlerts(
  alerts: AlertRow[],
  prices: Map<string, number>,
  nowMs: number,
  cooldownMs: number,
): TriggeredAlert[] {
  const out: TriggeredAlert[] = [];
  for (const alert of alerts) {
    const price = prices.get(alert.asset.toUpperCase());
    if (price == null) continue; // no price available; leave active, retry next tick
    if (!shouldTrigger(alert.direction as Direction, price, alert.targetPrice)) continue;
    if (!isDue(alert.lastTriggeredAt, nowMs, cooldownMs)) continue;
    out.push({ alert, price });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export function telegramBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const token = telegramBotToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Telegram sendMessage failed (${res.status}): ${body.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export interface AlertWebhookPayload {
  userId: number;
  alertId: number;
  asset: string;
  direction: string;
  targetPrice: number;
  currentPrice: number;
  triggeredAt: string;
}

export async function postAlertWebhook(payload: AlertWebhookPayload): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`webhook responded ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget: never throws, never blocks the scheduler. */
export function fireAlertWebhook(payload: AlertWebhookPayload): void {
  postAlertWebhook(payload).catch((err) =>
    console.warn("price alerts: outbound webhook failed:", err instanceof Error ? err.message : err),
  );
}

function fmtUsd(n: number): string {
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toPrecision(4);
}

export function alertCooldownMs(): number {
  const v = Number(process.env.ALERT_COOLDOWN_MS);
  return Number.isFinite(v) && v > 0 ? v : 24 * 60 * 60 * 1000;
}

export interface AlertCheckDeps {
  fetchPrices?: (symbols: string[]) => Promise<Map<string, number>>;
  sendTelegram?: (chatId: string, text: string) => Promise<void>;
}

/** One scheduler tick: check every active alert, deliver, record, re-arm. */
export async function checkPriceAlerts(db: Db, deps: AlertCheckDeps = {}): Promise<{ checked: number; triggered: number }> {
  const alerts = await db.select().from(schema.priceAlerts).where(eq(schema.priceAlerts.active, true));
  if (!alerts.length) return { checked: 0, triggered: 0 };

  const symbols = [...new Set(alerts.map((a) => a.asset.toUpperCase()))];
  const prices = deps.fetchPrices ? await deps.fetchPrices(symbols) : await fetchPrices(symbols);
  const now = Date.now();
  const due = evaluateAlerts(alerts, prices, now, alertCooldownMs());

  const userIds = [...new Set(due.map((d) => d.alert.userId))];
  const settingsRows = userIds.length
    ? await db.select().from(schema.alertSettings).where(inArray(schema.alertSettings.userId, userIds))
    : [];
  const settingsByUser = new Map(settingsRows.map((s) => [s.userId, s]));
  const send = deps.sendTelegram ?? sendTelegramMessage;

  let triggered = 0;
  for (const { alert, price } of due) {
    triggered++;
    const verb = alert.direction === "above" ? "rose above" : "fell below";
    const message = `🔔 ${alert.asset} ${verb} $${fmtUsd(alert.targetPrice)} — now $${fmtUsd(price)}`;
    const settings = settingsByUser.get(alert.userId);
    const channels = alert.channels.split(",").map((c) => c.trim());
    const delivered: string[] = [];
    const skipped: string[] = [];

    if (channels.includes("Telegram")) {
      const chatId = settings?.telegramChatId?.trim();
      if (chatId && telegramBotToken()) {
        try {
          await send(chatId, message);
          delivered.push("Telegram");
        } catch (err) {
          skipped.push("Telegram (send failed)");
          console.warn(`price alerts: Telegram send failed for alert ${alert.id}:`, err instanceof Error ? err.message : err);
        }
      } else {
        const reason = !telegramBotToken() ? "TELEGRAM_BOT_TOKEN missing" : "no Telegram chat id saved";
        skipped.push(`Telegram (${reason})`);
        console.warn(`price alerts: alert ${alert.id} wants Telegram but ${reason}.`);
      }
    }
    for (const c of channels) {
      if (c !== "Telegram") skipped.push(`${c} (not implemented)`);
    }

    const historyMessage =
      delivered.length === 0
        ? `${message} — undelivered: ${skipped.join(", ") || "no channels"}`
        : `${message} — via ${delivered.join(", ")}${skipped.length ? `; skipped: ${skipped.join(", ")}` : ""}`;
    try {
      await db.insert(schema.alertHistory).values({
        userId: alert.userId,
        alertId: alert.id,
        message: historyMessage,
        deliveredAt: new Date(now),
      });
      await db.update(schema.priceAlerts).set({ lastTriggeredAt: new Date(now) }).where(eq(schema.priceAlerts.id, alert.id));
    } catch (err) {
      console.error(`price alerts: failed to record trigger for alert ${alert.id}:`, err instanceof Error ? err.message : err);
    }

    fireAlertWebhook({
      userId: alert.userId,
      alertId: alert.id,
      asset: alert.asset,
      direction: alert.direction,
      targetPrice: alert.targetPrice,
      currentPrice: price,
      triggeredAt: new Date(now).toISOString(),
    });
  }
  return { checked: alerts.length, triggered };
}
