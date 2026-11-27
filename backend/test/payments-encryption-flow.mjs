/*
 * Expense claims and budgets with their amounts stored encrypted, end to end, against a LOCAL server and database (never the
 * shared one): an employee files a claim, HR approves part of it, the summary, the monthly totals and the report builder add the
 * amounts up correctly, a budget is requested and approved for less, and the database holds no amount in a plain column, while
 * the app shows every figure. Everything it adds is removed at the end.
 *
 *   PAYROLL_ENCRYPTION_KEY=<the server's> DATABASE_URL=postgresql://localhost:5432/<db> BASE=http://localhost:3100 node test/payments-encryption-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server).
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB) || !/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: a local database and a local server only."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB }), sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const EMP = "test.pay.employee@wohlig.com", HR = "test.pay.approver@wohlig.com";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
const login = async (email, perms = []) => {
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'!no-password-login','employee') ON CONFLICT DO NOTHING", [email]);
  for (const p of perms) await db.query("INSERT INTO access_grants (email, permission, scope, granted_by, note) VALUES ($1,$2,'company','test','payments-flow')", [email, p]);
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
  const ids = (await db.query("SELECT id FROM reimbursements WHERE lower(work_email)=$1", [EMP])).rows.map((r) => r.id);
  for (const t of ["reimbursement_events", "reimbursement_documents", "reimbursement_items"]) await db.query(`DELETE FROM ${t} WHERE reimbursement_id = ANY($1)`, [ids]);
  await db.query("DELETE FROM reimbursements WHERE id = ANY($1)", [ids]);
  const bids = (await db.query("SELECT id FROM budget_requests WHERE lower(work_email)=$1", [EMP])).rows.map((r) => r.id);
  await db.query("DELETE FROM budget_request_events WHERE budget_request_id = ANY($1)", [bids]);
  await db.query("DELETE FROM budget_requests WHERE id = ANY($1)", [bids]);
  await db.query("DELETE FROM notifications WHERE lower(recipient) = ANY($1)", [[EMP, HR]]);
  await db.query("DELETE FROM audit_log WHERE lower(work_email) = ANY($1)", [[EMP, HR]]);
  await db.query("DELETE FROM access_grants WHERE note='payments-flow'");
  await db.query("DELETE FROM sessions WHERE lower(email) = ANY($1)", [[EMP, HR]]);
};

try {
  await wipe();
  await db.query("INSERT INTO employees (name, work_email, title, start_date, status) VALUES ('Test Pay Employee',$1,'Engineer','2024-01-01','active') ON CONFLICT DO NOTHING", [EMP]);
  const e = await login(EMP), hr = await login(HR, ["expenses.approve", "budgets.approve"]);
  const cat = (await db.query("SELECT key FROM reimbursement_categories WHERE active ORDER BY sort LIMIT 1")).rows[0].key;

  // ---- an expense claim ----
  let r = await call(e, "POST", "/api/reimbursements", { items: [
    { category: cat, amount: 450.5, expenseDate: today, description: "Auto to client", noReceipt: true },
    { category: cat, amount: 300, expenseDate: today, description: "Parking", noReceipt: true }] });
  ok("the employee files a claim of two expenses", r.s === 201, JSON.stringify(r.d));
  const id = r.d && r.d.id;
  r = await call(e, "GET", `/api/reimbursements/${id}`);
  const claim = r.d && (r.d.claim || r.d);
  ok("the claim shows its total and each expense", claim && claim.amount === 750.5, JSON.stringify(claim && { amount: claim.amount }));
  r = await call(e, "POST", `/api/reimbursements/${id}/submit`, { declaration: true });
  ok("it is submitted", r.s === 200, JSON.stringify(r.d));
  r = await call(hr, "POST", `/api/reimbursements/${id}/approve`, { approvedAmount: 700, reason: "Parking over the limit" });
  ok("HR approves part of it", r.s === 200, JSON.stringify(r.d));
  r = await call(hr, "GET", `/api/reimbursements/${id}`);
  const after = r.d && (r.d.claim || r.d);
  ok("the claim shows requested, approved and not approved", after && after.requestedAmount === 750.5 && after.approvedAmount === 700 && after.unapprovedAmount === 50.5,
    JSON.stringify(after && { req: after.requestedAmount, appr: after.approvedAmount, un: after.unapprovedAmount }));
  r = await call(hr, "GET", "/api/reimbursements?scope=review");
  const s = r.d && r.d.summary;
  ok("the review summary adds the approved amount to what payroll will pay", s && s.pendingPayrollAmount >= 700, JSON.stringify(s));
  const mine = r.d && r.d.claims && r.d.claims.find((x) => x.id === id);
  ok("the list shows each expense amount", mine && mine.expenses.map((x) => x.amount).sort().join(",") === "300,450.5", JSON.stringify(mine && mine.expenses));
  r = await call(hr, "GET", `/api/reimbursements?scope=review&min=740&max=760`);
  ok("the amount filter finds it", r.d && r.d.claims && r.d.claims.some((x) => x.id === id));
  r = await call(hr, "GET", `/api/reimbursements?scope=review&min=800`);
  ok("and leaves it out above its amount", r.d && r.d.claims && !r.d.claims.some((x) => x.id === id));
  r = await call(hr, "GET", `/api/reimbursements/monthly?period=${after.payrollPeriod}&email=${encodeURIComponent(EMP)}`);
  const p = r.d && r.d.people && r.d.people[0];
  ok("the monthly totals add the approved claim", p && p.approvedTotal === 700 && p.approvedCount === 1, JSON.stringify(r.d));
  r = await call(hr, "POST", "/api/report-builder/run", { dataset: "expenses", columns: ["claimNo", "amount", "status"] });
  const row = r.d && r.d.rows && r.d.rows.find((x) => x[0] === after.claimNo);
  ok("the report builder shows the amount", row && Number(row[1]) === 750.5, JSON.stringify(r.d && r.d.rows && r.d.rows.slice(0, 3)));

  // ---- a budget ----
  r = await call(e, "POST", "/api/budget-requests", { purpose: "Team lunch", category: cat, requestedBudget: 5000, headcount: 8, eventDate: today, description: "Monthly team lunch" });
  ok("the employee requests a budget", r.s === 201, JSON.stringify(r.d));
  const bid = r.d && r.d.id;
  r = await call(hr, "POST", `/api/budget-requests/${bid}/approve`, { approvedBudget: 4000, reason: "Policy cap" });
  ok("HR approves it for less", r.s === 200, JSON.stringify(r.d));
  r = await call(e, "GET", `/api/budget-requests/${bid}`);
  const b = r.d && (r.d.request || r.d);
  ok("the budget shows requested and approved", b && b.requestedBudget === 5000 && b.approvedBudget === 4000, JSON.stringify(b && { req: b.requestedBudget, appr: b.approvedBudget }));

  // ---- what the database holds ----
  const { rows: [c] } = await db.query("SELECT amount, requested_amount, approved_amount, unapproved_amount, eligible_amount, validation::text AS v, reimb_sealed FROM reimbursements WHERE id=$1", [id]);
  ok("the claim's amounts are only encrypted in the database", c.amount === null && c.requested_amount === null && c.approved_amount === null && c.unapproved_amount === null && c.v === "{}" && /^s1:/.test(c.reimb_sealed || ""), JSON.stringify(c));
  const { rows: items } = await db.query("SELECT amount, reimb_item_sealed FROM reimbursement_items WHERE reimbursement_id=$1", [id]);
  ok("so are each expense's", items.length === 2 && items.every((i) => i.amount === null && /^s1:/.test(i.reimb_item_sealed || "")));
  const { rows: ev } = await db.query("SELECT note, reimb_event_sealed FROM reimbursement_events WHERE reimbursement_id=$1", [id]);
  ok("and the history notes", ev.length > 0 && ev.every((x) => x.note === null) && ev.some((x) => /^s1:/.test(x.reimb_event_sealed || "")));
  const { rows: [bb] } = await db.query("SELECT requested_budget, approved_budget, budget_sealed FROM budget_requests WHERE id=$1", [bid]);
  ok("and the budget's", bb.requested_budget === null && bb.approved_budget === null && /^s1:/.test(bb.budget_sealed || ""), JSON.stringify(bb));
  const { rows: texts } = await db.query("SELECT title || ' ' || coalesce(body,'') AS t FROM notifications WHERE lower(recipient) = ANY($1) UNION ALL SELECT action FROM audit_log WHERE lower(work_email) = ANY($1)", [[EMP, HR]]);
  ok("no notice or audit line names an amount", texts.length > 0 && texts.every((x) => !/₹|\b(750|700|450|5,?000|4,?000)\b/.test(x.t)), JSON.stringify(texts.filter((x) => /₹|\d{3}/.test(x.t))));
} catch (err) { fail++; console.log("ERROR  " + err.stack); }
finally {
  await wipe().catch((err) => console.log("cleanup:", err.message));
  await db.query("DELETE FROM employees WHERE lower(work_email)=$1", [EMP]);
  await db.query("DELETE FROM users WHERE lower(email) = ANY($1)", [[EMP, HR]]);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
