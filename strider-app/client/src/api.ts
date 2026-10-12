// Tiny fetch-based RPC client replacing the SDK's createActionClient.
// Wire protocol is identical to the original: POST /actions with
// { action, args } JSON; the server replies { data } on success and
// { error } on failure.

type Platform = "facebook" | "instagram" | "tiktok" | "youtube" | "x";
type BasicResult = { ok: boolean; message: string };
type AuthResult = BasicResult & {
  sessionToken: string | null;
  user: { id: number; email: string; displayName: string; demoMode: boolean; role: string } | null;
};
type WorkspaceResult = {
  authenticated: boolean;
  user: { id: number; email: string; displayName: string; demoMode: boolean; role: string } | null;
  accounts: Array<{ id: number; platform: Platform; handle: string; status: string; authMode: string; connectedAt: string; retryAfter: string | null }>;
  posts: Array<{
    id: number;
    body: string;
    youtubeTitle: string | null;
    mediaName: string | null;
    mediaType: string | null;
    mediaUrl: string | null;
    publishMode: string;
    scheduledAt: string | null;
    status: string;
    bumpEnabled: boolean;
    createdAt: string;
    targets: Array<{ platform: Platform; status: string; errorMessage: string | null }>;
    bumpComments: Array<{ id: number; sequence: number; body: string; scheduledAt: string; status: string; publishedAt: string | null }>;
  }>;
};
type SettingsResult = {
  ok: boolean;
  metaConfigured: boolean;
  platforms: Array<{ platform: Platform; label: string; clientId: string; secretReference: string; developerApp: string; credentialFields: string; warning: string; failureHint: string }>;
};
type CreatePostRequest = {
  sessionToken: string;
  body: string;
  youtubeTitle?: string;
  accountIds: number[];
  publishMode: "now" | "scheduled";
  scheduledAt?: string;
  bumpComments?: string[];
  media?: { name: string; mimeType: string; dataBase64: string };
};

type BillingStatusResult = {
  status: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
};
type RedirectResult = { url: string };

type ConnectFacebookResult = BasicResult & { mode: "oauth" | "demo"; authUrl: string | null };
type FacebookPagesResult = { ok: boolean; pages: Array<{ id: string; name: string }>; selectedPageId: string | null; error?: string };
type ConnectInstagramResult = BasicResult & { mode: "oauth" | "demo"; authUrl: string | null };
type InstagramAccountsResult = { ok: boolean; accounts: Array<{ igUserId: string; username: string; pageId: string; pageName: string }>; selectedIgUserId: string | null; error?: string };

type PublicConfigResult = { demoMode: boolean };
type ClientApi = {
  getPublicConfig(args: Record<string, never>): Promise<PublicConfigResult>;
  createDemoSession(args: Record<string, never>): Promise<AuthResult>;
  signup(args: { email: string; displayName: string; password: string }): Promise<AuthResult>;
  login(args: { email: string; password: string }): Promise<AuthResult>;
  getWorkspace(args: { sessionToken: string }): Promise<WorkspaceResult>;
  listPlatformSettings(args: { sessionToken: string }): Promise<SettingsResult>;
  savePlatformConfig(args: { sessionToken: string; platform: Platform; clientId: string; secretReference: string; clientSecret?: string }): Promise<BasicResult>;
  connectDemoAccount(args: { sessionToken: string; platform: Platform }): Promise<BasicResult>;
  connectFacebook(args: { sessionToken: string }): Promise<ConnectFacebookResult>;
  listFacebookPages(args: { sessionToken: string }): Promise<FacebookPagesResult>;
  selectFacebookPage(args: { sessionToken: string; pageId: string }): Promise<BasicResult>;
  connectInstagram(args: { sessionToken: string }): Promise<ConnectInstagramResult>;
  listInstagramAccounts(args: { sessionToken: string }): Promise<InstagramAccountsResult>;
  selectInstagramAccount(args: { sessionToken: string; igUserId: string }): Promise<BasicResult>;
  disconnectAccount(args: { sessionToken: string; accountId: number }): Promise<BasicResult>;
  createPost(args: CreatePostRequest): Promise<BasicResult & { postId: number | null }>;
  advanceBumpDemo(args: { sessionToken: string; postId: number }): Promise<BasicResult>;
  cancelBumpPlan(args: { sessionToken: string; postId: number }): Promise<BasicResult>;
  cancelPost(args: { sessionToken: string; postId: number }): Promise<BasicResult>;
  createCheckoutSession(args: { sessionToken: string }): Promise<RedirectResult>;
  createPortalSession(args: { sessionToken: string }): Promise<RedirectResult>;
  getBillingStatus(args: { sessionToken: string }): Promise<BillingStatusResult>;
};

/** Request args type for a ClientApi method (replaces the SDK's ApiRequest). */
export type ApiRequest<TApi, TMethod extends keyof TApi> =
  TApi[TMethod] extends (args: infer A) => unknown ? A : never;

/** Response type for a ClientApi method (replaces the SDK's ApiResponse). */
export type ApiResponse<TApi, TMethod extends keyof TApi> =
  TApi[TMethod] extends (args: never) => Promise<infer R> ? R : never;

async function callAction(action: string, args: unknown): Promise<unknown> {
  const response = await fetch("/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, args: args ?? {} }),
  });
  let body: { data?: unknown; error?: unknown } | null = null;
  try {
    body = (await response.json()) as { data?: unknown; error?: unknown };
  } catch {
    body = null;
  }
  if (!response.ok || (body && typeof body === "object" && "error" in body && body.error)) {
    throw new Error(`action ${action} error: ${String(body?.error ?? response.statusText)}`);
  }
  return body?.data;
}

export const api: ClientApi = new Proxy({} as ClientApi, {
  get(_target, name) {
    // Same guard as the SDK proxy: symbol keys and promise-protocol names
    // must not resolve to phantom actions.
    if (typeof name !== "string") return undefined;
    if (name === "then" || name === "catch" || name === "finally") return undefined;
    return (args: unknown) => callAction(name, args);
  },
});
