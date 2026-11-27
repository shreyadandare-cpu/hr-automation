/*
 * Company loans end to end, against a LOCAL server and a LOCAL database (never the shared one): request, HR approval (as asked, with a changed amount, rejected), the final
 * activation checks, the payslip line, the balance after a real approved payroll month, no duplicate deductions when a month is recalculated, completion, nothing after it, and
 * who may see or decide what. The server needs PAYROLL_ENCRYPTION_KEY.
 *
 *   DATABASE_URL=postgresql://postgres:x@localhost:55434/postgres BASE=http://localhost:3190 node test/loans-flow.mjs
 *
 * Not part of `npm test`. Approved payroll is protected by triggers, so cleanup switches them off for its own session, on this throwaway database only.
 */
import crypto from "node:crypto";
import pg from "pg";
import { openSealedRow } from "../src/secret-box.js";   // the test needs PAYROLL_ENCRYPTION_KEY, as the server

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3190";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB) || !/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: a local database and a local server only."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB }), sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const HR = "ln.hr@wohlig.com", HR2 = "ln.hr2@wohlig.com", REV = "ln.rev@wohlig.com", A = "ln.asha@wohlig.com", B = "ln.bina@wohlig.com", C = "ln.chetan@wohlig.com";
const ALL = [HR, HR2, REV, A, B, C], NAMES = { [A]: "Asha Loan", [B]: "Bina Loan", [C]: "Chetan Loan" }, ACCT = { [A]: "111122223333", [B]: "222233334444", [C]: "333344445555" };
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
const login = async (email, superAdmin = false) => {
  await db.query("INSERT INTO users (email, password_hash, role, is_super_admin) VALUES ($1,'x',$2,$3) ON CONFLICT DO NOTHING", [email, superAdmin ? "hr" : "employee", superAdmin]);
  const t = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(t), email]);
  return t;
};
const call = async (tok, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${tok}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, d: await r.json().catch(() => null) };
};
const month = (add = 0) => { const d = new Date(Date.now() + 330 * 60000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + add); return d.toISOString().slice(0, 7); };
const PERIOD = process.env.FLOW_PERIOD || month(-1), P2 = month(0), P3 = month(1), TODAY = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const structure = (gross) => ({ effectiveFrom: month(-3), earnings: [{ name: "Basic", amount: gross * 0.5 }, { name: "HRA", amount: gross * 0.3 }, { name: "Special allowance", amount: gross * 0.2 }], pfEmployee: 1800, professionalTax: 200, otherDeductions: [], tdsMode: "manual", tdsMonthly: 0, reason: "Offer", annualCtc: gross * 12, pfApplicable: true, ptApplicable: true, tdsApplicable: false });

const wipe = async () => {
  const c = await db.connect();
  try {
    await c.query("SET session_replication_role = replica");
    await c.query("DELETE FROM advance_recoveries WHERE advance_id IN (SELECT id FROM employee_advances WHERE lower(work_email) = ANY($1))", [ALL]);
    await c.query("DELETE FROM employee_advances WHERE lower(work_email) = ANY($1)", [ALL]);
    await c.query("DELETE FROM loans WHERE lower(work_email) = ANY($1)", [ALL]);
    await c.query("DELETE FROM payroll_files WHERE run_id IN (SELECT id FROM payroll_runs WHERE processed_by = $1)", [HR]).catch(() => {});
    await c.query("DELETE FROM payroll_items WHERE lower(work_email) = ANY($1)", [ALL]).catch(() => {});
    await c.query("DELETE FROM payroll_audit WHERE actor = ANY($1) OR work_email = ANY($1)", [ALL]).catch(() => {});
    await c.query("DELETE FROM payroll_runs WHERE processed_by = $1", [HR]).catch(() => {});
    await c.query("DELETE FROM salary_structures WHERE lower(work_email) = ANY($1)", [ALL]);
    await c.query("DELETE FROM payroll_bank_accounts WHERE lower(work_email) = ANY($1)", [ALL]);
    await c.query("DELETE FROM access_grants WHERE email = $1 AND note = 'loans-flow'", [REV]);
    await c.query("DELETE FROM employees WHERE lower(work_email) = ANY($1)", [ALL]);
  } finally { await c.query("RESET session_replication_role").catch(() => {}); c.release(); }
};

