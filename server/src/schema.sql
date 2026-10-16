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
