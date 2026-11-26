/*
 * The person's own tax for the year under both regimes (Pay > Tax declaration > "Work out my tax"), as Keka shows it.
 * From their salary structure in payroll, the year's tax rules, what payroll already deducted this year, and the lines on
 * their declaration page (saved or not). It is an estimate: the payroll month is what counts.
 */
import { payPool } from "./db.js";
import { istMonth } from "./payroll-calc.js";
import { structuresFor, toStructure, paidSoFar, withOpening } from "./payroll/store.js";
import { ageInYear, fyMonths, fyOf, monthsLeft, monthlyTds, yearTax } from "./payroll/tax.js";
import { fromEmployee, monthsEmployed } from "./payroll/declared.js";
import { monthlyPfOf, summaryOfLegacy } from "./payroll/engine.js";
import { annualStatement, fyPeriods, FINAL_STATES } from "./finance-rules.js";

const mon = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 7) : null);
const OPENING = ["openingTaxable", "openingTds", "openingPt"];

/** Pure: both regimes from the figures. Exported for the tests. */
export function compareRegimes({ period, structure, rulesOf, items, start = null, lastDay = null, dob = null, payrollDeclaration = null, paid = { taxable: 0, tds: 0, pt: 0, pf: 0 }, pastMonths = [] }) {
  const fy = fyOf(period);
  const gross = (structure.earnings || []).reduce((n, x) => n + (Number(x.amount) || 0), 0);
  let after = monthsLeft(period) - 1;
  const leave = mon(lastDay);
  if (leave && fyOf(leave) === fy && leave >= period) after = Math.min(after, monthsLeft(period) - monthsLeft(leave));
  const opening = Object.fromEntries(OPENING.filter((k) => payrollDeclaration && Number(payrollDeclaration[k]) > 0).map((k) => [k, Number(payrollDeclaration[k])]));
  const ptMonthly = structure.ptApplicable === false ? 0 : Number(structure.professionalTax) || 0;
  const out = {};
  for (const regime of ["new", "old"]) {
    const rules = rulesOf[regime];
    if (!rules) { out[regime] = null; continue; }
    const own = fromEmployee({ request: { regime, items }, structure, fy, start, lastDay });
    const declaration = { ...own.declaration, ...opening };
    const soFar = withOpening(paid, declaration);
    const t = monthlyTds({ rules, regime, fy, period, paidSoFar: soFar, thisMonthTaxable: gross, regularMonthly: gross, monthsAfter: after, declaration,
      annualProfessionalTax: Math.round(soFar.pt + ptMonthly * (after + 1)), annualPf: Math.round((soFar.pf || 0) + monthlyPfOf(structure) * (after + 1)),
      annualBasic: Math.round((structure.earnings || []).filter((x) => /^\s*basic/i.test(x.name)).reduce((n, x) => n + (Number(x.amount) || 0), 0) * monthsEmployed(fy, start, lastDay)),
      age: ageInYear(dob, fy) });
    const b = t.breakdown;
    // As Keka's income tax computation: the tax slab by slab, and TDS month by month (months paid, then the months to come).
    const coming = fyMonths(fy).filter((m) => m >= period).slice(0, after + 1);
    const schedule = [...pastMonths.map((m) => ({ period: m.period, tds: m.tds, paid: true })), ...coming.map((m) => ({ period: m, tds: b.monthlyTds, paid: false }))];
    out[regime] = { grossIncome: b.grossTotalIncome, deductions: b.deductions, totalDeductions: b.totalDeductions, taxableIncome: b.taxableIncome, annualTax: b.annualTax,
      alreadyDeducted: b.tdsDeductedSoFar + b.previousEmployerTds, remaining: b.remainingTax, months: b.monthsIncludingThis,
      monthly: b.monthlyTds, noTdsRule: regime === "new" && !b.annualTax, hra: own.hra, lta: own.lta,
      slabs: b.slabs, slabTax: b.slabTax, rebate: b.rebate, surcharge: b.surcharge, cess: b.cess, housePropertyIncome: b.housePropertyIncome, age: b.age, schedule };
  }
  const both = out.new && out.old;
  const better = both ? (out.old.annualTax < out.new.annualTax ? "old" : "new") : out.new ? "new" : out.old ? "old" : null;
  return { available: !!better, financialYear: fy, period, monthlyGross: gross, regimes: out, better, saving: both ? Math.abs(out.old.annualTax - out.new.annualTax) : 0,
    fixedTds: structure.tdsMode === "manual" ? Number(structure.tdsMonthly) || 0 : null };
}

