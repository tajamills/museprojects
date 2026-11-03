import { createHash } from "node:crypto";
import { fetchJsonWithRetry, ProviderError } from "../http.js";
import { BaseAdapter, rawToDecimal, type ActivityResult, type NormalizedTransfer, type TxStatus } from "./types.js";

// TRON via TronGrid's public API. A free TRON-PRO-API-KEY (TRON_GRID_API_KEY)
// raises the limits; the adapter works without one at reduced rate.

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function tronHexToBase58(hex: string): string {
  const bytes = Buffer.from(hex, "hex");
  const checksum = createHash("sha256").update(createHash("sha256").update(bytes).digest()).digest().subarray(0, 4);
  const full = Buffer.concat([bytes, checksum]);
  let zeros = 0;
  while (zeros < full.length && full[zeros] === 0) zeros++;
  let num = BigInt("0x" + full.toString("hex"));
  let out = "";
  while (num > 0n) {
    const rem = Number(num % 58n);
    out = B58_ALPHABET[rem] + out;
    num = num / 58n;
  }
  return "1".repeat(zeros) + out;
}

export function tronBase58ToHex(b58: string): string {
  let num = 0n;
  for (const ch of b58) {
    const idx = B58_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid base58");
    num = num * 58n + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const bytes = Buffer.from(hex, "hex");
  // strip 4-byte checksum
  return bytes.subarray(0, bytes.length - 4).toString("hex");
}

interface TronTx {
  txID: string;
  blockNumber?: number;
  block_timestamp?: number;
  raw_data?: {
    contract?: { type: string; parameter?: { value?: { amount?: number; owner_address?: string; to_address?: string } } }[];
  };
}
interface TronTrc20 {
  transaction_id: string;
  block_timestamp?: number;
  block_number?: number;
  from: string;
  to: string;
  value: string;
  type: string;
  token_info: { symbol: string; address: string; decimals: number };
}

export class TronAdapter extends BaseAdapter {
  chain = "tron" as const;
  providerName = "TronGrid public API";
  private base = "https://api.trongrid.io";
  private headers: Record<string, string>;

  constructor() {
    super();
    const key = (process.env.TRON_GRID_API_KEY ?? "").trim();
    this.headers = key ? { "TRON-PRO-API-KEY": key } : {};
    this.providerName = key ? "TronGrid API (free key)" : "TronGrid public API (no key)";
  }

  private async call<T>(path: string, body?: unknown): Promise<{ data: T; hash: string }> {
    try {
      const { data, payloadHash } = await fetchJsonWithRetry<T>(`${this.base}${path}`, { headers: this.headers, body, timeoutMs: 30_000, retries: 1 });
      this.markSuccess();
      return { data, hash: payloadHash };
    } catch (e) {
      this.markFailure(e, e instanceof ProviderError && e.rateLimited);
      throw e;
    }
  }

  async getLatestHeight(): Promise<number | null> {
    try {
      const { data } = await this.call<{ block_header?: { raw_data?: { number?: number } } }>("/wallet/getnowblock", {});
      return data.block_header?.raw_data?.number ?? null;
    } catch {
      return null;
    }
  }

  async getAddressActivity(address: string): Promise<ActivityResult> {
    const latest = await this.getLatestHeight();
    const transfers: NormalizedTransfer[] = [];
    let payloadHash = "";

    const native = await this.call<{ data?: TronTx[] }>(
      `/v1/accounts/${address}/transactions?limit=100&order_by=block_timestamp,desc`,
    );
    payloadHash = native.hash;
    for (const tx of native.data.data ?? []) {
      const contract = tx.raw_data?.contract?.[0];
      if (!contract || contract.type !== "TransferContract") continue;
      const v = contract.parameter?.value;
      if (!v || !v.amount || !v.owner_address || !v.to_address) continue;
      const block = tx.blockNumber ?? null;
      const confirmations = latest !== null && block !== null ? Math.max(0, latest - block) : null;
      transfers.push({
        txHash: tx.txID,
        eventIndex: "transfer:0",
        blockHeight: block,
        observedAt: tx.block_timestamp ? new Date(tx.block_timestamp).toISOString() : new Date().toISOString(),
        fromAddress: tronHexToBase58(v.owner_address),
        toAddress: tronHexToBase58(v.to_address),
        assetSymbol: "TRX",
        assetContract: null,
        amountRaw: String(v.amount),
        amountDecimal: rawToDecimal(String(v.amount), 6),
        confirmations,
        confirmed: confirmations !== null && confirmations >= 19,
        finalized: confirmations !== null && confirmations >= 19,
      });
    }

    const trc20 = await this.call<{ data?: TronTrc20[] }>(
      `/v1/accounts/${address}/transactions/trc20?limit=100&order_by=block_timestamp,desc`,
    );
    const byHash = new Map<string, TronTrc20[]>();
    for (const t of trc20.data.data ?? []) {
      if (t.type !== "Transfer") continue;
      const arr = byHash.get(t.transaction_id) ?? [];
      arr.push(t);
      byHash.set(t.transaction_id, arr);
    }
    for (const [hash, rows] of byHash) {
      rows.sort((a, b) => `${a.token_info.address}|${a.from}|${a.to}|${a.value}`.localeCompare(`${b.token_info.address}|${b.from}|${b.to}|${b.value}`));
      rows.forEach((t, i) => {
        const block = t.block_number ?? null;
        const confirmations = latest !== null && block !== null ? Math.max(0, latest - block) : null;
        transfers.push({
          txHash: hash,
          eventIndex: `trc20:${i}`,
          blockHeight: block,
          observedAt: t.block_timestamp ? new Date(t.block_timestamp).toISOString() : new Date().toISOString(),
          fromAddress: t.from,
          toAddress: t.to,
          assetSymbol: (t.token_info.symbol ?? "TRC20").toUpperCase(),
          assetContract: t.token_info.address,
          amountRaw: t.value,
          amountDecimal: rawToDecimal(t.value, t.token_info.decimals ?? 6),
          confirmations,
          confirmed: confirmations !== null && confirmations >= 19,
          finalized: confirmations !== null && confirmations >= 19,
        });
      });
    }

    return { transfers, latestHeight: latest, payloadHash };
  }

  async getTransactionStatus(_txHash: string, blockHeight: number | null): Promise<TxStatus> {
    const latest = await this.getLatestHeight();
    if (latest === null || blockHeight === null) {
      return { exists: blockHeight !== null, blockHeight, confirmations: null, confirmed: false, finalized: false };
    }
    const confirmations = Math.max(0, latest - blockHeight);
    return { exists: true, blockHeight, confirmations, confirmed: confirmations >= 19, finalized: confirmations >= 19 };
  }

  async getNativeBalance(address: string): Promise<{ balanceDecimal: string | null; height: number | null; payloadHash: string }> {
    try {
      const hex = tronBase58ToHex(address);
      const { data, hash } = await this.call<{ balance?: number }>("/wallet/getaccount", { address: hex });
      const height = await this.getLatestHeight();
      return { balanceDecimal: data.balance !== undefined ? rawToDecimal(String(data.balance), 6) : "0", height, payloadHash: hash };
    } catch {
      return { balanceDecimal: null, height: null, payloadHash: "" };
    }
  }
}
