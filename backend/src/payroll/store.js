import L from "../../../frontend/leave-rules.cjs";
import { computeLine, summaryOfLegacy, totalsOf, P, R } from "./engine.js";
import { fyOf, fyMonths } from "./tax.js";
import { DEFAULT_TAX_RULES } from "./tax-defaults.js";

/*
 * Reads what the payroll engine needs from the database and saves its result as the run's lines.
 * Every amount is worked out on the server by engine.js; the browser only sends HR's monthly inputs.
 */
const num = (v) => (v === null || v === undefined ? null : Number(v));
const lc = (s) => String(s || "").toLowerCase();
export const monthName = (p) => new Date(p + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
/** Runs async functions one after another and returns their results in order. */
const inTurn = async (fns) => { const out = []; for (const f of fns) out.push(await f()); return out; };
const monthEnd = (p) => { const [y, m] = p.split("-").map(Number); return `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };

/** Department from the job title when none is recorded (same rule as frontend/src/lib/people.js). */
export function deptOf(dept, title) {
  if (dept) return dept;
  const t = lc(title);
  if (/director|vice president/.test(t)) return "Leadership";
  if (/^hr\b/.test(t)) return "HR";
  if (/account|admin/.test(t) && !/network/.test(t)) return "Finance & Admin";
  if (/sales/.test(t)) return "Sales";
  if (/gen ?ai/.test(t)) return "Gen AI";
  if (/data/.test(t)) return "Data";
  if (/devops|network/.test(t)) return "DevOps & Cloud";
  return "Engineering";
}

/** Each person's salary structure in force for the month: the latest one starting on or before it. */
export const structuresFor = (db, period, email = null) => db.query(
  `SELECT DISTINCT ON (lower(work_email)) * FROM salary_structures WHERE effective_from <= $1 ${email ? "AND lower(work_email)=$2" : ""}
   ORDER BY lower(work_email), effective_from DESC`, email ? [period, email] : [period]).then((r) => r.rows);

export const toStructure = (x) => ({
  id: x.id, effectiveFrom: x.effective_from, earnings: x.earnings, otherDeductions: x.other_deductions,
  annualCtc: num(x.annual_ctc), pfApplicable: x.pf_applicable, pfEmployee: num(x.pf_employee), employerPf: num(x.employer_pf),
  ptApplicable: x.pt_applicable, professionalTax: num(x.professional_tax), ptFebruary: num(x.pt_february),
  tdsApplicable: x.tds_applicable, tdsMode: x.tds_mode, tdsMonthly: num(x.tds_monthly),
  reason: x.reason, updatedBy: x.updated_by, updatedAt: x.updated_at,
});

/** Copies the starting tax rules in, never overwriting a row that is already there. */
export async function seedTaxRules(db) {
  for (const r of DEFAULT_TAX_RULES)
    await db.query("INSERT INTO tax_rules (fy, regime, rules, source) VALUES ($1,$2,$3,$4) ON CONFLICT (fy, regime) DO NOTHING", [r.fy, r.regime, JSON.stringify(r.rules), r.source]);
}

/** Taxable salary, TDS and professional tax already in this financial year's earlier months, per person. */
async function paidSoFar(db, period) {
  const months = fyMonths(fyOf(period)).filter((m) => m < period);
  const out = new Map();
  if (!months.length) return out;
  const { rows } = await db.query(
    `SELECT i.work_email, i.slip, i.inputs, i.base_salary, i.lop_deduction, i.payable FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id
     WHERE r.period = ANY($1) AND r.status IN ('approved','bank_ready','paid','processed')`, [months]);
  for (const i of rows) {
    if (i.inputs && i.inputs.hold) continue;
    if (i.slip && i.slip.incomplete && i.slip.incomplete.length) continue;
    const s = summaryOfLegacy(i.slip, i);
    const k = lc(i.work_email), cur = out.get(k) || { taxable: 0, tds: 0, pt: 0 };
    out.set(k, { taxable: R(P(cur.taxable) + P(s.taxable)), tds: R(P(cur.tds) + P(s.tds)), pt: R(P(cur.pt) + P(s.pt)) });
  }
  return out;
}

/** Adds what this employer paid in the year before payroll moved to this app (declared as opening figures) to what the app paid. */
function withOpening(paid = { taxable: 0, tds: 0, pt: 0 }, d = {}) {
  const o = (k) => P(Number(d && d[k]) || 0);
  return { taxable: R(P(paid.taxable) + o("openingTaxable")), tds: R(P(paid.tds) + o("openingTds")), pt: R(P(paid.pt) + o("openingPt")) };
}

/** People on the payroll for a month: joined by its last day, and not gone before its first day. */
export async function staffFor(db, period) {
  const { rows } = await db.query(
    `SELECT id, work_email, name, emp_no, title, dept, start_date, last_day, status, pan_masked, acct_masked, ifsc, pf_number FROM employees
     WHERE start_date IS NOT NULL AND start_date <= $2::date
       AND ((last_day IS NULL AND status <> 'offboarded') OR last_day >= $1::date)
     ORDER BY name`, [period + "-01", monthEnd(period)]);
  return rows;
}

/**
 * Works out every line of a month. `existing` is the run's current lines (their inputs are kept).
 * Returns [{ email, name, empNo, dept, title, inputs, slip, status, claims, adjustments }].
 */
export async function buildLines(db, period, runId = null, existing = []) {
  const fy = fyOf(period);
  const emps = await staffFor(db, period);
  const kept = new Map(existing.map((i) => [lc(i.work_email), i]));
  // One query at a time: `db` may be a single transaction's client, which can't run queries in parallel.
  const [{ rows: claims }, { rows: lop }, { rows: hols }, structures, { rows: rules }, { rows: decls }, { rows: adjs }, { rows: banks }, paid] = await inTurn([
    () => db.query(`SELECT * FROM reimbursements WHERE (status='payroll_pending' AND payroll_period <= $1) OR (status='in_payroll' AND payroll_run_id=$2) ORDER BY id`, [period, runId]),
    () => db.query("SELECT * FROM leave_requests WHERE status='approved' AND lop_days > 0 AND from_date < $1::date + interval '1 month'", [period + "-01"]),
    () => db.query("SELECT day FROM holidays"),
    () => structuresFor(db, period),
    () => db.query("SELECT regime, rules FROM tax_rules WHERE fy=$1", [fy]),
    () => db.query("SELECT work_email, regime, declaration FROM tax_declarations WHERE fy=$1", [fy]),
    () => db.query("SELECT * FROM payroll_adjustments WHERE cancelled_at IS NULL AND (applied_run_id IS NULL OR applied_run_id=$1) ORDER BY id", [runId]),
    () => db.query("SELECT work_email, acct_last4, holder_name, bank_name, ifsc FROM payroll_bank_accounts"),
    () => paidSoFar(db, period),
  ]);
  const holidays = hols.map((h) => h.day);
  const structureOf = new Map(structures.map((x) => [lc(x.work_email), toStructure(x)]));
  const rulesOf = Object.fromEntries(rules.map((r) => [r.regime, r.rules]));
  const declOf = new Map(decls.map((d) => [lc(d.work_email), d]));
  const bankOf = new Map(banks.map((b) => [lc(b.work_email), b]));
  const by = (list, k = "work_email") => { const m = new Map(); for (const x of list) { const e = lc(x[k]); if (!m.has(e)) m.set(e, []); m.get(e).push(x); } return m; };
  const claimsOf = by(claims), adjOf = by(adjs);
  const lopOf = new Map();
  for (const r of lop) {
    const d = L.lopByMonth({ from: r.from_date, to: r.to_date, half: r.half, lopDays: num(r.lop_days) }, holidays)[period] || 0;
    lopOf.set(lc(r.work_email), (lopOf.get(lc(r.work_email)) || 0) + d);
  }

  return emps.map((e) => {
    const k = lc(e.work_email), inputs = (kept.get(k) && kept.get(k).inputs) || {};
    const structure = structureOf.get(k) || null;
    const decl = declOf.get(k);
    const regime = decl ? decl.regime : "new";
    const hold = !!inputs.hold;
    const myClaims = hold ? [] : claimsOf.get(k) || [];
    const myAdj = hold ? [] : (adjOf.get(k) || []).map((a) => ({ id: a.id, kind: a.kind, amount: num(a.amount), reason: a.reason, sourcePeriod: a.source_period }));
    const pay = (c) => Number(c.approved_amount ?? c.amount);   // only what HR approved is paid
    const bank = bankOf.get(k);
    const slip = computeLine({
      period,
      employee: { name: e.name, empNo: e.emp_no, title: e.title, dept: deptOf(e.dept, e.title), start: e.start_date, lastDay: e.last_day, pan: e.pan_masked,
        pfNumber: e.pf_number, paymentMode: bank || e.acct_masked ? "Bank Transfer" : null },
      structure, inputs, leaveLopDays: lopOf.get(k) || 0, claims: R(myClaims.reduce((n, c) => n + P(pay(c)), 0)), adjustments: myAdj,
      tax: { rules: rulesOf[regime] || null, regime, declaration: decl ? decl.declaration : {}, paidSoFar: withOpening(paid.get(k), decl && decl.declaration) },
    });
    if (!bank && !hold) slip.warnings.push("No salary bank account on file: this person can't be included in the bank file.");
    return {
      email: e.work_email, name: e.name, empNo: e.emp_no, dept: deptOf(e.dept, e.title), title: e.title, inputs, slip, structureId: structure ? structure.id : null,
      status: hold ? "hold" : slip.incomplete.length ? "incomplete" : "ready",
      claims: myClaims.map((c) => ({ id: c.id, claimNo: c.claim_no, amount: pay(c), status: c.status })), adjustments: myAdj,
    };
  });
}

/** Line summary as stored in payroll_items' own columns (kept for the payslip and reimbursement pages that read them). */
const columnsOf = (l) => {
  const s = l.slip.summary;
  return { base: s.fullMonthGross || null, lopDays: l.slip.days.lop, lop: s.lop, reimb: s.reimbursements, payable: l.status === "ready" ? s.net : 0 };
};

/**
 * Recalculates a run in an editable status and saves its lines: new joiners are added, people no longer on the payroll
 * are removed, everyone's inputs are kept. Reimbursements and adjustments are attached to ready lines and released
 * from lines on hold. Returns the lines.
 */
export async function recalcRun(client, run, actor) {
  const { rows: existing } = await client.query("SELECT id, work_email, inputs FROM payroll_items WHERE run_id=$1", [run.id]);
  const lines = await buildLines(client, run.period, run.id, existing);
  const keep = new Set(lines.map((l) => lc(l.email)));
  for (const i of existing) if (!keep.has(lc(i.work_email))) {
    await client.query("UPDATE reimbursements SET status='payroll_pending', payroll_run_id=NULL, updated_at=now() WHERE payroll_run_id=$1 AND lower(work_email)=lower($2) AND status='in_payroll'", [run.id, i.work_email]);
    await client.query("UPDATE payroll_adjustments SET applied_run_id=NULL WHERE applied_run_id=$1 AND lower(work_email)=lower($2)", [run.id, i.work_email]);
    await client.query("DELETE FROM payroll_items WHERE id=$1", [i.id]);
  }
  for (const l of lines) {
    const c = columnsOf(l);
    await client.query(
      `INSERT INTO payroll_items (run_id, work_email, base_salary, lop_days, lop_deduction, reimbursement_total, payable, slip, inputs, structure_id, calculated_at, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11)
       ON CONFLICT (run_id, lower(work_email)) DO UPDATE SET base_salary=EXCLUDED.base_salary, lop_days=EXCLUDED.lop_days, lop_deduction=EXCLUDED.lop_deduction,
         reimbursement_total=EXCLUDED.reimbursement_total, payable=EXCLUDED.payable, slip=EXCLUDED.slip, inputs=EXCLUDED.inputs, structure_id=EXCLUDED.structure_id,
         calculated_at=now(), updated_by=EXCLUDED.updated_by`,
      [run.id, l.email, c.base, c.lopDays, c.lop, c.reimb, c.payable, JSON.stringify(l.slip), JSON.stringify(l.inputs), l.structureId, actor]);
    const attach = l.status === "ready";
    if (attach) {
      for (const cl of l.claims)
        await client.query("UPDATE reimbursements SET status='in_payroll', payroll_run_id=$2, updated_at=now() WHERE id=$1 AND status='payroll_pending'", [cl.id, run.id]);
      for (const a of l.adjustments) await client.query("UPDATE payroll_adjustments SET applied_run_id=$2 WHERE id=$1 AND applied_run_id IS NULL", [a.id, run.id]);
    } else {
      await client.query("UPDATE reimbursements SET status='payroll_pending', payroll_run_id=NULL, updated_at=now() WHERE payroll_run_id=$1 AND lower(work_email)=lower($2) AND status='in_payroll'", [run.id, l.email]);
      await client.query("UPDATE payroll_adjustments SET applied_run_id=NULL WHERE applied_run_id=$1 AND lower(work_email)=lower($2)", [run.id, l.email]);
    }
  }
  const totals = totalsOfLines(lines);
  await client.query("UPDATE payroll_runs SET totals=$2 WHERE id=$1", [run.id, JSON.stringify(totals)]);
  return lines;
}

/** Run totals: only ready lines are paid; incomplete and on-hold lines are counted separately. */
export function totalsOfLines(lines) {
  const ready = lines.filter((l) => l.status === "ready");
  return { ...totalsOf(ready.map((l) => l.slip)), lines: lines.length, incomplete: lines.filter((l) => l.status === "incomplete").length,
    onHold: lines.filter((l) => l.status === "hold").length, overridden: lines.filter((l) => l.inputs && l.inputs.tdsOverride !== undefined).length };
}

/** A stored line as the pages and the Excel report read it. Bank details: only whether they exist and the last four digits. */
export function lineView(i, bank) {
  const slip = i.slip || {};
  const inputs = i.inputs || {};
  const status = inputs.hold ? "hold" : slip.incomplete && slip.incomplete.length ? "incomplete" : "ready";
  const e = slip.employee || {};
  return {
    id: i.id, email: i.work_email, name: i.name || e.name || i.work_email, empNo: i.emp_no || e.empNo || null, dept: e.dept || deptOf(i.dept, i.title), title: e.title || i.title || null,
    status, inputs, summary: slip.summary || summaryOfLegacy(slip, i), days: slip.days, tds: slip.tds, incomplete: slip.incomplete || [], warnings: slip.warnings || [],
    earnings: slip.earnings || [], contributions: slip.contributions || [], deductions: slip.deductions || [], employer: slip.employer || [], calc: slip.calc || [],
    calculatedAt: i.calculated_at, updatedBy: i.updated_by,
    bank: bank ? { onFile: true, last4: bank.acct_last4, bankName: bank.bank_name, ifsc: bank.ifsc, holder: bank.holder_name } : { onFile: false },
  };
}

/** A run with its lines, for the pages and the Excel report. */
export async function loadRun(db, id) {
  const { rows: [run] } = await db.query("SELECT * FROM payroll_runs WHERE id=$1", [id]);
  if (!run) return null;
  const [{ rows: items }, { rows: banks }] = await inTurn([
    () => db.query(`SELECT i.*, e.name, e.emp_no, e.dept, e.title FROM payroll_items i LEFT JOIN employees e ON lower(e.work_email)=lower(i.work_email)
              WHERE run_id=$1 ORDER BY e.name NULLS LAST, i.work_email`, [id]),
    () => db.query("SELECT work_email, acct_last4, holder_name, bank_name, ifsc FROM payroll_bank_accounts"),
  ]);
  const bankOf = new Map(banks.map((b) => [lc(b.work_email), b]));
  const lines = items.map((i) => lineView(i, bankOf.get(lc(i.work_email))));
  return { run, lines, totals: totalsOfLines(lines.map((l) => ({ ...l, slip: { summary: l.summary } }))) };
}
