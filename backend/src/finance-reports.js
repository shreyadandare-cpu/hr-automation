import express from "express";
import { pool, payPool } from "./db.js";
import { requireAuth } from "./auth.js";
import { requirePayUnlock } from "./pay-pin.js";
import { canAll } from "./access.js";
import { summaryOfLegacy } from "./payroll/engine.js";
import { deptOf } from "./payroll/store.js";
import { approvedMinutes } from "./workforce.js";
import { minutesByProject, timesheetShares } from "./workforce-rules.js";
import { annualStatement, contractorQuarters, costByDept, costByProject, dueDates, ecr, esicSheet, fyOf, fyPeriods, gratuity, FINAL_STATES, isFinal, isFy, isPeriod, journal, lwf, readContractorPayment, readShare, sharesOf, statutory, sumOf, tallyXml } from "./finance-rules.js";

/*
 * Finance reports for the accountant, read from payroll that is already calculated. Nothing here writes to payroll.
 * Open to finance.view and payroll.approve holders (company-wide), who see these reports and nothing else of payroll.
 * Only payroll.prepare holders see months whose payroll is not approved yet; everyone else sees approved and paid months only.
 * Project shares need payroll.prepare; recording or removing contractor payments needs finance.contractors.
 *   GET /api/finance/files?period=&kind=     a file for a portal or for Tally: ecr, esic, tally
 *   GET /api/finance/tds-sheet?fy=&quarter=  the quarter's salary TDS, one row per person per month (for Form 24Q)
 *   GET/PATCH /api/finance/shares            project shares in per cent, for cost by project
 *   GET/POST/DELETE /api/finance/contractors payments to contractors with the tax deducted
 *   GET /api/finance/periods                 the months that have a payroll run, and the financial years they fall in
 *   GET /api/finance/statutory?period=       PF, ESIC, professional tax and TDS per person, the totals and the due dates
 *   GET /api/finance/journal?period=         the month's payroll as one balanced journal entry
 *   GET /api/finance/cost?period=            cost by department and by project
 *   GET /api/finance/gratuity                a gratuity estimate for everyone on the staff list
 *   GET /api/finance/tax-statements?fy=      everyone's taxable salary and TDS for the year, and TDS by quarter
 *   GET /api/finance/tax-statements/:email?fy=   one person's year, month by month
 * Payroll tables are read through payPool (payroll may run on its own database); projects through the main one.
 */
const bad = (res, error) => res.status(400).json({ error });
const denied = (res) => res.status(403).json({ error: "You do not have access to this. Please ask a super admin if you need it." });
/** Payroll preparers also see months that are not approved yet (drafts and runs in review). */
const seesDrafts = (req) => canAll(req, "payroll.prepare");
/** finance.view or payroll.approve, for the whole company. Finance figures are never cached by the browser. */
export const requireFinanceAccess = (req, res, next) =>
  !req.user ? res.status(401).json({ error: "Please sign in." })
  : !canAll(req, "finance.view") && !canAll(req, "payroll.approve") ? denied(res)
  : (res.setHeader("Cache-Control", "private, no-store"), next());
