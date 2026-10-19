import express from "express";
import L from "../../frontend/leave-rules.js";
import { pool } from "./db.js";
import { event } from "./reimbursements.js";
import { notify } from "./notify.js";

/*
 * Monthly payroll. Processing a month creates one line per current employee:
 *   base salary (monthly gross, never changed here) − loss-of-pay deduction for that month + approved reimbursements
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

/** What a run for this month would contain, per person. Used for the preview and for processing. */
async function lines(db, period) {
  const { rows: emps } = await db.query(
    `SELECT work_email, name, emp_no, monthly_gross FROM employees
     WHERE status <> 'offboarded' AND (start_date IS NULL OR start_date <= $1::date + interval '1 month' - interval '1 day')
     ORDER BY name`, [period + "-01"]);
  const { rows: claims } = await db.query(
    "SELECT * FROM reimbursements WHERE status='payroll_pending' AND payroll_period <= $1 ORDER BY id", [period]);
  const { rows: lop } = await db.query(
    "SELECT * FROM leave_requests WHERE status='approved' AND lop_days > 0 AND from_date < $1::date + interval '1 month'", [period + "-01"]);
  const holidays = (await db.query("SELECT day FROM holidays")).rows.map((h) => h.day);
  const byEmail = new Map(emps.map((e) => [e.work_email.toLowerCase(), { ...e, claims: [], lopDays: 0 }]));
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
    const base = num(e.monthly_gross);
    const lopDeduction = base ? L.salaryCut(base, e.lopDays) : 0;
    const reimb = Math.round(e.claims.reduce((n, c) => n + Number(c.amount), 0) * 100) / 100;
    return { email: e.work_email, name: e.name, empNo: e.emp_no, baseSalary: base, lopDays: e.lopDays, lopDeduction,
      reimbursementTotal: reimb, payable: Math.round(((base || 0) - lopDeduction + reimb) * 100) / 100,
      claims: e.claims.map((c) => ({ id: c.id, claimNo: c.claim_no, amount: num(c.amount), category: c.category })) };
  });
}

export const payrollRouter = express.Router();

payrollRouter.get("/runs", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT r.*, count(i.id)::int AS people, coalesce(sum(i.base_salary),0) AS base, coalesce(sum(i.lop_deduction),0) AS lop,
       coalesce(sum(i.reimbursement_total),0) AS reimb, coalesce(sum(i.payable),0) AS payable
     FROM payroll_runs r LEFT JOIN payroll_items i ON i.run_id=r.id GROUP BY r.id ORDER BY r.period DESC`);
  res.json(rows.map((r) => ({ id: r.id, period: r.period, status: r.status, processedAt: r.processed_at, processedBy: r.processed_by,
    paidAt: r.paid_at, paidBy: r.paid_by, people: r.people, baseTotal: num(r.base), lopTotal: num(r.lop),
    reimbursementTotal: num(r.reimb), payableTotal: num(r.payable) })));
}));

// What processing this month would do, without changing anything.
payrollRouter.get("/preview", wrap(async (req, res) => {
  const period = String(req.query.period || "");
  if (!PERIOD.test(period)) return res.status(400).json({ error: "Pick a month." });
  const { rows } = await pool.query("SELECT id, status FROM payroll_runs WHERE period=$1", [period]);
  const ls = await lines(pool, period);
  res.json({ period, existing: rows[0] || null, lines: ls,
    totals: { people: ls.length, withSalary: ls.filter((l) => l.baseSalary).length,
      reimbursementTotal: ls.reduce((n, l) => n + l.reimbursementTotal, 0), claims: ls.reduce((n, l) => n + l.claims.length, 0),
      lopTotal: ls.reduce((n, l) => n + l.lopDeduction, 0), payableTotal: ls.reduce((n, l) => n + l.payable, 0) } });
}));

payrollRouter.get("/runs/:id", wrap(async (req, res) => {
  const { rows: run } = await pool.query("SELECT * FROM payroll_runs WHERE id=$1", [Number(req.params.id) || 0]);
  if (!run[0]) return res.status(404).json({ error: "Payroll run not found." });
  const { rows: items } = await pool.query(
    `SELECT i.*, e.name, e.emp_no FROM payroll_items i LEFT JOIN employees e ON lower(e.work_email)=lower(i.work_email)
     WHERE run_id=$1 ORDER BY e.name`, [run[0].id]);
  const { rows: claims } = await pool.query(
    "SELECT id, claim_no, work_email, amount, category, status FROM reimbursements WHERE payroll_run_id=$1 ORDER BY id", [run[0].id]);
  res.json({ run: { id: run[0].id, period: run[0].period, status: run[0].status, processedAt: run[0].processed_at, processedBy: run[0].processed_by, paidAt: run[0].paid_at, paidBy: run[0].paid_by },
    items: items.map((i) => ({ email: i.work_email, name: i.name || i.work_email, empNo: i.emp_no, baseSalary: num(i.base_salary), lopDays: num(i.lop_days),
      lopDeduction: num(i.lop_deduction), reimbursementTotal: num(i.reimbursement_total), payable: num(i.payable),
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
    ({ rows: [run] } = await client.query("INSERT INTO payroll_runs (period, status, processed_by) VALUES ($1,'processed',$2) RETURNING *", [period, req.user.email]));
    for (const l of ls) {
      await client.query(
        `INSERT INTO payroll_items (run_id, work_email, base_salary, lop_days, lop_deduction, reimbursement_total, payable) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [run.id, l.email, l.baseSalary, l.lopDays, l.lopDeduction, l.reimbursementTotal, l.payable]);
      for (const c of l.claims) {
        const { rows: [claim] } = await client.query(
          "UPDATE reimbursements SET status='in_payroll', payroll_run_id=$2, updated_at=now() WHERE id=$1 AND status='payroll_pending' RETURNING *", [c.id, run.id]);
        if (!claim) continue;
        await event(client, claim, { actor: req.user.email, kind: `Included in ${monthName(period)} payroll`, status: "in_payroll", note: `payroll run #${run.id}` });
        included.push(claim);
      }
    }
    await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1, NULL)",
      [`Payroll processed for ${monthName(period)} by ${req.user.email}: ${ls.length} people, ${included.length} reimbursements`]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  for (const c of included)
    await notify(c.work_email, { title: `Your approved reimbursement of ${inr(c.amount)} has been included in your upcoming payroll.`, body: `${c.claim_no} · ${monthName(period)}`, link: `claim:${c.id}`,
      email: { subject: `Reimbursement included in payroll: ${c.claim_no}`, body: `Your approved reimbursement of ${inr(c.amount)} (${c.claim_no}) has been included in your ${monthName(period)} payroll.` } });
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
      "UPDATE reimbursements SET status='paid', paid_at=now(), paid_amount=amount, updated_at=now() WHERE payroll_run_id=$1 AND status='in_payroll' RETURNING *", [run.id]);
    for (const c of rows) await event(client, c, { actor: req.user.email, kind: "Paid", status: "paid", note: `${inr(c.amount)} with ${monthName(run.period)} payroll (run #${run.id})` });
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
    await notify(c.work_email, { title: `Your reimbursement of ${inr(c.amount)} has been paid.`, body: `${c.claim_no} · ${monthName(run.period)} payroll`, link: `claim:${c.id}`,
      email: { subject: `Reimbursement paid: ${c.claim_no}`, body: `Your reimbursement of ${inr(c.amount)} (${c.claim_no}) has been paid with the ${monthName(run.period)} payroll.` } });
  res.json({ ok: true, paid: paid.length });
}));
