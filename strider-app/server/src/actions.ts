import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import type { AppCtx } from "./ctx.js";
import type { Db } from "./db.js";
import * as schema from "./schema.js";
import {
  SUBSCRIBED_STATUSES,
  TRIAL_DAYS,
  X_ADDON_SUBSCRIPTION_METADATA,
  baseUrl,
  canPostToX,
  getStripe,
  getXAddonUsage,
  isXAddonConfigured,
  isXAddonSubscription,
  reconcileSubscriptionFromStripe,
  subscriptionDefaultPaymentMethod,
  syncBillingForCustomer,
  xAddonSubscriptionItem,
  xAddonTierForPriceId,
  xAddonTiers,
  xAddonUsagePeriod,
  type BillingPeriod,
  type XAddonTier,
} from "./billing.js";
import {
  buildFacebookAuthUrl,
  decryptToken,
  encryptToken,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  facebookRedirectUri,
  getFacebookUserId,
  getManagedPages,
  isRealFacebookConfig,
  requireTokenEncryption,
} from "./facebook.js";
import {
  buildInstagramAuthUrl,
  instagramRedirectUri,
  isRealInstagramConfig,
  listInstagramBusinessAccounts,
} from "./instagram.js";
import {
  buildTikTokAuthUrl,
  exchangeTikTokCode,
  getTikTokUserInfo,
  isRealTikTokConfig,
  isTikTokAppConfigured,
  logTikTokError,
  ownerTikTokCredentials,
  tiktokRedirectUri,
} from "./tiktok.js";
export { isTikTokAppConfigured, ownerTikTokCredentials };
import {
  buildYoutubeAuthUrl,
  exchangeCodeForTokens,
  getChannelInfo,
  isRealYoutubeConfig,
  youtubeRedirectUri,
} from "./youtube.js";
import {
  buildXAuthUrl,
  exchangeXCodeForToken,
  generateCodeChallenge,
  generateCodeVerifier,
  getXUserInfo,
  isRealXConfig,
  isXAppConfigured,
  ownerXCredentials,
  refreshXToken,
  xRedirectUri,
} from "./x.js";
export { isXAppConfigured, ownerXCredentials };
import { publishBumpCommentNow, publishPendingTargets } from "./publish.js";
import { resolvePlatformSecret } from "./secrets.js";

const platformSchema = z.enum(["facebook", "instagram", "tiktok", "youtube", "x"]);
type Platform = z.infer<typeof platformSchema>;

const PLATFORM_INFO: Record<Platform, {
  label: string;
  developerApp: string;
  credentialFields: string;
  failureHint: string;
  warning: string;
}> = {
  facebook: {
    label: "Facebook",
    developerApp: "No setup needed — zepostia handles the Meta app for you",
    credentialFields: "None — just hit Connect",
    failureHint: "If the session expired, choose Reconnect and complete Facebook OAuth again.",
    warning: "Facebook sessions can expire without warning. The app checks token health on load and before publishing.",
  },
  instagram: {
    label: "Instagram",
    developerApp: "No setup needed — zepostia handles the Meta app for you",
    credentialFields: "None — just hit Connect",
    failureHint: "Confirm the Instagram account is Professional and linked to a Facebook Page, then reconnect.",
    warning: "Instagram publishing requires an image or video and an eligible professional account.",
  },
  tiktok: {
    label: "TikTok",
    developerApp: "No setup needed — zepostia handles the TikTok app for you",
    credentialFields: "None — connect with TikTok on the Accounts page",
    failureHint: "TikTok only posts video (no text-only posts). If TikTok says the maximum number of attempts was reached, stop retrying and wait until the shown retry time.",
    warning: "TikTok posts video only. New TikTok apps post privately until the app passes TikTok's audit.",
  },
  youtube: {
    label: "YouTube",
    developerApp: "Google Cloud project with YouTube Data API v3 and OAuth consent screen",
    credentialFields: "OAuth Client ID + Client Secret (kept in a server-side secret vault)",
    failureHint: "Use an established Google account, finish any Google verification yourself, then return and reconnect.",
    warning: "Brand-new Google accounts can trigger fraud or verification checks, including an account appeal. Use an established account when possible.",
  },
  x: {
    label: "X",
    developerApp: "X Developer Portal project/app with OAuth 2.0 and write permissions",
    credentialFields: "OAuth 2.0 Client ID + Client Secret (kept in a server-side secret vault)",
    failureHint: "Confirm the app has write permission and the callback URL matches exactly, then reconnect.",
    warning: "X posting access and rate limits depend on the developer app tier.",
  },
};

const DEMO_HANDLES: Record<Platform, string> = {
  facebook: "Demo Page",
  instagram: "@demo.studio",
  tiktok: "@demo.studio",
  youtube: "Demo Channel",
  x: "@demo_studio",
};

function bumpOffsets(count: number): number[] {
  if (count === 2) return [1, 23];
  if (count === 3) return [1, 8, 23];
  return [1, 6, 12, 23];
}

async function digestPassword(password: string, salt: string): Promise<string> {
  const payload = new TextEncoder().encode(`${salt}:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 hex of a password-reset token. The raw token is never stored. */
async function hashResetToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Public base URL used for reset links. */
function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "https://zepostia.com").trim().replace(/\/+$/, "");
}

async function initializeConfigs(ctx: AppCtx, userId: number) {
  const now = new Date();
  await ctx.db.insert(schema.platformConfigs).values(
    (Object.keys(PLATFORM_INFO) as Platform[]).map((platform) => ({
      userId,
      platform,
      clientId: `DEMO_${platform.toUpperCase()}_CLIENT_ID`,
      secretReference: `vault://marketing-app/${platform}/client-secret`,
      updatedAt: now,
    })),
  );
}

async function createSession(ctx: AppCtx, userId: number): Promise<string> {
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await ctx.db.insert(schema.sessions).values({ userId, token, createdAt: now, expiresAt });
  return token;
}

/** Emails (lowercased) listed in ADMIN_EMAILS get the 'admin' role on signup/login. */
function adminEmails(): Set<string> {
  return new Set((process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
}
function isAdminEmail(email: string): boolean {
  return adminEmails().has(email.toLowerCase());
}

/** Server-wide demo mode. Default false (production): demo UI chrome is hidden. */
export function isDemoMode(): boolean {
  return (process.env.DEMO_MODE ?? "").trim().toLowerCase() === "true";
}

async function requireUser(ctx: AppCtx, token: string) {
  const rows = await ctx.db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      demoMode: schema.users.demoMode,
      role: schema.users.role,
      expiresAt: schema.sessions.expiresAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.token, token))
    .limit(1);
  const user = rows[0];
  if (!user || user.expiresAt.getTime() <= Date.now()) return null;
  return user;
}

/** Full user row (including billing fields) for a valid session token. */
async function billingUser(ctx: AppCtx, token: string) {
  const rows = await ctx.db
    .select()
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.token, token))
    .limit(1);
  const row = rows[0];
  if (!row || row.sessions.expiresAt.getTime() <= Date.now()) return null;
  return row.users;
}

/**
 * billingUser + self-healing: reconcile the row from Stripe's actual
 * state first, then re-read it when anything changed. This is what
 * keeps a completed checkout from ever being stranded by a webhook
 * endpoint that isn't registered in Stripe — and what delivers the X
 * add-on subscription for a tier prepaid at checkout when the
 * completion webhook was missed. Costs one Stripe subscriptions list
 * per billing call in the steady state.
 */
async function billingUserSynced(ctx: AppCtx, token: string) {
  let user = await billingUser(ctx, token);
  if (!user) return null;
  const changed = await reconcileSubscriptionFromStripe(ctx.db, user);
  if (changed) {
    const fresh = await billingUser(ctx, token);
    if (fresh) user = fresh;
  }
  return user;
}

export interface XAddonStatus {
  configured: boolean;
  tiers: XAddonTier[];
  activeTier: string | null;
  usage: {
    postsUsed: number;
    postsCap: number;
    linkPostsUsed: number;
    linkPostsCap: number;
    periodEnd: string | null;
  };
}

/**
 * The X add-on fragment of the billing status, built from server truth
 * only: the STRIPE_X_TIERS config, the Stripe-synced tier price on the
 * user row, and this billing period's usage counters. When no tier is
 * configured the client renders nothing about X at all.
 */
async function xAddonStatusFor(ctx: AppCtx, user: NonNullable<Awaited<ReturnType<typeof billingUser>>>): Promise<XAddonStatus> {
  const tiers = xAddonTiers();
  const tier = xAddonTierForPriceId(user.xAddonTierPriceId);
  // Usage is anchored to the tier's own billing period when the tier
  // has its own subscription, else the base subscription's period.
  const period: BillingPeriod | null = xAddonUsagePeriod(user);
  const usage = await getXAddonUsage(ctx.db, user.id, period);
  return {
    configured: tiers.length > 0,
    tiers,
    activeTier: tier?.name ?? null,
    usage: {
      postsUsed: usage.postsUsed,
      postsCap: tier?.postsPerMonth ?? 0,
      linkPostsUsed: usage.linkPostsUsed,
      linkPostsCap: tier?.linkPostsPerMonth ?? 0,
      periodEnd: period ? period.end.toISOString() : null,
    },
  };
}

const authResponse = z.object({
  ok: z.boolean(),
  message: z.string(),
  sessionToken: z.string().nullable(),
  user: z.object({ id: z.number(), email: z.string(), displayName: z.string(), demoMode: z.boolean(), role: z.string() }).nullable(),
});

const accountResponse = z.object({
  ok: z.boolean(),
  message: z.string(),
});

export interface ActionDef {
  request: z.ZodTypeAny;
  handler: (ctx: AppCtx, args: any) => Promise<unknown>;
}

/** Shared simulated-connect used by connectDemoAccount and as the Facebook
 *  fallback when no real credentials are configured. */
