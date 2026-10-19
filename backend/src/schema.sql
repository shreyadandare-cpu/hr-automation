CREATE TABLE IF NOT EXISTS employees (
  id             SERIAL PRIMARY KEY,
  emp_no         TEXT,
  name           TEXT NOT NULL,
  work_email     TEXT NOT NULL,
  personal_email TEXT,
  phone          TEXT,
  address        TEXT,
  dept           TEXT,
  title          TEXT,
  manager        TEXT,
  start_date     DATE,
  last_day       DATE,
  status         TEXT NOT NULL DEFAULT 'onboarding',
  dob            DATE,
  aadhaar_masked TEXT,
  pan_masked     TEXT,
  acct_masked    TEXT,
  ifsc           TEXT,
  apps           JSONB NOT NULL DEFAULT '[]',
  onboarded_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS employees_work_email_key ON employees (lower(work_email));

CREATE TABLE IF NOT EXISTS onboarding_drafts (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id       SERIAL PRIMARY KEY,
  ts       TIMESTAMPTZ NOT NULL DEFAULT now(),
  action   TEXT NOT NULL,
  work_email TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  work_email  TEXT NOT NULL,
  doc_key     TEXT NOT NULL,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  stored_name TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_email_idx ON documents (lower(work_email));

CREATE TABLE IF NOT EXISTS users (
  email         TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('hr','employee')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_email_idx ON sessions (email);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  email         TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('hr','employee')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_email_idx ON sessions (email);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Leave management. Rules (quotas, carry-over, salary cut) live in leave-rules.js at the repo root.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS monthly_gross  NUMERIC(12,2);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS casual_opening NUMERIC(5,1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS leave_requests (
  id         SERIAL PRIMARY KEY,
  work_email TEXT NOT NULL,
  type       TEXT NOT NULL,
  from_date  DATE NOT NULL,
  to_date    DATE NOT NULL,
  days       NUMERIC(5,1) NOT NULL,
  reason     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  paid_days  NUMERIC(5,1),
  lop_days   NUMERIC(5,1),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date)
);
-- Allowed leave types and half days. Re-applied on every start so existing databases pick up new types.
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS half TEXT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS notify JSONB NOT NULL DEFAULT '[]';
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_status_check;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_status_check CHECK (status IN ('pending','approved','declined','cancelled'));
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_type_check;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_type_check CHECK (type IN ('casual','sick','compoff','unpaid'));
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_half_check;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_half_check CHECK (half IS NULL OR (half IN ('first','second') AND to_date = from_date));
CREATE INDEX IF NOT EXISTS leave_requests_email ON leave_requests (lower(work_email), from_date);

CREATE TABLE IF NOT EXISTS comp_off_credits (
  id         SERIAL PRIMARY KEY,
  work_email TEXT NOT NULL,
  worked_on  DATE NOT NULL,
  days       NUMERIC(3,1) NOT NULL DEFAULT 1,
  reason     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Employees ask for comp-off credit (pending) and HR approves it; credits HR records directly are approved straight away.
ALTER TABLE comp_off_credits ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE comp_off_credits ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE comp_off_credits DROP CONSTRAINT IF EXISTS comp_off_credits_status_check;
ALTER TABLE comp_off_credits ADD CONSTRAINT comp_off_credits_status_check CHECK (status IN ('pending','approved','declined'));
DROP INDEX IF EXISTS comp_off_once_per_day;
CREATE UNIQUE INDEX IF NOT EXISTS comp_off_once_per_day ON comp_off_credits (lower(work_email), worked_on) WHERE status <> 'declined';

CREATE TABLE IF NOT EXISTS holidays (
  day  DATE PRIMARY KEY,
  name TEXT NOT NULL
);

-- Offboarding. One active offboarding per person; each tool to remove and each manual task is a step.
CREATE TABLE IF NOT EXISTS offboardings (
  id           SERIAL PRIMARY KEY,
  work_email   TEXT NOT NULL,
  last_day     DATE NOT NULL,
  transfer_to  TEXT,
  status       TEXT NOT NULL CHECK (status IN ('scheduled','in_progress','access_removed','completed','cancelled')),
  run_at       TIMESTAMPTZ NOT NULL,
  running      BOOLEAN NOT NULL DEFAULT false,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS offboardings_one_active ON offboardings (lower(work_email)) WHERE status <> 'cancelled';

CREATE TABLE IF NOT EXISTS offboarding_steps (
  id             SERIAL PRIMARY KEY,
  offboarding_id INTEGER NOT NULL REFERENCES offboardings(id),
  kind           TEXT NOT NULL CHECK (kind IN ('tool','task')),
  key            TEXT NOT NULL,
  label          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  detail         TEXT,
  done_at        TIMESTAMPTZ,
  UNIQUE (offboarding_id, key)
);

CREATE TABLE IF NOT EXISTS profiles (
  email      TEXT PRIMARY KEY,
  data       JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profile_photos (
  email       TEXT PRIMARY KEY,
  stored_name TEXT NOT NULL,
  mime        TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No duplicate emails: logins compare case-insensitively, and nobody can share a personal email.
-- Wrapped so a database that already holds duplicates still starts; the app checks them as well.
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'Duplicate logins exist, so the unique index was not created.';
END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS employees_personal_email_key ON employees (lower(personal_email))
    WHERE personal_email IS NOT NULL AND personal_email <> '';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'Duplicate personal emails exist, so the unique index was not created.';
END $$;

-- Only @wohlig.com addresses can be a login or an employee work email, even if the app code is bypassed.
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_company_email CHECK (lower(email) ~ '^[^@[:space:]]+@wohlig\.com$');
EXCEPTION WHEN duplicate_object THEN NULL;
          WHEN check_violation THEN RAISE NOTICE 'Some logins are not @wohlig.com, so the check was not added.';
END $$;
DO $$ BEGIN
  ALTER TABLE employees ADD CONSTRAINT employees_company_email CHECK (lower(work_email) ~ '^[^@[:space:]]+@wohlig\.com$');
EXCEPTION WHEN duplicate_object THEN NULL;
          WHEN check_violation THEN RAISE NOTICE 'Some work emails are not @wohlig.com, so the check was not added.';
END $$;
-- Reporting managers. A 'manager' login approves their team's leave; HR approves the managers' own leave.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('hr','manager','employee'));
ALTER TABLE employees ADD COLUMN IF NOT EXISTS reporting_manager TEXT;
