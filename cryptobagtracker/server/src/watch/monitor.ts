import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "../schema.js";
import { effectiveMonitor } from "./flags.js";
import { classifyTransfers, nextStatus, type WatchedSide } from "./events.js";
import { getWatchPrice, usdValue } from "./prices.js";
import { EvmAdapter } from "./providers/evm.js";
import { BitcoinAdapter } from "./providers/bitcoin.js";
import { TronAdapter } from "./providers/tron.js";
import { XrplAdapter } from "./providers/xrpl.js";
import { SolanaAdapter } from "./providers/solana.js";
import { confirmationPolicy, type ChainAdapter, type NormalizedTransfer, type WatchChain } from "./providers/types.js";
import { deliverEvent, notifyProviderOutage } from "./delivery.js";
import { effectiveAlerts } from "./flags.js";

type Db = NodePgDatabase<typeof s>;
type CaseRow = typeof s.watchCases.$inferSelect;
type AddressRow = typeof s.watchAddresses.$inferSelect;
type EventRow = typeof s.watchEvents.$inferSelect;

const adapters = new Map<WatchChain, ChainAdapter>();
export function getAdapter(chain: WatchChain): ChainAdapter {
  let a = adapters.get(chain);
  if (!a) {
    switch (chain) {
      case "ethereum": a = new EvmAdapter("ethereum"); break;
      case "arbitrum": a = new EvmAdapter("arbitrum"); break;
      case "bitcoin": a = new BitcoinAdapter(); break;
      case "tron": a = new TronAdapter(); break;
      case "xrp_ledger": a = new XrplAdapter(); break;
      case "solana": a = new SolanaAdapter(); break;
    }
    adapters.set(chain, a!);
  }
  return a!;
}

export interface ProviderHealthView {
  chain: WatchChain;
  providerName: string;
  ok: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  rateLimitedUntil: string | null;
  successfulPolls: number;
  failedPolls: number;
  targetCadence: string;
}

export function providerHealthViews(): ProviderHealthView[] {
  const cadence: Record<WatchChain, string> = {
    ethereum: "anchors 5 min / others 15 min",
    arbitrum: "anchors 5 min / others 15 min",
    bitcoin: "10 min",
    tron: "anchors 5 min / others 15 min",
    xrp_ledger: "anchors 5 min / others 15 min",
    solana: "anchors 5 min / others 15 min",
  };
  return (Object.keys(cadence) as WatchChain[]).map((chain) => {
    const a = getAdapter(chain);
    const h = a.health();
    return { chain, providerName: a.providerName, ...h, targetCadence: cadence[chain] };
  });
}

function checkIntervalMinutes(addr: AddressRow): number {
  if (addr.chain === "bitcoin") return 10;
  return addr.anchorPriority ? 5 : 15;
}

/** Transfers at or below the baseline height are history, never events
 * (spec §7.2 baseline-first). A null height falls back to the baseline
 * timestamp gate. */
function afterBaseline(t: NormalizedTransfer, addr: AddressRow): boolean {
  if (addr.baselineHeight !== null && t.blockHeight !== null) return t.blockHeight > addr.baselineHeight;
  if (addr.baselineObservedAt) return new Date(t.observedAt).getTime() > addr.baselineObservedAt.getTime();
  return false;
}