async function demoConnectAccount(
  ctx: AppCtx,
  user: { id: number; demoMode: boolean },
  platform: Platform,
): Promise<{ ok: boolean; message: string }> {
  if (!user.demoMode) return { ok: false, message: "Live OAuth needs a deployed callback URL and approved developer app. Finish the checklist in Settings first." };
  const existing = await ctx.db.select().from(schema.connectedAccounts).where(and(eq(schema.connectedAccounts.userId, user.id), eq(schema.connectedAccounts.platform, platform))).limit(1);
  if (existing[0]?.status === "rate_limited" && existing[0].retryAfter && existing[0].retryAfter.getTime() > Date.now()) {
    return { ok: false, message: `Too many attempts. Do not retry yet; try again after ${existing[0].retryAfter.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` };
  }
  await ctx.db.insert(schema.connectedAccounts).values({
    userId: user.id,
    platform,
    handle: DEMO_HANDLES[platform],
    status: "connected",
    authMode: "demo",
    tokenHint: "demo-token-never-used",
    retryAfter: null,
    connectedAt: new Date(),
  }).onConflictDoUpdate({
    target: [schema.connectedAccounts.userId, schema.connectedAccounts.platform],
    set: { handle: DEMO_HANDLES[platform], status: "connected", authMode: "demo", tokenHint: "demo-token-never-used", retryAfter: null, connectedAt: new Date() },
  });
  ctx.invalidateQueries();
  return { ok: true, message: `${PLATFORM_INFO[platform].label} demo OAuth completed. No external account was contacted.` };
}

/** Meta app credentials: ok + values, or ok:false with which piece is missing. */
type MetaAppCreds = { ok: true; clientId: string; clientSecret: string } | { ok: false; missing: string };

/**
 * Owner-level Meta app credentials. ONE Meta app for the whole site, owned by
 * Layla: App ID from FACEBOOK_APP_ID, secret from FACEBOOK_CLIENT_SECRET.
 * Customers never configure these — they just click Connect and OAuth in.
 * Per-user platform_configs rows are ignored for facebook/instagram.
 */
export function ownerMetaAppCredentials(): MetaAppCreds {
  const clientId = (process.env.FACEBOOK_APP_ID ?? "").trim();
  const clientSecret = resolvePlatformSecret("facebook");
  if (!clientId || clientId.startsWith("DEMO_")) return { ok: false, missing: "app-id" };
  if (!clientSecret) return { ok: false, missing: "app-secret" };
  return { ok: true, clientId, clientSecret: clientSecret as string };
}

async function facebookAppCredentials(_ctx: AppCtx, _userId: number): Promise<MetaAppCreds> {
  return ownerMetaAppCredentials();
}

/** Instagram shares the owner's Meta app with Facebook (same App ID + secret). */
async function instagramAppCredentials(_ctx: AppCtx, _userId: number): Promise<MetaAppCreds> {
  return ownerMetaAppCredentials();
}

/** Boolean only — never leaks values. Used for the admin status line. */
export function isMetaAppConfigured(): boolean {
  return ownerMetaAppCredentials().ok;
}

/**
 * Owner-level YouTube OAuth credentials. ONE Google Cloud OAuth client for
 * the whole site: client ID from YOUTUBE_CLIENT_ID, secret from
 * YOUTUBE_CLIENT_SECRET. Customers never configure these.
 */
export function ownerYoutubeCredentials(): MetaAppCreds {
  const clientId = (process.env.YOUTUBE_CLIENT_ID ?? "").trim();
  const clientSecret = resolvePlatformSecret("youtube");
  if (!clientId || clientId.startsWith("DEMO_")) return { ok: false, missing: "app-id" };
  if (!clientSecret) return { ok: false, missing: "app-secret" };
  return { ok: true, clientId, clientSecret: clientSecret as string };
}

/** Boolean only — never leaks values. Used for the admin status line. */
export function isYoutubeConfigured(): boolean {
  return ownerYoutubeCredentials().ok;
}

