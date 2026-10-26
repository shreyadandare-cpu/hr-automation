import { pool } from "./db.js";

/** Approver value meaning "any of the directors": HR staff's own leave goes to them, not to a reporting manager. */
export const DIRECTORS = "directors";
/** Who can approve HR staff's own leave; either one is enough. Set HR_LEAVE_APPROVERS in .env to change it. */
export const hrLeaveApprovers = () =>
  (process.env.HR_LEAVE_APPROVERS ?? "chirag@wohlig.com,chintan@wohlig.com").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
/** Whether `email` decides requests whose approver is `approver`. */
export const approves = (approver, email) => approver === email || (approver === DIRECTORS && hrLeaveApprovers().includes(email));

/**
 * Who approves this person's leave: the directors for HR staff, otherwise their reporting manager (the "manager" HR
 * picks in the Employees list) while that manager is still here. Returns "hr" when there is none: HR decides it.
 */
export async function approverOf(db, email) {
  const { rows } = await db.query(
    `SELECT u.role, m.work_email AS rm FROM employees e
     LEFT JOIN users u ON lower(u.email) = lower(e.work_email)
     LEFT JOIN employees m ON lower(m.name) = lower(e.manager) AND m.status NOT IN ('offboarding','offboarded')
     WHERE lower(e.work_email) = lower($1) LIMIT 1`, [email]);
  if (!rows[0]) return "hr";
  return rows[0].role === "hr" ? DIRECTORS : rows[0].rm ? rows[0].rm.toLowerCase() : "hr";
}

async function managersAndRoles(db, emails) {
  const { rows } = await db.query(
    `SELECT lower(e.work_email) AS email, u.role, lower(m.work_email) AS rm FROM employees e
     LEFT JOIN users u ON lower(u.email) = lower(e.work_email)
     LEFT JOIN employees m ON lower(m.name) = lower(e.manager) AND m.status NOT IN ('offboarding','offboarded')
     ${emails ? "WHERE lower(e.work_email) = ANY($1)" : ""}`, emails ? [emails] : []);
  return rows;
}

/** Everyone's leave approver at once, keyed by lower-case work email (same rule as approverOf). */
export async function approverMap(db, emails = null) {
  const rows = await managersAndRoles(db, emails);
  return Object.fromEntries(rows.map((r) => [r.email, r.role === "hr" ? DIRECTORS : r.rm || "hr"]));
}

/** Everyone's reporting manager ("hr" when none), keyed by lower-case work email. Teams for attendance use this. */
export async function managerMap(db, emails = null) {
  const rows = await managersAndRoles(db, emails);
  return Object.fromEntries(rows.map((r) => [r.email, r.rm || "hr"]));
}
