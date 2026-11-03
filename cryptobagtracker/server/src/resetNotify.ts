// Owner notification for password-reset requests (owner-ops only).
//
// The password-reset stopgap (Nov 2, 2026) is manual: a customer's
// request is recorded and support generates the one-time link by hand
// from the owner's Billing page. The owner asked (Nov 3, 2026) to be
// texted the moment a request lands, so she knows to go generate it.
//
// This POSTs a small JSON payload to RESET_NOTIFY_WEBHOOK_URL (e.g. a
// Zapier "Catch Hook" whose steps text the OWNER's phone). It is
// deliberately a SEPARATE hook from ALERT_WEBHOOK_URL: the live alert
// Zap runs its SMS step unconditionally on whatever arrives at its
// hook, with the message mapped from the alert payload's
// `message_short` field — it has no filter/branch on an event field,
// so reset payloads posted there would either error that Zap (missing
// `message_short`, the Oct 27, 2026 failure mode) or have to be
// stuffed into alert-shaped fields. A dedicated hook keeps the two
// flows independent.
//
// Fire-and-forget: if RESET_NOTIFY_WEBHOOK_URL is unset the app
// behaves exactly as before; a webhook failure is logged and
// swallowed — the customer's request and its neutral response are
// never affected.
//
// Customer-facing SMS alerts remain decided OFF for this product;
// this notifies the owner only and is not a customer feature.

export interface PasswordResetNotifyPayload {
  /** Discriminator marking this as a reset request, not a price alert. */
  event: "password_reset_requested";
  /** The email the reset was requested for. Requests are recorded
   *  whether or not the email belongs to an account (no enumeration),
   *  and the owner is notified either way. */
  email: string;
  /** ISO timestamp of the request. */
  requestedAt: string;
  /**
   * Ready-made text for an SMS step. Sent under both spellings for the
   * same reason as the alert payload (Oct 27, 2026): a Zap whose SMS
   * step is mapped to either key resolves.
   */
  message: string;
  message_short: string;
}

export function passwordResetNotifyPayload(
  email: string,
  requestedAt: Date,
): PasswordResetNotifyPayload {
  const message = `Password reset requested for ${email} on CryptoBagTracker — open the Billing page to generate the link.`;
  return {
    event: "password_reset_requested",
    email,
    requestedAt: requestedAt.toISOString(),
    message,
    message_short: message,
  };
}

export async function postPasswordResetNotify(
  payload: PasswordResetNotifyPayload,
): Promise<void> {
  const url = process.env.RESET_NOTIFY_WEBHOOK_URL;
  if (!url) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`webhook responded ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget: never throws, never blocks the request handler. */
export function firePasswordResetNotify(email: string, requestedAt: Date): void {
  if (!process.env.RESET_NOTIFY_WEBHOOK_URL) return;
  postPasswordResetNotify(passwordResetNotifyPayload(email, requestedAt)).catch((err) =>
    console.warn(
      "password reset: owner notify webhook failed:",
      err instanceof Error ? err.message : err,
    ),
  );
}
