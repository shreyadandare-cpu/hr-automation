import { pool, payPool, PAYROLL_SEPARATE } from "../db.js";

/*
 * Payroll can run in its own schema or database (PAYROLL_DATABASE_URL, PAYROLL_DB_SCHEMA), and then it holds its own `employees` table. This keeps that table in step
 * with the company's staff list, so a change anywhere (an employee ID, a name, a job title, a joining date, a status, a new joiner, a PAN) shows on the Payroll
 * pages and payslips at once, and a person onboarded today can be given a salary today.
 *
 * What is copied: every column the two tables share except the ones payroll owns (the PF number and the monthly gross it keeps from the salary structure,
 * and the leave balances). People missing from payroll's table are added; people already there are updated. Nobody is ever deleted.
 *
 * When it runs: before any Payroll or payslip page is read (at most every few seconds), right after any change made through the app, at start-up, and
 * on demand (`force`). A failure is logged and never stops a page or a save.
 */
const OWN = new Set(["id", "pf_number", "monthly_gross", "casual_opening", "leave_opening", "work_email_manual"]);   // payroll's own, or not shared
const FRESH_MS = 3000;
let columns = null, last = 0, running = null;

async function sharedColumns() {
  if (columns) return columns;
  const names = async (db) => (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='employees'")).rows.map((r) => r.column_name);
  const [a, b] = await Promise.all([names(pool), names(payPool)]);
  const inPay = new Set(b);
  columns = a.filter((c) => inPay.has(c) && !OWN.has(c));
  return columns;
}

/** The copying itself: one read of the staff list, one transaction on payroll's table. Returns how many people were written. */
async function copyAll() {
  const cols = await sharedColumns();
  if (!cols.includes("work_email")) return 0;
  const { rows } = await pool.query("SELECT row_to_json(e) AS j FROM employees e WHERE work_email IS NOT NULL");
  if (!rows.length) return 0;
  const list = cols.map((c) => `"${c}"`).join(", ");
  const upd = cols.filter((c) => c !== "created_at").map((c) => `"${c}"=EXCLUDED."${c}"`).join(", ");
  const sql = `INSERT INTO employees (${list}) SELECT ${list} FROM json_populate_record(NULL::employees, $1::json)
               ON CONFLICT (lower(work_email)) DO UPDATE SET ${upd}`;
  const client = await payPool.connect();
  try {
    await client.query("BEGIN");
    for (const r of rows) await client.query(sql, [JSON.stringify(r.j)]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return rows.length;
}

/** Brings payroll's staff table up to date. Does nothing when payroll shares the main database. `force` skips the few-second pause. */
export async function syncEmployees({ force = false } = {}) {
  if (!PAYROLL_SEPARATE) return 0;
  if (running) return running.then(() => (force ? syncEmployees({ force: true }) : 0));   // one at a time; a forced one waits for the running one, then runs again
  if (!force && Date.now() - last < FRESH_MS) return 0;
  running = copyAll()
    .then((n) => { last = Date.now(); return n; })
    .catch((err) => { console.error("Payroll staff sync:", err.message); return 0; })
    .finally(() => { running = null; });
  return running;
}
