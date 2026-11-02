import express from "express";
import L from "../../frontend/leave-rules.cjs";
import { pool } from "./db.js";
import { requireHr } from "./auth.js";
import { payWindow } from "./payroll-calc.js";

/*
 * Offboarding financial clearance: what the company still owes the leaver and what it must recover, worked out from the
 * records already in the app. It is not a finance module: nothing here pays anyone; it is the final-settlement check.
 *
 *   Final salary   = salary for the days worked in the exit month (monthly gross from the employee record)
 *                    + unused casual leave paid out - loss of pay in that month (the existing leave settlement)
 *   Reimbursements = claims approved but not yet paid (approved, payroll_pending, in_payroll). The company owes these,
 *                    so they are ADDED to the final payout, never deducted. Claims still waiting for a decision are
 *                    listed for HR to decide; paid, rejected and draft claims are left out.
 *   Recovery       = what is still outstanding on the person's advances (amount - recoveries so far).
 *   Net salary     = final salary - recovery;  final payout = net salary + reimbursements payable.
 *
 * Exits on the 26th to 30th of a month must have the clearance checked (MONTH_END_WINDOW); the same calculation is used
 * for every other date too. Amounts always come from the database: nothing the browser sends is used as a figure.
 */
export const MONTH_END_WINDOW = [26, 30];
export const inMonthEndWindow = (day) => { const d = Number(String(day || "").slice(8, 10)); return d >= MONTH_END_WINDOW[0] && d <= MONTH_END_WINDOW[1]; };
const n = (v) => (v === null || v === undefined ? null : Number(v));
export const money = (v) => Math.round(Number(v || 0) * 100) / 100;
export const inr = (v) => "₹" + Number(v).toLocaleString("en-IN", { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 });

const PAYABLE = { approved: "Approved, not paid yet", payroll_pending: "Waiting for payroll", in_payroll: "In a payroll run" };
const AWAITING = { submitted: "Submitted", under_review: "Under review", resubmitted: "Resubmitted", changes_requested: "Changes requested" };

/** The leave part of the final settlement (unused casual leave paid out, loss of pay in the exit month). */
export async function leaveSettlement(db, email, lastDay) {
  const lc = email.toLowerCase();
  // One after another: this often runs on a single transaction client, which can't take parallel queries.
  const emp = await db.query("SELECT start_date, casual_opening, monthly_gross FROM employees WHERE lower(work_email)=$1", [lc]);
  const reqs = await db.query("SELECT * FROM leave_requests WHERE lower(work_email)=$1", [lc]);
  const comps = await db.query("SELECT * FROM comp_off_credits WHERE lower(work_email)=$1", [lc]);
  const hols = await db.query("SELECT day FROM holidays");
  const e = emp.rows[0] || {};
  return L.exitSettlement({
    emp: { start: e.start_date, casualOpening: n(e.casual_opening) || 0 },
    lastDay,
    requests: reqs.rows.map((r) => ({ type: r.type, from: r.from_date, to: r.to_date, half: r.half, status: r.status,
      days: n(r.days), paidDays: n(r.paid_days), lopDays: n(r.lop_days) })),
    compOffs: comps.rows.map((c) => ({ workedOn: c.worked_on, days: n(c.days), status: c.status })),
    monthlyGross: n(e.monthly_gross),
    holidays: hols.rows.map((h) => h.day),
  });
}

/** Advances with what has been recovered of each. */
export async function advancesOf(db, email) {
  const { rows } = await db.query(
    `SELECT a.*, COALESCE((SELECT sum(r.amount) FROM advance_recoveries r WHERE r.advance_id = a.id), 0) AS recovered
     FROM employee_advances a WHERE lower(a.work_email)=$1 ORDER BY a.advance_date, a.id`, [email.toLowerCase()]);
  return rows.map((a) => {
    const amount = money(a.amount), recovered = money(a.recovered), outstanding = money(amount - recovered);
    return { id: a.id, date: a.advance_date, reason: a.reason, amount, recovered, outstanding,
      status: outstanding <= 0 ? "Fully recovered" : recovered > 0 ? "Partially recovered" : "Outstanding", createdBy: a.created_by };
  });
}