export async function estimateTax({ email, items }) {
  const now = istMonth(), fy = fyOf(now);
  const [structures, { rows: rules }, { rows: [decl] }, { rows: [emp] }] = await Promise.all([
    structuresFor(payPool, now, email),
    payPool.query("SELECT regime, rules FROM tax_rules WHERE fy=$1", [fy]),
    payPool.query("SELECT regime, declaration FROM tax_declarations WHERE fy=$1 AND lower(work_email)=$2", [fy, email]),
    payPool.query("SELECT start_date, last_day, dob FROM employees WHERE lower(work_email)=$1", [email]),
  ]);
  if (!structures.length) return { available: false, message: "Your salary is not set up in payroll yet, so your tax cannot be worked out. Please ask the payroll team." };
  // Someone who joins later this year: their first month is the joining month.
  const joins = emp && mon(emp.start_date), period = joins && joins > now && fyOf(joins) === fy ? joins : now;
  const [paidMap, { rows: past }] = await Promise.all([paidSoFar(payPool, period, email),
    payPool.query(`SELECT r.period, i.slip, i.base_salary, i.lop_deduction, i.payable, i.item_sealed FROM payroll_items i JOIN payroll_runs r ON r.id = i.run_id
      WHERE r.period = ANY($1) AND lower(i.work_email) = $2 AND r.status = ANY($3) ORDER BY r.period LIMIT 12`, [fyMonths(fy).filter((m) => m < period), email, FINAL_STATES])]);
  const paid = paidMap.get(email) || { taxable: 0, tds: 0, pt: 0 };
  const pastMonths = past.map((x) => ({ period: x.period, tds: Number(summaryOfLegacy(x.slip, x).tds) || 0 }));
  const result = compareRegimes({ period, structure: toStructure(structures[0]), rulesOf: Object.fromEntries(rules.map((r) => [r.regime, r.rules])), items,
    start: emp && emp.start_date, lastDay: emp && emp.last_day, dob: emp && emp.dob, payrollDeclaration: decl ? decl.declaration : null, paid, pastMonths });
  if (!result.available) return { available: false, message: `The tax rules for ${fy} are not set up in payroll yet. Please ask the payroll team.` };
  return { ...result, payrollEntered: decl ? decl.regime : null };
}

/*
 * The year's figures for filing the income tax return (Pay > Tax declaration > "For your return"), as Keka gives a tax
 * summary to file with. From the person's approved payslips of the year (drafts are left out), the tax details payroll used
 * (its own record, or the person's declaration with HR's proof decisions) and the year's rules. Filing itself happens on the
 * income tax e-filing portal; the official certificate is Form 130 (earlier Form 16), issued from TRACES by 15 June.
 */
/** Pure: the return's figures from a year of payslips and the tax details. Exported for the tests. */
export function returnFigures({ statement, regime, rules, declaration = {}, hra = null, lta = null, age = null }) {
  const t = statement.totals;
  const y = yearTax({ rules, regime, salary: t.taxable, declaration, annualProfessionalTax: t.pt, annualPf: t.pf, annualBasic: t.basic, age });
  const prevTds = Math.round(Number(declaration.previousEmployerTds) || 0);
  const tds = Math.round(t.tds) + prevTds, tax = y.tax;
  return { regime, salary: t.salary, taxableSalary: t.taxable, previousEmployerIncome: y.prevIncome, otherIncome: y.otherIncome, housePropertyIncome: y.houseProperty, grossIncome: y.gross,
    deductions: y.ded.lines, totalDeductions: y.ded.total, taxableIncome: y.taxable, annualTax: tax.total, rebate: tax.rebate, cess: tax.cess, slabs: tax.slabs, age,
    tdsHere: Math.round(t.tds), previousEmployerTds: prevTds, tdsTotal: tds, balance: tax.total - tds, hra, lta };
}

/*
 * Why TDS changed from one month to the next, as Keka explains it: from what each approved payslip stored about its TDS
 * (slip.tds: mode, override, and the breakdown of the year's projected tax). Pure, exported for the tests.
 * months: [{ period, tds: { amount (rupees, as the slip stores it), mode, override, breakdown } }] in month order. Returns [{ period, from, to, reasons }]
 * for each month whose TDS differs from the month before, in whole rupees.
 */
