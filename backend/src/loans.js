import express from "express";
import { pool, payPool } from "./db.js";
import { canAll } from "./access.js";
import { notify } from "./notify.js";
import { money, plan, addMonths, progress, MAX_AMOUNT, MAX_MONTHS } from "./loans-rules.js";
import { structuresFor } from "./payroll/store.js";
import { payrollChanged } from "./payroll/preview-cache.js";

/*
 * Company loans, inside Expenses. An employee asks (amount, months, reason); HR opens the request and approves the amount asked, approves a different amount, or
 * rejects it; before it goes live HR sees the whole repayment schedule, confirms the money was paid out and activates it. Nothing is deducted before that.
 *
 *   Activate   makes one employee_advances row with the approved amount, the instalment and the first month. Payroll already deducts such an instalment each month
 *              (advanceInstalments in clearance.js), labels it "Company Loan Repayment" on the payslip, never deducts more than is still owed, and records it once per
 *              advance and month when the month is approved (so recalculating a month cannot deduct twice; a month already approved is not touched).
 *   Repaid     when the recoveries reach the approved amount the loan is completed (syncLoans), and payroll stops deducting because nothing is owed.
 *   Who        everyone sees their own loans; loans for everyone need advances.approve for the whole company (HR). Nobody decides their own request.
 * Every step is written to loan_events.
 */
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const me = (req) => req.user.email.toLowerCase();
const isHr = (req) => canAll(req, "advances.approve");
const NO_ACCESS = { error: "You do not have access to this." };
const clip = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const inr = (n) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const istMonth = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
const istDay = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const validDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "") && !isNaN(new Date(v));
const validMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v || "");
const amountOk = (v) => { const n = Number(v); return n > 0 && n <= MAX_AMOUNT && Math.round(n * 100) === n * 100; };
const monthsOk = (v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= MAX_MONTHS;
const monthName = (p) => new Date(`${p}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

const SELECT = `SELECT l.*, e.name, e.emp_no, e.dept, e.title, COALESCE(r.repaid, 0) AS repaid
  FROM loans l LEFT JOIN employees e ON lower(e.work_email) = lower(l.work_email)
  LEFT JOIN (SELECT advance_id, sum(amount) AS repaid FROM advance_recoveries GROUP BY advance_id) r ON r.advance_id = l.advance_id`;

const log = (db, id, actor, action, detail = {}) => db.query("INSERT INTO loan_events (loan_id, actor, action, detail) VALUES ($1,$2,$3,$4)", [id, actor, action, JSON.stringify(detail)]);

async function tx(fn) {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const out = await fn(c); await c.query(out && out.rollback ? "ROLLBACK" : "COMMIT"); return out || {}; }
  catch (err) { await c.query("ROLLBACK").catch(() => {}); throw err; } finally { c.release(); }
}

/** An active loan whose advance has been fully recovered is completed, with the date of the last recovery. Safe to run any time, any number of times. */
export async function syncLoans() {
  const { rows } = await pool.query(
    `UPDATE loans l SET status = 'completed', completed_on = r.last_on
       FROM (SELECT advance_id, sum(amount) AS repaid, max(recovered_on) AS last_on FROM advance_recoveries GROUP BY advance_id) r
      WHERE l.status = 'active' AND r.advance_id = l.advance_id AND r.repaid >= l.approved_amount RETURNING l.id, l.work_email, l.loan_no, l.approved_amount`);
  for (const l of rows) {
    await log(pool, l.id, "system", "Loan completed", { repaid: money(l.approved_amount) });
    await notify(l.work_email, { title: `Your loan ${l.loan_no} is fully repaid.`, body: "No more instalments will be deducted.", link: `/app/loans?open=${l.id}` }).catch(() => {});
  }
  return rows.length;
}

const shape = (l) => {
  const approved = l.approved_amount == null ? null : money(l.approved_amount), live = l.status === "active" || l.status === "completed";
  const repaid = live ? money(l.repaid) : 0, outstanding = live ? Math.max(0, money(approved - repaid)) : 0;
  return { id: l.id, loanNo: l.loan_no, email: l.work_email, employee: { name: l.name || l.work_email, empNo: l.emp_no || "", dept: l.dept || "", title: l.title || "" },
    requestedAmount: money(l.requested_amount), reason: l.reason, requestedMonths: l.requested_months, estimatedMonthly: plan(l.requested_amount, l.requested_months).monthly,
    status: l.status, approvedAmount: approved, months: l.months, monthly: l.monthly_amount == null ? null : money(l.monthly_amount), firstMonth: l.first_month, disbursedOn: l.disbursed_on,
    hrRemarks: l.hr_remarks, rejectionReason: l.rejection_reason, decidedBy: l.decided_by, decidedAt: l.decided_at, createdAt: l.created_at, completedOn: l.completed_on,
    repaid, outstanding, percent: live && approved ? Math.min(100, Math.round((repaid / approved) * 100)) : 0 };
};

/** The checks and the repayment breakdown HR sees before activating: the schedule, the person's salary, what is already being deducted, and anything that blocks or warns. */
async function review(email, amount, months, firstMonth) {
  const p = plan(amount, months), out = { plan: p, schedule: [], gross: null, committed: 0, available: null, blocked: "", warnings: [], existing: [] };
  if (!p.count) return out;
  out.schedule = (validMonth(firstMonth) ? Array.from({ length: p.count }, (_, i) => ({ n: i + 1, month: addMonths(firstMonth, i), amount: i === p.count - 1 ? p.last : p.monthly })) : []);
  const [st, adv, fin] = await Promise.all([
    validMonth(firstMonth) ? structuresFor(payPool, firstMonth, email) : [],
    pool.query(`SELECT a.id, a.reason, a.amount, a.monthly_recovery, a.loan_id, COALESCE((SELECT sum(r.amount) FROM advance_recoveries r WHERE r.advance_id = a.id), 0) AS recovered
                  FROM employee_advances a WHERE lower(a.work_email) = $1`, [email]),
    payPool.query("SELECT max(period) AS p FROM payroll_runs WHERE workflow AND status IN ('approved','bank_ready','paid')").catch(() => ({ rows: [{}] })),
  ]);
  const gross = st[0] ? money((st[0].earnings || []).reduce((n, x) => n + Number(x.amount || 0), 0)) : null;
  out.gross = gross;
  for (const a of adv.rows) {
    const left = money(money(a.amount) - money(a.recovered));
    if (left > 0) { out.existing.push({ id: a.id, kind: a.loan_id ? "loan" : "advance", reason: a.reason, outstanding: left, monthly: a.monthly_recovery == null ? null : money(a.monthly_recovery) }); out.committed += a.monthly_recovery == null ? 0 : Math.min(money(a.monthly_recovery), left); }
  }
  out.committed = money(out.committed);
  if (gross != null) {
    out.available = money(gross - out.committed);
    if (p.monthly > out.available) out.blocked = `The monthly deduction (${inr(p.monthly)}) is more than the salary left after what is already deducted (${inr(out.available)} of ${inr(gross)}). Please choose a longer repayment period or a smaller amount.`;
    else if (p.monthly > gross * 0.5) out.warnings.push(`The monthly deduction (${inr(p.monthly)}) is more than half of the monthly salary (${inr(gross)}).`);
  } else out.warnings.push("No salary is set for this person in payroll yet, so the deduction could not be checked against it.");
  if (validMonth(firstMonth) && fin.rows[0] && fin.rows[0].p && firstMonth <= fin.rows[0].p) {
    out.firstMonthError = `Payroll for ${monthName(fin.rows[0].p)} is already approved and cannot be changed. Please choose ${monthName(addMonths(fin.rows[0].p, 1))} or later as the first deduction month.`;
  }
  return out;
}

export const loansRouter = express.Router();

// The person's own details for the request form, and their loans.
loansRouter.get("/mine", wrap(async (req, res) => {
  await syncLoans();
  const [{ rows: [e] }, { rows }] = await Promise.all([
    pool.query("SELECT name, emp_no, dept, title FROM employees WHERE lower(work_email) = $1", [me(req)]),
    pool.query(`${SELECT} WHERE lower(l.work_email) = $1 ORDER BY l.id DESC`, [me(req)])]);
  res.json({ profile: { name: e ? e.name : req.user.email, empNo: e ? e.emp_no || "" : "", dept: e ? e.dept || "" : "", title: e ? e.title || "" : "" }, loans: rows.map(shape) });
}));

// HR: every loan, with the figures for the dashboard and filters.
loansRouter.get("/", wrap(async (req, res) => {
  if (!isHr(req)) return res.status(403).json(NO_ACCESS);
  await syncLoans();
  const q = clip(req.query.q, 80), dept = clip(req.query.dept, 80), status = ["pending", "active", "completed", "rejected", "cancelled"].includes(req.query.status) ? req.query.status : "";
  const month = /^(0?[1-9]|1[0-2])$/.test(req.query.month || "") ? Number(req.query.month) : 0, year = /^\d{4}$/.test(req.query.year || "") ? Number(req.query.year) : 0;
  const where = [], args = [];
  if (q) { args.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`); where.push(`(e.name ILIKE $${args.length} OR e.emp_no ILIKE $${args.length} OR l.loan_no ILIKE $${args.length})`); }
  if (dept) { args.push(dept); where.push(`e.dept = $${args.length}`); }
  if (status) { args.push(status); where.push(`l.status = $${args.length}`); }
  if (month) { args.push(month); where.push(`extract(month FROM l.created_at AT TIME ZONE 'Asia/Kolkata') = $${args.length}`); }
  if (year) { args.push(year); where.push(`extract(year FROM l.created_at AT TIME ZONE 'Asia/Kolkata') = $${args.length}`); }
  const W = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [{ rows }, { rows: [s] }, { rows: depts }] = await Promise.all([
    pool.query(`${SELECT} ${W} ORDER BY (l.status = 'pending') DESC, l.id DESC LIMIT 300`, args),
    pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE l.status='pending')::int AS pending, count(*) FILTER (WHERE l.status='active')::int AS active,
                       count(*) FILTER (WHERE l.status='completed')::int AS completed, count(*) FILTER (WHERE l.status='rejected')::int AS rejected,
                       COALESCE(sum(l.approved_amount) FILTER (WHERE l.status IN ('active','completed')), 0) AS disbursed,
                       COALESCE(sum(r.repaid) FILTER (WHERE l.status IN ('active','completed')), 0) AS repaid
                  FROM loans l LEFT JOIN (SELECT advance_id, sum(amount) AS repaid FROM advance_recoveries GROUP BY advance_id) r ON r.advance_id = l.advance_id`),
    pool.query("SELECT DISTINCT dept FROM employees WHERE dept IS NOT NULL AND dept <> '' ORDER BY dept")]);
  const disbursed = money(s.disbursed), repaid = money(s.repaid);
  res.json({ loans: rows.map(shape), departments: depts.map((d) => d.dept),
    stats: { total: s.total, pending: s.pending, active: s.active, completed: s.completed, rejected: s.rejected, disbursed, repaid, outstanding: Math.max(0, money(disbursed - repaid)) } });
}));

// Submit a request (for yourself).
loansRouter.post("/", wrap(async (req, res) => {
  const b = req.body || {}, errors = {}, reason = clip(b.reason, 500);
  if (!amountOk(b.amount)) errors.amount = `Enter the amount in rupees (up to ${inr(MAX_AMOUNT)}).`;
  if (!monthsOk(b.months)) errors.months = `Enter the number of months (1 to ${MAX_MONTHS}).`;
  if (reason.length < 3) errors.reason = "Please say why you need the loan.";
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please check the highlighted fields.", errors });
  const { rows: [emp] } = await pool.query("SELECT name, status FROM employees WHERE lower(work_email) = $1", [me(req)]);
  if (!emp || emp.status === "offboarded") return res.status(403).json({ error: "Only employees can request a loan." });
  const out = await tx(async (c) => {
    const { rows: [open] } = await c.query("SELECT loan_no FROM loans WHERE lower(work_email) = $1 AND status = 'pending'", [me(req)]);
    if (open) return { rollback: true, status: 409, error: `You already have a request (${open.loan_no}) waiting for HR. Please wait for the decision, or cancel it first.` };
    const { rows: [l] } = await c.query("INSERT INTO loans (work_email, requested_amount, reason, requested_months) VALUES ($1,$2,$3,$4) RETURNING *", [me(req), money(b.amount), reason, Number(b.months)]);
    l.loan_no = `LN-${l.created_at.getFullYear()}-${String(l.id).padStart(4, "0")}`;
    await c.query("UPDATE loans SET loan_no = $2 WHERE id = $1", [l.id, l.loan_no]);
    await log(c, l.id, me(req), "Loan requested", { amount: money(b.amount), months: Number(b.months), monthly: plan(b.amount, b.months).monthly, reason });
    return { l };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  await notify("perm:advances.approve", { title: `${emp.name} requested a loan of ${inr(money(b.amount))} over ${Number(b.months)} months.`, body: out.l.loan_no, link: `/app/loans?open=${out.l.id}` }).catch(() => {});
  res.status(201).json({ id: out.l.id, loanNo: out.l.loan_no });
}));

/** The loan if the caller may see it (their own, or any for HR); otherwise null. */
async function visible(req, id) {
  const { rows: [l] } = await pool.query(`${SELECT} WHERE l.id = $1`, [Number(id) || 0]);
  return l && (l.work_email.toLowerCase() === me(req) || isHr(req)) ? l : null;
}

// One loan: the request, the schedule with what has been deducted, and the history. HR also gets the person's other loans and advances.
loansRouter.get("/:id", wrap(async (req, res) => {
  await syncLoans();
  const l = await visible(req, req.params.id);
  if (!l) return res.status(404).json({ error: "Loan not found." });
  const out = { loan: shape(l), schedule: [], events: [] };
  if (l.advance_id) {
    const { rows } = await pool.query("SELECT payroll_period, amount FROM advance_recoveries WHERE advance_id = $1 AND payroll_period IS NOT NULL", [l.advance_id]);
    const prog = progress({ amount: l.approved_amount, months: l.months, firstMonth: l.first_month, recovered: new Map(rows.map((r) => [r.payroll_period, Number(r.amount)])), total: Number(l.repaid), thisMonth: istMonth() });
    out.schedule = prog.rows; out.paidCount = prog.paidCount; out.remainingCount = prog.rows.length - prog.paidCount;
    out.expectedCompletion = prog.rows.length ? prog.rows[prog.rows.length - 1].month : null;
  }
  const { rows: ev } = await pool.query("SELECT ts, actor, action, detail FROM loan_events WHERE loan_id = $1 ORDER BY id", [l.id]);
  out.events = ev;
  if (isHr(req)) {
    const [{ rows: others }, rv] = await Promise.all([
      pool.query(`${SELECT} WHERE lower(l.work_email) = $1 AND l.id <> $2 ORDER BY l.id DESC`, [l.work_email.toLowerCase(), l.id]),
      l.status === "pending" ? review(l.work_email.toLowerCase(), l.requested_amount, l.requested_months, istMonth()) : null]);
    out.others = others.map(shape); out.existing = rv ? rv.existing : [];
  }
  res.set("Cache-Control", "no-store").json(out);
}));

// HR, before activating: the schedule and the checks for an amount, months and first month, as the approval screen is filled in.
loansRouter.get("/:id/review", wrap(async (req, res) => {
  if (!isHr(req)) return res.status(403).json(NO_ACCESS);
  const l = await visible(req, req.params.id);
  if (!l) return res.status(404).json({ error: "Loan not found." });
  const amount = amountOk(req.query.amount) ? Number(req.query.amount) : 0, months = monthsOk(req.query.months) ? Number(req.query.months) : 0;
  res.json(await review(l.work_email.toLowerCase(), amount, months, req.query.first));
}));

// HR: final approval. The approved amount, months, instalment, first month and the confirmed payment date are saved and the loan goes live.
loansRouter.post("/:id/activate", wrap(async (req, res) => {
  if (!isHr(req)) return res.status(403).json(NO_ACCESS);
  const b = req.body || {}, errors = {}, remarks = clip(b.remarks, 500);
  if (!amountOk(b.amount)) errors.amount = "Enter the approved amount in rupees.";
  if (!monthsOk(b.months)) errors.months = `Enter the repayment duration in months (1 to ${MAX_MONTHS}).`;
  if (!validMonth(b.firstMonth)) errors.firstMonth = "Choose the first month the deduction starts.";
  if (!validDay(b.disbursedOn)) errors.disbursedOn = "Enter the date the money was paid to the employee.";
  else if (b.disbursedOn > istDay()) errors.disbursedOn = "The payment date cannot be in the future.";
  if (b.confirmPaid !== true) errors.confirmPaid = "Please confirm that the money has been paid to the employee.";
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please check the highlighted fields.", errors });
  const out = await tx(async (c) => {
    const { rows: [l] } = await c.query("SELECT * FROM loans WHERE id = $1 FOR UPDATE", [Number(req.params.id) || 0]);
    if (!l) return { rollback: true, status: 404, error: "Loan not found." };
    if (l.work_email.toLowerCase() === me(req)) return { rollback: true, status: 403, error: "You cannot decide your own loan request. Another HR user needs to do it." };
    if (l.status !== "pending") return { rollback: true, status: 409, error: "This request has already been decided." };
    const email = l.work_email.toLowerCase(), amount = money(b.amount), months = Number(b.months), rv = await review(email, amount, months, b.firstMonth);
    if (rv.blocked) return { rollback: true, status: 400, error: rv.blocked, errors: { months: "Choose a longer period or a smaller amount." } };
    if (rv.firstMonthError) return { rollback: true, status: 400, error: rv.firstMonthError, errors: { firstMonth: rv.firstMonthError } };
    if (rv.existing.length && b.ack !== true) return { rollback: true, status: 409, needsAck: true, error: "This person has a loan or advance that is not repaid yet. Please confirm that you have seen it." };
    const { rows: [adv] } = await c.query(
      `INSERT INTO employee_advances (work_email, advance_date, reason, amount, created_by, monthly_recovery, recover_from, loan_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [email, b.disbursedOn, `Company loan ${l.loan_no}`, amount, me(req), rv.plan.monthly, b.firstMonth, l.id]);
    await c.query(
      `UPDATE loans SET status = 'active', approved_amount = $2, months = $3, monthly_amount = $4, first_month = $5, disbursed_on = $6, hr_remarks = $7, decided_by = $8, decided_at = now(), advance_id = $9 WHERE id = $1`,
      [l.id, amount, months, rv.plan.monthly, b.firstMonth, b.disbursedOn, remarks || null, me(req), adv.id]);
    await log(c, l.id, me(req), money(l.requested_amount) === amount ? "Approved as requested and activated" : "Approved with a changed amount and activated",
      { requestedAmount: money(l.requested_amount), approvedAmount: amount, requestedMonths: l.requested_months, months, monthly: rv.plan.monthly, last: rv.plan.last, firstMonth: b.firstMonth, disbursedOn: b.disbursedOn, remarks });
    return { l, amount, months, monthly: rv.plan.monthly };
  });
  if (out.error) return res.status(out.status).json({ error: out.error, ...(out.errors ? { errors: out.errors } : {}), ...(out.needsAck ? { needsAck: true } : {}) });
  payrollChanged();
  await notify(out.l.work_email, { title: `Your loan of ${inr(out.amount)} is approved.`, body: `${inr(out.monthly)} a month for ${out.months} month${out.months === 1 ? "" : "s"}, from ${monthName(b.firstMonth)}.`, link: `/app/loans?open=${out.l.id}` }).catch(() => {});
  res.json({ ok: true });
}));

