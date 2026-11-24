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
-- Google Workspace account state for onboarding (used by index.js); were missing from the schema.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS google_status TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS google_error  TEXT;

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

-- Attempt counters for sign-in lockout and rate limits (limits.js). In the database, not in memory, so they survive a
-- restart and every server instance shares them. Old rows are removed as they expire.
CREATE TABLE IF NOT EXISTS rate_limits (
  key        TEXT NOT NULL,
  hit_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_limits_key_idx ON rate_limits (key, hit_at);

-- Leave management. Rules (quotas, carry-over, salary cut) live in frontend/leave-rules.cjs.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS monthly_gross  NUMERIC(12,2);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS casual_opening NUMERIC(5,1) NOT NULL DEFAULT 0;
-- Leave balances brought over from a previous leave system: { "asOf": "2026-11-23", "casual": 4, "sick": 1.5, "compoff": 0 }. For that year each balance
-- starts from the figure on that day and only leave after it counts (leave-rules.cjs). Null = nothing brought over.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_opening JSONB;

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
-- Who asked for it (the employee, or HR on their behalf) and who approved, declined or cancelled it. Empty on older rows.
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS decided_by TEXT;
-- The approver's comment on an approval, and the reason for a decline (shown to the employee).
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS decision_note TEXT;
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_status_check;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_status_check CHECK (status IN ('pending','approved','declined','cancelled'));
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_type_check;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_type_check CHECK (type IN ('casual','sick','compoff','unpaid'));
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_half_check;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_half_check CHECK (half IS NULL OR (half IN ('first','second') AND to_date = from_date));
CREATE INDEX IF NOT EXISTS leave_requests_email ON leave_requests (lower(work_email), from_date);

-- The leave policy numbers HR can change (leave.manage): casualPerYear, sickPerYear, lopDivisor, sickBackdateDays. A key that is not here uses the
-- default in frontend/leave-rules.cjs. They are applied to the rules at start-up and when saved, and the pages read them from /leave-rules.js.
CREATE TABLE IF NOT EXISTS leave_policy (
  key        TEXT PRIMARY KEY,
  value      NUMERIC(8,2) NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
-- Who asked for a comp off and who decided it, for the comp off request history.
ALTER TABLE comp_off_credits ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE comp_off_credits ADD COLUMN IF NOT EXISTS decided_by TEXT;
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
-- There is no manager role: managers are whoever has people reporting to them. Older manager logins become employees.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role='employee' WHERE role='manager';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('hr','employee'));
ALTER TABLE employees ADD COLUMN IF NOT EXISTS reporting_manager TEXT;

-- One-time links that open the app for a new account. Only a hash of the link's secret is stored.
CREATE TABLE IF NOT EXISTS invites (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
-- pending | accepted | expired | revoked (a newer invite replaces an older one)
ALTER TABLE invites ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
UPDATE invites SET status = 'accepted' WHERE used_at IS NOT NULL AND status = 'pending';
CREATE INDEX IF NOT EXISTS invites_email_idx ON invites (lower(email));

-- ---------- Reimbursements ----------
-- Categories are configurable. max_amount is an optional policy limit: claims above it are flagged for HR, never auto-rejected.
CREATE TABLE IF NOT EXISTS reimbursement_categories (
  key        TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  max_amount NUMERIC(12,2),
  active     BOOLEAN NOT NULL DEFAULT true,
  sort       INTEGER NOT NULL DEFAULT 0
);
INSERT INTO reimbursement_categories (key, name, sort) VALUES
  ('travel','Travel',1), ('food','Food',2), ('accommodation','Accommodation',3), ('internet','Internet',4),
  ('mobile','Mobile',5), ('office_supplies','Office Supplies',6), ('client_meeting','Client Meeting',7),
  ('training','Training',8), ('other','Other',9)
ON CONFLICT (key) DO NOTHING;

-- Payroll: one run per month. Base salary, leave deductions and reimbursements are stored separately per person,
-- so a reimbursement never changes anyone's salary and stays traceable to the run that paid it.
CREATE TABLE IF NOT EXISTS payroll_runs (
  id           SERIAL PRIMARY KEY,
  period       TEXT NOT NULL UNIQUE CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status       TEXT NOT NULL CHECK (status IN ('processed','paid')),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_by TEXT NOT NULL,
  paid_at      TIMESTAMPTZ,
  paid_by      TEXT
);
CREATE TABLE IF NOT EXISTS payroll_items (
  id                  SERIAL PRIMARY KEY,
  run_id              INTEGER NOT NULL REFERENCES payroll_runs(id),
  work_email          TEXT NOT NULL,
  base_salary         NUMERIC(12,2),
  lop_days            NUMERIC(5,1) NOT NULL DEFAULT 0,
  lop_deduction       NUMERIC(12,2) NOT NULL DEFAULT 0,
  reimbursement_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  payable             NUMERIC(12,2) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_items_once ON payroll_items (run_id, lower(work_email));

-- Payslips. HR enters each person's salary breakdown with the first month it applies to; a new row for a raise keeps the old one.
-- Processing a month stores the whole payslip in payroll_items.slip, so a later salary change never alters a past payslip.
-- How the amounts are worked out (TDS included) is in payroll-calc.js.
CREATE TABLE IF NOT EXISTS salary_structures (
  id               SERIAL PRIMARY KEY,
  work_email       TEXT NOT NULL,
  effective_from   TEXT NOT NULL CHECK (effective_from ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  earnings         JSONB NOT NULL,
  pf_employee      NUMERIC(12,2) NOT NULL DEFAULT 0,
  professional_tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_deductions JSONB NOT NULL DEFAULT '[]',
  tds_monthly      NUMERIC(12,2),
  updated_by       TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS salary_structures_once ON salary_structures (lower(work_email), effective_from);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pf_number TEXT;
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS slip JSONB;
-- Payslips made automatically start as a draft HR can check; employees see them from published_at (set at publish_at, or by HR).
-- Runs HR processes by hand, and every run from before this, are published.
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ;
-- Links in automatic emails work for a short time (email-links.js). Only a hash of each link's token is kept.
CREATE TABLE IF NOT EXISTS email_links (
  id         SERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  path       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
-- Only runs from before the review workflow ('processed'/'paid' with no publish date); workflow runs are published on approval.
UPDATE payroll_runs SET published_at = processed_at WHERE published_at IS NULL AND publish_at IS NULL AND status IN ('processed','paid')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payroll_runs' AND column_name='workflow' AND table_schema=current_schema());

CREATE TABLE IF NOT EXISTS reimbursements (
  id               SERIAL PRIMARY KEY,
  claim_no         TEXT UNIQUE,
  work_email       TEXT NOT NULL,
  category         TEXT NOT NULL REFERENCES reimbursement_categories(key),
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency         TEXT NOT NULL DEFAULT 'INR',
  expense_date     DATE NOT NULL,
  description      TEXT NOT NULL,
  vendor           TEXT,
  invoice_no       TEXT,
  payment_method   TEXT,
  doc_name         TEXT,
  doc_mime         TEXT,
  doc_size         INTEGER,
  doc_stored       TEXT,
  doc_uploaded_at  TIMESTAMPTZ,
  validation       JSONB NOT NULL DEFAULT '{}',   -- file checks, fields read from the document, amount comparison, policy
  duplicates       JSONB NOT NULL DEFAULT '[]',   -- earlier claims that look like the same expense
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
                     ('draft','submitted','under_review','changes_requested','resubmitted','approved','rejected',
                      'payroll_pending','in_payroll','paid')),
  rejection_reason TEXT,
  rejection_note   TEXT,
  change_comment   TEXT,
  created_by       TEXT NOT NULL,
  submitted_at     TIMESTAMPTZ,
  approved_by      TEXT,
  approved_at      TIMESTAMPTZ,
  payroll_period   TEXT,
  payroll_run_id   INTEGER REFERENCES payroll_runs(id),
  paid_at          TIMESTAMPTZ,
  paid_amount      NUMERIC(12,2),
  last_reminded_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reimbursements_email ON reimbursements (lower(work_email));
CREATE INDEX IF NOT EXISTS reimbursements_status ON reimbursements (status);

-- Every step of a claim, in order. Drives the status stepper and the timeline; the audit log gets a copy too.
CREATE TABLE IF NOT EXISTS reimbursement_events (
  id               SERIAL PRIMARY KEY,
  reimbursement_id INTEGER NOT NULL REFERENCES reimbursements(id),
  at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor            TEXT,
  kind             TEXT NOT NULL,
  status           TEXT,
  note             TEXT
);
CREATE INDEX IF NOT EXISTS reimbursement_events_claim ON reimbursement_events (reimbursement_id, id);

-- In-app notifications (the bell) and a log of every email the system tried to send.
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  recipient  TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notifications_recipient ON notifications (lower(recipient), id DESC);
CREATE TABLE IF NOT EXISTS email_outbox (
  id         SERIAL PRIMARY KEY,
  recipient  TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('sent','skipped','failed')),
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A claim holds one or more expenses (travel, food, ...); its amount is always their total. Each expense has its own
-- receipt, or is marked as having none (small expenses such as auto rides).
CREATE TABLE IF NOT EXISTS reimbursement_items (
  id               SERIAL PRIMARY KEY,
  reimbursement_id INTEGER NOT NULL REFERENCES reimbursements(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL DEFAULT 1,
  category         TEXT NOT NULL REFERENCES reimbursement_categories(key),
  expense_date     DATE NOT NULL,
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  description      TEXT NOT NULL,
  payment_method   TEXT,
  no_receipt       BOOLEAN NOT NULL DEFAULT false,
  source           TEXT NOT NULL DEFAULT 'form' CHECK (source IN ('form','excel'))
);
CREATE INDEX IF NOT EXISTS reimbursement_items_claim ON reimbursement_items (reimbursement_id, position);
CREATE TABLE IF NOT EXISTS reimbursement_documents (
  id               SERIAL PRIMARY KEY,
  reimbursement_id INTEGER NOT NULL REFERENCES reimbursements(id) ON DELETE CASCADE,
  item_id          INTEGER REFERENCES reimbursement_items(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  mime             TEXT NOT NULL,
  size             INTEGER NOT NULL,
  stored           TEXT NOT NULL,
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  validation       JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS reimbursement_documents_claim ON reimbursement_documents (reimbursement_id);
-- Claims filed before expenses existed become one expense with their one receipt (runs once per claim).
INSERT INTO reimbursement_items (reimbursement_id, position, category, expense_date, amount, description, payment_method)
  SELECT r.id, 1, r.category, r.expense_date, r.amount, r.description, r.payment_method FROM reimbursements r
  WHERE NOT EXISTS (SELECT 1 FROM reimbursement_items i WHERE i.reimbursement_id = r.id);
INSERT INTO reimbursement_documents (reimbursement_id, item_id, name, mime, size, stored, uploaded_at, validation)
  SELECT r.id, (SELECT min(i.id) FROM reimbursement_items i WHERE i.reimbursement_id = r.id), r.doc_name, r.doc_mime,
         coalesce(r.doc_size, 0), r.doc_stored, coalesce(r.doc_uploaded_at, r.created_at),
         jsonb_build_object('file', r.validation->'file', 'read', r.validation->'read')
  FROM reimbursements r
  WHERE r.doc_stored IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reimbursement_documents d WHERE d.reimbursement_id = r.id);
UPDATE reimbursements r SET doc_stored = NULL
  WHERE r.doc_stored IS NOT NULL AND EXISTS (SELECT 1 FROM reimbursement_documents d WHERE d.reimbursement_id = r.id);

-- The ID card and exit interview items were dropped from the offboarding checklist.
DELETE FROM offboarding_steps WHERE kind = 'task' AND key IN ('idcard', 'exit_interview');

-- Company data (projects, who works on them, attendance) and the office each person works from.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_location TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS sub_title TEXT;
-- Set when HR marks someone's onboarding as finished (the Mark as active button). Until then a recent joiner shows as Onboarding.
-- (Not onboarded_at: that one means the person was added through the onboarding form.)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS onboarding_closed_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, project_lead TEXT, start_date DATE, end_date DATE,
  status TEXT NOT NULL DEFAULT 'Active', description TEXT);
CREATE TABLE IF NOT EXISTS employee_project_allocations (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  start_date DATE, end_date DATE, project_lead TEXT, location TEXT, status TEXT NOT NULL DEFAULT 'Active',
  end_reason TEXT, handover_to TEXT, handover_notes TEXT, transferred_to TEXT);
CREATE TABLE IF NOT EXISTS attendance_punches (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL, punch_time TIME NOT NULL, direction TEXT NOT NULL, source TEXT, note TEXT, created_by TEXT);
CREATE INDEX IF NOT EXISTS attendance_punches_day ON attendance_punches (employee_id, work_date);
CREATE INDEX IF NOT EXISTS attendance_punches_date ON attendance_punches (work_date);

-- Office biometric device: which device user ID is which employee, and punches from IDs nobody has linked yet.
CREATE TABLE IF NOT EXISTS device_users (
  device_user_id TEXT PRIMARY KEY,
  employee_id    INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS device_unmatched (
  device_user_id TEXT NOT NULL,
  punched_at     TIMESTAMP NOT NULL,   -- Indian wall-clock time, as the device shows it
  PRIMARY KEY (device_user_id, punched_at));
CREATE UNIQUE INDEX IF NOT EXISTS attendance_punches_device_once ON attendance_punches (employee_id, work_date, punch_time) WHERE source = 'device';

-- ---------- Invoice-first claims, partial approval, travel policy, budget requests, holiday calendar ----------
CREATE TABLE IF NOT EXISTS app_migrations (key TEXT PRIMARY KEY, ran_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- Pre-approved spending: a team lead asks HR for a budget first, then files the final bill against it.
CREATE TABLE IF NOT EXISTS budget_requests (
  id               SERIAL PRIMARY KEY,
  request_no       TEXT UNIQUE,
  work_email       TEXT NOT NULL,
  purpose          TEXT NOT NULL,
  category         TEXT NOT NULL REFERENCES reimbursement_categories(key),
  requested_budget NUMERIC(12,2) NOT NULL CHECK (requested_budget > 0),
  approved_budget  NUMERIC(12,2) CHECK (approved_budget > 0 AND approved_budget <= requested_budget),
  headcount        INTEGER CHECK (headcount > 0),
  event_date       DATE NOT NULL,
  description      TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'submitted'
                   CHECK (status IN ('submitted','under_review','approved','partially_approved','rejected')),
  decision_reason  TEXT,
  decided_by       TEXT,
  decided_at       TIMESTAMPTZ,
  created_by       TEXT NOT NULL,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reminded_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS budget_request_events (
  id                SERIAL PRIMARY KEY,
  budget_request_id INTEGER NOT NULL REFERENCES budget_requests(id) ON DELETE CASCADE,
  at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor             TEXT,
  kind              TEXT NOT NULL,
  status            TEXT,
  note              TEXT
);
CREATE INDEX IF NOT EXISTS budget_request_events_req ON budget_request_events (budget_request_id, id);

-- A claim is a plain expense claim, or the final bill against an approved budget. Its requested amount is never
-- overwritten: eligible (after policy and budget), approved (HR's decision) and the differences are stored beside it.
ALTER TABLE reimbursements ALTER COLUMN category DROP NOT NULL;
ALTER TABLE reimbursements ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE reimbursements ALTER COLUMN expense_date DROP NOT NULL;
ALTER TABLE reimbursements ALTER COLUMN description DROP NOT NULL;
ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS budget_request_id INTEGER REFERENCES budget_requests(id);
ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS requested_amount NUMERIC(12,2);
ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS eligible_amount NUMERIC(12,2);
ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS non_eligible_amount NUMERIC(12,2);
ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS approved_amount NUMERIC(12,2);
ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS unapproved_amount NUMERIC(12,2);
ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS approval_reason TEXT;
ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS eligibility JSONB NOT NULL DEFAULT '{}';
DO $$ BEGIN
  ALTER TABLE reimbursements ADD CONSTRAINT reimbursements_approved_le_requested
    CHECK (approved_amount IS NULL OR (approved_amount > 0 AND approved_amount <= requested_amount));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS reimbursements_one_claim_per_budget ON reimbursements (budget_request_id)
  WHERE budget_request_id IS NOT NULL AND status <> 'rejected';
-- Claims approved before partial approval existed were approved in full.
UPDATE reimbursements SET requested_amount = amount, approved_amount = amount, unapproved_amount = 0
  WHERE status IN ('payroll_pending','in_payroll','paid') AND approved_amount IS NULL;
UPDATE reimbursements SET requested_amount = amount
  WHERE requested_amount IS NULL AND status NOT IN ('draft','changes_requested');

-- An expense line can start from an uploaded invoice and be completed by the employee, so its fields can be empty
-- while it is a draft (submitting checks they are filled in). What was read from the invoice is kept in `extracted`.
ALTER TABLE reimbursement_items ALTER COLUMN category DROP NOT NULL;
ALTER TABLE reimbursement_items ALTER COLUMN expense_date DROP NOT NULL;
ALTER TABLE reimbursement_items ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE reimbursement_items ALTER COLUMN description DROP NOT NULL;
ALTER TABLE reimbursement_items ADD COLUMN IF NOT EXISTS vendor TEXT;
ALTER TABLE reimbursement_items ADD COLUMN IF NOT EXISTS invoice_no TEXT;
ALTER TABLE reimbursement_items ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE reimbursement_items ADD COLUMN IF NOT EXISTS extracted JSONB;
ALTER TABLE reimbursement_items ADD COLUMN IF NOT EXISTS travel_class TEXT;
ALTER TABLE reimbursement_items ADD COLUMN IF NOT EXISTS policy_fare NUMERIC(12,2) CHECK (policy_fare > 0);
ALTER TABLE reimbursement_items DROP CONSTRAINT IF EXISTS reimbursement_items_source_check;
ALTER TABLE reimbursement_items ADD CONSTRAINT reimbursement_items_source_check CHECK (source IN ('form','excel','document'));

-- Travel policy: the highest class a category allows (empty = no class rule). HR changes it on the categories card.
ALTER TABLE reimbursement_categories ADD COLUMN IF NOT EXISTS allowed_class TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE key = 'travel-policy-economy') THEN
    UPDATE reimbursement_categories SET allowed_class = 'Economy' WHERE key = 'travel';
    INSERT INTO app_migrations (key) VALUES ('travel-policy-economy');
  END IF;
END $$;

-- Holiday calendar. The company list (Holiday List 2026 Wohlig.pdf) is imported once and marked as imported;
-- holidays HR adds later are 'manual'. Removing an imported holiday is not undone on the next start.
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE key = 'holidays-2026-wohlig-pdf') THEN
    INSERT INTO holidays (day, name, source) VALUES
      ('2026-01-01', 'New Year Day', 'imported'),
      ('2026-01-26', 'Republic Day', 'imported'),
      ('2026-03-03', 'Holi (Second Day)', 'imported'),
      ('2026-03-19', 'Gudhi Padwa', 'imported'),
      ('2026-04-03', 'Good Friday', 'imported'),
      ('2026-05-01', 'Maharashtra Day', 'imported'),
      ('2026-08-15', 'Independence Day', 'imported'),
      ('2026-09-14', 'Ganesh Chaturthi', 'imported'),
      ('2026-10-02', 'Mahatma Gandhi Jayanti', 'imported'),
      ('2026-10-20', 'Dasara', 'imported'),
      ('2026-11-08', 'Diwali (Laxmi Pujan)', 'imported'),
      ('2026-11-10', 'Diwali (Bali Pratipada)', 'imported'),
      ('2026-12-25', 'Christmas', 'imported')
    ON CONFLICT (day) DO UPDATE SET name = EXCLUDED.name, source = 'imported';
    INSERT INTO app_migrations (key) VALUES ('holidays-2026-wohlig-pdf');
  END IF;
END $$;

-- Which tools each person has been given (or had removed), and what the tool said.
CREATE TABLE IF NOT EXISTS tool_access (
  work_email TEXT NOT NULL, tool TEXT NOT NULL, status TEXT NOT NULL, detail TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (work_email, tool));
-- Claude access asked for by HR and waiting for the Claude admin to invite the person (status 'requested').
ALTER TABLE tool_access ADD COLUMN IF NOT EXISTS requested_by TEXT;
ALTER TABLE tool_access ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;
ALTER TABLE tool_access ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;

-- People who have already left are not on any project any more.
UPDATE employee_project_allocations a SET status='Ended', end_date=coalesce(a.end_date, e.last_day, CURRENT_DATE), end_reason=coalesce(a.end_reason, 'Left the company')
  FROM employees e WHERE e.id = a.employee_id AND e.status = 'offboarded' AND a.status = 'Active';

-- Whether someone joined as a regular employee or an intern.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'Employee';

-- The company feed on the dashboard: HR posts, everyone likes and comments.
CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY, author_email TEXT NOT NULL, body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS post_likes (
  post_id INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, email TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, email));
CREATE TABLE IF NOT EXISTS post_comments (
  id SERIAL PRIMARY KEY, post_id INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, author_email TEXT NOT NULL,
  body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS post_comments_post ON post_comments (post_id, id);
-- Pictures on feed posts. Uploaded first (post_id empty), then attached when the post is published.
CREATE TABLE IF NOT EXISTS post_images (
  id SERIAL PRIMARY KEY, post_id INT REFERENCES posts(id) ON DELETE CASCADE, uploaded_by TEXT NOT NULL,
  stored_name TEXT NOT NULL, mime TEXT NOT NULL, position INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS post_images_post ON post_images (post_id, position);

-- Posts get an optional title, an edited time and internal shares (to colleagues through the bell, or a copied link).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS post_shares (
  id SERIAL PRIMARY KEY, post_id INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, shared_by TEXT NOT NULL,
  shared_with TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());   -- shared_with empty = the link was copied
CREATE INDEX IF NOT EXISTS post_shares_post ON post_shares (post_id);

-- Money paid to an employee ahead of time (a travel advance, a salary advance) and what has been recovered of it.
-- Outstanding = amount - recoveries; the offboarding financial clearance deducts what is still outstanding.
CREATE TABLE IF NOT EXISTS employee_advances (
  id SERIAL PRIMARY KEY, work_email TEXT NOT NULL, advance_date DATE NOT NULL, reason TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0), created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS employee_advances_email ON employee_advances (lower(work_email));
CREATE TABLE IF NOT EXISTS advance_recoveries (
  id SERIAL PRIMARY KEY, advance_id INT NOT NULL REFERENCES employee_advances(id), amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  recovered_on DATE NOT NULL, note TEXT, recorded_by TEXT NOT NULL, offboarding_id INT REFERENCES offboardings(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS advance_recoveries_advance ON advance_recoveries (advance_id);
-- Instalments (2026-11-24, as Keka's loans and salary advances): a fixed amount payroll deducts each month from a month on, until
-- the advance is repaid. A recovery made by payroll names its month, once per advance and month (recorded when the month is approved).
ALTER TABLE employee_advances ADD COLUMN IF NOT EXISTS monthly_recovery NUMERIC(12,2) CHECK (monthly_recovery IS NULL OR monthly_recovery > 0);
ALTER TABLE employee_advances ADD COLUMN IF NOT EXISTS recover_from TEXT CHECK (recover_from IS NULL OR recover_from ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE advance_recoveries ADD COLUMN IF NOT EXISTS payroll_period TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS advance_recoveries_payroll ON advance_recoveries (advance_id, payroll_period) WHERE payroll_period IS NOT NULL;
CREATE INDEX IF NOT EXISTS employee_advances_instalments ON employee_advances (recover_from) WHERE monthly_recovery IS NOT NULL;

-- Each time HR confirms an offboarding's financial clearance: the figures as they were, who confirmed it and when.
CREATE TABLE IF NOT EXISTS offboarding_clearances (
  id SERIAL PRIMARY KEY, offboarding_id INT NOT NULL REFERENCES offboardings(id), work_email TEXT NOT NULL, exit_date DATE NOT NULL,
  final_salary NUMERIC(12,2), reimbursements_payable NUMERIC(12,2) NOT NULL DEFAULT 0, advance_outstanding NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_recovery NUMERIC(12,2) NOT NULL DEFAULT 0, net_salary NUMERIC(12,2), final_payout NUMERIC(12,2),
  month_end_window BOOLEAN NOT NULL DEFAULT false, status TEXT NOT NULL CHECK (status IN ('cleared','recovery_confirmed')),
  details JSONB NOT NULL DEFAULT '{}', completed_by TEXT NOT NULL, completed_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS offboarding_clearances_off ON offboarding_clearances (offboarding_id, id DESC);

-- IT admins manage company assets (laptops, phones...). HR can switch this on per login in Manage users. It starts on for anyone whose title is IT Admin.
ALTER TABLE users ADD COLUMN IF NOT EXISTS it_admin BOOLEAN NOT NULL DEFAULT false;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE key = 'it-admin-from-title') THEN
    UPDATE users u SET it_admin = true FROM employees e WHERE lower(e.work_email) = lower(u.email) AND e.title ILIKE '%IT admin%';
    INSERT INTO app_migrations (key) VALUES ('it-admin-from-title');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  tag TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  serial_no TEXT,
  purchased_on DATE, warranty_until DATE,
  status TEXT NOT NULL DEFAULT 'In stock' CHECK (status IN ('In stock','Assigned','In repair','Retired')),
  assigned_to INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  assigned_on DATE,
  notes TEXT,
  created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS asset_events (
  id SERIAL PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL DEFAULT now(), by_email TEXT, action TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS asset_events_asset ON asset_events (asset_id, at DESC);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS location TEXT;

-- Celebrations: birthday and welcome posters HR creates and emails to everyone. One row per poster; the row is a draft until HR
-- sends it. A person gets one birthday poster a year (occasion_key birthday:YYYY) and one welcome poster ever (welcome); the
-- unique index covers every poster that was sent, so retrying a failed one never makes a second.
CREATE TABLE IF NOT EXISTS celebrations (
  id             SERIAL PRIMARY KEY,
  occasion       TEXT NOT NULL CHECK (occasion IN ('birthday','welcome')),
  occasion_key   TEXT NOT NULL,
  employee_email TEXT NOT NULL,
  employee_name  TEXT NOT NULL,
  template       TEXT NOT NULL,
  heading        TEXT,
  designation    TEXT,
  joining_date   DATE,
  message        TEXT,
  poster_file    TEXT,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','sent','partial','failed')),
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  send_started_at TIMESTAMPTZ,
  sent_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS celebrations_once ON celebrations (lower(employee_email), occasion_key) WHERE status <> 'draft';
CREATE INDEX IF NOT EXISTS celebrations_recent ON celebrations (id DESC);
-- Who a poster was emailed to (fixed when sending starts) and how each delivery went, so a retry only touches the ones not sent.
CREATE TABLE IF NOT EXISTS celebration_recipients (
  celebration_id INT NOT NULL REFERENCES celebrations(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  name           TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  error          TEXT,
  sent_at        TIMESTAMPTZ,
  PRIMARY KEY (celebration_id, email)
);
-- The daily check tells HR about a birthday or a new joiner once; this remembers what it already said.
CREATE TABLE IF NOT EXISTS celebration_alerts (
  employee_email TEXT NOT NULL,
  alert_key      TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_email, alert_key)
);

-- Digital Kit: one small record per employee (personal details used to personalise the kit), and the shared master resources HR manages.
CREATE TABLE IF NOT EXISTS digital_kits (
  employee_id INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  source      TEXT NOT NULL DEFAULT 'migration',
  overrides   JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS digital_kit_resources (
  id          SERIAL PRIMARY KEY,
  module      TEXT NOT NULL CHECK (module IN ('text','template','download','background','linkedin','card')),
  category    TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  body        TEXT,
  filename    TEXT,
  mime        TEXT,
  size        INTEGER,
  stored_name TEXT,
  published   BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS digital_kit_resources_module ON digital_kit_resources (module, published);
CREATE TABLE IF NOT EXISTS digital_kit_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Digital Kit: who a shared resource is for. Empty means everyone; otherwise words matched against a person's designation and department (and "hr" for the HR role).
ALTER TABLE digital_kit_resources ADD COLUMN IF NOT EXISTS audience TEXT[] NOT NULL DEFAULT '{}';

-- Celebrations: more occasions (work anniversary, new certification, new role), a headline emphasis (shown in italic), a look
-- (maroon or warm light) and one extra detail line (the certification).
ALTER TABLE celebrations ADD COLUMN IF NOT EXISTS emphasis TEXT;
ALTER TABLE celebrations ADD COLUMN IF NOT EXISTS detail   TEXT;
ALTER TABLE celebrations ADD COLUMN IF NOT EXISTS theme    TEXT NOT NULL DEFAULT 'maroon';
ALTER TABLE celebrations DROP CONSTRAINT IF EXISTS celebrations_occasion_check;
ALTER TABLE celebrations ADD CONSTRAINT celebrations_occasion_check CHECK (occasion IN ('birthday','welcome','anniversary','certified','newrole'));

-- The poster in a celebration email is a linked picture (not an attachment) at /p/<token>.png.
ALTER TABLE celebrations ADD COLUMN IF NOT EXISTS poster_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS celebrations_poster_token ON celebrations (poster_token) WHERE poster_token IS NOT NULL;

-- Festival Wishes (everyone): the festivals employees can make greeting images for, and the dates they fall on. The look of each
-- festival's templates lives in the frontend (src/modules/festivals); this is what changes year to year. Dates of lunar festivals
-- (Eid, Diwali...) differ each year, so add the new year's dates here (INSERT INTO festival_dates) and nothing else needs a release.
CREATE TABLE IF NOT EXISTS festivals (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort        INT  NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS festival_dates (
  slug TEXT NOT NULL REFERENCES festivals(slug) ON DELETE CASCADE,
  day  DATE NOT NULL,
  PRIMARY KEY (slug, day)
);
INSERT INTO festivals (slug, name, description, sort) VALUES
  ('diwali',           'Diwali',               'The festival of lights: diyas, rangoli and new beginnings.', 1),
  ('holi',             'Holi',                 'The festival of colours that welcomes spring.', 2),
  ('eid-ul-fitr',      'Eid-ul-Fitr',          'Eid Mubarak: the joyful end of Ramadan.', 3),
  ('eid-ul-adha',      'Eid-ul-Adha (Bakrid)', 'The festival of sacrifice, generosity and togetherness.', 4),
  ('ganesh-chaturthi', 'Ganesh Chaturthi',     'Welcoming Lord Ganesha, the remover of obstacles.', 5),
  ('navratri',         'Navratri / Dussehra',  'Nine nights of dance and devotion, and the victory of good over evil.', 6),
  ('christmas',        'Christmas',            'Warm wishes for the season of joy and giving.', 7)
ON CONFLICT (slug) DO NOTHING;
-- Check these against the calendar each year: moon-sighted dates (Eid) can move by a day.
INSERT INTO festival_dates (slug, day) VALUES
  ('diwali', '2026-11-08'), ('diwali', '2027-10-29'),
  ('holi', '2026-03-04'), ('holi', '2027-03-22'),
  ('eid-ul-fitr', '2026-03-21'), ('eid-ul-fitr', '2027-03-10'),
  ('eid-ul-adha', '2026-05-27'), ('eid-ul-adha', '2027-05-17'),
  ('ganesh-chaturthi', '2026-09-14'), ('ganesh-chaturthi', '2027-09-04'),
  ('navratri', '2026-10-20'), ('navratri', '2027-10-09'),
  ('christmas', '2026-12-25'), ('christmas', '2027-12-25')
ON CONFLICT DO NOTHING;

-- Gmail Intelligence Engine: project emails read from authorised work mailboxes, sorted and summarised by AI.
-- Only what the AI extracted is kept (no full email bodies). Off until GMAIL_INTEL_ENABLED=true and a service account is set.
CREATE TABLE IF NOT EXISTS gmail_mailboxes (
  id SERIAL PRIMARY KEY,
  work_email TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  history_id TEXT,              -- Gmail's cursor: where the last sync stopped
  watch_expires_at TIMESTAMPTZ, -- Gmail change notifications must be renewed before this
  last_synced_at TIMESTAMPTZ,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS gmail_messages (
  gmail_message_id TEXT PRIMARY KEY,   -- one row per message however many mailboxes hold a copy
  thread_id TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  stage TEXT NOT NULL,                 -- filtered | classified | extracted | review | failed
  relevance TEXT,                      -- relevant | partial | irrelevant
  reason TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gmail_messages_thread ON gmail_messages (thread_id);
CREATE TABLE IF NOT EXISTS gmail_extractions (
  id SERIAL PRIMARY KEY,
  gmail_message_id TEXT NOT NULL REFERENCES gmail_messages(gmail_message_id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  project_name TEXT,
  employee_name TEXT,
  subject TEXT,
  email_date TIMESTAMPTZ,
  summary TEXT,
  completed JSONB NOT NULL DEFAULT '[]',
  pending JSONB NOT NULL DEFAULT '[]',
  blockers JSONB NOT NULL DEFAULT '[]',
  decisions JSONB NOT NULL DEFAULT '[]',
  deadlines JSONB NOT NULL DEFAULT '[]',
  next_steps JSONB NOT NULL DEFAULT '[]',
  relevance TEXT NOT NULL,
  confidence NUMERIC(3,2) NOT NULL,
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gmail_extractions_project ON gmail_extractions (project_id, email_date);
CREATE TABLE IF NOT EXISTS gmail_ai_usage (
  id SERIAL PRIMARY KEY,
  day DATE NOT NULL DEFAULT current_date,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,               -- classify | extract
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10,5) NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------------------------------------------------
-- Engage and requests (2026-11-19): polls, praise, articles, app links, advance requests, attendance requests.
-- All new tables; nothing existing changes shape. Rows are never hard-deleted by the app (deleted_at), except votes.
-- ---------------------------------------------------------------------------------------------------------------------
-- A poll HR puts to everyone: one question, 2 to 6 options, an optional closing time.
CREATE TABLE IF NOT EXISTS polls (
  id SERIAL PRIMARY KEY, question TEXT NOT NULL, options JSONB NOT NULL, closes_at TIMESTAMPTZ, created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS polls_recent ON polls (created_at DESC) WHERE deleted_at IS NULL;
-- One vote per person per poll. The app only ever shows totals, never who chose what.
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id INT NOT NULL REFERENCES polls(id) ON DELETE CASCADE, email TEXT NOT NULL, option_index INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (poll_id, email));
-- Praise: a short public thank-you from one colleague to another.
CREATE TABLE IF NOT EXISTS praises (
  id SERIAL PRIMARY KEY, from_email TEXT NOT NULL, to_email TEXT NOT NULL, message TEXT NOT NULL, badge TEXT NOT NULL DEFAULT 'thanks',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS praises_recent ON praises (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS praises_to ON praises (lower(to_email), created_at DESC) WHERE deleted_at IS NULL;
-- Articles: longer pieces HR writes for everyone (policies explained, guides, news). Drafts are HR-only.
CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', author_email TEXT NOT NULL,
  published_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS articles_live ON articles (published_at DESC) WHERE deleted_at IS NULL AND status = 'live';
-- Apps: links to the other tools the company uses, kept by HR.
CREATE TABLE IF NOT EXISTS app_links (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
-- A request for a salary advance. Recording the advance itself and its recovery stays with HR (employee_advances).
-- Money is whole paise (amount_minor) with its currency, so there is no rounding.
CREATE TABLE IF NOT EXISTS advance_requests (
  id SERIAL PRIMARY KEY, email TEXT NOT NULL, amount_minor BIGINT NOT NULL, currency TEXT NOT NULL DEFAULT 'INR', reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT, decided_at TIMESTAMPTZ, decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS advance_requests_email ON advance_requests (lower(email), created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS advance_requests_pending ON advance_requests (created_at) WHERE deleted_at IS NULL AND status = 'pending';
-- A request about one day's attendance: a missed punch, working from home, or on duty elsewhere. A record for HR to act on;
-- approving one does not change punches or hours by itself.
CREATE TABLE IF NOT EXISTS attendance_requests (
  id SERIAL PRIMARY KEY, email TEXT NOT NULL, on_date DATE NOT NULL, kind TEXT NOT NULL, note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT, decided_at TIMESTAMPTZ, decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS attendance_requests_email ON attendance_requests (lower(email), on_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS attendance_requests_pending ON attendance_requests (created_at) WHERE deleted_at IS NULL AND status = 'pending';

-- Tax declaration requests (2026-11-19): what a person tells payroll for one financial year: the regime they choose and
-- the investments and expenses they plan to claim. Payroll reads it and then enters what it accepts into its own
-- tax_declarations table (payroll/schema.sql), which is the only one the payroll calculation uses. This table changes no
-- payslip. One row per person per year; amounts are whole paise. Visible to the person and HR only.
CREATE TABLE IF NOT EXISTS tax_declaration_requests (
  id SERIAL PRIMARY KEY, email TEXT NOT NULL, financial_year INT NOT NULL, regime TEXT NOT NULL DEFAULT 'new',
  items JSONB NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'draft', submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS tax_declaration_requests_one ON tax_declaration_requests (lower(email), financial_year);
-- Proofs (2026-11-19): what HR notes about the proof for each line, as { "<line number>": { status, note, by, at } }.
-- Cleared when the person changes the lines, so a note never sits against a line it was not written for.
ALTER TABLE tax_declaration_requests ADD COLUMN IF NOT EXISTS proofs JSONB NOT NULL DEFAULT '{}';
-- Goals (2026-11-19): what a person is working towards, with a due date and how far along it is.
-- Visible to the person and HR only, until HR decides the wider performance-review rules.
CREATE TABLE IF NOT EXISTS goals (
  id SERIAL PRIMARY KEY, email TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', due_on DATE,
  progress INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS goals_email ON goals (lower(email), created_at DESC) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------------------------------------------------
-- HR tools (2026-11-19): probation decisions, helpdesk, policy sign-off, exit interviews, hiring, performance reviews.
-- All new tables, plus one new column on `articles` (added on 2026-11-19 too). Nothing older changes shape.
-- ---------------------------------------------------------------------------------------------------------------------
-- Probation: a row only once HR decides something. Until then the end date is the joining date plus six months.
CREATE TABLE IF NOT EXISTS probations (
  email TEXT PRIMARY KEY, ends_on DATE NOT NULL, status TEXT NOT NULL DEFAULT 'in-probation', note TEXT,
  decided_by TEXT, decided_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- Helpdesk: a question someone raises with HR or IT, and the replies under it.
CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY, email TEXT NOT NULL, category TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS tickets_email ON tickets (lower(email), updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tickets_open ON tickets (updated_at DESC) WHERE deleted_at IS NULL AND status <> 'closed';
CREATE TABLE IF NOT EXISTS ticket_replies (
  id SERIAL PRIMARY KEY, ticket_id INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE, author_email TEXT NOT NULL, body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ticket_replies_ticket ON ticket_replies (ticket_id, id);
-- Policy sign-off: an article can ask everyone to confirm they have read it.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS requires_ack BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS article_acks (
  article_id INT NOT NULL REFERENCES articles(id) ON DELETE CASCADE, email TEXT NOT NULL, acked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, email));
-- Exit interviews: why someone left, recorded by HR. One per person. HR only.
CREATE TABLE IF NOT EXISTS exit_interviews (
  email TEXT PRIMARY KEY, reason TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', would_rehire BOOLEAN, recorded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- Hiring: open roles and the candidates for each, moved through stages by HR. HR only.
CREATE TABLE IF NOT EXISTS job_openings (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL, dept TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS candidates (
  id SERIAL PRIMARY KEY, opening_id INT NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT 'applied', notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS candidates_opening ON candidates (opening_id, id) WHERE deleted_at IS NULL;
-- Performance reviews: HR opens one for a person and a period; the person writes a self-review; HR writes the review and a rating.
-- Visible to the person and HR only.
CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY, email TEXT NOT NULL, period TEXT NOT NULL, self_text TEXT, self_at TIMESTAMPTZ, hr_text TEXT, rating INT,
  status TEXT NOT NULL DEFAULT 'self-pending', created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one ON reviews (lower(email), period);

-- ---------------------------------------------------------------------------------------------------------------------
-- Accountant tools (2026-11-19). Two new tables and one new column; nothing older changes shape.
-- ---------------------------------------------------------------------------------------------------------------------
-- Payments to contractors and consultants, with the tax deducted at source, for the quarterly return (Form 26Q).
-- Money in paise. Only a masked PAN is kept, as for staff; has_pan says whether one was given (no PAN means 20%).
CREATE TABLE IF NOT EXISTS contractor_payments (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, pan_masked TEXT NOT NULL DEFAULT '', has_pan BOOLEAN NOT NULL DEFAULT false,
  section TEXT NOT NULL, paid_on DATE NOT NULL, amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  tds_rate NUMERIC(5,2) NOT NULL, tds_minor BIGINT NOT NULL CHECK (tds_minor >= 0), note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ, deleted_by TEXT);
CREATE INDEX IF NOT EXISTS contractor_payments_paid ON contractor_payments (paid_on DESC) WHERE deleted_at IS NULL;
-- The document a person uploads as proof for one line of their tax declaration. One file per line; the file itself is
-- on disk (UPLOAD_DIR) under `stored`. Removed when the person changes the lines.
CREATE TABLE IF NOT EXISTS tax_proof_files (
  id SERIAL PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES tax_declaration_requests(id) ON DELETE CASCADE, line_index INTEGER NOT NULL,
  name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, stored TEXT NOT NULL, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, line_index));
-- How much of a person's time a project takes, in per cent, for the cost-by-project report. Empty = share what is left equally.
ALTER TABLE employee_project_allocations ADD COLUMN IF NOT EXISTS share_percent INTEGER CHECK (share_percent BETWEEN 1 AND 100);

-- ---------------------------------------------------------------------------------------------------------------------
-- HR gaps (2026-11-19): timesheets, surveys, training, notice periods, approval stand-ins, review cycles with a manager
-- review and colleague feedback, and interviews. All new tables plus new nullable columns on `reviews`; nothing older
-- changes meaning. Design: docs/HR_GAPS_DESIGN.md.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timesheet_weeks (
  id SERIAL PRIMARY KEY, email TEXT NOT NULL, week_start DATE NOT NULL, status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','returned')),
  submitted_at TIMESTAMPTZ, decided_by TEXT, decided_at TIMESTAMPTZ, decision_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS timesheet_weeks_one ON timesheet_weeks (lower(email), week_start);
CREATE INDEX IF NOT EXISTS timesheet_weeks_waiting ON timesheet_weeks (status, week_start) WHERE status = 'submitted';
-- Minutes per project per day. project_id empty = internal work (not on a client project).
CREATE TABLE IF NOT EXISTS timesheet_entries (
  id SERIAL PRIMARY KEY, week_id INTEGER NOT NULL REFERENCES timesheet_weeks(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, work_date DATE NOT NULL, minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440));
CREATE INDEX IF NOT EXISTS timesheet_entries_week ON timesheet_entries (week_id);
CREATE INDEX IF NOT EXISTS timesheet_entries_day ON timesheet_entries (work_date);

CREATE TABLE IF NOT EXISTS surveys (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL, intro TEXT NOT NULL DEFAULT '', questions JSONB NOT NULL, anonymous BOOLEAN NOT NULL DEFAULT true,
  closes_on DATE NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS surveys_open ON surveys (closes_on DESC) WHERE deleted_at IS NULL;
-- Who has answered (one answer each). Kept apart from the answers so an anonymous answer has no name on it.
CREATE TABLE IF NOT EXISTS survey_takers (
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE, email TEXT NOT NULL, PRIMARY KEY (survey_id, email));
-- email is filled only for a named survey.
CREATE TABLE IF NOT EXISTS survey_responses (
  id SERIAL PRIMARY KEY, survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE, email TEXT, answers JSONB NOT NULL);
CREATE INDEX IF NOT EXISTS survey_responses_survey ON survey_responses (survey_id);

CREATE TABLE IF NOT EXISTS trainings (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', due_on DATE,
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS training_assignments (
  training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE, email TEXT NOT NULL, assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_on DATE, note TEXT NOT NULL DEFAULT '', PRIMARY KEY (training_id, email));
CREATE INDEX IF NOT EXISTS training_assignments_email ON training_assignments (lower(email));

-- Notice periods. HR records the resignation; the expected last day is resigned_on + notice_days.
CREATE TABLE IF NOT EXISTS resignations (
  email TEXT PRIMARY KEY, resigned_on DATE NOT NULL, notice_days INTEGER NOT NULL CHECK (notice_days BETWEEN 0 AND 365),
  agreed_last_day DATE, note TEXT NOT NULL DEFAULT '', recorded_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), withdrawn_at TIMESTAMPTZ);

-- Someone who decides leave requests for a manager while they are away. The manager can still decide too.
CREATE TABLE IF NOT EXISTS approval_stand_ins (
  id SERIAL PRIMARY KEY, for_email TEXT NOT NULL, stand_in_email TEXT NOT NULL, from_day DATE NOT NULL, to_day DATE NOT NULL CHECK (to_day >= from_day),
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), cancelled_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS approval_stand_ins_for ON approval_stand_ins (lower(for_email), to_day) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS approval_stand_ins_by ON approval_stand_ins (lower(stand_in_email), to_day) WHERE cancelled_at IS NULL;

-- Review cycles: HR opens a review for everyone (or a department) at once; the reporting manager reviews after the person.
CREATE TABLE IF NOT EXISTS review_cycles (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, dept TEXT NOT NULL DEFAULT '', self_due DATE NOT NULL, manager_due DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')), created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS cycle_id INTEGER REFERENCES review_cycles(id);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS manager_email TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS manager_text TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS manager_rating INT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS manager_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS reviews_manager ON reviews (lower(manager_email)) WHERE manager_email IS NOT NULL;
-- Calibration (2026-11-24): HR's adjusted rating with the reason, and potential for the 9-box. Only HR sees these; the final
-- rating (reviews.rating) is still set when HR finishes the review, starting from the calibrated one.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS calibrated_rating INT CHECK (calibrated_rating BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS potential INT CHECK (potential BETWEEN 1 AND 3);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS calibration_note TEXT NOT NULL DEFAULT '';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS calibrated_by TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS calibrated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS reviews_cycle ON reviews (cycle_id) WHERE cycle_id IS NOT NULL;
-- Colleague (360) feedback on a review. Seen by HR and the reviewer's manager, never by the person reviewed.
CREATE TABLE IF NOT EXISTS review_feedback (
  id SERIAL PRIMARY KEY, review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE, from_email TEXT NOT NULL, asked_by TEXT NOT NULL,
  text TEXT, submitted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (review_id, from_email));
CREATE INDEX IF NOT EXISTS review_feedback_from ON review_feedback (lower(from_email));

-- Interviews for a candidate. Interviewers each leave a recommendation and notes.
CREATE TABLE IF NOT EXISTS interviews (
  id SERIAL PRIMARY KEY, candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, at TIMESTAMPTZ NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes BETWEEN 15 AND 240), mode TEXT NOT NULL, place TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  interviewers JSONB NOT NULL DEFAULT '[]', verdicts JSONB NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), cancelled_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS interviews_candidate ON interviews (candidate_id, at);
CREATE INDEX IF NOT EXISTS interviews_at ON interviews (at) WHERE cancelled_at IS NULL;

-- ---------------------------------------------------------------------------------------------------------------------
-- Access hierarchy (2026-11-19): super admins, permissions ticked per person, and the reporting tree on emails.
-- Design: docs/ACCESS_DESIGN.md. Rules and the permission list: src/access-rules.js; decisions: src/access.js.

-- The reporting manager by email (expand step: employees.manager, the name, stays filled for older code until the contract step).
ALTER TABLE employees ADD COLUMN IF NOT EXISTS manager_email TEXT;
CREATE INDEX IF NOT EXISTS employees_manager_email ON employees (lower(manager_email));
-- Any write that changes the manager's NAME without giving the email works the email out: the one current employee with that
-- name. Two current people with the same name leave it empty, so nobody gets the wrong team; HR then picks the person.
CREATE OR REPLACE FUNCTION employees_manager_email_sync() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.manager_email IS NULL)
     OR (TG_OP = 'UPDATE' AND NEW.manager IS DISTINCT FROM OLD.manager AND NEW.manager_email IS NOT DISTINCT FROM OLD.manager_email) THEN
    IF NEW.manager IS NULL OR btrim(NEW.manager) = '' THEN
      NEW.manager_email := NULL;
    ELSE
      SELECT CASE WHEN count(*) = 1 THEN lower(min(m.work_email)) END INTO NEW.manager_email
        FROM employees m WHERE lower(m.name) = lower(btrim(NEW.manager)) AND m.status <> 'offboarded' AND lower(m.work_email) <> lower(NEW.work_email);
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS employees_manager_email_sync ON employees;
CREATE TRIGGER employees_manager_email_sync BEFORE INSERT OR UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION employees_manager_email_sync();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE key = 'manager-email-backfill') THEN
    UPDATE employees e SET manager_email = (
      SELECT CASE WHEN count(*) = 1 THEN lower(min(m.work_email)) END FROM employees m
       WHERE lower(m.name) = lower(btrim(e.manager)) AND m.status <> 'offboarded' AND lower(m.work_email) <> lower(e.work_email))
     WHERE e.manager IS NOT NULL AND btrim(e.manager) <> '' AND e.manager_email IS NULL;
    INSERT INTO app_migrations (key) VALUES ('manager-email-backfill');
  END IF;
END $$;

-- Super admins have every permission and are the only people who give access. There is always at least one (src/access.js).
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;
-- A blocked login cannot sign in, even with Google, and its sessions stop working. Set when a login is deleted or someone leaves.
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_blocked BOOLEAN NOT NULL DEFAULT false;
-- Pages HR has hidden for one person (any of: articles, polls, surveys). Set on Users; the server refuses those pages for them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS hidden_features TEXT[] NOT NULL DEFAULT '{}';
-- Rewards: HR gives a person a reward with a short note. They are told, and see it on Praise > Rewards.
CREATE TABLE IF NOT EXISTS rewards (
  id SERIAL PRIMARY KEY, to_email TEXT NOT NULL, from_email TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS rewards_to ON rewards (lower(to_email), created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS rewards_recent ON rewards (created_at DESC) WHERE deleted_at IS NULL;

-- One ticked permission for one person: for the whole company, or for a reporting tree (everyone below scope_root_email, or below
-- the person themselves when it is empty). Removing it keeps the row, so the history of who gave and removed what stays.
CREATE TABLE IF NOT EXISTS access_grants (
  id               SERIAL PRIMARY KEY,
  email            TEXT NOT NULL,
  permission       TEXT NOT NULL CHECK (char_length(permission) <= 60),
  scope            TEXT NOT NULL CHECK (scope IN ('company','tree')),
  scope_root_email TEXT,
  note             TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 300),
  granted_by       TEXT NOT NULL,
  granted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       DATE,
  revoked_at       TIMESTAMPTZ,
  revoked_by       TEXT,
  CHECK (scope = 'tree' OR scope_root_email IS NULL));
CREATE INDEX IF NOT EXISTS access_grants_email ON access_grants (lower(email)) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS access_grants_once ON access_grants (lower(email), permission, scope, coalesce(lower(scope_root_email), ''))
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------------------------------------------------
-- Speed (2026-11-19): indexes for read paths that had none. All additive and safe to run again.
CREATE INDEX IF NOT EXISTS audit_log_recent ON audit_log (ts DESC, id DESC);                          -- the audit log, newest first
CREATE INDEX IF NOT EXISTS audit_log_person ON audit_log (lower(work_email), ts DESC);                -- one person's history
CREATE INDEX IF NOT EXISTS employee_project_allocations_employee ON employee_project_allocations (employee_id);   -- roster projects
CREATE INDEX IF NOT EXISTS employee_project_allocations_project ON employee_project_allocations (project_id);
CREATE INDEX IF NOT EXISTS profile_photos_email_lower ON profile_photos (lower(email));               -- photo versions on the roster
CREATE INDEX IF NOT EXISTS tool_access_email_lower ON tool_access (lower(work_email));                -- your own tool access
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);                                 -- clearing ended sign-ins
CREATE INDEX IF NOT EXISTS leave_requests_recent ON leave_requests (from_date DESC, id DESC);          -- everyone's leave, newest first
CREATE INDEX IF NOT EXISTS leave_requests_pending ON leave_requests (status) WHERE status = 'pending'; -- waiting for a decision

-- ---------------------------------------------------------------------------------------------------------------------
-- Tools and their cost (2026-11-19): every paid tool (AI assistants and others), who has a seat, and what it costs.
-- Claude keeps its live connection (anthropic.js); the others are tracked by hand. Design: docs/TOOLS_DESIGN.md.
-- Rules: src/tools-rules.js; API: src/tools.js (tools.manage manages, finance.view also sees cost).
CREATE TABLE IF NOT EXISTS tools (
  slug            TEXT PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  vendor          TEXT NOT NULL DEFAULT '' CHECK (char_length(vendor) <= 60),
  category        TEXT NOT NULL DEFAULT 'ai' CHECK (category IN ('ai','coding','design','productivity','other')),
  billing         TEXT NOT NULL DEFAULT 'seat' CHECK (billing IN ('seat','usage','seat_and_usage','free')),
  seat_cost_minor INTEGER CHECK (seat_cost_minor IS NULL OR seat_cost_minor >= 0),   -- per seat per month, in paise or cents; null = not set yet
  currency        TEXT NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD')),
  connected       BOOLEAN NOT NULL DEFAULT false,   -- true: seats are added and removed through the tool itself (Claude)
  url             TEXT NOT NULL DEFAULT '' CHECK (char_length(url) <= 300),
  notes           TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort            INTEGER NOT NULL DEFAULT 100,
  created_by      TEXT NOT NULL DEFAULT 'system',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now());
INSERT INTO tools (slug, name, vendor, category, billing, currency, connected, url, sort) VALUES
  ('claude',     'Claude',         'Anthropic', 'ai',     'seat',  'USD', true,  'https://claude.ai',       1),
  ('chatgpt',    'ChatGPT',        'OpenAI',    'ai',     'seat',  'USD', false, 'https://chatgpt.com',     2),
  ('gemini',     'Gemini',         'Google',    'ai',     'seat',  'USD', false, 'https://gemini.google.com', 3),
  ('copilot',    'GitHub Copilot', 'GitHub',    'coding', 'seat',  'USD', false, 'https://github.com/features/copilot', 4),
  ('cursor',     'Cursor',         'Anysphere', 'coding', 'seat',  'USD', false, 'https://cursor.com',      5),
  ('perplexity', 'Perplexity',     'Perplexity','ai',     'seat',  'USD', false, 'https://www.perplexity.ai', 6),
  ('notion-ai',  'Notion AI',      'Notion',    'productivity', 'seat', 'USD', false, 'https://www.notion.so', 7)
ON CONFLICT (slug) DO NOTHING;

-- A seat: who has which tool (tool_access already holds Claude). A person's own price overrides the tool's (null = the tool's).
ALTER TABLE tool_access ADD COLUMN IF NOT EXISTS seat_cost_minor INTEGER;
ALTER TABLE tool_access ADD COLUMN IF NOT EXISTS since DATE;
ALTER TABLE tool_access ADD COLUMN IF NOT EXISTS updated_by TEXT;
CREATE INDEX IF NOT EXISTS tool_access_tool ON tool_access (tool, status);

-- What a tool actually cost in a month (usage-based tools, or the vendor's invoice). Removing one keeps the row.
CREATE TABLE IF NOT EXISTS tool_bills (
  id           SERIAL PRIMARY KEY,
  tool         TEXT NOT NULL REFERENCES tools(slug) ON UPDATE CASCADE,
  month        TEXT NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency     TEXT NOT NULL CHECK (currency IN ('INR','USD')),
  note         TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 300),
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS tool_bills_month ON tool_bills (month, tool) WHERE deleted_at IS NULL;

-- The Pay lock (fingerprint, authenticator app, PIN) was removed on 2026-11-23: its tables and columns are dropped.
DROP TABLE IF EXISTS pay_pins, pay_pin_otps, pay_totp, pay_passkeys, pay_challenges;
ALTER TABLE sessions DROP COLUMN IF EXISTS pay_unlocked_until, DROP COLUMN IF EXISTS pay_unlocked_at, DROP COLUMN IF EXISTS pay_recover_until;

-- Tax regime policy (engage.js): the regime a declaration starts on for a financial year (New or Old) and the policy document behind it.
-- A year without a row uses the latest earlier one; no rows at all means the New regime.
CREATE TABLE IF NOT EXISTS tax_regime_policies (
  financial_year INTEGER PRIMARY KEY,                 -- the year it starts, like 2026 for 2026-27
  default_regime TEXT NOT NULL CHECK (default_regime IN ('new','old')),
  doc_name       TEXT, doc_mime TEXT, doc_size INTEGER,
  doc_stored     TEXT,                                -- the file in UPLOAD_DIR
  updated_by     TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Declaration and proof windows (2026-11-24): payroll's due dates for the year's declarations and proofs (Keka's cut-off dates).
-- Only the row for the year itself counts; a row carried over from an earlier year has its dates left empty.
ALTER TABLE tax_regime_policies ADD COLUMN IF NOT EXISTS declaration_due DATE;
ALTER TABLE tax_regime_policies ADD COLUMN IF NOT EXISTS proof_due DATE;
-- New joiners may declare for this many days after joining, even after the declaration date (Keka's period for new employees).
ALTER TABLE tax_regime_policies ADD COLUMN IF NOT EXISTS joiner_days INTEGER CHECK (joiner_days BETWEEN 0 AND 180);
-- Reminders sent before a due date (tax-reminders.js): one row per reminder, so each goes out once.
CREATE TABLE IF NOT EXISTS tax_reminders_sent (
  financial_year INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('declaration','proof')), due DATE NOT NULL, days_before INTEGER NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (financial_year, kind, due, days_before));
-- Payroll reopens the declaration or the proofs for one person after the due date (a new joiner, a proof sent back), until a date.
CREATE TABLE IF NOT EXISTS tax_declaration_unlocks (
  id SERIAL PRIMARY KEY, email TEXT NOT NULL, financial_year INT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('declaration','proof')),
  until DATE NOT NULL, granted_by TEXT NOT NULL, granted_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS tax_declaration_unlocks_one ON tax_declaration_unlocks (lower(email), financial_year, kind);
CREATE INDEX IF NOT EXISTS tax_declaration_unlocks_year ON tax_declaration_unlocks (financial_year, until);
-- A person's request to change their declaration or proofs after the due date, with a reason (as Keka takes a late
-- declaration for approval). Payroll approves it until a date (which writes a tax_declaration_unlocks row) or declines it.
CREATE TABLE IF NOT EXISTS tax_late_requests (
  id SERIAL PRIMARY KEY, email TEXT NOT NULL, financial_year INT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('declaration','proof')),
  reason TEXT NOT NULL CHECK (length(reason) <= 500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  until DATE, note TEXT, decided_by TEXT, decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS tax_late_requests_one_pending ON tax_late_requests (lower(email), financial_year, kind) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS tax_late_requests_year ON tax_late_requests (financial_year, status, created_at DESC);
CREATE INDEX IF NOT EXISTS tax_late_requests_person ON tax_late_requests (lower(email), financial_year);
-- Submitted declarations of a year, read by payroll for every person at once when it builds a month.
CREATE INDEX IF NOT EXISTS tax_declaration_requests_year ON tax_declaration_requests (financial_year) WHERE status = 'submitted';

-- Shifts (2026-11-24, shifts.js and shift-rules.js): the hours people work, the grace for arriving late, the weekly days off, and
-- the minutes that make a full day, a half day and overtime. One shift is the default for anyone not on the roster.
CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  start_time TIME NOT NULL, end_time TIME NOT NULL CHECK (end_time > start_time),
  grace_minutes INTEGER NOT NULL DEFAULT 15 CHECK (grace_minutes BETWEEN 0 AND 120),
  weekly_offs INTEGER[] NOT NULL DEFAULT '{0,6}',          -- 0 Sunday … 6 Saturday
  present_minutes INTEGER NOT NULL DEFAULT 360 CHECK (present_minutes BETWEEN 30 AND 1440),
  half_day_minutes INTEGER NOT NULL DEFAULT 180 CHECK (half_day_minutes >= 0),
  overtime_after_minutes INTEGER NOT NULL DEFAULT 30 CHECK (overtime_after_minutes BETWEEN 0 AND 600),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ);
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_default ON shifts (is_default) WHERE is_default AND archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shifts_name ON shifts (lower(name)) WHERE archived_at IS NULL;
-- The office shift before shifts existed becomes the default, once.
INSERT INTO shifts (name, start_time, end_time, grace_minutes, weekly_offs, is_default, created_by)
  SELECT 'General shift', '09:30', '18:30', 15, '{0,6}', true, 'system' WHERE NOT EXISTS (SELECT 1 FROM shifts);
-- The roster: who is on which shift from a date, until a date or open. With no entry a person is on the default shift.
CREATE TABLE IF NOT EXISTS shift_assignments (
  id SERIAL PRIMARY KEY, email TEXT NOT NULL, shift_id INTEGER NOT NULL REFERENCES shifts(id),
  from_date DATE NOT NULL, to_date DATE CHECK (to_date IS NULL OR to_date >= from_date),
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS shift_assignments_person ON shift_assignments (lower(email), from_date DESC);
CREATE INDEX IF NOT EXISTS shift_assignments_dates ON shift_assignments (from_date, to_date);
-- Staff whose overtime is approved each month (the company pays overtime only to people HR marks). Payroll never pays it by itself.
CREATE TABLE IF NOT EXISTS overtime_staff (
  email TEXT PRIMARY KEY, added_by TEXT NOT NULL, added_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS overtime_staff_email ON overtime_staff (lower(email));
-- A month's overtime for one person: the hours worked out from attendance when it was decided, and the hours approved.
CREATE TABLE IF NOT EXISTS overtime_approvals (
  id SERIAL PRIMARY KEY, email TEXT NOT NULL, month TEXT NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  computed_minutes INTEGER NOT NULL CHECK (computed_minutes >= 0), approved_minutes INTEGER NOT NULL DEFAULT 0 CHECK (approved_minutes >= 0),
  status TEXT NOT NULL CHECK (status IN ('approved','rejected')), note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 300),
  decided_by TEXT NOT NULL, decided_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS overtime_approvals_one ON overtime_approvals (lower(email), month);
CREATE INDEX IF NOT EXISTS overtime_approvals_month ON overtime_approvals (month, status);
-- The two new permissions, given once to whoever could already correct attendance, for the same scope: managing shifts (company-wide
-- holders only) and approving overtime. A later revoke sticks: any earlier row of the permission, revoked or not, stops the copy.
INSERT INTO access_grants (email, permission, scope, scope_root_email, note, granted_by)
  SELECT g.email, 'shifts.manage', 'company', NULL, 'Given with Correct attendance when shifts were added', 'system'
    FROM access_grants g WHERE g.permission = 'attendance.edit' AND g.scope = 'company' AND g.revoked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM access_grants x WHERE lower(x.email) = lower(g.email) AND x.permission = 'shifts.manage');
INSERT INTO access_grants (email, permission, scope, scope_root_email, note, granted_by)
  SELECT g.email, 'overtime.approve', g.scope, g.scope_root_email, 'Given with Correct attendance when overtime was added', 'system'
    FROM access_grants g WHERE g.permission = 'attendance.edit' AND g.revoked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM access_grants x WHERE lower(x.email) = lower(g.email) AND x.permission = 'overtime.approve');

-- OKRs (2026-11-24, performance.js): company and team objectives for a quarter, their key results, and personal goals linked to them.
CREATE TABLE IF NOT EXISTS okr_objectives (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200), detail TEXT NOT NULL DEFAULT '' CHECK (char_length(detail) <= 1000),
  level TEXT NOT NULL CHECK (level IN ('company','team')), quarter TEXT NOT NULL CHECK (quarter ~ '^\d{4}-Q[1-4]$'),
  owner_email TEXT NOT NULL, parent_id INTEGER REFERENCES okr_objectives(id),
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), archived_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS okr_objectives_quarter ON okr_objectives (quarter, level) WHERE archived_at IS NULL;
CREATE TABLE IF NOT EXISTS okr_key_results (
  id SERIAL PRIMARY KEY, objective_id INTEGER NOT NULL REFERENCES okr_objectives(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200), unit TEXT NOT NULL DEFAULT '' CHECK (char_length(unit) <= 20),
  start_value NUMERIC(14,2) NOT NULL DEFAULT 0, target_value NUMERIC(14,2) NOT NULL, current_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS okr_key_results_objective ON okr_key_results (objective_id);
ALTER TABLE goals ADD COLUMN IF NOT EXISTS objective_id INTEGER REFERENCES okr_objectives(id);
CREATE INDEX IF NOT EXISTS goals_objective ON goals (objective_id) WHERE deleted_at IS NULL AND objective_id IS NOT NULL;
-- 1:1 meetings: a manager and a direct report, with shared talking points, actions and notes; private notes are each person's own.
CREATE TABLE IF NOT EXISTS one_on_ones (
  id SERIAL PRIMARY KEY, manager_email TEXT NOT NULL, report_email TEXT NOT NULL, meets_on DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','done','cancelled')),
  shared_notes TEXT NOT NULL DEFAULT '' CHECK (char_length(shared_notes) <= 5000),
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS one_on_ones_manager ON one_on_ones (lower(manager_email), meets_on DESC);
CREATE INDEX IF NOT EXISTS one_on_ones_report ON one_on_ones (lower(report_email), meets_on DESC);
CREATE TABLE IF NOT EXISTS one_on_one_items (
  id SERIAL PRIMARY KEY, meeting_id INTEGER NOT NULL REFERENCES one_on_ones(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('talking_point','action')), body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  owner_email TEXT, done BOOLEAN NOT NULL DEFAULT false, added_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS one_on_one_items_meeting ON one_on_one_items (meeting_id, id);
CREATE TABLE IF NOT EXISTS one_on_one_private (
  meeting_id INTEGER NOT NULL REFERENCES one_on_ones(id) ON DELETE CASCADE, email TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 5000), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (meeting_id, email));

-- Careers page and referrals (2026-11-24, careers.js): a role HR publishes shows on the public careers page; anyone may apply with a CV,
-- and staff may refer someone. The candidate records where they came from.
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '';
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'Full time';
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS experience TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS job_openings_public ON job_openings (created_at DESC) WHERE is_public AND status = 'open' AND deleted_at IS NULL;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'hr' CHECK (source IN ('hr','careers','referral'));
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS referred_by TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS cover_note TEXT NOT NULL DEFAULT '';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS profile_link TEXT NOT NULL DEFAULT '';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS resume_name TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS resume_mime TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS resume_size INTEGER;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS resume_stored TEXT;
-- A short-lived key to send the CV right after applying (the form sends the details, then the file).
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS upload_key TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS upload_until TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS candidates_referred_by ON candidates (lower(referred_by)) WHERE referred_by IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS candidates_upload_key ON candidates (upload_key) WHERE upload_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS candidates_opening_email ON candidates (opening_id, lower(email)) WHERE deleted_at IS NULL;

-- Offer letters and signing them (2026-11-24, offers.js): HR prepares an offer for a candidate, someone else approves it, and the
-- candidate signs it through a private link by typing their name. The words are fixed when it is sent; the fingerprint shows any change.
CREATE TABLE IF NOT EXISTS offer_letters (
  id SERIAL PRIMARY KEY, candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120), ctc_annual NUMERIC(14,2) NOT NULL CHECK (ctc_annual > 0),
  joining_date DATE NOT NULL, location TEXT NOT NULL DEFAULT '', terms TEXT NOT NULL DEFAULT '' CHECK (char_length(terms) <= 4000),
  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','sent','signed','declined','withdrawn','returned')),
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by TEXT, decided_at TIMESTAMPTZ, decision_note TEXT,
  letter_text TEXT, letter_sha256 TEXT, sign_key_hash TEXT, sent_by TEXT, sent_at TIMESTAMPTZ, sign_until TIMESTAMPTZ,
  signed_name TEXT, signed_at TIMESTAMPTZ, signed_ip TEXT, signed_agent TEXT, declined_reason TEXT);
CREATE INDEX IF NOT EXISTS offer_letters_candidate ON offer_letters (candidate_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS offer_letters_sign_key ON offer_letters (sign_key_hash) WHERE sign_key_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS offer_letters_pending ON offer_letters (created_at) WHERE status = 'pending_approval';
-- Approving offers is its own permission, given once to whoever runs hiring (a later revoke sticks). Nobody approves their own offer.
INSERT INTO access_grants (email, permission, scope, scope_root_email, note, granted_by)
  SELECT g.email, 'offers.approve', 'company', NULL, 'Given with Run hiring when offer letters were added', 'system'
    FROM access_grants g WHERE g.permission = 'hiring.manage' AND g.scope = 'company' AND g.revoked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM access_grants x WHERE lower(x.email) = lower(g.email) AND x.permission = 'offers.approve');

-- ---------------------------------------------------------------------------------------------------------------------
-- Web clock-in with location and a selfie (2026-11-24), as Keka's geo-fencing. HR switches it on and lists the offices on
-- Shifts > Clock-in. New tables and new nullable columns on attendance_punches; nothing older changes meaning.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clock_in_policy (
  id INT PRIMARY KEY CHECK (id = 1), enabled BOOLEAN NOT NULL DEFAULT false, need_location BOOLEAN NOT NULL DEFAULT false,
  need_selfie BOOLEAN NOT NULL DEFAULT false, allow_outside BOOLEAN NOT NULL DEFAULT false, updated_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- An office: a point and a radius in metres. A punch inside it is matched to it.
CREATE TABLE IF NOT EXISTS clock_in_sites (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, lat NUMERIC(9,6) NOT NULL CHECK (lat BETWEEN -90 AND 90), lng NUMERIC(9,6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  radius_m INT NOT NULL CHECK (radius_m BETWEEN 30 AND 5000), created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
-- A selfie taken to punch. The file is on disk (UPLOAD_DIR); kept 90 days, then deleted with its row (jobs.js).
CREATE TABLE IF NOT EXISTS attendance_selfies (
  id SERIAL PRIMARY KEY, email TEXT NOT NULL, stored TEXT NOT NULL, mime TEXT NOT NULL, size INT NOT NULL, upload_key TEXT,
  punch_id INT REFERENCES attendance_punches(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS attendance_selfies_key ON attendance_selfies (upload_key) WHERE upload_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_selfies_created ON attendance_selfies (created_at);
-- Where a web punch was made: the phone's reading, the nearest office's name then, how far, and whether it was outside every office.
ALTER TABLE attendance_punches ADD COLUMN IF NOT EXISTS lat NUMERIC(9,6);
ALTER TABLE attendance_punches ADD COLUMN IF NOT EXISTS lng NUMERIC(9,6);
ALTER TABLE attendance_punches ADD COLUMN IF NOT EXISTS accuracy_m INT;
ALTER TABLE attendance_punches ADD COLUMN IF NOT EXISTS site_name TEXT;
ALTER TABLE attendance_punches ADD COLUMN IF NOT EXISTS distance_m INT;
ALTER TABLE attendance_punches ADD COLUMN IF NOT EXISTS outside BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE attendance_punches ADD COLUMN IF NOT EXISTS selfie_id INT REFERENCES attendance_selfies(id) ON DELETE SET NULL;

-- Saved custom reports (2026-11-24): a person's own named report definitions (Manage > Report builder). Running one checks
-- access again each time; the columns and filters are keys from report-builder-rules.js, never SQL.
CREATE TABLE IF NOT EXISTS saved_reports (
  id SERIAL PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, dataset TEXT NOT NULL, columns JSONB NOT NULL DEFAULT '[]', filters JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS saved_reports_owner ON saved_reports (lower(owner)) WHERE deleted_at IS NULL;

-- Slack and Microsoft Teams channels (2026-11-24): incoming webhooks HR adds on Manage > Slack and Teams, and the company news
-- each one gets (chat-rules.js EVENTS). The webhook link is a secret: stored encrypted (PAYROLL_ENCRYPTION_KEY), with a hint.
CREATE TABLE IF NOT EXISTS chat_channels (
  id SERIAL PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('slack','teams')), name TEXT NOT NULL, url_sealed TEXT NOT NULL, url_hint TEXT NOT NULL DEFAULT '',
  events JSONB NOT NULL DEFAULT '[]', enabled BOOLEAN NOT NULL DEFAULT true, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
-- Every message tried: sent, skipped (a local server) or failed, with the reason.
CREATE TABLE IF NOT EXISTS chat_outbox (
  id SERIAL PRIMARY KEY, channel_id INT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE, event TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','skipped','failed')), error TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS chat_outbox_recent ON chat_outbox (id DESC);
