import { pool } from "./db.js";

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
