// Drizzle schema for Postgres (ported from the SQLite schema in the Hatch space).
//
// Type mapping vs the original sqlite-core schema:
//   integer PK autoincrement -> integer PK generatedAlwaysAsIdentity()
//   integer (ms timestamps, mode "timestamp_ms") -> timestamp with timezone, mode "date"
//   integer (mode "boolean") -> boolean
//   real -> doublePrecision
//   text -> text
import { boolean, doublePrecision, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date());

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  referralCode: text("referral_code").notNull().unique(),
  referredBy: text("referred_by"),
  affiliateReferralCount: integer("affiliate_referral_count").notNull().default(0),
  affiliateEarnings: doublePrecision("affiliate_earnings").notNull().default(0),
  payoutMethod: text("payout_method"),
  payoutZelleInfo: text("payout_zelle_info"),
  payoutTaxName: text("payout_tax_name"),
  payoutTaxAddress: text("payout_tax_address"),
  costBasisMethod: text("cost_basis_method", { enum: ["FIFO", "LIFO", "HIFO"] }).notNull().default("FIFO"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status").notNull().default("none"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true, mode: "date" }),
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull(),
  createdAt: createdAt(),
});

export const wallets = pgTable("wallets", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  chain: text("chain").notNull(),
  address: text("address").notNull(),
  owned: boolean("owned").notNull().default(true),
  createdAt: createdAt(),
});

export const exchangeConnections = pgTable("exchange_connections", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  provider: text("provider").notNull(),
  label: text("label").notNull(),
  keyHint: text("key_hint").notNull(),
  status: text("status").notNull().default("configured"),
  createdAt: createdAt(),
});

export const transactions = pgTable("transactions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(),
  classification: text("classification").notNull(),
  asset: text("asset").notNull(),
  amount: doublePrecision("amount").notNull(),
  priceUsd: doublePrecision("price_usd").notNull(),
  feeUsd: doublePrecision("fee_usd").notNull().default(0),
  receivedAsset: text("received_asset"),
  receivedAmount: doublePrecision("received_amount"),
  receivedPriceUsd: doublePrecision("received_price_usd"),
  fromWalletId: integer("from_wallet_id"),
  toWalletId: integer("to_wallet_id"),
  note: text("note"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: createdAt(),
});

export const alertSettings = pgTable("alert_settings", {
  userId: integer("user_id").primaryKey(),
  telegramHint: text("telegram_hint"),
  telegramChatId: text("telegram_chat_id"),
  phoneHint: text("phone_hint"),
  pushEnabled: boolean("push_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const priceAlerts = pgTable("price_alerts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  asset: text("asset").notNull(),
  direction: text("direction", { enum: ["above", "below"] }).notNull(),
  targetPrice: doublePrecision("target_price").notNull(),
  channels: text("channels").notNull(),
  active: boolean("active").notNull().default(true),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
});

export const alertHistory = pgTable("alert_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  alertId: integer("alert_id").notNull(),
  message: text("message").notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }).notNull(),
});
