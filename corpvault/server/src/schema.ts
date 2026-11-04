// kovala Postgres schema. Ported from the TS-space's
// drizzle-orm/sqlite-core schema; column names are unchanged so the action
// logic ports 1:1. SQLite INTEGER ms timestamps became TIMESTAMPTZ, and
// INTEGER PRIMARY KEY AUTOINCREMENT became GENERATED ALWAYS AS IDENTITY.

import { boolean, customType, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** BYTEA column (drizzle 0.45 pg-core has no built-in bytea builder).
 *  node-postgres reads and writes bytea as Buffer natively. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const accounts = pgTable("accounts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status").notNull().default("none"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
});

export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(),
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * Forgot-password reset requests (migration 0009, admin-link stopgap).
 * A public request lands here first (accountId null when no account
 * matches — the public response is identical either way); the owner
 * generates the one-time link from the Billing page, which fills
 * tokenHash (SHA-256 of the raw token — the raw value is only ever in
 * the generated link) and expiresAt (60 minutes). usedAt is stamped
 * when the link is spent, when a newer link supersedes it, or when the
 * password is reset.
 */
export const passwordResetRequests = pgTable(
  "password_reset_requests",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    accountId: integer("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    requestedIp: text("requested_ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("password_reset_requests_created_idx").on(t.createdAt)],
);

export const entities = pgTable("entities", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  entityType: text("entity_type", { enum: ["LLC", "Corporation", "DBA"] }).notNull(),
  state: text("state").notNull(),
  formationDate: text("formation_date").notNull(),
  einValue: text("ein_value"),
  registeredAgent: text("registered_agent"),
  agentRenewalDate: text("agent_renewal_date"),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
});

export const documents = pgTable("documents", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  entityId: integer("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  category: text("category").notNull(),
  mimeType: text("mime_type").notNull(),
  blobKey: text("blob_key").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
});

/**
 * Document file bytes (migration 0010). The blob store used to write
 * uploads to local disk under DATA_DIR, which Railway wipes on every
 * redeploy (no volume attached) — the documents rows survived but the
 * files 404'd. Bytes now live in Postgres keyed by the same blob keys.
 */
export const documentBlobs = pgTable("document_blobs", {
  blobKey: text("blob_key").primaryKey(),
  contentType: text("content_type").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
});

export const reminders = pgTable("reminders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  entityId: integer("entity_id").references(() => entities.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  reminderType: text("reminder_type").notNull(),
  dueDate: text("due_date").notNull(),
  notes: text("notes"),
  status: text("status", { enum: ["open", "done"] }).notNull().default("open"),
  sourceLabel: text("source_label"),
  sourceUrl: text("source_url"),
  autoGenerated: boolean("auto_generated").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
});

export const bkCategories = pgTable("bk_categories", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  entityId: integer("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["income", "expense", "contribution", "distribution"] }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
});

export const bkTransactions = pgTable("bk_transactions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  entityId: integer("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
  txnDate: text("txn_date").notNull(),
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(),
  direction: text("direction", { enum: ["in", "out"] }).notNull(),
  categoryId: integer("category_id").references(() => bkCategories.id, { onDelete: "set null" }),
  status: text("status", { enum: ["cleared", "pending"] }).notNull().default("cleared"),
  receiptDocumentId: integer("receipt_document_id").references(() => documents.id, { onDelete: "set null" }),
  source: text("source", { enum: ["manual", "csv", "plaid"] }).notNull().default("manual"),
  externalId: text("external_id"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
});

export const bkBankConnections = pgTable("bk_bank_connections", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  entityId: integer("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
  plaidItemId: text("plaid_item_id").notNull(),
  /** AES-256-GCM encrypted Plaid access token (see server/src/plaid.ts).
   *  Never selected into any client-facing response. */
  accessTokenEnc: text("access_token_enc").notNull(),
  institutionName: text("institution_name"),
  /** JSON: [{account_id, name, mask, balance_cents}] refreshed at each sync. */
  accountsJson: text("accounts_json"),
  transactionsCursor: text("transactions_cursor"),
  status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
});

export const bkSyncAddons = pgTable("bk_sync_addons", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  entityId: integer("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeItemId: text("stripe_item_id"),
  /** Mirrors the Stripe subscription status (active | past_due | canceled | …). */
  status: text("status").notNull().default("none"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
});

export const meetings = pgTable("meetings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  entityId: integer("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
  meetingType: text("meeting_type").notNull(),
  meetingDate: text("meeting_date").notNull(),
  meetingTime: text("meeting_time").notNull(),
  timezone: text("timezone").notNull(),
  location: text("location"),
  attendeesJson: text("attendees_json").notNull(),
  agendaJson: text("agenda_json").notNull(),
  discussionSummary: text("discussion_summary").notNull(),
  decisionsJson: text("decisions_json").notNull(),
  actionItemsJson: text("action_items_json").notNull(),
  nextMeetingDate: text("next_meeting_date"),
  recordedBy: text("recorded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
});
