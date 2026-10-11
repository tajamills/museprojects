import { boolean, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Ported from the original SQLite schema. Epoch-millisecond integer
// timestamps became timestamptz columns (mode: "date"), so the action
// code keeps working with plain JS Date objects.

export const users = pgTable("users", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  demoMode: boolean("demo_mode").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
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
