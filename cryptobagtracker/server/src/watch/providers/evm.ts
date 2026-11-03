import { fetchJsonWithRetry, ProviderError } from "../http.js";
import { BaseAdapter, rawToDecimal, type ActivityResult, type NormalizedTransfer, type TxStatus, type WatchChain } from "./types.js";

// Etherscan-compatible explorer API. Default (no key) uses the public
// Blockscout instances, which speak the same module/action interface; when
// ETHERSCAN_API_KEY is configured, Etherscan's v2 multichain endpoint is
// used instead. Both are free tiers; see the Phase 0 spike report for the
// measured limits.

interface ExplorerRow {
  blockNumber?: string;
  timeStamp?: string;
  hash?: string;
  from?: string;
  to?: string;
  value?: string;
  contractAddress?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  transactionIndex?: string;
  isError?: string;
}
interface ExplorerResp {
  status: string;
  message: string;
  result: ExplorerRow[] | string;
}

const CONFIG: Record<string, { chainId: number; blockscout: string; native: string }> = {
  ethereum: { chainId: 1, blockscout: "https://eth.blockscout.com/api", native: "ETH" },
  arbitrum: { chainId: 42161, blockscout: "https://arbitrum.blockscout.com/api", native: "ETH" },
};

export class EvmAdapter extends BaseAdapter {
  chain: WatchChain;
  providerName: string;
  private base: string;
  private native: string;

  private cfg: { chainId: number; blockscout: string; native: string };
  private keyed: boolean;
  private heightCache: { value: number; at: number } | null = null;

  constructor(chain: "ethereum" | "arbitrum") {
    super();
    this.chain = chain;
    const cfg = CONFIG[chain];
    this.cfg = cfg;
    this.native = cfg.native;
    const key = (process.env.ETHERSCAN_API_KEY ?? "").trim();
    this.keyed = Boolean(key);
    if (key) {
      this.base = `https://api.etherscan.io/v2/api?chainid=${cfg.chainId}&apikey=${key}`;
      this.providerName = "Etherscan v2 (free key)";
    } else {
      this.base = cfg.blockscout;
      this.providerName = "Blockscout public API (no key)";
    }
  }

  private async call(params: Record<string, string>): Promise<{ rows: ExplorerRow[]; hash: string }> {
    const qs = new URLSearchParams(params).toString();
    const sep = this.base.includes("?") ? "&" : "?";
    try {
      const { data, payloadHash } = await fetchJsonWithRetry<ExplorerResp>(`${this.base}${sep}${qs}`);
      this.markSuccess();
      if (typeof data.result === "string") {
        if (/no transactions found/i.test(data.result) || /no token/i.test(data.result)) return { rows: [], hash: payloadHash };
        if (data.status === "0") throw new ProviderError(`Explorer error: ${data.result}`);
        return { rows: [], hash: payloadHash };
      }
      return { rows: data.result ?? [], hash: payloadHash };
    } catch (e) {
      this.markFailure(e, e instanceof ProviderError && e.rateLimited);
      throw e;
    }
  }

  async getLatestHeight(): Promise<number | null> {
    if (this.heightCache && Date.now() - this.heightCache.at < 20_000) return this.heightCache.value;
    try {
      if (!this.keyed) {
        // Blockscout's Etherscan-compat proxy action rejects eth_blockNumber;
        // its v2 REST blocks endpoint gives the tip instead (spike, Nov 3).
        const origin = this.cfg.blockscout.replace(/\/api$/, "");
        const { data } = await fetchJsonWithRetry<{ items?: { height?: number }[] }>(
          `${origin}/api/v2/blocks`,
        );
        this.markSuccess();
        const h = data.items?.[0]?.height ?? null;
        if (h !== null) this.heightCache = { value: h, at: Date.now() };
        return h;
      }
      const qs = new URLSearchParams({ module: "proxy", action: "eth_blockNumber" }).toString();
      const sep = this.base.includes("?") ? "&" : "?";
      const { data } = await fetchJsonWithRetry<{ result?: string }>(`${this.base}${sep}${qs}`);
      this.markSuccess();
      const h = data.result ? parseInt(data.result, 16) : null;
      if (h !== null) this.heightCache = { value: h, at: Date.now() };
      return h;
    } catch (e) {
      this.markFailure(e, e instanceof ProviderError && e.rateLimited);
      return null;
    }
  }

