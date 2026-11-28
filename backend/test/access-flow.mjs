/*
 * Access matrix, end to end, against a LOCAL server and database (never the shared one): signs in as each kind of person,
 * calls endpoints, and fails on any answer that is not the one expected. Read-only calls only, plus writes that must be refused
 * before they do anything, so nothing is changed or emailed. It cleans up its own test logins, sessions and grants.
 *
 * Salaries and every payment are the salary owners' alone (SALARY_OWNERS, decided 2026-11-27): a super admin, the HR team set
 * or a grant of a salary permission opens none of it; each person still sees and files their own. So the salary owner is one of
 * the people here, and nobody else in the test is a salary owner. Answers from salary pages are never printed.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/access-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server), like invite-flow.mjs and device-flow.mjs.
 */
import crypto from "node:crypto";
import pg from "pg";
import { PRESETS, salaryOwners } from "../src/access-rules.js";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: BASE must be a local server."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

// The people: picked from the local roster by reporting line, so the test follows the data. Only `owner` is a salary owner
// (the server's SALARY_OWNERS must match this process's; both default to the same three people).
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const OWNERS = salaryOwners();
const owner = (await one(`SELECT lower(e.work_email) AS e FROM employees e LEFT JOIN users u ON lower(u.email)=lower(e.work_email)
  WHERE e.status='active' AND lower(e.work_email) = ANY($1) AND NOT COALESCE(u.login_blocked,false)
  ORDER BY COALESCE(u.is_super_admin,false), 1 LIMIT 1`, [OWNERS]))?.e;
const superA = (await one("SELECT lower(email) AS e FROM users WHERE is_super_admin AND NOT login_blocked AND lower(email) <> ALL($1) ORDER BY 1 LIMIT 1", [OWNERS]))?.e;
let hr = (await one("SELECT lower(email) AS e FROM users WHERE role='hr' AND NOT is_super_admin AND NOT login_blocked AND lower(email) <> ALL($1) LIMIT 1", [OWNERS]))?.e;
let hrTemp = false;   // no plain HR login (for example HR people made super admins locally): borrow an employee and give them the HR set
// A team head: someone with at least one report who is not HR, a super admin or a salary owner; their report; and someone outside their tree.
const head = (await one(`SELECT lower(m.work_email) AS e FROM employees m JOIN employees r ON lower(r.manager_email)=lower(m.work_email)
  LEFT JOIN users u ON lower(u.email)=lower(m.work_email) WHERE m.status='active' AND COALESCE(u.role,'employee')<>'hr' AND NOT COALESCE(u.is_super_admin,false)
  AND lower(m.work_email) <> ALL($1) GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`, [OWNERS]))?.e;
const report = (await one("SELECT lower(work_email) AS e FROM employees WHERE lower(manager_email)=$1 AND status='active' AND lower(work_email) <> ALL($2) LIMIT 1", [head, OWNERS]))?.e;
const employee = (await one(`SELECT lower(e.work_email) AS e FROM employees e LEFT JOIN users u ON lower(u.email)=lower(e.work_email)
  WHERE e.status='active' AND COALESCE(u.role,'employee')<>'hr' AND NOT COALESCE(u.is_super_admin,false) AND lower(e.work_email)<>$1
  AND lower(e.work_email) <> ALL($2) AND NOT EXISTS (SELECT 1 FROM employees r WHERE lower(r.manager_email)=lower(e.work_email)) LIMIT 1`, [head, OWNERS]))?.e;
const outsider = (await one(`WITH RECURSIVE t AS (SELECT lower(work_email) AS e FROM employees WHERE lower(manager_email)=$1
  UNION SELECT lower(x.work_email) FROM employees x JOIN t ON lower(x.manager_email)=t.e)
  SELECT lower(work_email) AS e FROM employees WHERE status='active' AND lower(work_email) NOT IN (SELECT e FROM t) AND lower(work_email)<>$1
  AND lower(work_email) <> ALL($2) AND lower(work_email) NOT IN ($3,$4) LIMIT 1`, [head, OWNERS, employee, superA]))?.e;
