import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "../schema.js";
import { sendTelegramMessage } from "../alerts.js";
import { getEntitlement, isComped } from "../entitlement.js";
import { formatWatchAlert, severityRank, type Severity } from "./events.js";
import type { ProviderHealthView } from "./monitor.js";

// Delivery (spec §8). The entitlement gate is entitlement.ts and nothing
// else. Every outcome — sent, skipped (not entitled / below severity / no
// Telegram), failed — is recorded in watch_deliveries. Watch events NEVER
// go through the price-alert webhook (ALERT_WEBHOOK_URL): that webhook
// carries another feature's payloads and cannot tell event types apart.

type Db = NodePgDatabase<typeof s>;
type CaseRow = typeof s.watchCases.$inferSelect;
type EventRow = typeof s.watchEvents.$inferSelect;

const CHAIN_LABELS: Record<string, string> = {
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  bitcoin: "Bitcoin",
  tron: "Tron",
  xrp_ledger: "XRP Ledger",
  solana: "Solana",
};

function caseUrl(slug: string): string {
  const base = (process.env.APP_BASE_URL ?? "https://cryptobagtracker.io").replace(/\/$/, "");
  return `${base}/watch/${slug}`;
}

async function recordDelivery(
  db: Db,
  args: {
    eventId: string;
    userId: number;
    channel: "telegram" | "in_app";
    status: string;
    failureReason?: string;
    isInternal?: boolean;
    isTest?: boolean;
  },
): Promise<void> {
  await db
    .insert(s.watchDeliveries)
    .values({
      eventId: args.eventId,
      userId: args.userId,
      channel: args.channel,
      status: args.status,
      deliveredAt: args.status === "delivered" || args.status === "recorded_in_app" ? new Date() : null,
      failureReason: args.failureReason ?? null,
      isInternal: args.isInternal ?? false,
      isTest: args.isTest ?? false,
    })
    .onConflictDoNothing();
}

async function telegramChatIdFor(db: Db, userId: number): Promise<string | null> {
  const rows = await db.select().from(s.alertSettings).where(eq(s.alertSettings.userId, userId)).limit(1);
  return rows[0]?.telegramChatId ?? null;
}

function alertText(watchCase: CaseRow, ev: EventRow, internal: boolean): string {
  const usd = ev.usdValueAtEvent !== null && ev.usdValueAtEvent !== undefined ? `$${Number(ev.usdValueAtEvent).toLocaleString("en-US")}` : "value unavailable";
  return formatWatchAlert({
    internal,
    title: watchCase.title,
    severity: ev.severity as Severity,
    amountDecimal: String(ev.amountDecimal),
    assetSymbol: ev.assetSymbol,
    usdText: usd,
    chainLabel: CHAIN_LABELS[ev.chain] ?? ev.chain,
    fromDisplay: ev.externalFromAddress ?? "a reported address on this case",
    toDisplay: ev.externalToAddress ?? "a reported address on this case",
    status: ev.status,
    caseUrl: caseUrl(watchCase.slug),
    publicNote: ev.publicNote,
  });
}

export async function deliverEvent(db: Db, watchCase: CaseRow, ev: EventRow): Promise<void> {
  if (ev.status !== "confirmed" && ev.status !== "finalized") return;
  const subs = await db
    .select()
    .from(s.watchSubscriptions)
    .where(eq(s.watchSubscriptions.caseId, watchCase.id));

  for (const sub of subs) {
    if (sub.isTest !== watchCase.isTest) continue;
    if (sub.testExpiresAt && sub.testExpiresAt.getTime() < Date.now()) continue;
    const channels: ("telegram" | "in_app")[] = [];
    if (sub.telegramEnabled) channels.push("telegram");
    if (sub.inAppEnabled) channels.push("in_app");
    if (channels.length === 0) continue;

    const [user] = await db.select().from(s.users).where(eq(s.users.id, sub.userId)).limit(1);
    if (!user) continue;

    if (severityRank(ev.severity as Severity) < severityRank(sub.minSeverity as Severity)) {
      for (const channel of channels) {
        await recordDelivery(db, { eventId: ev.id, userId: sub.userId, channel, status: "skipped_below_severity", isTest: ev.isTest });
      }
      continue;
    }

    const { entitlement } = await getEntitlement(db, user);
    if (!entitlement.entitled) {
      for (const channel of channels) {
        await recordDelivery(db, { eventId: ev.id, userId: sub.userId, channel, status: "skipped_not_entitled", isTest: ev.isTest });
      }
      continue;
    }

    for (const channel of channels) {
      if (channel === "in_app") {
        await recordDelivery(db, { eventId: ev.id, userId: sub.userId, channel, status: "recorded_in_app", isTest: ev.isTest });
      } else {
        const chatId = await telegramChatIdFor(db, sub.userId);
        if (!chatId) {
          await recordDelivery(db, { eventId: ev.id, userId: sub.userId, channel, status: "skipped_no_telegram", isTest: ev.isTest });
          continue;
        }
        try {
          await sendTelegramMessage(chatId, alertText(watchCase, ev, false));
          await recordDelivery(db, { eventId: ev.id, userId: sub.userId, channel, status: "delivered", isTest: ev.isTest });
        } catch (e) {
          await recordDelivery(db, {
            eventId: ev.id, userId: sub.userId, channel, status: "failed",
            failureReason: e instanceof Error ? e.message : String(e), isTest: ev.isTest,
          });
        }
      }
    }
  }

  // Internal owner alert (§8.4): high-severity events and freeze-state /
  // issuer events also go to the owner, labeled internal. Recorded with
  // isInternal so it is never counted as subscriber delivery.
  if (ev.severity === "high" || ev.eventKind === "freeze_state_event" || ev.eventKind === "issuer_action") {
    const owners = await db.select().from(s.users).where(eq(s.users.comped, true));
    for (const owner of owners) {
      if (!isComped(owner)) continue;
      const chatId = await telegramChatIdFor(db, owner.id);
      if (!chatId) {
        await recordDelivery(db, { eventId: ev.id, userId: owner.id, channel: "telegram", status: "skipped_no_telegram", isInternal: true, isTest: ev.isTest });
        continue;
      }
      try {
        await sendTelegramMessage(chatId, alertText(watchCase, ev, true));
        await recordDelivery(db, { eventId: ev.id, userId: owner.id, channel: "telegram", status: "delivered", isInternal: true, isTest: ev.isTest });
      } catch (e) {
        await recordDelivery(db, {
          eventId: ev.id, userId: owner.id, channel: "telegram", status: "failed",
          failureReason: e instanceof Error ? e.message : String(e), isInternal: true, isTest: ev.isTest,
        });
      }
    }
  }
}

/** Internal provider-outage notice (§8.4). There is no event row for an
 * outage, so this sends the Telegram only; the outage itself is visible in
 * the admin provider-health view. */
export async function notifyProviderOutage(db: Db, watchCase: CaseRow, view: ProviderHealthView): Promise<void> {
  const owners = await db.select().from(s.users).where(eq(s.users.comped, true));
  for (const owner of owners) {
    if (!isComped(owner)) continue;
    const chatId = await telegramChatIdFor(db, owner.id);
    if (!chatId) continue;
    const text = [
      "Internal — owner monitoring notice (not a subscriber alert).",
      `Provider outage: ${view.chain} via ${view.providerName} has not succeeded in over an hour.`,
      `Last error: ${view.lastError ?? "unknown"}`,
      `Case: ${watchCase.title}`,
      "The public movement board shows this chain as stale; nothing is being presented as current for it.",
    ].join("\n");
    await sendTelegramMessage(chatId, text).catch(() => {});
  }
}
