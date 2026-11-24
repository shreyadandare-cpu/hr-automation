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

/* Statutory limits that depend on who a claim is for (Chapter VIII of the Income-tax Act 2025, earlier VI-A, unchanged for 2026-27):
   they are fixed by the Act rather than set each year, so they live here; the yearly ones (80C, 80D in total, home loan) stay in the rules. */
export const LIMITS = {
  health: 25000, healthSenior: 50000,             // 80D, each for self and family, and for parents
  disability: 75000, disabilitySevere: 125000,    // 80DD (a dependant) and 80U (oneself)
  disease: 40000, diseaseSenior: 100000,          // 80DDB
  firstHomeLoan: 150000,                          // 80EEA
  savingsInterest: 10000, depositInterestSenior: 50000,   // 80TTA, and 80TTB from 60
  rentNoHraMonthly: 5000,                         // 80GG: ₹5,000 a month, 25% of total income, or rent less 10% of it
  housePropertyLoss: 200000,                      // a loss from a let-out house set off against salary in a year (old regime)
};

/** Age on the last day of the financial year ("2026-27" → 31 March 2027): "at any time during the year", as the Act counts it. */
export function ageInYear(dob, fy) {
  if (!dob) return null;
  // A DATE column arrives as local midnight: read its own day, not the UTC one (which in India is the day before).
  const d = dob instanceof Date ? `${dob.getFullYear()}-${String(dob.getMonth() + 1).padStart(2, "0")}-${String(dob.getDate()).padStart(2, "0")}` : String(dob).slice(0, 10);
  const end = `${Number(fy.slice(0, 4)) + 1}-03-31`;
  const [y, m, day] = d.split("-").map(Number), [ey, em, ed] = end.split("-").map(Number);
  if (!y) return null;
  return ey - y - (em < m || (em === m && ed < day) ? 1 : 0);
}

/** The old regime's slabs for a senior citizen: nothing up to ₹3,00,000 from 60, and up to ₹5,00,000 from 80. Other rules unchanged. */
export function rulesForAge(rules, regime, age) {
  if (regime !== "old" || !(age >= 60) || !rules || !Array.isArray(rules.slabs)) return rules;
  const free = age >= 80 ? 500000 : 300000;
  return { ...rules, slabs: [{ upTo: free, rate: 0 }, ...rules.slabs.filter((s) => s.upTo == null || s.upTo > free)] };
}

/**
 * Deductions from gross salary allowed by the regime, from the declaration. Caps come from the rules (rules.caps), so they change
 * with the year too. Returns { total, lines: [{ name, amount }] }.
 *   annualPf      the employee's own PF for the year: counts under 80C with the investments, up to the 80C limit (Keka adds it too)
 *   annualBasic   Basic for the year, for the employer NPS limit, 80CCD(2): 14% of Basic under the new regime and 10% under the old
 *                 (`caps.employerNpsPercent`, or by regime for rules saved before it was added). 0 = not known: no limit.
 *   age           for the savings interest limit: ₹10,000 (80TTA), or ₹50,000 of deposit interest from 60 (80TTB)
 * The Chapter VIII lines added later (80DD, 80DDB, 80E, 80EEA, 80G, 80U, savings interest) go with "otherDeductions", which only
 * the old regime allows, so rules saved before they were added still treat them right.
 */