// The accountant: holds finance.view, which no longer opens finance reports (only the salary owners see them).
const accountant = (await one(`SELECT lower(e.work_email) AS e FROM employees e LEFT JOIN users u ON lower(u.email)=lower(e.work_email)
  WHERE e.status='active' AND COALESCE(u.role,'employee')<>'hr' AND NOT COALESCE(u.is_super_admin,false) AND lower(e.work_email) NOT IN ($1,$2,$3,$5)
  AND lower(e.work_email) <> ALL($4) LIMIT 1`, [head, employee, report, OWNERS, outsider]))?.e;
if (!hr) {
  hr = (await one(`SELECT lower(e.work_email) AS e FROM employees e LEFT JOIN users u ON lower(u.email)=lower(e.work_email)
    WHERE e.status='active' AND NOT COALESCE(u.is_super_admin,false) AND lower(e.work_email) NOT IN ($1,$2,$3,$4,$5) AND lower(e.work_email) <> ALL($6) LIMIT 1`,
    [head, report, employee, outsider, accountant, OWNERS]))?.e;
  hrTemp = true;
}
for (const [k, v] of Object.entries({ owner, superA, hr, head, report, employee, outsider, accountant })) if (!v) { console.error(`No suitable ${k} in the local data.`); process.exit(2); }

const made = { users: [], sessions: [], grants: [], advances: [] };
async function signIn(email) {
  const u = await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1, '00:00', 'employee') ON CONFLICT DO NOTHING RETURNING email", [email]);
  if (u.rowCount) made.users.push(email);
  const t = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '15 minutes')", [sha(t), email]);
  made.sessions.push(sha(t));
  return t;
}
async function give(email, permission, scope, root = null) {
  const r = await db.query("INSERT INTO access_grants (email, permission, scope, scope_root_email, granted_by, note) VALUES ($1,$2,$3,$4,'access-flow test','test') RETURNING id", [email, permission, scope, root]);
  made.grants.push(r.rows[0].id);
}