async function pollAddress(
  db: Db,
  watchCase: CaseRow,
  addr: AddressRow,
  watchedByKey: Map<string, WatchedSide & { row: AddressRow }>,
): Promise<EventRow[]> {
  const adapter = getAdapter(addr.chain as WatchChain);
  const now = new Date();
  const nextCheck = new Date(now.getTime() + checkIntervalMinutes(addr) * 60_000);

  let activity;
  try {
    activity = await adapter.getAddressActivity(addr.address);
  } catch {
    await db.update(s.watchAddresses)
      .set({ lastCheckedAt: now, nextCheckAt: nextCheck, updatedAt: now })
      .where(eq(s.watchAddresses.id, addr.id));
    return [];
  }

  let balanceDecimal: string | null = null;
  let balanceHeight: number | null = null;
  try {
    const bal = await adapter.getNativeBalance(addr.address);
    balanceDecimal = bal.balanceDecimal;
    balanceHeight = bal.height;
  } catch { /* balance is best-effort; activity is the critical path */ }

  const isBaseline = addr.baselineStatus !== "complete";
  await db.insert(s.watchAddressSnapshots).values({
    addressId: addr.id,
    providerName: adapter.providerName,
    observedAt: now,
    blockHeight: activity.latestHeight ?? balanceHeight,
    nativeBalanceDecimal: balanceDecimal,
    rawPayloadHash: activity.payloadHash,
    isBaseline,
  });

  if (isBaseline) {
    await db.update(s.watchAddresses)
      .set({
        baselineStatus: "complete",
        baselineHeight: activity.latestHeight ?? balanceHeight,
        baselineObservedAt: now,
        status: "reported_no_confirmed_movement",
        lastCheckedAt: now,
        lastSuccessfulCheckAt: now,
        nextCheckAt: nextCheck,
        updatedAt: now,
      })
      .where(eq(s.watchAddresses.id, addr.id));
    return [];
  }

  const candidates = activity.transfers.filter((t) => afterBaseline(t, addr));
  const fresh: EventRow[] = [];
  if (candidates.length > 0) {
    const priceBySymbol = new Map<string, { price: number; source: string; at: string } | null>();
    for (const sym of new Set(candidates.map((t) => t.assetSymbol))) {
      priceBySymbol.set(sym, await getWatchPrice(sym));
    }
    const classified = classifyTransfers(
      addr.chain as WatchChain,
      candidates,
      (a) => watchedByKey.get(`${addr.chain}:${a.toLowerCase()}`) ?? watchedByKey.get(`${addr.chain}:${a}`) ?? null,
      (t) => {
        const p = priceBySymbol.get(t.assetSymbol);
        return p ? usdValue(t.amountDecimal, p.price) : null;
      },
    );
    for (const c of classified) {
      // Only persist events whose watched side is THIS address (the resolver
      // sees the whole case, but each address poll owns its own side; the
      // counterparty poll records its side if it is also watched).
      const mine =
        (c.fromSide && watchedByKey.get(`${addr.chain}:${addr.addressKey}`)?.addressId === c.fromSide.addressId) ||
        (!c.fromSide && c.toSide && watchedByKey.get(`${addr.chain}:${addr.addressKey}`)?.addressId === c.toSide.addressId);
      if (!mine) continue;
      const dedupeConds = [
        eq(s.watchEvents.caseId, watchCase.id),
        eq(s.watchEvents.chain, addr.chain),
        eq(s.watchEvents.txHash, c.transfer.txHash),
        eq(s.watchEvents.eventIndex, c.transfer.eventIndex),
        eq(s.watchEvents.eventKind, c.kind),
        c.fromSide ? eq(s.watchEvents.fromAddressId, c.fromSide.addressId) : isNull(s.watchEvents.fromAddressId),
      ];
      if (!c.fromSide && c.toSide) dedupeConds.push(eq(s.watchEvents.toAddressId, c.toSide.addressId));
      const existing = await db
        .select({ id: s.watchEvents.id })
        .from(s.watchEvents)
        .where(and(...dedupeConds))
        .limit(1);
      if (existing[0]) continue;
      const price = priceBySymbol.get(c.transfer.assetSymbol);
      const usd = price ? usdValue(c.transfer.amountDecimal, price.price) : null;
      const [row] = await db
        .insert(s.watchEvents)
        .values({
          caseId: watchCase.id,
          chain: addr.chain,
          network: "mainnet",
          txHash: c.transfer.txHash,
          transactionGroupKey: `${addr.chain}:${c.transfer.txHash}`,
          eventIndex: c.transfer.eventIndex,
          eventKind: c.kind,
          status: c.status,
          fromAddressId: c.fromSide?.addressId ?? null,
          toAddressId: c.toSide?.addressId ?? null,
          externalFromAddress: c.fromSide ? null : c.transfer.fromAddress,
          externalToAddress: c.toSide ? null : c.transfer.toAddress,
          assetSymbol: c.transfer.assetSymbol,
          assetContract: c.transfer.assetContract,
          amountRaw: c.transfer.amountRaw,
          amountDecimal: c.transfer.amountDecimal,
          usdValueAtEvent: usd !== null ? String(usd) : null,
          priceSource: price?.source ?? null,
          priceObservedAt: price ? new Date(price.at) : null,
          blockHeight: c.transfer.blockHeight,
          chainObservedAt: new Date(c.transfer.observedAt),
          confirmations: c.transfer.confirmations,
          isAnchorEvent: c.isAnchorEvent,
          severity: c.severity,
          publicNote: c.publicNote,
          confirmedAt: c.status === "confirmed" ? new Date() : null,
          publicVisibleFrom: c.status === "confirmed" ? new Date(Date.now() + 60 * 60_000) : null,
          providerPayloadHash: activity.payloadHash,
          isTest: watchCase.isTest,
        })
        .returning();
      if (row) fresh.push(row);
    }
  }

  const hasActivity = activity.transfers.some(
    (t) => t.fromAddress.toLowerCase() === addr.address.toLowerCase() || t.toAddress.toLowerCase() === addr.address.toLowerCase(),
  );
  await db.update(s.watchAddresses)
    .set({
      lastCheckedAt: now,
      lastSuccessfulCheckAt: now,
      nextCheckAt: nextCheck,
      lastActivityAt: hasActivity ? now : addr.lastActivityAt,
      status: fresh.length > 0 ? "reported_movement_detected" : addr.status,
      updatedAt: now,
    })
    .where(eq(s.watchAddresses.id, addr.id));
  return fresh;
}

