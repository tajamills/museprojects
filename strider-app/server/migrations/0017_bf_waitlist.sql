-- 0017_bf_waitlist.sql — Black Friday waitlist signups for the
-- zepostia.com/black-friday landing page (Layla's waitlist-playbook
-- launch, Oct 21 2026). Public capture only: email is the identity
-- (unique — a repeat signup is answered "you're already on the
-- list", never a second row). Phone is optional and exists so the
-- weekly launch text can go out; first name is optional. No money
-- touches this table: the Black Friday deal and the confirmation-
-- page tripwire stay Layla-approval-gated and are NOT wired here.
CREATE TABLE bf_waitlist (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  first_name TEXT,
  source TEXT NOT NULL DEFAULT 'black-friday',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_bf_waitlist_created ON bf_waitlist(created_at);
