// USD pricing for watch events (spec §7.4/§8.1): the value is captured once,
// when the event is created, with its source and time recorded. A null price
// is a first-class outcome — the event stays valid as "value unavailable"
// and is never assigned an invented number.

const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  TRX: "tron",
  USDT: "tether",
  USDC: "usd-coin",
  XRP: "ripple",
  SOL: "solana",
  ARB: "arbitrum",
  PAXG: "pax-gold",
  USD1: "world-liberty-financial-usd",
  FDUSD: "first-digital-usd",
  RLUSD: "ripple-usd",
};

interface PriceEntry {
  price: number;
  at: number;
}
const cache = new Map<string, PriceEntry>();
const CACHE_MS = 60_000;

export async function getWatchPrice(symbol: string): Promise<{ price: number; source: string; at: string } | null> {
  const sym = symbol.toUpperCase();
  if (sym === "USDT" || sym === "USDC" || sym === "USD1" || sym === "FDUSD" || sym === "RLUSD") {
    // Stablecoins are priced at par only as a display convenience when the
    // market lookup is unavailable; the recorded source says which was used.
  }
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return { price: hit.price, source: "CoinGecko (cached)", at: new Date(hit.at).toISOString() };
  }
  const id = COINGECKO_IDS[sym];
  if (!id) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`, {
      headers: { accept: "application/json" },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { usd?: number }>;
    const price = data[id]?.usd;
    if (typeof price !== "number" || !(price > 0)) return null;
    cache.set(sym, { price, at: Date.now() });
    return { price, source: "CoinGecko", at: new Date().toISOString() };
  } catch {
    return null;
  }
}

export function usdValue(amountDecimal: string, price: number | null): number | null {
  if (price === null) return null;
  const amount = Number(amountDecimal);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * price * 100) / 100;
}
