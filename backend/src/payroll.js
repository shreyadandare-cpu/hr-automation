import express from "express";
import L from "../../frontend/leave-rules.cjs";
import { pool } from "./db.js";
import { event } from "./reimbursements.js";
import { notify } from "./notify.js";
import { buildSlip, cleanStructure, grossOf, structureFromRow } from "./payroll-calc.js";

/*
 * Monthly payroll. Processing a month creates one line per current employee:
 *   base salary (monthly gross, never changed here) − loss-of-pay deduction for that month + approved reimbursements
 * With a salary breakdown set, the line also stores the full payslip (earnings, PF, professional tax, TDS) and its net pay
 * is what is paid. Without one, the payslip is marked incomplete and is not issued.
 * Automation 5: every approved reimbursement waiting for this month (or an earlier one) is attached to the line and
 *               moves Payroll pending -> Included in payroll.
 * Automation 6: marking the run paid moves those claims to Paid, with the payment date, run and amount stored.
 * HR only (mounted behind requireHr).
 */
const num = (v) => (v === null || v === undefined ? null : Number(v));
const inr = (n) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const monthName = (p) => new Date(p + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });

/** What a run for this month would contain, per person. Used for the preview and for processing.
 *  runId: an existing run being rebuilt, so the claims already attached to it are counted again. */
export async function lines(db, period, runId = null) {
  const { rows: emps } = await db.query(
    `SELECT work_email, name, emp_no, monthly_gross, title, dept, start_date, last_day, pan_masked, acct_masked, pf_number FROM employees
     WHERE status <> 'offboarded' AND (start_date IS NULL OR start_date <= $1::date + interval '1 month' - interval '1 day')
     ORDER BY name`, [period + "-01"]);
  const { rows: claims } = await db.query(
    `SELECT * FROM reimbursements WHERE (status='payroll_pending' AND payroll_period <= $1) OR (status='in_payroll' AND payroll_run_id=$2) ORDER BY id`,
    [period, runId]);
  const { rows: lop } = await db.query(
    "SELECT * FROM leave_requests WHERE status='approved' AND lop_days > 0 AND from_date < $1::date + interval '1 month'", [period + "-01"]);
  const holidays = (await db.query("SELECT day FROM holidays")).rows.map((h) => h.day);
  const structures = new Map((await structuresFor(db, period)).map((x) => [x.work_email.toLowerCase(), toStructure(x)]));
  const byEmail = new Map(emps.map((e) => [e.work_email.toLowerCase(), { ...e, onRoll: true, claims: [], lopDays: 0 }]));
  for (const c of claims) {
    const k = c.work_email.toLowerCase();
    if (!byEmail.has(k)) byEmail.set(k, { work_email: c.work_email, name: c.work_email, monthly_gross: null, claims: [], lopDays: 0 });
    byEmail.get(k).claims.push(c);
  }
  for (const r of lop) {
    const k = r.work_email.toLowerCase();
    if (!byEmail.has(k)) continue;
    const d = L.lopByMonth({ from: r.from_date, to: r.to_date, half: r.half, lopDays: num(r.lop_days) }, holidays)[period] || 0;
    byEmail.get(k).lopDays += d;
  }
  return [...byEmail.values()].map((e) => {
    const structure = structures.get(e.work_email.toLowerCase()) || null;
    const base = structure ? grossOf(structure.earnings) : num(e.monthly_gross);
    const lopDeduction = base ? L.salaryCut(base, e.lopDays) : 0;
    const pay = (c) => Number(c.approved_amount ?? c.amount);   // only what HR approved is paid
    const reimb = Math.round(e.claims.reduce((n, c) => n + pay(c), 0) * 100) / 100;
    const slip = buildSlip({ period, structure, start: e.start_date, lastDay: e.last_day, lopDays: e.lopDays, lopDeduction, reimbursement: reimb,
      employee: { name: e.name, empNo: e.emp_no, title: e.title, dept: e.dept, start: e.start_date, pan: e.pan_masked, pfNumber: e.pf_number,
        paymentMode: e.acct_masked ? "Bank Transfer" : null } });
    const complete = !slip.incomplete.length;
    return { email: e.work_email, name: e.name, empNo: e.emp_no, onRoll: !!e.onRoll, baseSalary: base, lopDays: e.lopDays, lopDeduction,
      reimbursementTotal: reimb, payable: complete ? slip.totals.net : Math.round(((base || 0) - lopDeduction + reimb) * 100) / 100,
      hasStructure: !!structure, tdsApplicable: slip.tds.applicable, tds: slip.tds.amount,
      statutory: complete ? Math.round((slip.totals.contributions + slip.totals.deductions - lopDeduction) * 100) / 100 : 0,
      incomplete: slip.incomplete, slip,
      claims: e.claims.map((c) => ({ id: c.id, claimNo: c.claim_no, amount: pay(c), requestedAmount: num(c.requested_amount ?? c.amount), category: c.category })) };
  });
}

