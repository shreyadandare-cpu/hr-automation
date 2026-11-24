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
import { ageInYear, fyMonths, fyOf, monthsLeft, monthlyTds } from "./tax.js";

export const P = (rupees) => Math.round(Number(rupees || 0) * 100);   // rupees → paise
export const R = (paise) => paise / 100;                              // paise → rupees
const sumP = (list) => list.reduce((n, x) => n + x.p, 0);
const rupee = (paise) => Math.round(paise / 100) * 100;               // to whole rupees, in paise
const inr = (paise) => "₹" + R(paise).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const PF_WAGE_CEILING = 15000;   // EPF wage ceiling used when PF is worked out rather than entered
export const PF_RATE = 12;
/** A full month's employee PF from a salary structure, in rupees: the amount set on it, or 12% of Basic up to the wage ceiling. */
export function monthlyPfOf(s = {}) {
  if (!(s.pfApplicable ?? Number(s.pfEmployee) > 0)) return 0;
  if (Number(s.pfEmployee) > 0) return Number(s.pfEmployee);
  const basic = (s.earnings || []).filter((e) => kindOf(e.name) === "basic").reduce((n, e) => n + (Number(e.amount) || 0), 0);
  return Math.round(Math.min(basic, PF_WAGE_CEILING) * PF_RATE) / 100;
}

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
 *   overtimeApprovedMinutes  overtime approved for the month (shifts.js). Shown only: overtime is paid as HR enters it, never by itself.
 *   advanceRecoveries  this month's instalments of advances and loans [{ id, reason, amount }] (clearance.js advanceInstalments)
 */
