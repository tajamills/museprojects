// Drizzle schema for Postgres (ported from the SQLite schema in the Hatch space).
//
// Type mapping vs the original sqlite-core schema:
//   integer PK autoincrement -> integer PK generatedAlwaysAsIdentity()
//   integer (ms timestamps, mode "timestamp_ms") -> timestamp with timezone, mode "date"
//   integer (mode "boolean") -> boolean
//   real -> doublePrecision
//   text -> text
import { bigint, boolean, doublePrecision, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
  // Owner/comp accounts never lock and are never charged (migration 0010
  // sets this for the owner's account by email; see entitlement.ts).
  comped: boolean("comped").notNull().default(false),
  // Promo code captured from a /?promo=CODE link and stored at signup so
  // checkout can pre-apply it without the customer typing anything
  // (migration 0011). Cleared once the subscription starts or the code
  // stops resolving in Stripe.
  promoCode: text("promo_code"),
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

/**
 * Forgot-password reset requests (migration 0012, admin-link stopgap).
 * A public request lands here first (userId null when no account matches —
 * the public response is identical either way); the owner generates the
 * one-time link from the account page, which fills tokenHash (SHA-256 of
 * the raw token — the raw value is only ever in the generated link) and
 * expiresAt (60 minutes). usedAt is stamped when the link is spent, when
 * a newer link supersedes it, or when the password is reset.
 */
export const passwordResetRequests = pgTable(
  "password_reset_requests",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id"),
    email: text("email").notNull(),
    tokenHash: text("token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    requestedIp: text("requested_ip"),
    createdAt: createdAt(),
  },
  (t) => [index("password_reset_requests_created_idx").on(t.createdAt)],
);

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
  apiKeyEnc: text("api_key_enc"),
  apiSecretEnc: text("api_secret_enc"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: "date" }),
  syncError: text("sync_error"),
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
  externalId: text("external_id"),
  note: text("note"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: createdAt(),
});

export const alertSettings = pgTable("alert_settings", {
  userId: integer("user_id").primaryKey(),
  telegramHint: text("telegram_hint"),
  telegramChatId: text("telegram_chat_id"),
  phoneHint: text("phone_hint"),
  // Real per-customer SMS (phase 1, migration 0009) — only read/written
  // when SMS_ALERTS_ENABLED=true. phoneNumberEnc is the full E.164 number,
  // AES-256-GCM encrypted (see crypto.ts); smsConsentAt is the TCPA opt-in
  // record; smsOptedOut is set by the Twilio inbound webhook on STOP.
  phoneNumberEnc: text("phone_number_enc"),
  smsConsentAt: timestamp("sms_consent_at", { withTimezone: true, mode: "date" }),
  smsOptedOut: boolean("sms_opted_out").notNull().default(false),
  smsOptedOutAt: timestamp("sms_opted_out_at", { withTimezone: true, mode: "date" }),
  pushEnabled: boolean("push_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** One row per attempted provider SMS send (sent / failed / capped). */
export const smsSends = pgTable(
  "sms_sends",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id").notNull(),
    alertId: integer("alert_id").notNull(),
    providerSid: text("provider_sid"),
    status: text("status").notNull(),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("sms_sends_user_created_idx").on(t.userId, t.createdAt)],
);

export const priceAlerts = pgTable("price_alerts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  asset: text("asset").notNull(),
  direction: text("direction", { enum: ["above", "below"] }).notNull(),
  targetPrice: doublePrecision("target_price").notNull(),
  channels: text("channels").notNull(),
  active: boolean("active").notNull().default(true),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true, mode: "date" }),
  episodeStartedAt: timestamp("episode_started_at", { withTimezone: true, mode: "date" }),
  lastNotifiedPrice: doublePrecision("last_notified_price"),
  createdAt: createdAt(),
});

export const alertHistory = pgTable("alert_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull(),
  alertId: integer("alert_id").notNull(),
  message: text("message").notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }).notNull(),
});

