import { fetchJsonWithRetry, ProviderError } from "../http.js";
import { BaseAdapter, rawToDecimal, type ActivityResult, type NormalizedTransfer, type TxStatus } from "./types.js";

// Solana via the public mainnet JSON-RPC. Transfers are reconstructed from
// parsed system/token instructions; token accounts are mapped to their
// owners through the transaction's pre/post token balances.

interface ParsedInstruction {
  program?: string;
  parsed?: {
    type?: string;
    info?: {
      source?: string;
      destination?: string;
      lamports?: number;
      amount?: string;
      tokenAmount?: { amount: string; decimals: number; uiAmountString?: string };
      mint?: string;
      authority?: string;
    };
  };
}
interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}
interface SolTx {
  slot: number;
  blockTime?: number | null;
  meta?: {
    err?: unknown;
    preBalances?: number[];
    postBalances?: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    innerInstructions?: { instructions: ParsedInstruction[] }[];
  } | null;
  transaction?: {
    message?: {
      accountKeys?: ({ pubkey: string } | string)[];
      instructions?: ParsedInstruction[];
    };
  };
}

const MAX_DETAIL_FETCHES = 25;

export class SolanaAdapter extends BaseAdapter {
  chain = "solana" as const;
  providerName = "Solana public JSON-RPC (publicnode.com)";
  private url = process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";
  private rpcId = 1;

  private async rpc<T>(method: string, params: unknown[]): Promise<{ data: T; hash: string }> {
    try {
      const { data, payloadHash } = await fetchJsonWithRetry<{ result?: T; error?: { message: string } }>(this.url, {
        body: { jsonrpc: "2.0", id: this.rpcId++, method, params },
      });
      if (data.error) throw new ProviderError(`Solana RPC error: ${data.error.message}`);
      this.markSuccess();
      return { data: data.result as T, hash: payloadHash };
    } catch (e) {
      this.markFailure(e, e instanceof ProviderError && e.rateLimited);
      throw e;
    }
  }

  async getLatestHeight(): Promise<number | null> {
    try {
      const { data } = await this.rpc<number>("getSlot", [{ commitment: "finalized" }]);
      return typeof data === "number" ? data : null;
    } catch {
      return null;
    }
  }

  async getAddressActivity(address: string): Promise<ActivityResult> {
    const latest = await this.getLatestHeight();
    const { data: sigs, hash } = await this.rpc<{ signature: string; slot: number; blockTime?: number | null; err: unknown }[]>(
      "getSignaturesForAddress",
      [address, { limit: 100 }],
    );
    const transfers: NormalizedTransfer[] = [];
    const okSigs = (sigs ?? []).filter((s) => !s.err).slice(0, MAX_DETAIL_FETCHES);
    for (const sig of okSigs) {
      let tx: SolTx | null = null;
      try {
        const { data } = await this.rpc<SolTx | null>("getTransaction", [
          sig.signature,
          { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
        ]);
        tx = data;
      } catch {
        continue;
      }
      if (!tx || tx.meta?.err) continue;
      const keys = (tx.transaction?.message?.accountKeys ?? []).map((k) => (typeof k === "string" ? k : k.pubkey));
      const observedAt = (sig.blockTime ?? tx.blockTime) ? new Date((sig.blockTime ?? tx.blockTime!) * 1000).toISOString() : new Date().toISOString();
      const confirmations = latest !== null ? Math.max(0, latest - tx.slot) : null;
      const statusFields = {
        txHash: sig.signature,
        blockHeight: tx.slot,
        observedAt,
        confirmations,
        confirmed: confirmations !== null && confirmations >= 32,
        finalized: false,
      };
      const ownerOf = (account: string): string => {
        const idx = keys.indexOf(account);
        if (idx < 0) return account;
        const tb = [...(tx!.meta?.postTokenBalances ?? []), ...(tx!.meta?.preTokenBalances ?? [])].find((b) => b.accountIndex === idx);
        return tb?.owner ?? account;
      };
      const allInstructions: ParsedInstruction[] = [
        ...(tx.transaction?.message?.instructions ?? []),
        ...(tx.meta?.innerInstructions ?? []).flatMap((g) => g.instructions),
      ];
      let n = 0;
      for (const ix of allInstructions) {
        const info = ix.parsed?.info;
        if (!ix.parsed || !info) continue;
        if (ix.program === "system" && ix.parsed.type === "transfer" && info.source && info.destination && info.lamports) {
          if (info.source !== address && info.destination !== address) continue;
          transfers.push({
            ...statusFields,
            eventIndex: `parsed:${n++}`,
            fromAddress: info.source,
            toAddress: info.destination,
            assetSymbol: "SOL",
            assetContract: null,
            amountRaw: String(info.lamports),
            amountDecimal: rawToDecimal(String(info.lamports), 9),
          });
        } else if (
          (ix.program === "spl-token" || ix.program === "spl-associated-token-account") &&
          (ix.parsed.type === "transfer" || ix.parsed.type === "transferChecked") &&
          info.source && info.destination
        ) {
          const from = ownerOf(info.source);
          const to = ownerOf(info.destination);
          if (from !== address && to !== address) continue;
          const amount = info.tokenAmount?.amount ?? info.amount;
          const decimals = info.tokenAmount?.decimals ?? 0;
          if (!amount) continue;
          transfers.push({
            ...statusFields,
            eventIndex: `parsed:${n++}`,
            fromAddress: from,
            toAddress: to,
            assetSymbol: "TOKEN",
            assetContract: info.mint ?? null,
            amountRaw: amount,
            amountDecimal: rawToDecimal(amount, decimals),
          });
        }
      }
      // Token symbols: resolve from token balance entries when a mint is known.
      for (const t of transfers) {
        if (t.txHash === sig.signature && t.assetContract) {
          const tb = (tx.meta?.postTokenBalances ?? []).find((b) => b.mint === t.assetContract);
          if (tb) t.assetSymbol = t.assetSymbol === "TOKEN" ? "TOKEN" : t.assetSymbol;
        }
      }
    }
    return { transfers, latestHeight: latest, payloadHash: hash };
  }

  async getTransactionStatus(txHash: string, blockHeight: number | null): Promise<TxStatus> {
    try {
      const { data } = await this.rpc<{ value?: { confirmationStatus?: string; slot?: number }[] }>("getSignatureStatuses", [[txHash], { searchTransactionHistory: true }]);
      const st = data.value?.[0];
      if (!st) return { exists: false, blockHeight, confirmations: null, confirmed: false, finalized: false };
      const latest = await this.getLatestHeight();
      const slot = st.slot ?? blockHeight;
      const confirmations = latest !== null && slot !== null ? Math.max(0, latest - slot) : null;
      return {
        exists: true,
        blockHeight: slot,
        confirmations,
        confirmed: st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized",
        finalized: st.confirmationStatus === "finalized",
      };
    } catch {
      return { exists: false, blockHeight, confirmations: null, confirmed: false, finalized: false };
    }
  }

  async getNativeBalance(address: string): Promise<{ balanceDecimal: string | null; height: number | null; payloadHash: string }> {
    try {
      const { data, hash } = await this.rpc<{ value?: number }>("getBalance", [address]);
      const height = await this.getLatestHeight();
      return { balanceDecimal: typeof data.value === "number" ? rawToDecimal(String(data.value), 9) : null, height, payloadHash: hash };
    } catch {
      return { balanceDecimal: null, height: null, payloadHash: "" };
    }
  }
}
