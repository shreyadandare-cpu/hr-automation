import { payrollChanged } from "./payroll/preview-cache.js";
import express from "express";
import { payPool as pool, pool as mainPool, PAYROLL_SEPARATE } from "./db.js";   // payroll may use its own database (PAYROLL_DATABASE_URL)
import { event } from "./reimbursements.js";
import { notify as notifyAll } from "./notify.js";
const notify = (to, n) => (PAYROLL_SEPARATE ? Promise.resolve(console.log(`Payroll on its own database, notice not sent to ${to}: ${n.title}`)) : notifyAll(to, n));
import { cleanStructure, grossOf, splitGross, stipendBody, structureFromRow } from "./payroll-calc.js";
import { structuresFor, toStructure, monthName, recalcRun } from "./payroll/store.js";
import { audit } from "./payroll/routes.js";
import { hrOnly } from "./payroll/access.js";
import { can } from "./access.js";
import { syncEmployees } from "./payroll/employee-sync.js";

/*
 * Salary structures (HR only). A person's breakdown applies from a month on; a revision is a new row from a later month,
 * so earlier months keep the structure they were paid on. Each month's payroll stores its own copy of every payslip
 * (payroll_items.slip), so a revision never changes a month already calculated.
 * Runs, review and payments are in payroll/routes.js. Every route needs payroll.prepare (hrOnly, also applied where index.js mounts it).
 */
const num = (v) => (v === null || v === undefined ? null : Number(v));
const inr = (n) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** Tells each person their reimbursement is now part of the month's payroll. */
export async function tellIncluded(included, period) {
  for (const c of included)
    await notify(c.work_email, { title: `Your approved reimbursement of ${inr(c.approved_amount ?? c.amount)} has been included in your upcoming payroll.`, body: `${c.claim_no} · ${monthName(period)}`, link: `claim:${c.id}`,
      email: { subject: `Reimbursement included in payroll: ${c.claim_no}`, body: `Your approved reimbursement of ${inr(c.approved_amount ?? c.amount)} (${c.claim_no}) has been included in your ${monthName(period)} payroll.` } });
}

/**
 * Saves a salary breakdown from a month on, and keeps monthly_gross and the PF number in step.
 * Saving the same month again replaces that row, unless a month that is approved (or later) was paid on it: then the
 * change has to be a revision from a later month, so the record of what was paid stays as it was.
 */
