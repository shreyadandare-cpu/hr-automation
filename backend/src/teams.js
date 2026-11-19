import { pool } from "./db.js";

/** Approver value meaning "any of the directors": HR staff's own leave goes to them, not to a reporting manager. */
export const DIRECTORS = "directors";
/** Who can approve HR staff's own leave; either one is enough. Set HR_LEAVE_APPROVERS in .env to change it. */
export const hrLeaveApprovers = () =>
  (process.env.HR_LEAVE_APPROVERS ?? "chirag@wohlig.com,chintan@wohlig.com").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
/** Whether `email` decides requests whose approver is `approver`. */
export const approves = (approver, email) => approver === email || (approver === DIRECTORS && hrLeaveApprovers().includes(email));

/**
 * Who approves this person's leave: their reporting manager (the "manager" set in the Employees list) while that manager is still
 * here. Returns "hr" when there is none: then the super admins decide. A super admin may decide anyone's leave, and nobody
 * decides their own (leave.js mayDecideLeave). This holds for HR staff too.
 */
export async function approverOf(db, email) {
  const { rows } = await db.query(
    `SELECT m.work_email AS rm FROM employees e
     LEFT JOIN employees m ON lower(m.work_email) = lower(e.manager_email) AND m.status NOT IN ('offboarding','offboarded')
     WHERE lower(e.work_email) = lower($1) LIMIT 1`, [email]);
  if (!rows[0]) return "hr";
  return rows[0].rm ? rows[0].rm.toLowerCase() : "hr";
}

async function managersAndRoles(db, emails) {
  const { rows } = await db.query(
    `SELECT lower(e.work_email) AS email, lower(m.work_email) AS rm FROM employees e
     LEFT JOIN employees m ON lower(m.work_email) = lower(e.manager_email) AND m.status NOT IN ('offboarding','offboarded')
     ${emails ? "WHERE lower(e.work_email) = ANY($1)" : ""}`, emails ? [emails] : []);
  return rows;
}

/** Everyone's leave approver at once, keyed by lower-case work email (same rule as approverOf). */
export async function approverMap(db, emails = null) {
  const rows = await managersAndRoles(db, emails);
  return Object.fromEntries(rows.map((r) => [r.email, r.rm || "hr"]));
}

/** Everyone's reporting manager ("hr" when none), keyed by lower-case work email. Teams for attendance use this. */
export async function managerMap(db, emails = null) {
  const rows = await managersAndRoles(db, emails);
  return Object.fromEntries(rows.map((r) => [r.email, r.rm || "hr"]));
}

/* ---------- Approval stand-ins (approval_stand_ins) ---------- */
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
/** Whose leave approvals `email` covers today, as lower-case emails. */
export async function coveredBy(db, email, today = istToday()) {
  const { rows } = await db.query(
    "SELECT DISTINCT lower(for_email) AS e FROM approval_stand_ins WHERE lower(stand_in_email)=$1 AND cancelled_at IS NULL AND $2::date BETWEEN from_day AND to_day",
    [String(email).toLowerCase(), today]);
  return rows.map((r) => r.e);
}
/** Who covers `email`'s leave approvals today, as lower-case emails. */
export async function standInsOf(db, email, today = istToday()) {
  const { rows } = await db.query(
    "SELECT DISTINCT lower(stand_in_email) AS e FROM approval_stand_ins WHERE lower(for_email)=$1 AND cancelled_at IS NULL AND $2::date BETWEEN from_day AND to_day",
    [String(email).toLowerCase(), today]);
  return rows.map((r) => r.e);
}
/** The people whose reporting manager is `email` (same rule as approverOf), as lower-case emails. */
export async function reportsOf(db, email) {
  const { rows } = await db.query(
    `SELECT lower(e.work_email) AS e FROM employees e JOIN employees m ON lower(m.work_email) = lower(e.manager_email)
     WHERE lower(m.work_email) = $1 AND e.status <> 'offboarded'`, [String(email).toLowerCase()]);
  return rows.map((r) => r.e);
}
/** The reporting manager of `email` while they are still here, or null. */
export async function managerOf(db, email) {
  const { rows } = await db.query(
    `SELECT lower(m.work_email) AS m FROM employees e JOIN employees m ON lower(m.work_email) = lower(e.manager_email) AND m.status NOT IN ('offboarding','offboarded')
     WHERE lower(e.work_email) = $1 LIMIT 1`, [String(email).toLowerCase()]);
  return rows[0] ? rows[0].m : null;
}
