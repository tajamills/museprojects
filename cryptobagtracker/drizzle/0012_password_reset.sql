-- 0012_password_reset.sql — forgot-password reset, admin-link stopgap (Nov 2, 2026).
-- CBT has no email-sending service, so a signed-out user who forgets their
-- password files a reset REQUEST here from the sign-in screen; the owner
-- (support) generates a one-time reset link for the request from the
-- account page and sends it to the customer manually — nothing is emailed
-- (see requestPasswordReset / listPasswordResetRequests /
-- generatePasswordResetLink / resetPassword in server/src/actions.ts).
-- The raw token is never stored, only its SHA-256 hash; a link expires in
-- 60 minutes and works exactly once. Rows for addresses with no account
-- are kept (user_id NULL) so the public response never reveals whether an
-- account exists, and so requests are rate-limited the same way either way.
CREATE TABLE password_reset_requests (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER,
  email TEXT NOT NULL,
  token_hash TEXT,
  expires_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  requested_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX password_reset_requests_created_idx ON password_reset_requests (created_at DESC);