export const actions: Record<string, ActionDef> = {
  getPublicConfig: {
    request: z.object({}),
    async handler() {
      return { demoMode: isDemoMode() };
    },
  },
  createDemoSession: {
    request: z.object({}),
    async handler(ctx): Promise<z.infer<typeof authResponse>> {
      const nonce = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const email = `demo-${nonce}@marketing-app.local`;
      const salt = crypto.randomUUID();
      const inserted = await ctx.db.insert(schema.users).values({
        email,
        displayName: "Demo creator",
        passwordHash: await digestPassword(crypto.randomUUID(), salt),
        passwordSalt: salt,
        demoMode: true,
        createdAt: new Date(),
      }).returning({ id: schema.users.id });
      const row = inserted[0];
      if (!row) return { ok: false, message: "The demo workspace could not be created. Try again.", sessionToken: null, user: null };
      await initializeConfigs(ctx, row.id);
      const sessionToken = await createSession(ctx, row.id);
      return {
        ok: true,
        message: "Demo workspace ready.",
        sessionToken,
        user: { id: row.id, email, displayName: "Demo creator", demoMode: true, role: "user" },
      };
    },
  },

  signup: {
    request: z.object({
      email: z.string().email().max(200),
      displayName: z.string().trim().min(2).max(80),
      password: z.string().min(8).max(200),
    }),
    async handler(ctx, args): Promise<z.infer<typeof authResponse>> {
      const email = args.email.trim().toLowerCase();
      const existing = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
      if (existing[0]) return { ok: false, message: "An account already uses that email. Sign in instead.", sessionToken: null, user: null };
      const salt = crypto.randomUUID();
      const role = isAdminEmail(email) ? "admin" : "user";
      const inserted = await ctx.db.insert(schema.users).values({
        email,
        displayName: args.displayName.trim(),
        passwordHash: await digestPassword(args.password, salt),
        passwordSalt: salt,
        role,
        demoMode: true,
        createdAt: new Date(),
      }).returning({ id: schema.users.id });
      const row = inserted[0];
      if (!row) return { ok: false, message: "Your account could not be created. Try again.", sessionToken: null, user: null };
      await initializeConfigs(ctx, row.id);
      const sessionToken = await createSession(ctx, row.id);
      return { ok: true, message: "Account created.", sessionToken, user: { id: row.id, email, displayName: args.displayName.trim(), demoMode: true, role } };
    },
  },

  login: {
    request: z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }),
    async handler(ctx, args): Promise<z.infer<typeof authResponse>> {
      const email = args.email.trim().toLowerCase();
      const rows = await ctx.db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
      const user = rows[0];
      if (!user || user.passwordHash !== await digestPassword(args.password, user.passwordSalt)) {
        return { ok: false, message: "That email and password do not match. Check both and try again.", sessionToken: null, user: null };
      }
      let role = user.role ?? "user";
      if (isAdminEmail(user.email) && role !== "admin") {
        await ctx.db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, user.id));
        role = "admin";
      }
      const sessionToken = await createSession(ctx, user.id);
      return { ok: true, message: "Signed in.", sessionToken, user: { id: user.id, email: user.email, displayName: user.displayName, demoMode: user.demoMode, role } };
    },
  },

  /** Password reset: token itself is never stored, only its SHA-256 hash. */
  requestPasswordReset: {
    request: z.object({ email: z.string().email().max(200) }),
    async handler(ctx, args): Promise<z.infer<typeof accountResponse>> {
      const email = args.email.trim().toLowerCase();
      const rows = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
      // Always respond the same way so the endpoint can't be used to enumerate accounts.
      const done = { ok: true, message: "If that email has an account, a reset link is on its way. It expires in 1 hour." };
      if (!rows[0]) return done;
      const userId = rows[0].id;
      // Invalidate any older unused tokens for this user.
      await ctx.db.delete(schema.passwordResets).where(and(eq(schema.passwordResets.userId, userId)));
      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
      const tokenHash = await hashResetToken(token);
      await ctx.db.insert(schema.passwordResets).values({
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdAt: new Date(),
      });
      const resetUrl = `${appBaseUrl()}/reset?token=${token}`;
      // No transactional email is configured yet; log the link so the owner can relay it.
      console.log(`[password-reset] Reset link for ${email}: ${resetUrl}`);
      return done;
    },
  },

  resetPassword: {
    request: z.object({ token: z.string().min(1).max(200), password: z.string().min(8).max(200) }),
    async handler(ctx, args): Promise<z.infer<typeof accountResponse>> {
      const tokenHash = await hashResetToken(args.token.trim());
      const rows = await ctx.db.select().from(schema.passwordResets).where(eq(schema.passwordResets.tokenHash, tokenHash)).limit(1);
      const reset = rows[0];
      if (!reset || reset.usedAt || reset.expiresAt.getTime() <= Date.now()) {
        return { ok: false, message: "That reset link is invalid or has expired. Request a new one." };
      }
      const salt = crypto.randomUUID();
      await ctx.db.update(schema.users)
        .set({ passwordHash: await digestPassword(args.password, salt), passwordSalt: salt })
        .where(eq(schema.users.id, reset.userId));
      await ctx.db.update(schema.passwordResets).set({ usedAt: new Date() }).where(eq(schema.passwordResets.id, reset.id));
      return { ok: true, message: "Your password was updated. Sign in with your new password." };
    },
  },

  /** Logged-in users only: change password by verifying the current one. No email/reset link involved. */
  changePassword: {
    request: z.object({
      sessionToken: z.string().min(1),
      currentPassword: z.string().min(1).max(200),
      newPassword: z.string().min(8).max(200),
    }),
    async handler(ctx, args): Promise<{ ok: boolean; message: string }> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, message: "You're not signed in." };
      const rows = await ctx.db
        .select({ passwordHash: schema.users.passwordHash, passwordSalt: schema.users.passwordSalt })
        .from(schema.users)
        .where(eq(schema.users.id, user.id))
        .limit(1);
      const row = rows[0];
      if (!row || row.passwordHash !== await digestPassword(args.currentPassword, row.passwordSalt)) {
        return { ok: false, message: "Your current password is incorrect." };
      }
      const salt = crypto.randomUUID();
      await ctx.db.update(schema.users)
        .set({ passwordHash: await digestPassword(args.newPassword, salt), passwordSalt: salt })
        .where(eq(schema.users.id, user.id));
      return { ok: true, message: "Password updated. Use your new password the next time you sign in." };
    },
  },

  /** Admin-only: mint a reset link for any account (used when email delivery isn't available). */
  generatePasswordResetLink: {
    request: z.object({ sessionToken: z.string().min(1), email: z.string().email().max(200) }),
    async handler(ctx, args): Promise<{ ok: boolean; message: string; resetUrl: string | null }> {
      const admin = await requireUser(ctx, args.sessionToken);
      if (!admin || admin.role !== "admin") return { ok: false, message: "Admin access required.", resetUrl: null };
      const email = args.email.trim().toLowerCase();
      const rows = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
      if (!rows[0]) return { ok: false, message: "No account uses that email.", resetUrl: null };
      const userId = rows[0].id;
      await ctx.db.delete(schema.passwordResets).where(and(eq(schema.passwordResets.userId, userId)));
      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
      await ctx.db.insert(schema.passwordResets).values({
        userId,
        tokenHash: await hashResetToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdAt: new Date(),
      });
      return { ok: true, message: "Reset link generated. It expires in 1 hour and can be used once.", resetUrl: `${appBaseUrl()}/reset?token=${token}` };
    },
  },

  getWorkspace: {
    request: z.object({ sessionToken: z.string().min(1) }),
    async handler(ctx, args) {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { authenticated: false, user: null, accounts: [], posts: [] };
      const accounts = await ctx.db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.userId, user.id)).orderBy(schema.connectedAccounts.id);
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const xUsageRows = await ctx.db.select().from(schema.xMonthlyUsage)
        .where(and(eq(schema.xMonthlyUsage.userId, user.id), eq(schema.xMonthlyUsage.yearMonth, ym))).limit(1);
      const postRows = await ctx.db.select().from(schema.posts).where(eq(schema.posts.userId, user.id)).orderBy(desc(schema.posts.createdAt)).limit(40);
      const postIds = postRows.map((post) => post.id);
      const targets = postIds.length > 0
        ? await ctx.db.select().from(schema.postTargets).where(inArray(schema.postTargets.postId, postIds)).orderBy(schema.postTargets.id)
        : [];
      const bumpRows = postIds.length > 0
        ? await ctx.db.select().from(schema.bumpComments).where(inArray(schema.bumpComments.postId, postIds)).orderBy(schema.bumpComments.sequence)
        : [];
      const hydrated = await Promise.all(postRows.map(async (post) => ({
        id: post.id,
        body: post.body,
        youtubeTitle: post.youtubeTitle,
        mediaName: post.mediaName,
        mediaType: post.mediaType,
        mediaUrl: post.mediaBlobKey ? await ctx.blobs.getUrl(post.mediaBlobKey) : null,
        publishMode: post.publishMode,
        scheduledAt: post.scheduledAt?.toISOString() ?? null,
        status: post.status,
        bumpEnabled: post.bumpEnabled,
        createdAt: post.createdAt.toISOString(),
        targets: targets.filter((target) => target.postId === post.id).map((target) => ({
          platform: target.platform,
          status: target.status,
          errorMessage: target.errorMessage,
        })),
        bumpComments: bumpRows.filter((comment) => comment.postId === post.id).map((comment) => ({
          id: comment.id,
          sequence: comment.sequence,
          body: comment.body,
          scheduledAt: comment.scheduledAt.toISOString(),
          status: comment.status,
          publishedAt: comment.publishedAt?.toISOString() ?? null,
        })),
      })));
      return {
        authenticated: true,
        user: { id: user.id, email: user.email, displayName: user.displayName, demoMode: user.demoMode, role: user.role ?? "user" },
        xPostsUsed: xUsageRows[0]?.postCount ?? 0,
        xPostsCap: Number(process.env.X_MONTHLY_POST_CAP ?? "60") || 60,
        accounts: accounts.map((account) => ({
          id: account.id,
          platform: account.platform,
          handle: account.handle,
          status: account.status,
          authMode: account.authMode,
          connectedAt: account.connectedAt.toISOString(),
          retryAfter: account.retryAfter?.toISOString() ?? null,
        })),
        posts: hydrated,
      };
    },
  },

  listPlatformSettings: {
    request: z.object({ sessionToken: z.string().min(1) }),
    async handler(ctx, args) {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, platforms: [] };
      const configs = await ctx.db.select().from(schema.platformConfigs).where(eq(schema.platformConfigs.userId, user.id));
      const nowYm = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
      const xUsage = await ctx.db.select().from(schema.xMonthlyUsage)
        .where(and(eq(schema.xMonthlyUsage.userId, user.id), eq(schema.xMonthlyUsage.yearMonth, nowYm))).limit(1);
      const tiktokUsage = await ctx.db.select().from(schema.tiktokMonthlyUsage)
        .where(and(eq(schema.tiktokMonthlyUsage.userId, user.id), eq(schema.tiktokMonthlyUsage.yearMonth, nowYm))).limit(1);
      return {
        ok: true,
        xPostsUsed: xUsage[0]?.postCount ?? 0,
        xPostsCap: Number(process.env.X_MONTHLY_POST_CAP ?? "60") || 60,
        tiktokPostsUsed: tiktokUsage[0]?.postCount ?? 0,
        tiktokPostsCap: Number(process.env.TIKTOK_MONTHLY_POST_CAP ?? "60") || 60,
        metaConfigured: isMetaAppConfigured(),
        tiktokConfigured: isTikTokAppConfigured(),
        youtubeConfigured: isYoutubeConfigured(),
        xConfigured: isXAppConfigured(),
        platforms: (Object.keys(PLATFORM_INFO) as Platform[]).map((platform) => {
          const config = configs.find((item) => item.platform === platform);
          const info = PLATFORM_INFO[platform];
          return {
            platform,
            label: info.label,
            clientId: config?.clientId ?? "",
            secretReference: config?.secretReference ?? "",
            developerApp: info.developerApp,
            credentialFields: info.credentialFields,
            warning: info.warning,
            failureHint: info.failureHint,
          };
        }),
      };
    },
  },

  testMetaCredentials: {
    request: z.object({ sessionToken: z.string().min(1) }),
    async handler(ctx, args): Promise<{ ok: boolean; valid: boolean; message: string }> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user || !isAdminEmail(user.email)) return { ok: false, valid: false, message: "Admin only." };
      const creds = ownerMetaAppCredentials();
      if (!creds.ok) return { ok: true, valid: false, message: `Missing ${creds.missing === "app-id" ? "App ID (FACEBOOK_APP_ID)" : "App Secret (FACEBOOK_CLIENT_SECRET)"} on the server.` };
      try {
        const params = new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: "client_credentials" });
        const res = await fetch(`https://graph.facebook.com/v26.0/oauth/access_token?${params.toString()}`);
        const body = await res.json() as any;
        if (body.access_token) return { ok: true, valid: true, message: "Meta accepted the App ID and secret. Ready to connect." };
        const err = body?.error?.message ?? "Unknown error";
        return { ok: true, valid: false, message: `Meta rejected the credentials: ${err} The App ID and secret in Railway do not match. Copy both fresh from the same app.` };
      } catch (err) {
        return { ok: true, valid: false, message: `Could not reach Meta: ${err instanceof Error ? err.message : "network error"}` };
      }
    },
  },

  savePlatformConfig: {
    request: z.object({ sessionToken: z.string().min(1), platform: platformSchema, clientId: z.string().trim().min(1).max(300), secretReference: z.string().trim().max(500).optional().default(""), clientSecret: z.string().trim().max(500).optional().default("") }),
    async handler(ctx, args): Promise<z.infer<typeof accountResponse>> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, message: "Your session expired. Sign in again." };
      if ((args.platform === "facebook" || args.platform === "instagram" || args.platform === "tiktok") && args.clientSecret.trim()) {
        return { ok: false, message: "This app is configured by the site owner. Nothing for you to enter here." };
      }
      if (args.platform === "youtube" && args.clientSecret.trim()) {
        return { ok: false, message: "The YouTube app is configured by the site owner. Nothing for you to enter here." };
      }
      if (args.platform === "x" && args.clientSecret.trim()) {
        return { ok: false, message: "The X app is configured by the site owner. Nothing for you to enter here." };
      }
      let secretEnc: string | null = null;
      if (args.clientSecret.trim()) {
        try {
          secretEnc = encryptToken(args.clientSecret.trim());
        } catch {
          return { ok: false, message: "Server encryption is not configured. Contact support." };
        }
      }
      await ctx.db.insert(schema.platformConfigs).values({
        userId: user.id, platform: args.platform, clientId: args.clientId.trim(), secretReference: args.secretReference.trim(), clientSecretEnc: secretEnc, updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [schema.platformConfigs.userId, schema.platformConfigs.platform],
        set: { clientId: args.clientId.trim(), secretReference: args.secretReference.trim(), ...(secretEnc ? { clientSecretEnc: secretEnc } : {}), updatedAt: new Date() },
      });
      ctx.invalidateQueries();
      return { ok: true, message: `${PLATFORM_INFO[args.platform as Platform].label} configuration saved.` };
    },
  },

  connectDemoAccount: {
    request: z.object({ sessionToken: z.string().min(1), platform: platformSchema }),
    async handler(ctx, args): Promise<z.infer<typeof accountResponse>> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, message: "Your session expired. Sign in again." };
      if (!isDemoMode()) {
        return { ok: false, message: "Real connections for this platform aren't built yet. Facebook is ready once you add your App ID." };
      }
      return demoConnectAccount(ctx, user, args.platform);
    },
  },

  /**
   * Facebook connect entry point. Uses real OAuth when the App ID is set in
   * Settings and FACEBOOK_CLIENT_SECRET is configured; otherwise falls back
   * to the simulated demo connect (existing behavior).
   */
  connectFacebook: {
    request: z.object({ sessionToken: z.string().min(1) }),
    async handler(ctx, args): Promise<{ ok: boolean; message: string; mode: "oauth" | "demo"; authUrl: string | null }> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, message: "Your session expired. Sign in again.", mode: "demo", authUrl: null };
      const creds = await facebookAppCredentials(ctx, user.id);
      if (!creds.ok) {
        if (!isDemoMode()) {
          const what = creds.missing === "app-id"
            ? "Facebook isn't set up yet — the site owner needs to add the Meta App ID (FACEBOOK_APP_ID)."
            : "Facebook isn't set up yet — the site owner needs to add the Meta App Secret (FACEBOOK_CLIENT_SECRET).";
          return { ok: false, message: what, mode: "oauth", authUrl: null };
        }
        const demo = await demoConnectAccount(ctx, user, "facebook");
        return { ...demo, mode: "demo", authUrl: null };
      }
      try {
        requireTokenEncryption();
      } catch {
        return { ok: false, message: "Set TOKEN_ENCRYPTION_KEY on the server before connecting Facebook.", mode: "oauth", authUrl: null };
      }
      const redirectUri = facebookRedirectUri(ctx.origin);
      const state = crypto.randomUUID();
      const now = new Date();
      await ctx.db.insert(schema.oauthStates).values({
        state,
        userId: user.id,
        platform: "facebook",
        redirectUri,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      });
      const authUrl = buildFacebookAuthUrl({ clientId: creds.clientId, redirectUri, state });
      return { ok: true, message: "Opening Facebook…", mode: "oauth", authUrl };
    },
  },

  /**
   * Instagram connect entry point. Instagram shares the Meta app (and App
   * ID) with Facebook: the App ID is read from the Facebook platform
   * config, the secret from FACEBOOK_CLIENT_SECRET. Without them it
   * refuses in production (never a silent demo), mirroring connectFacebook.
   */
  connectInstagram: {
    request: z.object({ sessionToken: z.string().min(1) }),
    async handler(ctx, args): Promise<{ ok: boolean; message: string; mode: "oauth" | "demo"; authUrl: string | null }> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, message: "Your session expired. Sign in again.", mode: "demo", authUrl: null };
      const creds = await instagramAppCredentials(ctx, user.id);
      if (!creds.ok) {
        if (!isDemoMode()) {
          const what = creds.missing === "app-id"
            ? "Instagram isn't set up yet — the site owner needs to add the Meta App ID (FACEBOOK_APP_ID)."
            : "Instagram isn't set up yet — the site owner needs to add the Meta App Secret (FACEBOOK_CLIENT_SECRET).";
          return { ok: false, message: what, mode: "oauth", authUrl: null };
        }
        const demo = await demoConnectAccount(ctx, user, "instagram");
        return { ...demo, mode: "demo", authUrl: null };
      }
      try {
        requireTokenEncryption();
      } catch {
        return { ok: false, message: "Set TOKEN_ENCRYPTION_KEY on the server before connecting Instagram.", mode: "oauth", authUrl: null };
      }
      const redirectUri = instagramRedirectUri(ctx.origin);
      const state = crypto.randomUUID();
      const now = new Date();
      await ctx.db.insert(schema.oauthStates).values({
        state,
        userId: user.id,
        platform: "instagram",
        redirectUri,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      });
      const authUrl = buildInstagramAuthUrl({ clientId: creds.clientId, redirectUri, state });
      return { ok: true, message: "Opening Instagram…", mode: "oauth", authUrl };
    },
  },

  connectYoutube: {
    request: z.object({ sessionToken: z.string().min(1) }),
    async handler(ctx, args): Promise<{ ok: boolean; message: string; mode: "oauth" | "demo"; authUrl: string | null }> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, message: "Your session expired. Sign in again.", mode: "demo", authUrl: null };
      const creds = ownerYoutubeCredentials();
      if (!creds.ok) {
        if (!isDemoMode()) {
          const what = creds.missing === "app-id"
            ? "YouTube isn't set up yet — the site owner needs to add the Google OAuth client ID (YOUTUBE_CLIENT_ID)."
            : "YouTube isn't set up yet — the site owner needs to add the Google OAuth client secret (YOUTUBE_CLIENT_SECRET).";
          return { ok: false, message: what, mode: "oauth", authUrl: null };
        }
        const demo = await demoConnectAccount(ctx, user, "youtube");
        return { ...demo, mode: "demo", authUrl: null };
      }
      try {
        requireTokenEncryption();
      } catch {
        return { ok: false, message: "Set TOKEN_ENCRYPTION_KEY on the server before connecting YouTube.", mode: "oauth", authUrl: null };
      }
      const redirectUri = youtubeRedirectUri(ctx.origin);
      const state = crypto.randomUUID();
      const now = new Date();
      await ctx.db.insert(schema.oauthStates).values({
        state,
        userId: user.id,
        platform: "youtube",
        redirectUri,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      });
      const authUrl = buildYoutubeAuthUrl({ clientId: creds.clientId, redirectUri, state });
      return { ok: true, message: "Opening YouTube…", mode: "oauth", authUrl };
    },
  },

  connectTikTok: {
    request: z.object({ sessionToken: z.string().min(1) }),
    async handler(ctx, args): Promise<{ ok: boolean; message: string; mode: "oauth" | "demo"; authUrl: string | null }> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, message: "Your session expired. Sign in again.", mode: "demo", authUrl: null };
      const creds = ownerTikTokCredentials();
      if (!creds.ok) {
        if (!isDemoMode()) {
          const what = creds.missing === "app-id"
            ? "TikTok isn't set up yet — the site owner needs to add the TikTok Client Key (TIKTOK_CLIENT_KEY)."
            : "TikTok isn't set up yet — the site owner needs to add the TikTok Client Secret (TIKTOK_CLIENT_SECRET).";
          return { ok: false, message: what, mode: "oauth", authUrl: null };
        }
        const demo = await demoConnectAccount(ctx, user, "tiktok");
        return { ...demo, mode: "demo", authUrl: null };
      }
      try {
        requireTokenEncryption();
      } catch {
        return { ok: false, message: "Set TOKEN_ENCRYPTION_KEY on the server before connecting TikTok.", mode: "oauth", authUrl: null };
      }
      const redirectUri = tiktokRedirectUri(ctx.origin);
      const state = crypto.randomUUID();
      const now = new Date();
      await ctx.db.insert(schema.oauthStates).values({
        state,
        userId: user.id,
        platform: "tiktok",
        redirectUri,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      });
      const authUrl = buildTikTokAuthUrl({ clientKey: creds.clientId, redirectUri, state });
      return { ok: true, message: "Opening TikTok…", mode: "oauth", authUrl };
    },
  },

  /**
   * X connect entry point. Uses real OAuth 2.0 with PKCE when the owner's
   * X app is configured (X_CLIENT_ID + X_CLIENT_SECRET); otherwise refuses
   * in production (never a silent demo), mirroring the other platforms.
   * The PKCE code_verifier is stored with the single-use CSRF state.
   */
  connectX: {
    request: z.object({ sessionToken: z.string().min(1) }),
    async handler(ctx, args): Promise<{ ok: boolean; message: string; mode: "oauth" | "demo"; authUrl: string | null }> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, message: "Your session expired. Sign in again.", mode: "demo", authUrl: null };
      const creds = ownerXCredentials();
      if (!creds.ok) {
        if (!isDemoMode()) {
          const what = creds.missing === "app-id"
            ? "X isn't set up yet — the site owner needs to add the X Client ID (X_CLIENT_ID)."
            : "X isn't set up yet — the site owner needs to add the X Client Secret (X_CLIENT_SECRET).";
          return { ok: false, message: what, mode: "oauth", authUrl: null };
        }
        const demo = await demoConnectAccount(ctx, user, "x");
        return { ...demo, mode: "demo", authUrl: null };
      }
      try {
        requireTokenEncryption();
      } catch {
        return { ok: false, message: "Set TOKEN_ENCRYPTION_KEY on the server before connecting X.", mode: "oauth", authUrl: null };
      }
      const redirectUri = xRedirectUri(ctx.origin);
      const state = crypto.randomUUID();
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);
      const now = new Date();
      await ctx.db.insert(schema.oauthStates).values({
        state,
        userId: user.id,
        platform: "x",
        redirectUri,
        codeVerifier,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      });
      const authUrl = buildXAuthUrl({ clientId: creds.clientId, redirectUri, state, codeChallenge });
      return { ok: true, message: "Opening X…", mode: "oauth", authUrl };
    },
  },

  /** Instagram professional accounts reachable through the user's Pages (for the account picker). */
  listInstagramAccounts: {
    request: z.object({ sessionToken: z.string().min(1) }),
    async handler(ctx, args): Promise<{ ok: boolean; accounts: Array<{ igUserId: string; username: string; pageId: string; pageName: string }>; selectedIgUserId: string | null; error?: string }> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, accounts: [], selectedIgUserId: null };
      const rows = await ctx.db.select().from(schema.instagramConnections).where(eq(schema.instagramConnections.userId, user.id)).limit(1);
      const conn = rows[0];
      if (!conn) return { ok: true, accounts: [], selectedIgUserId: null };
      let userToken: string;
      try {
        userToken = decryptToken(conn.userTokenEncrypted);
      } catch {
        return { ok: false, accounts: [], selectedIgUserId: conn.igUserId, error: "Stored token could not be decrypted." };
      }
      try {
        const accounts = await listInstagramBusinessAccounts(userToken);
        return { ok: true, accounts, selectedIgUserId: conn.igUserId };
      } catch (err) {
        return { ok: false, accounts: [], selectedIgUserId: conn.igUserId, error: err instanceof Error ? err.message : String(err) };
      }
    },
  },

  /** Switch the Instagram account that zepostia posts as. */
  selectInstagramAccount: {
    request: z.object({ sessionToken: z.string().min(1), igUserId: z.string().min(1).max(100) }),
    async handler(ctx, args): Promise<z.infer<typeof accountResponse>> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, message: "Your session expired. Sign in again." };
      const rows = await ctx.db.select().from(schema.instagramConnections).where(eq(schema.instagramConnections.userId, user.id)).limit(1);
      const conn = rows[0];
      if (!conn) return { ok: false, message: "Instagram is not connected." };
      let userToken: string;
      try {
        userToken = decryptToken(conn.userTokenEncrypted);
      } catch {
        return { ok: false, message: "The stored Instagram token could not be decrypted. Reconnect the channel." };
      }
      const accounts = await listInstagramBusinessAccounts(userToken).catch(() => []);
      const account = accounts.find((a) => a.igUserId === args.igUserId);
      if (!account) return { ok: false, message: "That Instagram account was not found on your Pages." };
      const now = new Date();
      await ctx.db
        .update(schema.instagramConnections)
        .set({ igUserId: account.igUserId, igUsername: account.username, pageId: account.pageId, pageName: account.pageName, updatedAt: now })
        .where(eq(schema.instagramConnections.id, conn.id));
      await ctx.db
        .update(schema.connectedAccounts)
        .set({ handle: `@${account.username}` })
        .where(and(eq(schema.connectedAccounts.userId, user.id), eq(schema.connectedAccounts.platform, "instagram")));
      ctx.invalidateQueries();
      return { ok: true, message: `Now posting as @${account.username}.` };
    },
  },

  /** Pages on the connected Facebook account (for the Page picker). */
  listFacebookPages: {
    request: z.object({ sessionToken: z.string().min(1) }),
    async handler(ctx, args): Promise<{ ok: boolean; pages: Array<{ id: string; name: string }>; selectedPageId: string | null; error?: string }> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, pages: [], selectedPageId: null };
      const rows = await ctx.db.select().from(schema.facebookConnections).where(eq(schema.facebookConnections.userId, user.id)).limit(1);
      const conn = rows[0];
      if (!conn) return { ok: true, pages: [], selectedPageId: null };
      let userToken: string;
      try {
        userToken = decryptToken(conn.userTokenEncrypted);
      } catch {
        return { ok: false, pages: [], selectedPageId: conn.pageId, error: "Stored token could not be decrypted." };
      }
      try {
        const pages = await getManagedPages(userToken);
        return { ok: true, pages: pages.map((p) => ({ id: p.id, name: p.name })), selectedPageId: conn.pageId };
      } catch (err) {
        return { ok: false, pages: [], selectedPageId: conn.pageId, error: err instanceof Error ? err.message : String(err) };
      }
    },
  },

  /** Switch the Page that zepostia posts as. */
  selectFacebookPage: {
    request: z.object({ sessionToken: z.string().min(1), pageId: z.string().min(1).max(100) }),
    async handler(ctx, args): Promise<z.infer<typeof accountResponse>> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, message: "Your session expired. Sign in again." };
      const rows = await ctx.db.select().from(schema.facebookConnections).where(eq(schema.facebookConnections.userId, user.id)).limit(1);
      const conn = rows[0];
      if (!conn) return { ok: false, message: "Facebook is not connected." };
      let userToken: string;
      try {
        userToken = decryptToken(conn.userTokenEncrypted);
      } catch {
        return { ok: false, message: "The stored Facebook token could not be decrypted. Reconnect the channel." };
      }
      const pages = await getManagedPages(userToken).catch(() => []);
      const page = pages.find((p) => p.id === args.pageId);
      if (!page) return { ok: false, message: "That Page was not found on your Facebook account." };
      const now = new Date();
      await ctx.db
        .update(schema.facebookConnections)
        .set({ pageId: page.id, pageName: page.name, pageTokenEncrypted: encryptToken(page.accessToken), updatedAt: now })
        .where(eq(schema.facebookConnections.id, conn.id));
      await ctx.db
        .update(schema.connectedAccounts)
        .set({ handle: page.name })
        .where(and(eq(schema.connectedAccounts.userId, user.id), eq(schema.connectedAccounts.platform, "facebook")));
      ctx.invalidateQueries();
      return { ok: true, message: `Now posting as ${page.name}.` };
    },
  },

  disconnectAccount: {
    request: z.object({ sessionToken: z.string().min(1), accountId: z.number().int().positive() }),
    async handler(ctx, args): Promise<z.infer<typeof accountResponse>> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, message: "Your session expired. Sign in again." };
      const rows = await ctx.db.select().from(schema.connectedAccounts).where(and(eq(schema.connectedAccounts.id, args.accountId), eq(schema.connectedAccounts.userId, user.id))).limit(1);
      if (!rows[0]) return { ok: false, message: "That connected account was not found." };
      await ctx.db.delete(schema.connectedAccounts).where(eq(schema.connectedAccounts.id, args.accountId));
      ctx.invalidateQueries();
      return { ok: true, message: "Account disconnected." };
    },
  },

  createPost: {
    request: z.object({
      sessionToken: z.string().min(1),
      body: z.string().max(5000),
      youtubeTitle: z.string().max(100).optional(),
      accountIds: z.array(z.number().int().positive()).min(1),
      publishMode: z.enum(["now", "scheduled"]),
      scheduledAt: z.string().datetime().optional(),
      bumpComments: z.array(z.string().trim().min(1).max(500)).min(2).max(4).optional(),
      media: z.object({ name: z.string().min(1).max(240), mimeType: z.string().min(1).max(100), dataBase64: z.string().min(1) }).optional(),
    }),
    async handler(ctx, args) {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, message: "Your session expired. Sign in again.", postId: null };
      const accounts = await ctx.db.select().from(schema.connectedAccounts).where(and(eq(schema.connectedAccounts.userId, user.id), inArray(schema.connectedAccounts.id, args.accountIds)));
      if (accounts.length !== args.accountIds.length) return { ok: false, message: "One of the selected accounts is no longer connected. Refresh and choose again.", postId: null };
      const unhealthy = accounts.find((account) => account.status !== "connected");
      if (unhealthy) return { ok: false, message: `${PLATFORM_INFO[unhealthy.platform].label} needs attention. Reconnect that account before publishing.`, postId: null };
      const platforms = accounts.map((account) => account.platform);
      if ((platforms.includes("instagram") || platforms.includes("tiktok")) && !args.media) return { ok: false, message: "Instagram and TikTok require an image or video. Add media or remove those targets.", postId: null };
      if (platforms.includes("youtube") && (!args.media?.mimeType.startsWith("video/") || !args.youtubeTitle?.trim())) return { ok: false, message: "YouTube requires a video and a title. Add both or remove YouTube.", postId: null };
      if (platforms.includes("x") && args.body.length > 280) return { ok: false, message: "X allows 280 characters. Shorten the post or remove X.", postId: null };
      // X add-on gate: only enforced when tiers are configured
      // (STRIPE_X_TIERS). Unconfigured deployments keep legacy behavior.
      if (platforms.includes("x") && isXAddonConfigured()) {
        const billing = await billingUser(ctx, args.sessionToken);
        const gate = billing
          ? await canPostToX(ctx.db, billing, { hasLink: /https?:\/\/|www\./i.test(args.body) })
          : null;
        if (!gate?.allowed) {
          return {
            ok: false,
            message:
              gate?.reason === "cap_reached"
                ? "You've reached your X add-on tier's limit for this billing period. Remove X, or post again next period."
                : "X posting is part of the X add-on. Add it in Settings under Billing to post to X.",
            postId: null,
          };
        }
      }
      if (!args.body.trim() && !args.media) return { ok: false, message: "Add text or media before publishing.", postId: null };
      const scheduledAt = args.publishMode === "scheduled" && args.scheduledAt ? new Date(args.scheduledAt) : null;
      if (args.publishMode === "scheduled" && (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now())) return { ok: false, message: "Choose a future date and time for this scheduled post.", postId: null };
      let mediaBlobKey: string | null = null;
      if (args.media) {
        if (!args.media.mimeType.startsWith("image/") && !args.media.mimeType.startsWith("video/")) return { ok: false, message: "Choose an image or video file.", postId: null };
        const bytes = Buffer.from(args.media.dataBase64, "base64");
        if (bytes.byteLength > 12 * 1024 * 1024) return { ok: false, message: "This demo accepts files up to 12 MB. Choose a smaller file.", postId: null };
        const safeName = args.media.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        mediaBlobKey = `uploads/${user.id}/${crypto.randomUUID()}-${safeName}`;
        await ctx.blobs.put(mediaBlobKey, bytes, { contentType: args.media.mimeType });
      }
      const now = new Date();
      const inserted = await ctx.db.insert(schema.posts).values({
        userId: user.id,
        body: args.body.trim(),
        youtubeTitle: args.youtubeTitle?.trim() || null,
        mediaBlobKey,
        mediaName: args.media?.name ?? null,
        mediaType: args.media?.mimeType ?? null,
        publishMode: args.publishMode,
        scheduledAt,
        status: "pending",
        bumpEnabled: Boolean(args.bumpComments?.length),
        createdAt: now,
        updatedAt: now,
      }).returning({ id: schema.posts.id });
      const post = inserted[0];
      if (!post) return { ok: false, message: "The post could not be queued. Try again.", postId: null };
      await ctx.db.insert(schema.postTargets).values(accounts.map((account) => ({
        postId: post.id,
        accountId: account.id,
        platform: account.platform,
        status: "pending" as const,
        errorMessage: null,
        remoteId: null,
        publishedAt: null,
      })));
      let publishNote: string;
      if (args.publishMode === "now") {
        const result = await publishPendingTargets(ctx, post.id);
        if (result.published === 0 && result.failed > 0) {
          return { ok: false, message: `Publishing failed: ${result.firstError ?? "unknown error"}`, postId: post.id };
        }
        publishNote = result.real > 0
          ? `Published${result.published > result.real ? " (some targets simulated)" : ""}.`
          : "Publish complete (simulated — no external API was called).";
      } else {
        publishNote = "Post scheduled.";
      }
      if (args.bumpComments?.length) {
        const baseTime = scheduledAt ?? now;
        const offsets = bumpOffsets(args.bumpComments.length);
        await ctx.db.insert(schema.bumpComments).values((args.bumpComments as string[]).map((comment: string, index: number) => ({
          postId: post.id,
          sequence: index + 1,
          body: comment.trim(),
          scheduledAt: new Date(baseTime.getTime() + (offsets[index] ?? 23) * 60 * 60 * 1000),
          status: "pending" as const,
          publishedAt: null,
          errorMessage: null,
        })));
      }
      ctx.invalidateQueries();
      const scheduleNote = args.bumpComments?.length ? ` ${args.bumpComments.length} follow-up comments are staggered across the next 24 hours.` : "";
      return {
        ok: true,
        message: publishNote + scheduleNote,
        postId: post.id,
      };
    },
  },

  advanceBumpDemo: {
    request: z.object({ sessionToken: z.string().min(1), postId: z.number().int().positive() }),
    async handler(ctx, args): Promise<z.infer<typeof accountResponse>> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, message: "Your session expired. Sign in again." };
      const owned = await ctx.db.select({ id: schema.posts.id }).from(schema.posts).where(and(eq(schema.posts.id, args.postId), eq(schema.posts.userId, user.id))).limit(1);
      if (!owned[0]) return { ok: false, message: "That post was not found." };
      const pending = await ctx.db.select().from(schema.bumpComments).where(and(eq(schema.bumpComments.postId, args.postId), eq(schema.bumpComments.status, "pending"))).orderBy(schema.bumpComments.sequence).limit(1);
      const next = pending[0];
      if (!next) return { ok: false, message: "This post has no pending bump comments." };
      // Real Facebook comments go out through the Graph API when the post
      // went out through a real connection; otherwise simulated as before.
      const result = await publishBumpCommentNow(ctx, next.id);
      ctx.invalidateQueries();
      return result;
    },
  },

  cancelBumpPlan: {
    request: z.object({ sessionToken: z.string().min(1), postId: z.number().int().positive() }),
    async handler(ctx, args): Promise<z.infer<typeof accountResponse>> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, message: "Your session expired. Sign in again." };
      const owned = await ctx.db.select({ id: schema.posts.id }).from(schema.posts).where(and(eq(schema.posts.id, args.postId), eq(schema.posts.userId, user.id))).limit(1);
      if (!owned[0]) return { ok: false, message: "That post was not found." };
      await ctx.db.transaction(async (tx) => {
        await tx.update(schema.bumpComments).set({ status: "cancelled" }).where(and(eq(schema.bumpComments.postId, args.postId), eq(schema.bumpComments.status, "pending")));
        await tx.update(schema.posts).set({ bumpEnabled: false, updatedAt: new Date() }).where(eq(schema.posts.id, args.postId));
      });
      ctx.invalidateQueries();
      return { ok: true, message: "Remaining follow-up comments cancelled." };
    },
  },

  cancelPost: {
    request: z.object({ sessionToken: z.string().min(1), postId: z.number().int().positive() }),
    async handler(ctx, args): Promise<z.infer<typeof accountResponse>> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, message: "Your session expired. Sign in again." };
      const rows = await ctx.db.select().from(schema.posts).where(and(eq(schema.posts.id, args.postId), eq(schema.posts.userId, user.id))).limit(1);
      const post = rows[0];
      if (!post) return { ok: false, message: "That scheduled post was not found." };
      if (post.status !== "pending") return { ok: false, message: "Only pending posts can be cancelled." };
      await ctx.db.transaction(async (tx) => {
        await tx.update(schema.posts).set({ status: "cancelled", bumpEnabled: false, updatedAt: new Date() }).where(eq(schema.posts.id, post.id));
        await tx.update(schema.postTargets).set({ status: "cancelled" }).where(eq(schema.postTargets.postId, post.id));
        await tx.update(schema.bumpComments).set({ status: "cancelled" }).where(and(eq(schema.bumpComments.postId, post.id), eq(schema.bumpComments.status, "pending")));
      });
      ctx.invalidateQueries();
      return { ok: true, message: "Scheduled post cancelled." };
    },
  },

  /**
   * Start a Stripe Checkout subscription for the $19.88/month zepostia plan.
   * 14-day free trial: the card is collected at checkout, the first charge
   * lands on day 15. Creates and stores a Stripe customer on first use.
   *
   * An X add-on tier can be picked in the same purchase
   * (xAddonTierPriceId). The trial NEVER covers the tier: the tier's
   * first month rides the session as a one-time line item on the tier's
   * own product — one-time items are due at checkout even when the
   * recurring items trial, so the Checkout page shows the tier amount
   * as due today next to the base plan's "14 days free". The tier then
   * renews on its own add-on subscription, created at checkout
   * completion with its first renewal deferred to the end of the
   * prepaid month (see ensureXAddonSubscription in billing.ts).
   */
  createCheckoutSession: {
    request: z.object({
      sessionToken: z.string().min(1),
      xAddonTierPriceId: z.string().min(1).optional(),
    }),
    async handler(ctx, args): Promise<{ url: string }> {
      const user = await billingUserSynced(ctx, args.sessionToken);
      if (!user) throw new Error("Your session expired. Sign in again.");
      const stripe = getStripe();
      const priceId = process.env.STRIPE_PRICE_ID;
      if (!priceId) throw new Error("Billing is not configured yet.");
      if (["trialing", "active", "past_due"].includes(user.subscriptionStatus) && user.stripeCustomerId) {
        throw new Error("You already have a subscription — use Manage billing to update it.");
      }
      let tier: XAddonTier | undefined;
      if (args.xAddonTierPriceId) {
        tier = xAddonTierForPriceId(args.xAddonTierPriceId);
        if (!tier) throw new Error("That X add-on tier is not available.");
      }
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { userId: String(user.id) },
        });
        customerId = customer.id;
        await ctx.db.update(schema.users).set({ stripeCustomerId: customerId }).where(eq(schema.users.id, user.id));
      }
      const lineItems: Array<{
        price?: string;
        price_data?: { currency: string; product: string; unit_amount: number };
        quantity: number;
      }> = [{ price: priceId, quantity: 1 }];
      if (tier) {
        // The tier's first month as a one-time price on the tier's own
        // product, mirroring the tier price's amount and currency.
        const tierPrice = await stripe.prices.retrieve(tier.priceId);
        const productId = typeof tierPrice.product === "string" ? tierPrice.product : tierPrice.product?.id;
        if (!productId || tierPrice.unit_amount == null) {
          throw new Error("That X add-on tier is not available.");
        }
        lineItems.push({
          price_data: { currency: tierPrice.currency, product: productId, unit_amount: tierPrice.unit_amount },
          quantity: 1,
        });
      }
      const url = baseUrl(ctx.origin);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: String(user.id),
        line_items: lineItems,
        subscription_data: {
          trial_period_days: TRIAL_DAYS,
          ...(tier ? { metadata: { xAddonTierPriceId: tier.priceId } } : {}),
        },
        ...(tier ? { metadata: { xAddonTierPriceId: tier.priceId } } : {}),
        success_url: `${url}/?billing=success`,
        cancel_url: `${url}/?billing=cancelled`,
      });
      if (!session.url) throw new Error("Could not start checkout. Try again.");
      return { url: session.url };
    },
  },

  /**
   * Stripe Customer Portal session so subscribers can update their card or
   * cancel without us handling payment details.
   */
  createPortalSession: {
    request: z.object({ sessionToken: z.string().min(1) }),
    async handler(ctx, args): Promise<{ url: string }> {
      const user = await billingUserSynced(ctx, args.sessionToken);
      if (!user) throw new Error("Your session expired. Sign in again.");
      const stripe = getStripe();
      if (!user.stripeCustomerId) throw new Error("No billing account yet — subscribe first.");
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: baseUrl(ctx.origin),
      });
      return { url: session.url };
    },
  },

  /** Current subscription state for the signed-in user. */
  getBillingStatus: {
    request: z.object({ sessionToken: z.string().min(1) }),
    async handler(
      ctx,
      args,
    ): Promise<{ status: string; trialEndsAt: string | null; currentPeriodEnd: string | null; xAddon: XAddonStatus }> {
      const user = await billingUserSynced(ctx, args.sessionToken);
      if (!user) throw new Error("Your session expired. Sign in again.");
      const status = user.subscriptionStatus || "none";
      const periodEnd = user.currentPeriodEnd ? user.currentPeriodEnd.toISOString() : null;
      return {
        status,
        // During a trial, Stripe sets current_period_end to the trial's end.
        trialEndsAt: status === "trialing" ? periodEnd : null,
        currentPeriodEnd: periodEnd,
        xAddon: await xAddonStatusFor(ctx, user),
      };
    },
  },

  /**
   * Add an X (Twitter) posting add-on tier — or switch tiers. The tier
   * lives on its OWN Stripe subscription so it bills from day one even
   * while the base plan is still trialing: adding creates that
   * subscription with no trial (the first invoice charges
   * immediately), switching swaps its item price with prorations. A
   * tier still riding on the base subscription (legacy representation)
   * is moved over. The entitlement is re-synced from Stripe
   * immediately; the webhook keeps it in sync afterwards. The tier
   * price IDs come only from STRIPE_X_TIERS.
   */
  setXAddonTier: {
    request: z.object({ sessionToken: z.string().min(1), priceId: z.string().min(1) }),
    async handler(ctx, args): Promise<{ activeTier: string | null }> {
      const user = await billingUserSynced(ctx, args.sessionToken);
      if (!user) throw new Error("Your session expired. Sign in again.");
      const tier = xAddonTierForPriceId(args.priceId);
      if (!tier) throw new Error("That X add-on tier is not available.");
      if (!["trialing", "active", "past_due"].includes(user.subscriptionStatus) || !user.stripeSubscriptionId || !user.stripeCustomerId) {
        throw new Error("Start your subscription first — the X add-on attaches to your plan.");
      }
      const stripe = getStripe();
      const customerId = user.stripeCustomerId;
      const base = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      // Legacy representation: move a tier item off the base
      // subscription — from here on the tier bills on its own
      // subscription so the base plan's trial can never cover it.
      const legacyItem = xAddonSubscriptionItem(base);
      if (legacyItem) {
        await stripe.subscriptionItems.del(legacyItem.id, { proration_behavior: "create_prorations" });
      }
      const subs = (await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 })).data;
      const addon = subs.find(
        (s) => isXAddonSubscription(s) && ["trialing", "active", "past_due"].includes(s.status),
      );
      if (addon) {
        const item = xAddonSubscriptionItem(addon);
        if (item && item.price?.id !== tier.priceId) {
          await stripe.subscriptionItems.update(item.id, {
            price: tier.priceId,
            proration_behavior: "create_prorations",
          });
        } else if (!item) {
          await stripe.subscriptionItems.create({
            subscription: addon.id,
            price: tier.priceId,
            proration_behavior: "create_prorations",
          });
        }
      } else {
        const paymentMethod = await subscriptionDefaultPaymentMethod(stripe, base);
        const created = await stripe.subscriptions.create({
          customer: customerId,
          items: [{ price: tier.priceId }],
          ...(paymentMethod ? { default_payment_method: paymentMethod } : {}),
          metadata: {
            [X_ADDON_SUBSCRIPTION_METADATA]: "1",
            userId: String(user.id),
            tierPriceId: tier.priceId,
          },
        });
        if (created.status === "incomplete") {
          // The day-one charge failed — leave no dangling
          // subscription behind and tell the customer plainly.
          await stripe.subscriptions.cancel(created.id).catch(() => undefined);
          throw new Error("Your card couldn't be charged for the X add-on. Update your payment method, then try again.");
        }
      }
      await syncBillingForCustomer(ctx.db, stripe, customerId);
      const fresh = await billingUser(ctx, args.sessionToken);
      return { activeTier: fresh ? xAddonTierForPriceId(fresh.xAddonTierPriceId)?.name ?? null : null };
    },
  },

  /**
   * Remove the X add-on: cancel its own subscription (and strip any
   * legacy tier item off the base subscription), then re-sync the
   * entitlement from Stripe — it turns off immediately.
   */
  removeXAddon: {
    request: z.object({ sessionToken: z.string().min(1) }),
    async handler(ctx, args): Promise<{ activeTier: string | null }> {
      const user = await billingUserSynced(ctx, args.sessionToken);
      if (!user) throw new Error("Your session expired. Sign in again.");
      if (!user.stripeCustomerId) throw new Error("No subscription found.");
      const stripe = getStripe();
      const customerId = user.stripeCustomerId;
      const subs = (await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 })).data;
      const addon = subs.find(
        (s) => isXAddonSubscription(s) && ["trialing", "active", "past_due"].includes(s.status),
      );
      if (addon) {
        await stripe.subscriptions.cancel(addon.id);
      }
      if (user.stripeSubscriptionId) {
        const base = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        const item = xAddonSubscriptionItem(base);
        if (item) {
          await stripe.subscriptionItems.del(item.id, { proration_behavior: "create_prorations" });
        }
      }
      await syncBillingForCustomer(ctx.db, stripe, customerId);
      return { activeTier: null };
    },
  },
};

