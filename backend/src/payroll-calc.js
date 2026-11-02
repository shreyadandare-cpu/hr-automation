/*
 * Payslip calculation. Pure functions only: no database, so the numbers can be tested on their own (npm test).
 *
 *   buildSlip()
 *     ├─ grossOf()            fixed monthly earnings from the salary structure HR entered
 *     ├─ payWindow()          days in the month the person was employed (joined or left mid-month)
 *     ├─ annualIncome()       fixed monthly earnings × 12
 *     ├─ isTdsApplicable()    eligibility only: annual income above ₹12,00,000
 *     └─ calculateTds()       the amount. Replace its body when the CA gives the tax rules; nothing else changes.
 *
 * Nothing here invents a salary figure. Every amount comes from the salary structure HR entered, from approved leave
 * (loss of pay) or from approved reimbursements. Anything missing is listed in slip.incomplete and the payslip is not issued.
 */

export const TDS_THRESHOLD = 1200000;   // annual income up to this pays no TDS

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const sum = (list) => round2(list.reduce((n, x) => n + Number(x.amount || 0), 0));

/** Fixed monthly earnings (Basic, HRA, allowances…) before proration and reimbursements. */
export const grossOf = (earnings = []) => sum(earnings);

export const annualIncome = (structure) => round2(grossOf(structure.earnings) * 12);

/** TDS eligibility, kept apart from the amount. */
export const isTdsApplicable = (annual) => Number(annual) > TDS_THRESHOLD;

/**
 * The monthly TDS. Returns { applicable, amount, missing }.
 * For now the amount is the monthly TDS the payroll team works out with the CA and enters on the salary structure
 * (structure.tdsMonthly). No rate or slab is assumed here. When the CA's rules arrive, compute `amount` from
 * { annualIncome, structure, period } instead; callers only read these three fields.
 */
export function calculateTds({ annualIncome: annual, structure }) {
  if (!isTdsApplicable(annual)) return { applicable: false, amount: 0, missing: false };
  const entered = structure.tdsMonthly;
  if (entered === null || entered === undefined || entered === "") return { applicable: true, amount: 0, missing: true };
  return { applicable: true, amount: round2(entered), missing: false };
}

const daysIn = (period) => { const [y, m] = period.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const iso = (d) => (d ? (typeof d === "string" ? d.slice(0, 10) : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)) : null);

/** Calendar days of the month the person was employed: all of them, or fewer when they joined or left during it. */
export function payWindow(period, start, lastDay) {
  const total = daysIn(period), first = `${period}-01`, last = `${period}-${String(total).padStart(2, "0")}`;
  const from = iso(start) && iso(start) > first ? iso(start) : first;
  const to = iso(lastDay) && iso(lastDay) < last ? iso(lastDay) : last;
  const days = to < from ? 0 : Number(to.slice(8)) - Number(from.slice(8)) + 1;
  return { total, days };
}

/**
 * One person's payslip for one month, as stored with the payroll run.
 *   structure    { earnings:[{name,amount}], pfEmployee, professionalTax, otherDeductions:[{name,amount}], tdsMonthly } or null
 *   lopDays, lopDeduction   from approved leave (worked out by leave-rules salaryCut)
 *   reimbursement           approved claims paid with this run
 */
export function buildSlip({ period, employee = {}, structure, start, lastDay, lopDays = 0, lopDeduction = 0, reimbursement = 0 }) {
  const w = payWindow(period, start, lastDay);
  const incomplete = [];
  if (!structure || !structure.earnings || !structure.earnings.length) incomplete.push("Salary breakdown is not set.");
  const s = structure || { earnings: [] };
  const share = w.total ? w.days / w.total : 0;
  const earnings = s.earnings.filter((e) => Number(e.amount)).map((e) => ({ name: e.name, amount: share === 1 ? round2(e.amount) : Math.round(e.amount * share) }));
  if (reimbursement) earnings.push({ name: "Reimbursements (Ad Hoc)", amount: round2(reimbursement) });

  const annual = annualIncome(s);
  const tds = calculateTds({ annualIncome: annual, structure: s, period });
  if (structure && tds.missing) incomplete.push("Income above ₹12,00,000 a year, but the monthly TDS has not been entered.");

  const contributions = Number(s.pfEmployee) ? [{ name: "PF Employee", amount: round2(s.pfEmployee) }] : [];
  const deductions = [];
  if (Number(s.professionalTax)) deductions.push({ name: "Professional Tax", amount: round2(s.professionalTax) });
  if (tds.applicable && tds.amount) deductions.push({ name: "Total Income Tax", amount: tds.amount });
  for (const d of s.otherDeductions || []) if (Number(d.amount)) deductions.push({ name: d.name, amount: round2(d.amount) });
  if (Number(lopDeduction)) deductions.push({ name: `Loss of Pay (${lopDays} day${Number(lopDays) === 1 ? "" : "s"})`, amount: round2(lopDeduction) });

  const totals = { earnings: sum(earnings), contributions: sum(contributions), deductions: sum(deductions) };
  totals.net = round2(totals.earnings - totals.contributions - totals.deductions);
  if (structure && totals.net < 0) incomplete.push("Deductions are more than the earnings for this month.");
  return {
    v: 1, period, employee,
    days: { total: w.total, actual: w.days, lop: Number(lopDays) || 0, payable: Math.max(0, w.days - (Number(lopDays) || 0)) },
    earnings, contributions, deductions, totals,
    annualIncome: annual, tds: { applicable: tds.applicable, amount: tds.amount },
    incomplete,
  };
}