let failed = 0, passed = 0;
async function check(who, token, method, path, want, body) {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${token}`, "content-type": "application/json", origin: BASE }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const ok = Array.isArray(want) ? want.includes(r.status) : r.status === want;
  const said = r.ok ? "" : (await r.text()).slice(0, 120);   // a 2xx answer may hold salary figures: never printed
  if (ok) passed++; else { failed++; console.log(`FAIL ${who.padEnd(10)} ${method} ${path} -> ${r.status}, expected ${want}  ${said}`); }
}

try {
  if (hrTemp) for (const p of PRESETS.hr.perms) await give(hr, p, "company");
  await give(head, "attendance.view", "tree");
  await give(head, "leave.approve", "tree");
  // Grants of salary permissions: they still exist on the Access page, and they must open nothing (the salary lock).
  await give(head, "payroll.view", "tree");
  await give(head, "advances.approve", "tree");
  await give(accountant, "finance.view", "company");
  await give(accountant, "finance.contractors", "company");
  await give(employee, "payroll.bank", "company");
  const T = { owner: await signIn(owner), super: await signIn(superA), hr: await signIn(hr), head: await signIn(head), employee: await signIn(employee),
    accountant: await signIn(accountant), report: await signIn(report), outsider: await signIn(outsider) };
  const all = (path, want, method = "GET", body) => Promise.all(Object.entries(want).map(([k, w]) => check(k, T[k], method, path, w, body)));
  const OK = 200, NO = 403;
  const notOwners = { super: NO, hr: NO, head: NO, employee: NO, accountant: NO };

  // Admin pages: super admin and HR only.
  for (const p of ["/api/users", "/api/audit", "/api/onboarding", "/api/hr/probations", "/api/celebrations", "/api/assets", "/api/hr/openings"])
    await all(p, { super: OK, hr: OK, head: NO, employee: NO, accountant: NO });
  await all("/api/access/people", { super: OK, hr: NO, head: NO, employee: NO, accountant: NO });
  // Salary pages (salary cuts, finance reports, the salary list, bank accounts): the salary owner only, whatever the others hold.
  for (const p of ["/api/leave/salary-cuts?month=2026-10", "/api/finance/periods", "/api/payroll/employees", "/api/payroll/bank-people"])
    await all(p, { owner: OK, ...notOwners });
  // Contractor payments: refused before anything is written; the owner passes the check and is stopped by validation (nothing saved).
  await all("/api/finance/contractors", { owner: 400, super: NO, hr: NO, accountant: NO }, "POST", { name: "Test", pan: "ABCDE1234F" });
  // Team scope: the head sees their report's attendance, not an outsider's; a plain employee sees neither.
  await all(`/api/attendance/month?email=${encodeURIComponent(report)}`, { super: OK, hr: OK, head: OK, employee: NO });
  await all(`/api/attendance/month?email=${encodeURIComponent(outsider)}`, { super: OK, hr: OK, head: NO, employee: NO });
  // Payslips of someone else: the salary owner only (payroll.view for a team opens nothing); the person themselves still sees theirs.
  await all(`/api/payslips?email=${encodeURIComponent(report)}`, { owner: [OK, 404], report: OK, ...notOwners });
  await all(`/api/payslips?email=${encodeURIComponent(outsider)}`, { owner: [OK, 404], outsider: OK, head: NO, employee: NO });
  // Everyone still has their own pages.
  for (const p of ["/api/leave", "/api/payslips", "/api/attendance/today", "/api/profile", "/api/reimbursements"])
    await all(p, { owner: OK, super: OK, hr: OK, head: OK, employee: OK, accountant: OK, report: OK });
  // Decisions on advances: the salary owners only (a team grant or super admin decides nothing), and nobody decides their own
  // request, except a sole salary owner (access-rules.js, decidesOwn). In-app notices only, no email.
  const advance = async (who) => {
    const r = await fetch(BASE + "/api/requests/advance", { method: "POST", headers: { cookie: `sid=${T[who]}`, "content-type": "application/json", origin: BASE }, body: JSON.stringify({ amount: 1000, reason: "access-flow test, please ignore" }) });
    const d = await r.json().catch(() => ({}));
    if (d.id) made.advances.push(d.id); else { failed++; console.log(`FAIL could not file an advance as ${who}: ${r.status}`); }
    return d.id;
  };
  const hrOwn = await advance("hr"), fromReport = await advance("report"), fromOutsider = await advance("outsider"), ownerOwn = await advance("owner");
  const decline = { decision: "decline", note: "access-flow test" };
  if (hrOwn) await check("hr", T.hr, "POST", `/api/requests/advance/${hrOwn}/decide`, NO, { decision: "approve" });
  if (hrOwn) await check("super", T.super, "POST", `/api/requests/advance/${hrOwn}/decide`, NO, { decision: "approve" });
  if (fromOutsider) await check("head", T.head, "POST", `/api/requests/advance/${fromOutsider}/decide`, NO, { decision: "approve" });
  if (fromReport) await check("head", T.head, "POST", `/api/requests/advance/${fromReport}/decide`, NO, { decision: "approve" });
  if (ownerOwn) await check("owner", T.owner, "POST", `/api/requests/advance/${ownerOwn}/decide`, OWNERS.length === 1 ? OK : NO, decline);
  if (fromReport) await check("owner", T.owner, "POST", `/api/requests/advance/${fromReport}/decide`, OK, decline);
  if (hrOwn) await check("owner", T.owner, "POST", `/api/requests/advance/${hrOwn}/decide`, OK, decline);
  // Attendance: an HR user cannot correct their own punches.
  await check("hr", T.hr, "POST", "/api/attendance/punches", NO, { email: hr, date: "2026-11-02", time: "09:30", direction: "IN", note: "access-flow test" });
  console.log(`\n${passed} passed, ${failed} failed  (owner=${owner}, super=${superA}, hr=${hr}${hrTemp ? " (HR set given for the test)" : ""}, head=${head}, report=${report}, outsider=${outsider}, employee=${employee}, accountant=${accountant})`);
} finally {
  if (made.grants.length) await db.query("DELETE FROM access_grants WHERE id = ANY($1)", [made.grants]);
  if (made.advances.length) await db.query("DELETE FROM advance_requests WHERE id = ANY($1)", [made.advances]);
  await db.query("DELETE FROM notifications WHERE title ILIKE '%advance%' AND (body = 'access-flow test' OR body = '')  AND created_at > now() - interval '10 minutes' AND lower(recipient) = ANY($1)", [[hr, report, outsider, owner].map((e) => e.toLowerCase())]);
  if (made.sessions.length) await db.query("DELETE FROM sessions WHERE token_hash = ANY($1)", [made.sessions]);
  if (made.users.length) await db.query("DELETE FROM users WHERE email = ANY($1) AND password_hash='00:00'", [made.users]);
  await db.end();
}
process.exit(failed ? 1 : 0);