/**
 * Handles GET /oauth/facebook/callback. Verifies the single-use state,
 * exchanges the code for tokens, stores the encrypted connection, and marks
 * the Facebook channel connected with the Page name as its handle.
 */
export async function handleFacebookOAuthCallback(
  db: Db,
  query: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  if (typeof query.error === "string" && query.error) {
    return { ok: false, error: String(query.error_description ?? query.error) };
  }
  const state = typeof query.state === "string" ? query.state : "";
  const code = typeof query.code === "string" ? query.code : "";
  if (!state || !code) return { ok: false, error: "Missing code or state." };

  const stateRows = await db.select().from(schema.oauthStates).where(eq(schema.oauthStates.state, state)).limit(1);
  const stateRow = stateRows[0];
  // Single-use: consume whatever we found.
  if (stateRow) await db.delete(schema.oauthStates).where(eq(schema.oauthStates.id, stateRow.id));
  if (!stateRow || stateRow.platform !== "facebook") {
    return { ok: false, error: "Invalid login request. Try connecting again." };
  }
  if (stateRow.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "Login request expired. Try connecting again." };
  }
  // Opportunistic cleanup of other expired states.
  await db.delete(schema.oauthStates).where(lte(schema.oauthStates.expiresAt, new Date())).catch(() => undefined);

  const ownerCreds = ownerMetaAppCredentials();
  if (!ownerCreds.ok || !isRealFacebookConfig(ownerCreds.clientId, true)) {
    return { ok: false, error: "Facebook credentials changed during login. Reconnect." };
  }
  const clientId = ownerCreds.clientId;
  const clientSecret = ownerCreds.clientSecret;

  let fbUserId: string;
  let userTokenEncrypted: string;
  let pages: Array<{ id: string; name: string; accessToken: string }>;
  try {
    const shortToken = await exchangeCodeForToken({
      clientId,
      clientSecret: clientSecret as string,
      redirectUri: stateRow.redirectUri,
      code,
    });
    const longToken = await exchangeForLongLivedToken({
      clientId,
      clientSecret: clientSecret as string,
      shortLivedToken: shortToken.accessToken,
    });
    fbUserId = await getFacebookUserId(longToken.accessToken);
    pages = await getManagedPages(longToken.accessToken);
    userTokenEncrypted = encryptToken(longToken.accessToken);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Facebook login failed." };
  }
  if (pages.length === 0) {
    return { ok: false, error: "No Facebook Pages found. Connect a Page you manage first." };
  }
  const page = pages[0] as { id: string; name: string; accessToken: string };
  const now = new Date();
  await db
    .insert(schema.facebookConnections)
    .values({
      userId: stateRow.userId,
      fbUserId,
      userTokenEncrypted,
      pageId: page.id,
      pageName: page.name,
      pageTokenEncrypted: encryptToken(page.accessToken),
      connectedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.facebookConnections.userId],
      set: {
        fbUserId,
        userTokenEncrypted,
        pageId: page.id,
        pageName: page.name,
        pageTokenEncrypted: encryptToken(page.accessToken),
        updatedAt: now,
      },
    });
  await db
    .insert(schema.connectedAccounts)
    .values({
      userId: stateRow.userId,
      platform: "facebook",
      handle: page.name,
      status: "connected",
      authMode: "oauth",
      tokenHint: `page:${page.id}`,
      retryAfter: null,
      connectedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.connectedAccounts.userId, schema.connectedAccounts.platform],
      set: {
        handle: page.name,
        status: "connected",
        authMode: "oauth",
        tokenHint: `page:${page.id}`,
        retryAfter: null,
        connectedAt: now,
      },
    });
  return { ok: true };
}

