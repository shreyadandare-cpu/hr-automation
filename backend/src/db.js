import fs from "node:fs";
import pg from "pg";

// Keep DATE columns as plain YYYY-MM-DD strings so time zones cannot shift them by a day.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const here = new URL(".", import.meta.url);

export async function initDb() {
  await pool.query(fs.readFileSync(new URL("schema.sql", here), "utf8"));
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM employees");
  if (rows[0].n) return;
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
