/*
 * Advance and loan instalments, end to end, against a LOCAL server and database (never the shared one): HR records an advance
 * with instalments, the employee sees it, payroll deducts the instalment each month and never twice in the same month, the last
 * instalment is only what is left, and stopping the plan stops the deductions.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/advances-flow.mjs
 *
 * Not part of `npm test`. The test people are clearly named and removed afterwards; a local server sends no email.
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const EMP = "test.advance.employee@wohlig.com", HR = "test.advance.admin@wohlig.com";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
async function login(email, perms = []) {
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x','employee') ON CONFLICT DO NOTHING", [email]);
  for (const p of perms) await db.query("INSERT INTO access_grants (email, permission, scope, granted_by, note) VALUES ($1,$2,'company','test','flow-test')", [email, p]);
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(token), email]);
  return token;
}
const call = async (token, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${token}`, origin: BASE, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const clean = async () => {
  await db.query("DELETE FROM advance_recoveries WHERE advance_id IN (SELECT id FROM employee_advances WHERE lower(work_email)=$1)", [EMP]);
  await db.query("DELETE FROM employee_advances WHERE lower(work_email)=$1", [EMP]);
  await db.query("DELETE FROM salary_structures WHERE lower(work_email)=$1", [EMP]);
  await db.query("DELETE FROM employees WHERE lower(work_email)=ANY($1)", [[EMP, HR]]);
  await db.query("DELETE FROM access_grants WHERE lower(email)=ANY($1) AND note='flow-test'", [[EMP, HR]]);
  await db.query("DELETE FROM audit_log WHERE lower(work_email)=ANY($1)", [[EMP, HR]]);
  await db.query("DELETE FROM sessions WHERE lower(email)=ANY($1)", [[EMP, HR]]);
  await db.query("DELETE FROM users WHERE lower(email)=ANY($1)", [[EMP, HR]]);
};
try {
  await clean();
  await db.query("INSERT INTO employees (work_email, name, start_date, status) VALUES ($1,'Test Advance Employee','2020-01-01','active'),($2,'Test Advance Admin','2020-01-01','active')", [EMP, HR]);
  await db.query("INSERT INTO salary_structures (work_email, effective_from, earnings, professional_tax, updated_by) VALUES ($1,'2026-01',$2,0,'test')", [EMP, JSON.stringify([{ name: "Basic", amount: 40000 }])]);
  const e = await login(EMP), hr = await login(HR, ["advances.approve"]);

  let r = await call(hr, "POST", "/api/advances", { email: EMP, date: "2026-10-15", reason: "Salary advance", amount: 12000, monthly: "15000", fromMonth: "2026-11" });
  ok("an instalment above the advance is refused", r.status === 400 && r.data.errors.monthly, JSON.stringify(r.data));
  r = await call(hr, "POST", "/api/advances", { email: EMP, date: "2026-10-15", reason: "Salary advance", amount: 12000, monthly: "5000", fromMonth: "2026-11" });
  ok("HR records a ₹12,000 advance at ₹5,000 a month from November", r.status === 201 && r.data[0].monthly === 5000 && r.data[0].monthsLeft === 3, JSON.stringify(r.data));
  const id = r.data[0].id;
  r = await call(e, "GET", "/api/advances/mine");
  ok("the employee sees it, with 3 months left", r.status === 200 && r.data[0].outstanding === 12000 && r.data[0].monthsLeft === 3, JSON.stringify(r.data));
  r = await call(e, "GET", `/api/advances?email=${EMP}`);
  ok("but cannot open the HR list", r.status === 403);

  const { buildLines } = await import("../src/payroll/store.js");
  const { payPool, pool } = await import("../src/db.js");
  const ded = async (period) => { const l = (await buildLines(payPool, period)).find((x) => x.email.toLowerCase() === EMP); return l ? l.slip.deductions.filter((d) => d.code === "advance").reduce((n, d) => n + d.amount, 0) : null; };
  ok("October, before the plan starts: nothing deducted", (await ded("2026-10")) === 0);
  ok("November: ₹5,000 deducted", (await ded("2026-11")) === 5000);
  await db.query("INSERT INTO advance_recoveries (advance_id, amount, recovered_on, note, recorded_by, payroll_period) VALUES ($1,5000,'2026-11-30','Deducted in payroll for November 2026','test','2026-11')", [id]);
  ok("November recalculated after approval: still ₹5,000, never twice", (await ded("2026-11")) === 5000);
  ok("December: ₹5,000", (await ded("2026-12")) === 5000);
  await db.query("INSERT INTO advance_recoveries (advance_id, amount, recovered_on, note, recorded_by, payroll_period) VALUES ($1,5000,'2026-12-31','Deducted in payroll for December 2026','test','2026-12')", [id]);
  ok("January: only the ₹2,000 left", (await ded("2027-01")) === 2000);
  r = await call(hr, "PUT", `/api/advances/${id}/plan`, { monthly: "", fromMonth: "" });
  ok("stopping the instalments", r.status === 200 && r.data[0].monthly === null);
  ok("then nothing is deducted", (await ded("2027-01")) === 0);
  await payPool.end().catch(() => {}); if (pool !== payPool) await pool.end().catch(() => {});
} catch (err) { fail++; console.log("ERROR  " + err.stack); }
finally { await clean(); await db.end(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
