// Pure event classification for the Stolen-Funds Watch (spec §7.5/§7.6/§8.1).
// No I/O here: given normalized transfers plus watch context, decide what
// becomes an event, its kind, severity and public note. This module is the
// one exercised by the offline fixtures.

import type { NormalizedTransfer, WatchChain } from "./providers/types.js";
import { confirmationPolicy } from "./providers/types.js";

export type EventKind =
  | "outbound_transfer"
  | "split_distribution"
  | "consolidation"
  | "inbound_funding"
  | "freeze_state_event"
  | "issuer_action";

export type Severity = "low" | "medium" | "high";

export interface WatchedSide {
  addressId: string;
  section: "reported" | "victim_owned" | "quarantined";
  anchor: boolean;
  frozenState: string | null;
}

export interface ClassifiedEvent {
  transfer: NormalizedTransfer;
  kind: EventKind;
  severity: Severity;
  fromSide: WatchedSide | null;
  toSide: WatchedSide | null;
  isAnchorEvent: boolean;
  involvesFrozenAsset: boolean;
  publicNote: string | null;
  status: "provisional" | "confirmed";
}

/** Assets with freeze figures reported in the case file (spec §5.2C). A
 * transfer of one of these out of an address reported as holding frozen
 * funds is a freeze-state event, never a routine transfer (§7.6). */
export const FROZEN_REPORTED_ASSETS = new Set(["USDT", "USDC", "USD1", "PAXG", "RLUSD", "FDUSD"]);

export const FREEZE_NEUTRAL_NOTE =
  "A transfer was detected involving an asset previously reported as frozen. " +
  "A freeze is applied by the token issuer and may be changed or reversed by that issuer without moving funds on-chain. " +
  "This record shows only that a transfer was detected; it does not establish that previously frozen funds were released or recovered.";

export function severityRank(s: Severity): number {
  return s === "high" ? 3 : s === "medium" ? 2 : 1;
}

export function classifyTransfers(
  chain: WatchChain,
  transfers: NormalizedTransfer[],
  resolveWatched: (address: string) => WatchedSide | null,
  usdValueOf: (t: NormalizedTransfer) => number | null,
): ClassifiedEvent[] {
  // Group transfers by transaction for split / consolidation patterns.
  const groups = new Map<string, NormalizedTransfer[]>();
  for (const t of transfers) {
    const arr = groups.get(t.txHash) ?? [];
    arr.push(t);
    groups.set(t.txHash, arr);
  }

  const out: ClassifiedEvent[] = [];
  for (const t of transfers) {
    const fromSide = resolveWatched(t.fromAddress);
    const toSide = resolveWatched(t.toAddress);
    if (!fromSide && !toSide) continue;

    const usd = usdValueOf(t);
    const involvesFrozenAsset =
      FROZEN_REPORTED_ASSETS.has(t.assetSymbol.toUpperCase()) &&
      !!fromSide &&
      fromSide.section === "reported" &&
      (fromSide.frozenState ?? "").toLowerCase().includes("frozen");

    // Victim-owned wallets are live exchange wallets: their ordinary traffic
    // is noise. A victim-side row is created only when the other side is a
    // reported address (movement between the two lists), per spec §7.5.
    if (!fromSide && toSide?.section === "victim_owned") continue;
    if (fromSide?.section === "victim_owned" && !toSide) continue;
    if (fromSide?.section === "quarantined" || toSide?.section === "quarantined") continue;

    let kind: EventKind;
    let severity: Severity;
    let publicNote: string | null = null;
    const isOutbound = !!fromSide && fromSide.section === "reported";
    const anchor = (fromSide?.anchor ?? false) || (toSide?.anchor ?? false);

    if (involvesFrozenAsset) {
      kind = "freeze_state_event";
      severity = "high";
      publicNote = FREEZE_NEUTRAL_NOTE;
    } else if (isOutbound) {
      const group = groups.get(t.txHash) ?? [t];
      const outboundInGroup = group.filter((g) => resolveWatched(g.fromAddress)?.addressId === fromSide!.addressId);
      const distinctDestinations = new Set(outboundInGroup.map((g) => g.toAddress.toLowerCase()));
      if (outboundInGroup.length >= 3 && distinctDestinations.size >= 3) {
        kind = "split_distribution";
      } else if (toSide?.section === "reported") {
        kind = "consolidation";
      } else {
        kind = "outbound_transfer";
      }
      if (fromSide!.anchor) severity = "high";
      else if (usd !== null && usd >= 100_000) severity = "high";
      else if (usd !== null && usd >= 10_000) severity = "medium";
      else severity = "low";
    } else {
      // Inbound to a reported address (funding / consolidation-in).
      const group = groups.get(t.txHash) ?? [t];
      const inboundSenders = new Set(
        group.filter((g) => g.toAddress.toLowerCase() === t.toAddress.toLowerCase()).map((g) => g.fromAddress.toLowerCase()),
      );
      kind = fromSide?.section === "reported" || inboundSenders.size >= 3 ? "consolidation" : "inbound_funding";
      if (usd !== null && usd >= 100_000) severity = "high";
      else if (usd !== null && usd >= 10_000) severity = "medium";
      else severity = "low";
    }

    out.push({
      transfer: t,
      kind,
      severity,
      fromSide,
      toSide,
      isAnchorEvent: isOutbound ? fromSide!.anchor : anchor,
      involvesFrozenAsset,
      publicNote,
      status: confirmationPolicy(chain, t.confirmations, t.finalized),
    });
  }
  return out;
}

