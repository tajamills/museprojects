// Uphold API client.
//
// Uphold authenticates with OAuth2 bearer tokens — there is no HMAC key
// pair. The connection's API key field holds the access token and the
// secret field the refresh token (currently unused: the full OAuth connect
// + refresh flow is a follow-up; when the access token expires, syncs fail
// with a 401 and the user pastes a fresh token).
//
// Data: GET /v0/me/transactions on api.uphold.com, paginated with Range
// headers. Mapping is best-effort from origin/destination:
//   external (bank/crypto) -> own account   = RECEIVE (priceUsd 0)
//   own account -> external                 = SEND (priceUsd 0)
//   own USD -> own crypto                   = BUY  (priced from the USD leg)
//   own crypto -> own USD                   = SELL (priced from the USD leg)
// Internal same-currency moves and crypto-crypto conversions are skipped.
import { num, type NormalizedTx } from "./types.js";

const API_BASE = "https://api.uphold.com/v0";
const PAGE_SIZE = 50;

interface UpholdLeg {
  type?: string;
  amount?: string;
  currency?: string;
}

interface UpholdTransaction {
  id?: string;
  createdAt?: string;
  status?: string;
  origin?: UpholdLeg;
  destination?: UpholdLeg;
  fees?: Array<{ amount?: string; currency?: string }>;
}

const EXTERNAL_LEG_TYPES = new Set(["bank", "crypto", "uphold"]);

function usdFees(tx: UpholdTransaction): number {
  return (tx.fees ?? []).reduce((sum, fee) => sum + (fee.currency === "USD" ? num(fee.amount) : 0), 0);
}

function mapTransaction(tx: UpholdTransaction): NormalizedTx | null {
  if (!tx.id || tx.status !== "completed") return null;
  const origin = tx.origin ?? {};
  const destination = tx.destination ?? {};
  const originAsset = (origin.currency ?? "").toUpperCase();
  const destAsset = (destination.currency ?? "").toUpperCase();
  const originAmount = num(origin.amount);
  const destAmount = num(destination.amount);
  if (!originAsset || !destAsset || originAmount <= 0 || destAmount <= 0) return null;

  const base = {
    externalId: tx.id,
    feeUsd: usdFees(tx),
    occurredAt: tx.createdAt ? new Date(tx.createdAt) : new Date(),
  };

  const originExternal = EXTERNAL_LEG_TYPES.has(origin.type ?? "");
  const destExternal = EXTERNAL_LEG_TYPES.has(destination.type ?? "");

  if (originExternal && !destExternal) {
    return { ...base, type: "RECEIVE", asset: destAsset, amount: destAmount, priceUsd: 0 };
  }
  if (destExternal && !originExternal) {
    return { ...base, type: "SEND", asset: originAsset, amount: originAmount, priceUsd: 0 };
  }
  if (originAsset === destAsset) return null; // internal move between own accounts

  if (originAsset === "USD") {
    return { ...base, type: "BUY", asset: destAsset, amount: destAmount, priceUsd: originAmount / destAmount };
  }
  if (destAsset === "USD") {
    return { ...base, type: "SELL", asset: originAsset, amount: originAmount, priceUsd: destAmount / originAmount };
  }
  // Non-USD fiat or crypto-crypto conversion: direction is known but no
  // USD valuation is, so keep the movement with a zero price.
  const fiat = new Set(["EUR", "GBP", "AUD", "CAD"]);
  if (fiat.has(originAsset)) return { ...base, type: "BUY", asset: destAsset, amount: destAmount, priceUsd: 0 };
  if (fiat.has(destAsset)) return { ...base, type: "SELL", asset: originAsset, amount: originAmount, priceUsd: 0 };
  return null;
}

export async function fetchTransactions(apiKey: string, _apiSecret: string): Promise<NormalizedTx[]> {
  const token = apiKey.trim();
  const txs: NormalizedTx[] = [];
  let start = 0;
  let total = Number.POSITIVE_INFINITY;

  while (start < total) {
    const res = await fetch(`${API_BASE}/me/transactions`, {
      headers: { Authorization: `Bearer ${token}`, Range: `items=${start}-${start + PAGE_SIZE - 1}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Uphold rejected the access token (it may have expired). Paste a fresh access token to reconnect.");
    }
    if (!res.ok && res.status !== 206) throw new Error(`Uphold request failed (HTTP ${res.status}).`);
    const contentRange = res.headers.get("content-range");
    const totalMatch = contentRange?.match(/\/(\d+)\s*$/);
    if (totalMatch?.[1]) total = Number.parseInt(totalMatch[1], 10);
    const page = (await res.json()) as UpholdTransaction[];
    if (!Array.isArray(page) || page.length === 0) break;
    for (const tx of page) {
      const mapped = mapTransaction(tx);
      if (mapped) txs.push(mapped);
    }
    start += page.length;
    if (page.length < PAGE_SIZE && total === Number.POSITIVE_INFINITY) break;
  }

  return txs.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}
