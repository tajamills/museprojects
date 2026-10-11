import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AppCtx } from "./ctx.js";
import * as schema from "./schema.js";
import { TRIAL_DAYS, baseUrl, getStripe } from "./billing.js";

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
    developerApp: "Meta for Developers app with Facebook Login and Pages API",
    credentialFields: "App ID + App Secret (kept in a server-side secret vault)",
    failureHint: "If the session expired, choose Reconnect and complete Facebook OAuth again.",
    warning: "Facebook sessions can expire without warning. The app checks token health on load and before publishing.",
  },
  instagram: {
    label: "Instagram",
    developerApp: "Meta for Developers app with Instagram Graph API; connect a professional Instagram account to a Facebook Page",
    credentialFields: "Meta App ID + App Secret (kept in a server-side secret vault)",
    failureHint: "Confirm the Instagram account is Professional and linked to a Facebook Page, then reconnect.",
    warning: "Instagram publishing requires an image or video and an eligible professional account.",
  },
  tiktok: {
    label: "TikTok",
    developerApp: "TikTok for Developers app with Login Kit and Content Posting API",
    credentialFields: "Client key + Client secret (kept in a server-side secret vault)",
    failureHint: "If TikTok says the maximum number of attempts was reached, stop retrying and wait until the shown retry time.",
    warning: "TikTok rate-limits repeated login attempts. The app backs off instead of hammering the endpoint.",
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

  getWorkspace: {
    request: z.object({ sessionToken: z.string().min(1) }),
    async handler(ctx, args) {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { authenticated: false, user: null, accounts: [], posts: [] };
      const accounts = await ctx.db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.userId, user.id)).orderBy(schema.connectedAccounts.id);
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
      return {
        ok: true,
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

  savePlatformConfig: {
    request: z.object({ sessionToken: z.string().min(1), platform: platformSchema, clientId: z.string().trim().min(1).max(300), secretReference: z.string().trim().min(1).max(500) }),
    async handler(ctx, args): Promise<z.infer<typeof accountResponse>> {
      const user = await requireUser(ctx, args.sessionToken);
      if (!user) return { ok: false, message: "Your session expired. Sign in again." };
      await ctx.db.insert(schema.platformConfigs).values({
        userId: user.id, platform: args.platform, clientId: args.clientId.trim(), secretReference: args.secretReference.trim(), updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [schema.platformConfigs.userId, schema.platformConfigs.platform],
        set: { clientId: args.clientId.trim(), secretReference: args.secretReference.trim(), updatedAt: new Date() },
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
      if (!user.demoMode) return { ok: false, message: "Live OAuth needs a deployed callback URL and approved developer app. Finish the checklist in Settings first." };
      const existing = await ctx.db.select().from(schema.connectedAccounts).where(and(eq(schema.connectedAccounts.userId, user.id), eq(schema.connectedAccounts.platform, args.platform))).limit(1);
      if (existing[0]?.status === "rate_limited" && existing[0].retryAfter && existing[0].retryAfter.getTime() > Date.now()) {
        return { ok: false, message: `Too many attempts. Do not retry yet; try again after ${existing[0].retryAfter.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` };
      }
      await ctx.db.insert(schema.connectedAccounts).values({
        userId: user.id,
        platform: args.platform,
        handle: DEMO_HANDLES[args.platform as Platform],
        status: "connected",
        authMode: "demo",
        tokenHint: "demo-token-never-used",
        retryAfter: null,
        connectedAt: new Date(),
      }).onConflictDoUpdate({
        target: [schema.connectedAccounts.userId, schema.connectedAccounts.platform],
        set: { handle: DEMO_HANDLES[args.platform as Platform], status: "connected", authMode: "demo", tokenHint: "demo-token-never-used", retryAfter: null, connectedAt: new Date() },
      });
      ctx.invalidateQueries();
      return { ok: true, message: `${PLATFORM_INFO[args.platform as Platform].label} demo OAuth completed. No external account was contacted.` };
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
      const status = args.publishMode === "now" ? "published" as const : "pending" as const;
      const inserted = await ctx.db.insert(schema.posts).values({
        userId: user.id,
        body: args.body.trim(),
        youtubeTitle: args.youtubeTitle?.trim() || null,
        mediaBlobKey,
        mediaName: args.media?.name ?? null,
        mediaType: args.media?.mimeType ?? null,
        publishMode: args.publishMode,
        scheduledAt,
        status,
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
        status,
        errorMessage: null,
        remoteId: args.publishMode === "now" ? `demo-${crypto.randomUUID()}` : null,
        publishedAt: args.publishMode === "now" ? now : null,
      })));
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
        message: (args.publishMode === "now" ? "Demo publish complete. No external API was called." : "Post added to the demo schedule.") + scheduleNote,
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
      await ctx.db.update(schema.bumpComments).set({ status: "published", publishedAt: new Date(), errorMessage: null }).where(eq(schema.bumpComments.id, next.id));
      ctx.invalidateQueries();
      return { ok: true, message: `Demo comment ${next.sequence} published. No external API was called.` };
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
   */
  createCheckoutSession: {
    request: z.object({ sessionToken: z.string().min(1) }),
    async handler(ctx, args): Promise<{ url: string }> {
      const user = await billingUser(ctx, args.sessionToken);
      if (!user) throw new Error("Your session expired. Sign in again.");
      const stripe = getStripe();
      const priceId = process.env.STRIPE_PRICE_ID;
      if (!priceId) throw new Error("Billing is not configured yet.");
      if (["trialing", "active", "past_due"].includes(user.subscriptionStatus) && user.stripeCustomerId) {
        throw new Error("You already have a subscription — use Manage billing to update it.");
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
      const url = baseUrl(ctx.origin);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: String(user.id),
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: { trial_period_days: TRIAL_DAYS },
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
      const user = await billingUser(ctx, args.sessionToken);
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
    async handler(ctx, args): Promise<{ status: string; trialEndsAt: string | null; currentPeriodEnd: string | null }> {
      const user = await billingUser(ctx, args.sessionToken);
      if (!user) throw new Error("Your session expired. Sign in again.");
      const status = user.subscriptionStatus || "none";
      const periodEnd = user.currentPeriodEnd ? user.currentPeriodEnd.toISOString() : null;
      return {
        status,
        // During a trial, Stripe sets current_period_end to the trial's end.
        trialEndsAt: status === "trialing" ? periodEnd : null,
        currentPeriodEnd: periodEnd,
      };
    },
  },
};