export function allowedDeductions(rules, declaration = {}, annualProfessionalTax = 0, annualPf = 0, annualBasic = 0, age = null) {
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
  // Leave travel goes with HRA: both are salary exemptions the new regime takes away, so a regime that allows one allows the other
  // (rules saved before leave travel was added list only HRA).
  if (allowed.has("ltaExemption") || allowed.has("hraExemption")) add("Leave travel exemption (10(5))", declaration.ltaExemption);
  if (allowed.has("section80C")) {
    const pf = Math.max(0, Math.round(Number(annualPf) || 0));
    add(pf ? `80C (employee PF ₹${pf.toLocaleString("en-IN")} + investments declared)` : "80C (PF, PPF, ELSS, LIC…)", (Number(declaration.section80C) || 0) + pf, caps.section80C);
  }
  if (allowed.has("section80D")) add("80D (health insurance)", declaration.section80D, caps.section80D);
  if (allowed.has("homeLoanInterest")) add("Home loan interest (24(b))", declaration.homeLoanInterest, caps.homeLoanInterest);
  if (allowed.has("nps80CCD1B")) add("80CCD(1B) NPS", declaration.nps80CCD1B, caps.nps80CCD1B);
  const npsPct = caps.employerNpsPercent ?? (allowed.has("hraExemption") ? 10 : 14);
  if (allowed.has("employerNps")) add("80CCD(2) employer NPS", declaration.employerNps, annualBasic > 0 ? Math.round(annualBasic * npsPct / 100) : null);
  if (allowed.has("otherDeductions")) {
    add("80DD (dependant with a disability)", declaration.disability80DD, LIMITS.disabilitySevere);
    add("80DDB (treatment of specified illness)", declaration.medical80DDB, LIMITS.diseaseSenior);
    add("80E (education loan interest)", declaration.educationLoan80E);
    add("80EEA (first home loan interest)", declaration.homeLoan80EEA, LIMITS.firstHomeLoan);
    add("80G (donations)", declaration.donations80G);
    add("80U (own disability)", declaration.disability80U, LIMITS.disabilitySevere);
    add(age >= 60 ? "80TTB (deposit interest)" : "80TTA (savings interest)", declaration.savingsInterest, age >= 60 ? LIMITS.depositInterestSenior : LIMITS.savingsInterest);
    add("Other Chapter VI-A deductions", declaration.otherDeductions);
  }
  return { total: lines.reduce((n, l) => n + l.amount, 0), lines };
}

/**
 * The year's tax from the year's salary and the declaration: income from a previous employer, other sources and a let-out house;
 * the deductions; 80GG (rent with no HRA, worked out on the income after the other deductions); and the tax under the regime's
 * slabs (a senior citizen's under the old regime). Pure; used by the monthly TDS, the estimate and the year summary alike.
 */
