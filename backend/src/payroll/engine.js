/*
 * One employee's salary for one month. Pure: no database, so every figure is testable (npm test).
 *
 * Money is handled in paise (integers) and turned back into rupees with two decimals only at the end, so sums never pick
 * up floating-point errors (0.1 + 0.2). Prorated components are rounded to whole rupees, as on the company payslips.
 *
 *   Gross earnings   = Basic + HRA + Allowances (prorated for days employed) + incentives, bonus, overtime, arrears,
 *                      other earnings + reimbursements
 *   Total deductions = PF (employee) + Professional tax + TDS + Loss of pay + other deductions
 *   Net payable      = Gross earnings − Total deductions
 * Employer contributions (employer PF) are shown for the cost to company and are never taken from take-home pay.
 *
 * The slip keeps the shape payslips.js already reads (earnings, contributions, deductions, totals, days), so the
 * employee's payslip and PDF keep working, and adds `summary`, `tds.breakdown` and `calc` for the payroll screens.
 */
import { payWindow, calculateTds as manualTds, TDS_THRESHOLD } from "../payroll-calc.js";
import { fyOf, monthsLeft, monthlyTds } from "./tax.js";

export const P = (rupees) => Math.round(Number(rupees || 0) * 100);   // rupees → paise
export const R = (paise) => paise / 100;                              // paise → rupees
const sumP = (list) => list.reduce((n, x) => n + x.p, 0);
const rupee = (paise) => Math.round(paise / 100) * 100;               // to whole rupees, in paise
const inr = (paise) => "₹" + R(paise).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const PF_WAGE_CEILING = 15000;   // EPF wage ceiling used when PF is worked out rather than entered
export const PF_RATE = 12;

/** Which payroll-table column an earning belongs to. */
export const kindOf = (name) => (/^\s*basic/i.test(name) ? "basic" : /^\s*(hra|house rent)/i.test(name) ? "hra" : "allowance");

/** Monthly inputs HR enters for one person. Returns { value } or { errors }. Amounts are rupees. */
export const INPUT_FIELDS = {
  incentives: "Incentives", bonus: "Bonus", overtime: "Overtime", otherEarnings: "Other earnings", reimbursements: "Reimbursements (manual)",
  additionalDeductions: "Additional deductions",
};
export function cleanInputs(body = {}, maxDays = 31) {
  const errors = {}, value = {};
  const money = (k, { signed = false } = {}) => {
    const raw = body[k];
    if (raw === "" || raw === null || raw === undefined) return;
    const n = Number(raw);
    if (!/^-?\d+(\.\d{1,2})?$/.test(String(raw).trim()) || !Number.isFinite(n) || Math.abs(n) >= 1e8 || (!signed && n < 0)) {
      errors[k] = signed ? "Enter an amount in rupees (use − for a reduction)." : "Enter an amount in rupees, 0 or more.";
      return;
    }
    if (n) value[k] = Math.round(n * 100) / 100;
  };
  for (const k of Object.keys(INPUT_FIELDS)) money(k);
  money("adjustment", { signed: true });
  const text = (k, max) => { const s = String(body[k] ?? "").trim().slice(0, max); if (s) value[k] = s; };
  text("adjustmentReason", 200); text("additionalDeductionsReason", 200); text("note", 500); text("otherEarningsReason", 200);
  if (value.adjustment && !value.adjustmentReason) errors.adjustmentReason = "Say why the salary is adjusted.";
  if (value.additionalDeductions && !value.additionalDeductionsReason) errors.additionalDeductionsReason = "Say what is deducted.";
  if (body.lopDays !== "" && body.lopDays !== null && body.lopDays !== undefined) {
    const d = Number(body.lopDays);
    if (!Number.isFinite(d) || d < 0 || d > maxDays || Math.round(d * 2) !== d * 2) errors.lopDays = `Enter days from 0 to ${maxDays}, in half days.`;
    else if (d) value.lopDays = d;
  }
  if (body.tdsOverride !== "" && body.tdsOverride !== null && body.tdsOverride !== undefined) {
    const t = Number(body.tdsOverride);
    if (!Number.isFinite(t) || t < 0 || t >= 1e8) errors.tdsOverride = "Enter the TDS in rupees, 0 or more.";
    else {
      value.tdsOverride = Math.round(t * 100) / 100;
      const why = String(body.tdsOverrideReason ?? "").trim().slice(0, 300);
      if (why.length < 5) errors.tdsOverrideReason = "A reason is required to override the calculated TDS.";
      else value.tdsOverrideReason = why;
    }
  }
  return Object.keys(errors).length ? { errors } : { value };
}

