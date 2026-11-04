/*
 * Income tax and monthly TDS on salary (section 192). Pure functions: the rules come in as data (tax_rules table,
 * one row per financial year and regime), so a new Budget means editing a row, not this file.
 *
 * Money here is whole rupees (tax is computed on rupees and rounded to the nearest ₹10, as section 288B requires).
 *
 *   annualTax(rules, taxable)      slabs → rebate (87A, with marginal relief where the regime has it) → surcharge
 *                                   (with marginal relief) → health & education cess
 *   monthlyTds({...})               projects the year's taxable salary, works out the year's tax, takes off the TDS
 *                                   already deducted this year, and spreads what is left over the months left.
 */

/** "2026-11" → "2026-27". April starts a financial year. */
export function fyOf(period) {
  const [y, m] = period.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Months of the financial year from `period` to March, counting `period` itself: April 12, December 4, March 1. */
export const monthsLeft = (period) => { const m = Number(period.slice(5, 7)); return m >= 4 ? 16 - m : 4 - m; };

/** Every month of the financial year, "2026-04" … "2027-03". */
export function fyMonths(fy) {
  const y = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => { const m = ((i + 3) % 12) + 1; return `${m >= 4 ? y : y + 1}-${String(m).padStart(2, "0")}`; });
}

const r10 = (n) => Math.round(n / 10) * 10;

/** Tax on the slabs alone. slabs: [{ upTo: 400000|null, rate: 5 }, …] in ascending order; null = no upper limit. */
export function slabTax(slabs, income) {
  let tax = 0, lower = 0;
  const parts = [];
  for (const s of slabs) {
    const upper = s.upTo == null ? Infinity : s.upTo;
    if (income > lower) {
      const inBand = Math.min(income, upper) - lower;
      const t = inBand * s.rate / 100;
      if (inBand > 0) parts.push({ from: lower, to: upper === Infinity ? null : upper, rate: s.rate, income: inBand, tax: Math.round(t) });
      tax += t;
    }
    lower = upper;
    if (income <= upper) break;
  }
  return { tax: Math.round(tax), parts };
}

/**
 * The year's tax on a taxable income under one regime's rules.
 * rules = { slabs, rebate: { maxIncome, maxRebate, marginalRelief }, surcharge: [{ above, rate }], cessRate }
 */
export function annualTax(rules, taxableIncome) {
  const income = Math.max(0, Math.round(taxableIncome));
  const { tax: onSlabs, parts } = slabTax(rules.slabs, income);
  let tax = onSlabs, rebate = 0;
  const rb = rules.rebate;
  if (rb && income <= rb.maxIncome) rebate = Math.min(tax, rb.maxRebate);
  else if (rb && rb.marginalRelief && income > rb.maxIncome) {
    // Just above the rebate limit, tax may not exceed the income above the limit.
    const excess = income - rb.maxIncome;
    if (tax > excess) rebate = tax - excess;
  }
  tax -= rebate;

  // Surcharge with marginal relief: tax + surcharge may not rise by more than the income above the threshold.
  let surcharge = 0, surchargeRate = 0;
  const bands = (rules.surcharge || []).slice().sort((a, b) => b.above - a.above);
  const band = bands.find((b) => income > b.above);
  if (band) {
    surchargeRate = band.rate;
    surcharge = Math.round(tax * band.rate / 100);
    const atThreshold = annualTax({ ...rules, surcharge: (rules.surcharge || []).filter((b) => b.above < band.above) }, band.above);
    const cap = atThreshold.beforeCess + (income - band.above);
    if (tax + surcharge > cap) surcharge = Math.max(0, cap - tax);
  }
  const beforeCess = tax + surcharge;
  const cess = Math.round(beforeCess * (rules.cessRate ?? 4) / 100);
  return { taxableIncome: income, slabTax: onSlabs, slabs: parts, rebate, surchargeRate, surcharge, beforeCess, cess, total: r10(beforeCess + cess) };
}

/**
 * Deductions from gross salary allowed by the regime, from the employee's declaration. Caps come from the rules
 * (rules.caps), so they change with the year too. Returns { total, lines: [{ name, amount }] }.
 */
export function allowedDeductions(rules, declaration = {}, annualProfessionalTax = 0) {
  const lines = [];
  const add = (name, amount, cap) => {
    const n = Math.max(0, Math.round(Number(amount) || 0));
    const v = cap == null ? n : Math.min(n, cap);
    if (v) lines.push({ name, amount: v, ...(cap != null && n > cap ? { capped: cap } : {}) });
  };
  add("Standard deduction", rules.standardDeduction || 0);
  const caps = rules.caps || {};
  const allowed = new Set(rules.allowedDeductions || []);
  if (allowed.has("professionalTax")) add("Professional tax (16(iii))", annualProfessionalTax);
  if (allowed.has("hraExemption")) add("HRA exemption (10(13A))", declaration.hraExemption);
  if (allowed.has("section80C")) add("80C (PF, PPF, ELSS, LIC…)", declaration.section80C, caps.section80C);
  if (allowed.has("section80D")) add("80D (health insurance)", declaration.section80D, caps.section80D);
  if (allowed.has("homeLoanInterest")) add("Home loan interest (24(b))", declaration.homeLoanInterest, caps.homeLoanInterest);
  if (allowed.has("nps80CCD1B")) add("80CCD(1B) NPS", declaration.nps80CCD1B, caps.nps80CCD1B);
  if (allowed.has("employerNps")) add("80CCD(2) employer NPS", declaration.employerNps);
  if (allowed.has("otherDeductions")) add("Other Chapter VI-A deductions", declaration.otherDeductions);
  return { total: lines.reduce((n, l) => n + l.amount, 0), lines };
}