async function saveStructure(client, emp, email, v, actor) {
  const { rows: [old] } = await client.query("SELECT * FROM salary_structures WHERE lower(work_email)=$1 AND effective_from=$2", [email, v.effectiveFrom]);
  if (old) {
    const { rows: used } = await client.query(
      `SELECT r.period FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id WHERE i.structure_id=$1 AND r.status IN ('approved','bank_ready','paid') ORDER BY r.period LIMIT 1`, [old.id]);
    if (used[0]) {
      const e = new Error(`This breakdown was used for ${monthName(used[0].period)}, which is approved. Save the change as a revision from a later month.`);
      e.status = 409; e.field = "effectiveFrom";
      throw e;
    }
  }
  await client.query(
    `INSERT INTO salary_structures (work_email, effective_from, earnings, pf_employee, professional_tax, other_deductions, tds_monthly, updated_by,
       annual_ctc, pf_applicable, employer_pf, pt_applicable, pt_february, tds_applicable, tds_mode, reason, esic_employee)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (lower(work_email), effective_from) DO UPDATE SET earnings=EXCLUDED.earnings, pf_employee=EXCLUDED.pf_employee,
       professional_tax=EXCLUDED.professional_tax, other_deductions=EXCLUDED.other_deductions, tds_monthly=EXCLUDED.tds_monthly,
       updated_by=EXCLUDED.updated_by, updated_at=now(), annual_ctc=EXCLUDED.annual_ctc, pf_applicable=EXCLUDED.pf_applicable, employer_pf=EXCLUDED.employer_pf,
       pt_applicable=EXCLUDED.pt_applicable, pt_february=EXCLUDED.pt_february, tds_applicable=EXCLUDED.tds_applicable, tds_mode=EXCLUDED.tds_mode, reason=EXCLUDED.reason, esic_employee=EXCLUDED.esic_employee`,
    [email, v.effectiveFrom, JSON.stringify(v.earnings), v.pfEmployee, v.professionalTax, JSON.stringify(v.otherDeductions), v.tdsMonthly, actor,
      v.annualCtc, v.pfApplicable, v.employerPf, v.ptApplicable, v.ptFebruary, v.tdsApplicable, v.tdsMode, v.reason, v.esicEmployee]);
  // The monthly gross (used for loss-of-pay cuts and exit settlements) follows the breakdown now in force.
  const [current] = await structuresFor(client, new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7), email);
  await client.query("UPDATE employees SET pf_number=CASE WHEN $4 THEN $2 ELSE pf_number END, monthly_gross=coalesce($3, monthly_gross) WHERE id=$1",
    [emp.id, v.pfNumber ?? null, current ? grossOf(current.earnings) : null, v.pfNumber !== undefined]);
  await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Salary breakdown from ${monthName(v.effectiveFrom)} saved by ${actor}`, email]);
  const { rows: [prev] } = old ? { rows: [] } : await client.query(
    "SELECT * FROM salary_structures WHERE lower(work_email)=$1 AND effective_from < $2 ORDER BY effective_from DESC LIMIT 1", [email, v.effectiveFrom]);
  await audit(client, actor, old ? "Salary structure changed" : prev ? "Salary revised" : "Salary structure added", { work_email: email, period: v.effectiveFrom,
    detail: { before: old ? toStructure(old) : prev ? toStructure(prev) : null, after: { ...v, pfNumber: undefined }, monthlyGross: grossOf(v.earnings) } });
  // A month still in draft shows the new salary at once: its lines are worked out again (everyone's inputs are kept). Months sent for
  // review or approved are never touched here; HR sends those back to draft first, as before.
  const { rows: drafts } = await client.query("SELECT * FROM payroll_runs WHERE status='draft' AND period >= $1 ORDER BY period FOR UPDATE", [String(v.effectiveFrom).slice(0, 7)]);
  for (const run of drafts) await recalcRun(client, run, actor);
}

export const payrollRouter = express.Router();

/**
 * An intern is taken on as an employee. One step, for someone who prepares payroll and may edit people: the date they join as an employee, and their salary from
 * that month (HR's breakup format, with PF, professional tax and TDS). Their bank account stays as it is: they already work here. Their start_date stays the day they
 * first joined, the new date is kept as converted_on, and their stipend keeps applying to the months before. If the salary cannot be saved, the type is put back.
 */
payrollRouter.post("/convert-intern", hrOnly, wrap(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase(), joinDate = String(req.body?.joinDate || "").trim();
  if (!(await can(req, "people.edit", email))) return res.status(403).json({ error: "You are not allowed to change this person's details." });
  if (!(/^\d{4}-\d{2}-\d{2}$/.test(joinDate) && !isNaN(new Date(`${joinDate}T00:00:00`)))) return res.status(400).json({ error: "Enter the date they join as an employee." });
  const gross = Math.round(Number(req.body?.monthlyGross));
  if (!(gross > 0) || gross >= 1e8) return res.status(400).json({ error: "Enter the monthly gross salary in rupees." });
  const { rows: [emp] } = await mainPool.query("SELECT id, name, employment_type FROM employees WHERE lower(work_email)=$1", [email]);
  if (!emp) return res.status(404).json({ error: "Employee not found." });
  if (emp.employment_type !== "Intern") return res.status(409).json({ error: `${emp.name} is not an intern.` });
  await mainPool.query("UPDATE employees SET employment_type='Employee', converted_on=$2 WHERE id=$1", [emp.id, joinDate]);
  await syncEmployees({ force: true });   // payroll's copy of the staff list must show the new type before the salary is saved
  let out;
  try { out = await saveOnboardingSalary(email, { annualCtc: req.body?.annualCtc ?? null, monthlyGross: gross, startDate: joinDate, replace: true, reason: "Intern taken on as an employee" }, req.user.email); }
  catch (err) { out = { error: err.status === 409 ? err.message : "The salary could not be saved." }; if (err.status !== 409) console.error("Convert intern:", err.message); }
  if (!out || !out.saved) {
    await mainPool.query("UPDATE employees SET employment_type='Intern', converted_on=NULL WHERE id=$1", [emp.id]);
    await syncEmployees({ force: true });
    return res.status(409).json({ error: (out && out.error) || "The salary could not be saved." });
  }
  await mainPool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`${emp.name} taken on as an employee from ${joinDate} (salary from ${out.from}) by ${req.user.email}`, email]);
  res.json({ email, type: "Employee", convertedOn: joinDate, salaryFrom: out.from, monthlyGross: out.monthlyGross });
}));

// One person's salary breakdowns, newest first, and their PF number.
payrollRouter.get("/structures/:email", hrOnly, wrap(async (req, res) => {
  const email = String(req.params.email).toLowerCase();
  const { rows: [emp] } = await pool.query("SELECT name, pf_number, monthly_gross, start_date, employment_type FROM employees WHERE lower(work_email)=$1", [email]);
  if (!emp) return res.status(404).json({ error: "Employee not found." });
  const { rows } = await pool.query("SELECT * FROM salary_structures WHERE lower(work_email)=$1 ORDER BY effective_from DESC", [email]);
  res.json({ name: emp.name, employmentType: emp.employment_type || "Employee", start: emp.start_date, pfNumber: emp.pf_number, monthlyGross: num(emp.monthly_gross), structures: rows.map(toStructure) });
}));

const saving = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query(out && out.rollback ? "ROLLBACK" : "COMMIT");
    if (!(out && out.rollback)) payrollChanged();   // the month preview on the Payroll overview must not show the old figures
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Onboarding to Payroll: when onboarding is completed with a salary, this creates the person's first salary structure on the
 * existing employee record (no separate payroll employee list), effective from the month they join. The same split as the
 * "Fill the lines" button on the salary screen: Basic 50% of gross, HRA 50% of Basic, the lines follow HR's salary breakup format for the size of the salary (splitGross in payroll-calc.js).
 * A structure that already exists for that month is left as it is, so running it twice never overwrites HR's edits. Returns { saved } or { error }.
 */
export async function saveOnboardingSalary(email, { annualCtc, monthlyGross, startDate, replace = false, reason = null }, actor) {
  const gross = Math.round(Number(monthlyGross)), ctc = annualCtc === "" || annualCtc === null || annualCtc === undefined ? null : Number(annualCtc);
  if (!(gross > 0) || gross >= 1e8) return { error: "Enter the monthly gross in rupees." };
  if (ctc !== null && !(ctc >= 0 && ctc < 1e9)) return { error: "Enter the annual CTC in rupees." };
  const month = /^\d{4}-\d{2}/.test(String(startDate || "")) ? String(startDate).slice(0, 7) : null;
  if (!month) return { error: "The joining date is needed to say which month the salary starts." };
  return saving(async (client) => {
    const { rows: [emp] } = await client.query("SELECT id, name, employment_type FROM employees WHERE lower(work_email)=$1 FOR UPDATE", [email.toLowerCase()]);
    if (!emp) return { rollback: true, error: "Employee not found." };
    // An intern has one salary line, the stipend, and nothing is deducted; everyone else gets HR's breakup format with PF, professional tax and TDS.
    const intern = emp.employment_type === "Intern";
    const { errors, value } = cleanStructure(intern
      ? { effectiveFrom: month, annualCtc: null, reason: reason || "Entered at onboarding (intern)", ...stipendBody(gross) }
      : { effectiveFrom: month, annualCtc: ctc, reason: reason || "Entered at onboarding", pfEmployee: 3000, professionalTax: 200, earnings: splitGross(gross) });
    if (errors) return { rollback: true, error: Object.values(errors)[0] };
    const { rows: [has] } = await client.query("SELECT 1 FROM salary_structures WHERE lower(work_email)=$1 AND effective_from=$2", [email.toLowerCase(), month]);
    if (has && !replace) return { rollback: true, saved: false, error: "A salary structure already exists for that month. Open the person's Salary in Payroll to change it." };
    await saveStructure(client, emp, email.toLowerCase(), value, actor);
    return { saved: true, from: month, monthlyGross: gross };
  });
}

// Save the breakdown that applies from a month on. Months already calculated keep their payslips.
payrollRouter.put("/structures/:email", hrOnly, wrap(async (req, res) => {
  const email = String(req.params.email).toLowerCase();
  const first = cleanStructure(req.body || {});
  if (first.errors) return res.status(400).json({ error: "Please check the highlighted fields.", errors: first.errors });
  try {
    const out = await saving(async (client) => {
      const { rows: [emp] } = await client.query("SELECT id, name, employment_type FROM employees WHERE lower(work_email)=$1 FOR UPDATE", [email]);
      if (!emp) return { rollback: true, missing: true };
      let v = first.value;
      if (emp.employment_type === "Intern") {   // an intern has one line, the stipend, and nothing is deducted: whatever was sent is reduced to that
        const stipend = v.earnings.reduce((n, x) => n + x.amount, 0);
        v = cleanStructure({ effectiveFrom: v.effectiveFrom, reason: v.reason, annualCtc: null, ...stipendBody(stipend) }).value;
      }
      await saveStructure(client, emp, email, v, req.user.email);
    });
    if (out && out.missing) return res.status(404).json({ error: "Employee not found." });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: err.message, errors: { [err.field]: err.message } });
    throw err;
  }
  res.json({ ok: true });
}));

// Salary breakdowns for many people at once, from HR's spreadsheet (one row per person, read as CSV in the browser).
// All or nothing: if any row has a problem nothing is saved, and each problem is listed with its row number.
payrollRouter.post("/structures/import", hrOnly, wrap(async (req, res) => {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
  if (!rows || !rows.length) return res.status(400).json({ error: "The file has no rows to import." });
  if (rows.length > 1000) return res.status(400).json({ error: "Import at most 1,000 rows at a time." });
  const problems = [], ok = [], seen = new Set();
  await saving(async (client) => {
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
      ok.push({ emp, email, value, n });
    }
    if (problems.length) return { rollback: true };
    for (const x of ok) {
      try { await saveStructure(client, x.emp, x.email, x.value, req.user.email); }
      catch (err) { if (err.status !== 409) throw err; problems.push({ row: x.n, email: x.email, error: err.message }); return { rollback: true }; }
    }
  });
  if (problems.length) return res.status(400).json({ error: `Nothing was saved. Fix ${problems.length === 1 ? "this row" : `these ${problems.length} rows`} and upload again.`, problems });
  res.json({ ok: true, saved: ok.length });
}));

// Runs processed before the review workflow: marking one paid also pays its reimbursements (automation 6).
// Workflow runs are marked paid through /runs/:id/actions/mark_paid instead.
payrollRouter.post("/runs/:id/pay", hrOnly, wrap(async (req, res) => {
  let run, paid = [];
  const out = await saving(async (client) => {
    ({ rows: [run] } = await client.query("SELECT * FROM payroll_runs WHERE id=$1 FOR UPDATE", [Number(req.params.id) || 0]));
    if (!run) return { rollback: true, status: 404, error: "Payroll run not found." };
    if (run.workflow) return { rollback: true, status: 409, error: "This payroll uses the review workflow. Mark it processed after the bank transfer." };
    if (run.status === "paid") return { rollback: true, status: 409, error: "This payroll is already marked as paid." };
    await client.query("UPDATE payroll_runs SET status='paid', paid_at=now(), paid_by=$2, status_at=now() WHERE id=$1", [run.id, req.user.email]);
    const { rows } = await client.query(
      "UPDATE reimbursements SET status='paid', paid_at=now(), paid_amount=coalesce(approved_amount, amount), updated_at=now() WHERE payroll_run_id=$1 AND status='in_payroll' RETURNING *", [run.id]);
    for (const c of rows) await event(client, c, { actor: req.user.email, kind: "Paid", status: "paid", note: `${inr(c.paid_amount)} with ${monthName(run.period)} payroll (run #${run.id})` });
    await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1, NULL)",
      [`Payroll for ${monthName(run.period)} marked as paid by ${req.user.email}: ${rows.length} reimbursements paid`]);
    paid = rows;
  });
  if (out && out.error) return res.status(out.status).json({ error: out.error });
  await tellPaid(paid, run.period);
  res.json({ ok: true, paid: paid.length });
}));

export async function tellPaid(claims, period) {
  for (const c of claims)
    await notify(c.work_email, { title: `Your reimbursement of ${inr(c.paid_amount)} has been paid.`, body: `${c.claim_no} · ${monthName(period)} payroll`, link: `claim:${c.id}`,
      email: { subject: `Reimbursement paid: ${c.claim_no}`, body: `Your reimbursement of ${inr(c.paid_amount)} (${c.claim_no}) has been paid with the ${monthName(period)} payroll.` } });
}
