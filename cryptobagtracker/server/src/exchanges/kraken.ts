// Kraken private REST API client.
//
// Auth: API-Key header + API-Sign = base64(HMAC-SHA512(
//   path bytes || SHA256(nonce + urlencoded body), base64-decoded secret )).
// Data: /0/private/TradesHistory (paginated with `ofs`) for trades and
// /0/private/Ledgers for deposits/withdrawals.
//
// Mapping notes:
// - Only pairs quoted in USD/USDT/USDC/DAI are imported. Crypto-crypto pairs
//   are skipped because neither leg carries a USD valuation, and the tax
//   engine needs a USD price on every disposal.
// - Ledger deposits land as RECEIVE and withdrawals as SEND with priceUsd 0
//   (Kraken reports no fiat value for them); the lots they create carry a
//   zero basis until the user records the real value.
import { createHash, createHmac } from "node:crypto";
import { FIAT_QUOTES, num, type NormalizedTx } from "./types.js";

const API_BASE = "https://api.kraken.com";

/** Kraken's legacy asset codes → common tickers. */
const ASSET_MAP: Record<string, string> = {
  XXBT: "BTC", XBT: "BTC",
  XETH: "ETH", XLTC: "LTC", XXRP: "XRP", XXLM: "XLM",
  XZEC: "ZEC", XETC: "ETC", XREP: "REP", XMLN: "MLN", XDOGE: "DOGE",
  ZUSD: "USD", ZEUR: "EUR", ZGBP: "GBP", ZJPY: "JPY", ZCAD: "CAD", ZAUD: "AUD", ZCHF: "CHF",
};

/** Raw pair fragments Kraken concatenates into pair names like XXBTZUSD. */
const KNOWN_RAW = new Set([
  ...Object.keys(ASSET_MAP),
  "USD", "USDT", "USDC", "DAI", "EUR", "GBP", "JPY",
  "BTC", "ETH", "LTC", "XRP", "XLM", "ZEC", "ETC", "DOGE", "SOL", "ADA", "DOT",
  "ATOM", "LINK", "AVAX", "MATIC", "POL", "NEAR", "ALGO", "XTZ", "EOS", "TRX",
  "BCH", "BNB", "UNI", "AAVE", "FIL", "THETA", "VET", "HBAR", "ICP", "SAND",
  "MANA", "AXS", "GRT", "SNX", "CRV", "MKR", "COMP", "YFI", "SUSHI", "BAT",
  "ENJ", "CHZ", "ONE", "FTM", "EGLD", "KAVA", "FLOW", "MINA", "ROSE", "APE",
  "GMT", "OP", "ARB", "INJ", "TIA", "SEI", "SUI", "APT", "LDO", "RNDR", "PEPE",
  "WIF", "BONK", "JUP", "PYTH", "ONDO", "WLD", "FET", "TAO", "KAS", "TON",
]);

export function normalizeKrakenAsset(code: string): string {
  const upper = code.toUpperCase().split(".")[0] ?? code.toUpperCase();
  const mapped = ASSET_MAP[upper];
  if (mapped) return mapped;
  // 4-letter codes are usually a 3-letter code behind an X (crypto) or
  // Z (fiat) prefix, e.g. XEOS -> EOS.
  if (upper.length === 4 && (upper.startsWith("X") || upper.startsWith("Z"))) return upper.slice(1);
  return upper;
}

function parsePair(pair: string): { base: string; quote: string } | null {
  const upper = pair.toUpperCase();
  for (let i = 3; i <= upper.length - 3; i++) {
    const base = upper.slice(0, i);
    const quote = upper.slice(i);
    if (KNOWN_RAW.has(base) && KNOWN_RAW.has(quote)) {
      return { base: normalizeKrakenAsset(base), quote: normalizeKrakenAsset(quote) };
    }
  }
  return null;
}

let nonceCounter = 0;
function nextNonce(): string {
  const now = Date.now();
  nonceCounter = now > nonceCounter ? now : nonceCounter + 1;
  return String(nonceCounter);
}