const monthLong = (period) => new Date(period + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const monthEnd = (period) => { const [y, m] = period.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

/** Every line of a month's run, each with its payslip summary. With finalOnly, a run that is not approved yet counts as none. */
async function linesOf(period, finalOnly) {
  const { rows: [run] } = await payPool.query("SELECT id, period, status FROM payroll_runs WHERE period=$1", [period]);
  if (!run || (finalOnly && !isFinal(run.status))) return { run: null, lines: [] };
  const { rows } = await payPool.query(
    `SELECT lower(i.work_email) AS email, i.slip, i.base_salary, i.lop_deduction, i.payable, e.name, e.emp_no, e.dept, e.pf_number, e.pan_masked
     FROM payroll_items i LEFT JOIN employees e ON lower(e.work_email) = lower(i.work_email)
     WHERE i.run_id=$1 ORDER BY e.name NULLS LAST, i.work_email LIMIT 2000`, [run.id]);
  const lines = rows.map((x) => {
    const emp = (x.slip && x.slip.employee) || {};
    return { email: x.email, name: x.name || emp.name || x.email.split("@")[0], empNo: x.emp_no || emp.empNo || "", dept: x.dept || emp.dept || "",
      pfNumber: x.pf_number || emp.pfNumber || "", pan: x.pan_masked || "", s: summaryOfLegacy(x.slip, x),
      lopDays: Number((x.slip && x.slip.days && x.slip.days.lop) || 0), paidDays: Number((x.slip && x.slip.days && x.slip.days.payable) || 0) };
  });
  return { run: { period: run.period, status: run.status, final: isFinal(run.status) }, lines };
}
const periodOf = (req, res) => { const p = String(req.query.period || ""); if (!isPeriod(p)) { bad(res, "Please choose a month."); return null; } return p; };

export function financeRouter(wrap) {
  const r = express.Router();
  r.use("/api/finance", requireAuth, requirePayUnlock, requireFinanceAccess);

  r.get("/api/finance/periods", wrap(async (req, res) => {
    const all = seesDrafts(req);
    const { rows } = await payPool.query(`SELECT period, status FROM payroll_runs ${all ? "" : "WHERE status = ANY($1)"} ORDER BY period DESC LIMIT 120`, all ? [] : [FINAL_STATES]);
    const today = (await payPool.query("SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS d")).rows[0].d;
    const years = [...new Set([fyOf(today.slice(0, 7)), ...rows.map((x) => fyOf(x.period))])].sort().reverse();
    res.json({ today, periods: rows.map((x) => ({ period: x.period, status: x.status, final: isFinal(x.status) })), years });
  }));

  r.get("/api/finance/statutory", wrap(async (req, res) => {
    const period = periodOf(req, res); if (!period) return;
    const { run, lines } = await linesOf(period, !seesDrafts(req));
    res.json({ run, due: dueDates(period), lwf: lwf(period, lines), ...statutory(lines) });
  }));

  r.get("/api/finance/journal", wrap(async (req, res) => {
    const period = periodOf(req, res); if (!period) return;
    const { run, lines } = await linesOf(period, !seesDrafts(req));
    res.json({ run, date: monthEnd(period), ...journal(lines.map((l) => l.s)), people: lines.length });
  }));

  r.get("/api/finance/cost", wrap(async (req, res) => {
    const period = periodOf(req, res); if (!period) return;
    const { run, lines } = await linesOf(period, !seesDrafts(req));
    // Who was on which project at any point in the month. Allocations live in the main database.
    const { rows } = await pool.query(
      `SELECT lower(e.work_email) AS email, p.name AS project, a.share_percent AS percent FROM employee_project_allocations a
       JOIN employees e ON e.id = a.employee_id JOIN projects p ON p.id = a.project_id
       WHERE (a.start_date IS NULL OR a.start_date <= $2::date) AND (a.end_date IS NULL OR a.end_date >= $1::date) LIMIT 5000`, [period + "-01", monthEnd(period)]);
    // Approved timesheets for the month, where a person has them, replace their project shares.
    const hours = timesheetShares(minutesByProject(await approvedMinutes(pool, period + "-01", monthEnd(period))));
    const timed = new Set(hours.map((h) => h.email));
    const allocations = [...rows.filter((x) => !timed.has(x.email)), ...hours];
    const t = sumOf(lines.map((l) => l.s));
    res.json({ run, departments: costByDept(lines), projects: costByProject(lines, allocations), allocated: allocations.length > 0, fromTimesheets: timed.size,
      total: costByDept(lines).reduce((n, g) => n + Math.round(g.total * 100), 0) / 100, employerPf: t.employerPf, employerEsic: costByDept(lines).reduce((n, g) => n + Math.round(g.employerEsic * 100), 0) / 100, reimbursements: t.reimbursements });
  }));

  /* A file for a government portal or for Tally, as text the page saves. Nothing is sent anywhere from here. */
  r.get("/api/finance/files", wrap(async (req, res) => {
    const period = periodOf(req, res); if (!period) return;
    const { run, lines } = await linesOf(period, !seesDrafts(req));
    if (!run) return res.status(404).json({ error: "Payroll has not been run for this month yet." });
    const kind = String(req.query.kind || "");
    if (kind === "ecr") { const f = ecr(lines); return res.json({ run, filename: `ECR-${period}.txt`, mime: "text/plain", text: f.text, rows: f.rows.length, missing: f.missing }); }
    if (kind === "esic") { const rows = esicSheet(lines); return res.json({ run, filename: `ESIC-contribution-${period}.csv`, mime: "text/csv", rows: rows.length,
      table: [["IP Number", "IP Name", "No of Days for which wages paid/payable during the month", "Total Monthly Wages", "Reason Code for Zero workings days", "Last Working Day"], ...rows] }); }
    if (kind === "tally") { const j = journal(lines.map((l) => l.s)); if (!j.balanced) return res.status(409).json({ error: "The debits and credits of this month do not match, so the file was not made. Please ask the HR team to recalculate the run." });
      return res.json({ run, filename: `payroll-journal-${period}.xml`, mime: "application/xml", rows: j.lines.length, text: tallyXml(j, monthEnd(period), `Salaries for ${monthLong(period)}, ${lines.length} ${lines.length === 1 ? "person" : "people"}`) }); }
    bad(res, "Please choose which file to make.");
  }));

  /* Project shares: everyone who is on a project now, with the percentage each project takes. HR sets them. */
  r.get("/api/finance/shares", wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT a.id, lower(e.work_email) AS email, e.name, p.name AS project, a.share_percent AS percent FROM employee_project_allocations a
       JOIN employees e ON e.id = a.employee_id JOIN projects p ON p.id = a.project_id
       WHERE a.status = 'Active' AND e.status <> 'offboarded' ORDER BY e.name, p.name LIMIT 5000`);
    const by = new Map();
    for (const x of rows) { if (!by.has(x.email)) by.set(x.email, { email: x.email, name: x.name, projects: [] }); by.get(x.email).projects.push({ id: x.id, project: x.project, percent: x.percent }); }
    const people = [...by.values()].map((p) => { const w = sharesOf(p.projects); return { ...p, projects: p.projects.map((a) => ({ ...a, effective: Math.round((w.find((x) => x.project === a.project) || { weight: 0 }).weight * 1000) / 10 })) }; });
    res.json({ canEdit: canAll(req, "payroll.prepare"), people });
  }));
  r.patch("/api/finance/shares/:id", wrap(async (req, res) => {
    if (!canAll(req, "payroll.prepare")) return denied(res);
    const { percent, errors } = readShare(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const { rows: [row] } = await pool.query(
      `UPDATE employee_project_allocations a SET share_percent=$2 FROM employees e, projects p WHERE a.id=$1 AND e.id=a.employee_id AND p.id=a.project_id RETURNING e.name, p.name AS project`, [Number(req.params.id) || 0, percent]);
    if (!row) return res.status(404).json({ error: "This allocation was not found." });
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Project share of ${row.name} on "${row.project}" set to ${percent == null ? "an equal share" : percent + "%"}`, req.user.email]);
    res.json({ ok: true });
  }));

  /* Contractor and consultant payments with TDS, for one financial year. */
  const fyDates = (fy) => { const y = Number(fy.slice(0, 4)); return [`${y}-04-01`, `${y + 1}-03-31`]; };
  r.get("/api/finance/contractors", wrap(async (req, res) => {
    const fy = String(req.query.fy || ""); if (!isFy(fy)) return bad(res, "Please choose a financial year.");
    const { rows } = await pool.query(
      `SELECT id, name, pan_masked, has_pan, section, to_char(paid_on,'YYYY-MM-DD') AS paid_on, amount_minor, tds_rate, tds_minor, note FROM contractor_payments
       WHERE deleted_at IS NULL AND paid_on BETWEEN $1::date AND $2::date ORDER BY paid_on DESC, id DESC LIMIT 2000`, fyDates(fy));
    res.json({ fy, canEdit: canAll(req, "finance.contractors"), quarters: contractorQuarters(rows.map((x) => ({ paidOn: x.paid_on, section: x.section, amountMinor: x.amount_minor, tdsMinor: x.tds_minor }))),
      payments: rows.map((x) => ({ id: x.id, name: x.name, pan: x.pan_masked, hasPan: x.has_pan, section: x.section, paidOn: x.paid_on, amount: Number(x.amount_minor) / 100, rate: Number(x.tds_rate), tds: Number(x.tds_minor) / 100, net: (Number(x.amount_minor) - Number(x.tds_minor)) / 100, note: x.note })) });
  }));
  r.post("/api/finance/contractors", wrap(async (req, res) => {
    if (!canAll(req, "finance.contractors")) return denied(res);
    const p = readContractorPayment(req.body);
    if (Object.keys(p.errors).length) return res.status(400).json({ errors: p.errors });
    const { rows: [row] } = await pool.query(
      `INSERT INTO contractor_payments (name, pan_masked, has_pan, section, paid_on, amount_minor, tds_rate, tds_minor, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [p.name, p.panMasked, p.hasPan, p.section, p.paidOn, p.amountMinor, p.rate, p.tdsMinor, p.note, req.user.email.toLowerCase()]);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Contractor payment recorded for ${p.name}`, req.user.email]);
    res.status(201).json({ id: row.id });
  }));
  r.delete("/api/finance/contractors/:id", wrap(async (req, res) => {
    if (!canAll(req, "finance.contractors")) return denied(res);
    const { rows: [row] } = await pool.query("UPDATE contractor_payments SET deleted_at=now(), deleted_by=$2 WHERE id=$1 AND deleted_at IS NULL RETURNING name", [Number(req.params.id) || 0, req.user.email.toLowerCase()]);
    if (!row) return res.status(404).json({ error: "This payment was not found." });
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Contractor payment removed for ${row.name}`, req.user.email]);
    res.json({ ok: true });
  }));

  r.get("/api/finance/gratuity", wrap(async (_req, res) => {
    const today = (await payPool.query("SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS d")).rows[0].d;
    const { rows: staff } = await payPool.query(
      "SELECT lower(work_email) AS email, name, emp_no, dept, title, to_char(start_date,'YYYY-MM-DD') AS start FROM employees WHERE status <> 'offboarded' AND start_date IS NOT NULL ORDER BY start_date, name LIMIT 2000");
    // The basic pay of each person's latest salary structure.
    const { rows: latest } = await payPool.query(
      "SELECT DISTINCT ON (lower(work_email)) lower(work_email) AS email, earnings FROM salary_structures ORDER BY lower(work_email), effective_from DESC");
    const basicOf = Object.fromEntries(latest.map((x) => [x.email, (Array.isArray(x.earnings) ? x.earnings : []).filter((e) => /^\s*basic/i.test(e.name || "")).reduce((n, e) => n + Number(e.amount || 0), 0)]));
    const people = staff.map((p) => {
      const basic = basicOf[p.email];
      return { email: p.email, name: p.name, empNo: p.emp_no || "", dept: deptOf(p.dept, p.title) || "", start: p.start, basic: basic == null ? null : basic, ...gratuity({ start: p.start, basic: basic || 0, asOf: today }) };
    });
    const add = (list) => list.reduce((n, p) => n + p.amount, 0);
    res.json({ asOf: today, people, totals: { people: people.length, eligible: people.filter((p) => p.eligible).length, payable: add(people.filter((p) => p.eligible)), building: add(people.filter((p) => !p.eligible)), noSalary: people.filter((p) => p.basic == null).length } });
  }));

  /** Every payslip of a financial year, as { email → [{ period, status, s }] }. With finalOnly, approved and paid months only. */
  async function yearOf(fy, email, finalOnly) {
    const args = [fyPeriods(fy)], where = ["r.period = ANY($1)"];
    if (email) { args.push(email); where.push(`lower(i.work_email) = $${args.length}`); }
    if (finalOnly) { args.push(FINAL_STATES); where.push(`r.status = ANY($${args.length})`); }
    const { rows } = await payPool.query(
      `SELECT lower(i.work_email) AS email, r.period, r.status, i.slip, i.base_salary, i.lop_deduction, i.payable
       FROM payroll_items i JOIN payroll_runs r ON r.id = i.run_id
       WHERE ${where.join(" AND ")} LIMIT 30000`, args);
    const by = {};
    for (const x of rows) (by[x.email] = by[x.email] || []).push({ period: x.period, status: x.status, s: summaryOfLegacy(x.slip, x) });
    return by;
  }
  const fyFrom = (req, res) => { const fy = String(req.query.fy || ""); if (!isFy(fy)) { bad(res, "Please choose a financial year."); return null; } return fy; };

  r.get("/api/finance/tax-statements", wrap(async (req, res) => {
    const fy = fyFrom(req, res); if (!fy) return;
    const by = await yearOf(fy, null, !seesDrafts(req));
    const emails = Object.keys(by);
    const { rows: staff } = emails.length ? await payPool.query("SELECT lower(work_email) AS email, name, emp_no, pan_masked FROM employees WHERE lower(work_email) = ANY($1)", [emails]) : { rows: [] };
    const who = Object.fromEntries(staff.map((p) => [p.email, p]));
    const people = emails.map((e) => { const y = annualStatement(by[e]); const p = who[e] || {}; return { email: e, name: p.name || e.split("@")[0], empNo: p.emp_no || "", pan: p.pan_masked || "", ...y.totals, quarters: y.quarters }; })
      .sort((a, b) => a.name.localeCompare(b.name));
    const quarters = ["Q1", "Q2", "Q3", "Q4"].map((q, i) => ({ quarter: q, people: people.filter((p) => p.quarters[i].tds > 0).length,
      taxable: people.reduce((n, p) => n + Math.round(p.quarters[i].taxable * 100), 0) / 100, tds: people.reduce((n, p) => n + Math.round(p.quarters[i].tds * 100), 0) / 100 }));
    res.json({ fy, people: people.map(({ quarters: _q, ...p }) => p), quarters });
  }));

  /* The quarter's salary TDS, a row per person per month, in the order the quarterly return's deductee sheet asks for. */
  r.get("/api/finance/tds-sheet", wrap(async (req, res) => {
    const fy = fyFrom(req, res); if (!fy) return;
    const q = ["Q1", "Q2", "Q3", "Q4"].indexOf(String(req.query.quarter || ""));
    if (q < 0) return bad(res, "Please choose a quarter.");
    const months = fyPeriods(fy).slice(q * 3, q * 3 + 3), by = await yearOf(fy, null, !seesDrafts(req));
    const emails = Object.keys(by);
    const { rows: staff } = emails.length ? await payPool.query("SELECT lower(work_email) AS email, name, emp_no, pan_masked FROM employees WHERE lower(work_email) = ANY($1)", [emails]) : { rows: [] };
    const who = Object.fromEntries(staff.map((p) => [p.email, p]));
    const rows = [];
    for (const e of emails.sort((a, b) => ((who[a] || {}).name || a).localeCompare((who[b] || {}).name || b))) for (const m of by[e].filter((x) => months.includes(x.period) && (Number(x.s.taxable) > 0 || Number(x.s.tds) > 0)).sort((a, b) => (a.period < b.period ? -1 : 1)))
      rows.push([(who[e] || {}).emp_no || "", (who[e] || {}).pan_masked || "", (who[e] || {}).name || e, "92B", monthEnd(m.period), monthEnd(m.period), Number(m.s.taxable || 0), Number(m.s.tds || 0), isFinal(m.status) ? "" : "Not approved"]);
    res.json({ fy, quarter: `Q${q + 1}`, table: [["Employee number", "PAN (masked: please complete)", "Name", "Section", "Date of payment", "Date of deduction", "Amount paid", "TDS", "Note"], ...rows] });
  }));

  r.get("/api/finance/tax-statements/:email", wrap(async (req, res) => {
    const fy = fyFrom(req, res); if (!fy) return;
    const email = String(req.params.email || "").toLowerCase();
    const by = await yearOf(fy, email, !seesDrafts(req));
    const { rows: [p] } = await payPool.query("SELECT name, emp_no, title, dept, pan_masked, to_char(start_date,'YYYY-MM-DD') AS start FROM employees WHERE lower(work_email)=$1", [email]);
    if (!p && !by[email]) return res.status(404).json({ error: "This person has no payslips in that financial year." });
    // The regime payroll used for the year (payroll's own record, read only).
    const { rows: [d] } = await payPool.query("SELECT regime FROM tax_declarations WHERE fy=$1 AND lower(work_email)=$2", [fy, email]);
    res.json({ fy, person: { email, name: p ? p.name : email.split("@")[0], empNo: (p && p.emp_no) || "", title: (p && p.title) || "", dept: (p && p.dept) || "", pan: (p && p.pan_masked) || "", start: p ? p.start : null },
      regime: d ? d.regime : null, ...annualStatement(by[email] || []) });
  }));

  return r;
}