/** Each person's salary breakdown in force for the month: the latest one starting on or before it. */
const structuresFor = (db, period, email = null) => db.query(
  `SELECT DISTINCT ON (lower(work_email)) * FROM salary_structures WHERE effective_from <= $1 ${email ? "AND lower(work_email)=$2" : ""}
   ORDER BY lower(work_email), effective_from DESC`, email ? [period, email] : [period]).then((r) => r.rows);
const toStructure = (x) => ({ id: x.id, effectiveFrom: x.effective_from, earnings: x.earnings, pfEmployee: num(x.pf_employee), professionalTax: num(x.professional_tax),
  otherDeductions: x.other_deductions, tdsMonthly: num(x.tds_monthly), updatedBy: x.updated_by, updatedAt: x.updated_at });

/** Saves one person's line in a run (replacing a draft line) and attaches their waiting claims. Returns the claims newly attached. */
export async function saveLine(client, run, l, actor) {
  await client.query(
    `INSERT INTO payroll_items (run_id, work_email, base_salary, lop_days, lop_deduction, reimbursement_total, payable, slip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (run_id, lower(work_email)) DO UPDATE SET base_salary=EXCLUDED.base_salary, lop_days=EXCLUDED.lop_days, lop_deduction=EXCLUDED.lop_deduction,
       reimbursement_total=EXCLUDED.reimbursement_total, payable=EXCLUDED.payable, slip=EXCLUDED.slip`,
    [run.id, l.email, l.baseSalary, l.lopDays, l.lopDeduction, l.reimbursementTotal, l.payable, JSON.stringify(l.slip)]);
  const included = [];
  for (const c of l.claims) {
    const { rows: [claim] } = await client.query(
      "UPDATE reimbursements SET status='in_payroll', payroll_run_id=$2, updated_at=now() WHERE id=$1 AND status='payroll_pending' RETURNING *", [c.id, run.id]);
    if (!claim) continue;
    await event(client, claim, { actor, kind: `Included in ${monthName(run.period)} payroll`, status: "in_payroll", note: `payroll run #${run.id}` });
    included.push(claim);
  }
  return included;
}

/** Tells each person their reimbursement is now part of the month's payroll. */
export async function tellIncluded(included, period) {
  for (const c of included)
    await notify(c.work_email, { title: `Your approved reimbursement of ${inr(c.approved_amount ?? c.amount)} has been included in your upcoming payroll.`, body: `${c.claim_no} · ${monthName(period)}`, link: `claim:${c.id}`,
      email: { subject: `Reimbursement included in payroll: ${c.claim_no}`, body: `Your approved reimbursement of ${inr(c.approved_amount ?? c.amount)} (${c.claim_no}) has been included in your ${monthName(period)} payroll.` } });
}

