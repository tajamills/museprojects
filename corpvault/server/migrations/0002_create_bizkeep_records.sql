-- Port of drizzle/0002_create_bizkeep_records.sql (SQLite → Postgres).
-- SQLite INTEGER PRIMARY KEY AUTOINCREMENT → INTEGER GENERATED ALWAYS AS IDENTITY.
-- SQLite INTEGER ms timestamps → TIMESTAMPTZ. INTEGER booleans → BOOLEAN.
DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE accounts (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
--> statement-breakpoint
CREATE TABLE entities (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  state TEXT NOT NULL,
  formation_date TEXT NOT NULL,
  ein_value TEXT,
  registered_agent TEXT,
  agent_renewal_date TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE documents (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  category TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  blob_key TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE reminders (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  reminder_type TEXT NOT NULL,
  due_date TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  source_label TEXT,
  source_url TEXT,
  auto_generated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE meetings (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  meeting_type TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  meeting_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  location TEXT,
  attendees_json TEXT NOT NULL,
  agenda_json TEXT NOT NULL,
  discussion_summary TEXT NOT NULL,
  decisions_json TEXT NOT NULL,
  action_items_json TEXT NOT NULL,
  next_meeting_date TEXT,
  recorded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX entities_account_idx ON entities(account_id);
--> statement-breakpoint
CREATE INDEX documents_account_idx ON documents(account_id);
--> statement-breakpoint
CREATE INDEX reminders_account_due_idx ON reminders(account_id, due_date);
--> statement-breakpoint
CREATE INDEX meetings_account_date_idx ON meetings(account_id, meeting_date);