/** The person's reimbursement claims, sorted into owed to them, waiting for a decision, and left out. */
export async function reimbursementsOf(db, email) {
  const { rows } = await db.query(
    `SELECT id, claim_no, expense_date, description, vendor, category, amount, approved_amount, status
     FROM reimbursements WHERE lower(work_email)=$1 ORDER BY expense_date NULLS LAST, id`, [email.toLowerCase()]);
  const row = (r, amount, label) => ({ id: r.id, claimNo: r.claim_no, date: r.expense_date, description: r.description || r.vendor || r.category || "Expense claim",
    amount: money(amount), status: r.status, statusLabel: label });
  const payable = rows.filter((r) => PAYABLE[r.status]).map((r) => row(r, r.approved_amount ?? r.amount, PAYABLE[r.status]));
  const awaiting = rows.filter((r) => AWAITING[r.status]).map((r) => row(r, r.amount, AWAITING[r.status]));
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    payable, awaiting,
    payableTotal: money(payable.reduce((t, r) => t + r.amount, 0)),
    awaitingTotal: money(awaiting.reduce((t, r) => t + r.amount, 0)),
    leftOut: { paid: count("paid"), rejected: count("rejected"), drafts: count("draft") },
  };
}

/** Salary for the exit month: the days worked, plus or minus the leave settlement. Null amounts when no salary is set. */
export async function finalSalaryOf(db, email, lastDay) {
  const { rows } = await db.query("SELECT start_date, monthly_gross FROM employees WHERE lower(work_email)=$1", [email.toLowerCase()]);
  const e = rows[0] || {};
  const s = await leaveSettlement(db, email, lastDay);
  const month = lastDay.slice(0, 7), w = payWindow(month, e.start_date, lastDay), gross = n(e.monthly_gross);
  if (!gross) return { month, daysWorked: w.days, daysInMonth: w.total, monthlyGross: null, finalSalary: null, casualLeft: s ? s.casualLeft : 0, lopDays: s ? s.lopDays : 0 };
  const earned = money(gross * (w.total ? w.days / w.total : 0));
  const encashment = money(s ? s.encashment : 0), lopDeduction = money(s ? s.deduction : 0);
  return { month, daysWorked: w.days, daysInMonth: w.total, monthlyGross: gross, earned, casualLeft: s ? s.casualLeft : 0, encashment,
    lopDays: s ? s.lopDays : 0, lopDeduction, finalSalary: money(earned + encashment - lopDeduction) };
}

/** The whole clearance for one person leaving on lastDay. */
export async function computeClearance(db, email, lastDay) {
  const salary = await finalSalaryOf(db, email, lastDay);
  const reimb = await reimbursementsOf(db, email);
  const advances = await advancesOf(db, email);
  const emp = await db.query("SELECT name FROM employees WHERE lower(work_email)=$1", [email.toLowerCase()]);
  const outstanding = advances.filter((a) => a.outstanding > 0);
  const recovery = money(outstanding.reduce((t, a) => t + a.outstanding, 0));
  const net = salary.finalSalary === null ? null : money(salary.finalSalary - recovery);
  return {
    email, name: emp.rows[0] ? emp.rows[0].name : email, exitDate: lastDay,
    monthEndWindow: inMonthEndWindow(lastDay), window: MONTH_END_WINDOW,
    salary,
    reimbursements: reimb,
    advances: { outstanding, settled: advances.filter((a) => a.outstanding <= 0), total: recovery },
    totals: {
      finalSalary: salary.finalSalary, reimbursementsPayable: reimb.payableTotal, advanceOutstanding: recovery, totalRecovery: recovery,
      netSalary: net, finalPayout: net === null ? null : money(net + reimb.payableTotal),
      // Recovery bigger than the final salary: the rest stays outstanding on the advance and must be collected separately.
      shortfall: net !== null && net < 0 ? money(-net) : 0,
    },
    state: recovery > 0 ? "recovery_due" : "clear",
  };
}

export const toRecord = (c) => (!c ? null : {
  id: c.id, exitDate: c.exit_date, finalSalary: n(c.final_salary), reimbursementsPayable: n(c.reimbursements_payable),
  advanceOutstanding: n(c.advance_outstanding), totalRecovery: n(c.total_recovery), netSalary: n(c.net_salary), finalPayout: n(c.final_payout),
  monthEndWindow: c.month_end_window, status: c.status, details: c.details, completedBy: c.completed_by, completedAt: c.completed_at,
});
export const latestClearance = async (db, offboardingId) =>
  toRecord((await db.query("SELECT * FROM offboarding_clearances WHERE offboarding_id=$1 ORDER BY id DESC LIMIT 1", [offboardingId])).rows[0]);