/**
 * Handles GET /oauth/instagram/callback. Verifies the single-use state,
 * exchanges the code for tokens, resolves the Instagram professional
 * account linked to the user's Facebook Pages, and stores the encrypted
 * connection. The Instagram channel is marked connected with @username as
 * its handle.
 */
export async function handleInstagramOAuthCallback(
  db: Db,
  query: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  if (typeof query.error === "string" && query.error) {
    return { ok: false, error: String(query.error_description ?? query.error) };
  }
  const state = typeof query.state === "string" ? query.state : "";
  const code = typeof query.code === "string" ? query.code : "";
  if (!state || !code) return { ok: false, error: "Missing code or state." };

  const stateRows = await db.select().from(schema.oauthStates).where(eq(schema.oauthStates.state, state)).limit(1);
  const stateRow = stateRows[0];
  // Single-use: consume whatever we found.
  if (stateRow) await db.delete(schema.oauthStates).where(eq(schema.oauthStates.id, stateRow.id));
  if (!stateRow || stateRow.platform !== "instagram") {
    return { ok: false, error: "Invalid login request. Try connecting again." };
  }
  if (stateRow.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "Login request expired. Try connecting again." };
  }
  // Opportunistic cleanup of other expired states.
  await db.delete(schema.oauthStates).where(lte(schema.oauthStates.expiresAt, new Date())).catch(() => undefined);

  const ownerCreds = ownerMetaAppCredentials();
  if (!ownerCreds.ok || !isRealInstagramConfig(ownerCreds.clientId, true)) {
    return { ok: false, error: "Meta credentials changed during login. Reconnect." };
  }
  const clientId = ownerCreds.clientId;
  const clientSecret = ownerCreds.clientSecret;

  let userTokenEncrypted: string;
  let account: { igUserId: string; username: string; pageId: string; pageName: string };
  try {
    const shortToken = await exchangeCodeForToken({
      clientId,
      clientSecret: clientSecret as string,
      redirectUri: stateRow.redirectUri,
      code,
    });
    const longToken = await exchangeForLongLivedToken({
      clientId,
      clientSecret: clientSecret as string,
      shortLivedToken: shortToken.accessToken,
    });
    const accounts = await listInstagramBusinessAccounts(longToken.accessToken);
    const first = accounts[0];
    if (!first) {
      return {
        ok: false,
        error: "No Instagram professional account found. Link a business or creator Instagram account to one of your Facebook Pages first.",
      };
    }
    account = first;
    userTokenEncrypted = encryptToken(longToken.accessToken);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Instagram login failed." };
  }
  const now = new Date();
  await db
    .insert(schema.instagramConnections)
    .values({
      userId: stateRow.userId,
      igUserId: account.igUserId,
      igUsername: account.username,
      pageId: account.pageId,
      pageName: account.pageName,
      userTokenEncrypted,
      connectedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.instagramConnections.userId],
      set: {
        igUserId: account.igUserId,
        igUsername: account.username,
        pageId: account.pageId,
        pageName: account.pageName,
        userTokenEncrypted,
        updatedAt: now,
      },
    });
  await db
    .insert(schema.connectedAccounts)
    .values({
      userId: stateRow.userId,
      platform: "instagram",
      handle: `@${account.username}`,
      status: "connected",
      authMode: "oauth",
      tokenHint: `ig:${account.igUserId}`,
      retryAfter: null,
      connectedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.connectedAccounts.userId, schema.connectedAccounts.platform],
      set: {
        handle: `@${account.username}`,
        status: "connected",
        authMode: "oauth",
        tokenHint: `ig:${account.igUserId}`,
        retryAfter: null,
        connectedAt: now,
      },
    });
  return { ok: true };
}

