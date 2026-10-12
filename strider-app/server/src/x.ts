// Real X (Twitter) OAuth 2.0 + tweet posting.
//
// One X app owned by the site owner serves all customers: customers never
// create an X app and never enter a Client ID or secret — they just click
// Connect on the Accounts page and OAuth in. The owner's Client ID comes
// from X_CLIENT_ID and the secret from X_CLIENT_SECRET (see secrets.ts).
//
// Flow:
//   1. connectX action generates a PKCE pair (generateCodeVerifier /
//      generateCodeChallenge), stores the verifier with the single-use CSRF
//      state in oauth_states.code_verifier, and redirects to
//      https://twitter.com/i/oauth2/authorize.
//   2. GET /oauth/x/callback verifies the state, exchanges the code for
//      tokens (confidential client: Basic auth on the token endpoint +
//      the stored code_verifier), fetches the X user, and stores the
//      AES-256-GCM encrypted tokens in x_connections.
//   3. Publishing is POST /2/tweets { text }. X access tokens live ~2
//      hours; offline.access yields a refresh token, and publish.ts
//      refreshes before posting when the stored token is expired.
//
// Scopes: tweet.read tweet.write users.read offline.access.
//
// CRITICAL COST GOTCHA (verified against X docs 2026-10-11): X moved new
// developers to pay-per-use pricing in Feb 2026 — the free tier is closed
// to new signups. Posting costs credits per tweet (post create ≈ $0.015,
// posts with a URL ≈ $0.20 as of Apr 2026). Every customer tweet bills the
// OWNER's X developer account. The owner must fund credits in the X
// Developer Console before any real tweet goes out. See the report.

import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { decryptToken, encryptToken, requireTokenEncryption } from "./facebook.js";
import type { Db } from "./db.js";
import * as schema from "./schema.js";
import { resolvePlatformSecret } from "./secrets.js";

export { decryptToken, encryptToken, requireTokenEncryption };

export type XAppCreds = { ok: true; clientId: string; clientSecret: string } | { ok: false; missing: string };

/**
 * Owner-level X OAuth credentials. ONE X app for the whole site: Client ID
 * from X_CLIENT_ID, secret from X_CLIENT_SECRET. Customers never configure
 * these — they just click Connect and OAuth in with X.
 *
 * NOTE (owner): X moved new developers to pay-per-use pricing (Feb 2026) —
 * there is no free tier for new apps. Every tweet posted bills the owner's
 * X developer account credits (post create ≈ $0.015; with a URL ≈ $0.20).
 * Fund credits in the X Developer Console before real posting.
 */
export function ownerXCredentials(): XAppCreds {
  const clientId = (process.env.X_CLIENT_ID ?? "").trim();
  const clientSecret = resolvePlatformSecret("x");
  if (!clientId || clientId.startsWith("DEMO_")) return { ok: false, missing: "app-id" };
  if (!clientSecret) return { ok: false, missing: "app-secret" };
  return { ok: true, clientId, clientSecret: clientSecret as string };
}

/** Boolean only — never leaks values. Used for the admin status line. */
export function isXAppConfigured(): boolean {
  return ownerXCredentials().ok;
}

/** OAuth 2.0 scopes requested at authorize time. */
export const X_OAUTH_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
] as const;

/** Max tweet length for a non-Premium authoring account. */
export const X_MAX_TWEET_LENGTH = 280;

export class XApiError extends Error {
  readonly code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "XApiError";
    this.code = code;
  }
}

type FetchFn = typeof fetch;

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * PKCE code_verifier: 43-128 chars of high entropy per RFC 7636.
 * 64 random bytes -> 86 base64url chars. Pure — unit-tested.
 */
export function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(64)).slice(0, 128);
}

/** PKCE S256 code_challenge = base64url(sha256(verifier)). Pure — unit-tested. */
export function generateCodeChallenge(verifier: string): string {
  return base64UrlEncode(createHash("sha256").update(verifier, "utf8").digest());
}

