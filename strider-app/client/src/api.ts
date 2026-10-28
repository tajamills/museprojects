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
type AffiliateInfo = {
  referralCode: string;
  referralCount: number;
  earnings: number;
  paidOut: number;
  amountOwed: number;
  payoutMethod: string | null;
  payoutZelleInfo: string | null;
  payoutTaxName: string | null;
  payoutTaxAddress: string | null;
};
type WorkspaceResult = {
  authenticated: boolean;
  user: { id: number; email: string; displayName: string; demoMode: boolean; role: string } | null;
  affiliate: AffiliateInfo | null;
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
    bumpComments: Array<{
      id: number;
      sequence: number;
      body: string;
      scheduledAt: string;
      status: string;
      publishedAt: string | null;
      errorMessage: string | null;
      jobs: Array<{ id: number; platform: Platform; status: string; scheduledAt: string; publishedAt: string | null; errorMessage: string | null }>;
    }>;
  }>;
};
type SettingsResult = {
  ok: boolean;
  metaConfigured: boolean;
  tiktokConfigured: boolean;
  youtubeConfigured: boolean;
  xConfigured: boolean;
  xPostsUsed: number;
  xPostsCap: number;
  tiktokPostsUsed: number;
  tiktokPostsCap: number;
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

type XAddonTierInfo = {
  priceId: string;
  name: string;
  postsPerMonth: number;
  linkPostsPerMonth: number;
  amountCents: number | null;
};
type XAddonStatusResult = {
  configured: boolean;
  tiers: XAddonTierInfo[];
  activeTier: string | null;
  usage: {
    postsUsed: number;
    postsCap: number;
    linkPostsUsed: number;
    linkPostsCap: number;
    periodEnd: string | null;
  };
};
type BillingStatusResult = {
  status: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  xAddon: XAddonStatusResult;
  setupBookings: Array<{ id: number; bookedAt: string; amountCents: number; status: string }>;
};
type RedirectResult = { url: string };
type BillingInvoice = {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  currency: string;
  status: string;
  hostedInvoiceUrl: string | null;
};
type BillingInvoicesResult = { ok: boolean; message: string; invoices: BillingInvoice[] };

type ConnectFacebookResult = BasicResult & { mode: "oauth" | "demo"; authUrl: string | null };
type FacebookPagesResult = { ok: boolean; pages: Array<{ id: string; name: string }>; selectedPageId: string | null; error?: string };
type ConnectInstagramResult = BasicResult & { mode: "oauth" | "demo"; authUrl: string | null };
type InstagramAccountsResult = { ok: boolean; accounts: Array<{ igUserId: string; username: string; pageId: string; pageName: string }>; selectedIgUserId: string | null; error?: string };

type PublicConfigResult = { demoMode: boolean };
type BfJoinResult = { ok: boolean; alreadyOnList: boolean; message: string };
type BfConfigResult = { tripwireConfigured: boolean };
type BfPackAccessResult = { ok: boolean; email: string | null; downloadPath: string | null };
type BfTripwireSalesResult = {
  ok: boolean;
  message: string;
  count: number;
  totalCents: number;
  sales: Array<{ id: number; email: string; amountCents: number; createdAt: string }>;
};
type BfWaitlistResult = {
  ok: boolean;
  message: string;
  count: number;
  entries: Array<{ id: number; email: string; phone: string | null; firstName: string | null; createdAt: string }>;
};
type AffiliateReportResult = {
  ok: boolean;
  message: string;
  totalEarned: number;
  totalOwed: number;
  affiliates: Array<{
    id: number;
    email: string;
    displayName: string;
    referralCode: string | null;
    referralCount: number;
    totalEarned: number;
    paidOut: number;
    amountOwed: number;
    payoutMethod: string | null;
    payoutZelleInfo: string | null;
    payoutTaxName: string | null;
    payoutTaxAddress: string | null;
    hasPayoutInfo: boolean;
    status: string;
  }>;
};
type ClientApi = {
  getPublicConfig(args: Record<string, never>): Promise<PublicConfigResult>;
  joinBfWaitlist(args: { email: string; phone?: string; firstName?: string }): Promise<BfJoinResult>;
  getBfConfig(args: Record<string, never>): Promise<BfConfigResult>;
  getBfWaitlist(args: { sessionToken: string }): Promise<BfWaitlistResult>;
  createBfTripwireCheckoutSession(args: { email: string }): Promise<RedirectResult>;
  getBfPackAccess(args: { sessionId: string }): Promise<BfPackAccessResult>;
  getBfTripwireSales(args: { sessionToken: string }): Promise<BfTripwireSalesResult>;
  createDemoSession(args: Record<string, never>): Promise<AuthResult>;
  signup(args: { email: string; displayName: string; password: string; referralCode?: string }): Promise<AuthResult>;
  login(args: { email: string; password: string }): Promise<AuthResult>;
  requestPasswordReset(args: { email: string }): Promise<BasicResult>;
  resetPassword(args: { token: string; password: string }): Promise<BasicResult>;
  generatePasswordResetLink(args: { sessionToken: string; email: string }): Promise<{ ok: boolean; message: string; resetUrl: string | null }>;
  changePassword(args: { sessionToken: string; currentPassword: string; newPassword: string }): Promise<BasicResult>;
  deleteAccount(args: { sessionToken: string; confirmation: string }): Promise<BasicResult>;
  listBillingInvoices(args: { sessionToken: string }): Promise<BillingInvoicesResult>;
  getWorkspace(args: { sessionToken: string }): Promise<WorkspaceResult>;
  savePayoutInfo(args: { sessionToken: string; payoutMethod: "zelle" | "stripe"; payoutZelleInfo?: string; payoutTaxName: string; payoutTaxAddress: string }): Promise<BasicResult>;
  getAffiliateReport(args: { sessionToken: string }): Promise<AffiliateReportResult>;
  recordAffiliatePayout(args: { sessionToken: string; userId: number; amount: number }): Promise<BasicResult & { paidOut: number | null; amountOwed: number | null }>;
  listPlatformSettings(args: { sessionToken: string }): Promise<SettingsResult>;
  savePlatformConfig(args: { sessionToken: string; platform: Platform; clientId: string; secretReference: string; clientSecret?: string }): Promise<BasicResult>;
  connectDemoAccount(args: { sessionToken: string; platform: Platform }): Promise<BasicResult>;
  connectFacebook(args: { sessionToken: string }): Promise<ConnectFacebookResult>;
  testMetaCredentials(args: { sessionToken: string }): Promise<{ ok: boolean; valid: boolean; message: string }>;
  listFacebookPages(args: { sessionToken: string }): Promise<FacebookPagesResult>;
  selectFacebookPage(args: { sessionToken: string; pageId: string }): Promise<BasicResult>;
  connectInstagram(args: { sessionToken: string }): Promise<ConnectInstagramResult>;
  connectYoutube(args: { sessionToken: string }): Promise<ConnectFacebookResult>;
  connectTikTok(args: { sessionToken: string }): Promise<ConnectFacebookResult>;
  connectX(args: { sessionToken: string }): Promise<ConnectFacebookResult>;
  listInstagramAccounts(args: { sessionToken: string }): Promise<InstagramAccountsResult>;
  selectInstagramAccount(args: { sessionToken: string; igUserId: string }): Promise<BasicResult>;
  disconnectAccount(args: { sessionToken: string; accountId: number }): Promise<BasicResult>;
  createPost(args: CreatePostRequest): Promise<BasicResult & { postId: number | null }>;
  advanceBumpDemo(args: { sessionToken: string; postId: number }): Promise<BasicResult>;
  cancelBumpPlan(args: { sessionToken: string; postId: number }): Promise<BasicResult>;
  cancelPost(args: { sessionToken: string; postId: number }): Promise<BasicResult>;
  createCheckoutSession(args: { sessionToken: string; xAddonTierPriceId?: string }): Promise<RedirectResult>;
  createSetupCheckoutSession(args: { sessionToken: string }): Promise<RedirectResult>;
  createPortalSession(args: { sessionToken: string }): Promise<RedirectResult>;
  getBillingStatus(args: { sessionToken: string }): Promise<BillingStatusResult>;
  setXAddonTier(args: { sessionToken: string; priceId: string }): Promise<{ activeTier: string | null }>;
  removeXAddon(args: { sessionToken: string }): Promise<{ activeTier: string | null }>;
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
