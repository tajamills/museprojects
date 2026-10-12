// Coinbase Advanced Trade API client (CDP API keys, JWT ES256 auth).
//
// The API key field holds the CDP key name
// ("organizations/{org}/apiKeys/{id}") and the secret field holds the EC
// private key PEM. Each request gets a short-lived JWT signed with
// node:crypto — the signature must be raw R||S (ieee-p1363), not DER.
//
// Data: GET /api/v3/brokerage/orders/historical/fills, cursor-paginated.
// Only fills on USD/USDT/USDC/DAI-quoted products are imported, and only
// fills carrying an explicit BUY/SELL side; conversions and crypto-crypto
// products carry no USD price and are skipped.
import { createPrivateKey, createSign, randomBytes } from "node:crypto";
import { FIAT_QUOTES, num, type NormalizedTx } from "./types.js";

const HOST = "api.coinbase.com";
const FILLS_PATH = "/api/v3/brokerage/orders/historical/fills";

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function buildJwt(keyName: string, pemRaw: string, method: string, pathWithQuery: string): string {
  // Keys are often pasted with literal "\n" escapes instead of newlines.
  const pem = pemRaw.includes("\\n") ? pemRaw.replace(/\\n/g, "\n") : pemRaw;
  let key;
  try {
    key = createPrivateKey(pem.trim());
  } catch {
    throw new Error("Coinbase private key could not be parsed. Paste the full EC private key PEM from your CDP API key.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyName, nonce: randomBytes(16).toString("hex"), typ: "JWT" };
  const payload = { sub: keyName, iss: "cdp", nbf: now, exp: now + 120, uri: `${method} ${HOST}${pathWithQuery}` };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign({ key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64url(signature)}`;
}

interface CoinbaseFill {
  entry_id?: string;
  trade_id?: string;
  order_id?: string;
  trade_time?: string;
  trade_type?: string;
  price?: string;
  size?: string;
  commission?: string;
  product_id?: string;
  side?: string;
  size_in_quote?: boolean;
}

export async function fetchTransactions(apiKey: string, apiSecret: string): Promise<NormalizedTx[]> {
  const keyName = apiKey.trim();
  const txs: NormalizedTx[] = [];
  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams({ limit: "250" });
    if (cursor) params.set("cursor", cursor);
    const path = `${FILLS_PATH}?${params.toString()}`;
    const jwt = buildJwt(keyName, apiSecret, "GET", path);
    const res = await fetch(`https://${HOST}${path}`, {
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`Coinbase request failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
    }
    const json = (await res.json()) as { fills?: CoinbaseFill[]; cursor?: string };
    const fills = json.fills ?? [];
    for (const fill of fills) {
      if ((fill.trade_type ?? "FILL") !== "FILL") continue;
      const side = (fill.side ?? "").toUpperCase();
      if (side !== "BUY" && side !== "SELL") continue;
      const [base, quote] = (fill.product_id ?? "").split("-");
      if (!base || !quote || !FIAT_QUOTES.has(quote) || FIAT_QUOTES.has(base)) continue;
      const price = num(fill.price);
      const rawSize = num(fill.size);
      if (price <= 0 || rawSize <= 0) continue;
      const amount = fill.size_in_quote ? rawSize / price : rawSize;
      txs.push({
        externalId: fill.entry_id ?? `${fill.trade_id ?? ""}:${fill.order_id ?? ""}`,
        type: side,
        asset: base.toUpperCase(),
        amount,
        priceUsd: price,
        feeUsd: num(fill.commission),
        occurredAt: fill.trade_time ? new Date(fill.trade_time) : new Date(),
      });
    }
    cursor = json.cursor;
    if (!cursor || fills.length === 0) break;
  }

  return txs.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}
