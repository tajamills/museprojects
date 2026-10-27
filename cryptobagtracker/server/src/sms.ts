// Per-customer SMS alerts via Twilio — phase 1 (Oct 27, 2026; spec:
// ~/workspace/audits/cbt-real-sms-spec-oct27.md).
//
// Everything in this module is gated on SMS_ALERTS_ENABLED=true. With the
// flag off (the default), no code path in the product calls the send
// function and the inbound webhook route answers 404.
//
// Credentials come from the environment only:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (E.164)
// Optional:
//   TWILIO_WEBHOOK_URL        public URL of /webhooks/twilio, used to
//                             validate inbound signatures (falls back to
//                             APP_BASE_URL + "/webhooks/twilio")
//   SMS_MONTHLY_CAP_PER_USER  per-user monthly send cap (default 300;
//                             0 = uncapped) — tail-risk control, see spec §4
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { decryptSecret } from "./crypto.js";
import * as schema from "./schema.js";

type Db = NodePgDatabase<typeof schema>;

export function smsAlertsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SMS_ALERTS_ENABLED === "true";
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export function twilioConfig(env: NodeJS.ProcessEnv = process.env): TwilioConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const fromNumber = env.TWILIO_FROM_NUMBER?.trim();
  if (!accountSid || !authToken || !fromNumber) return null;
  return { accountSid, authToken, fromNumber };
}

/** Monthly per-user send cap. Default 300; 0 means uncapped. */
export function smsMonthlyCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SMS_MONTHLY_CAP_PER_USER);
  if (env.SMS_MONTHLY_CAP_PER_USER != null && Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return 300;
}

/**
 * Normalize a user-typed phone number to E.164. US-centric: a bare 10-digit
 * number is treated as +1; an 11-digit number starting with 1 gets the +.
 * Anything already +-prefixed is kept if it is 8–15 digits total. Returns
 * null when the input can't be a dialable number.
 */
export function normalizePhoneNumber(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  let e164: string | null = null;
  if (trimmed.startsWith("+")) {
    e164 = `+${digits}`;
  } else if (digits.length === 10) {
    e164 = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    e164 = `+${digits}`;
  }
  if (!e164 || !/^\+\d{8,15}$/.test(e164)) return null;
  return e164;
}

export interface SmsSendResult {
  sid: string;
}

/**
 * Send one SMS through Twilio's Messages API (REST over fetch, no SDK).
 * Throws an Error carrying Twilio's message/code on any failure so the
 * caller can record the honest reason in alert history.
 */
export async function sendSmsMessage(to: string, body: string, cfg: TwilioConfig): Promise<SmsSendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64")}`,
        },
        body: new URLSearchParams({ From: cfg.fromNumber, To: to, Body: body }).toString(),
      },
    );
    const json = (await res.json().catch(() => null)) as
      | { sid?: string; message?: string; code?: number }
      | null;
    if (!res.ok || !json?.sid) {
      const detail = json?.message ? `${json.message}${json.code ? ` (code ${json.code})` : ""}` : `HTTP ${res.status}`;
      throw new Error(`Twilio send failed: ${detail}`);
    }
    return { sid: json.sid };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Inbound webhook (STOP / START) — Twilio POSTs form fields From + Body.
// ---------------------------------------------------------------------------

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "YES", "UNSTOP"]);

export type InboundKeyword = "stop" | "start" | null;

export function parseInboundKeyword(body: string | undefined): InboundKeyword {
  const word = (body ?? "").trim().toUpperCase();
  if (STOP_KEYWORDS.has(word)) return "stop";
  if (START_KEYWORDS.has(word)) return "start";
  return null;
}

/**
 * Validate an X-Twilio-Signature header: HMAC-SHA1 over the request URL
 * followed by each POST field name+value in sorted order, keyed with the
 * account auth token, base64-encoded (Twilio's documented scheme).
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + (params[key] ?? ""), url);
  const expected = createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The public URL Twilio signed against, from config (null if unknown). */
export function twilioWebhookUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.TWILIO_WEBHOOK_URL?.trim()) return env.TWILIO_WEBHOOK_URL.trim();
  if (env.APP_BASE_URL?.trim()) return `${env.APP_BASE_URL.trim().replace(/\/+$/, "")}/webhooks/twilio`;
  return null;
}

export interface InboundResult {
  matched: boolean;
  action: "opted-out" | "opted-in" | "ignored";
  userId: number | null;
}

/**
 * Apply an inbound SMS to the matching customer's settings. Stored numbers
 * are encrypted with a random IV, so matching decrypts candidates and
 * compares in E.164 — fine at CBT's scale (an indexed hash column is the
 * phase-2 scaling step, see spec §6). A STOP sets smsOptedOut; a START
 * clears it. Non-keyword messages and unknown numbers are ignored.
 */
export async function handleTwilioInbound(
  db: Db,
  params: { From?: string; Body?: string },
): Promise<InboundResult> {
  const keyword = parseInboundKeyword(params.Body);
  const from = params.From ? normalizePhoneNumber(params.From) : null;
  if (!keyword || !from) return { matched: false, action: "ignored", userId: null };

  // For a STOP we scan everyone with a stored number; for a START only the
  // currently opted-out rows can change state, so scan just those.
  const candidates =
    keyword === "stop"
      ? await db.select().from(schema.alertSettings)
      : await db
          .select()
          .from(schema.alertSettings)
          .where(eq(schema.alertSettings.smsOptedOut, true));
  for (const row of candidates) {
    if (!row.phoneNumberEnc) continue;
    let stored: string | null = null;
    try {
      stored = normalizePhoneNumber(decryptSecret(row.phoneNumberEnc));
    } catch {
      continue; // unreadable row (key rotated?) — skip, never crash the webhook
    }
    if (stored !== from) continue;
    if (keyword === "stop") {
      await db
        .update(schema.alertSettings)
        .set({ smsOptedOut: true, smsOptedOutAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.alertSettings.userId, row.userId));
      return { matched: true, action: "opted-out", userId: row.userId };
    }
    await db
      .update(schema.alertSettings)
      .set({ smsOptedOut: false, smsOptedOutAt: null, updatedAt: new Date() })
      .where(eq(schema.alertSettings.userId, row.userId));
    return { matched: true, action: "opted-in", userId: row.userId };
  }
  return { matched: false, action: "ignored", userId: null };
}