async function krakenPost<T>(path: string, apiKey: string, apiSecret: string, params: Record<string, string>): Promise<T> {
  const nonce = nextNonce();
  const body = new URLSearchParams({ nonce, ...params }).toString();
  const digest = createHash("sha256").update(nonce + body).digest();
  const sign = createHmac("sha512", Buffer.from(apiSecret, "base64"))
    .update(Buffer.concat([Buffer.from(path, "utf8"), digest]))
    .digest("base64");
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "API-Key": apiKey, "API-Sign": sign, "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Kraken request failed (HTTP ${res.status}).`);
  const json = (await res.json()) as { error?: string[]; result?: T };
  if (json.error && json.error.length > 0) throw new Error(`Kraken: ${json.error.join(", ")}`);
  if (json.result === undefined) throw new Error("Kraken returned an empty result.");
  return json.result;
}

interface KrakenTrade {
  pair: string;
  time: number;
  type: string;
  price: string;
  fee: string;
  vol: string;
}

interface KrakenLedgerEntry {
  refid: string;
  time: number;
  type: string;
  asset: string;
  amount: string;
  fee: string;
}

export async function fetchTransactions(apiKey: string, apiSecret: string): Promise<NormalizedTx[]> {
  const txs: NormalizedTx[] = [];

  // --- Trades ---
  let ofs = 0;
  for (;;) {
    const result = await krakenPost<{ trades: Record<string, KrakenTrade>; count: number }>(
      "/0/private/TradesHistory", apiKey, apiSecret, { ofs: String(ofs), type: "all" },
    );
    const entries = Object.entries(result.trades ?? {});
    for (const [tradeId, trade] of entries) {
      const parsed = parsePair(trade.pair);
      if (!parsed) continue;
      const { base, quote } = parsed;
      if (!FIAT_QUOTES.has(quote) || FIAT_QUOTES.has(base)) continue;
      const amount = num(trade.vol);
      if (amount <= 0) continue;
      txs.push({
        externalId: tradeId,
        type: trade.type === "buy" ? "BUY" : "SELL",
        asset: base,
        amount,
        priceUsd: num(trade.price),
        feeUsd: num(trade.fee),
        occurredAt: new Date(trade.time * 1000),
      });
    }
    ofs += entries.length;
    if (entries.length === 0 || ofs >= (result.count ?? 0)) break;
  }

  // --- Deposits & withdrawals from the ledger ---
  for (const ledgerType of ["deposit", "withdrawal"] as const) {
    const grouped = new Map<string, NormalizedTx>();
    let ledgerOfs = 0;
    for (;;) {
      const result = await krakenPost<{ ledger: Record<string, KrakenLedgerEntry>; count: number }>(
        "/0/private/Ledgers", apiKey, apiSecret, { ofs: String(ledgerOfs), type: ledgerType },
      );
      const entries = Object.values(result.ledger ?? {});
      for (const entry of entries) {
        const asset = normalizeKrakenAsset(entry.asset);
        const rawAmount = num(entry.amount);
        if (rawAmount === 0) continue;
        // One refid can split into several entries (e.g. fee legs); merge.
        const key = `${entry.refid}:${asset}`;
        const feeUsd = asset === "USD" ? Math.abs(num(entry.fee)) : 0;
        const existing = grouped.get(key);
        if (existing) {
          existing.amount += Math.abs(rawAmount);
          existing.feeUsd += feeUsd;
        } else {
          grouped.set(key, {
            externalId: `ledger:${entry.refid}:${asset}`,
            type: ledgerType === "deposit" ? "RECEIVE" : "SEND",
            asset,
            amount: Math.abs(rawAmount),
            priceUsd: 0,
            feeUsd,
            occurredAt: new Date(entry.time * 1000),
          });
        }
      }
      ledgerOfs += entries.length;
      if (entries.length === 0 || ledgerOfs >= (result.count ?? 0)) break;
    }
    txs.push(...grouped.values());
  }

  return txs.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}