/**
 * Saves HR's confirmation (inside the caller's transaction): the clearance record, the advance recoveries taken from the
 * final salary (oldest advance first, never more than the salary covers) and the audit-log line. Returns the record.
 */
export async function saveClearance(db, o, hrEmail, c) {
  const t = c.totals;
  let room = t.finalSalary === null ? 0 : Math.max(0, t.finalSalary);
  const recovered = [];
  for (const a of c.advances.outstanding) {
    const take = money(Math.min(a.outstanding, room));
    if (take <= 0) break;
    await db.query("INSERT INTO advance_recoveries (advance_id, amount, recovered_on, note, recorded_by, offboarding_id) VALUES ($1,$2,$3,$4,$5,$6)",
      [a.id, take, c.exitDate, "Recovered from the final salary at offboarding", hrEmail, o.id]);
    recovered.push({ advanceId: a.id, reason: a.reason, amount: take });
    room = money(room - take);
  }
  const status = t.totalRecovery > 0 ? "recovery_confirmed" : "cleared";
  const details = {
    salary: c.salary,
    reimbursementsPayable: c.reimbursements.payable, reimbursementsAwaiting: c.reimbursements.awaiting, reimbursementsLeftOut: c.reimbursements.leftOut,
    advancesOutstanding: c.advances.outstanding, recovered, shortfall: t.shortfall,
  };
  const { rows } = await db.query(
    `INSERT INTO offboarding_clearances (offboarding_id, work_email, exit_date, final_salary, reimbursements_payable, advance_outstanding,
       total_recovery, net_salary, final_payout, month_end_window, status, details, completed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [o.id, o.work_email, c.exitDate, t.finalSalary, t.reimbursementsPayable, t.advanceOutstanding, t.totalRecovery, t.netSalary, t.finalPayout,
      c.monthEndWindow, status, details, hrEmail]);
  const fmt = (v) => (v === null ? "not set" : inr(v));
  await db.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [
    `Financial clearance confirmed by ${hrEmail}: exit ${c.exitDate}, final salary ${fmt(t.finalSalary)}, advance recovery ${inr(t.totalRecovery)}, ` +
    `reimbursements payable ${inr(t.reimbursementsPayable)}, net salary ${fmt(t.netSalary)}, final payout ${fmt(t.finalPayout)}` +
    `${t.shortfall ? `, ${inr(t.shortfall)} still to collect` : ""} (${status === "cleared" ? "nothing to recover" : "recovery confirmed"})`, o.work_email]);
  return toRecord(rows[0]);
}

const isoDate = (v) => L.validDate(String(v || "")) ? String(v) : null;
const audit = (db, action, email) => db.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]);

export function clearanceRouter(wrap) {
  const r = express.Router();
  r.use(["/api/offboarding/clearance", "/api/offboarding/:id/clearance", "/api/advances"], requireHr);

  const offboarding = async (req) => (await pool.query("SELECT * FROM offboardings WHERE id=$1", [Number(req.params.id) || 0])).rows[0];
  const employee = async (email) => (await pool.query("SELECT work_email, name FROM employees WHERE lower(work_email)=$1", [String(email || "").toLowerCase()])).rows[0];

  // Before an offboarding exists (the wizard): ?email=&lastDay=
  r.get("/api/offboarding/clearance/preview", wrap(async (req, res) => {
    const emp = await employee(req.query.email), day = isoDate(req.query.lastDay);
    if (!emp) return res.status(404).json({ error: "Employee not found." });
    if (!day) return res.status(400).json({ error: "Enter the last working day." });
    res.json(await computeClearance(pool, emp.work_email, day));
  }));

  r.get("/api/offboarding/:id/clearance", wrap(async (req, res) => {
    const o = await offboarding(req);
    if (!o) return res.status(404).json({ error: "Offboarding not found." });
    res.json({ ...(await computeClearance(pool, o.work_email, o.last_day)), offboardingId: o.id, offboardingStatus: o.status, latest: await latestClearance(pool, o.id) });
  }));
  r.get("/api/offboarding/:id/clearance/reimbursements", wrap(async (req, res) => {
    const o = await offboarding(req);
    if (!o) return res.status(404).json({ error: "Offboarding not found." });
    res.json(await reimbursementsOf(pool, o.work_email));
  }));
  r.get("/api/offboarding/:id/clearance/advances", wrap(async (req, res) => {
    const o = await offboarding(req);
    if (!o) return res.status(404).json({ error: "Offboarding not found." });
    res.json(await advancesOf(pool, o.work_email));
  }));
  r.get("/api/offboarding/:id/clearance/history", wrap(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM offboarding_clearances WHERE offboarding_id=$1 ORDER BY id DESC", [Number(req.params.id) || 0]);
    res.json(rows.map(toRecord));
  }));

  /* Advances: HR records money given ahead of time and what has been recovered. */
  r.get("/api/advances", wrap(async (req, res) => {
    const emp = await employee(req.query.email);
    if (!emp) return res.status(404).json({ error: "Employee not found." });
    res.json(await advancesOf(pool, emp.work_email));
  }));
  r.post("/api/advances", wrap(async (req, res) => {
    const b = req.body || {}, errors = {};
    const emp = await employee(b.email);
    if (!emp) errors.email = "Pick the employee.";
    const day = isoDate(b.date), today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    if (!day) errors.date = "Enter the date the advance was paid.";
    else if (day > today) errors.date = "The date can't be in the future.";
    const reason = String(b.reason || "").trim();
    if (!reason) errors.reason = "Say what the advance was for.";
    else if (reason.length > 200) errors.reason = "Keep the reason under 200 characters.";
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount <= 0) errors.amount = "Enter an amount above zero.";
    else if (amount > 10000000 || money(amount) !== amount) errors.amount = "Enter a valid amount in rupees (up to 2 decimals).";
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    await pool.query("INSERT INTO employee_advances (work_email, advance_date, reason, amount, created_by) VALUES ($1,$2,$3,$4,$5)",
      [emp.work_email, day, reason, amount, req.user.email]);
    await audit(pool, `Advance recorded: ${inr(amount)} on ${day} (${reason}) by ${req.user.email}`, emp.work_email);
    res.status(201).json(await advancesOf(pool, emp.work_email));
  }));
  r.post("/api/advances/:id/recoveries", wrap(async (req, res) => {
    const b = req.body || {}, errors = {};
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT * FROM employee_advances WHERE id=$1 FOR UPDATE", [Number(req.params.id) || 0]);
      if (!rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Advance not found." }); }
      const a = (await advancesOf(client, rows[0].work_email)).find((x) => x.id === rows[0].id);
      const amount = Number(b.amount), day = isoDate(b.date);
      if (!Number.isFinite(amount) || amount <= 0 || money(amount) !== amount) errors.amount = "Enter an amount above zero (up to 2 decimals).";
      else if (amount > a.outstanding) errors.amount = `Only ${inr(a.outstanding)} is outstanding on this advance.`;
      if (!day) errors.date = "Enter the date it was recovered.";
      if (String(b.note || "").length > 200) errors.note = "Keep the note under 200 characters.";
      if (Object.keys(errors).length) { await client.query("ROLLBACK"); return res.status(400).json({ errors }); }
      await client.query("INSERT INTO advance_recoveries (advance_id, amount, recovered_on, note, recorded_by) VALUES ($1,$2,$3,$4,$5)",
        [a.id, amount, day, String(b.note || "").trim() || null, req.user.email]);
      await audit(client, `Advance recovery recorded: ${inr(amount)} of "${a.reason}" by ${req.user.email}`, rows[0].work_email);
      await client.query("COMMIT");
      res.status(201).json(await advancesOf(pool, rows[0].work_email));
    } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
  }));
  // A mistaken entry can be removed only while nothing has been recovered against it.
  r.delete("/api/advances/:id", wrap(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM employee_advances WHERE id=$1", [Number(req.params.id) || 0]);
    if (!rows[0]) return res.status(404).json({ error: "Advance not found." });
    const { rowCount } = await pool.query("SELECT 1 FROM advance_recoveries WHERE advance_id=$1", [rows[0].id]);
    if (rowCount) return res.status(409).json({ error: "Part of this advance has been recovered, so it can't be removed." });
    await pool.query("DELETE FROM employee_advances WHERE id=$1", [rows[0].id]);
    await audit(pool, `Advance entry removed: ${inr(rows[0].amount)} (${rows[0].reason}) by ${req.user.email}`, rows[0].work_email);
    res.json(await advancesOf(pool, rows[0].work_email));
  }));

  return r;
}