/**
 * Stolen-Funds Watch (migration 0013). Reported-address case monitoring:
 * an address enters only from a full string printed in an identifiable
 * published source (watch_sources / watch_address_sources); every public
 * figure renders from watch_case_claims; movement is baseline-first
 * (watch_address_snapshots / watch_events). Feature flags default OFF —
 * see server/src/watch/flags.ts. Language rule: addresses are "reported",
 * never labeled with an accusation.
 */
const watchTs = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(() => new Date());
const watchTsCol = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const updatedAtCol = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(() => new Date());

export const watchCases = pgTable("watch_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull().default("reported_case_under_review"),
  publicEnabled: boolean("public_enabled").notNull().default(false),
  monitoringEnabled: boolean("monitoring_enabled").notNull().default(false),
  alertsEnabled: boolean("alerts_enabled").notNull().default(false),
  isTest: boolean("is_test").notNull().default(false),
  createdAt: watchTs(),
  updatedAt: updatedAtCol(),
});

export const watchSources = pgTable("watch_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  publisher: text("publisher").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  sourceType: text("source_type").notNull(),
  publishedAt: watchTsCol("published_at"),
  retrievedAt: watchTsCol("retrieved_at"),
  createdAt: watchTs(),
});

export const watchCaseClaims = pgTable("watch_case_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => watchCases.id),
  claimKey: text("claim_key").notNull(),
  claimType: text("claim_type").notNull(),
  displayLabel: text("display_label").notNull(),
  displayValue: text("display_value").notNull(),
  numericValue: numeric("numeric_value"),
  currencyOrAsset: text("currency_or_asset"),
  sourceId: uuid("source_id").notNull().references(() => watchSources.id),
  sourceLocator: text("source_locator").notNull().default(""),
  asOfAt: watchTsCol("as_of_at"),
  status: text("status").notNull().default("current"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: watchTs(),
  updatedAt: updatedAtCol(),
});

export const watchAddresses = pgTable("watch_addresses", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => watchCases.id),
  chain: text("chain").notNull(),
  network: text("network").notNull().default("mainnet"),
  address: text("address").notNull(),
  addressKey: text("address_key").notNull(),
  displayAddress: text("display_address").notNull(),
  listSection: text("list_section").notNull().default("reported"),
  roleText: text("role_text"),
  roleSourceId: uuid("role_source_id").references(() => watchSources.id),
  status: text("status").notNull().default("reported_not_yet_checked"),
  anchorPriority: boolean("anchor_priority").notNull().default(false),
  frozenState: text("frozen_state"),
  baselineStatus: text("baseline_status").notNull().default("pending"),
  baselineHeight: bigint("baseline_height", { mode: "number" }),
  baselineObservedAt: watchTsCol("baseline_observed_at"),
  nextCheckAt: watchTsCol("next_check_at"),
  lastCheckedAt: watchTsCol("last_checked_at"),
  lastSuccessfulCheckAt: watchTsCol("last_successful_check_at"),
  lastActivityAt: watchTsCol("last_activity_at"),
  isTest: boolean("is_test").notNull().default(false),
  createdAt: watchTs(),
  updatedAt: updatedAtCol(),
});

export const watchAddressSources = pgTable("watch_address_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  addressId: uuid("address_id").notNull().references(() => watchAddresses.id),
  sourceId: uuid("source_id").notNull().references(() => watchSources.id),
  sourceLocator: text("source_locator").notNull().default(""),
  reportedRoleText: text("reported_role_text"),
  reportedSnapshotText: text("reported_snapshot_text"),
  matchMethod: text("match_method").notNull().default("full_string"),
  createdAt: watchTs(),
});

export const watchImportBatches = pgTable("watch_import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").references(() => watchCases.id),
  seedVersion: text("seed_version").notNull(),
  seedSha256: text("seed_sha256").notNull(),
  mode: text("mode").notNull(),
  reportJson: jsonb("report_json").notNull().default({}),
  importedBy: text("imported_by"),
  createdAt: watchTs(),
});

export const watchAddressSnapshots = pgTable("watch_address_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  addressId: uuid("address_id").notNull().references(() => watchAddresses.id),
  providerName: text("provider_name").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }).notNull(),
  blockHeight: bigint("block_height", { mode: "number" }),
  nativeBalanceRaw: text("native_balance_raw"),
  nativeBalanceDecimal: text("native_balance_decimal"),
  rawPayloadHash: text("raw_payload_hash"),
  isBaseline: boolean("is_baseline").notNull().default(false),
  createdAt: watchTs(),
});