/**
 * Builds the month's salary for one employee.
 *   period         "2026-11"
 *   employee       { name, empNo, title, dept, start, lastDay, pan, pfNumber, paymentMode }
 *   structure      salary structure in force (see payroll.js toStructure) or null
 *   inputs         HR's monthly inputs (cleanInputs value)
 *   leaveLopDays   loss-of-pay days from approved leave
 *   claims         approved reimbursement claims paid with this month, in rupees
 *   adjustments    [{ id, kind: 'earning'|'deduction', amount, reason, sourcePeriod }] corrections to earlier months
 *   tax            { rules, regime, declaration, paidSoFar: { taxable, tds, pt } } (rules null = not configured)
 *   lopDivisor     days in the loss-of-pay divisor (leave policy: 30)
 */
export function computeLine({ period, employee = {}, structure, inputs = {}, leaveLopDays = 0, claims = 0, adjustments = [], tax = {}, lopDivisor = 30 }) {
  const calc = [], incomplete = [], warnings = [];
  const w = payWindow(period, employee.start, employee.lastDay);
  if (!structure || !structure.earnings || !structure.earnings.length) incomplete.push("Salary breakdown is not set.");
  const s = structure || { earnings: [] };
  const share = w.total ? w.days / w.total : 0;

  // 1. Fixed earnings, prorated for the days employed.
  const fixedFull = s.earnings.map((e) => ({ name: e.name, kind: kindOf(e.name), p: P(e.amount) })).filter((e) => e.p);
  const fullGrossP = sumP(fixedFull);
  const fixed = fixedFull.map((e) => ({ ...e, p: share === 1 ? e.p : rupee(e.p * share) }));
  if (share < 1) calc.push(`Employed ${w.days} of ${w.total} days: fixed earnings ${inr(fullGrossP)} × ${w.days}/${w.total} = ${inr(sumP(fixed))}.`);
  else if (fullGrossP) calc.push(`Full month: fixed earnings ${inr(fullGrossP)}.`);

  // 2. Variable earnings for this month.
  const variable = [];
  const addVar = (name, rupees, kind = "other", taxable = true) => { const p = P(rupees); if (p) variable.push({ name, kind, p, taxable }); };
  addVar("Incentives", inputs.incentives);
  addVar("Bonus", inputs.bonus);
  addVar("Overtime", inputs.overtime);
  addVar(inputs.otherEarningsReason ? `Other earnings: ${inputs.otherEarningsReason}` : "Other earnings", inputs.otherEarnings);
  if (Number(inputs.adjustment) > 0) addVar(`Salary adjustment: ${inputs.adjustmentReason}`, inputs.adjustment);
  for (const a of adjustments) if (a.kind === "earning") addVar(`Arrears for ${a.sourcePeriod}: ${a.reason}`, a.amount);
  const reimbP = P(claims) + P(inputs.reimbursements);
  if (reimbP) variable.push({ name: "Reimbursements (Ad Hoc)", kind: "reimbursement", p: reimbP, taxable: false });

  const earnings = [...fixed, ...variable];
  const grossP = sumP(earnings);
  const basicP = sumP(fixed.filter((e) => e.kind === "basic")), hraP = sumP(fixed.filter((e) => e.kind === "hra"));
  const allowP = sumP(fixed.filter((e) => e.kind === "allowance"));
  const otherEarnP = sumP(variable);
  calc.push(`Gross earnings = Basic ${inr(basicP)} + HRA ${inr(hraP)} + Allowances ${inr(allowP)} + other earnings ${inr(otherEarnP)} = ${inr(grossP)}.`);

  // 3. Loss of pay: the policy's monthly gross ÷ 30 per day, on the full month's fixed gross.
  const lopDays = Math.min(w.days, Number(leaveLopDays || 0) + Number(inputs.lopDays || 0));
  const lopP = lopDays && fullGrossP ? P(Math.round((R(fullGrossP) / lopDivisor) * lopDays)) : 0;
  if (lopDays) calc.push(`Loss of pay ${lopDays} day${lopDays === 1 ? "" : "s"} (${leaveLopDays || 0} from approved leave, ${inputs.lopDays || 0} entered): ${inr(fullGrossP)} ÷ ${lopDivisor} × ${lopDays} = ${inr(lopP)}.`);

  // 4. PF. Entered amount (prorated in a partial month), or 12% of earned Basic up to the wage ceiling.
  const pfApplicable = s.pfApplicable ?? Number(s.pfEmployee) > 0;
  let pfP = 0, employerPfP = 0;
  if (pfApplicable && w.days) {
    const ceilingP = P(PF_WAGE_CEILING);
    // Basic actually earned: prorated Basic less its share of loss of pay (full-month Basic ÷ 30 × LOP days).
    const fullBasicP = sumP(fixedFull.filter((e) => e.kind === "basic"));
    const earnedBasicP = Math.max(0, basicP - (lopDays ? rupee(fullBasicP * lopDays / lopDivisor) : 0));
    const auto = rupee(Math.min(earnedBasicP, ceilingP) * PF_RATE / 100);
    pfP = Number(s.pfEmployee) > 0 ? (share === 1 ? P(s.pfEmployee) : rupee(P(s.pfEmployee) * share)) : auto;
    employerPfP = Number(s.employerPf) > 0 ? (share === 1 ? P(s.employerPf) : rupee(P(s.employerPf) * share)) : pfP;
    calc.push(Number(s.pfEmployee) > 0 ? `PF (employee) as set on the salary structure: ${inr(pfP)}.` : `PF (employee) = 12% of Basic earned ${inr(Math.min(earnedBasicP, ceilingP))} (wage ceiling ₹15,000) = ${inr(pfP)}.`);
  }

  // 5. Professional tax, as set on the structure (state slab amount; Maharashtra takes ₹300 instead of ₹200 in February).
  const ptApplicable = s.ptApplicable ?? Number(s.professionalTax) > 0;
  const ptMonthly = period.slice(5) === "02" && Number(s.ptFebruary) > 0 ? s.ptFebruary : s.professionalTax;
  const ptP = ptApplicable && w.days ? P(ptMonthly) : 0;
  if (ptApplicable && !ptP && structure && w.days) warnings.push("Professional tax applies but no amount is set.");

  // 6. Other deductions: from the structure, HR's monthly input, recoveries for earlier months, negative adjustments.
  const other = [];
  for (const d of s.otherDeductions || []) if (P(d.amount)) other.push({ name: d.name, p: P(d.amount) });
  if (P(inputs.additionalDeductions)) other.push({ name: `Additional deduction: ${inputs.additionalDeductionsReason}`, p: P(inputs.additionalDeductions) });
  if (Number(inputs.adjustment) < 0) other.push({ name: `Salary adjustment: ${inputs.adjustmentReason}`, p: -P(inputs.adjustment) });
  for (const a of adjustments) if (a.kind === "deduction") other.push({ name: `Recovery for ${a.sourcePeriod}: ${a.reason}`, p: P(a.amount) });
  const otherP = sumP(other);

  // 7. TDS.
  const taxableP = sumP(earnings.filter((e) => e.taxable !== false)) - lopP;
  const fy = fyOf(period);
  let tds = { applicable: false, mode: s.tdsMode || "auto", amount: 0, calculated: 0, override: null, breakdown: null };
  const mode = s.tdsMode || (s.tdsMonthly !== null && s.tdsMonthly !== undefined && s.tdsMonthly !== "" ? "manual" : "auto");
  tds.mode = mode;
  if (structure && w.days) {
    if (s.tdsApplicable === false) {
      calc.push("TDS: not applicable for this employee (set on the salary structure).");
    } else if (mode === "manual") {
      const annual = R(fullGrossP) * 12;
      const m = manualTds({ annualIncome: annual, structure: s });
      tds = { ...tds, applicable: m.applicable, calculated: P(m.amount) };
      if (m.missing) incomplete.push("Income above ₹12,00,000 a year, but the monthly TDS has not been entered.");
      calc.push(m.applicable ? `TDS: monthly amount entered on the salary structure, ${inr(P(m.amount))}.` : `TDS: annual income ${inr(fullGrossP * 12)} is not above ${inr(P(TDS_THRESHOLD))}, so none.`);
    } else if (!tax.rules) {
      incomplete.push(`Tax rules for FY ${fy} (${tax.regime || "new"} regime) are not configured.`);
    } else {
      const lastMonth = employee.lastDay ? String(employee.lastDay).slice(0, 7) : null;
      let after = monthsLeft(period) - 1;
      if (lastMonth && lastMonth > period && fyOf(lastMonth) === fy) after = Math.min(after, monthsBetween(period, lastMonth));
      if (lastMonth && lastMonth <= period) after = 0;
      const paid = tax.paidSoFar || { taxable: 0, tds: 0, pt: 0 };
      const annualPt = R(P(paid.pt || 0) + ptP * (after + 1));
      const t = monthlyTds({ rules: tax.rules, regime: tax.regime, fy, period, paidSoFar: paid, thisMonthTaxable: R(taxableP), regularMonthly: R(fullGrossP),
        monthsAfter: after, declaration: tax.declaration || {}, annualProfessionalTax: annualPt });
      tds = { ...tds, applicable: t.breakdown.annualTax > 0, calculated: P(t.amount), breakdown: t.breakdown };
      calc.push(`TDS (${tax.regime} regime, FY ${fy}): projected taxable income ${inr(P(t.breakdown.taxableIncome))}, tax for the year ${inr(P(t.breakdown.annualTax))}, already deducted ${inr(P(t.breakdown.tdsDeductedSoFar + t.breakdown.previousEmployerTds))}, spread over ${t.breakdown.monthsIncludingThis} month${t.breakdown.monthsIncludingThis === 1 ? "" : "s"} = ${inr(P(t.amount))}.`);
    }
    tds.amount = tds.calculated;
    if (inputs.tdsOverride !== undefined && inputs.tdsOverride !== null) {
      tds.override = { amount: inputs.tdsOverride, reason: inputs.tdsOverrideReason, calculated: R(tds.calculated) };
      tds.amount = P(inputs.tdsOverride);
      tds.applicable = tds.amount > 0 || tds.applicable;
      calc.push(`TDS overridden by HR: ${inr(tds.amount)} instead of ${inr(tds.calculated)} (${inputs.tdsOverrideReason}).`);
    }
  }

  // 8. Totals.
  const deductionLines = [];
  if (ptP) deductionLines.push({ name: "Professional Tax", p: ptP, code: "pt" });
  if (tds.amount) deductionLines.push({ name: "Total Income Tax", p: tds.amount, code: "tds" });
  for (const o of other) deductionLines.push({ ...o, code: "other" });
  if (lopP) deductionLines.push({ name: `Loss of Pay (${lopDays} day${lopDays === 1 ? "" : "s"})`, p: lopP, code: "lop" });
  const dedP = sumP(deductionLines);
  const totalDedP = pfP + dedP;
  const netP = grossP - totalDedP;
  calc.push(`Total deductions = PF ${inr(pfP)} + PT ${inr(ptP)} + TDS ${inr(tds.amount)} + Loss of pay ${inr(lopP)} + other ${inr(otherP)} = ${inr(totalDedP)}.`);
  calc.push(`Net payable = ${inr(grossP)} − ${inr(totalDedP)} = ${inr(netP)}.`);
  if (employerPfP) calc.push(`Employer PF ${inr(employerPfP)} is paid by the company on top and is not deducted from take-home pay.`);
  if (structure && w.days && netP < 0) incomplete.push("Deductions are more than the earnings for this month.");
  else if (structure && w.days && netP === 0) incomplete.push("Net pay is zero this month: put this salary on hold.");
  if (!w.days && structure) warnings.push("Not employed on any day of this month.");

  const out = (l) => l.map((x) => ({ name: x.name, amount: R(x.p), ...(x.kind ? { kind: x.kind } : {}), ...(x.code ? { code: x.code } : {}) }));
  return {
    v: 2, period, fy, employee, structureId: structure && structure.id ? structure.id : null,
    days: { total: w.total, actual: w.days, lop: lopDays, payable: Math.max(0, w.days - lopDays) },
    earnings: out(earnings),
    contributions: pfP ? [{ name: "PF Employee", amount: R(pfP) }] : [],
    deductions: out(deductionLines),
    employer: employerPfP ? [{ name: "PF Employer", amount: R(employerPfP) }] : [],
    totals: { earnings: R(grossP), contributions: R(pfP), deductions: R(dedP), totalDeductions: R(totalDedP), net: R(netP) },
    summary: {
      basic: R(basicP), hra: R(hraP), allowances: R(allowP), otherEarnings: R(otherEarnP), reimbursements: R(reimbP), gross: R(grossP),
      pf: R(pfP), pt: R(ptP), tds: R(tds.amount), lop: R(lopP), otherDeductions: R(otherP), totalDeductions: R(totalDedP), net: R(netP),
      employerPf: R(employerPfP), taxable: R(taxableP), fullMonthGross: R(fullGrossP),
    },
    annualIncome: R(fullGrossP * 12),
    tds: { applicable: tds.applicable, mode: tds.mode, amount: R(tds.amount), calculated: R(tds.calculated), override: tds.override, breakdown: tds.breakdown },
    adjustments: adjustments.map((a) => a.id),
    calc, incomplete, warnings,
  };
}