/**
 * Handles GET /oauth/youtube/callback. Verifies the single-use state,
 * exchanges the code for access + refresh tokens (access_type=offline),
 * reads the channel via channels?mine=true, and stores everything
 * AES-256-GCM encrypted.
 */
export async function handleYoutubeOAuthCallback(
  db: Db,
  query: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  if (typeof query.error === "string" && query.error) {
    return { ok: false, error: String(query.error_description ?? query.error) };
  }
  const state = typeof query.state === "string" ? query.state : "";
  const code = typeof query.code === "string" ? query.code : "";
  if (!state || !code) return { ok: false, error: "Missing code or state." };

  const stateRows = await db.select().from(schema.oauthStates).where(eq(schema.oauthStates.state, state)).limit(1);
  const stateRow = stateRows[0];
  // Single-use: consume whatever we found.
  if (stateRow) await db.delete(schema.oauthStates).where(eq(schema.oauthStates.id, stateRow.id));
  if (!stateRow || stateRow.platform !== "youtube") {
    return { ok: false, error: "Invalid login request. Try connecting again." };
  }
  if (stateRow.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "Login request expired. Try connecting again." };
  }
  // Opportunistic cleanup of other expired states.
  await db.delete(schema.oauthStates).where(lte(schema.oauthStates.expiresAt, new Date())).catch(() => undefined);

  const ownerCreds = ownerYoutubeCredentials();
  if (!ownerCreds.ok || !isRealYoutubeConfig(ownerCreds.clientId, true)) {
    return { ok: false, error: "YouTube credentials changed during login. Reconnect." };
  }
  const clientId = ownerCreds.clientId;
  const clientSecret = ownerCreds.clientSecret;

  let channel: { channelId: string; title: string };
  let accessTokenEncrypted: string;
  let refreshTokenEncrypted: string;
  let expiresAt: Date;
  try {
    const tokens = await exchangeCodeForTokens({
      clientId,
      clientSecret: clientSecret as string,
      redirectUri: stateRow.redirectUri,
      code,
    });
    if (!tokens.refreshToken) {
      return {
        ok: false,
        error: "Google did not return a refresh token. Disconnect YouTube in your Google account settings and connect again.",
      };
    }
    channel = await getChannelInfo(tokens.accessToken);
    accessTokenEncrypted = encryptToken(tokens.accessToken);
    refreshTokenEncrypted = encryptToken(tokens.refreshToken);
    expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "YouTube login failed." };
  }
  const now = new Date();
  await db
    .insert(schema.youtubeConnections)
    .values({
      userId: stateRow.userId,
      channelId: channel.channelId,
      channelTitle: channel.title,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      expiresAt,
      connectedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.youtubeConnections.userId],
      set: {
        channelId: channel.channelId,
        channelTitle: channel.title,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        expiresAt,
        updatedAt: now,
      },
    });
  await db
    .insert(schema.connectedAccounts)
    .values({
      userId: stateRow.userId,
      platform: "youtube",
      handle: channel.title,
      status: "connected",
      authMode: "oauth",
      tokenHint: `yt:${channel.channelId}`,
      retryAfter: null,
      connectedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.connectedAccounts.userId, schema.connectedAccounts.platform],
      set: {
        handle: channel.title,
        status: "connected",
        authMode: "oauth",
        tokenHint: `yt:${channel.channelId}`,
        retryAfter: null,
        connectedAt: now,
      },
    });
  return { ok: true };
}

