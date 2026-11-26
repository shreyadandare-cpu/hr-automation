import fs from "node:fs";
import pg from "pg";
import { openSealedResult } from "./secret-box.js";

// Keep DATE columns as plain YYYY-MM-DD strings so time zones cannot shift them by a day.
pg.types.setTypeParser(1082, (v) => v);

// Salary figures are stored sealed (secret-box.js). Every query result of this app's own connections is opened here, on its way
// out of the database, so a row read anywhere in the app has its salary fields back under their own names. Covers pool.query,
// client.query and both the promise and the callback forms (pg-pool calls the client with a callback). Only the pools below use
// it: another connection in the same process (a script, a test) reads the database as it is.
class SealedClient extends pg.Client {
  query(...args) {
    const cb = typeof args[args.length - 1] === "function" ? args.pop() : null;
    if (cb) {
      return super.query(...args, (err, res) => {
        if (err) return cb(err);
        let opened;
        try { opened = openSealedResult(res); } catch (e) { return cb(e); }
        cb(null, opened);
      });
    }
    const out = super.query(...args);
    return out && typeof out.then === "function" ? out.then(openSealedResult) : out;
  }
}

// DB_SCHEMA keeps this app's tables in their own schema when the database is shared with another app (for example the
// Employee Portal's tables in "public"). Every connection looks only in that schema, so the other app's tables of the same
// name (employees, users, ...) are never read or changed by mistake. Empty = the database's default schema.
export const SCHEMA = (process.env.DB_SCHEMA || "").trim();
if (SCHEMA && !/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error("DB_SCHEMA must be lowercase letters, digits and underscores");
// Connections stay open and warm: opening one costs tens of milliseconds locally and more through the Cloud SQL proxy, so a pool
// that closed them after 10 idle seconds (the default) made the first requests after a pause slow. A bounded pool (DB_POOL_MAX,
// default 15) with a statement timeout, so one slow query can never hold a connection for long.
const POOL = () => ({
  Client: SealedClient,
  max: Number(process.env.DB_POOL_MAX) || 15,
  idleTimeoutMillis: 10 * 60_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS) || 20_000,
});
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ...POOL(), ...(SCHEMA ? { options: `-c search_path=${SCHEMA}` } : {}) });

// Payroll and payslips can run on their own database (PAYROLL_DATABASE_URL, schema PAYROLL_DB_SCHEMA), for example a local
// copy with dummy salaries while everything else uses the shared one. Empty = the same database as everything else.
export const PAY_SCHEMA = (process.env.PAYROLL_DB_SCHEMA || "").trim();
if (PAY_SCHEMA && !/^[a-z_][a-z0-9_]*$/.test(PAY_SCHEMA)) throw new Error("PAYROLL_DB_SCHEMA must be lowercase letters, digits and underscores");
export const payPool = process.env.PAYROLL_DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.PAYROLL_DATABASE_URL, ...POOL(), ...(PAY_SCHEMA ? { options: `-c search_path=${PAY_SCHEMA}` } : {}) })
  : pool;
// With its own database, payroll's notices and email links (which live in the main database) are skipped, so dummy
// payslips never reach real people.
export const PAYROLL_SEPARATE = payPool !== pool;
// A dropped idle connection (the Cloud SQL proxy restarting, a network blip) is reported on the pool. Without a listener
// Node treats it as unhandled and stops the server; the pool replaces the connection on the next query anyway.
for (const p of new Set([pool, payPool])) p.on("error", (err) => console.error("Database connection dropped:", err.message));

const here = new URL(".", import.meta.url);

/** Creates what is missing in the database (the main one, or the payroll one when it is separate). */
export async function initDb(db = pool, schema = SCHEMA) {
  const pool = db;
  if (schema) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  // No time limit for the schema step: building an index on a large table at start-up may take longer than a request should.
  await pool.query(`SET statement_timeout = 0;\n${fs.readFileSync(new URL("schema.sql", here), "utf8")}\nRESET statement_timeout;`);
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM employees");
  // SEED_ROSTER=false: do not load the built-in HR sheet roster (the data comes from elsewhere, see scripts/import-portal-data.mjs).
  if (rows[0].n || process.env.SEED_ROSTER === "false") return;
  // First run: load the HR sheet roster so work emails stay unique against existing staff.
  const roster = JSON.parse(fs.readFileSync(new URL("../seed/roster.json", here), "utf8"));
  const cutoff = "2026-09-15";
  for (const r of roster) {
    await pool.query(
      `INSERT INTO employees (emp_no, name, work_email, title, start_date, last_day, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [r.no, r.name, r.email.toLowerCase(), r.title, r.start, r.lastDay, r.start >= cutoff ? "onboarding" : "active"]
    );
  }
}
