// Real YouTube (YouTube Data API v3) OAuth + video upload.
//
// Flow:
//   1. connectYoutube action builds an auth URL (buildYoutubeAuthUrl) and
//      stores a single-use CSRF state in oauth_states.
//   2. GET /oauth/youtube/callback verifies the state, exchanges the code
//      for tokens (access_type=offline so Google returns a refresh_token),
//      fetches the channel via channels?mine=true, and stores everything
//      AES-256-GCM encrypted.
//   3. Publishing is a resumable upload:
//      POST /upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
//      -> Location header (upload session URL)
//      PUT video bytes to the session URL -> { id } (the YouTube video id)
//   4. Access tokens expire after ~1 hour; the refresh token is used to mint
//      new ones (refreshAccessToken). publish.ts refreshes opportunistically
//      before upload and updates the stored row.
//
// YouTube ONLY supports video uploads — no text-only, no images. The
// composer and createPost enforce "video + title"; publish.ts fails the
// target with a clear message as a second layer.
//
// Owner model (same as Meta): ONE Google Cloud OAuth client for the whole
// site. YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET live in env; customers
// never configure anything — they just click Connect.
//
// Gotchas the owner must know:
//   - The YouTube Data API has a default quota of 10,000 units/day; one
//     video upload costs ~1,600 units (so ~6 uploads/day on the free quota).
//     Quota increases are requested in Google Cloud Console.
//   - The OAuth consent screen must pass Google verification before the app
//     leaves testing mode; unverified apps show a warning screen and are
//     limited to 100 test users.

import { decryptToken, encryptToken, requireTokenEncryption } from "./facebook.js";

export { decryptToken, encryptToken, requireTokenEncryption };

/** Permissions requested at OAuth time. youtube.upload covers uploads;
 *  youtube.readonly lets us read the channel (id + title) at connect time.
 *  youtube.force-ssl powers the 24-hour post bump's follow-up comments
 *  (commentThreads.insert accepts no lesser scope); connections made
 *  before it was added must reconnect to grant it. The upload and
 *  force-ssl scopes are "sensitive" and need Google verification before
 *  production use; in testing mode they work for test users immediately. */
export const YT_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
] as const;

export class YoutubeApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "YoutubeApiError";
    this.status = status;
  }
}

type FetchFn = typeof fetch;

/** The OAuth callback URL the owner must register in the Google Cloud
 *  OAuth client (Authorized redirect URIs). YOUTUBE_REDIRECT_URI, when set,
 *  is used verbatim; otherwise it is derived from APP_BASE_URL. */
export function youtubeRedirectUri(origin: string | null): string {
  const override = (process.env.YOUTUBE_REDIRECT_URI ?? "").trim().replace(/\/+$/, "");
  if (override) return override;
  const raw = (process.env.APP_BASE_URL || origin || "http://localhost:3000").replace(/\/+$/, "");
  return `${raw}/oauth/youtube/callback`;
}

export function buildYoutubeAuthUrl(args: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
    response_type: "code",
    scope: YT_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Decides whether the stored config means "real OAuth" or the simulated
 *  fallback. Pure — unit-tested. */
export function isRealYoutubeConfig(clientId: string, hasSecret: boolean): boolean {
  const id = (clientId ?? "").trim();
  return id.length > 0 && !id.startsWith("DEMO_") && hasSecret;
}

export interface YoutubeTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
}

