// Real TikTok (TikTok Login Kit + Content Posting API) OAuth + video publishing.
//
// One owner TikTok app covers the whole site (TIKTOK_CLIENT_KEY +
// TIKTOK_CLIENT_SECRET env vars); customers just hit Connect. Per-user
// tokens live encrypted in tiktok_connections.
//
// Flow:
//   1. connectTikTok action builds an auth URL (buildTikTokAuthUrl) and
//      stores a single-use CSRF state in oauth_states.
//   2. GET /oauth/tiktok/callback verifies the state, exchanges the code
//      for tokens (access ~24h + refresh ~365d), fetches the TikTok user
//      info, and stores everything AES-256-GCM encrypted.
//   3. Publishing is FILE_UPLOAD direct post (no domain verification needed):
//      POST /v2/post/publish/video/init/ {post_info, source_info} ->
//      PUT {upload_url} binary -> poll POST /v2/post/publish/status/fetch/
//      until PUBLISH_COMPLETE.
//   4. Access tokens expire after ~24h; getValidTikTokToken() refreshes
//      transparently via the stored refresh token (rotation-aware).
//
// TikTok ONLY supports video — no text-only or image posts. The composer
// and createPost enforce this; publish.ts fails the target as a second layer.
//
// IMPORTANT GOTCHA: unaudited TikTok apps can only direct-post to
// SELF_ONLY (private). PUBLIC_TO_EVERYONE requires passing TikTok's app
// audit. We default to SELF_ONLY so posting works immediately; the owner
// can flip to PUBLIC after audit by changing DEFAULT_PRIVACY_LEVEL.

import { eq } from "drizzle-orm";
import { decryptToken, encryptToken, requireTokenEncryption } from "./facebook.js";
import type { Db } from "./db.js";
import * as schema from "./schema.js";
import { resolvePlatformSecret } from "./secrets.js";

export { decryptToken, encryptToken, requireTokenEncryption };

/** Scopes requested at OAuth time. Comma-separated per TikTok docs. */
export const TIKTOK_OAUTH_SCOPES = [
  "user.info.basic",
  "video.upload",
  "video.publish",
] as const;

/** Privacy level for direct posts. SELF_ONLY until the TikTok app passes audit. */
export const DEFAULT_PRIVACY_LEVEL = "SELF_ONLY";

export class TikTokApiError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "TikTokApiError";
    this.code = code;
  }
}

type FetchFn = typeof fetch;

const TIKTOK_API_BASE = process.env.TIKTOK_SANDBOX === "true"
  ? "https://open-sandbox.tiktokapis.com/v2"
  : "https://open.tiktokapis.com/v2";

function tiktokUrl(path: string): string {
  return `${TIKTOK_API_BASE}${path}`;
}

/** Throw on TikTok's {error:{code:"ok"}} envelope or HTTP errors. */
async function tiktokRequest(
  method: "GET" | "POST",
  path: string,
  accessToken: string,
  body?: unknown,
  fetchFn: FetchFn = fetch,
): Promise<any> {
  const res = await fetchFn(tiktokUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    // fall through to error below
  }
  if (!res.ok) {
    const msg = parsed?.error?.message ?? `TikTok request failed (HTTP ${res.status}).`;
    throw new TikTokApiError(msg, parsed?.error?.code);
  }
  const code = parsed?.error?.code;
  if (code && code !== "ok") {
    throw new TikTokApiError(parsed?.error?.message ?? `TikTok error: ${code}`, code);
  }
  return parsed?.data ?? parsed;
}

/** True when the client key looks like a real TikTok client key (not a demo placeholder). */
export function isRealTikTokConfig(clientKey: string, hasSecret: boolean): boolean {
  const key = (clientKey ?? "").trim();
  return hasSecret && key.length > 0 && !key.startsWith("DEMO_");
}

/** Redirect URI for TikTok OAuth. Override with TIKTOK_REDIRECT_URI. */
export function tiktokRedirectUri(origin: string | null): string {
  const override = (process.env.TIKTOK_REDIRECT_URI ?? "").trim();
  if (override) return override;
  const raw = (process.env.APP_BASE_URL ?? origin ?? "http://localhost:3000").trim();
  return `${raw.replace(/\/+$/, "")}/oauth/tiktok/callback`;
}

