// Plaid bank connections for Books (Phase 2) — read-only and opt-in.
//
// ENV GATING: the feature exists only when PLAID_CLIENT_ID, PLAID_SECRET
// and PLAID_ENV are all present in the server environment. When they are
// absent, plaidConfigured() is false, the actions refuse cleanly, and the
// client never renders the connect option — Phase 1 (manual + CSV) is
// completely untouched. Only read-only data products are ever requested
// (Transactions, plus account balances through the Balance endpoints);
// no payment or money-movement endpoint exists in this module.
//
// Token storage: Plaid access tokens are encrypted at rest with
// AES-256-GCM under TOKEN_ENCRYPTION_KEY — the same scheme the owner's
// Zepostia app uses for its OAuth tokens (strider-app/server/src/
// facebook.ts): "iv:ciphertext:tag" hex, failing closed when the key is
// unset or malformed. A plaintext token exists only in memory during a
// Plaid call; it is never returned to the client and never logged.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function plaidConfigured(): boolean {
  return Boolean(
    process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET && process.env.PLAID_ENV,
  );
}

function plaidBaseUrl(): string {
  return process.env.PLAID_ENV === "production"
    ? "https://production.plaid.com"
    : "https://sandbox.plaid.com";
}

// ---------------------------------------------------------------------------
// Token encryption at rest (AES-256-GCM) — ported 1:1 from the Zepostia
// pattern so both of the owner's apps store third-party tokens the same way.
// ---------------------------------------------------------------------------

function encryptionKey(): Buffer {
  const hex = (process.env.TOKEN_ENCRYPTION_KEY ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be set to 64 hex characters (32 bytes). Generate one with: openssl rand -hex 32",
    );
  }
  return Buffer.from(hex, "hex");
}

/** True when an access token could actually be stored/loaded right now. */
export function tokenEncryptionReady(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptToken(plaintext: string): string {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${ciphertext.toString("hex")}:${tag.toString("hex")}`;
}

export function decryptToken(payload: string): string {
  const key = encryptionKey();
  const [ivHex, ctHex, tagHex] = (payload ?? "").split(":");
  if (!ivHex || !ctHex || !tagHex) throw new Error("Stored token is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------
// Minimal Plaid API client (plain JSON POSTs, credentials in the body —
// the same shape as the Zepostia app's raw Graph API client; no SDK).
// ---------------------------------------------------------------------------

interface PlaidErrorBody {
  error_code?: string;
  error_message?: string;
}

async function plaidRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${plaidBaseUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
  });
  const json = (await response.json().catch(() => ({}))) as PlaidErrorBody & T;
  if (!response.ok) {
    // Plaid's error payload never contains the access token or secret.
    throw new Error(
      `Plaid request failed (${json.error_code ?? response.status}): ${json.error_message ?? "unknown error"}`,
    );
  }
  return json;
}

export interface PlaidAccountInfo {
  account_id: string;
  name: string;
  mask: string | null;
  balance_cents: number | null;
}

interface PlaidRawAccount {
  account_id: string;
  name?: string;
  official_name?: string | null;
  mask?: string | null;
  balances?: { current?: number | null; iso_currency_code?: string | null };
}

function toAccountInfo(raw: PlaidRawAccount): PlaidAccountInfo {
  return {
    account_id: raw.account_id,
    name: raw.official_name || raw.name || "Account",
    mask: raw.mask ?? null,
    balance_cents:
      typeof raw.balances?.current === "number" ? Math.round(raw.balances.current * 100) : null,
  };
}

export async function createPlaidLinkToken(clientUserId: string): Promise<{ linkToken: string }> {
  const res = await plaidRequest<{ link_token: string }>("/link/token/create", {
    user: { client_user_id: clientUserId },
    client_name: "Kovala",
    products: ["transactions"],
    country_codes: ["US"],
    language: "en",
  });
  return { linkToken: res.link_token };
}

export async function exchangePlaidPublicToken(
  publicToken: string,
): Promise<{ accessToken: string; itemId: string }> {
  const res = await plaidRequest<{ access_token: string; item_id: string }>(
    "/item/public_token/exchange",
    { public_token: publicToken },
  );
  return { accessToken: res.access_token, itemId: res.item_id };
}

export async function getPlaidInstitutionName(accessToken: string): Promise<string | null> {
  try {
    const item = await plaidRequest<{ item?: { institution_id?: string | null } }>("/item/get", {
      access_token: accessToken,
    });
    const institutionId = item.item?.institution_id;
    if (!institutionId) return null;
    const inst = await plaidRequest<{ institution?: { name?: string } }>(
      "/institutions/get_by_id",
      { institution_id: institutionId, country_codes: ["US"] },
    );
    return inst.institution?.name ?? null;
  } catch {
    return null;
  }
}

export async function getPlaidAccounts(accessToken: string): Promise<PlaidAccountInfo[]> {
  const res = await plaidRequest<{ accounts?: PlaidRawAccount[] }>("/accounts/get", {
    access_token: accessToken,
  });
  return (res.accounts ?? []).map(toAccountInfo);
}

/** Real-time balances (Balance data) for every account on the item. */
export async function getPlaidBalances(accessToken: string): Promise<PlaidAccountInfo[]> {
  const res = await plaidRequest<{ accounts?: PlaidRawAccount[] }>("/accounts/balance/get", {
    access_token: accessToken,
  });
  return (res.accounts ?? []).map(toAccountInfo);
}

export interface PlaidSyncTransaction {
  transaction_id: string;
  date: string;
  name: string;
  /** Plaid sign convention: positive = money OUT of the account. */
  amount: number;
  pending: boolean;
  pending_transaction_id?: string | null;
}

export interface PlaidSyncPage {
  added: PlaidSyncTransaction[];
  modified: PlaidSyncTransaction[];
  removed: { transaction_id: string }[];
  nextCursor: string;
  hasMore: boolean;
}

export async function syncPlaidTransactions(
  accessToken: string,
  cursor?: string,
): Promise<PlaidSyncPage> {
  const res = await plaidRequest<{
    added?: PlaidSyncTransaction[];
    modified?: PlaidSyncTransaction[];
    removed?: { transaction_id: string }[];
    next_cursor: string;
    has_more: boolean;
  }>("/transactions/sync", {
    access_token: accessToken,
    ...(cursor ? { cursor } : {}),
    count: 500,
  });
  return {
    added: res.added ?? [],
    modified: res.modified ?? [],
    removed: res.removed ?? [],
    nextCursor: res.next_cursor,
    hasMore: res.has_more,
  };
}

export async function removePlaidItem(accessToken: string): Promise<void> {
  await plaidRequest("/item/remove", { access_token: accessToken });
}