async function tokenRequest(
  params: Record<string, string>,
  fetchFn: FetchFn,
): Promise<YoutubeTokens> {
  let res: Response;
  try {
    res = await fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
  } catch (err) {
    throw new YoutubeApiError(`YouTube token request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    throw new YoutubeApiError(`YouTube token endpoint returned a non-JSON response (HTTP ${res.status}).`, res.status);
  }
  if (!res.ok || body?.error) {
    throw new YoutubeApiError(
      `YouTube token error: ${body?.error_description ?? body?.error ?? `HTTP ${res.status}`}`,
      res.status,
    );
  }
  if (!body.access_token) throw new YoutubeApiError("YouTube did not return an access token.");
  return {
    accessToken: String(body.access_token),
    refreshToken: body.refresh_token ? String(body.refresh_token) : null,
    expiresIn: Number(body.expires_in ?? 3600),
  };
}

/** Exchanges an authorization code for access + refresh tokens. */
export function exchangeCodeForTokens(
  args: { clientId: string; clientSecret: string; redirectUri: string; code: string },
  fetchFn: FetchFn = fetch,
): Promise<YoutubeTokens> {
  return tokenRequest(
    {
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
      code: args.code,
      grant_type: "authorization_code",
    },
    fetchFn,
  );
}

/** Mints a fresh access token from a stored refresh token. */
export function refreshAccessToken(
  args: { clientId: string; clientSecret: string; refreshToken: string },
  fetchFn: FetchFn = fetch,
): Promise<YoutubeTokens> {
  return tokenRequest(
    {
      client_id: args.clientId,
      client_secret: args.clientSecret,
      refresh_token: args.refreshToken,
      grant_type: "refresh_token",
    },
    fetchFn,
  );
}

export interface YoutubeChannel {
  channelId: string;
  title: string;
}

/** Reads the authenticated user's channel (id + title). */
export async function getChannelInfo(accessToken: string, fetchFn: FetchFn = fetch): Promise<YoutubeChannel> {
  const url = `https://www.googleapis.com/youtube/v3/channels?${new URLSearchParams({ part: "snippet", mine: "true" }).toString()}`;
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { authorization: `Bearer ${accessToken}` } });
  } catch (err) {
    throw new YoutubeApiError(`YouTube channel lookup failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    throw new YoutubeApiError(`YouTube returned a non-JSON response (HTTP ${res.status}).`, res.status);
  }
  if (!res.ok || body?.error) {
    const err = body?.error ?? {};
    throw new YoutubeApiError(
      `YouTube error: ${err.message ?? `HTTP ${res.status}`}${err.code ? ` (code ${err.code})` : ""}`,
      res.status,
    );
  }
  const item = body?.items?.[0];
  if (!item?.id) throw new YoutubeApiError("No YouTube channel found on this Google account.");
  return { channelId: String(item.id), title: String(item.snippet?.title ?? item.id) };
}

export interface YoutubeUploadResult {
  videoId: string;
}

/** Resumable upload (single chunk — zepostia caps media at 12 MB).
 *  Step 1: POST metadata -> Location header (session URL).
 *  Step 2: PUT the bytes -> { id }. */
export async function uploadYoutubeVideo(
  args: { accessToken: string; videoBytes: Uint8Array; mimeType: string; title: string; description: string },
  fetchFn: FetchFn = fetch,
): Promise<YoutubeUploadResult> {
  const metadata = {
    snippet: { title: args.title, description: args.description },
    status: { privacyStatus: "public" },
  };
  const initUrl = `https://www.googleapis.com/upload/youtube/v3/videos?${new URLSearchParams({ uploadType: "resumable", part: "snippet,status" }).toString()}`;
  let initRes: Response;
  try {
    initRes = await fetchFn(initUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.accessToken}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": args.mimeType,
        "x-upload-content-length": String(args.videoBytes.byteLength),
      },
      body: JSON.stringify(metadata),
    });
  } catch (err) {
    throw new YoutubeApiError(`YouTube upload init failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!initRes.ok) {
    let detail = `HTTP ${initRes.status}`;
    try {
      const b: any = await initRes.json();
      detail = b?.error?.message ?? detail;
    } catch { /* keep detail */ }
    throw new YoutubeApiError(`YouTube upload init failed: ${detail}`, initRes.status);
  }
  const sessionUrl = initRes.headers.get("location");
  if (!sessionUrl) throw new YoutubeApiError("YouTube did not return an upload session URL.");

  let putRes: Response;
  try {
    putRes = await fetchFn(sessionUrl, {
      method: "PUT",
      headers: { "content-type": args.mimeType, "content-length": String(args.videoBytes.byteLength) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: args.videoBytes as any,
    });
  } catch (err) {
    throw new YoutubeApiError(`YouTube video upload failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  let putBody: any = null;
  try {
    putBody = await putRes.json();
  } catch {
    throw new YoutubeApiError(`YouTube upload returned a non-JSON response (HTTP ${putRes.status}).`, putRes.status);
  }
  if (!putRes.ok || putBody?.error) {
    const err = putBody?.error ?? {};
    throw new YoutubeApiError(
      `YouTube upload failed: ${err.message ?? `HTTP ${putRes.status}`}`,
      putRes.status,
    );
  }
  if (!putBody.id) throw new YoutubeApiError("YouTube did not return a video id.");
  return { videoId: String(putBody.id) };
}

export interface YoutubeCommentResult {
  commentId: string;
}

/** POST commentThreads?part=snippet — posts a top-level comment on the
 *  channel's own video (24-hour post bump). Costs 100 quota units per
 *  insert (the free daily quota is 10,000). Requires the
 *  youtube.force-ssl scope; the API answers 403 "insufficientPermissions"
 *  without it, which the caller maps to a "reconnect" reason — the error
 *  reason is included in the thrown message for that mapping. */
export async function postYoutubeComment(
  args: { accessToken: string; videoId: string; text: string },
  fetchFn: FetchFn = fetch,
): Promise<YoutubeCommentResult> {
  const url = `https://www.googleapis.com/youtube/v3/commentThreads?${new URLSearchParams({ part: "snippet" }).toString()}`;
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.accessToken}`,
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        snippet: {
          videoId: args.videoId,
          topLevelComment: { snippet: { textOriginal: args.text } },
        },
      }),
    });
  } catch (err) {
    throw new YoutubeApiError(`YouTube comment failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    throw new YoutubeApiError(`YouTube returned a non-JSON response (HTTP ${res.status}).`, res.status);
  }
  if (!res.ok || body?.error) {
    const err = body?.error ?? {};
    const reason = err.errors?.[0]?.reason ? ` [${String(err.errors[0].reason)}]` : "";
    throw new YoutubeApiError(
      `YouTube error: ${err.message ?? `HTTP ${res.status}`}${reason}`,
      res.status,
    );
  }
  if (!body.id) throw new YoutubeApiError("YouTube did not return a comment id.");
  return { commentId: String(body.id) };
}
