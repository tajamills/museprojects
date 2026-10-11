-- 0005_admin_role.sql — Admin role on users.
-- Users whose email is listed in ADMIN_EMAILS are auto-promoted to 'admin'
-- on signup and on login. No admin UI yet; the role is exposed in auth and
-- workspace responses so the client can read it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
