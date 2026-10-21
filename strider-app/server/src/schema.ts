import { boolean, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Ported from the original SQLite schema. Epoch-millisecond integer
// timestamps became timestamptz columns (mode: "date"), so the action
// code keeps working with plain JS Date objects.

export const users = pgTable("users", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  role: text("role").notNull().default("user"),
  demoMode: boolean("demo_mode").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status").notNull().default("none"),
  currentPeriodEnd: timestamp("current_period_end", { mode: "date", withTimezone: true }),
  currentPeriodStart: timestamp("current_period_start", { mode: "date", withTimezone: true }),
  /** X (Twitter) posting add-on: the Stripe price ID of the active
   *  add-on tier (tiers come from the STRIPE_X_TIERS env config), or
   *  null when no tier is attached. Synced from Stripe only. The tier
   *  lives on its OWN Stripe subscription (stripeXAddonSubscriptionId)
   *  so it can bill from day one while the base plan trials; legacy
   *  subscriptions may instead carry the tier as an item on the base
   *  subscription, which sync also honors. */
  xAddonTierPriceId: text("x_addon_tier_price_id"),
  /** The add-on tier's own Stripe subscription, when the tier is
   *  represented that way (see xAddonTierPriceId). */
  stripeXAddonSubscriptionId: text("stripe_x_addon_subscription_id"),
  /** The add-on tier's current billing period (from its own
   *  subscription's tier item) — X usage is anchored to this period
   *  when set, falling back to the base subscription's period. */
  xAddonPeriodStart: timestamp("x_addon_period_start", { mode: "date", withTimezone: true }),
  xAddonPeriodEnd: timestamp("x_addon_period_end", { mode: "date", withTimezone: true }),
});

export const sessions = pgTable(
  "sessions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("idx_sessions_token").on(table.token)],
);

export const platformConfigs = pgTable(
  "platform_configs",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["facebook", "instagram", "tiktok", "youtube", "x"] }).notNull(),
    clientId: text("client_id").notNull(),
    secretReference: text("secret_reference").notNull(),
    clientSecretEnc: text("client_secret_enc"),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("platform_configs_user_platform").on(table.userId, table.platform)],
);

export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["facebook", "instagram", "tiktok", "youtube", "x"] }).notNull(),
    handle: text("handle").notNull(),
    status: text("status", { enum: ["connected", "expired", "error", "rate_limited"] }).notNull(),
    authMode: text("auth_mode", { enum: ["demo", "oauth"] }).notNull(),
    tokenHint: text("token_hint"),
    retryAfter: timestamp("retry_after", { mode: "date", withTimezone: true }),
    connectedAt: timestamp("connected_at", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("connected_accounts_user_platform").on(table.userId, table.platform)],
);

/** Single-use password reset tokens. Token itself is never stored — only its SHA-256 hash. */
export const passwordResets = pgTable(
  "password_resets",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("idx_password_resets_token_hash").on(table.tokenHash)],
);

/** Single-use OAuth CSRF states (currently Facebook). */
export const oauthStates = pgTable(
  "oauth_states",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    state: text("state").notNull().unique(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    /** Exact redirect_uri used in the auth URL; token exchange must match it. */
    redirectUri: text("redirect_uri").notNull(),
    /** PKCE code_verifier for flows that use it (X). Null for the rest. */
    codeVerifier: text("code_verifier"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("idx_oauth_states_state").on(table.state)],
);

/**
 * Real Facebook connection per user. Tokens are AES-256-GCM encrypted
 * (see TOKEN_ENCRYPTION_KEY); never plaintext.
 */
export const facebookConnections = pgTable("facebook_connections", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  fbUserId: text("fb_user_id").notNull(),
  userTokenEncrypted: text("user_token_encrypted").notNull(),
  pageId: text("page_id").notNull(),
  pageName: text("page_name").notNull(),
  pageTokenEncrypted: text("page_token_encrypted").notNull(),
  connectedAt: timestamp("connected_at", { mode: "date", withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
});

/**
 * Real Instagram connection per user. Instagram publishing uses the
 * long-lived user token against the selected IG business account, which
 * must be linked to a Facebook Page the user manages (see
 * server/src/instagram.ts). Tokens are AES-256-GCM encrypted
 * (see TOKEN_ENCRYPTION_KEY); never plaintext.
 */
export const instagramConnections = pgTable("instagram_connections", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  igUserId: text("ig_user_id").notNull(),
  igUsername: text("ig_username").notNull(),
  pageId: text("page_id").notNull(),
  pageName: text("page_name").notNull(),
  userTokenEncrypted: text("user_token_encrypted").notNull(),
  connectedAt: timestamp("connected_at", { mode: "date", withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
});

/**
 * Real X (Twitter) OAuth 2.0 connection per user. X access tokens live
 * ~2 hours; offline.access yields a refresh token, which publish.ts uses
 * to refresh before posting. Both tokens are AES-256-GCM encrypted
 * (see TOKEN_ENCRYPTION_KEY); never plaintext.
 */
export const xMonthlyUsage = pgTable("x_monthly_usage", {
  userId: integer("user_id").notNull(),
  yearMonth: text("year_month").notNull(),
  postCount: integer("post_count").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.yearMonth] })]);

/**
 * X add-on usage for the workspace's CURRENT subscription period.
 * One row per user; periodStart/periodEnd mirror the subscription's
 * current period. Plain posts and posts with links are counted
 * separately because X bills them at different rates and each add-on
 * tier caps them separately (see STRIPE_X_TIERS in billing.ts).
 */
