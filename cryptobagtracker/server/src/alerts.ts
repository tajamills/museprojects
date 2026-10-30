// Price-alert delivery worker.
//
//   - CoinGecko free API (no key) for spot prices, cached 30s, graceful
//     backoff on 429s. Prices are fetched in ONE batched call per tick for
//     every symbol any active alert needs, so a faster tick rate does not
//     multiply API load.
//   - Pure episode logic (shouldTrigger / evaluateAlerts) so it can be
//     unit-tested without network or DB. An alert fires the moment price
//     crosses its target, then keeps re-notifying while price stays in the
//     trigger zone: at once on a further >=1% move past the last notified
//     price, otherwise every 15 minutes, for up to 24 hours per episode.
//     The episode closes (the alert re-arms) once price leaves the zone by
//     a 0.25% hysteresis band, so a fresh crossing fires immediately.
//   - Telegram delivery via the app-level TELEGRAM_BOT_TOKEN and each user's
//     telegram_chat_id (from alert_settings).
//   - SMS delivery (phase 1, Oct 2026) via Twilio to the alert owner's own
//     stored number — only when SMS_ALERTS_ENABLED=true; see sms.ts and
//     ~/workspace/audits/cbt-real-sms-spec-oct27.md. With the flag off, SMS
//     channels are recorded as "SMS (not enabled)" and nothing is sent.
//   - Generic outbound webhook: if ALERT_WEBHOOK_URL is set, every trigger
//     POSTs a JSON payload there (e.g. a Zapier "Catch Hook") fire-and-forget.
//   - Entitlement: alerts for accounts that are not entitled (free trial
//     ended, no subscription — see entitlement.ts) are recorded as
//     undelivered with the reason and produce NO Telegram / SMS / webhook
//     traffic at all.
//
// checkPriceAlerts() is called on an interval from server.ts. It never throws
// for per-alert problems: undeliverable alerts are recorded in alert_history.
import { and, eq, gte, inArray, lt, lte, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { decryptSecret } from "./crypto.js";
import { getEntitlement, type Entitlement } from "./entitlement.js";
import * as schema from "./schema.js";
import { sendSmsMessage, smsAlertsEnabled, smsMonthlyCap, twilioConfig, type SmsSendResult } from "./sms.js";

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

const PRICE_CACHE_TTL_MS = 30_000;
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
// Crossing / episode logic (pure, unit-testable)
// ---------------------------------------------------------------------------

export function shouldTrigger(direction: Direction, price: number, target: number): boolean {
  return direction === "above" ? price >= target : price <= target;
}

export function isDue(lastTriggeredAt: Date | null, nowMs: number, cooldownMs: number): boolean {
  if (!lastTriggeredAt) return true;
  return nowMs - lastTriggeredAt.getTime() >= cooldownMs;
}

/** True once price has left the trigger zone by the hysteresis band. */
export function hasExitedZone(direction: Direction, price: number, target: number, hysteresisPct: number): boolean {
  const band = (hysteresisPct / 100) * target;
  return direction === "above" ? price < target - band : price > target + band;
}

/** True when price has run at least stepPct% further in the trigger direction since the last notification. */
export function hasSteppedBeyond(direction: Direction, price: number, baseline: number, stepPct: number): boolean {
  if (!(baseline > 0)) return false;
  const step = (stepPct / 100) * baseline;
  return direction === "above" ? price >= baseline + step : price <= baseline - step;
}

export interface AlertRepeatPolicy {
  /** While price stays in the zone, re-notify at most this often. */
  repeatMs: number;
  /** A further move of this percent past the last notified price re-fires at once. */
  stepPct: number;
  /** Stop repeating this long after the episode's first trigger. */
  capMs: number;
  /** Price must leave the zone by this percent before the alert re-arms. */
  hysteresisPct: number;
}

export const DEFAULT_ALERT_POLICY: AlertRepeatPolicy = {
  repeatMs: 15 * 60 * 1000,
  stepPct: 1,
  capMs: 24 * 60 * 60 * 1000,
  hysteresisPct: 0.25,
};

export function alertRepeatPolicy(env: NodeJS.ProcessEnv = process.env): AlertRepeatPolicy {
  const num = (raw: string | undefined, fallback: number) => {
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    repeatMs: num(env.ALERT_REPEAT_INTERVAL_MS, DEFAULT_ALERT_POLICY.repeatMs),
    stepPct: num(env.ALERT_STEP_PERCENT, DEFAULT_ALERT_POLICY.stepPct),
    capMs: num(env.ALERT_EPISODE_CAP_MS, DEFAULT_ALERT_POLICY.capMs),
    hysteresisPct: num(env.ALERT_HYSTERESIS_PERCENT, DEFAULT_ALERT_POLICY.hysteresisPct),
  };
}

export type TriggerKind = "cross" | "step" | "repeat";

export interface TriggeredAlert {
  alert: AlertRow;
  price: number;
  kind: TriggerKind;
}

export interface AlertEvaluation {
  triggers: TriggeredAlert[];
  /** Alerts whose episode closed this tick (price left the zone): re-arm them. */
  resets: AlertRow[];
}

/**
 * Evaluate every active alert against current prices. Pure.
 *
 * An "episode" runs from the first crossing until price leaves the zone
 * (past the hysteresis band). Inside an episode the alert re-fires on a
 * further step move or when the repeat interval elapses, until the cap.
 * Rows written before episodes existed (last_triggered_at set, episode
 * fields null) are treated as an episode that started at last_triggered_at
 * with the target price as the step baseline.
 */
export function evaluateAlerts(
  alerts: AlertRow[],
  prices: Map<string, number>,
  nowMs: number,
  policy: AlertRepeatPolicy = DEFAULT_ALERT_POLICY,
): AlertEvaluation {
  const triggers: TriggeredAlert[] = [];
  const resets: AlertRow[] = [];
  for (const alert of alerts) {
    const price = prices.get(alert.asset.toUpperCase());
    if (price == null) continue; // no price available; leave state untouched, retry next tick
    const direction = alert.direction as Direction;
    const episodeStart = alert.episodeStartedAt ?? alert.lastTriggeredAt;
    if (!shouldTrigger(direction, price, alert.targetPrice)) {
      if (episodeStart && hasExitedZone(direction, price, alert.targetPrice, policy.hysteresisPct)) {
        resets.push(alert);
      }
      continue;
    }
    if (!episodeStart) {
      triggers.push({ alert, price, kind: "cross" });
      continue;
    }
    if (nowMs - episodeStart.getTime() >= policy.capMs) continue; // episode spent; waits for exit + a fresh cross
    const baseline = alert.lastNotifiedPrice ?? alert.targetPrice;
    if (hasSteppedBeyond(direction, price, baseline, policy.stepPct)) {
      triggers.push({ alert, price, kind: "step" });
      continue;
    }
    if (isDue(alert.lastTriggeredAt, nowMs, policy.repeatMs)) {
      triggers.push({ alert, price, kind: "repeat" });
    }
  }
  return { triggers, resets };
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
  kind: TriggerKind;
  /**
   * Ready-made message text, named to match the field the live Zapier SMS
   * Zap ("Send SMS alerts from webhook") is mapped to. The older alert
   * engine already sends `messageShort`/`messageFull`; including them here
   * means an SMS built from either engine's payload renders in full
   * (learned Oct 20, 2026, when the old engine's percent-change payloads met
   * a template mapped to this payload's field names and every value came
   * out empty).
   */
  messageShort: string;
  messageFull: string;
  /**
   * Snake_case aliases of the two fields above. The live Zap's SMS step is
   * mapped to `message_short` (proven Oct 27, 2026 from Zapier's own error
   * detail: "Required field 'message' is missing" because the mapped key
   * `message_short` never arrived — the payload only sent `messageShort`).
   * Both spellings are sent so either mapping resolves; pure addition, no
   * existing field renamed or removed.
   */
  message_short: string;
  message_full: string;
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

/**
 * @deprecated The flat cooldown (ALERT_COOLDOWN_MS, default 24h) was
 * replaced by episode repeats — see alertRepeatPolicy(). Kept so existing
 * imports keep working; returns the episode cap.
 */
export function alertCooldownMs(): number {
  return alertRepeatPolicy().capMs;
}

export interface AlertCheckDeps {
  fetchPrices?: (symbols: string[]) => Promise<Map<string, number>>;
  sendTelegram?: (chatId: string, text: string) => Promise<void>;
  sendSms?: (to: string, text: string) => Promise<SmsSendResult>;
}

/** One scheduler tick: check every active alert, deliver, record, re-arm. */
export async function checkPriceAlerts(db: Db, deps: AlertCheckDeps = {}): Promise<{ checked: number; triggered: number; reset: number }> {
  // Kill switch for the planted Oct 27 SMS test alert (Layla, 2026-10-28:
  // "cut that shit off"). The test account's BTC-above-$1 alert has no API
  // off switch and re-fires on an episode loop; deactivate it on EVERY tick
  // (not just at boot) so it cannot fire again once this build is live.
  // Self-limiting match: only that throwaway account's BTC $1 alerts.
  try {
    const testUsers = await db.select({ id: schema.users.id }).from(schema.users)
      .where(eq(schema.users.email, "sms-fix-test-oct27@cryptobagtracker.io"));
    const testUserId = testUsers.length > 0 ? testUsers[0].id : -1;
    // Match the planted test alert three independent ways: by owner account +
    // shape, by its known row id (4), and — v4, after a "still above $1"
    // text landed with id 4 already inactive — by test-artifact shape on
    // ANY account: a BTC "above" alert at $1 or less created before
    // 2026-10-28T04:00:00Z can only be a planted test artifact.
    await db.update(schema.priceAlerts).set({ active: false })
      .where(and(
        eq(schema.priceAlerts.active, true),
        or(
          and(
            eq(schema.priceAlerts.userId, testUserId),
            eq(schema.priceAlerts.asset, "BTC"),
            eq(schema.priceAlerts.targetPrice, 1),
          ),
          eq(schema.priceAlerts.id, 4),
          and(
            eq(schema.priceAlerts.asset, "BTC"),
            eq(schema.priceAlerts.direction, "above"),
            lte(schema.priceAlerts.targetPrice, 1),
            lt(schema.priceAlerts.createdAt, new Date("2026-10-28T04:00:00Z")),
          ),
        ),
      ));
  } catch (err) {
    console.error("price alerts: test-alert kill switch failed:", err instanceof Error ? err.message : err);
  }

  const alerts = await db.select().from(schema.priceAlerts).where(eq(schema.priceAlerts.active, true));
  if (!alerts.length) return { checked: 0, triggered: 0, reset: 0 };

  const symbols = [...new Set(alerts.map((a) => a.asset.toUpperCase()))];
  const prices = deps.fetchPrices ? await deps.fetchPrices(symbols) : await fetchPrices(symbols);
  const now = Date.now();
  const { triggers: due, resets } = evaluateAlerts(alerts, prices, now, alertRepeatPolicy());

  // Re-arm alerts whose price left the zone, so the next crossing fires
  // fresh instead of waiting out a timer. Silent on purpose: no message.
  for (const alert of resets) {
    try {
      await db
        .update(schema.priceAlerts)
        .set({ lastTriggeredAt: null, episodeStartedAt: null, lastNotifiedPrice: null })
        .where(eq(schema.priceAlerts.id, alert.id));
    } catch (err) {
      console.error(`price alerts: failed to re-arm alert ${alert.id}:`, err instanceof Error ? err.message : err);
    }
  }

  const userIds = [...new Set(due.map((d) => d.alert.userId))];
  const settingsRows = userIds.length
    ? await db.select().from(schema.alertSettings).where(inArray(schema.alertSettings.userId, userIds))
    : [];
  const settingsByUser = new Map(settingsRows.map((s) => [s.userId, s]));

  // Entitlement gate: alerts belonging to accounts whose free trial ended
  // with no subscription do not fire and generate no Telegram / SMS /
  // webhook traffic. The verdict comes from Stripe-reconciled state
  // (entitlement.ts). A user row that can't be loaded is treated as not
  // entitled — no sends on an unknown account.
  const entitlementByUser = new Map<number, Entitlement>();
  if (userIds.length) {
    const dueUsers = await db.select().from(schema.users).where(inArray(schema.users.id, userIds));
    for (const row of dueUsers) {
      const { entitlement } = await getEntitlement(db, row);
      entitlementByUser.set(row.id, entitlement);
    }
  }
  const send = deps.sendTelegram ?? sendTelegramMessage;
  const sendSms =
    deps.sendSms ??
    ((to: string, text: string) => {
      const cfg = twilioConfig();
      if (!cfg) throw new Error("Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER).");
      return sendSmsMessage(to, text, cfg);
    });

  let triggered = 0;
  for (const { alert, price, kind } of due) {
    triggered++;
    const message =
      kind === "cross"
        ? `🔔 ${alert.asset} ${alert.direction === "above" ? "rose above" : "fell below"} $${fmtUsd(alert.targetPrice)} — now $${fmtUsd(price)}`
        : `🔔 ${alert.asset} ${alert.direction === "above" ? "still above" : "still below"} $${fmtUsd(alert.targetPrice)} — now $${fmtUsd(price)}`;
    const settings = settingsByUser.get(alert.userId);
    const channels = alert.channels.split(",").map((c) => c.trim());
    const delivered: string[] = [];
    const skipped: string[] = [];
    const entitled = entitlementByUser.get(alert.userId)?.entitled ?? false;
    if (!entitled) {
      // Not entitled: nothing is sent on any channel and the outbound
      // webhook stays silent. The trigger is still recorded below with
      // this reason, and the episode bookkeeping advances as usual, so
      // history shows the pause instead of a new line every tick.
      skipped.push("Subscription (free trial ended — alerts paused until you subscribe)");
    }

    if (entitled && channels.includes("Telegram")) {
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
    if (entitled && channels.includes("SMS")) {
      // Per-customer SMS (sms.ts). Every branch records the honest outcome:
      // a delivery, or the specific reason no text left the building. The
      // old blanket "SMS (not implemented)" is retired with this block.
      if (!smsAlertsEnabled()) {
        skipped.push("SMS (not enabled)");
      } else if (!settings?.phoneNumberEnc) {
        skipped.push("SMS (no phone number saved)");
      } else if (!settings.smsConsentAt) {
        skipped.push("SMS (no consent on file)");
      } else if (settings.smsOptedOut) {
        skipped.push("SMS (opted out)");
      } else if (!twilioConfig()) {
        skipped.push("SMS (provider not configured)");
      } else {
        const logSend = async (status: string, providerSid: string | null, error: string | null) => {
          try {
            await db.insert(schema.smsSends).values({ userId: alert.userId, alertId: alert.id, providerSid, status, error });
          } catch (err) {
            console.error(`price alerts: failed to log SMS send for alert ${alert.id}:`, err instanceof Error ? err.message : err);
          }
        };
        const cap = smsMonthlyCap();
        let sentThisMonth = 0;
        if (cap > 0) {
          const monthStart = new Date(now);
          monthStart.setUTCDate(1);
          monthStart.setUTCHours(0, 0, 0, 0);
          const sentRows = await db
            .select({ id: schema.smsSends.id })
            .from(schema.smsSends)
            .where(
              and(
                eq(schema.smsSends.userId, alert.userId),
                eq(schema.smsSends.status, "sent"),
                gte(schema.smsSends.createdAt, monthStart),
              ),
            );
          sentThisMonth = sentRows.length;
        }
        if (cap > 0 && sentThisMonth >= cap) {
          skipped.push(`SMS (monthly limit of ${cap} reached)`);
          await logSend("capped", null, `monthly cap of ${cap} reached`);
        } else {
          try {
            const to = decryptSecret(settings.phoneNumberEnc);
            const result = await sendSms(to, message);
            delivered.push("SMS");
            await logSend("sent", result.sid, null);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            skipped.push("SMS (send failed)");
            console.warn(`price alerts: SMS send failed for alert ${alert.id}:`, reason);
            await logSend("failed", null, reason.slice(0, 500));
          }
        }
      }
    }
    if (entitled) {
      for (const c of channels) {
        if (c !== "Telegram" && c !== "SMS") skipped.push(`${c} (not implemented)`);
      }
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
      await db
        .update(schema.priceAlerts)
        .set({
          lastTriggeredAt: new Date(now),
          lastNotifiedPrice: price,
          episodeStartedAt: alert.episodeStartedAt ?? alert.lastTriggeredAt ?? new Date(now),
        })
        .where(eq(schema.priceAlerts.id, alert.id));
    } catch (err) {
      console.error(`price alerts: failed to record trigger for alert ${alert.id}:`, err instanceof Error ? err.message : err);
    }

    if (entitled) fireAlertWebhook({
      userId: alert.userId,
      alertId: alert.id,
      asset: alert.asset,
      direction: alert.direction,
      targetPrice: alert.targetPrice,
      currentPrice: price,
      triggeredAt: new Date(now).toISOString(),
      kind,
      messageShort: message,
      messageFull: message,
      message_short: message,
      message_full: message,
    });
  }
  return { checked: alerts.length, triggered, reset: resets.length };
}