async function refreshConfirmations(db: Db, watchCase: CaseRow): Promise<EventRow[]> {
  const pending = await db
    .select()
    .from(s.watchEvents)
    .where(and(eq(s.watchEvents.caseId, watchCase.id), inArray(s.watchEvents.status, ["provisional", "confirmed"])))
    .orderBy(asc(s.watchEvents.firstSeenAt))
    .limit(100);
  const newlyConfirmed: EventRow[] = [];
  for (const ev of pending) {
    const adapter = getAdapter(ev.chain as WatchChain);
    let status;
    try {
      status = await adapter.getTransactionStatus(ev.txHash, ev.blockHeight);
    } catch {
      continue;
    }
    const policy = confirmationPolicy(ev.chain as WatchChain, status.confirmations, status.finalized);
    const next = nextStatus(
      ev.status as "provisional" | "confirmed" | "finalized" | "reorged" | "retracted",
      policy,
      status.finalized,
      status.exists,
    );
    if (next !== ev.status || (status.confirmations ?? null) !== ev.confirmations) {
      const confirmedNow = (next === "confirmed" || next === "finalized") && ev.status === "provisional";
      const [row] = await db
        .update(s.watchEvents)
        .set({
          status: next,
          confirmations: status.confirmations,
          confirmedAt: confirmedNow ? new Date() : ev.confirmedAt,
          publicVisibleFrom: confirmedNow ? new Date(Date.now() + 60 * 60_000) : ev.publicVisibleFrom,
          updatedAt: new Date(),
        })
        .where(eq(s.watchEvents.id, ev.id))
        .returning();
      if (confirmedNow && row) newlyConfirmed.push(row);
    }
  }
  return newlyConfirmed;
}

let outageAlertedAt = new Map<string, number>();

export async function runWatchCycle(db: Db): Promise<{ casesChecked: number; eventsCreated: number }> {
  const cases = await db.select().from(s.watchCases);
  let eventsCreated = 0;
  let casesChecked = 0;
  for (const watchCase of cases) {
    if (!effectiveMonitor(watchCase)) continue;
    casesChecked++;
    const allAddresses = await db
      .select()
      .from(s.watchAddresses)
      .where(and(eq(s.watchAddresses.caseId, watchCase.id), inArray(s.watchAddresses.listSection, ["reported", "victim_owned"])));
    const watchedByKey = new Map<string, WatchedSide & { row: AddressRow }>();
    for (const a of allAddresses) {
      watchedByKey.set(`${a.chain}:${a.addressKey}`, {
        addressId: a.id,
        section: a.listSection as WatchedSide["section"],
        anchor: a.anchorPriority,
        frozenState: a.frozenState,
        row: a,
      });
    }
    const now = new Date();
    const due = allAddresses
      .filter((a) => !a.nextCheckAt || a.nextCheckAt <= now || a.baselineStatus !== "complete")
      .sort((x, y) => Number(y.anchorPriority) - Number(x.anchorPriority))
      .slice(0, 60);
    const deliverable: EventRow[] = [];
    // Per-chain queues run concurrently: one sick provider (timeouts,
    // bot-walls) may only stall its own chain's queue, never the cycle.
    const byChain = new Map<string, AddressRow[]>();
    for (const addr of due) {
      const arr = byChain.get(addr.chain) ?? [];
      arr.push(addr);
      byChain.set(addr.chain, arr);
    }
    await Promise.all(
      [...byChain.values()].map(async (queue) => {
        for (const addr of queue) {
          const fresh = await pollAddress(db, watchCase, addr, watchedByKey);
          eventsCreated += fresh.length;
          deliverable.push(...fresh.filter((e) => e.status === "confirmed" || e.status === "finalized"));
        }
      }),
    );
    const newlyConfirmed = await refreshConfirmations(db, watchCase);
    deliverable.push(...newlyConfirmed);

    if (effectiveAlerts(watchCase)) {
      for (const ev of deliverable) {
        await deliverEvent(db, watchCase, ev).catch((e) =>
          console.error("watch delivery failed:", e instanceof Error ? e.message : e),
        );
      }
    }

    // Provider outage internal alert (§8.4): a chain whose adapter has not
    // succeeded in over an hour while the monitor is on.
    for (const view of providerHealthViews()) {
      const lastOk = outageAlertedAt.get(view.chain) ?? 0;
      const stale =
        view.lastSuccessAt === null || Date.now() - new Date(view.lastSuccessAt).getTime() > 60 * 60_000;
      if (stale && view.failedPolls > 0 && Date.now() - lastOk > 6 * 60 * 60_000) {
        outageAlertedAt.set(view.chain, Date.now());
        await notifyProviderOutage(db, watchCase, view).catch(() => {});
      }
    }
  }
  return { casesChecked, eventsCreated };
}

let watchRunning = false;
export function startWatchMonitor(db: Db): void {
  const tick = async () => {
    if (watchRunning) return;
    watchRunning = true;
    try {
      const { casesChecked, eventsCreated } = await runWatchCycle(db);
      if (eventsCreated > 0) console.log(`watch monitor: ${eventsCreated} new event(s) across ${casesChecked} case(s)`);
    } catch (err) {
      console.error("watch monitor cycle failed:", err instanceof Error ? err.message : err);
    } finally {
      watchRunning = false;
    }
  };
  setTimeout(tick, 45_000);
  setInterval(tick, 60_000);
}
