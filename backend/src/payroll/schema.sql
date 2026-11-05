-- Payroll processing and salary disbursement. Runs on the payroll database only (PAYROLL_DATABASE_URL when it is separate),
-- after ../schema.sql, so the tables it extends (salary_structures, payroll_runs, payroll_items) already exist.
-- The database is the source of truth: generated Excel and bank files are stored copies of what is here.

-- Salary structure: what the payroll engine needs beyond the earnings lines. A revision is a new row from a later month,
-- so the structure used for a month that is finalized is never lost.
ALTER TABLE salary_structures ADD COLUMN IF NOT EXISTS annual_ctc     NUMERIC(14,2);
ALTER TABLE salary_structures ADD COLUMN IF NOT EXISTS pf_applicable  BOOLEAN;
ALTER TABLE salary_structures ADD COLUMN IF NOT EXISTS employer_pf    NUMERIC(12,2);
ALTER TABLE salary_structures ADD COLUMN IF NOT EXISTS esic_employee  NUMERIC(12,2);
ALTER TABLE salary_structures ADD COLUMN IF NOT EXISTS pt_applicable  BOOLEAN;
ALTER TABLE salary_structures ADD COLUMN IF NOT EXISTS pt_february    NUMERIC(12,2);
ALTER TABLE salary_structures ADD COLUMN IF NOT EXISTS tds_applicable BOOLEAN;
ALTER TABLE salary_structures ADD COLUMN IF NOT EXISTS tds_mode       TEXT;
ALTER TABLE salary_structures ADD COLUMN IF NOT EXISTS reason         TEXT;
ALTER TABLE salary_structures DROP CONSTRAINT IF EXISTS salary_structures_tds_mode_check;
ALTER TABLE salary_structures ADD CONSTRAINT salary_structures_tds_mode_check CHECK (tds_mode IS NULL OR tds_mode IN ('auto','manual'));
-- The tax regime is chosen per financial year, so it is on tax_declarations (no declaration = the new regime, the default).

-- Salary bank account. Onboarding keeps only a masked number, so payroll keeps its own copy: the full number encrypted
-- (AES-256-GCM, key PAYROLL_ENCRYPTION_KEY), only the last four digits readable.
CREATE TABLE IF NOT EXISTS payroll_bank_accounts (
  work_email   TEXT PRIMARY KEY,
  holder_name  TEXT NOT NULL,
  bank_name    TEXT NOT NULL,
  ifsc         TEXT NOT NULL CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  acct_enc     TEXT NOT NULL,
  acct_last4   TEXT NOT NULL,
  updated_by   TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_bank_accounts_email ON payroll_bank_accounts (lower(work_email));

-- Income-tax rules, one row per financial year and regime (slabs, rebate, surcharge, cess, deduction caps). See tax.js.
CREATE TABLE IF NOT EXISTS tax_rules (
  fy         TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  regime     TEXT NOT NULL CHECK (regime IN ('new','old')),
  rules      JSONB NOT NULL,
  source     TEXT,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (fy, regime)
);

-- What each employee declared for the year (investments, HRA exemption, previous employer's salary and TDS).
CREATE TABLE IF NOT EXISTS tax_declarations (
  fy          TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  work_email  TEXT NOT NULL,
  regime      TEXT NOT NULL CHECK (regime IN ('new','old')),
  declaration JSONB NOT NULL DEFAULT '{}',
  updated_by  TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tax_declarations_once ON tax_declarations (fy, lower(work_email));

-- Runs: the review workflow. 'processed' (and 'paid' on it) are runs made before the workflow existed.
--   draft → calculated → generated → pending_review → approved → bank_ready → paid ("Processed")
--   pending_review → rejected | changes_requested → (HR edits) → draft
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_status_check;
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_status_check CHECK (status IN
  ('draft','calculated','generated','pending_review','changes_requested','rejected','approved','bank_ready','paid','processed'));
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS workflow       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS status_at      TIMESTAMPTZ;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS submitted_by   TEXT;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS submitted_at   TIMESTAMPTZ;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS reviewed_by    TEXT;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS reviewed_at    TIMESTAMPTZ;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS review_note    TEXT;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS bank_reference TEXT;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS totals         JSONB;

-- Lines: HR's monthly inputs are kept with the line, and the line is recalculated from them.
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS inputs        JSONB NOT NULL DEFAULT '{}';
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS structure_id  INTEGER;
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ;
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS updated_by    TEXT;

-- Corrections to a finalized month: never edit it, add an arrear (earning) or recovery (deduction) paid in a later run.
CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id             SERIAL PRIMARY KEY,
  work_email     TEXT NOT NULL,
  source_period  TEXT NOT NULL CHECK (source_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  kind           TEXT NOT NULL CHECK (kind IN ('earning','deduction')),
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason         TEXT NOT NULL,
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_run_id INTEGER REFERENCES payroll_runs(id),
  cancelled_at   TIMESTAMPTZ,
  cancelled_by   TEXT
);
CREATE INDEX IF NOT EXISTS payroll_adjustments_email ON payroll_adjustments (lower(work_email));

-- Generated files, stored with their run. Bank files are encrypted (they hold full account numbers).
CREATE TABLE IF NOT EXISTS payroll_files (
  id           SERIAL PRIMARY KEY,
  run_id       INTEGER NOT NULL REFERENCES payroll_runs(id),
  kind         TEXT NOT NULL CHECK (kind IN ('workbook','bank')),
  version      INTEGER NOT NULL,
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  encrypted    BOOLEAN NOT NULL DEFAULT false,
  content      BYTEA NOT NULL,
  totals       JSONB NOT NULL,
  generated_by TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded   BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (run_id, kind, version)
);

-- Who did what: salary and bank changes, calculations, overrides, the review, generated files and downloads.
-- Append only: the trigger below refuses changes and deletions.
CREATE TABLE IF NOT EXISTS payroll_audit (
  id         BIGSERIAL PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  run_id     INTEGER,
  period     TEXT,
  work_email TEXT,
  detail     JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS payroll_audit_run ON payroll_audit (run_id);
CREATE INDEX IF NOT EXISTS payroll_audit_email ON payroll_audit (lower(work_email));

CREATE OR REPLACE FUNCTION payroll_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payroll_audit is append-only';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS payroll_audit_append_only ON payroll_audit;
CREATE TRIGGER payroll_audit_append_only BEFORE UPDATE OR DELETE ON payroll_audit FOR EACH ROW EXECUTE FUNCTION payroll_audit_append_only();

-- A line in an approved run never changes, whatever code path asks. Corrections go through payroll_adjustments.
CREATE OR REPLACE FUNCTION payroll_items_frozen() RETURNS trigger AS $$
DECLARE st TEXT; wf BOOLEAN;
BEGIN
  SELECT status, workflow INTO st, wf FROM payroll_runs WHERE id = COALESCE(OLD.run_id, NEW.run_id);
  IF wf AND st IN ('approved','bank_ready','paid') THEN
    RAISE EXCEPTION 'payroll for this month is approved and can no longer change';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS payroll_items_frozen ON payroll_items;
CREATE TRIGGER payroll_items_frozen BEFORE INSERT OR UPDATE OR DELETE ON payroll_items FOR EACH ROW EXECUTE FUNCTION payroll_items_frozen();
