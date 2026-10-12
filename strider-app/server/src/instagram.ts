// Real Instagram (Meta Instagram Graph API) publishing.
//
// Instagram posting goes through the Instagram Graph API and requires the
// Instagram professional (business/creator) account to be connected to a
// Facebook Page the user manages. The same Meta app as Facebook covers it,
// with the "Manage messaging & content on Instagram" use case.
//
// Flow:
//   1. connectInstagram action builds an auth URL (buildInstagramAuthUrl) and
//      stores a single-use CSRF state in oauth_states.
//   2. GET /oauth/instagram/callback verifies the state, exchanges the code
//      for a short-lived user token, upgrades it to a long-lived token
//      (~60 days), lists the managed Pages, and resolves the Instagram
//      business account linked to each Page via
//      GET /{page-id}?fields=instagram_business_account.
//   3. The first Page with a linked IG account is auto-selected; the
//      long-lived user token is stored AES-256-GCM encrypted.
//   4. Publishing is a two-step container flow:
//      POST /{ig-user-id}/media {image_url|video_url, caption} -> container id
//      poll GET /{container-id}?fields=status_code until READY
//      POST /{ig-user-id}/media_publish {creation_id} -> media id
//
// Text-only posts are NOT supported by the API: every Instagram target
// requires an image or video. The composer and createPost enforce this;
// publish.ts fails the target with a clear message as a second layer.
//
// OAuth token helpers are reused from facebook.ts. Nothing here logs or
// returns raw tokens. The app secret comes from FACEBOOK_CLIENT_SECRET
// (same Meta app); per-user tokens live encrypted in instagram_connections.

import {
  FB_API_VERSION,
  decryptToken,
  encryptToken,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getFacebookUserId,
  getManagedPages,
  requireTokenEncryption,
} from "./facebook.js";

export {
  decryptToken,
  encryptToken,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getFacebookUserId,
  getManagedPages,
  requireTokenEncryption,
};

/** Permissions requested at OAuth time for Instagram. The instagram_* scopes
 *  come from the "Manage messaging & content on Instagram" use case; the
 *  pages_* scopes (already used for Facebook) are kept for Page discovery.
 *  All require App Review before the app leaves development mode; in dev
 *  mode they work for app admins, developers, and testers immediately. */
export const IG_OAUTH_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_manage_posts",
  "pages_read_engagement",
  "pages_show_list",
] as const;