  async getAddressActivity(address: string): Promise<ActivityResult> {
    const latest = await this.getLatestHeight();
    const conf = (block: number | null) => (latest !== null && block !== null ? Math.max(0, latest - block) : null);
    const transfers: NormalizedTransfer[] = [];
    let payloadHash = "";

    const native = await this.call({
      module: "account", action: "txlist", address, startblock: "0", endblock: "999999999",
      page: "1", offset: "100", sort: "desc",
    });
    payloadHash = native.hash;
    for (const r of native.rows) {
      if (!r.hash || !r.value || r.value === "0" || r.isError === "1") continue;
      const block = r.blockNumber ? parseInt(r.blockNumber, 10) : null;
      const c = conf(block);
      transfers.push({
        txHash: r.hash,
        eventIndex: `native:${r.transactionIndex ?? "0"}`,
        blockHeight: block,
        observedAt: r.timeStamp ? new Date(parseInt(r.timeStamp, 10) * 1000).toISOString() : new Date().toISOString(),
        fromAddress: (r.from ?? "").toLowerCase(),
        toAddress: (r.to ?? "").toLowerCase(),
        assetSymbol: this.native,
        assetContract: null,
        amountRaw: r.value,
        amountDecimal: rawToDecimal(r.value, 18),
        confirmations: c,
        confirmed: c !== null && c >= 12,
        finalized: c !== null && c >= 64,
      });
    }

    const internal = await this.call({
      module: "account", action: "txlistinternal", address, startblock: "0", endblock: "999999999",
      page: "1", offset: "100", sort: "desc",
    });
    const internalByHash = new Map<string, ExplorerRow[]>();
    for (const r of internal.rows) {
      if (!r.hash || !r.value || r.value === "0" || r.isError === "1") continue;
      const arr = internalByHash.get(r.hash) ?? [];
      arr.push(r);
      internalByHash.set(r.hash, arr);
    }
    for (const [hash, rows] of internalByHash) {
      rows.sort((a, b) => `${a.from}|${a.to}|${a.value}`.localeCompare(`${b.from}|${b.to}|${b.value}`));
      rows.forEach((r, i) => {
        const block = r.blockNumber ? parseInt(r.blockNumber, 10) : null;
        const c = conf(block);
        transfers.push({
          txHash: hash,
          eventIndex: `internal:${i}`,
          blockHeight: block,
          observedAt: r.timeStamp ? new Date(parseInt(r.timeStamp, 10) * 1000).toISOString() : new Date().toISOString(),
          fromAddress: (r.from ?? "").toLowerCase(),
          toAddress: (r.to ?? "").toLowerCase(),
          assetSymbol: this.native,
          assetContract: null,
          amountRaw: r.value ?? "0",
          amountDecimal: rawToDecimal(r.value ?? "0", 18),
          confirmations: c,
          confirmed: c !== null && c >= 12,
          finalized: c !== null && c >= 64,
        });
      });
    }

    const tokens = await this.call({
      module: "account", action: "tokentx", address, startblock: "0", endblock: "999999999",
      page: "1", offset: "100", sort: "desc",
    });
    const tokenByHash = new Map<string, ExplorerRow[]>();
    for (const r of tokens.rows) {
      if (!r.hash || !r.value || r.value === "0") continue;
      const arr = tokenByHash.get(r.hash) ?? [];
      arr.push(r);
      tokenByHash.set(r.hash, arr);
    }
    for (const [hash, rows] of tokenByHash) {
      rows.sort((a, b) =>
        `${a.contractAddress}|${a.from}|${a.to}|${a.value}`.localeCompare(`${b.contractAddress}|${b.from}|${b.to}|${b.value}`),
      );
      rows.forEach((r, i) => {
        const block = r.blockNumber ? parseInt(r.blockNumber, 10) : null;
        const c = conf(block);
        const decimals = r.tokenDecimal ? parseInt(r.tokenDecimal, 10) : 18;
        transfers.push({
          txHash: hash,
          eventIndex: `tokentx:${i}`,
          blockHeight: block,
          observedAt: r.timeStamp ? new Date(parseInt(r.timeStamp, 10) * 1000).toISOString() : new Date().toISOString(),
          fromAddress: (r.from ?? "").toLowerCase(),
          toAddress: (r.to ?? "").toLowerCase(),
          assetSymbol: (r.tokenSymbol ?? "TOKEN").toUpperCase(),
          assetContract: (r.contractAddress ?? "").toLowerCase() || null,
          amountRaw: r.value ?? "0",
          amountDecimal: rawToDecimal(r.value ?? "0", decimals),
          confirmations: c,
          confirmed: c !== null && c >= 12,
          finalized: c !== null && c >= 64,
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
    return {
      exists: true,
      blockHeight,
      confirmations,
      confirmed: confirmations >= 12,
      finalized: confirmations >= 64,
    };
  }

  async getNativeBalance(address: string): Promise<{ balanceDecimal: string | null; height: number | null; payloadHash: string }> {
    const { rows, hash } = await this.call({ module: "account", action: "balance", address, tag: "latest" }).catch(() => ({ rows: [] as ExplorerRow[], hash: "" }));
    // balance returns result as a string, handled in call() as rows=[]; re-fetch raw:
    void rows;
    try {
      const qs = new URLSearchParams({ module: "account", action: "balance", address, tag: "latest" }).toString();
      const sep = this.base.includes("?") ? "&" : "?";
      const { data, payloadHash } = await fetchJsonWithRetry<ExplorerResp>(`${this.base}${sep}${qs}`);
      const height = await this.getLatestHeight();
      const raw = typeof data.result === "string" ? data.result : null;
      return { balanceDecimal: raw ? rawToDecimal(raw, 18) : null, height, payloadHash };
    } catch {
      return { balanceDecimal: null, height: null, payloadHash: hash };
    }
  }
}