const monthsBetween = (a, b) => { const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number); return (yb - ya) * 12 + (mb - ma); };

/** Totals of many lines, in rupees (added in paise). */
export function totalsOf(slips) {
  const keys = ["basic", "hra", "allowances", "otherEarnings", "reimbursements", "gross", "pf", "pt", "tds", "lop", "otherDeductions", "totalDeductions", "net", "employerPf"];
  const t = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const s of slips) for (const k of keys) t[k] += P(s.summary ? s.summary[k] : 0);
  return { people: slips.length, ...Object.fromEntries(keys.map((k) => [k, R(t[k])])) };
}

/** A v1 slip (made before this engine) read the same way, for history and year-to-date tax. */
export function summaryOfLegacy(slip, item = {}) {
  if (slip && slip.summary) return slip.summary;
  const s = slip || { earnings: [], contributions: [], deductions: [], totals: {} };
  const amt = (l, re) => (l || []).filter((x) => re.test(x.name)).reduce((n, x) => n + P(x.amount), 0);
  const gross = P(s.totals.earnings ?? item.base_salary ?? 0), reimb = amt(s.earnings, /^Reimbursement/i);
  const lop = amt(s.deductions, /^Loss of Pay/i) || P(item.lop_deduction || 0);
  const basic = amt(s.earnings, /^\s*basic/i), hra = amt(s.earnings, /^\s*(hra|house rent)/i);
  const pf = P(s.totals.contributions || 0), pt = amt(s.deductions, /^Professional Tax/i), tds = amt(s.deductions, /Income Tax/i);
  const totalDed = pf + P(s.totals.deductions || 0);
  return { basic: R(basic), hra: R(hra), allowances: R(gross - basic - hra - reimb), otherEarnings: R(reimb), reimbursements: R(reimb), gross: R(gross),
    pf: R(pf), pt: R(pt), tds: R(tds), lop: R(lop), otherDeductions: R(totalDed - pf - pt - tds - lop), totalDeductions: R(totalDed),
    net: R(P(item.payable ?? s.totals.net ?? 0)), employerPf: 0, taxable: R(gross - reimb - lop), fullMonthGross: R(gross - reimb) };
}
