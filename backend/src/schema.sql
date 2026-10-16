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

ALTER TABLE employees ADD COLUMN IF NOT EXISTS google_status TEXT;  -- pending, active, simulated, existing, failed
ALTER TABLE employees ADD COLUMN IF NOT EXISTS google_error TEXT;
