import { pool } from "./db.js";

const SQL = `
CREATE TABLE IF NOT EXISTS hr_users (
  email TEXT PRIMARY KEY,
  role  TEXT NOT NULL CHECK (role IN ('admin','viewer','it'))
);

CREATE TABLE IF NOT EXISTS applications (
  code      TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  phase     INT  NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id              SERIAL PRIMARY KEY,
  emp_no          TEXT,
  full_name       TEXT NOT NULL,
  work_email      TEXT NOT NULL UNIQUE,
  job_title       TEXT,
  department      TEXT NOT NULL,
  start_date      DATE NOT NULL,
  last_working_day DATE,
  status          TEXT NOT NULL CHECK (status IN ('onboarding','active','offboarding','offboarded')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_grants (
  employee_id INT  NOT NULL REFERENCES employees(id),
  app_code    TEXT NOT NULL REFERENCES applications(code),
  status      TEXT NOT NULL CHECK (status IN ('none','provisioning','active','failed','revoking','revoked')),
  external_id TEXT,
  error       TEXT,
  attempts    INT  NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, app_code)
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id          SERIAL PRIMARY KEY,
  employee_id INT  NOT NULL REFERENCES employees(id),
  phase       TEXT NOT NULL CHECK (phase IN ('onboarding','offboarding')),
  title       TEXT NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT false,
  done_by     TEXT,
  done_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  employee_id INT,
  app_code    TEXT,
  result      TEXT NOT NULL CHECK (result IN ('ok','fail','info')),
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash   TEXT NOT NULL,
  hash        TEXT NOT NULL
);

-- The audit log is append-only: any UPDATE or DELETE is refused by the database itself.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES ('automation_paused', 'false') ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS accounts (
  email        TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  failed_count INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

INSERT INTO applications (code, name, phase) VALUES
  ('gws',    'Google Workspace', 1),
  ('gemini', 'Gemini',           1),
  ('claude', 'Claude',           1),
  ('github', 'GitHub',           2),
  ('gcp',    'Google Cloud',     2)
ON CONFLICT (code) DO NOTHING;
`;

await pool.query(SQL);
console.log("schema ready");
await pool.end();
