// Provider boundary for the Stolen-Funds Watch (spec §7.1). Every chain goes
// through this normalized interface so provider health, staleness and payload
// evidence are recorded the same way for all six chains.

export type WatchChain = "ethereum" | "arbitrum" | "bitcoin" | "tron" | "xrp_ledger" | "solana";

export const WATCH_CHAINS: WatchChain[] = ["ethereum", "arbitrum", "bitcoin", "tron", "xrp_ledger", "solana"];

export interface NormalizedTransfer {
  txHash: string;
  /** Stable sub-index inside the transaction (e.g. "tokentx:0", "vout:2").
   * Deterministic for a given transaction so the idempotency key is stable
   * across polls. */
  eventIndex: string;
  blockHeight: number | null;
  /** Chain timestamp, ISO string. */
  observedAt: string;
  fromAddress: string;
  toAddress: string;
  assetSymbol: string;
  /** Token contract / mint / asset id; null for the chain's native asset. */
  assetContract: string | null;
  amountRaw: string;
  amountDecimal: string;
  confirmations: number | null;
  confirmed: boolean;
  finalized: boolean;
}

export interface ActivityResult {
  transfers: NormalizedTransfer[];
  latestHeight: number | null;
  payloadHash: string;
}

export interface TxStatus {
  exists: boolean;
  blockHeight: number | null;
  confirmations: number | null;
  confirmed: boolean;
  finalized: boolean;
}

export interface AdapterHealth {
  ok: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  rateLimitedUntil: string | null;
  successfulPolls: number;
  failedPolls: number;
}

export interface ChainAdapter {
  chain: WatchChain;
  providerName: string;
  getLatestHeight(): Promise<number | null>;
  /** Recent activity for an address. Adapters return a bounded recent window;
   * the monitor's baseline height gate (not the cursor) decides what may
   * become an event, and insertion is idempotent, so overlap is safe. */
  getAddressActivity(address: string): Promise<ActivityResult>;
  getTransactionStatus(txHash: string, blockHeight: number | null): Promise<TxStatus>;
  getNativeBalance(address: string): Promise<{ balanceDecimal: string | null; height: number | null; payloadHash: string }>;
  health(): AdapterHealth;
}

export abstract class BaseAdapter implements ChainAdapter {
  abstract chain: WatchChain;
  abstract providerName: string;
  protected lastSuccessAt: string | null = null;
  protected lastError: string | null = null;
  protected rateLimitedUntilMs = 0;
  protected okCount = 0;
  protected failCount = 0;

  protected markSuccess() {
    this.lastSuccessAt = new Date().toISOString();
    this.lastError = null;
    this.okCount++;
  }
  protected markFailure(e: unknown, rateLimited = false) {
    this.lastError = e instanceof Error ? e.message : String(e);
    this.failCount++;
    if (rateLimited) this.rateLimitedUntilMs = Date.now() + 60_000;
  }
  isRateLimited(): boolean {
    return Date.now() < this.rateLimitedUntilMs;
  }
  health(): AdapterHealth {
    return {
      ok: this.lastSuccessAt !== null && !this.isRateLimited(),
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      rateLimitedUntil: this.rateLimitedUntilMs ? new Date(this.rateLimitedUntilMs).toISOString() : null,
      successfulPolls: this.okCount,
      failedPolls: this.failCount,
    };
  }
  abstract getLatestHeight(): Promise<number | null>;
  abstract getAddressActivity(address: string): Promise<ActivityResult>;
  abstract getTransactionStatus(txHash: string, blockHeight: number | null): Promise<TxStatus>;
  abstract getNativeBalance(address: string): Promise<{ balanceDecimal: string | null; height: number | null; payloadHash: string }>;
}

/** Decimal-string division by 10^decimals without floating point. */
export function rawToDecimal(raw: string, decimals: number): string {
  const neg = raw.startsWith("-");
  const digits = (neg ? raw.slice(1) : raw).replace(/^0+(?=\d)/, "");
  if (decimals === 0) return (neg ? "-" : "") + digits;
  const padded = digits.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, "");
  const out = fracPart ? `${intPart}.${fracPart}` : intPart;
  return (neg && out !== "0" ? "-" : "") + out;
}

/** Confirmation policy per chain (spec §7.4). */
export function confirmationPolicy(chain: WatchChain, confirmations: number | null, finalized: boolean): "provisional" | "confirmed" {
  if (finalized) return "confirmed";
  if (confirmations === null) return "provisional";
  switch (chain) {
    case "ethereum":
    case "arbitrum":
      return confirmations >= 12 ? "confirmed" : "provisional";
    case "bitcoin":
      return confirmations >= 3 ? "confirmed" : "provisional";
    case "tron":
      return confirmations >= 19 ? "confirmed" : "provisional";
    case "xrp_ledger":
      // XRPL activity is read from validated ledgers only, so a seen
      // transaction is confirmed by construction.
      return "confirmed";
    case "solana":
      return confirmations >= 32 ? "confirmed" : "provisional";
    default:
      return "provisional";
  }
}
