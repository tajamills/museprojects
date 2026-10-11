/**
 * CryptoBagTracker Tax Engine v2 (TypeScript port of the canonical tax-engine.js)
 *
 * Core rules:
 * 1. Transfers between user-owned wallets are NEVER taxable events.
 *    Lots move with the coins; cost basis AND acquisition date are preserved.
 * 2. Disposals (sell/trade/send-to-unowned) consume lots per the chosen
 *    cost-basis method: FIFO, LIFO, or HIFO.
 * 3. Staking/airdrop rewards = ordinary income at FMV on receipt; they
 *    create lots with basis = FMV.
 * 4. Holding period: > 1 year (365 days) = long-term, else short-term.
 * 5. Fees: added to basis on acquisition, subtracted from proceeds on disposal.
 */

export type CostBasisMethod = "FIFO" | "LIFO" | "HIFO";
export type EngineTxType =
  | "buy"
  | "sell"
  | "receive"
  | "send"
  | "transfer"
  | "staking"
  | "airdrop"
  | "trade";

export interface EngineTransaction {
  id: number | string;
  /** ISO-8601 date string */
  date: string;
  asset: string;
  amount: number;
  type: EngineTxType;
  walletId?: number | null;
  toWalletId?: number | null;
  priceUsd: number;
  feeUsd?: number;
  note?: string;
  receivedAsset?: string;
  receivedAmount?: number;
  receivedPriceUsd?: number;
}

interface Lot {
  id: string;
  asset: string;
  amount: number;
  remaining: number;
  basisUsd: number;
  dateAcquired: string;
  walletId: number | null;
}

export interface EngineDisposal {
  asset: string;
  amount: number;
  dateAcquired: string;
  dateSold: string;
  proceeds: number;
  costBasis: number;
  gainLoss: number;
  term: "short" | "long";
  kind: string;
}

export interface IncomeEvent {
  date: string;
  asset: string;
  amount: number;
  fmvUsd: number;
  kind: string;
}

export interface CustodyTransfer {
  date: string;
  asset: string;
  amount: number;
  from: number | null;
  to: number | null;
}

export interface OpenLot {
  id: string;
  asset: string;
  remaining: number;
  basisUsd: number;
  dateAcquired: string;
  walletId: number | null;
}

export interface EngineResult {
  lots: OpenLot[];
  disposals: EngineDisposal[];
  incomeEvents: IncomeEvent[];
  transfers: CustodyTransfer[];
  totalByAsset: Record<string, number>;
  totalGainLoss: number;
  shortGain: number;
  longGain: number;
  totalIncome: number;
}

export interface Form8949Row {
  description: string;
  dateAcquired: string;
  dateSold: string;
  proceeds: number;
  costBasis: number;
  gainLoss: number;
}

export interface Form8949 {
  form: "8949";
  taxpayerName: string;
  taxYear: number;
  partI_shortTerm: { rows: Form8949Row[]; totalProceeds: number; totalBasis: number; totalGainLoss: number };
  partII_longTerm: { rows: Form8949Row[]; totalProceeds: number; totalBasis: number; totalGainLoss: number };
}