export function tdsChanges(months) {
  const R = (n) => Math.round(Number(n) || 0), inr = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const out = [];
  for (let i = 1; i < months.length; i++) {
    const a = months[i - 1].tds || {}, b = months[i].tds || {}, from = R(a.amount), to = R(b.amount);
    if (from === to) continue;
    const x = a.breakdown || {}, y = b.breakdown || {}, reasons = [];
    if (b.override) reasons.push(`The payroll team set this month's TDS by hand: ${b.override.reason || "no reason recorded"}.`);
    else if (a.override) reasons.push("Last month's TDS was set by hand; this month it is worked out again.");
    if (b.mode === "manual" && a.mode !== "manual") reasons.push("TDS became a fixed monthly amount on your salary.");
    else if (a.mode === "manual" && b.mode !== "manual") reasons.push("TDS is now worked out from your salary and declaration instead of a fixed amount.");
    if (x.regime && y.regime && x.regime !== y.regime) reasons.push(`Your tax regime changed from ${x.regime === "old" ? "Old" : "New"} to ${y.regime === "old" ? "Old" : "New"}.`);
    if (x.regularMonthly != null && y.regularMonthly != null && x.regularMonthly !== y.regularMonthly) reasons.push(`Your monthly salary changed from ${inr(x.regularMonthly)} to ${inr(y.regularMonthly)}.`);
    if (y.salaryThisMonth > y.regularMonthly) reasons.push(`This month's pay included ${inr(y.salaryThisMonth - y.regularMonthly)} more than the usual salary (a bonus, incentive or arrears).`);
    else if (x.salaryThisMonth > x.regularMonthly) reasons.push("Last month's pay included extra pay; this month is the usual salary.");
    else if (y.salaryThisMonth < y.regularMonthly) reasons.push(`This month's pay was ${inr(y.regularMonthly - y.salaryThisMonth)} less than the usual salary (loss of pay or a part month).`);
    if (x.totalDeductions != null && y.totalDeductions != null && x.totalDeductions !== y.totalDeductions) reasons.push(`Your deductions and exemptions for the year changed from ${inr(x.totalDeductions)} to ${inr(y.totalDeductions)} (your declaration or the payroll team's proof decisions).`);
    if ((x.previousEmployerIncome || 0) !== (y.previousEmployerIncome || 0) || (x.previousEmployerTds || 0) !== (y.previousEmployerTds || 0)) reasons.push("Your previous employer's salary or TDS for this year changed.");
    if ((x.otherIncome || 0) !== (y.otherIncome || 0) || (x.housePropertyIncome || 0) !== (y.housePropertyIncome || 0)) reasons.push("Your income from other sources or a let-out house changed.");
    if (!reasons.length && x.annualTax != null && y.annualTax != null && x.annualTax !== y.annualTax) reasons.push(`The tax worked out for the year changed from ${inr(x.annualTax)} to ${inr(y.annualTax)}.`);
    if (!reasons.length) reasons.push("The tax still to pay is spread over the months left in the year, so the monthly amount moves a little as months pass.");
    out.push({ period: months[i].period, from, to, reasons });
  }
  return out;
}

/** fy: 2026 for 2026-27. own: the person's submitted declaration row (main database), proofsFinal: the proof date has passed. */
export async function yearForReturn({ email, fy, own = null, proofsFinal = false }) {
  const label = `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`, periods = fyPeriods(label);
  const [{ rows: items }, { rows: rules }, { rows: [decl] }, { rows: [emp] }, structures] = await Promise.all([
    payPool.query(`SELECT r.period, r.status, i.slip, i.base_salary, i.lop_deduction, i.payable, i.item_sealed FROM payroll_items i JOIN payroll_runs r ON r.id = i.run_id
      WHERE r.period = ANY($1) AND lower(i.work_email) = $2 AND r.status = ANY($3) ORDER BY r.period LIMIT 24`, [periods, email, FINAL_STATES]),
    payPool.query("SELECT regime, rules FROM tax_rules WHERE fy=$1", [label]),
    payPool.query("SELECT regime, declaration FROM tax_declarations WHERE fy=$1 AND lower(work_email)=$2", [label, email]),
    payPool.query("SELECT name, emp_no, pan_masked, start_date, last_day, dob FROM employees WHERE lower(work_email)=$1", [email]),
    structuresFor(payPool, periods.at(-1), email),
  ]);
  const statement = annualStatement(items.map((x) => ({ period: x.period, status: x.status, s: summaryOfLegacy(x.slip, x) })));
  const base = { financialYear: fy, label, person: emp ? { name: emp.name, empNo: emp.emp_no || "", pan: emp.pan_masked || "" } : null,
    months: statement.rows, quarters: statement.quarters, totals: statement.totals,
    tdsChanges: tdsChanges(items.map((x) => ({ period: x.period, tds: x.slip && x.slip.tds ? x.slip.tds : { amount: Number(summaryOfLegacy(x.slip, x).tds) || 0 } }))), monthsLeft: periods.filter((p) => p > (statement.rows.at(-1) || {}).period || !statement.rows.length).length };
  if (!statement.rows.length) return { ...base, available: false, message: "There are no approved payslips for you in this financial year yet." };
  let regime = "new", declaration = {}, hra = null, lta = null, source = "none";
  if (decl) { regime = decl.regime; declaration = decl.declaration || {}; source = "payroll"; }
  else if (own) {
    // The exemptions for the months actually paid (the first to the last payslip), to match the salary on this page.
    const got = fromEmployee({ request: own, structure: structures.length ? toStructure(structures[0]) : null, fy: label,
      start: `${statement.rows[0].period}-01`, lastDay: `${statement.rows.at(-1).period}-01`, proofsFinal });
    ({ regime, declaration, hra, lta } = got); source = "employee";
  }
  const r = rules.find((x) => x.regime === regime);
  if (!r) return { ...base, available: false, message: `The tax rules for ${label} are not set up in payroll yet. Please ask the payroll team.` };
  return { ...base, available: true, source, ...returnFigures({ statement, regime, rules: r.rules, declaration, hra, lta, age: ageInYear(emp && emp.dob, label) }) };
}
