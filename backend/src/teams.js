import { pool } from "./db.js";
import { createUser } from "./auth.js";

// The reporting managers. Their own leave is approved by HR.
export const MANAGERS = [
  "jagruti@wohlig.com", "chintan@wohlig.com", "chirag@wohlig.com", "dhruv.gansinghani@wohlig.com",
  "ankit.shrivastav@wohlig.com", "samay.gada@wohlig.com", "bilal.sani@wohlig.com",
];

/**
 * First run only (nobody has a reporting manager yet, neither picked by HR nor set here before): give each manager a manager login and split everyone else
 * across them. The split is a stand-in until HR sets real teams; it is stable (same result every time it runs).
 */
export async function setupTeams() {
  const { rows: done } = await pool.query(
    "SELECT 1 FROM employees WHERE reporting_manager IS NOT NULL OR coalesce(manager,'') <> '' LIMIT 1");
  if (done.length) return;
  const { rows: mgrs } = await pool.query(
    "SELECT work_email, name FROM employees WHERE lower(work_email) = ANY($1) AND status <> 'offboarded' ORDER BY name", [MANAGERS]);
  if (!mgrs.length) return;
  for (const m of mgrs) {
    if (!(await createUser(pool, m.work_email, "manager")))
      await pool.query("UPDATE users SET role='manager' WHERE lower(email)=lower($1) AND role='employee'", [m.work_email]);
  }
  const { rows: people } = await pool.query(
    `SELECT id FROM employees WHERE status <> 'offboarded' AND NOT (lower(work_email) = ANY($1)) ORDER BY md5(work_email)`, [MANAGERS]);
  for (const [i, p] of people.entries()) {
    const m = mgrs[i % mgrs.length];
    await pool.query("UPDATE employees SET reporting_manager=$2, manager=$3 WHERE id=$1", [p.id, m.work_email, m.name]);
  }
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1, NULL)",
    [`Teams set up: ${people.length} people split across ${mgrs.length} reporting managers`]);
}

/**
 * Who approves this person's leave: their reporting manager (the "manager" HR picks in the Employees list) while
 * that manager is still here. Returns "hr" when there is none, which means the request is approved automatically.
 */
export async function approverOf(db, email) {
  const { rows } = await db.query(
    `SELECT m.work_email AS rm FROM employees e
     JOIN employees m ON lower(m.name) = lower(e.manager) AND m.status NOT IN ('offboarding','offboarded')
     WHERE lower(e.work_email) = lower($1) LIMIT 1`, [email]);
  return rows[0] ? rows[0].rm.toLowerCase() : "hr";
}

/** Everyone's approver at once, keyed by lower-case work email (same rule as approverOf). */
export async function approverMap(db, emails = null) {
  const { rows } = await db.query(
    `SELECT lower(e.work_email) AS email, lower(m.work_email) AS rm FROM employees e
     LEFT JOIN employees m ON lower(m.name) = lower(e.manager) AND m.status NOT IN ('offboarding','offboarded')
     ${emails ? "WHERE lower(e.work_email) = ANY($1)" : ""}`, emails ? [emails] : []);
  return Object.fromEntries(rows.map((r) => [r.email, r.rm || "hr"]));
}