export interface ScheduleD {
  form: "Schedule D";
  taxpayerName: string;
  taxYear: number;
  shortTermTotal: number;
  longTermTotal: number;
  netCapitalGainLoss: number;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function processTransactions(
  transactions: EngineTransaction[],
  ownedWalletIds: Array<number | null>,
  method: CostBasisMethod,
): EngineResult {
  const owned = new Set(ownedWalletIds);
  const lots: Lot[] = [];
  const disposals: EngineDisposal[] = [];
  const incomeEvents: IncomeEvent[] = [];
  const transfers: CustodyTransfer[] = [];
  let lotSeq = 0;

  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  function addLot(asset: string, amount: number, basisUsd: number, dateAcquired: string, walletId: number | null | undefined) {
    lots.push({ id: "lot-" + ++lotSeq, asset, amount, remaining: amount, basisUsd, dateAcquired, walletId: walletId ?? null });
  }

  function consumeLots(asset: string, amount: number, dateSold: string) {
    const open = lots.filter((l) => l.asset === asset && l.remaining > 1e-12);
    if (method === "FIFO") open.sort((a, b) => a.dateAcquired.localeCompare(b.dateAcquired));
    else if (method === "LIFO") open.sort((a, b) => b.dateAcquired.localeCompare(a.dateAcquired));
    else if (method === "HIFO") open.sort((a, b) => b.basisUsd / b.amount - a.basisUsd / a.amount);
    else throw new Error("Unknown cost-basis method: " + method);

    let need = amount;
    const consumed: Array<{ lotId: string; amount: number; basis: number; dateAcquired: string }> = [];
    for (const lot of open) {
      if (need <= 1e-12) break;
      const take = Math.min(lot.remaining, need);
      const unitBasis = lot.basisUsd / lot.remaining; // basisUsd always tracks `remaining`
      consumed.push({ lotId: lot.id, amount: take, basis: take * unitBasis, dateAcquired: lot.dateAcquired });
      lot.basisUsd -= take * unitBasis;
      lot.remaining -= take;
      need -= take;
    }
    if (need > 1e-9) {
      throw new Error(`Insufficient ${asset} balance for disposal of ${amount} on ${dateSold} (short ${need.toFixed(8)})`);
    }
    return consumed;
  }

  function recordDisposal(args: {
    asset: string;
    amount: number;
    dateSold: string;
    priceUsd: number;
    feeUsd?: number;
    kind: string;
  }): EngineDisposal[] {
    const consumed = consumeLots(args.asset, args.amount, args.dateSold);
    const proceeds = args.amount * args.priceUsd - (args.feeUsd ?? 0);
    // Holding period: each consumed lot gets its own disposal line so mixed
    // holding periods split correctly (8949-correct).
    const lines: EngineDisposal[] = [];
    for (const c of consumed) {
      const daysHeld = (new Date(args.dateSold).getTime() - new Date(c.dateAcquired).getTime()) / 86400000;
      const term = daysHeld > 365 ? "long" : "short";
      const lineProceeds = (c.amount / args.amount) * proceeds;
      lines.push({
        asset: args.asset,
        amount: c.amount,
        dateAcquired: c.dateAcquired,
        dateSold: args.dateSold,
        proceeds: round2(lineProceeds),
        costBasis: round2(c.basis),
        gainLoss: round2(lineProceeds - c.basis),
        term,
        kind: args.kind,
      });
    }
    disposals.push(...lines);
    return lines;
  }

  // Move lot locations for a custody transfer (no tax impact).
  // Moves whole lots FIFO by acquisition date for deterministic custody tracing.
  function moveLots(asset: string, amount: number, fromWallet: number | null, toWallet: number | null) {
    const mine = lots
      .filter((l) => l.asset === asset && l.walletId === fromWallet && l.remaining > 1e-12)
      .sort((a, b) => a.dateAcquired.localeCompare(b.dateAcquired));
    let need = amount;
    for (const lot of mine) {
      if (need <= 1e-12) break;
      if (lot.remaining <= need + 1e-12) {
        // whole lot moves
        lot.walletId = toWallet;
        need -= lot.remaining;
      } else {
        // split the lot: part stays, part moves (basis + date pro-rated/preserved)
        const moveAmt = need;
        const stayAmt = lot.remaining - moveAmt;
        const unitBasis = lot.basisUsd / lot.remaining;
        lot.remaining = stayAmt;
        lot.basisUsd = stayAmt * unitBasis;
        lots.push({
          id: "lot-" + ++lotSeq,
          asset,
          amount: moveAmt,
          remaining: moveAmt,
          basisUsd: moveAmt * unitBasis,
          dateAcquired: lot.dateAcquired,
          walletId: toWallet,
        });
        need = 0;
      }
    }
    if (need > 1e-9) throw new Error(`Insufficient ${asset} in wallet ${fromWallet} for transfer of ${amount}`);
  }

  for (const tx of sorted) {
    const fee = tx.feeUsd || 0;
    switch (tx.type) {
      case "buy":
        // fee adds to basis
        addLot(tx.asset, tx.amount, tx.amount * tx.priceUsd + fee, tx.date, tx.walletId);
        break;
      case "receive":
        // unsolicited inbound from unknown source: basis = FMV (conservative), no income event
        addLot(tx.asset, tx.amount, tx.amount * tx.priceUsd, tx.date, tx.walletId);
        break;
      case "staking":
      case "airdrop": {
        const fmv = tx.amount * tx.priceUsd;
        incomeEvents.push({ date: tx.date, asset: tx.asset, amount: tx.amount, fmvUsd: round2(fmv), kind: tx.type });
        addLot(tx.asset, tx.amount, fmv, tx.date, tx.walletId);
        break;
      }
      case "sell":
        recordDisposal({ asset: tx.asset, amount: tx.amount, dateSold: tx.date, priceUsd: tx.priceUsd, feeUsd: fee, kind: "sell" });
        break;
      case "trade": {
        // tx.amount of tx.asset OUT, tx.receivedAmount of tx.receivedAsset IN at tx.receivedPriceUsd
        if (!tx.receivedAsset || !tx.receivedAmount || tx.receivedPriceUsd == null) {
          throw new Error(`trade of ${tx.asset} is missing received asset details`);
        }
        recordDisposal({ asset: tx.asset, amount: tx.amount, dateSold: tx.date, priceUsd: tx.priceUsd, feeUsd: fee, kind: "trade" });
        addLot(tx.receivedAsset, tx.receivedAmount, tx.receivedAmount * tx.receivedPriceUsd, tx.date, tx.walletId);
        break;
      }
      case "send": {
        const toOwned = tx.toWalletId != null && owned.has(tx.toWalletId);
        const fromOwned = tx.walletId != null && owned.has(tx.walletId);
        if (fromOwned && toOwned) {
          // OWNED -> OWNED: pure custody move. Move lots, preserve basis + dates. NO disposal.
          moveLots(tx.asset, tx.amount, tx.walletId ?? null, tx.toWalletId ?? null);
          transfers.push({ date: tx.date, asset: tx.asset, amount: tx.amount, from: tx.walletId ?? null, to: tx.toWalletId ?? null });
        } else if (fromOwned) {
          // Owned -> external: taxable disposal at FMV
          recordDisposal({ asset: tx.asset, amount: tx.amount, dateSold: tx.date, priceUsd: tx.priceUsd, feeUsd: fee, kind: "send" });
        } else {
          throw new Error(`send from unknown wallet ${tx.walletId}`);
        }
        break;
      }
      case "transfer": {
        // explicit transfer type: same owned->owned logic
        if (tx.toWalletId == null) throw new Error("transfer missing toWalletId");
        if (tx.walletId != null && owned.has(tx.walletId) && owned.has(tx.toWalletId)) {
          moveLots(tx.asset, tx.amount, tx.walletId, tx.toWalletId);
          transfers.push({ date: tx.date, asset: tx.asset, amount: tx.amount, from: tx.walletId, to: tx.toWalletId });
        } else {
          recordDisposal({ asset: tx.asset, amount: tx.amount, dateSold: tx.date, priceUsd: tx.priceUsd, feeUsd: fee, kind: "transfer-out" });
        }
        break;
      }
      default:
        throw new Error("Unknown transaction type: " + (tx as EngineTransaction).type);
    }
  }

  const openLots: OpenLot[] = lots
    .filter((l) => l.remaining > 1e-12)
    .map((l) => ({ id: l.id, asset: l.asset, remaining: l.remaining, basisUsd: l.basisUsd, dateAcquired: l.dateAcquired, walletId: l.walletId }));
  const totalByAsset: Record<string, number> = {};
  for (const l of openLots) {
    totalByAsset[l.asset] = (totalByAsset[l.asset] ?? 0) + l.remaining;
  }
  const totalGainLoss = disposals.reduce((s, d) => s + d.gainLoss, 0);
  const shortGain = disposals.filter((d) => d.term === "short").reduce((s, d) => s + d.gainLoss, 0);
  const longGain = disposals.filter((d) => d.term === "long").reduce((s, d) => s + d.gainLoss, 0);
  const totalIncome = incomeEvents.reduce((s, e) => s + e.fmvUsd, 0);

  return {
    lots: openLots,
    disposals,
    incomeEvents,
    transfers,
    totalByAsset,
    totalGainLoss: round2(totalGainLoss),
    shortGain: round2(shortGain),
    longGain: round2(longGain),
    totalIncome: round2(totalIncome),
  };
}

// ---------- Form 8949 + Schedule D ----------
export function build8949(disposals: EngineDisposal[], taxpayerName: string, taxYear: number): Form8949 {
  const short = disposals.filter((d) => d.term === "short");
  const long = disposals.filter((d) => d.term === "long");
  const part = (rows: EngineDisposal[]): Form8949Row[] =>
    rows.map((r) => ({
      description: `${r.amount} ${r.asset}`,
      dateAcquired: r.dateAcquired.slice(0, 10),
      dateSold: r.dateSold.slice(0, 10),
      proceeds: r.proceeds,
      costBasis: r.costBasis,
      gainLoss: r.gainLoss,
    }));
  const sum = (rows: EngineDisposal[], k: "proceeds" | "costBasis" | "gainLoss") => round2(rows.reduce((s, r) => s + r[k], 0));
  return {
    form: "8949",
    taxpayerName,
    taxYear,
    partI_shortTerm: { rows: part(short), totalProceeds: sum(short, "proceeds"), totalBasis: sum(short, "costBasis"), totalGainLoss: sum(short, "gainLoss") },
    partII_longTerm: { rows: part(long), totalProceeds: sum(long, "proceeds"), totalBasis: sum(long, "costBasis"), totalGainLoss: sum(long, "gainLoss") },
  };
}

export function buildScheduleD(f8949: Form8949): ScheduleD {
  return {
    form: "Schedule D",
    taxpayerName: f8949.taxpayerName,
    taxYear: f8949.taxYear,
    shortTermTotal: f8949.partI_shortTerm.totalGainLoss,
    longTermTotal: f8949.partII_longTerm.totalGainLoss,
    netCapitalGainLoss: round2(f8949.partI_shortTerm.totalGainLoss + f8949.partII_longTerm.totalGainLoss),
  };
}
