-- 0004_admin_role.sql — Admin role on accounts.
-- Accounts whose email is listed in ADMIN_EMAILS are auto-promoted to 'admin'
-- on signup and on login. No admin UI yet; the role is exposed in session
-- responses so the client can read it.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
