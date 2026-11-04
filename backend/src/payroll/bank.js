/*
 * The salary disbursement file HR uploads to corporate (net) banking after the payroll is approved.
 * It only describes the payments: nothing here talks to a bank or moves money. An authorized person uploads it in the
 * bank's portal, where the bank's own approval applies, and HR then marks the payroll processed with the bank's reference.
 *
 * The layout is a generic bulk-payment CSV (one row per payment, a header row, amounts in rupees with two decimals).
 * Banks differ in their templates: if yours needs other columns or order, change BANK_COLUMNS below; the data is the same.
 * PAYROLL_DEBIT_ACCOUNT (optional) fills the company's debit account column.
 */
export const BANK_COLUMNS = [
  ["Payment Reference", (p) => p.reference],
  ["Beneficiary Name", (p) => p.holder],
  ["Beneficiary Account Number", (p) => p.account],
  ["IFSC", (p) => p.ifsc],
  ["Beneficiary Bank", (p) => p.bankName],
  ["Amount", (p) => p.amount.toFixed(2)],
  ["Payment Mode", (p) => p.mode],
  ["Salary Month", (p) => p.month],
  ["Narration", (p) => p.narration],
  ["Employee ID", (p) => p.empNo],
  ["Debit Account", (p) => p.debitAccount],
];

/** "SAL202611WOH042": salary, month, employee number (letters and digits only, at most 20 characters, as banks accept). */
export const paymentReference = (period, empNo, email) =>
  `SAL${period.replace("-", "")}${String(empNo || email.split("@")[0]).toUpperCase().replace(/[^A-Z0-9]/g, "")}`.slice(0, 20);

/** A CSV cell. A value that a spreadsheet would read as a formula gets a leading apostrophe. */
const cell = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Payments in paise-exact rupees. Rows: [{ empNo, email, holder, account, ifsc, bankName, net }]. Returns { csv, payments, total, count }. */
export function buildBankFile(period, monthText, rows) {
  const debitAccount = (process.env.PAYROLL_DEBIT_ACCOUNT || "").trim();
  const payments = rows.map((r) => ({
    reference: paymentReference(period, r.empNo, r.email), holder: r.holder.slice(0, 50), account: r.account, ifsc: r.ifsc, bankName: r.bankName,
    amount: Math.round(r.net * 100) / 100, mode: r.ifsc.slice(0, 4) === (process.env.PAYROLL_DEBIT_BANK_CODE || "").toUpperCase() ? "IFT" : "NEFT",
    month: monthText, narration: `Salary ${monthText}`.slice(0, 30), empNo: r.empNo || "", debitAccount,
  }));
  const refs = new Set();
  for (const p of payments) {
    if (refs.has(p.reference)) { const e = new Error(`Two payments would have the reference ${p.reference}. Give each employee a distinct employee number.`); e.status = 422; throw e; }
    refs.add(p.reference);
  }
  const lines = [BANK_COLUMNS.map(([h]) => h).join(","), ...payments.map((p) => BANK_COLUMNS.map(([, f]) => cell(f(p))).join(","))];
  const totalPaise = payments.reduce((n, p) => n + Math.round(p.amount * 100), 0);
  return { csv: lines.join("\r\n") + "\r\n", payments, total: totalPaise / 100, count: payments.length };
}