export function buildTikTokAuthUrl(args: { clientKey: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_key: args.clientKey,
    response_type: "code",
    scope: TIKTOK_OAUTH_SCOPES.join(","),
    redirect_uri: args.redirectUri,
    state: args.state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

export interface TikTokTokenSet {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  openId: string;
  scope: string;
}

/** Exchange an authorization code for tokens. Form-encoded per TikTok docs. */
export async function exchangeTikTokCode(
  args: { clientKey: string; clientSecret: string; redirectUri: string; code: string },
  fetchFn: FetchFn = fetch,
): Promise<TikTokTokenSet> {
  const form = new URLSearchParams({
    client_key: args.clientKey,
    client_secret: args.clientSecret,
    code: args.code,
    grant_type: "authorization_code",
    redirect_uri: args.redirectUri,
  });
  const res = await fetchFn(tiktokUrl("/oauth/token/"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !body.access_token) {
    throw new TikTokApiError(
      body?.error_description ?? body?.error ?? "TikTok did not return an access token.",
    );
  }
  return {
    accessToken: String(body.access_token),
    expiresIn: Number(body.expires_in ?? 86400),
    refreshToken: String(body.refresh_token ?? ""),
    refreshExpiresIn: Number(body.refresh_expires_in ?? 31536000),
    openId: String(body.open_id ?? ""),
    scope: String(body.scope ?? ""),
  };
}

/** Refresh an access token. TikTok may rotate the refresh token — persist the new one. */
export async function refreshTikTokToken(
  args: { clientKey: string; clientSecret: string; refreshToken: string },
  fetchFn: FetchFn = fetch,
): Promise<TikTokTokenSet> {
  const form = new URLSearchParams({
    client_key: args.clientKey,
    client_secret: args.clientSecret,
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
  });
  const res = await fetchFn(tiktokUrl("/oauth/token/"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !body.access_token) {
    throw new TikTokApiError(
      body?.error_description ?? body?.error ?? "TikTok token refresh failed.",
    );
  }
  return {
    accessToken: String(body.access_token),
    expiresIn: Number(body.expires_in ?? 86400),
    refreshToken: String(body.refresh_token ?? args.refreshToken),
    refreshExpiresIn: Number(body.refresh_expires_in ?? 31536000),
    openId: String(body.open_id ?? ""),
    scope: String(body.scope ?? ""),
  };
}

export interface TikTokUserInfo {
  openId: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Fetch the connected TikTok user's profile. */
export async function getTikTokUserInfo(
  accessToken: string,
  fetchFn: FetchFn = fetch,
): Promise<TikTokUserInfo> {
  const data = await tiktokRequest(
    "GET",
    "/user/info/?fields=open_id,display_name,avatar_url",
    accessToken,
    undefined,
    fetchFn,
  );
  const user = data?.user ?? data;
  if (!user?.open_id) throw new TikTokApiError("TikTok did not return user info.");
  return {
    openId: String(user.open_id),
    displayName: String(user.display_name ?? "TikTok user"),
    avatarUrl: user.avatar_url ? String(user.avatar_url) : null,
  };
}

export interface TikTokPublishResult {
  publishId: string;
}

/** Step 1: init a direct video post (FILE_UPLOAD). Returns publish_id + upload_url. */
async function initVideoPost(
  accessToken: string,
  caption: string,
  videoSize: number,
  fetchFn: FetchFn = fetch,
): Promise<{ publishId: string; uploadUrl: string }> {
  const data = await tiktokRequest(
    "POST",
    "/post/publish/video/init/",
    accessToken,
    {
      post_info: {
        title: caption.slice(0, 2200),
        privacy_level: DEFAULT_PRIVACY_LEVEL,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSize,
        chunk_size: videoSize,
        total_chunk_count: 1,
      },
    },
    fetchFn,
  );
  if (!data?.publish_id || !data?.upload_url) {
    throw new TikTokApiError("TikTok did not return an upload URL.");
  }
  return { publishId: String(data.publish_id), uploadUrl: String(data.upload_url) };
}

/** Step 2: upload the video binary in a single chunk. */
async function uploadVideoChunk(
  uploadUrl: string,
  video: Buffer,
  fetchFn: FetchFn = fetch,
): Promise<void> {
  const res = await fetchFn(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(video.byteLength),
      "Content-Range": `bytes 0-${video.byteLength - 1}/${video.byteLength}`,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: video as any,
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new TikTokApiError(`TikTok video upload failed (HTTP ${res.status}).`);
  }
}

/** Step 3: poll publish status until terminal. */
async function pollPublishStatus(
  accessToken: string,
  publishId: string,
  fetchFn: FetchFn = fetch,
): Promise<void> {
  const deadline = Date.now() + 120_000;
  let delay = 5_000;
  for (;;) {
    const data = await tiktokRequest(
      "POST",
      "/post/publish/status/fetch/",
      accessToken,
      { publish_id: publishId },
      fetchFn,
    );
    const status = String(data?.status ?? "");
    if (status === "PUBLISH_COMPLETE" || status === "SEND_TO_USER_INBOX") return;
    if (status === "FAILED") {
      throw new TikTokApiError(`TikTok publish failed: ${data?.fail_reason ?? "unknown reason"}`);
    }
    if (Date.now() > deadline) {
      throw new TikTokApiError("Timed out waiting for TikTok to process the video.");
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(Math.round(delay * 1.5), 15_000);
  }
}

/**
 * Full direct-post flow: init → upload → poll. Returns the publish_id.
 * Caption becomes the video title (max 2200 chars).
 */
export async function publishTikTokVideo(
  args: { accessToken: string; caption: string; video: Buffer },
  fetchFn: FetchFn = fetch,
): Promise<TikTokPublishResult> {
  if (args.video.byteLength === 0) throw new TikTokApiError("Video is empty.");
  const { publishId, uploadUrl } = await initVideoPost(
    args.accessToken,
    args.caption,
    args.video.byteLength,
    fetchFn,
  );
  await uploadVideoChunk(uploadUrl, args.video, fetchFn);
  await pollPublishStatus(args.accessToken, publishId, fetchFn);
  return { publishId };
}

/**
 * Returns a valid TikTok access token for the user, refreshing transparently
 * when the stored one is expired (or expiring within 5 minutes). Persists
 * rotated refresh tokens. Needs the owner app credentials for refresh.
 * Throws with a clear message on failure.
 */
export async function getValidTikTokAccessToken(
  db: Db,
  userId: number,
  ownerCreds: { clientId: string; clientSecret: string },
): Promise<string> {
  const rows = await db.select().from(schema.tiktokConnections).where(eq(schema.tiktokConnections.userId, userId)).limit(1);
  const conn = rows[0];
  if (!conn) throw new Error("TikTok is not connected with real OAuth. Reconnect the channel.");
  let accessToken: string;
  let refreshToken: string;
  try {
    accessToken = decryptToken(conn.accessTokenEncrypted);
    refreshToken = decryptToken(conn.refreshTokenEncrypted);
  } catch {
    throw new Error("The stored TikTok token could not be decrypted. Reconnect the channel.");
  }
  const needsRefresh = conn.expiresAt.getTime() - Date.now() < 5 * 60 * 1000;
  if (!needsRefresh) return accessToken;
  const refreshed = await refreshTikTokToken({
    clientKey: ownerCreds.clientId,
    clientSecret: ownerCreds.clientSecret,
    refreshToken,
  });
  const now = new Date();
  await db.update(schema.tiktokConnections).set({
    accessTokenEncrypted: encryptToken(refreshed.accessToken),
    refreshTokenEncrypted: encryptToken(refreshed.refreshToken),
    expiresAt: new Date(now.getTime() + refreshed.expiresIn * 1000),
    updatedAt: now,
  }).where(eq(schema.tiktokConnections.userId, userId));
  return refreshed.accessToken;
}

export type TikTokAppCreds = { ok: true; clientId: string; clientSecret: string } | { ok: false; missing: string };

/**
 * Owner TikTok app credentials from env (TIKTOK_CLIENT_KEY +
 * TIKTOK_CLIENT_SECRET). One app for the whole site; customers just Connect.
 * Per-user platform_configs rows are ignored for tiktok.
 */
export function ownerTikTokCredentials(): TikTokAppCreds {
  const sandbox = process.env.TIKTOK_SANDBOX === "true";
  const clientId = (sandbox
    ? (process.env.TIKTOK_SANDBOX_CLIENT_KEY ?? "")
    : (process.env.TIKTOK_CLIENT_KEY ?? "")).trim();
  const clientSecret = sandbox
    ? (process.env.TIKTOK_SANDBOX_CLIENT_SECRET ?? "").trim()
    : resolvePlatformSecret("tiktok");
  if (!clientId || clientId.startsWith("DEMO_")) return { ok: false, missing: "app-id" };
  if (!clientSecret) return { ok: false, missing: "app-secret" };
  return { ok: true, clientId, clientSecret: clientSecret as string };
}

/** Boolean only — never leaks values. Used for the admin status line. */
export function isTikTokAppConfigured(): boolean {
  return ownerTikTokCredentials().ok;
}