/**
 * This month's TDS.
 *   rules                the regime's rules for the financial year
 *   period               the payroll month
 *   paidSoFar            { taxable, tds } from this employer's earlier payroll months in the same financial year
 *   thisMonthTaxable     taxable earnings this month (salary after loss of pay, incentives, bonus… not reimbursements)
 *   regularMonthly       a full month's fixed taxable salary, projected for the months after this one
 *   monthsAfter          how many more months of salary to project (fewer when the person is leaving)
 *   declaration          { otherIncome, previousEmployerIncome, previousEmployerTds, section80C, … }
 *   annualProfessionalTax
 * Returns { amount, breakdown }.
 */
export function monthlyTds({ rules, regime, fy, period, paidSoFar = { taxable: 0, tds: 0 }, thisMonthTaxable, regularMonthly, monthsAfter, declaration = {}, annualProfessionalTax = 0 }) {
  const projectedSalary = Math.round(paidSoFar.taxable + thisMonthTaxable + regularMonthly * monthsAfter);
  const prevIncome = Math.round(Number(declaration.previousEmployerIncome) || 0);
  const otherIncome = Math.round(Number(declaration.otherIncome) || 0);
  const gross = projectedSalary + prevIncome + otherIncome;
  const ded = allowedDeductions(rules, declaration, annualProfessionalTax);
  const taxable = Math.max(0, gross - ded.total);
  const tax = annualTax(rules, taxable);
  const prevTds = Math.round(Number(declaration.previousEmployerTds) || 0);
  const already = Math.round(paidSoFar.tds) + prevTds;
  const remaining = Math.max(0, tax.total - already);
  const months = monthsAfter + 1;
  const amount = Math.round(remaining / months);
  return {
    amount,
    breakdown: {
      fy, regime, period,
      salaryPaidSoFar: Math.round(paidSoFar.taxable), salaryThisMonth: Math.round(thisMonthTaxable), regularMonthly: Math.round(regularMonthly), monthsAfter,
      projectedSalary, previousEmployerIncome: prevIncome, otherIncome, grossTotalIncome: gross,
      deductions: ded.lines, totalDeductions: ded.total, taxableIncome: taxable,
      slabs: tax.slabs, slabTax: tax.slabTax, rebate: tax.rebate, surchargeRate: tax.surchargeRate, surcharge: tax.surcharge, cess: tax.cess, annualTax: tax.total,
      tdsDeductedSoFar: Math.round(paidSoFar.tds), previousEmployerTds: prevTds, remainingTax: remaining, monthsIncludingThis: months, monthlyTds: amount,
    },
  };
}

/** Checks a rules object HR edits. Returns a list of problems (empty = fine). */
export function rulesProblems(r) {
  const p = [];
  if (!r || typeof r !== "object") return ["Rules are missing."];
  if (!Array.isArray(r.slabs) || !r.slabs.length) p.push("Add at least one slab.");
  else {
    let last = 0;
    r.slabs.forEach((s, i) => {
      if (!(Number.isFinite(s.rate) && s.rate >= 0 && s.rate <= 100)) p.push(`Slab ${i + 1}: rate must be 0–100.`);
      if (s.upTo != null && !(Number.isFinite(s.upTo) && s.upTo > last)) p.push(`Slab ${i + 1}: the upper limit must be above the previous one.`);
      if (s.upTo == null && i !== r.slabs.length - 1) p.push("Only the last slab can have no upper limit.");
      if (s.upTo != null) last = s.upTo;
    });
    if (r.slabs[r.slabs.length - 1].upTo != null) p.push("The last slab must have no upper limit.");
  }
  if (!(Number(r.standardDeduction) >= 0)) p.push("Standard deduction must be 0 or more.");
  if (!(Number(r.cessRate) >= 0 && Number(r.cessRate) <= 20)) p.push("Cess rate looks wrong.");
  if (r.rebate && !(r.rebate.maxIncome >= 0 && r.rebate.maxRebate >= 0)) p.push("Rebate limits must be 0 or more.");
  for (const s of r.surcharge || []) if (!(s.above > 0 && s.rate >= 0 && s.rate <= 100)) p.push("Each surcharge band needs an income threshold and a rate.");
  return p;
}
