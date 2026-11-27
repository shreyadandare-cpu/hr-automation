/*
 * Payments are the salary owner's alone, end to end, against a LOCAL server and database (never the shared one). An employee files
 * an expense claim, a loan, a budget and an advance request. A super admin, an HR login, the employee's own manager (holding the
 * old team approval grants) and a colleague then try to see and decide them: none may. The salary owner (kailash@wohlig.com, with
 * no role or grant) sees and decides them all, and the employee still sees their own. Everything it adds is removed at the end.
 *
 *   Start the server with SALARY_OWNERS unset (so the owner is kailash@wohlig.com), then:
 *   PAYROLL_ENCRYPTION_KEY=<the server's> DATABASE_URL=postgresql://localhost:5432/<db> BASE=http://localhost:3100 node test/payments-lock-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server).
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB) || !/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: a local database and a local server only."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB }), sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const K = "kailash@wohlig.com", EMP = "test.lock.employee@wohlig.com", MGR = "test.lock.manager@wohlig.com", SA = "test.lock.superadmin@wohlig.com",
  HR = "test.lock.hr@wohlig.com", COL = "test.lock.colleague@wohlig.com";
const PEOPLE = [EMP, MGR, SA, HR, COL], made = { users: [], employees: [] };
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
const login = async (email, { role = "employee", superAdmin = false, perms = [] } = {}) => {
  const { rowCount } = await db.query("INSERT INTO users (email, password_hash, role, is_super_admin) VALUES ($1,'!no-password-login',$2,$3) ON CONFLICT DO NOTHING", [email, role, superAdmin]);
  if (rowCount) made.users.push(email);
  for (const [permission, scope] of perms) await db.query("INSERT INTO access_grants (email, permission, scope, granted_by, note) VALUES ($1,$2,$3,'test','payments-lock-flow')", [email, permission, scope]);
  const t = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(t), email]);
  return t;
};
const call = async (tok, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${tok}`, "content-type": "application/json", origin: BASE }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, d: await r.json().catch(() => null) };
};
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const wipe = async () => {
  const ids = (await db.query("SELECT id FROM reimbursements WHERE lower(work_email) = ANY($1)", [[EMP, K]])).rows.map((r) => r.id);
  for (const t of ["reimbursement_events", "reimbursement_documents", "reimbursement_items"]) await db.query(`DELETE FROM ${t} WHERE reimbursement_id = ANY($1)`, [ids]);
  await db.query("DELETE FROM reimbursements WHERE id = ANY($1)", [ids]);
  const bids = (await db.query("SELECT id FROM budget_requests WHERE lower(work_email)=$1", [EMP])).rows.map((r) => r.id);
  await db.query("DELETE FROM budget_request_events WHERE budget_request_id = ANY($1)", [bids]);
  await db.query("DELETE FROM budget_requests WHERE id = ANY($1)", [bids]);
  const lids = (await db.query("SELECT id FROM loans WHERE lower(work_email)=$1", [EMP])).rows.map((r) => r.id);
  await db.query("DELETE FROM loan_events WHERE loan_id = ANY($1)", [lids]);
  await db.query("DELETE FROM loans WHERE id = ANY($1)", [lids]);
  await db.query("DELETE FROM advance_requests WHERE lower(email)=$1", [EMP]);
  await db.query("DELETE FROM notifications WHERE lower(recipient) = ANY($1)", [[...PEOPLE, K]]);
  await db.query("DELETE FROM audit_log WHERE lower(work_email) = ANY($1)", [[...PEOPLE]]);
  await db.query("DELETE FROM access_grants WHERE note='payments-lock-flow'");
  await db.query("DELETE FROM sessions WHERE lower(email) = ANY($1)", [[...PEOPLE, K]]);
};

try {
  await wipe();
  for (const [e, name, mgr] of [[MGR, "Test Lock Manager", null], [EMP, "Test Lock Employee", MGR], [COL, "Test Lock Colleague", MGR], [K, "Kailash (salary owner)", null]]) {
    const { rowCount } = await db.query("INSERT INTO employees (name, work_email, title, start_date, status, manager_email) VALUES ($1,$2,'Engineer','2024-01-01','active',$3) ON CONFLICT DO NOTHING", [name, e, mgr]);
    if (rowCount) made.employees.push(e);
  }
  const team = [["expenses.approve", "tree"], ["advances.approve", "tree"], ["budgets.approve", "tree"]];
  const e = await login(EMP), k = await login(K), sa = await login(SA, { role: "hr", superAdmin: true }),
    hr = await login(HR, { role: "hr", perms: [["expenses.approve", "company"], ["advances.approve", "company"], ["budgets.approve", "company"], ["finance.contractors", "company"]] }),
    mgr = await login(MGR, { perms: team }), col = await login(COL);
  const cat = (await db.query("SELECT key FROM reimbursement_categories WHERE active ORDER BY sort LIMIT 1")).rows[0].key;

  // ---- the employee files four requests ----
  let r = await call(e, "POST", "/api/reimbursements", { items: [{ category: cat, amount: 640, expenseDate: today, description: "Taxi to the client", noReceipt: true }] });
  const claimId = r.d && r.d.id;
  r = await call(e, "POST", `/api/reimbursements/${claimId}/submit`, { declaration: true });
  ok("the employee files and submits an expense claim", r.s === 200, JSON.stringify(r.d));
  r = await call(e, "POST", "/api/loans", { amount: 60000, months: 6, reason: "Medical expenses for family" });
  const loanId = r.d && (r.d.id || (r.d.loan && r.d.loan.id));
  ok("a loan", r.s === 201 || r.s === 200, JSON.stringify(r.d));
  r = await call(e, "POST", "/api/budget-requests", { purpose: "Client workshop", category: cat, requestedBudget: 8000, headcount: 5, eventDate: today, description: "Workshop lunch" });
  const budgetId = r.d && r.d.id;
  ok("a budget", r.s === 201, JSON.stringify(r.d));
  r = await call(e, "POST", "/api/requests/advance", { amount: 15000, reason: "Advance for relocation" });
  const advId = r.d && r.d.id;
  ok("and an advance request", r.s === 201, JSON.stringify(r.d));

  // ---- nobody but the salary owner sees or decides them ----
  const others = { "super admin": sa, "HR with the approval permissions": hr, "their own manager with the old team grants": mgr, "a colleague": col };
  for (const [who, t] of Object.entries(others)) {
    const leaks = [];
    const list = await call(t, "GET", "/api/reimbursements?scope=review");
    if (list.d && Array.isArray(list.d.claims) && list.d.claims.some((c) => c.id === claimId)) leaks.push("claims list");
    if ((await call(t, "GET", `/api/reimbursements/${claimId}`)).s === 200) leaks.push("the claim");
    if ([200, 201].includes((await call(t, "POST", `/api/reimbursements/${claimId}/approve`, { approvedAmount: 640 })).s)) leaks.push("approved the claim");
    const loans = await call(t, "GET", "/api/loans");
    if (loans.s === 200 && loans.d && (loans.d.loans || []).some((l) => l.id === loanId)) leaks.push("loans list");
    if (loanId && (await call(t, "GET", `/api/loans/${loanId}`)).s === 200) leaks.push("the loan");
    const budgets = await call(t, "GET", "/api/budget-requests");
    if (budgets.d && (budgets.d.requests || budgets.d.budgets || budgets.d || []).some?.((b) => b.id === budgetId)) leaks.push("budgets list");
    if ((await call(t, "GET", `/api/budget-requests/${budgetId}`)).s === 200) leaks.push("the budget");
    if ([200].includes((await call(t, "POST", `/api/budget-requests/${budgetId}/approve`, { approvedBudget: 8000 })).s)) leaks.push("approved the budget");
    const adv = await call(t, "GET", "/api/requests/advance?scope=all");
    if (adv.d && (adv.d.requests || []).some((x) => x.id === advId)) leaks.push("advance requests");
    if ((await call(t, "GET", `/api/advances?email=${encodeURIComponent(EMP)}`)).s === 200) leaks.push("advances");
    if ((await call(t, "GET", "/api/finance/contractors?fy=2026-27")).s === 200) leaks.push("contractor payments");
    const rep = await call(t, "POST", "/api/report-builder/run", { dataset: "expenses", columns: ["claimNo", "amount"] });
    if (rep.s === 200) leaks.push("expenses report");
    ok(`${who} sees and decides none of them`, !leaks.length, leaks.join(", "));
  }

  // ---- the employee sees their own ----
  ok("the employee still sees their own claim", (await call(e, "GET", `/api/reimbursements/${claimId}`)).s === 200);
  ok("and their own loans", ((await call(e, "GET", "/api/loans/mine")).d?.loans || []).some((l) => l.id === loanId));
  ok("and their own budget", (await call(e, "GET", `/api/budget-requests/${budgetId}`)).s === 200);

  // ---- the salary owner sees and decides them ----
  r = await call(k, "GET", "/api/reimbursements?scope=review");
  ok("Kailash sees the claim with its amount", r.d && (r.d.claims || []).some((c) => c.id === claimId && c.amount === 640), JSON.stringify(r.d && r.d.claims && r.d.claims.slice(0, 1)));
  r = await call(k, "POST", `/api/reimbursements/${claimId}/approve`, { approvedAmount: 640 });
  ok("and approves it", r.s === 200, JSON.stringify(r.d));
  r = await call(k, "GET", "/api/loans");
  ok("sees the loan", r.s === 200 && (r.d.loans || []).some((l) => l.id === loanId), JSON.stringify(r.d && r.d.stats));
  r = await call(k, "POST", `/api/budget-requests/${budgetId}/approve`, { approvedBudget: 6000, reason: "Policy cap" });
  ok("approves the budget for less", r.s === 200, JSON.stringify(r.d));
  r = await call(k, "GET", "/api/requests/advance?scope=all");
  ok("sees the advance request", (r.d && r.d.requests || []).some((x) => x.id === advId && x.amount === 15000 && x.canDecide), JSON.stringify(r.d && r.d.requests && r.d.requests.slice(0, 1)));
  ok("sees contractor payments", (await call(k, "GET", "/api/finance/contractors?fy=2026-27")).s === 200);

  // ---- Kailash's own claim: the only owner decides it ----
  r = await call(k, "POST", "/api/reimbursements", { items: [{ category: cat, amount: 120, expenseDate: today, description: "Parking", noReceipt: true }] });
  const own = r.d && r.d.id;
  await call(k, "POST", `/api/reimbursements/${own}/submit`, { declaration: true });
  r = await call(k, "POST", `/api/reimbursements/${own}/approve`, { approvedAmount: 120 });
  ok("Kailash, the only salary owner, can approve his own claim", r.s === 200, JSON.stringify(r.d));
  ok("nobody else can", ![200, 201].includes((await call(sa, "POST", `/api/reimbursements/${own}/approve`, { approvedAmount: 120 })).s));

  // ---- notices go to Kailash only ----
  const { rows: n } = await db.query("SELECT DISTINCT lower(recipient) AS r FROM notifications WHERE lower(recipient) = ANY($1)", [[SA, HR, MGR, COL, K]]);
  ok("approval notices reached Kailash and no one else", n.every((x) => x.r === K) && n.some((x) => x.r === K), JSON.stringify(n));
} catch (err) { fail++; console.log("ERROR  " + err.stack); }
finally {
  await wipe().catch((err) => console.log("cleanup:", err.message));
  await db.query("DELETE FROM employees WHERE lower(work_email) = ANY($1)", [made.employees]);
  await db.query("DELETE FROM users WHERE lower(email) = ANY($1)", [made.users]);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