export const xAddonUsage = pgTable("x_addon_usage", {
  userId: integer("user_id").notNull().primaryKey().references(() => users.id, { onDelete: "cascade" }),
  periodStart: timestamp("period_start", { mode: "date", withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { mode: "date", withTimezone: true }).notNull(),
  postsUsed: integer("posts_used").notNull().default(0),
  linkPostsUsed: integer("link_posts_used").notNull().default(0),
});

export const xConnections = pgTable("x_connections", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  xUserId: text("x_user_id").notNull(),
  xUsername: text("x_username").notNull(),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }),
  connectedAt: timestamp("connected_at", { mode: "date", withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
});

/**
 * One-time $125 setup-session bookings — Layla's done-with-you setup
 * help, sold from the public Services page and the in-app Billing
 * page. One row per PAID Stripe checkout session; recorded by the
 * completion webhook AND repaired by read-time reconciliation from
 * Stripe (the same self-healing rule as subscription state — a
 * booking must never depend on the webhook alone). Scheduling itself
 * happens by email; status starts "booked".
 */
export const setupBookings = pgTable("setup_bookings", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull().unique(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  status: text("status").notNull().default("booked"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
});

/**
 * Black Friday waitlist signups from the public /black-friday page
 * (waitlist-playbook launch, Oct 2026). Email is unique — a repeat
 * signup is a no-op answered "already on the list". Phone is optional
 * (for the weekly launch text), first name optional. Capture only:
 * no billing fields, no Stripe references — the deal and the
 * confirmation-page tripwire are Layla-approval-gated and unbuilt.
 */
export const bfWaitlist = pgTable("bf_waitlist", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  firstName: text("first_name"),
  source: text("source").notNull().default("black-friday"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
});

/**
 * Paid purchases of the Black Friday tripwire — the one-time $8.88
 * "90 Plug-and-Post Captions" pack. One row per PAID Stripe checkout
 * session; recorded by the completion webhook AND repaired by the
 * pack page's read-time verification from Stripe (same self-healing
 * rule as setup_bookings). No user_id: pack buyers need no account,
 * the email Stripe collected is the identity.
 */
export const bfPackPurchases = pgTable("bf_pack_purchases", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  email: text("email").notNull(),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull().unique(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  status: text("status").notNull().default("paid"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
});

export const tiktokMonthlyUsage = pgTable("tiktok_monthly_usage", {
  userId: integer("user_id").notNull(),
  yearMonth: text("year_month").notNull(),
  postCount: integer("post_count").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.yearMonth] })]);

export const tiktokConnections = pgTable("tiktok_connections", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  tiktokOpenId: text("tiktok_open_id").notNull(),
  tiktokDisplayName: text("tiktok_display_name").notNull(),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
  connectedAt: timestamp("connected_at", { mode: "date", withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
});

/** Real YouTube OAuth connections (YouTube Data API v3). Tokens are
 *  AES-256-GCM encrypted (see TOKEN_ENCRYPTION_KEY); never plaintext. The
 *  refresh token lets the server mint fresh access tokens (~1h lifetime). */
export const youtubeConnections = pgTable("youtube_connections", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull(),
  channelTitle: text("channel_title").notNull(),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
  connectedAt: timestamp("connected_at", { mode: "date", withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
});

export const posts = pgTable("posts", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  youtubeTitle: text("youtube_title"),
  mediaBlobKey: text("media_blob_key"),
  mediaName: text("media_name"),
  mediaType: text("media_type"),
  publishMode: text("publish_mode", { enum: ["now", "scheduled"] }).notNull(),
  scheduledAt: timestamp("scheduled_at", { mode: "date", withTimezone: true }),
  status: text("status", { enum: ["published", "pending", "failed", "cancelled"] }).notNull(),
  bumpEnabled: boolean("bump_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
});

export const bumpComments = pgTable(
  "bump_comments",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    postId: integer("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    body: text("body").notNull(),
    scheduledAt: timestamp("scheduled_at", { mode: "date", withTimezone: true }).notNull(),
    status: text("status", { enum: ["pending", "published", "failed", "cancelled"] }).notNull(),
    publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }),
    errorMessage: text("error_message"),
  },
  (table) => [uniqueIndex("bump_comments_post_sequence").on(table.postId, table.sequence)],
);

/** Per-target execution jobs for bump comments (24-hour post bump). One
 *  job per (bump comment, post target) is created when the target
 *  publishes, anchored to the target's actual publish time; the
 *  scheduler drains due jobs and records each platform's outcome here.
 *  TikTok targets never get jobs (no comment API/scope exists). */
export const bumpCommentJobs = pgTable(
  "bump_comment_jobs",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    bumpCommentId: integer("bump_comment_id").notNull().references(() => bumpComments.id, { onDelete: "cascade" }),
    targetId: integer("target_id").notNull().references(() => postTargets.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["facebook", "instagram", "tiktok", "youtube", "x"] }).notNull(),
    status: text("status", { enum: ["pending", "published", "failed", "cancelled"] }).notNull(),
    scheduledAt: timestamp("scheduled_at", { mode: "date", withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }),
    errorMessage: text("error_message"),
    remoteId: text("remote_id"),
  },
  (table) => [uniqueIndex("bump_comment_jobs_comment_target").on(table.bumpCommentId, table.targetId)],
);

export const postTargets = pgTable(
  "post_targets",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    postId: integer("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    accountId: integer("account_id").notNull().references(() => connectedAccounts.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["facebook", "instagram", "tiktok", "youtube", "x"] }).notNull(),
    status: text("status", { enum: ["published", "pending", "failed", "cancelled"] }).notNull(),
    errorMessage: text("error_message"),
    remoteId: text("remote_id"),
    publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }),
  },
  (table) => [uniqueIndex("post_targets_post_account").on(table.postId, table.accountId)],
);
