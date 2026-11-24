/*
 * Finance reports: the sums an accountant needs from payroll that is already calculated.
 * Pure functions, no database. Nothing here changes a payslip; every figure is read from a stored payslip summary
 * (see payroll/engine.js: basic, hra, allowances, reimbursements, gross, pf, esic, pt, tds, lop, otherDeductions,
 * totalDeductions, net, employerPf, taxable). Money is added in paise so rupee totals never drift.
 */
const P = (rupees) => Math.round(Number(rupees || 0) * 100);
const R = (paise) => paise / 100;
const KEYS = ["basic", "hra", "allowances", "reimbursements", "gross", "pf", "esic", "pt", "tds", "lop", "otherDeductions", "totalDeductions", "net", "employerPf", "taxable"];

/** Runs in these states will not change again. Anything else is still being worked on. */
export const FINAL_STATES = ["approved", "bank_ready", "paid", "processed"];
export const isFinal = (status) => FINAL_STATES.includes(status);
export const isPeriod = (p) => /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(String(p || ""));
export const isFy = (fy) => /^[0-9]{4}-[0-9]{2}$/.test(String(fy || "")) && (Number(fy.slice(0, 4)) + 1) % 100 === Number(fy.slice(5));

/** The Indian financial year a month falls in: 2026-11 → "2026-27", 2027-02 → "2026-27". */
export function fyOf(period) {
  const [y, m] = String(period).split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
/** The twelve months of a financial year, April first. */
export function fyPeriods(fy) {
  const start = Number(String(fy).slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => { const m = ((3 + i) % 12) + 1; return `${m >= 4 ? start : start + 1}-${String(m).padStart(2, "0")}`; });
}
/** The TDS return quarter of a month: April to June is Q1. */
export const quarterOf = (period) => { const m = Number(String(period).slice(5)); return m >= 4 && m <= 6 ? "Q1" : m >= 7 && m <= 9 ? "Q2" : m >= 10 ? "Q3" : "Q4"; };

/** Adds payslip summaries. Returns rupees. */
export function sumOf(summaries) {
  const t = Object.fromEntries(KEYS.map((k) => [k, 0]));
  for (const s of summaries) for (const k of KEYS) t[k] += P(s && s[k]);
  return Object.fromEntries(KEYS.map((k) => [k, R(t[k])]));
}

/** What the person earned as salary: gross less reimbursements (not income) and less loss of pay. */
const salaryP = (s) => P(s.gross) - P(s.reimbursements) - P(s.lop);

export const ESIC_EMPLOYER_RATE = 3.25;   // per cent of ESIC wages; the employee's 0.75% is what payroll deducts
/** The employer's ESIC share for a payslip, in paise: 3.25% of the month's salary, rounded up to the next rupee, when the
    person is covered (payroll deducted an employee share). Payroll does not store this; it is worked out here for the report. */
const employerEsicP = (s) => (P(s.esic) > 0 ? Math.ceil((salaryP(s) / 100) * ESIC_EMPLOYER_RATE / 100) * 100 : 0);

/**
 * Statutory dues for one month: one row per person and the totals to deposit.
 * lines: [{ email, name, empNo, dept, pfNumber, pan, s: payslip summary }]
 */
export function statutory(lines) {
  const rows = lines.map((l) => ({
    email: l.email, name: l.name, empNo: l.empNo || "", dept: l.dept || "", pfNumber: l.pfNumber || "", pan: l.pan || "",
    salary: R(salaryP(l.s)), basic: Number(l.s.basic || 0), pf: Number(l.s.pf || 0), employerPf: Number(l.s.employerPf || 0),
    esic: Number(l.s.esic || 0), employerEsic: R(employerEsicP(l.s)), pt: Number(l.s.pt || 0), tds: Number(l.s.tds || 0),
  }));
  const employerEsic = lines.reduce((n, l) => n + employerEsicP(l.s), 0);
  const t = sumOf(lines.map((l) => l.s));
  const count = (k) => rows.filter((r) => r[k] > 0).length;
  return {
    rows,
    totals: {
      people: rows.length, salary: R(lines.reduce((n, l) => n + salaryP(l.s), 0)),
      pf: t.pf, employerPf: t.employerPf, pfDeposit: R(P(t.pf) + P(t.employerPf)), esic: t.esic, employerEsic: R(employerEsic), esicDeposit: R(P(t.esic) + employerEsic), pt: t.pt, tds: t.tds,
      pfPeople: count("pf"), esicPeople: count("esic"), ptPeople: count("pt"), tdsPeople: count("tds"),
    },
  };
}

/** When each deposit for a salary month is due. PF and ESIC: the 15th of the next month. TDS: the 7th, or 30 April for March. */
export function dueDates(period) {
  const [y, m] = String(period).split("-").map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const d = (day, mm = nm, yy = ny) => `${yy}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { pf: d(15), esic: d(15), tds: m === 3 ? d(30, 4, y) : d(7) };
}

/**
 * The month's payroll as one journal entry. Debits: salary cost, reimbursements, the employer's PF share.
 * Credits: what is owed to the PF office, ESIC, the state (PT), the tax department (TDS), other recoveries and staff (net pay).
 * `balanced` is true when debits equal credits to the paisa.
 */
export function journal(summaries) {
  const t = sumOf(summaries);
  const salary = summaries.reduce((n, s) => n + salaryP(s), 0);
  const employerEsic = summaries.reduce((n, s) => n + employerEsicP(s), 0);
  const other = P(t.totalDeductions) - P(t.pf) - P(t.esic) - P(t.pt) - P(t.tds) - P(t.lop);
  const lines = [
    { ledger: "Salaries and wages", debit: salary, credit: 0 },
    { ledger: "Staff reimbursements", debit: P(t.reimbursements), credit: 0 },
    { ledger: "Employer contribution to provident fund", debit: P(t.employerPf), credit: 0 },
    { ledger: "Employer contribution to ESIC", debit: employerEsic, credit: 0 },
    { ledger: "Provident fund payable", debit: 0, credit: P(t.pf) + P(t.employerPf) },
    { ledger: "ESIC payable", debit: 0, credit: P(t.esic) + employerEsic },
    { ledger: "Professional tax payable", debit: 0, credit: P(t.pt) },
    { ledger: "TDS on salaries payable", debit: 0, credit: P(t.tds) },
    { ledger: "Other recoveries from staff", debit: 0, credit: other },
    { ledger: "Salaries payable", debit: 0, credit: P(t.net) },
  ].filter((l) => l.debit !== 0 || l.credit !== 0);
  const debit = lines.reduce((n, l) => n + l.debit, 0), credit = lines.reduce((n, l) => n + l.credit, 0);
  return { lines: lines.map((l) => ({ ledger: l.ledger, debit: R(l.debit), credit: R(l.credit) })), debit: R(debit), credit: R(credit), balanced: debit === credit };
}

/** What a person cost the company in the month: salary, reimbursements and the employer's PF and ESIC shares. */
const costP = (s) => salaryP(s) + P(s.reimbursements) + P(s.employerPf) + employerEsicP(s);

/** Cost by department, largest first. */
export function costByDept(lines) {
  const by = new Map();
  for (const l of lines) {
    const key = l.dept && l.dept !== "—" ? l.dept : "Not set";
    const g = by.get(key) || { name: key, people: 0, salary: 0, reimbursements: 0, employerPf: 0, employerEsic: 0, total: 0 };
    g.people += 1; g.salary += salaryP(l.s); g.reimbursements += P(l.s.reimbursements); g.employerPf += P(l.s.employerPf); g.employerEsic += employerEsicP(l.s); g.total += costP(l.s);
    by.set(key, g);
  }
  return [...by.values()].sort((a, b) => b.total - a.total).map((g) => ({ ...g, salary: R(g.salary), reimbursements: R(g.reimbursements), employerPf: R(g.employerPf), employerEsic: R(g.employerEsic), total: R(g.total) }));
}

/**
 * How one person's month is shared between their projects, as [{ project, weight }] with weights adding up to 1 or less.
 * A project with a percentage takes that share; projects without one share what is left equally. Percentages over 100
 * in all are scaled down to 100. If every project has a percentage and they come to less than 100, the rest is unallocated.
 * allocations: [{ project, percent }] for one person (a project listed twice counts once; its first percentage wins).
 */
export function sharesOf(allocations) {
  const seen = new Map();
  for (const a of allocations) if (!seen.has(a.project)) seen.set(a.project, Number(a.percent) > 0 ? Math.min(100, Number(a.percent)) : null);
  const list = [...seen.entries()].map(([project, percent]) => ({ project, percent }));
  const set = list.filter((a) => a.percent != null), open = list.filter((a) => a.percent == null);
  const fixed = set.reduce((n, a) => n + a.percent, 0), scale = fixed > 100 ? 100 / fixed : 1;
  const left = Math.max(0, 100 - fixed * scale);
  return list.map((a) => ({ project: a.project, weight: (a.percent != null ? a.percent * scale : left / open.length) / 100 }));
}

/**
 * Cost by project. A person's cost follows sharesOf(); the last project takes the odd paisa so the parts add up to
 * the whole. No project, or a share left over: "Not allocated".
 * allocations: [{ email, project, percent }]
 */
export function costByProject(lines, allocations) {
  const of = new Map();
  for (const a of allocations) { const e = String(a.email).toLowerCase(); if (!of.has(e)) of.set(e, []); of.get(e).push(a); }
  const by = new Map();
  const add = (name, paise, share) => { if (!paise && !share) return; const g = by.get(name) || { name, people: 0, total: 0 }; g.people += share; g.total += paise; by.set(name, g); };
  for (const l of lines) {
    const shares = sharesOf(of.get(String(l.email).toLowerCase()) || []);
    const cost = costP(l.s);
    if (!shares.length) { add("Not allocated", cost, 1); continue; }
    const whole = Math.abs(shares.reduce((n, x) => n + x.weight, 0) - 1) < 1e-9;
    let used = 0;
    shares.forEach((x, i) => { const part = whole && i === shares.length - 1 ? cost - used : Math.floor(cost * x.weight); used += part; add(x.project, part, x.weight); });
    if (!whole) add("Not allocated", cost - used, 1 - shares.reduce((n, x) => n + x.weight, 0));
  }
  return [...by.values()].sort((a, b) => b.total - a.total).map((g) => ({ name: g.name, people: Math.round(g.people * 100) / 100, total: R(g.total) }));
}
/** A project share typed by a person: a whole number from 1 to 100, or empty for "share what is left equally". */
export function readShare(b = {}) {
  if (b.percent === "" || b.percent == null) return { percent: null, errors: {} };
  const n = Number(b.percent);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? { percent: n, errors: {} } : { percent: null, errors: { percent: "Please enter a whole number from 1 to 100, or leave it empty." } };
}

export const GRATUITY_CAP = 2000000;         // Payment of Gratuity Act ceiling, in rupees
export const GRATUITY_MIN_YEARS = 5;

/**
 * A gratuity estimate under the Payment of Gratuity Act: 15 ÷ 26 × last monthly basic × years of service.
 * Years of service: completed years, and a further part of more than six months counts as one more year.
 * Payable once the person has five completed years; before that it is shown as what is building up.
 */
export function gratuity({ start, basic, asOf }) {
  if (!start || !asOf || String(asOf) < String(start)) return { completedYears: 0, months: 0, serviceYears: 0, eligible: false, amount: 0, capped: false };
  const [sy, sm, sd] = String(start).split("-").map(Number), [ay, am, ad] = String(asOf).split("-").map(Number);
  let months = (ay - sy) * 12 + (am - sm) - (ad < sd ? 1 : 0);
  if (months < 0) months = 0;
  const completedYears = Math.floor(months / 12), rest = months % 12;
  // "More than six months": six full months and at least one more day.
  const beyondSix = rest > 6 || (rest === 6 && ad !== sd);
  const serviceYears = completedYears + (beyondSix ? 1 : 0);
  const raw = Math.round((15 / 26) * Number(basic || 0) * serviceYears);
  return { completedYears, months: rest, serviceYears, eligible: completedYears >= GRATUITY_MIN_YEARS, amount: Math.min(raw, GRATUITY_CAP), capped: raw > GRATUITY_CAP };
}

/**
 * One person's year: a row per month that has a payslip, the year's totals and TDS by quarter.
 * months: [{ period, status, s }]
 */
export function annualStatement(months) {
  const rows = [...months].sort((a, b) => (a.period < b.period ? -1 : 1)).map((m) => ({
    period: m.period, final: isFinal(m.status), salary: R(salaryP(m.s)), basic: Number(m.s.basic || 0), hra: Number(m.s.hra || 0),
    taxable: Number(m.s.taxable || 0), pf: Number(m.s.pf || 0), pt: Number(m.s.pt || 0), tds: Number(m.s.tds || 0), net: Number(m.s.net || 0),
  }));
  const add = (k, list = rows) => R(list.reduce((n, r) => n + P(r[k]), 0));
  const quarters = ["Q1", "Q2", "Q3", "Q4"].map((q) => { const list = rows.filter((r) => quarterOf(r.period) === q); return { quarter: q, months: list.length, taxable: add("taxable", list), tds: add("tds", list) }; });
  return {
    rows, quarters,
    totals: { months: rows.length, draftMonths: rows.filter((r) => !r.final).length, salary: add("salary"), basic: add("basic"), hra: add("hra"), taxable: add("taxable"), pf: add("pf"), pt: add("pt"), tds: add("tds"), net: add("net") },
  };
}

export const PROOF_STATES = ["received", "verified", "rejected"];
/** HR's note on the proof for one line of a tax declaration. */
/** HR's decision on the proof for one line. `declaredMinor` is the line's amount: a verified line may be approved for less
    (`approved`, in rupees), as Keka allows; empty means the full amount. */
export function readProof(b = {}, lineCount = 0, declaredMinor = []) {
  const errors = {};
  const index = Number(b.index);
  const status = PROOF_STATES.includes(b.status) ? b.status : b.status === "waiting" ? "waiting" : null;
  const note = String(b.note == null ? "" : b.note).trim().slice(0, 300);
  if (!Number.isInteger(index) || index < 0 || index >= lineCount) errors.index = "Please choose a line of the declaration.";
  if (!status) errors.status = "Please choose what happened with the proof.";
  if (status === "rejected" && !note) errors.note = "Please say what is wrong with the proof, so the person knows what to send.";
  let approvedMinor = null;
  const raw = b.approved == null ? "" : String(b.approved).replace(/[₹,\s]/g, "");
  if (status === "verified" && raw !== "" && !errors.index) {
    const n = Number(raw), declared = Number(declaredMinor[index]) || 0;
    if (!Number.isFinite(n) || n < 0) errors.approved = "Please enter the approved amount in rupees.";
    else if (Math.round(n * 100) > declared) errors.approved = "The approved amount cannot be more than the amount declared.";
    else if (Math.round(n * 100) < declared) approvedMinor = Math.round(n * 100);
    if (approvedMinor !== null && approvedMinor < declared && !note) errors.note = "Please say why a lower amount is approved.";
  }
  return { index, status, note, approvedMinor, errors };
}

/* ---------- Who may open finance reports without being HR or a payroll reviewer ---------- */

/* ---------- Labour welfare fund (Maharashtra) ---------- */
// Paid twice a year, with the June and December salaries. Rates under the Maharashtra Labour Welfare Fund Act as amended
// in 2024. Your accountant should confirm these before a deposit; payroll does not deduct the employee share by itself.
export const LWF = { months: ["06", "12"], employee: 25, employer: 75 };
export function lwf(period, lines) {
  const month = String(period).slice(5), year = Number(String(period).slice(0, 4));
  const applies = LWF.months.includes(month);
  const people = applies ? lines.filter((l) => salaryP(l.s) > 0).length : 0;
  return { applies, people, employeeEach: LWF.employee, employerEach: LWF.employer, employee: people * LWF.employee, employer: people * LWF.employer,
    total: people * (LWF.employee + LWF.employer), due: applies ? (month === "06" ? `${year}-07-15` : `${year + 1}-01-15`) : null };
}

/* ---------- Files for the government portals and for Tally ---------- */
const whole = (rupees) => Math.round(Number(rupees || 0));
/**
 * The PF return (ECR) text file: one line per member, fields joined by "#~#":
 * UAN, name, gross wages, EPF wages, EPS wages, EDLI wages, EPF contribution, EPS contribution, EPF less EPS, NCP days, refund.
 * EPF wages are worked back from the 12% payroll deducted, so the file always agrees with the payslips.
 * Only people with a PF deduction are listed. `missing` names those whose PF number is not a 12-digit UAN.
 */
export function ecr(lines) {
  const rows = [], missing = [];
  for (const l of lines) {
    if (!(Number(l.s.pf) > 0)) continue;
    const uan = /^[0-9]{12}$/.test(String(l.pfNumber || "").trim()) ? String(l.pfNumber).trim() : "";
    if (!uan) missing.push(l.name);
    const epfWages = whole(Number(l.s.pf) / 0.12), epsWages = Math.min(epfWages, 15000);
    const eps = whole(epsWages * 0.0833), employer = whole(l.s.employerPf);
    rows.push([uan, String(l.name || "").replace(/[#~]/g, " ").trim(), whole(R(salaryP(l.s))), epfWages, epsWages, epsWages, whole(l.s.pf), Math.min(eps, employer), Math.max(0, employer - eps), whole(l.lopDays), 0]);
  }
  return { rows, missing, text: rows.map((r) => r.join("#~#")).join("\n") };
}
/** The ESIC monthly contribution sheet: IP number (not held in Wohlig One, so empty), name, days paid, wages. */
export function esicSheet(lines) {
  return lines.filter((l) => Number(l.s.esic) > 0).map((l) => ["", l.name, whole(l.paidDays), whole(R(salaryP(l.s))), "", ""]);
}
const xml = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** The journal entry as a Tally import file (one Journal voucher). In Tally a debit is a negative amount marked "deemed positive". */
export function tallyXml(entry, date, narration) {
  const lines = entry.lines.map((l) => { const debit = l.debit > 0, amount = (debit ? -l.debit : l.credit).toFixed(2);
    return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(l.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`; });
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>`
    + `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>${String(date).replace(/-/g, "")}</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>${xml(narration)}</NARRATION>`
    + lines.join("") + `</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