try {
  await wipe();
  const hr = await login(HR, true), hr2 = await login(HR2, true), rev = await login(REV, false), a = await login(A), b = await login(B), c = await login(C);
  await db.query("INSERT INTO access_grants (email, permission, scope, scope_root_email, granted_by, note) VALUES ($1,'payroll.approve','company',NULL,'loans-flow','loans-flow')", [REV]);
  const mk = (n, e, no, dept, title) => db.query("INSERT INTO employees (emp_no, name, work_email, title, dept, start_date, status, onboarded_at, pan_masked) VALUES ($1,$2,$3,$4,$5,'2024-01-01','active',now(),'XXXXX1234X')", [no, n, e, title, dept]);
  await mk("Asha Loan", A, "L/1", "Engineering", "Engineer"); await mk("Bina Loan", B, "L/2", "Design", "Designer"); await mk("Chetan Loan", C, "L/3", "Sales", "Executive");
  await mk("HR One", HR, "L/90", "HR", "HR Lead"); await mk("HR Two", HR2, "L/91", "HR", "HR Executive"); await mk("Reviewer", REV, "L/92", "Finance", "Finance");
  for (const [e, gross] of [[A, 60000], [B, 60000], [C, 60000]]) {
    let r = await call(hr, "PUT", `/api/payroll/structures/${encodeURIComponent(e)}`, structure(gross)); if (r.s !== 200) throw new Error(`salary ${e}: ${r.s} ${JSON.stringify(r.d)}`);
    r = await call(hr, "PUT", `/api/payroll/bank/${encodeURIComponent(e)}`, { holder: NAMES[e], bankName: "HDFC Bank", ifsc: "HDFC0001234", account: ACCT[e], accountConfirm: ACCT[e] }); if (r.s !== 200) throw new Error(`bank ${e}: ${r.s} ${JSON.stringify(r.d)}`);
  }

  // ---- the request ----
  let r = await call(a, "GET", "/api/loans/mine");
  ok("the form's details come from the employee record", r.s === 200 && r.d.profile.empNo === "L/1" && r.d.profile.name === "Asha Loan" && r.d.profile.dept === "Engineering" && r.d.profile.title === "Engineer", JSON.stringify(r.d));
  ok("a bad amount or months or a missing reason is refused (400)", (await call(a, "POST", "/api/loans", { amount: "-5", months: "0", reason: "" })).s === 400);
  r = await call(a, "POST", "/api/loans", { amount: 20000, months: 2, reason: "Medical expenses" });
  ok("Test 1: Asha requests ₹20,000 for 2 months", r.s === 201 && /^LN-\d{4}-\d{4}$/.test(r.d.loanNo), JSON.stringify(r.d));
  const loanA = r.d.id;
  r = await call(a, "GET", "/api/loans/mine");
  ok("it is Pending HR approval with an estimated installment of ₹10,000, and nothing approved yet", r.d.loans[0].status === "pending" && r.d.loans[0].estimatedMonthly === 10000 && r.d.loans[0].approvedAmount === null);
  ok("a second request while one is waiting is refused (409)", (await call(a, "POST", "/api/loans", { amount: 5000, months: 1, reason: "Another" })).s === 409);
  ok("no deduction exists yet: requesting does not start salary deductions", (await db.query("SELECT 1 FROM employee_advances WHERE lower(work_email)=$1", [A])).rowCount === 0);

  // ---- who can see and decide ----
  ok("Test 12: another employee cannot open Asha's loan (404) or the HR list (403)", (await call(b, "GET", `/api/loans/${loanA}`)).s === 404 && (await call(b, "GET", "/api/loans")).s === 403);
  ok("an employee cannot approve or reject anything (403)", (await call(b, "POST", `/api/loans/${loanA}/activate`, { amount: 20000, months: 2, firstMonth: PERIOD, disbursedOn: TODAY, confirmPaid: true })).s === 403 && (await call(b, "POST", `/api/loans/${loanA}/reject`, { reason: "No" })).s === 403);
  r = await call(hr, "POST", "/api/loans", { amount: 15000, months: 3, reason: "HR's own request" });
  const own = r.d.id;
  ok("Test 13: HR cannot approve or reject their own request (403)", (await call(hr, "POST", `/api/loans/${own}/activate`, { amount: 15000, months: 3, firstMonth: PERIOD, disbursedOn: TODAY, confirmPaid: true })).s === 403 && (await call(hr, "POST", `/api/loans/${own}/reject`, { reason: "Nope" })).s === 403);
  await db.query("UPDATE loans SET status='cancelled' WHERE id=$1", [own]);

  // ---- HR sees it and checks the breakdown ----
  r = await call(hr, "GET", "/api/loans?status=pending");
  ok("it appears in HR's list with the dashboard counts", r.s === 200 && r.d.loans.some((l) => l.id === loanA) && r.d.stats.pending >= 1, JSON.stringify(r.d && r.d.stats));
  r = await call(hr, "GET", `/api/loans/${loanA}`);
  ok("HR opens it: employee, reason, months and estimate are there", r.s === 200 && r.d.loan.employee.name === "Asha Loan" && r.d.loan.reason === "Medical expenses" && r.d.loan.requestedMonths === 2 && r.d.loan.estimatedMonthly === 10000);
  r = await call(hr, "GET", `/api/loans/${loanA}/review?amount=20000&months=2&first=${PERIOD}`);
  ok("Test 3: the breakdown is ₹10,000 a month for 2 months, total ₹20,000", r.s === 200 && r.d.plan.monthly === 10000 && r.d.plan.count === 2 && r.d.schedule.length === 2 && r.d.schedule.reduce((n, x) => n + x.amount, 0) === 20000, JSON.stringify(r.d));
  r = await call(hr, "GET", `/api/loans/${loanA}/review?amount=10000&months=3&first=${PERIOD}`);
  ok("an uneven amount: ₹3,333.34, ₹3,333.34 and a last installment of ₹3,333.32", r.d.schedule.map((x) => x.amount).join() === "3333.34,3333.34,3333.32", JSON.stringify(r.d.schedule));
  r = await call(hr, "GET", `/api/loans/${loanA}/review?amount=70000&months=1&first=${PERIOD}`);
  ok("an installment above the salary is blocked with a plain message, never a negative net", r.d.blocked && /salary/.test(r.d.blocked), JSON.stringify(r.d));

  // ---- activation checks, then Test 2 ----
  const ok20 = { amount: 20000, months: 2, firstMonth: PERIOD, disbursedOn: TODAY, remarks: "Approved", confirmPaid: true };
  ok("activating needs the payment confirmation (400)", (await call(hr, "POST", `/api/loans/${loanA}/activate`, { ...ok20, confirmPaid: false })).s === 400);
  ok("an installment above the salary cannot be activated (400)", (await call(hr, "POST", `/api/loans/${loanA}/activate`, { ...ok20, amount: 70000, months: 1 })).s === 400);
  ok("a payment date in the future is refused (400)", (await call(hr, "POST", `/api/loans/${loanA}/activate`, { ...ok20, disbursedOn: month(3) + "-01" })).s === 400);
  ok("still not active after the refused attempts: no deduction exists", (await db.query("SELECT 1 FROM employee_advances WHERE lower(work_email)=$1", [A])).rowCount === 0 && (await call(hr, "GET", `/api/loans/${loanA}`)).d.loan.status === "pending");
  r = await call(hr, "POST", `/api/loans/${loanA}/activate`, ok20);
  ok("Test 2: HR approves the full ₹20,000 and activates it", r.s === 200, JSON.stringify(r.d));
  ok("activating again is refused (409)", (await call(hr, "POST", `/api/loans/${loanA}/activate`, ok20)).s === 409);
  r = await call(a, "GET", `/api/loans/${loanA}`);
  ok("the employee sees it Approved / Active: ₹20,000, ₹10,000 a month, 2 installments, nothing repaid", r.d.loan.status === "active" && r.d.loan.approvedAmount === 20000 && r.d.loan.monthly === 10000 && r.d.loan.outstanding === 20000 && r.d.schedule.length === 2 && r.d.paidCount === 0, JSON.stringify(r.d.loan));
  ok("the history records who approved it", r.d.events.some((e) => /activated/.test(e.action) && e.actor === HR));

  // ---- Test 4/5/6: a changed amount, a rejection ----
  r = await call(b, "POST", "/api/loans", { amount: 50000, months: 2, reason: "House deposit" });
  const loanB = r.d.id;
  r = await call(hr, "POST", `/api/loans/${loanB}/activate`, { amount: 30000, months: 3, firstMonth: PERIOD, disbursedOn: TODAY, confirmPaid: true });
  ok("Test 4/5: HR approves ₹30,000 instead of ₹50,000 over 3 months: the installment is recalculated to ₹10,000", r.s === 200, JSON.stringify(r.d));
  r = await call(b, "GET", `/api/loans/${loanB}`);
  ok("the approved amount, not the requested one, is what counts (₹30,000, ₹10,000 a month, total ₹30,000)", r.d.loan.requestedAmount === 50000 && r.d.loan.approvedAmount === 30000 && r.d.loan.monthly === 10000 && r.d.schedule.reduce((n, x) => n + x.amount, 0) === 30000 && r.d.events.some((e) => /changed amount/.test(e.action)), JSON.stringify(r.d.loan));
  r = await call(b, "POST", "/api/loans", { amount: 8000, months: 2, reason: "Gadget" });
  const loanC = r.d.id;
  ok("a rejection needs a reason (400)", (await call(hr, "POST", `/api/loans/${loanC}/reject`, {})).s === 400);
  ok("Test 6: HR rejects with a reason", (await call(hr, "POST", `/api/loans/${loanC}/reject`, { reason: "Please repay the first loan before another" })).s === 200);
  r = await call(b, "GET", `/api/loans/${loanC}`);
  ok("the employee sees Rejected and the reason, and nothing is deducted for it", r.d.loan.status === "rejected" && /first loan/.test(r.d.loan.rejectionReason) && (await db.query("SELECT 1 FROM employee_advances WHERE loan_id=$1", [loanC])).rowCount === 0);
  ok("a rejected request cannot be activated afterwards (409)", (await call(hr, "POST", `/api/loans/${loanC}/activate`, { ...ok20, amount: 8000, months: 2 })).s === 409);

  // ---- the second loan for a person who owes: shown, and needs a confirmation ----
  r = await call(a, "POST", "/api/loans", { amount: 6000, months: 2, reason: "Second" });
  const loanA2 = r.d.id;
  r = await call(hr, "GET", `/api/loans/${loanA2}`);
  ok("Asha's existing active loan is shown to HR on the new request", r.d.others.some((o) => o.id === loanA && o.status === "active") && r.d.existing.length === 1);
  r = await call(hr, "POST", `/api/loans/${loanA2}/activate`, { amount: 6000, months: 2, firstMonth: PERIOD, disbursedOn: TODAY, confirmPaid: true });
  ok("HR must confirm they saw it before another loan is approved (409)", r.s === 409 && r.d.needsAck);
  await call(hr, "POST", `/api/loans/${loanA2}/reject`, { reason: "Not now" });

  // ---- the payslip, a real approved month, no duplicates ----
  const { buildLines } = await import("../src/payroll/store.js");
  const { payPool, pool } = await import("../src/db.js");
  const lineOf = async (period, email) => (await buildLines(payPool, period)).find((x) => x.email.toLowerCase() === email) || null;
  const slipOf = async (period, email) => { const l = await lineOf(period, email); return l ? l.slip : null; };
  const loanDed = async (period, email) => { const s = await slipOf(period, email); return s ? s.deductions.filter((d) => d.code === "advance") : null; };
  let ded = await loanDed(PERIOD, A);
  ok("Test 7: the payslip has a separate Company Loan Repayment line of ₹10,000, with no manual entry", ded.length === 1 && ded[0].name === "Company Loan Repayment" && ded[0].amount === 10000, JSON.stringify(ded));
  const s1 = (await lineOf(PERIOD, A)).slip.summary;
  ok("it is part of the total deductions and the net salary (gross 60,000, deductions 12,000 = PF 1,800 + PT 200 + loan 10,000, net 48,000)", s1.net === 48000 && s1.totalDeductions === 12000 && s1.otherDeductions === 10000, JSON.stringify(s1));
  ok("recalculating the month gives the same single deduction, never a second one", (await loanDed(PERIOD, A))[0].amount === 10000 && (await loanDed(PERIOD, A)).length === 1);
  ok("the month before the first deduction month has none", (await loanDed(month(-2), A)).length === 0);

  r = await call(hr, "POST", "/api/payroll/runs", { period: PERIOD });
  if (r.s !== 201) throw new Error(`run: ${r.s} ${JSON.stringify(r.d)}`);
  const run = r.d.id;
  await call(hr, "POST", `/api/payroll/runs/${run}/hold`, { action: "only", emails: [A, B, C], reason: "Loan test: only the three test people" });
  for (const act of ["calculate", "generate", "submit"]) await call(hr, "POST", `/api/payroll/runs/${run}/actions/${act}`, act === "submit" ? { note: "Please review" } : undefined);
  r = await call(rev, "POST", `/api/payroll/runs/${run}/actions/approve`, { note: "ok" });
  ok("payroll for the month is generated and approved", r.s === 200, JSON.stringify(r.d));
  await new Promise((ok2) => setTimeout(ok2, 800));
  // The amount is stored encrypted (src/secret-box.js): opened here as the app opens it.
  const rec = await db.query("SELECT r.amount, r.payroll_period, r.recovery_sealed FROM advance_recoveries r JOIN employee_advances a ON a.id = r.advance_id WHERE a.loan_id = $1", [loanA]);
  rec.rows.forEach(openSealedRow);
  ok("Test 8: the first installment is recorded once for that month and reduces the balance", rec.rowCount === 1 && Number(rec.rows[0].amount) === 10000 && rec.rows[0].payroll_period === PERIOD, JSON.stringify(rec.rows));
  r = await call(a, "GET", `/api/loans/${loanA}`);
  ok("outstanding ₹10,000, repaid ₹10,000 (50%), installment 1 paid, 1 remaining, still active", r.d.loan.repaid === 10000 && r.d.loan.outstanding === 10000 && r.d.loan.percent === 50 && r.d.paidCount === 1 && r.d.remainingCount === 1 && r.d.loan.status === "active" && r.d.schedule[0].status === "paid", JSON.stringify([r.d.loan, r.d.schedule]));
  ok("Test 11: after approval, recalculating that month still shows one ₹10,000 deduction", (await loanDed(PERIOD, A))[0].amount === 10000 && (await loanDed(PERIOD, A)).length === 1);
  ok("the next month's installment is ₹10,000", (await loanDed(P2, A))[0].amount === 10000);
  r = await call(hr, "GET", `/api/loans/${loanA2}/review?amount=5000&months=1&first=${PERIOD}`);
  ok("a first deduction month in a month that is already approved is refused", r.d.firstMonthError && /already approved/.test(r.d.firstMonthError), JSON.stringify(r.d));
  const l4 = await call(c, "POST", "/api/loans", { amount: 5000, months: 1, reason: "Test" });
  r = await call(hr, "POST", `/api/loans/${l4.d.id}/activate`, { amount: 5000, months: 1, firstMonth: PERIOD, disbursedOn: TODAY, confirmPaid: true });
  ok("so a loan cannot start in an approved payroll month (400)", r.s === 400 && /already approved/.test(r.d.error), JSON.stringify(r.d));
  await call(hr, "POST", `/api/loans/${l4.d.id}/reject`, { reason: "Test only" });

  // ---- completion (Test 9/10) ----
  const adv = (await db.query("SELECT id FROM employee_advances WHERE loan_id=$1", [loanA])).rows[0].id;
  await db.query("INSERT INTO advance_recoveries (advance_id, amount, recovered_on, note, recorded_by, payroll_period) VALUES ($1,10000,$2,'Deducted in payroll','test',$3)", [adv, `${P2}-28`, P2]);
  const { syncLoans } = await import("../src/loans.js");
  await syncLoans();
  r = await call(a, "GET", `/api/loans/${loanA}`);
  ok("Test 9: the final installment completes the loan: ₹0 outstanding, 100%, a completion date", r.d.loan.status === "completed" && r.d.loan.outstanding === 0 && r.d.loan.percent === 100 && !!r.d.loan.completedOn && r.d.paidCount === 2, JSON.stringify(r.d.loan));
  ok("Test 10: no deduction after completion, in any later month", (await loanDed(P3, A)).length === 0 && (await loanDed(month(4), A)).length === 0);
  ok("the completed loan stays on record for HR and the employee", (await call(hr, "GET", "/api/loans?status=completed")).d.loans.some((l) => l.id === loanA) && (await call(a, "GET", "/api/loans/mine")).d.loans.some((l) => l.id === loanA));

  // ---- rounding: 10,000 over 3 months ----
  const lc = await call(c, "POST", "/api/loans", { amount: 10000, months: 3, reason: "Rounding" });
  r = await call(hr, "POST", `/api/loans/${lc.d.id}/activate`, { amount: 10000, months: 3, firstMonth: P2, disbursedOn: TODAY, confirmPaid: true });
  ok("a ₹10,000 loan over 3 months is activated (₹3,333.34 a month)", r.s === 200, JSON.stringify(r.d));
  const advC = (await db.query("SELECT id FROM employee_advances WHERE loan_id=$1", [lc.d.id])).rows[0].id;
  ok("month 1: ₹3,333.34", (await loanDed(P2, C))[0].amount === 3333.34);
  await db.query("INSERT INTO advance_recoveries (advance_id, amount, recovered_on, note, recorded_by, payroll_period) VALUES ($1,3333.34,$2,'x','test',$3)", [advC, `${P2}-28`, P2]);
  await db.query("INSERT INTO advance_recoveries (advance_id, amount, recovered_on, note, recorded_by, payroll_period) VALUES ($1,3333.34,$2,'x','test',$3)", [advC, `${P3}-28`, P3]);
  ok("month 3: only the remaining ₹3,333.32 is deducted, never more than is owed", (await loanDed(month(2), C))[0].amount === 3333.32);
  await db.query("INSERT INTO advance_recoveries (advance_id, amount, recovered_on, note, recorded_by, payroll_period) VALUES ($1,3333.32,$2,'x','test',$3)", [advC, `${month(2)}-28`, month(2)]);
  await syncLoans();
  ok("then it is completed and nothing more is deducted", (await call(hr, "GET", `/api/loans/${lc.d.id}`)).d.loan.status === "completed" && (await loanDed(month(3), C)).length === 0);

  // ---- HR dashboard (Test 14) ----
  r = await call(hr, "GET", "/api/loans");
  const st = r.d.stats;
  ok("Test 14: HR's dashboard has totals: requests, pending, active, completed, rejected, disbursed, repaid and outstanding", st.total >= 5 && st.active === 1 && st.completed === 2 && st.rejected >= 2 && st.disbursed === 60000 && st.repaid === 40000 && st.outstanding === 20000, JSON.stringify(st));
  r = await call(hr, "GET", "/api/loans?q=L/2");
  ok("HR can filter by employee number, department, status and month", r.d.loans.every((l) => l.employee.empNo === "L/2") && (await call(hr, "GET", "/api/loans?dept=Sales")).d.loans.every((l) => l.employee.dept === "Sales") && (await call(hr, "GET", "/api/loans?status=rejected")).d.loans.every((l) => l.status === "rejected") && (await call(hr, "GET", `/api/loans?month=${Number(TODAY.slice(5, 7))}&year=${TODAY.slice(0, 4)}`)).d.loans.length >= 5);
  r = await call(hr, "GET", `/api/loans/${loanA}`);
  ok("HR opens any loan's full repayment history and event history", r.d.schedule.length === 2 && r.d.events.length >= 2 && r.d.expectedCompletion === month(0));
  ok("HR2 can do what HR can (any HR user may decide someone else's request)", (await call(hr2, "GET", "/api/loans")).s === 200);
} catch (err) { fail++; console.log("ERROR  " + err.stack); }
finally { await wipe().catch(() => {}); await db.end(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
