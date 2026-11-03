import { fetchJsonWithRetry, ProviderError } from "../http.js";
import { BaseAdapter, rawToDecimal, type ActivityResult, type NormalizedTransfer, type TxStatus } from "./types.js";

// Bitcoin via a public Esplora instance (mempool.space by default; no key).
// Esplora exposes address transaction history, per-transaction status and
// the chain tip — everything §7.1 requires for Bitcoin.

interface EsploraTx {
  txid: string;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
  vin: { prevout?: { scriptpubkey_address?: string; value?: number } }[];
  vout: { scriptpubkey_address?: string; value?: number }[];
}
interface EsploraAddress {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
}

export class BitcoinAdapter extends BaseAdapter {
  chain = "bitcoin" as const;
  providerName = "Esplora public API (mempool.space, no key)";
  private base: string;

  constructor() {
    super();
    this.base = (process.env.ESPLORA_BASE_URL ?? "https://mempool.space/api").replace(/\/$/, "");
  }

  private async get<T>(path: string): Promise<{ data: T; hash: string }> {
    try {
      const { data, payloadHash } = await fetchJsonWithRetry<T>(`${this.base}${path}`);
      this.markSuccess();
      return { data, hash: payloadHash };
    } catch (e) {
      this.markFailure(e, e instanceof ProviderError && e.rateLimited);
      throw e;
    }
  }

  async getLatestHeight(): Promise<number | null> {
    try {
      const { data } = await this.get<string>("/blocks/tip/height");
      const n = parseInt(String(data), 10);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  async getAddressActivity(address: string): Promise<ActivityResult> {
    const tip = await this.getLatestHeight();
    const { data: txs, hash } = await this.get<EsploraTx[]>(`/address/${address}/txs`);
    const transfers: NormalizedTransfer[] = [];
    for (const tx of txs ?? []) {
      const spendsFromWatched = tx.vin.some((v) => v.prevout?.scriptpubkey_address === address);
      const blockHeight = tx.status.confirmed ? (tx.status.block_height ?? null) : null;
      const confirmations = tx.status.confirmed && tip !== null && blockHeight !== null ? Math.max(0, tip - blockHeight + 1) : 0;
      const observedAt = tx.status.block_time ? new Date(tx.status.block_time * 1000).toISOString() : new Date().toISOString();
      tx.vout.forEach((out, i) => {
        const to = out.scriptpubkey_address;
        if (!to || !out.value) return;
        if (to === address) {
          const sender = tx.vin.find((v) => v.prevout?.scriptpubkey_address)?.prevout?.scriptpubkey_address ?? "";
          transfers.push({
            txHash: tx.txid, eventIndex: `vout:${i}`, blockHeight, observedAt,
            fromAddress: sender, toAddress: to, assetSymbol: "BTC", assetContract: null,
            amountRaw: String(out.value), amountDecimal: rawToDecimal(String(out.value), 8),
            confirmations, confirmed: confirmations >= 3, finalized: confirmations >= 6,
          });
        } else if (spendsFromWatched) {
          transfers.push({
            txHash: tx.txid, eventIndex: `vout:${i}`, blockHeight, observedAt,
            fromAddress: address, toAddress: to, assetSymbol: "BTC", assetContract: null,
            amountRaw: String(out.value), amountDecimal: rawToDecimal(String(out.value), 8),
            confirmations, confirmed: confirmations >= 3, finalized: confirmations >= 6,
          });
        }
      });
    }
    return { transfers, latestHeight: tip, payloadHash: hash };
  }

  async getTransactionStatus(txHash: string, blockHeight: number | null): Promise<TxStatus> {
    try {
      const { data } = await this.get<EsploraTx>(`/tx/${txHash}`);
      const tip = await this.getLatestHeight();
      const bh = data.status.confirmed ? (data.status.block_height ?? blockHeight) : null;
      const confirmations = data.status.confirmed && tip !== null && bh !== null ? Math.max(0, tip - bh + 1) : 0;
      return { exists: true, blockHeight: bh, confirmations, confirmed: confirmations >= 3, finalized: confirmations >= 6 };
    } catch {
      return { exists: false, blockHeight, confirmations: null, confirmed: false, finalized: false };
    }
  }

  async getNativeBalance(address: string): Promise<{ balanceDecimal: string | null; height: number | null; payloadHash: string }> {
    try {
      const { data, hash } = await this.get<EsploraAddress>(`/address/${address}`);
      const sats = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
      const height = await this.getLatestHeight();
      return { balanceDecimal: rawToDecimal(String(sats), 8), height, payloadHash: hash };
    } catch {
      return { balanceDecimal: null, height: null, payloadHash: "" };
    }
  }
}