export const watchEvents = pgTable("watch_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => watchCases.id),
  chain: text("chain").notNull(),
  network: text("network").notNull().default("mainnet"),
  txHash: text("tx_hash").notNull(),
  transactionGroupKey: text("transaction_group_key").notNull(),
  eventIndex: text("event_index").notNull(),
  eventKind: text("event_kind").notNull(),
  status: text("status").notNull().default("provisional"),
  fromAddressId: uuid("from_address_id").references(() => watchAddresses.id),
  toAddressId: uuid("to_address_id").references(() => watchAddresses.id),
  externalFromAddress: text("external_from_address"),
  externalToAddress: text("external_to_address"),
  assetSymbol: text("asset_symbol").notNull(),
  assetContract: text("asset_contract"),
  amountRaw: text("amount_raw").notNull(),
  amountDecimal: numeric("amount_decimal").notNull(),
  usdValueAtEvent: numeric("usd_value_at_event"),
  priceSource: text("price_source"),
  priceObservedAt: watchTsCol("price_observed_at"),
  blockHeight: bigint("block_height", { mode: "number" }),
  chainObservedAt: watchTsCol("chain_observed_at"),
  confirmations: integer("confirmations"),
  isAnchorEvent: boolean("is_anchor_event").notNull().default(false),
  severity: text("severity").notNull().default("low"),
  publicNote: text("public_note"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(() => new Date()),
  confirmedAt: watchTsCol("confirmed_at"),
  publicVisibleFrom: watchTsCol("public_visible_from"),
  retractedAt: watchTsCol("retracted_at"),
  retractionReason: text("retraction_reason"),
  providerPayloadHash: text("provider_payload_hash"),
  isTest: boolean("is_test").notNull().default(false),
  createdAt: watchTs(),
  updatedAt: updatedAtCol(),
});

export const watchSubscriptions = pgTable("watch_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").notNull().references(() => users.id),
  caseId: uuid("case_id").notNull().references(() => watchCases.id),
  minSeverity: text("min_severity").notNull().default("medium"),
  telegramEnabled: boolean("telegram_enabled").notNull().default(true),
  inAppEnabled: boolean("in_app_enabled").notNull().default(true),
  testExpiresAt: watchTsCol("test_expires_at"),
  isTest: boolean("is_test").notNull().default(false),
  createdAt: watchTs(),
  updatedAt: updatedAtCol(),
});

export const watchDeliveries = pgTable("watch_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => watchEvents.id),
  userId: integer("user_id").notNull().references(() => users.id),
  channel: text("channel").notNull(),
  status: text("status").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(() => new Date()),
  deliveredAt: watchTsCol("delivered_at"),
  providerMessageId: text("provider_message_id"),
  failureReason: text("failure_reason"),
  isInternal: boolean("is_internal").notNull().default(false),
  isTest: boolean("is_test").notNull().default(false),
  createdAt: watchTs(),
});

export const watchCorrections = pgTable("watch_corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => watchCases.id),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  fieldChanged: text("field_changed").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  reason: text("reason").notNull(),
  sourceId: uuid("source_id").references(() => watchSources.id),
  correctedBy: text("corrected_by").notNull(),
  approvedBy: text("approved_by"),
  createdAt: watchTs(),
});

export const watchAdminAudit = pgTable("watch_admin_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: integer("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  reason: text("reason"),
  createdAt: watchTs(),
});

export const watchBountyChecks = pgTable("watch_bounty_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => watchCases.id),
  target: text("target").notNull(),
  checkedBy: text("checked_by").notNull(),
  method: text("method").notNull(),
  resultSummary: text("result_summary").notNull(),
  sourceUrl: text("source_url"),
  publicStatusChanged: boolean("public_status_changed").notNull().default(false),
  approvedBy: text("approved_by"),
  checkedAt: timestamp("checked_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(() => new Date()),
  nextCheckAt: watchTsCol("next_check_at"),
  createdAt: watchTs(),
});