/* ---------- Contractor and consultant payments ---------- */
// The usual TDS rate for each section, in per cent. The accountant can change the rate on a payment (for example 1% under
// 194C for an individual, or 2% under 194J for technical services). Without a PAN the law asks for 20%.
export const TDS_SECTIONS = { "194C": 2, "194J": 10, "194H": 2, "194I": 10 };
export const NO_PAN_RATE = 20;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const maskPan = (pan) => (PAN.test(pan) ? `XXXXXX${pan.slice(6)}` : "");
export function readContractorPayment(b = {}) {
  const errors = {};
  const name = String(b.name == null ? "" : b.name).trim().replace(/\s+/g, " ").slice(0, 120);
  const pan = String(b.pan == null ? "" : b.pan).trim().toUpperCase();
  const section = Object.hasOwn(TDS_SECTIONS, b.section) ? b.section : null;
  const paidOn = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(String(b.paidOn || "")) && !Number.isNaN(Date.parse(b.paidOn)) ? b.paidOn : null;
  const n = Number(String(b.amount == null ? "" : b.amount).replace(/[₹,\s]/g, ""));
  const amountMinor = Number.isFinite(n) ? Math.round(n * 100) : NaN;
  const note = String(b.note == null ? "" : b.note).trim().slice(0, 200);
  if (!name) errors.name = "Please enter who was paid.";
  if (pan && !PAN.test(pan)) errors.pan = "Please check the PAN: five letters, four digits and a letter.";
  if (!section) errors.section = "Please choose the section the tax is deducted under.";
  if (!paidOn) errors.paidOn = "Please choose the date of the payment.";
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) errors.amount = "Please enter the amount in rupees, before tax.";
  else if (amountMinor > 100000000000) errors.amount = "That amount is too large. Please check it.";
  let rate = b.rate === "" || b.rate == null ? (section ? TDS_SECTIONS[section] : 0) : Number(b.rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 30) { errors.rate = "Please enter a rate from 0 to 30 per cent."; rate = 0; }
  if (!pan && rate < NO_PAN_RATE) rate = NO_PAN_RATE;   // no PAN: the higher rate applies
  const tdsMinor = Number.isFinite(amountMinor) ? Math.round(amountMinor * rate / 100 / 100) * 100 : 0;   // to the rupee
  return { name, panMasked: maskPan(pan), hasPan: !!pan && PAN.test(pan), section, paidOn, amountMinor, rate, tdsMinor, note, errors };
}
/** Contractor payments by quarter and section, for the quarterly return (Form 26Q). rows: [{ paidOn, section, amountMinor, tdsMinor }] */
export function contractorQuarters(rows) {
  const by = new Map();
  for (const r of rows) {
    const key = `${quarterOf(String(r.paidOn).slice(0, 7))} ${r.section}`;
    const g = by.get(key) || { quarter: key.slice(0, 2), section: r.section, payments: 0, amount: 0, tds: 0 };
    g.payments += 1; g.amount += Number(r.amountMinor); g.tds += Number(r.tdsMinor); by.set(key, g);
  }
  return [...by.values()].sort((a, b) => (a.quarter + a.section < b.quarter + b.section ? -1 : 1)).map((g) => ({ ...g, amount: g.amount / 100, tds: g.tds / 100 }));
}