/** Checks a salary structure HR sends. Returns { value } or { errors }. */
export function cleanStructure(body = {}) {
  const errors = {};
  const money = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  const okAmount = (n) => n !== null && Number.isFinite(n) && n >= 0 && n < 1e8;
  const lines = (list, key) => {
    if (!Array.isArray(list)) return [];
    const out = [];
    list.forEach((x, i) => {
      const name = String((x && x.name) || "").trim().slice(0, 60), amount = money(x && x.amount);
      if (!name && amount === null) return;
      if (!name) errors[`${key}.${i}`] = "Give this line a name.";
      else if (!okAmount(amount)) errors[`${key}.${i}`] = "Enter an amount in rupees.";
      else out.push({ name, amount: round2(amount) });
    });
    return out;
  };
  const effectiveFrom = String(body.effectiveFrom || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(effectiveFrom)) errors.effectiveFrom = "Pick the first month this salary applies to.";
  const earnings = lines(body.earnings, "earnings");
  if (!earnings.length && !Object.keys(errors).some((k) => k.startsWith("earnings"))) errors.earnings = "Add at least one earning, such as Basic.";
  const otherDeductions = lines(body.otherDeductions, "otherDeductions");
  const pick = (k, label) => {
    const n = money(body[k]);
    if (n !== null && !okAmount(n)) errors[k] = `Enter ${label} in rupees, or leave it empty.`;
    return n;
  };
  const pfEmployee = pick("pfEmployee", "the PF amount"), professionalTax = pick("professionalTax", "the professional tax"), tdsMonthly = pick("tdsMonthly", "the monthly TDS");
  // Left out of the request: the PF number on file is kept.
  const pfNumber = body.pfNumber === undefined ? undefined : String(body.pfNumber || "").trim().slice(0, 30) || null;
  if (pfNumber && !/^[A-Za-z0-9/ -]+$/.test(pfNumber)) errors.pfNumber = "Use letters, numbers, / or - only.";
  return Object.keys(errors).length ? { errors }
    : { value: { effectiveFrom, earnings, otherDeductions, pfEmployee: pfEmployee || 0, professionalTax: professionalTax || 0, tdsMonthly, pfNumber } };
}

/** The month (YYYY-MM) a moment falls in, India time. */
export const istMonth = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 7);
export const previousMonth = (p) => { const [y, m] = p.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };

const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** "2026-09", "2026-09-01", "09/2026", "Sep 2026" or "Sep-26" (how a spreadsheet may show the month) as "2026-09". */
export function monthOf(v) {
  const s = String(v ?? "").trim().toLowerCase();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})(-\d{1,2})?$/))) return `${m[1]}-${m[2].padStart(2, "0")}`;
  if ((m = s.match(/^(\d{1,2})[/-](\d{4})$/))) return `${m[2]}-${m[1].padStart(2, "0")}`;
  if ((m = s.match(/^([a-z]{3})[a-z]*[\s/-]+(\d{2}|\d{4})$/)) && MON.includes(m[1])) return `${m[2].length === 2 ? "20" + m[2] : m[2]}-${String(MON.indexOf(m[1]) + 1).padStart(2, "0")}`;
  return s;   // left as typed, so cleanStructure reports it
}

const COLUMNS = {
  email: ["email", "work email", "employee email", "email id"],
  effectiveFrom: ["applies from", "effective from", "month", "from month"],
  pfEmployee: ["pf employee", "pf", "pf contribution", "employee pf"],
  professionalTax: ["professional tax", "pt"],
  tdsMonthly: ["monthly tds", "tds", "tds monthly", "income tax", "total income tax"],
  pfNumber: ["pf number", "pf no", "uan"],
  skip: ["name", "employee name", "employee", "emp no", "employee no", "employee id", "designation", "department"],
};
const colKey = (h) => String(h).trim().toLowerCase().replace(/[_\s]+/g, " ");
const amountText = (v) => String(v ?? "").replace(/[₹,\s]/g, "");

/**
 * One spreadsheet row ({ header: value }) as { email, body }, where body is what cleanStructure checks.
 * Known columns are above (any of the listed headers, any case). A column starting "Deduction:" is another deduction.
 * Every other column with a value is an earning named by its header: Basic, HRA, Special Allowance… An empty PF number
 * cell keeps the PF number on file.
 */
export function structureFromRow(row = {}) {
  const body = { earnings: [], otherDeductions: [] };
  let email = "";
  for (const [h, raw] of Object.entries(row)) {
    const k = colKey(h), v = String(raw ?? "").trim();
    const is = (field) => COLUMNS[field].includes(k);
    if (is("email")) email = v.toLowerCase();
    else if (is("effectiveFrom")) body.effectiveFrom = monthOf(v);
    else if (is("pfNumber")) { if (v) body.pfNumber = v; }
    else if (is("pfEmployee")) body.pfEmployee = amountText(v);
    else if (is("professionalTax")) body.professionalTax = amountText(v);
    else if (is("tdsMonthly")) body.tdsMonthly = amountText(v);
    else if (is("skip") || !k) continue;
    else if (k.startsWith("deduction:")) { if (v) body.otherDeductions.push({ name: String(h).trim().slice(10).trim(), amount: amountText(v) }); }
    else if (v) body.earnings.push({ name: String(h).trim(), amount: amountText(v) });
  }
  return { email, body };
}