export function yearTax({ rules, regime, salary, declaration = {}, annualProfessionalTax = 0, annualPf = 0, annualBasic = 0, age = null }) {
  const prevIncome = Math.round(Number(declaration.previousEmployerIncome) || 0);
  const otherIncome = Math.round(Number(declaration.otherIncome) || 0);
  // A let-out house: income, or a loss set off against salary up to ₹2,00,000 under the old regime; the new regime sets off no loss.
  const hp = Math.round(Number(declaration.housePropertyIncome) || 0);
  const houseProperty = regime === "old" ? Math.max(hp, -LIMITS.housePropertyLoss) : Math.max(hp, 0);
  const gross = Math.max(0, Math.round(salary) + prevIncome + otherIncome + houseProperty);
  const ded = allowedDeductions(rules, declaration, annualProfessionalTax, annualPf, annualBasic, age);
  const rent = Math.round(Number(declaration.rentWithoutHra) || 0);
  if (rent > 0 && !(Number(declaration.hraExemption) > 0) && new Set(rules.allowedDeductions || []).has("otherDeductions")) {
    const total = Math.max(0, gross - ded.total);
    const gg = Math.max(0, Math.round(Math.min(LIMITS.rentNoHraMonthly * 12, total * 0.25, rent - total * 0.1)));
    if (gg) { ded.lines.push({ name: "80GG (rent paid, no HRA)", amount: gg }); ded.total += gg; }
  }
  const taxable = Math.max(0, gross - ded.total);
  const tax = annualTax(rulesForAge(rules, regime, age), taxable);
  return { prevIncome, otherIncome, houseProperty, gross, ded, taxable, tax };
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
 *   annualProfessionalTax, annualPf, annualBasic, age   see allowedDeductions
 * Returns { amount, breakdown }.
 */
export function monthlyTds({ rules, regime, fy, period, paidSoFar = { taxable: 0, tds: 0 }, thisMonthTaxable, regularMonthly, monthsAfter, declaration = {}, annualProfessionalTax = 0, annualPf = 0, annualBasic = 0, age = null }) {
  const projectedSalary = Math.round(paidSoFar.taxable + thisMonthTaxable + regularMonthly * monthsAfter);
  const y = yearTax({ rules, regime, salary: projectedSalary, declaration, annualProfessionalTax, annualPf, annualBasic, age });
  const prevTds = Math.round(Number(declaration.previousEmployerTds) || 0);
  const already = Math.round(paidSoFar.tds) + prevTds;
  const remaining = Math.max(0, y.tax.total - already);
  const months = monthsAfter + 1;
  const amount = Math.round(remaining / months);
  return {
    amount,
    breakdown: {
      fy, regime, period, age,
      salaryPaidSoFar: Math.round(paidSoFar.taxable), salaryThisMonth: Math.round(thisMonthTaxable), regularMonthly: Math.round(regularMonthly), monthsAfter,
      projectedSalary, previousEmployerIncome: y.prevIncome, otherIncome: y.otherIncome, housePropertyIncome: y.houseProperty, grossTotalIncome: y.gross,
      deductions: y.ded.lines, totalDeductions: y.ded.total, taxableIncome: y.taxable,
      slabs: y.tax.slabs, slabTax: y.tax.slabTax, rebate: y.tax.rebate, surchargeRate: y.tax.surchargeRate, surcharge: y.tax.surcharge, cess: y.tax.cess, annualTax: y.tax.total,
      tdsDeductedSoFar: Math.round(paidSoFar.tds), previousEmployerTds: prevTds, remainingTax: remaining, monthsIncludingThis: months, monthlyTds: amount,
    },
  };
}

/* An employee's own declaration (Pay > Tax declaration: lines of { section, amountMinor, party }) as payroll's declaration
   fields, in whole rupees. What HR decided about each line's proof counts, as in Keka: a rejected line counts nothing, a line
   approved for less counts the approved amount, and once the proof window has closed (`proofsFinal`) only verified lines count.
   Income lines (the previous employer's salary, other income) always count: they raise the tax, so no proof is waited for.
   Rent ("HRA") is returned as rent and leave travel as the fares; both exemptions depend on salary and are worked out by
   `hraExemption` and `ltaExemption`. Under the new regime only income lines and the previous employer's TDS count. */
const FIELD_OF = { "80C": "section80C", "80D": "section80D", "80D parents": "section80DParents", "Home loan interest": "homeLoanInterest", NPS: "nps80CCD1B",
  "80DD": "disability80DD", "80DDB": "medical80DDB", "80E": "educationLoan80E", "80EEA": "homeLoan80EEA", "80G": "donations80G", "80GG": "rentWithoutHra",
  "80TTA": "savingsInterest", "80U": "disability80U", Other: "otherDeductions",
  "Previous employer salary": "previousEmployerIncome", "Previous employer TDS": "previousEmployerTds", "Income from other sources": "otherIncome" };
const BOTH = new Set(["previousEmployerIncome", "previousEmployerTds", "otherIncome", "letOut"]);
const INCOME = new Set(["previousEmployerIncome", "otherIncome", "letOut"]);
/* The limits that depend on a tick on the line: a senior citizen insured or treated, or a severe disability (paise). */
const LINE_CAP = {
  section80D: (lines) => (lines.some((i) => i.party && i.party.senior) ? LIMITS.healthSenior : LIMITS.health) * 100,
  section80DParents: (lines) => (lines.some((i) => i.party && i.party.senior) ? LIMITS.healthSenior : LIMITS.health) * 100,
  disability80DD: (lines) => (lines.some((i) => i.party && i.party.severe) ? LIMITS.disabilitySevere : LIMITS.disability) * 100,
  disability80U: (lines) => (lines.some((i) => i.party && i.party.severe) ? LIMITS.disabilitySevere : LIMITS.disability) * 100,
  medical80DDB: (lines) => (lines.some((i) => i.party && i.party.senior) ? LIMITS.diseaseSenior : LIMITS.disease) * 100,
  homeLoan80EEA: () => LIMITS.firstHomeLoan * 100,
};
export function payrollFieldsFrom(items = [], regime = "new", { proofs = {}, proofsFinal = false } = {}) {
  const paise = {}, linesOf = {};
  let rentPaise = 0, farePaise = 0, housePaise = 0, metro = false;
  items.forEach((i, n) => {
    if (!i) return;
    const declared = Math.max(0, Math.round(Number(i.amountMinor) || 0));
    const k = i.section === "HRA" ? "rent" : i.section === "Leave travel" ? "fare" : i.section === "Let-out property" ? "letOut" : FIELD_OF[i.section];
    if (!k || (regime !== "old" && !BOTH.has(k))) return;
    const pr = proofs[n] || proofs[String(n)] || null;
    let v = declared;
    if (!INCOME.has(k)) {
      if (pr && pr.status === "rejected") v = 0;
      else if (pr && pr.status === "verified") v = pr.approvedMinor != null ? Math.min(declared, Number(pr.approvedMinor)) : declared;
      else if (proofsFinal) v = 0;
    }
    if (k === "rent") { rentPaise += v; if (v && i.party && i.party.metro) metro = true; }
    else if (k === "fare") farePaise += v;
    else if (k === "letOut") {
      // Rent received, less the municipal tax paid, less 30% for repairs, less the home loan interest (unless HR rejected the proof).
      const p = i.party || {}, municipal = Math.max(0, Number(p.municipalTaxMinor) || 0), interest = pr && pr.status === "rejected" ? 0 : Math.max(0, Number(p.interestMinor) || 0);
      housePaise += Math.round(Math.max(0, v - municipal) * 0.7) - interest;
    } else { paise[k] = (paise[k] || 0) + v; (linesOf[k] = linesOf[k] || []).push(i); }
  });
  for (const [k, cap] of Object.entries(LINE_CAP)) if (paise[k]) paise[k] = Math.min(paise[k], cap(linesOf[k]));
  if (paise.section80DParents) { paise.section80D = (paise.section80D || 0) + paise.section80DParents; delete paise.section80DParents; }
  if (housePaise) paise.housePropertyIncome = housePaise;
  const fields = Object.fromEntries(Object.entries(paise).filter(([, v]) => v).map(([k, v]) => [k, Math.round(v / 100)]));
  return { fields, rentDeclared: Math.round(rentPaise / 100), metro, faresDeclared: Math.round(farePaise / 100) };
}

/** Cities where the HRA limit is 50% of basic salary from tax year 2026-27 (Rule 279, Income-tax Rules 2026); before, the first four. */
export const HRA_METROS = ["Delhi", "Mumbai", "Kolkata", "Chennai", "Bengaluru", "Hyderabad", "Pune", "Ahmedabad"];
/** HRA exemption for the year: the least of the HRA received, rent less 10% of basic, and 50% (metro) or 40% of basic. Whole rupees. */
export function hraExemption({ rent = 0, basic = 0, hra = 0, metro = false }) {
  if (!(rent > 0) || !(hra > 0) || !(basic > 0)) return 0;
  return Math.max(0, Math.round(Math.min(hra, rent - basic * 0.1, basic * (metro ? 0.5 : 0.4))));
}

/** Leave travel exemption for the year: the fares claimed, up to the leave travel allowance paid in the year. Whole rupees. */
export const ltaExemption = ({ fares = 0, received = 0 }) => Math.max(0, Math.round(Math.min(Number(fares) || 0, Number(received) || 0)));
/** A salary line that is leave travel allowance ("LTA", "Leave Travel Allowance"). */
export const isLtaLine = (name) => /\bLTA\b|\bLTC\b|leave travel/i.test(String(name || ""));

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