const X_AUTHORIZE_URL = "https://twitter.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const X_API_BASE = "https://api.twitter.com/2";

/** The OAuth callback URL the owner must register in the X developer
 *  portal (OAuth 2.0 settings -> Callback URI / Redirect URL).
 *  X_REDIRECT_URI, when set, is used verbatim; otherwise it is derived
 *  from APP_BASE_URL. */
export function xRedirectUri(origin: string | null): string {
  const override = (process.env.X_REDIRECT_URI ?? "").trim().replace(/\/+$/, "");
  if (override) return override;
  const raw = (process.env.APP_BASE_URL || origin || "http://localhost:3000").replace(/\/+$/, "");
  return `${raw}/oauth/x/callback`;
}

export function buildXAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    scope: X_OAUTH_SCOPES.join(" "),
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${X_AUTHORIZE_URL}?${params.toString()}`;
}

/** Decides whether the stored config means "real OAuth" or the simulated
 *  fallback. Pure — unit-tested. */
export function isRealXConfig(clientId: string, hasSecret: boolean): boolean {
  const id = (clientId ?? "").trim();
  return id.length > 0 && !id.startsWith("DEMO_") && hasSecret;
}

export interface XTokenPair {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds until the access token expires (X issues ~2h tokens). */
  expiresIn: number;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

function readOAuthError(body: any, httpStatus: number): string {
  if (body?.error_description) return String(body.error_description);
  if (body?.error) return String(body.error);
  const errs = body?.errors;
  if (Array.isArray(errs) && errs.length > 0 && errs[0]?.message) return String(errs[0].message);
  return `HTTP ${httpStatus}`;
}

async function tokenRequest(
  args: { clientId: string; clientSecret: string; params: Record<string, string> },
  fetchFn: FetchFn = fetch,
): Promise<XTokenPair> {
  let res: Response;
  try {
    res = await fetchFn(X_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: basicAuthHeader(args.clientId, args.clientSecret),
      },
      body: new URLSearchParams(args.params).toString(),
    });
  } catch (err) {
    throw new XApiError(`X token request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    throw new XApiError(`X returned a non-JSON token response (HTTP ${res.status}).`);
  }
  if (!res.ok || !body?.access_token) {
    throw new XApiError(`X token exchange failed: ${readOAuthError(body, res.status)}`);
  }
  return {
    accessToken: String(body.access_token),
    refreshToken: body.refresh_token ? String(body.refresh_token) : null,
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : 7200,
  };
}

/** Exchanges an authorization code (+ the stored PKCE verifier) for tokens. */
export async function exchangeXCodeForToken(
  args: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
  },
  fetchFn: FetchFn = fetch,
): Promise<XTokenPair> {
  return tokenRequest(
    {
      clientId: args.clientId,
      clientSecret: args.clientSecret,
      params: {
        grant_type: "authorization_code",
        code: args.code,
        redirect_uri: args.redirectUri,
        code_verifier: args.codeVerifier,
      },
    },
    fetchFn,
  );
}

/** Refreshes an expired access token. X rotates refresh tokens, so the
 *  caller must persist the returned pair. */
export async function refreshXToken(
  args: { clientId: string; clientSecret: string; refreshToken: string },
  fetchFn: FetchFn = fetch,
): Promise<XTokenPair> {
  return tokenRequest(
    {
      clientId: args.clientId,
      clientSecret: args.clientSecret,
      params: { grant_type: "refresh_token", refresh_token: args.refreshToken },
    },
    fetchFn,
  );
}