/** §6.8 / §7.3 idempotency: one row per side per transaction sub-transfer. */
export function eventIdentity(e: ClassifiedEvent): string {
  const t = e.transfer;
  const side = e.fromSide ? `from:${e.fromSide.addressId}` : `to:${e.toSide?.addressId ?? ""}`;
  return `${t.txHash}|${t.eventIndex}|${side}|${e.kind}`;
}

export function transactionGroupKey(chain: WatchChain, txHash: string): string {
  return `${chain}:${txHash}`;
}

/** Confirmation state transitions (spec §7.4). "reorged" is a stored status
 * an event can move to from provisional/confirmed when the provider stops
 * returning the transaction; it never returns to an alertable state. */
export function nextStatus(
  current: "provisional" | "confirmed" | "finalized" | "reorged" | "retracted",
  policyResult: "provisional" | "confirmed",
  finalized: boolean,
  providerStillReturnsTx: boolean,
): "provisional" | "confirmed" | "finalized" | "reorged" | "retracted" {
  if (current === "retracted") return "retracted";
  if (!providerStillReturnsTx) return "reorged";
  if (finalized) return "finalized";
  if (policyResult === "confirmed") return "confirmed";
  return current === "confirmed" || current === "finalized" ? current : "provisional";
}

/** Delivery text (spec §8.3) — reported language only, no labels for people. */
export function formatWatchAlert(args: {
  internal?: boolean;
  title: string;
  severity: Severity;
  amountDecimal: string;
  assetSymbol: string;
  usdText: string;
  chainLabel: string;
  fromDisplay: string;
  toDisplay: string;
  status: string;
  caseUrl: string;
  publicNote?: string | null;
}): string {
  const lines: string[] = [];
  if (args.internal) lines.push("Internal — owner monitoring notice (not a subscriber alert).");
  lines.push(`${args.internal ? "" : "Reported-address movement — "}${args.title}`);
  lines.push(`Severity: ${args.severity}`);
  lines.push(`Amount: ${args.amountDecimal} ${args.assetSymbol} (${args.usdText})`);
  lines.push(`Chain: ${args.chainLabel}`);
  lines.push(`From: ${args.fromDisplay}`);
  lines.push(`To: ${args.toDisplay}`);
  lines.push(`Status: ${args.status}`);
  if (args.publicNote) lines.push(args.publicNote);
  lines.push(`Case page: ${args.caseUrl}`);
  return lines.join("\n");
}
