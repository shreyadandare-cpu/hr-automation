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

-- Leave management. Rules (quotas, carry-over, salary cut) live in frontend/leave-rules.cjs.
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