/** Saves a salary breakdown from a month on (the same month again replaces it) and keeps monthly_gross and the PF number in step. */
async function saveStructure(client, emp, email, v, actor) {
  await client.query(
    `INSERT INTO salary_structures (work_email, effective_from, earnings, pf_employee, professional_tax, other_deductions, tds_monthly, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (lower(work_email), effective_from) DO UPDATE SET earnings=EXCLUDED.earnings, pf_employee=EXCLUDED.pf_employee,
       professional_tax=EXCLUDED.professional_tax, other_deductions=EXCLUDED.other_deductions, tds_monthly=EXCLUDED.tds_monthly,
       updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [email, v.effectiveFrom, JSON.stringify(v.earnings), v.pfEmployee, v.professionalTax, JSON.stringify(v.otherDeductions), v.tdsMonthly, actor]);
  // The monthly gross (used for loss-of-pay cuts and exit settlements) follows the breakdown now in force.
  const [current] = await structuresFor(client, new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7), email);
  await client.query("UPDATE employees SET pf_number=CASE WHEN $4 THEN $2 ELSE pf_number END, monthly_gross=coalesce($3, monthly_gross) WHERE id=$1",
    [emp.id, v.pfNumber ?? null, current ? grossOf(current.earnings) : null, v.pfNumber !== undefined]);
  await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Salary breakdown from ${monthName(v.effectiveFrom)} saved by ${actor}`, email]);
}

export const payrollRouter = express.Router();

// One person's salary breakdowns, newest first, and their PF number.
payrollRouter.get("/structures/:email", wrap(async (req, res) => {
  const email = String(req.params.email).toLowerCase();
  const { rows: [emp] } = await pool.query("SELECT name, pf_number, monthly_gross FROM employees WHERE lower(work_email)=$1", [email]);
  if (!emp) return res.status(404).json({ error: "Employee not found." });
  const { rows } = await pool.query("SELECT * FROM salary_structures WHERE lower(work_email)=$1 ORDER BY effective_from DESC", [email]);
  res.json({ name: emp.name, pfNumber: emp.pf_number, monthlyGross: num(emp.monthly_gross), structures: rows.map(toStructure) });
}));

// Save the breakdown that applies from a month on. Saving the same month again replaces it. Months already processed keep their payslips.
payrollRouter.put("/structures/:email", wrap(async (req, res) => {
  const email = String(req.params.email).toLowerCase();
  const { errors, value: v } = cleanStructure(req.body || {});
  if (errors) return res.status(400).json({ error: "Please check the highlighted fields.", errors });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [emp] } = await client.query("SELECT id, name FROM employees WHERE lower(work_email)=$1 FOR UPDATE", [email]);
    if (!emp) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Employee not found." }); }
    await saveStructure(client, emp, email, v, req.user.email);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  res.json({ ok: true });
}));

// Salary breakdowns for many people at once, from HR's spreadsheet (one row per person, read as CSV in the browser).
// All or nothing: if any row has a problem nothing is saved, and each problem is listed with its row number.
payrollRouter.post("/structures/import", wrap(async (req, res) => {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
  if (!rows || !rows.length) return res.status(400).json({ error: "The file has no rows to import." });
  if (rows.length > 1000) return res.status(400).json({ error: "Import at most 1,000 rows at a time." });
  const client = await pool.connect();
  const problems = [], ok = [], seen = new Set();
  try {
    await client.query("BEGIN");
    for (const [i, row] of rows.entries()) {
      const n = i + 2;   // row 1 is the header
      const { email, body } = structureFromRow(row);
      if (!email) { problems.push({ row: n, error: "The email column is empty." }); continue; }
      const key = `${email}|${body.effectiveFrom}`;
      if (seen.has(key)) { problems.push({ row: n, email, error: "This person and month appear twice in the file." }); continue; }
      seen.add(key);
      const { rows: [emp] } = await client.query("SELECT id, name FROM employees WHERE lower(work_email)=$1 FOR UPDATE", [email]);
      if (!emp) { problems.push({ row: n, email, error: "No employee with this email." }); continue; }
      const { errors, value } = cleanStructure(body);
      if (errors) {
        const said = Object.entries(errors).map(([k, m]) => { const [list, i] = k.split("."); return i !== undefined && body[list] && body[list][i] ? `${body[list][i].name}: ${m}` : m; });
        problems.push({ row: n, email, error: said.join(" ") });
        continue;
      }
      ok.push({ emp, email, value });
    }
    if (problems.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `Nothing was saved. Fix ${problems.length === 1 ? "this row" : `these ${problems.length} rows`} and upload again.`, problems });
    }
    for (const x of ok) await saveStructure(client, x.emp, x.email, x.value, req.user.email);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  res.json({ ok: true, saved: ok.length });
}));

