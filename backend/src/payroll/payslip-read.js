import { pdfText } from "../extract.js";

/*
 * Reads a payslip PDF in the company format (the one payslips.js draws) so HR can start a salary structure from it.
 * It only suggests: the numbers go into the salary form for HR to check and edit, nothing is saved here.
 *
 *   Earnings            every line before "Total Earnings", except "Reimbursements (Ad Hoc)" (it changes every month: it's a monthly input)
 *   PF Employee         → PF amount
 *   ESIC Employee       → ESIC amount
 *   Professional Tax    → professional tax
 *   … Income Tax        → fixed monthly TDS (the amount the CA worked out)
 *   Loss of Pay         → left out (it's worked out from leave each month)
 *   any other line      → another monthly deduction
 * The payslip's own totals (earnings, net) are checked against the lines read; any difference is reported.
 */
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// "Special Allowance17,754.00": the name runs straight into the amount. Lazy name, so "Basic75,000.00" is Basic + 75,000.00 (not "Basic75," + 000.00).
const AMOUNT = /^(.*?\D)(\d{1,3}(?:,\d{2,3})*\.\d{2}|\d+\.\d{2})$/;
const money = (s) => Math.round(Number(String(s).replace(/,/g, "")) * 100) / 100;
const paise = (n) => Math.round(n * 100);

/** The line after a label such as "Employee Number". */
const after = (lines, label) => { const i = lines.findIndex((l) => l.toLowerCase() === label.toLowerCase()); return i >= 0 ? lines[i + 1] || null : null; };

/** Parses the text of a payslip. Returns { ok: true, ...suggestion } or { ok: false, error }. */
export function parsePayslip(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const head = lines.map((l) => /^PAYSLIP\s+([A-Za-z]{3})\s+(\d{4})$/i.exec(l)).find(Boolean);
  const iEarn = lines.findIndex((l) => /^EARNINGS$/i.test(l));
  if (!head || iEarn < 0) return { ok: false, error: "This doesn't look like a Wohlig payslip. Upload the payslip PDF as downloaded from the HR Access Hub, or enter the salary by hand." };
  const period = `${head[2]}-${String(MON[head[1].toLowerCase()] || 0).padStart(2, "0")}`;

  const out = { earnings: [], pfEmployee: 0, esicEmployee: 0, professionalTax: 0, tds: 0, otherDeductions: [], left: [] };
  const printed = {};
  let section = "earnings";
  for (const l of lines.slice(iEarn + 1)) {
    if (/^CONTRIBUTIONS$/i.test(l)) { section = "contributions"; continue; }
    if (/^TAXES\s*&\s*DEDUCTIONS$/i.test(l)) { section = "deductions"; continue; }
    if (/^Net Salary Payable/i.test(l)) { const m = AMOUNT.exec(l); if (m) printed.net = money(m[2]); break; }
    const m = AMOUNT.exec(l);
    if (!m) continue;
    const name = m[1].trim(), amount = money(m[2]);
    const total = /^Total\s+(Earnings|Contributions|Taxes)/i.exec(name);
    if (total) { printed[total[1].toLowerCase()] = amount; continue; }
    if (section === "earnings") {
      if (/^Reimbursements?\s*\(Ad Hoc\)/i.test(name)) out.left.push({ name, amount, why: "Changes every month: enter it as a monthly input in each payroll." });
      else out.earnings.push({ name, amount });
    } else if (/^PF\s*Employee/i.test(name)) out.pfEmployee = amount;
    else if (/^ESIC/i.test(name)) out.esicEmployee = amount;
    else if (/^Professional Tax/i.test(name)) out.professionalTax = amount;
    else if (/Income Tax/i.test(name)) out.tds = amount;
    else if (/^Loss of Pay/i.test(name)) out.left.push({ name, amount, why: "Worked out from leave every month." });
    else out.otherDeductions.push({ name, amount });
  }
  if (!out.earnings.length) return { ok: false, error: "No earnings were found on this payslip. Enter the salary by hand." };

  // The payslip's own totals must agree with the lines read.
  const earned = out.earnings.concat(out.left.filter((x) => /Reimb/i.test(x.name))).reduce((n, x) => n + paise(x.amount), 0);
  const deducted = paise(out.pfEmployee) + paise(out.esicEmployee) + paise(out.professionalTax) + paise(out.tds) + out.otherDeductions.reduce((n, x) => n + paise(x.amount), 0)
    + out.left.filter((x) => /^Loss of Pay/i.test(x.name)).reduce((n, x) => n + paise(x.amount), 0);
  const warnings = [];
  if (printed.earnings !== undefined && paise(printed.earnings) !== earned) warnings.push(`The lines add up to ₹${earned / 100} but the payslip says total earnings ₹${printed.earnings}. A line may be missing: check them.`);
  if (printed.net !== undefined && paise(printed.net) !== earned - deducted) warnings.push(`The lines give net pay ₹${(earned - deducted) / 100} but the payslip says ₹${printed.net}. Check the deductions.`);

  const emp = {
    name: lines[lines.findIndex((l) => /^Employee Number$/i.test(l)) - 1] || null, empNo: after(lines, "Employee Number"), joined: after(lines, "Date Joined"),
    pfNumber: after(lines, "PF Number"), department: after(lines, "Department"), designation: after(lines, "Designation"),
  };
  return { ok: true, period, employee: emp, ...out, printed, matches: !warnings.length, warnings };
}

/** Text from a PDF buffer, then parsed. */
export function readPayslipPdf(buf) {
  let text = "";
  try { text = pdfText(buf); } catch { /* handled below */ }
  if (!String(text).trim()) return { ok: false, error: "No text could be read from this PDF (it may be a scan or a photo). Enter the salary by hand." };
  return parsePayslip(text);
}
