import { fetchJsonWithRetry, ProviderError } from "../http.js";
import { BaseAdapter, rawToDecimal, type ActivityResult, type NormalizedTransfer, type TxStatus } from "./types.js";

// XRP Ledger via a public JSON-RPC endpoint. Only VALIDATED ledgers are
// read, so anything returned is final by construction (spec §7.4).

const RIPPLE_EPOCH_OFFSET = 946684800; // seconds between 1970 and 2000-01-01

interface XrplTxEntry {
  tx?: {
    hash?: string;
    ledger_index?: number;
    date?: number;
    TransactionType?: string;
    Account?: string;
    Destination?: string;
    Amount?: string | { currency: string; issuer: string; value: string };
  };
  meta?: { delivered_amount?: string | { currency: string; issuer: string; value: string } };
  validated?: boolean;
}

export class XrplAdapter extends BaseAdapter {
  chain = "xrp_ledger" as const;
  providerName = "Public XRPL JSON-RPC (xrplcluster.com)";
  private url = "https://xrplcluster.com/";
  private fallbackUrl = "https://s1.ripple.com:51234/";

  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<{ data: T; hash: string }> {
    try {
      return await this.rpcAt<T>(this.url, method, params);
    } catch (e) {
      // Public endpoints degrade independently; one fallback attempt against
      // Ripple's own server keeps a single sick cluster from stalling the
      // whole chain (spike, Nov 3, 2026).
      try {
        return await this.rpcAt<T>(this.fallbackUrl, method, params);
      } catch {
        throw e;
      }
    }
  }

  private async rpcAt<T>(url: string, method: string, params: Record<string, unknown>): Promise<{ data: T; hash: string }> {
    try {
      const { data, payloadHash } = await fetchJsonWithRetry<{ result: T }>(url, {
        body: { method, params: [params] },
      });
      this.markSuccess();
      return { data: data.result, hash: payloadHash };
    } catch (e) {
      this.markFailure(e, e instanceof ProviderError && e.rateLimited);
      throw e;
    }
  }

  async getLatestHeight(): Promise<number | null> {
    try {
      const { data } = await this.rpc<{ info?: { validated_ledger?: { seq?: number } } }>("server_info", {});
      return data.info?.validated_ledger?.seq ?? null;
    } catch {
      return null;
    }
  }

  async getAddressActivity(address: string): Promise<ActivityResult> {
    const { data, hash } = await this.rpc<{ transactions?: XrplTxEntry[]; ledger_index_max?: number }>("account_tx", {
      account: address,
      ledger_index_min: -1,
      ledger_index_max: -1,
      binary: false,
      limit: 200,
      forward: false,
    });
    const transfers: NormalizedTransfer[] = [];
    for (const entry of data.transactions ?? []) {
      const tx = entry.tx;
      if (!tx || !tx.hash || tx.TransactionType !== "Payment" || entry.validated === false) continue;
      const amount = entry.meta?.delivered_amount ?? tx.Amount;
      if (amount === undefined || amount === "unavailable") continue;
      const observedAt = tx.date !== undefined ? new Date((tx.date + RIPPLE_EPOCH_OFFSET) * 1000).toISOString() : new Date().toISOString();
      if (typeof amount === "string") {
        transfers.push({
          txHash: tx.hash, eventIndex: "payment:0", blockHeight: tx.ledger_index ?? null, observedAt,
          fromAddress: tx.Account ?? "", toAddress: tx.Destination ?? "",
          assetSymbol: "XRP", assetContract: null,
          amountRaw: amount, amountDecimal: rawToDecimal(amount, 6),
          confirmations: null, confirmed: true, finalized: true,
        });
      } else {
        transfers.push({
          txHash: tx.hash, eventIndex: "payment:0", blockHeight: tx.ledger_index ?? null, observedAt,
          fromAddress: tx.Account ?? "", toAddress: tx.Destination ?? "",
          assetSymbol: amount.currency.toUpperCase(), assetContract: amount.issuer,
          amountRaw: amount.value, amountDecimal: amount.value,
          confirmations: null, confirmed: true, finalized: true,
        });
      }
    }
    return { transfers, latestHeight: data.ledger_index_max ?? null, payloadHash: hash };
  }

  async getTransactionStatus(txHash: string, blockHeight: number | null): Promise<TxStatus> {
    try {
      const { data } = await this.rpc<{ validated?: boolean; ledger_index?: number }>("tx", { transaction: txHash, binary: false });
      const validated = data.validated === true;
      return { exists: true, blockHeight: data.ledger_index ?? blockHeight, confirmations: null, confirmed: validated, finalized: validated };
    } catch {
      return { exists: false, blockHeight, confirmations: null, confirmed: false, finalized: false };
    }
  }

  async getNativeBalance(address: string): Promise<{ balanceDecimal: string | null; height: number | null; payloadHash: string }> {
    try {
      const { data, hash } = await this.rpc<{ account_data?: { Balance?: string }; ledger_index_current?: number }>("account_info", {
        account: address, strict: true, ledger_index: "validated",
      });
      const bal = data.account_data?.Balance;
      return { balanceDecimal: bal ? rawToDecimal(bal, 6) : null, height: data.ledger_index_current ?? null, payloadHash: hash };
    } catch {
      return { balanceDecimal: null, height: null, payloadHash: "" };
    }
  }
}