payrollRouter.get("/runs", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT r.*, count(i.id)::int AS people, coalesce(sum(i.base_salary),0) AS base, coalesce(sum(i.lop_deduction),0) AS lop,
       coalesce(sum(i.reimbursement_total),0) AS reimb, coalesce(sum(i.payable),0) AS payable
     FROM payroll_runs r LEFT JOIN payroll_items i ON i.run_id=r.id GROUP BY r.id ORDER BY r.period DESC`);
  res.json(rows.map((r) => ({ id: r.id, period: r.period, status: r.status, processedAt: r.processed_at, processedBy: r.processed_by,
    paidAt: r.paid_at, paidBy: r.paid_by, publishAt: r.publish_at, publishedAt: r.published_at, people: r.people, baseTotal: num(r.base), lopTotal: num(r.lop),
    reimbursementTotal: num(r.reimb), payableTotal: num(r.payable) })));
}));

// What processing this month would do, without changing anything.
payrollRouter.get("/preview", wrap(async (req, res) => {
  const period = String(req.query.period || "");
  if (!PERIOD.test(period)) return res.status(400).json({ error: "Pick a month." });
  const { rows } = await pool.query("SELECT id, status, publish_at, published_at FROM payroll_runs WHERE period=$1", [period]);
  const ls = await lines(pool, period);
  res.json({ period, existing: rows[0] ? { id: rows[0].id, status: rows[0].status, publishAt: rows[0].publish_at, publishedAt: rows[0].published_at } : null, lines: ls,
    totals: { people: ls.length, withSalary: ls.filter((l) => l.baseSalary).length,
      reimbursementTotal: ls.reduce((n, l) => n + l.reimbursementTotal, 0), claims: ls.reduce((n, l) => n + l.claims.length, 0),
      lopTotal: ls.reduce((n, l) => n + l.lopDeduction, 0), payableTotal: ls.reduce((n, l) => n + l.payable, 0),
      incomplete: ls.filter((l) => l.incomplete.length && (l.baseSalary || l.hasStructure)).length } });
}));

payrollRouter.get("/runs/:id", wrap(async (req, res) => {
  const { rows: run } = await pool.query("SELECT * FROM payroll_runs WHERE id=$1", [Number(req.params.id) || 0]);
  if (!run[0]) return res.status(404).json({ error: "Payroll run not found." });
  const { rows: items } = await pool.query(
    `SELECT i.*, e.name, e.emp_no FROM payroll_items i LEFT JOIN employees e ON lower(e.work_email)=lower(i.work_email)
     WHERE run_id=$1 ORDER BY e.name`, [run[0].id]);
  const { rows: claims } = await pool.query(
    "SELECT id, claim_no, work_email, coalesce(approved_amount, amount) AS amount, category, status FROM reimbursements WHERE payroll_run_id=$1 ORDER BY id", [run[0].id]);
  res.json({ run: { id: run[0].id, period: run[0].period, status: run[0].status, processedAt: run[0].processed_at, processedBy: run[0].processed_by, paidAt: run[0].paid_at, paidBy: run[0].paid_by,
      publishAt: run[0].publish_at, publishedAt: run[0].published_at },
    items: items.map((i) => ({ email: i.work_email, name: i.name || i.work_email, empNo: i.emp_no, baseSalary: num(i.base_salary), lopDays: num(i.lop_days),
      lopDeduction: num(i.lop_deduction), reimbursementTotal: num(i.reimbursement_total), payable: num(i.payable),
      hasStructure: !!(i.slip && i.slip.earnings.length), tdsApplicable: !!(i.slip && i.slip.tds.applicable), tds: i.slip ? i.slip.tds.amount : 0,
      statutory: i.slip && !i.slip.incomplete.length ? Math.round((i.slip.totals.contributions + i.slip.totals.deductions - num(i.lop_deduction)) * 100) / 100 : 0,
      incomplete: i.slip ? i.slip.incomplete : [],
      claims: claims.filter((c) => c.work_email.toLowerCase() === i.work_email.toLowerCase()).map((c) => ({ id: c.id, claimNo: c.claim_no, amount: num(c.amount), status: c.status })) })) });
}));

// Automation 5: process a month's payroll and attach the approved reimbursements waiting for it.
payrollRouter.post("/runs", wrap(async (req, res) => {
  const period = String((req.body && req.body.period) || "");
  if (!PERIOD.test(period)) return res.status(400).json({ error: "Pick a month." });
  const client = await pool.connect();
  let run, included = [];
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE payroll_runs IN SHARE ROW EXCLUSIVE MODE");   // one processing at a time
    const { rowCount } = await client.query("SELECT 1 FROM payroll_runs WHERE period=$1", [period]);
    if (rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ error: `Payroll for ${monthName(period)} has already been processed.` }); }
    const ls = await lines(client, period);
    // Processed by hand: the payslips are published at once.
    ({ rows: [run] } = await client.query("INSERT INTO payroll_runs (period, status, processed_by, published_at) VALUES ($1,'processed',$2,now()) RETURNING *", [period, req.user.email]));
    for (const l of ls) included.push(...await saveLine(client, run, l, req.user.email));
    await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1, NULL)",
      [`Payroll processed for ${monthName(period)} by ${req.user.email}: ${ls.length} people, ${included.length} reimbursements`]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  await tellIncluded(included, period);
  res.status(201).json({ id: run.id, included: included.length });
}));

// Automation 6: the run is paid, so its reimbursements are paid too.
payrollRouter.post("/runs/:id/pay", wrap(async (req, res) => {
  const client = await pool.connect();
  let run, paid = [];
  try {
    await client.query("BEGIN");
    ({ rows: [run] } = await client.query("SELECT * FROM payroll_runs WHERE id=$1 FOR UPDATE", [Number(req.params.id) || 0]));
    if (!run) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Payroll run not found." }); }
    if (run.status === "paid") { await client.query("ROLLBACK"); return res.status(409).json({ error: "This payroll is already marked as paid." }); }
    await client.query("UPDATE payroll_runs SET status='paid', paid_at=now(), paid_by=$2 WHERE id=$1", [run.id, req.user.email]);
    const { rows } = await client.query(
      "UPDATE reimbursements SET status='paid', paid_at=now(), paid_amount=coalesce(approved_amount, amount), updated_at=now() WHERE payroll_run_id=$1 AND status='in_payroll' RETURNING *", [run.id]);
    for (const c of rows) await event(client, c, { actor: req.user.email, kind: "Paid", status: "paid", note: `${inr(c.paid_amount)} with ${monthName(run.period)} payroll (run #${run.id})` });
    await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1, NULL)",
      [`Payroll for ${monthName(run.period)} marked as paid by ${req.user.email}: ${rows.length} reimbursements paid`]);
    await client.query("COMMIT");
    paid = rows;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  for (const c of paid)
    await notify(c.work_email, { title: `Your reimbursement of ${inr(c.paid_amount)} has been paid.`, body: `${c.claim_no} · ${monthName(run.period)} payroll`, link: `claim:${c.id}`,
      email: { subject: `Reimbursement paid: ${c.claim_no}`, body: `Your reimbursement of ${inr(c.paid_amount)} (${c.claim_no}) has been paid with the ${monthName(run.period)} payroll.` } });
  res.json({ ok: true, paid: paid.length });
}));