// HR: reject, with a reason the employee will see.
loansRouter.post("/:id/reject", wrap(async (req, res) => {
  if (!isHr(req)) return res.status(403).json(NO_ACCESS);
  const reason = clip((req.body || {}).reason, 500);
  if (reason.length < 3) return res.status(400).json({ error: "Please give a reason for rejecting the request.", errors: { reason: "Please give a reason." } });
  const out = await tx(async (c) => {
    const { rows: [l] } = await c.query("SELECT * FROM loans WHERE id = $1 FOR UPDATE", [Number(req.params.id) || 0]);
    if (!l) return { rollback: true, status: 404, error: "Loan not found." };
    if (l.work_email.toLowerCase() === me(req)) return { rollback: true, status: 403, error: "You cannot decide your own loan request. Another HR user needs to do it." };
    if (l.status !== "pending") return { rollback: true, status: 409, error: "This request has already been decided." };
    await c.query("UPDATE loans SET status = 'rejected', rejection_reason = $2, decided_by = $3, decided_at = now() WHERE id = $1", [l.id, reason, me(req)]);
    await log(c, l.id, me(req), "Loan rejected", { reason });
    return { l };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  await notify(out.l.work_email, { title: `Your loan request ${out.l.loan_no} was not approved.`, body: reason, link: `/app/loans?open=${out.l.id}` }).catch(() => {});
  res.json({ ok: true });
}));

// The employee withdraws a request that is still waiting.
loansRouter.post("/:id/cancel", wrap(async (req, res) => {
  const out = await tx(async (c) => {
    const { rows: [l] } = await c.query("SELECT * FROM loans WHERE id = $1 FOR UPDATE", [Number(req.params.id) || 0]);
    if (!l || l.work_email.toLowerCase() !== me(req)) return { rollback: true, status: 404, error: "Loan not found." };
    if (l.status !== "pending") return { rollback: true, status: 409, error: "Only a request that is still waiting can be cancelled." };
    await c.query("UPDATE loans SET status = 'cancelled', decided_by = $2, decided_at = now() WHERE id = $1", [l.id, me(req)]);
    await log(c, l.id, me(req), "Request cancelled by the employee");
    return {};
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json({ ok: true });
}));