/**
 * Handles GET /oauth/tiktok/callback. Verifies the single-use state,
 * exchanges the code for tokens, fetches the TikTok user info, and stores
 * the encrypted connection. The TikTok channel is marked connected with
 * the display name as its handle.
 */
export async function handleTikTokOAuthCallback(
  db: Db,
  query: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  if (typeof query.error === "string" && query.error) {
    return { ok: false, error: String(query.error_description ?? query.error) };
  }
  const state = typeof query.state === "string" ? query.state : "";
  const code = typeof query.code === "string" ? query.code : "";
  if (!state || !code) return { ok: false, error: "Missing code or state." };

  const stateRows = await db.select().from(schema.oauthStates).where(eq(schema.oauthStates.state, state)).limit(1);
  const stateRow = stateRows[0];
  // Single-use: consume whatever we found.
  if (stateRow) await db.delete(schema.oauthStates).where(eq(schema.oauthStates.id, stateRow.id));
  if (!stateRow || stateRow.platform !== "tiktok") {
    return { ok: false, error: "Invalid login request. Try connecting again." };
  }
  if (stateRow.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "Login request expired. Try connecting again." };
  }
  // Opportunistic cleanup of other expired states.
  await db.delete(schema.oauthStates).where(lte(schema.oauthStates.expiresAt, new Date())).catch(() => undefined);

  const creds = ownerTikTokCredentials();
  if (!creds.ok || !isRealTikTokConfig(creds.clientId, true)) {
    return { ok: false, error: "TikTok credentials changed during login. Reconnect." };
  }

  let tokens: Awaited<ReturnType<typeof exchangeTikTokCode>>;
  let userInfo: Awaited<ReturnType<typeof getTikTokUserInfo>>;
  let step = "token exchange";
  try {
    tokens = await exchangeTikTokCode({
      clientKey: creds.clientId,
      clientSecret: creds.clientSecret,
      redirectUri: stateRow.redirectUri,
      code,
    });
    step = "user info";
    userInfo = await getTikTokUserInfo(tokens.accessToken);
  } catch (err) {
    logTikTokError(`OAuth callback ${step}`, err);
    return { ok: false, error: err instanceof Error ? err.message : "TikTok login failed." };
  }
  const now = new Date();
  await db
    .insert(schema.tiktokConnections)
    .values({
      userId: stateRow.userId,
      tiktokOpenId: tokens.openId || userInfo.openId,
      tiktokDisplayName: userInfo.displayName,
      accessTokenEncrypted: encryptToken(tokens.accessToken),
      refreshTokenEncrypted: encryptToken(tokens.refreshToken),
      expiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
      connectedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.tiktokConnections.userId],
      set: {
        tiktokOpenId: tokens.openId || userInfo.openId,
        tiktokDisplayName: userInfo.displayName,
        accessTokenEncrypted: encryptToken(tokens.accessToken),
        refreshTokenEncrypted: encryptToken(tokens.refreshToken),
        expiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
        updatedAt: now,
      },
    });
  await db
    .insert(schema.connectedAccounts)
    .values({
      userId: stateRow.userId,
      platform: "tiktok",
      handle: `@${userInfo.displayName}`,
      status: "connected",
      authMode: "oauth",
      tokenHint: `tt:${tokens.openId || userInfo.openId}`,
      retryAfter: null,
      connectedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.connectedAccounts.userId, schema.connectedAccounts.platform],
      set: {
        handle: `@${userInfo.displayName}`,
        status: "connected",
        authMode: "oauth",
        tokenHint: `tt:${tokens.openId || userInfo.openId}`,
        retryAfter: null,
        connectedAt: now,
      },
    });
  return { ok: true };
}

