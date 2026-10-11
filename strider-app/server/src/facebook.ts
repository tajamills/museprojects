// Real Facebook (Meta Graph API) OAuth + Page publishing.
//
// Flow:
//   1. connectFacebook action builds an auth URL (buildFacebookAuthUrl) and
//      stores a single-use CSRF state in oauth_states.
//   2. GET /oauth/facebook/callback verifies the state, exchanges the code
//      for a short-lived user token, upgrades it to a long-lived token
//      (~60 days), and fetches the Pages the user manages.
//   3. The first Page is auto-selected; its Page access token (effectively
//      non-expiring for the Page) is stored AES-256-GCM encrypted.
//   4. Publishing posts to POST /{page-id}/feed with the Page token.
//
// Nothing here logs or returns raw tokens. The app secret comes from
// FACEBOOK_CLIENT_SECRET (see secrets.ts); per-user tokens live encrypted
// in facebook_connections.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Pinned Graph API version (v26.0 verified current as of Oct 2026). */
export const FB_API_VERSION = "v26.0";

/** Permissions requested at OAuth time. Both require App Review before the
 *  app leaves development mode; in dev mode they work for app admins,
 *  developers, and testers immediately. */
export const FB_OAUTH_SCOPES = ["pages_manage_posts", "pages_read_engagement"] as const;

export class FacebookApiError extends Error {
  readonly code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "FacebookApiError";
    this.code = code;
  }
}

type FetchFn = typeof fetch;

function graphUrl(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params);
  return `https://graph.facebook.com/${FB_API_VERSION}${path}?${qs.toString()}`;
}

async function graphRequest(
  method: "GET" | "POST",
  path: string,
  params: Record<string, string>,
  fetchFn: FetchFn = fetch,
): Promise<any> {
  const url = graphUrl(path, method === "GET" ? params : {});
  const init: RequestInit =
    method === "GET"
      ? { method }
      : { method, headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() };
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch (err) {
    throw new FacebookApiError(`Facebook request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    throw new FacebookApiError(`Facebook returned a non-JSON response (HTTP ${res.status}).`);
  }
  if (!res.ok || body?.error) {
    const err = body?.error ?? {};
    throw new FacebookApiError(
      `Facebook error: ${err.message ?? `HTTP ${res.status}`}${err.code ? ` (code ${err.code})` : ""}`,
      typeof err.code === "number" ? err.code : undefined,
    );
  }
  return body;
}

/** The OAuth callback URL the owner must register in the Facebook app
 *  (Valid OAuth Redirect URIs). FACEBOOK_REDIRECT_URI, when set, is used
 *  verbatim; otherwise it is derived from APP_BASE_URL. */
export function facebookRedirectUri(origin: string | null): string {
  const override = (process.env.FACEBOOK_REDIRECT_URI ?? "").trim().replace(/\/+$/, "");
  if (override) return override;
  const raw = (process.env.APP_BASE_URL || origin || "http://localhost:3000").replace(/\/+$/, "");
  return `${raw}/oauth/facebook/callback`;
}

export function buildFacebookAuthUrl(args: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
    response_type: "code",
    scope: FB_OAUTH_SCOPES.join(","),
  });
  return `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth?${params.toString()}`;
}

/** Decides whether the stored config means "real OAuth" or the simulated
 *  fallback. Pure — unit-tested. */
export function isRealFacebookConfig(clientId: string, hasSecret: boolean): boolean {
  const id = (clientId ?? "").trim();
  return id.length > 0 && !id.startsWith("DEMO_") && hasSecret;
}

export async function exchangeCodeForToken(
  args: { clientId: string; clientSecret: string; redirectUri: string; code: string },
  fetchFn: FetchFn = fetch,
): Promise<{ accessToken: string; expiresIn: number }> {
  const body = await graphRequest("GET", "/oauth/access_token", {
    client_id: args.clientId,
    client_secret: args.clientSecret,
    redirect_uri: args.redirectUri,
    code: args.code,
  }, fetchFn);
  if (!body.access_token) throw new FacebookApiError("Facebook did not return an access token.");
  return { accessToken: String(body.access_token), expiresIn: Number(body.expires_in ?? 0) };
}

/** Upgrades a short-lived user token to a long-lived one (~60 days). */
export async function exchangeForLongLivedToken(
  args: { clientId: string; clientSecret: string; shortLivedToken: string },
  fetchFn: FetchFn = fetch,
): Promise<{ accessToken: string; expiresIn: number }> {
  const body = await graphRequest("GET", "/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: args.clientId,
    client_secret: args.clientSecret,
    fb_exchange_token: args.shortLivedToken,
  }, fetchFn);
  if (!body.access_token) throw new FacebookApiError("Facebook did not return a long-lived access token.");
  return { accessToken: String(body.access_token), expiresIn: Number(body.expires_in ?? 0) };
}

export interface FacebookPage {
  id: string;
  name: string;
  accessToken: string;
}

/** Pages the user manages, each with its Page access token. */
export async function getManagedPages(userAccessToken: string, fetchFn: FetchFn = fetch): Promise<FacebookPage[]> {
  const body = await graphRequest("GET", "/me/accounts", {
    fields: "id,name,access_token",
    access_token: userAccessToken,
  }, fetchFn);
  const data = Array.isArray(body.data) ? body.data : [];
  return data
    .filter((p: any) => p?.id && p?.access_token)
    .map((p: any) => ({ id: String(p.id), name: String(p.name ?? p.id), accessToken: String(p.access_token) }));
}

/** App-scoped user id for the token owner. */
export async function getFacebookUserId(userAccessToken: string, fetchFn: FetchFn = fetch): Promise<string> {
  const body = await graphRequest("GET", "/me", { fields: "id", access_token: userAccessToken }, fetchFn);
  if (!body.id) throw new FacebookApiError("Facebook did not return a user id.");
  return String(body.id);
}

/** Publishes a text post to a Page feed. Returns the Facebook post id
 *  ("{page-id}_{post-id}"). */
export async function publishPagePost(
  args: { pageId: string; pageAccessToken: string; message: string },
  fetchFn: FetchFn = fetch,
): Promise<{ facebookPostId: string }> {
  const body = await graphRequest("POST", `/${encodeURIComponent(args.pageId)}/feed`, {
    message: args.message,
    access_token: args.pageAccessToken,
  }, fetchFn);
  if (!body.id) throw new FacebookApiError("Facebook did not return a post id.");
  return { facebookPostId: String(body.id) };
}

/** Publishes a comment (Post Bump) on a Facebook post. */
export async function publishPageComment(
  args: { facebookPostId: string; pageAccessToken: string; message: string },
  fetchFn: FetchFn = fetch,
): Promise<{ commentId: string }> {
  const body = await graphRequest("POST", `/${encodeURIComponent(args.facebookPostId)}/comments`, {
    message: args.message,
    access_token: args.pageAccessToken,
  }, fetchFn);
  if (!body.id) throw new FacebookApiError("Facebook did not return a comment id.");
  return { commentId: String(body.id) };
}

// ---------------------------------------------------------------------------
// Token encryption at rest (AES-256-GCM). Key material never leaves this
// module; only "iv:ciphertext:tag" hex strings are stored.
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

/** Throws when TOKEN_ENCRYPTION_KEY is missing/malformed — fail closed. */
export function requireTokenEncryption(): void {
  encryptionKey();
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