export class InstagramApiError extends Error {
  readonly code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "InstagramApiError";
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
    throw new InstagramApiError(`Instagram request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    throw new InstagramApiError(`Instagram returned a non-JSON response (HTTP ${res.status}).`);
  }
  if (!res.ok || body?.error) {
    const err = body?.error ?? {};
    throw new InstagramApiError(
      `Instagram error: ${err.message ?? `HTTP ${res.status}`}${err.code ? ` (code ${err.code})` : ""}`,
      typeof err.code === "number" ? err.code : undefined,
    );
  }
  return body;
}

/** The OAuth callback URL the owner must register in the Meta app
 *  (Valid OAuth Redirect URIs). INSTAGRAM_REDIRECT_URI, when set, is used
 *  verbatim; otherwise it is derived from APP_BASE_URL. */
export function instagramRedirectUri(origin: string | null): string {
  const override = (process.env.INSTAGRAM_REDIRECT_URI ?? "").trim().replace(/\/+$/, "");
  if (override) return override;
  const raw = (process.env.APP_BASE_URL || origin || "http://localhost:3000").replace(/\/+$/, "");
  return `${raw}/oauth/instagram/callback`;
}

export function buildInstagramAuthUrl(args: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
    response_type: "code",
    scope: IG_OAUTH_SCOPES.join(","),
  });
  return `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth?${params.toString()}`;
}

/** Decides whether the stored config means "real OAuth" or the simulated
 *  fallback. Instagram shares the Meta app (and App ID) with Facebook.
 *  Pure — unit-tested. */
export function isRealInstagramConfig(clientId: string, hasSecret: boolean): boolean {
  const id = (clientId ?? "").trim();
  return id.length > 0 && !id.startsWith("DEMO_") && hasSecret;
}

export interface InstagramBusinessAccount {
  igUserId: string;
  username: string;
  pageId: string;
  pageName: string;
}

/** Resolves the Instagram professional account linked to a Facebook Page.
 *  Returns null when the Page has no linked IG business/creator account. */
export async function getInstagramBusinessAccount(
  args: { pageId: string; pageName: string; userAccessToken: string },
  fetchFn: FetchFn = fetch,
): Promise<InstagramBusinessAccount | null> {
  const body = await graphRequest(
    "GET",
    `/${encodeURIComponent(args.pageId)}`,
    {
      fields: "instagram_business_account{id,username}",
      access_token: args.userAccessToken,
    },
    fetchFn,
  );
  const ig = body?.instagram_business_account;
  if (!ig?.id) return null;
  return {
    igUserId: String(ig.id),
    username: String(ig.username ?? ig.id),
    pageId: args.pageId,
    pageName: args.pageName,
  };
}

/** All IG professional accounts reachable through the user's managed Pages. */
export async function listInstagramBusinessAccounts(
  userAccessToken: string,
  fetchFn: FetchFn = fetch,
): Promise<InstagramBusinessAccount[]> {
  const managed = await getManagedPages(userAccessToken, fetchFn);
  const accounts: InstagramBusinessAccount[] = [];
  for (const page of managed) {
    const ig = await getInstagramBusinessAccount(
      { pageId: page.id, pageName: page.name, userAccessToken },
      fetchFn,
    ).catch(() => null);
    if (ig) accounts.push(ig);
  }
  return accounts;
}

/** Step 1 of publishing: create a media container. Returns the container id. */
export async function createMediaContainer(
  args: { igUserId: string; userAccessToken: string; mediaUrl: string; mediaType: "image" | "video"; caption: string },
  fetchFn: FetchFn = fetch,
): Promise<{ containerId: string }> {
  const params: Record<string, string> =
    args.mediaType === "video"
      ? {
          video_url: args.mediaUrl,
          media_type: "VIDEO",
          caption: args.caption,
          access_token: args.userAccessToken,
        }
      : {
          image_url: args.mediaUrl,
          caption: args.caption,
          access_token: args.userAccessToken,
        };
  const body = await graphRequest("POST", `/${encodeURIComponent(args.igUserId)}/media`, params, fetchFn);
  if (!body.id) throw new InstagramApiError("Instagram did not return a media container id.");
  return { containerId: String(body.id) };
}

/** Container processing status: IN_PROGRESS, READY, ERROR, or EXPIRED. */
export async function getContainerStatus(
  args: { containerId: string; userAccessToken: string },
  fetchFn: FetchFn = fetch,
): Promise<string> {
  const body = await graphRequest(
    "GET",
    `/${encodeURIComponent(args.containerId)}`,
    { fields: "status_code", access_token: args.userAccessToken },
    fetchFn,
  );
  return String(body?.status_code ?? "UNKNOWN");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls a container until its status_code is READY. Throws on ERROR /
 *  EXPIRED or when attempts are exhausted. */
export async function pollContainerReady(
  args: { containerId: string; userAccessToken: string; maxAttempts?: number; intervalMs?: number },
  fetchFn: FetchFn = fetch,
): Promise<void> {
  const maxAttempts = args.maxAttempts ?? 20;
  const intervalMs = args.intervalMs ?? 5000;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const status = await getContainerStatus(
      { containerId: args.containerId, userAccessToken: args.userAccessToken },
      fetchFn,
    );
    if (status === "READY") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new InstagramApiError(`Instagram media processing failed (status: ${status}).`);
    }
    if (attempt < maxAttempts) await sleep(intervalMs);
  }
  throw new InstagramApiError("Instagram media was not ready in time. Try again.");
}

/** Step 2 of publishing: publish a READY container. Returns the media id. */
export async function publishContainer(
  args: { igUserId: string; userAccessToken: string; containerId: string },
  fetchFn: FetchFn = fetch,
): Promise<{ mediaId: string }> {
  const body = await graphRequest(
    "POST",
    `/${encodeURIComponent(args.igUserId)}/media_publish`,
    { creation_id: args.containerId, access_token: args.userAccessToken },
    fetchFn,
  );
  if (!body.id) throw new InstagramApiError("Instagram did not return a published media id.");
  return { mediaId: String(body.id) };
}

/** Full publish: container -> wait READY -> publish. Media URL must be a
 *  publicly reachable image or video URL. */
export async function publishInstagramMedia(
  args: {
    igUserId: string;
    userAccessToken: string;
    mediaUrl: string;
    mediaType: "image" | "video";
    caption: string;
  },
  fetchFn: FetchFn = fetch,
): Promise<{ mediaId: string }> {
  const { containerId } = await createMediaContainer(
    {
      igUserId: args.igUserId,
      userAccessToken: args.userAccessToken,
      mediaUrl: args.mediaUrl,
      mediaType: args.mediaType,
      caption: args.caption,
    },
    fetchFn,
  );
  await pollContainerReady({ containerId, userAccessToken: args.userAccessToken }, fetchFn);
  return publishContainer(
    { igUserId: args.igUserId, userAccessToken: args.userAccessToken, containerId },
    fetchFn,
  );
}
