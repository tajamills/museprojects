// Shared shape every exchange client normalizes into. The sync action stores
// these as rows in `transactions`, deduped on (userId, externalId).
export interface NormalizedTx {
  /** Exchange-native unique id, namespaced by provider in the sync action. */
  externalId: string;
  type: "BUY" | "SELL" | "RECEIVE" | "SEND" | "TRADE";
  asset: string;
  amount: number;
  priceUsd: number;
  feeUsd: number;
  occurredAt: Date;
  receivedAsset?: string;
  receivedAmount?: number;
  receivedPriceUsd?: number;
}

export type ExchangeFetcher = (apiKey: string, apiSecret: string) => Promise<NormalizedTx[]>;

export const FIAT_QUOTES = new Set(["USD", "USDT", "USDC", "DAI"]);

/** Parse a numeric string/number defensively; returns 0 on junk. */
export function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}
