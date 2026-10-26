import fs from "node:fs";
import pg from "pg";

// Keep DATE columns as plain YYYY-MM-DD strings so time zones cannot shift them by a day.
pg.types.setTypeParser(1082, (v) => v);

// DB_SCHEMA keeps this app's tables in their own schema when the database is shared with another app (for example the
// Employee Portal's tables in "public"). Every connection looks only in that schema, so the other app's tables of the same
// name (employees, users, ...) are never read or changed by mistake. Empty = the database's default schema.
export const SCHEMA = (process.env.DB_SCHEMA || "").trim();
if (SCHEMA && !/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error("DB_SCHEMA must be lowercase letters, digits and underscores");
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ...(SCHEMA ? { options: `-c search_path=${SCHEMA}` } : {}) });

const here = new URL(".", import.meta.url);

export async function initDb() {
  if (SCHEMA) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await pool.query(fs.readFileSync(new URL("schema.sql", here), "utf8"));
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