/**
 * Handles GET /oauth/x/callback. Verifies the single-use state, exchanges
 * the code for tokens using the stored PKCE code_verifier (confidential
 * client: Basic auth on the token endpoint), fetches the X user, and
 * stores the encrypted connection. The X channel is marked connected with
 * @username as its handle.
 */
export async function handleXOAuthCallback(
  db: Db,
  query: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  if (typeof query.error === "string" && query.error) {
    return { ok: false, error: String(query.error_description ?? query.error) };
  }
  const state = typeof query.state === "string" ? query.state : "";
  const code = typeof query.code === "string" ? query.code : "";
  if (!state || !code) return { ok: false, error: "Missing code or state." };

  const stateRows = await db.select().from(schema.oauthStates).where(eq(schema.oauthStates.state, state)).limit(1);
  const stateRow = stateRows[0];
  // Single-use: consume whatever we found.
  if (stateRow) await db.delete(schema.oauthStates).where(eq(schema.oauthStates.id, stateRow.id));
  if (!stateRow || stateRow.platform !== "x") {
    return { ok: false, error: "Invalid login request. Try connecting again." };
  }
  if (stateRow.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "Login request expired. Try connecting again." };
  }
  if (!stateRow.codeVerifier) {
    return { ok: false, error: "Login request is missing its security verifier. Try connecting again." };
  }
  // Opportunistic cleanup of other expired states.
  await db.delete(schema.oauthStates).where(lte(schema.oauthStates.expiresAt, new Date())).catch(() => undefined);

  const ownerCreds = ownerXCredentials();
  if (!ownerCreds.ok || !isRealXConfig(ownerCreds.clientId, true)) {
    return { ok: false, error: "X credentials changed during login. Reconnect." };
  }
  const clientId = ownerCreds.clientId;
  const clientSecret = ownerCreds.clientSecret;

  let userInfo: { id: string; username: string; name: string };
  let accessTokenEncrypted: string;
  let refreshTokenEncrypted: string | null;
  let expiresAt: Date | null;
  try {
    const tokens = await exchangeXCodeForToken({
      clientId,
      clientSecret: clientSecret as string,
      redirectUri: stateRow.redirectUri,
      code,
      codeVerifier: stateRow.codeVerifier,
    });
    userInfo = await getXUserInfo(tokens.accessToken);
    accessTokenEncrypted = encryptToken(tokens.accessToken);
    refreshTokenEncrypted = tokens.refreshToken ? encryptToken(tokens.refreshToken) : null;
    expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "X login failed." };
  }
  const now = new Date();
  await db
    .insert(schema.xConnections)
    .values({
      userId: stateRow.userId,
      xUserId: userInfo.id,
      xUsername: userInfo.username,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      expiresAt,
      connectedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.xConnections.userId],
      set: {
        xUserId: userInfo.id,
        xUsername: userInfo.username,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        expiresAt,
        updatedAt: now,
      },
    });
  await db
    .insert(schema.connectedAccounts)
    .values({
      userId: stateRow.userId,
      platform: "x",
      handle: `@${userInfo.username}`,
      status: "connected",
      authMode: "oauth",
      tokenHint: `x:${userInfo.id}`,
      retryAfter: null,
      connectedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.connectedAccounts.userId, schema.connectedAccounts.platform],
      set: {
        handle: `@${userInfo.username}`,
        status: "connected",
        authMode: "oauth",
        tokenHint: `x:${userInfo.id}`,
        retryAfter: null,
        connectedAt: now,
      },
    });
  return { ok: true };
}