async function xApiRequest(
  method: "GET" | "POST",
  path: string,
  accessToken: string,
  jsonBody: Record<string, unknown> | null,
  fetchFn: FetchFn = fetch,
): Promise<any> {
  let res: Response;
  try {
    res = await fetchFn(`${X_API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(jsonBody ? { "content-type": "application/json" } : {}),
      },
      ...(jsonBody ? { body: JSON.stringify(jsonBody) } : {}),
    });
  } catch (err) {
    throw new XApiError(`X request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    throw new XApiError(`X returned a non-JSON response (HTTP ${res.status}).`);
  }
  if (!res.ok || body?.errors) {
    const err0 = Array.isArray(body?.errors) ? body.errors[0] : null;
    throw new XApiError(
      `X error: ${err0?.message ?? body?.detail ?? `HTTP ${res.status}`}`,
      typeof err0?.code === "number" ? err0.code : undefined,
    );
  }
  return body;
}

export interface XUserInfo {
  id: string;
  username: string;
  name: string;
}

/** GET /2/users/me — the authorizing X account. */
export async function getXUserInfo(accessToken: string, fetchFn: FetchFn = fetch): Promise<XUserInfo> {
  const body = await xApiRequest("GET", "/users/me", accessToken, null, fetchFn);
  const data = body?.data;
  if (!data?.id) throw new XApiError("X did not return the user profile.");
  return {
    id: String(data.id),
    username: String(data.username ?? data.id),
    name: String(data.name ?? data.username ?? data.id),
  };
}

/** POST /2/tweets — publishes a tweet. Returns the tweet id. */
export async function postTweet(
  args: { accessToken: string; text: string },
  fetchFn: FetchFn = fetch,
): Promise<{ tweetId: string }> {
  if (args.text.length > X_MAX_TWEET_LENGTH) {
    throw new XApiError(`Tweet is ${args.text.length} characters; X allows ${X_MAX_TWEET_LENGTH}.`);
  }
  const body = await xApiRequest("POST", "/tweets", args.accessToken, { text: args.text }, fetchFn);
  const id = body?.data?.id;
  if (!id) throw new XApiError("X did not return a tweet id.");
  return { tweetId: String(id) };
}

/**
 * Returns a valid X access token for the user, refreshing transparently
 * when the stored one is expired (or expiring within 5 minutes). Persists
 * rotated refresh tokens. Throws with a clear message on failure.
 */
export async function getValidXAccessToken(
  db: Db,
  userId: number,
  ownerCreds: { clientId: string; clientSecret: string },
): Promise<string> {
  const rows = await db.select().from(schema.xConnections).where(eq(schema.xConnections.userId, userId)).limit(1);
  const conn = rows[0];
  if (!conn) throw new Error("X is not connected with real OAuth. Reconnect the channel.");
  let accessToken: string;
  let refreshToken: string | null;
  try {
    accessToken = decryptToken(conn.accessTokenEncrypted);
    refreshToken = conn.refreshTokenEncrypted ? decryptToken(conn.refreshTokenEncrypted) : null;
  } catch {
    throw new Error("The stored X token could not be decrypted. Reconnect the channel.");
  }
  const needsRefresh = !conn.expiresAt || conn.expiresAt.getTime() - Date.now() < 5 * 60 * 1000;
  if (!needsRefresh) return accessToken;
  if (!refreshToken) throw new Error("The X session expired and cannot be refreshed. Reconnect the channel.");
  let refreshed: XTokenPair;
  try {
    refreshed = await refreshXToken({
      clientId: ownerCreds.clientId,
      clientSecret: ownerCreds.clientSecret,
      refreshToken,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/invalid_grant|revoked/i.test(msg)) {
      throw new Error("X access was revoked. Reconnect the channel.");
    }
    throw new Error(`X token refresh failed: ${msg}`);
  }
  const now = new Date();
  await db
    .update(schema.xConnections)
    .set({
      accessTokenEncrypted: encryptToken(refreshed.accessToken),
      refreshTokenEncrypted: refreshed.refreshToken ? encryptToken(refreshed.refreshToken) : conn.refreshTokenEncrypted,
      expiresAt: new Date(now.getTime() + refreshed.expiresIn * 1000),
      updatedAt: now,
    })
    .where(eq(schema.xConnections.userId, userId));
  return refreshed.accessToken;
}