export function computeLine({ period, employee = {}, structure, inputs = {}, leaveLopDays = 0, claims = 0, adjustments = [], tax = {}, lopDivisor = 30, overtimeApprovedMinutes = 0, advanceRecoveries = [] }) {
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
  // Approved overtime is told to payroll, not paid: the company pays it only as HR types the amount (decision, 2026-11-24).
  if (overtimeApprovedMinutes > 0) {
    const h = Math.floor(overtimeApprovedMinutes / 60), m = overtimeApprovedMinutes % 60, text = h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
    calc.push(`Overtime approved for this month: ${text}. It is paid only as entered under Overtime${Number(inputs.overtime) > 0 ? `: ${inr(P(inputs.overtime))}` : "; nothing is entered, so nothing is paid"}.`);
    if (!(Number(inputs.overtime) > 0)) warnings.push(`${text} of overtime was approved for this month. Enter the amount under Overtime to pay it, or leave it empty to pay nothing.`);
  }
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
  // An intern is paid a stipend with nothing taken off: no PF, ESIC, professional tax or TDS, whatever an old structure says. When they become an employee,
  // the type is changed on their profile and the next salary structure carries the usual deductions.
  const intern = employee.employmentType === "Intern";
  const pfApplicable = !intern && (s.pfApplicable ?? Number(s.pfEmployee) > 0);
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

  // 4b. ESIC (employee): the amount entered on the salary structure, prorated in a partial month like PF. No rate is assumed.
  const esicP = !intern && Number(s.esicEmployee) > 0 && w.days ? (share === 1 ? P(s.esicEmployee) : rupee(P(s.esicEmployee) * share)) : 0;
  if (esicP) calc.push(`ESIC (employee) as set on the salary structure: ${inr(esicP)}.`);

  // 5. Professional tax, as set on the structure (state slab amount; Maharashtra takes ₹300 instead of ₹200 in February).
  const ptApplicable = !intern && (s.ptApplicable ?? Number(s.professionalTax) > 0);
  const ptMonthly = period.slice(5) === "02" && Number(s.ptFebruary) > 0 ? s.ptFebruary : s.professionalTax;
  const ptP = ptApplicable && w.days ? P(ptMonthly) : 0;
  if (ptApplicable && !ptP && structure && w.days) warnings.push("Professional tax applies but no amount is set.");

  // 6. Other deductions: from the structure, HR's monthly input, recoveries for earlier months, negative adjustments.
  const other = [];
  for (const d of s.otherDeductions || []) if (P(d.amount)) other.push({ name: d.name, p: P(d.amount) });
  if (P(inputs.additionalDeductions)) other.push({ name: `Additional deduction: ${inputs.additionalDeductionsReason}`, p: P(inputs.additionalDeductions) });
  if (Number(inputs.adjustment) < 0) other.push({ name: `Salary adjustment: ${inputs.adjustmentReason}`, p: -P(inputs.adjustment) });
  for (const a of adjustments) if (a.kind === "deduction") other.push({ name: `Recovery for ${a.sourcePeriod}: ${a.reason}`, p: P(a.amount) });
  // Advance and loan instalments, as Keka deducts them: the month's instalment or what is still owed, recorded when the month is approved.
  for (const a of advanceRecoveries) if (P(a.amount) > 0) {
    other.push({ name: a.loan ? "Company Loan Repayment" : `Advance recovery: ${a.reason}`, p: P(a.amount), advanceId: a.id });
    calc.push(a.loan ? `Company loan repayment ${inr(P(a.amount))} (the monthly instalment of the approved loan, or what is still owed if less).` : `Advance recovery ${inr(P(a.amount))} for "${a.reason}" (the monthly instalment, or what is still owed if less).`);
  }
  const otherP = sumP(other);

  // 7. TDS.
  const taxableP = sumP(earnings.filter((e) => e.taxable !== false)) - lopP;
  const fy = fyOf(period);
  let tds = { applicable: false, mode: s.tdsMode || "auto", amount: 0, calculated: 0, override: null, breakdown: null };
  const mode = s.tdsMode || (s.tdsMonthly !== null && s.tdsMonthly !== undefined && s.tdsMonthly !== "" ? "manual" : "auto");
  tds.mode = mode;
  // The year's income for the ₹12,00,000 rule: this salary for a year, plus what was earned elsewhere in the year (a previous
  // employer's salary and other income the person declared). Without the second part a mid-year joiner pays no TDS here
  // although the year as a whole is taxable. The rule is the new regime's: there, income up to ₹12,00,000 carries no tax. Under
  // the old regime tax is owed well below it (the rebate stops at ₹5,00,000), so TDS is always worked out, as Keka does.
  const oldRegime = tax.regime === "old";
  const decl = tax.declaration || {};
  if (tax.source === "employee") {
    calc.push("Tax details: from the employee's own declaration (Pay > Tax declaration), with HR's proof decisions applied; payroll has not entered tax details for this person.");
    if (tax.hra && tax.hra.exemption) calc.push(`HRA exemption ${inr(P(tax.hra.exemption))}: the least of HRA received ${inr(P(tax.hra.received))}, rent ${inr(P(tax.hra.rent))} less 10% of Basic ${inr(P(tax.hra.basic))}, and ${tax.hra.metro ? "50" : "40"}% of Basic.`);
    if (tax.lta && tax.lta.exemption) calc.push(`Leave travel exemption ${inr(P(tax.lta.exemption))}: the fares claimed ${inr(P(tax.lta.fares))}, up to the leave travel allowance for the year ${inr(P(tax.lta.received))}.`);
  }
  const elsewhereP = P(Number(decl.previousEmployerIncome) || 0) + P(Number(decl.otherIncome) || 0);
  const yearIncomeP = fullGrossP * 12 + elsewhereP;
  const yearIncomeText = elsewhereP ? `${inr(yearIncomeP)} (this salary ${inr(fullGrossP * 12)} + earned elsewhere this year ${inr(elsewhereP)})` : inr(yearIncomeP);
  if (structure && w.days) {
    if (intern) {
      calc.push("TDS: none for an intern (stipend, nothing is deducted).");
    } else if (s.tdsApplicable === false) {
      calc.push("TDS: not applicable for this employee (set on the salary structure).");
    } else if (mode === "manual") {
      const m = manualTds({ annualIncome: R(yearIncomeP), structure: s, always: oldRegime });
      tds = { ...tds, applicable: m.applicable, calculated: P(m.amount) };
      if (m.missing) incomplete.push("Income above ₹12,00,000 a year, but the monthly TDS has not been entered.");
      calc.push(m.applicable ? `TDS: monthly amount entered on the salary structure, ${inr(P(m.amount))}.` : `TDS: annual income ${yearIncomeText} is not above ${inr(P(TDS_THRESHOLD))}, so none.`);
      // A fixed amount is not worked out from the declaration, so the previous employer's figures change nothing. Say so.
      if (["previousEmployerIncome", "previousEmployerTds", "openingTaxable", "openingTds"].some((k) => Number(decl[k]) > 0)) {
        warnings.push("TDS is a fixed monthly amount on the salary structure, so the previous employer's salary and TDS (and any opening figures) declared for this year are not used. Change the structure to calculated TDS to use them.");
      }
    } else if (!tax.rules) {
      // Without the year's rules nothing can be worked out; under the new regime a salary of ₹12,00,000 a year or less owes nothing anyway.
      if (!oldRegime && yearIncomeP <= P(TDS_THRESHOLD)) calc.push(`TDS: annual income ${yearIncomeText} is not above ${inr(P(TDS_THRESHOLD))}, which is tax-free under the new regime, so none.`);
      else incomplete.push(`Tax rules for FY ${fy} (${tax.regime || "new"} regime) are not configured.`);
    } else {
      // Always worked out from the year's actual figures, as Keka does: salary paid so far, this month with any bonus or arrears, the
      // months to come and income from elsewhere. Under the new regime the rebate brings the tax to nil when taxable income is
      // ₹12,00,000 or less, so most such salaries still get no TDS; a bonus or a higher salary earlier in the year can still make tax due.
      const lastMonth = employee.lastDay ? String(employee.lastDay).slice(0, 7) : null;
      const leaving = Boolean(lastMonth) && fyOf(lastMonth) === fy;
      const known = tax.paidSoFar || { taxable: 0, tds: 0, pt: 0 };
      // Earlier months of the year are known once payroll has run here (or HR has entered them): the tax then follows the year's actual figures, as above.
      // When nothing is recorded yet (the first payroll in Wohlig One, a joiner, a person paid in the old system until now), the company rule applies:
      // above ₹12,00,000 a year, the tax on the full year at the person's yearly run rate (this month's pay plus eleven more at the regular monthly
      // salary), taken level, one twelfth a month. Someone leaving this year always keeps the months-left calculation, so their last payroll settles the tax.
      const recorded = Number(known.taxable) > 0 || Number(known.tds) > 0;
      const level = !leaving && !recorded;
      let after = level ? 11 : monthsLeft(period) - 1;
      if (leaving && lastMonth > period) after = Math.min(after, monthsBetween(period, lastMonth));
      if (leaving && lastMonth <= period) after = 0;
      const paid = level ? { taxable: 0, tds: 0, pt: 0 } : known;
      const annualPt = R(P(paid.pt || 0) + ptP * (after + 1));
      const annualPf = R(P(paid.pf || 0) + pfP + P(monthlyPfOf(s)) * after);   // the employee's PF counts under 80C (old regime)
      // Basic for the months employed this year, for the employer NPS limit (a share of Basic).
      const startMonth = employee.start ? String(employee.start instanceof Date ? employee.start.toISOString() : employee.start).slice(0, 7) : null;
      const monthsBefore = fyMonths(fy).filter((m) => m < period && (!startMonth || m >= startMonth)).length;
      const annualBasic = R(sumP(fixedFull.filter((e) => e.kind === "basic")) * (monthsBefore + 1 + after));
      const age = ageInYear(employee.dob, fy);   // a senior citizen's slabs under the old regime, and 80TTB instead of 80TTA
      const t = monthlyTds({ rules: tax.rules, regime: tax.regime, fy, period, paidSoFar: paid, thisMonthTaxable: R(taxableP), regularMonthly: R(fullGrossP),
        monthsAfter: after, declaration: tax.declaration || {}, annualProfessionalTax: annualPt, annualPf, annualBasic, age });
      tds = { ...tds, applicable: t.breakdown.annualTax > 0, calculated: P(t.amount), breakdown: t.breakdown };
      calc.push(`TDS (${tax.regime} regime, FY ${fy}): projected taxable income ${inr(P(t.breakdown.taxableIncome))}, tax for the year ${inr(P(t.breakdown.annualTax))}, already deducted ${inr(P(t.breakdown.tdsDeductedSoFar + t.breakdown.previousEmployerTds))}, spread over ${t.breakdown.monthsIncludingThis} month${t.breakdown.monthsIncludingThis === 1 ? "" : "s"} = ${inr(P(t.amount))}.`);
      if (!oldRegime && !t.breakdown.annualTax) calc.push(`No tax for the year: under the new regime taxable income up to ${inr(P(TDS_THRESHOLD))} carries none.`);
      if (oldRegime && age >= 60) calc.push(`Senior citizen (${age} by 31 March): nothing is taxed up to ${age >= 80 ? "₹5,00,000" : "₹3,00,000"} under the old regime.`);
      // No PAN on file: the Act (section 206AA, now 397) takes at least 20% of the salary paid when tax is due, as Keka does.
      // Only when the PAN is known to be missing (an empty value), never when it was not looked up.
      if (employee.pan !== undefined && !employee.pan && t.breakdown.annualTax > 0) {
        const floorP = rupee(taxableP * 0.2);
        if (floorP > P(t.amount)) { tds = { ...tds, calculated: floorP, noPan: true }; calc.push(`No PAN on file: TDS is 20% of this month's taxable salary, ${inr(floorP)}, instead of ${inr(P(t.amount))}.`); }
        warnings.push("No PAN on file for this person, so TDS is at least 20% of the taxable salary. Add the PAN to their profile to return to the normal rate.");
      }
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
  for (const o of other) deductionLines.push({ ...o, code: o.advanceId ? "advance" : "other" });
  if (lopP) deductionLines.push({ name: `Loss of Pay (${lopDays} day${lopDays === 1 ? "" : "s"})`, p: lopP, code: "lop" });
  const dedP = sumP(deductionLines);
  const totalDedP = pfP + esicP + dedP;
  const netP = grossP - totalDedP;
  calc.push(`Total deductions = PF ${inr(pfP)}${esicP ? ` + ESIC ${inr(esicP)}` : ""} + PT ${inr(ptP)} + TDS ${inr(tds.amount)} + Loss of pay ${inr(lopP)} + other ${inr(otherP)} = ${inr(totalDedP)}.`);
  calc.push(`Net payable = ${inr(grossP)} − ${inr(totalDedP)} = ${inr(netP)}.`);
  if (employerPfP) calc.push(`Employer PF ${inr(employerPfP)} is paid by the company on top and is not deducted from take-home pay.`);
  if (structure && w.days && netP < 0) incomplete.push("Deductions are more than the earnings for this month.");
  else if (structure && w.days && netP === 0) incomplete.push("Net pay is zero this month: put this salary on hold.");
  if (!w.days && structure) warnings.push("Not employed on any day of this month.");

  const out = (l) => l.map((x) => ({ name: x.name, amount: R(x.p), ...(x.kind ? { kind: x.kind } : {}), ...(x.code ? { code: x.code } : {}), ...(x.advanceId ? { advanceId: x.advanceId } : {}) }));
  return {
    v: 2, period, fy, employee, overtime: overtimeApprovedMinutes > 0 ? { approvedMinutes: overtimeApprovedMinutes } : null, structureId: structure && structure.id ? structure.id : null,
    days: { total: w.total, actual: w.days, lop: lopDays, payable: Math.max(0, w.days - lopDays) },
    earnings: out(earnings),
    contributions: [...(pfP ? [{ name: "PF Employee", amount: R(pfP) }] : []), ...(esicP ? [{ name: "ESIC Employee", amount: R(esicP) }] : [])],
    deductions: out(deductionLines),
    employer: employerPfP ? [{ name: "PF Employer", amount: R(employerPfP) }] : [],
    totals: { earnings: R(grossP), contributions: R(pfP + esicP), deductions: R(dedP), totalDeductions: R(totalDedP), net: R(netP) },
    summary: {
      basic: R(basicP), hra: R(hraP), allowances: R(allowP), otherEarnings: R(otherEarnP), reimbursements: R(reimbP), gross: R(grossP),
      pf: R(pfP), esic: R(esicP), pt: R(ptP), tds: R(tds.amount), lop: R(lopP), otherDeductions: R(otherP), totalDeductions: R(totalDedP), net: R(netP),
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
  const keys = ["basic", "hra", "allowances", "otherEarnings", "reimbursements", "gross", "pf", "esic", "pt", "tds", "lop", "otherDeductions", "totalDeductions", "net", "employerPf"];
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
