import ExcelJS from "exceljs";
import { STATUS } from "./workflow.js";
import { monthName } from "./store.js";
import { fyOf } from "./tax.js";

/*
 * The month's payroll workbook, built from the run as stored in the database (loadRun). Three sheets:
 *   1. Employee Payroll Summary   one row per person paid this month, with per-row formulas and a grand total row
 *   2. Salary Calculation Details every earning and deduction per person, the calculation steps and the TDS working
 *   3. Payroll Summary            totals as formulas over sheet 1, next to the database's figures, and whether they match
 * Bank account numbers are masked here (the report is emailed for review). The full numbers are only in the bank file.
 */
export const COMPANY = "Wohlig Transformations Pvt Ltd";
const INR = '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"##,##0.00';
const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F2A8C" } };
const TOTAL_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEBFA" } };
const BAND_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F6FB" } };
const thin = { style: "thin", color: { argb: "FFD5D5DE" } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };
const SHEET1 = "Employee Payroll Summary";

/** Sheet 1 columns. `money` columns are summed in the totals row; `f` makes a per-row formula from the row's cell refs. */
export const SUMMARY_COLUMNS = [
  { key: "empNo", header: "Employee ID", width: 13 },
  { key: "name", header: "Employee Name", width: 26 },
  { key: "dept", header: "Department", width: 18 },
  { key: "title", header: "Designation", width: 24 },
  { key: "holder", header: "Account Holder Name", width: 24 },
  { key: "acct", header: "Bank Account No.", width: 16 },
  { key: "ifsc", header: "IFSC", width: 13 },
  { key: "bankName", header: "Bank Name", width: 18 },
  { key: "basic", header: "Basic", money: true },
  { key: "hra", header: "HRA", money: true },
  { key: "allowances", header: "Allowances", money: true },
  { key: "otherEarnings", header: "Other Earnings", money: true },
  { key: "gross", header: "Gross Salary", money: true, f: (c) => `SUM(${c.basic}:${c.otherEarnings})` },
  { key: "pf", header: "PF (Employee)", money: true },
  { key: "pt", header: "Professional Tax", money: true },
  { key: "tds", header: "TDS", money: true },
  { key: "lop", header: "Loss of Pay", money: true },
  { key: "otherDeductions", header: "Other Deductions", money: true },
  { key: "totalDeductions", header: "Total Deductions", money: true, f: (c) => `SUM(${c.pf}:${c.otherDeductions})` },
  { key: "net", header: "Net Payable", money: true, f: (c) => `${c.gross}-${c.totalDeductions}` },
];
const colLetter = (i) => { let s = "", n = i + 1; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

function title(ws, text, sub, width) {
  ws.mergeCells(1, 1, 1, width); ws.mergeCells(2, 1, 2, width);
  Object.assign(ws.getCell(1, 1), { value: text, font: { bold: true, size: 14, color: { argb: "FF1B1650" } } });
  Object.assign(ws.getCell(2, 1), { value: sub, font: { size: 10, color: { argb: "FF6B6B7B" } } });
  ws.getRow(1).height = 22;
}
function header(row) {
  row.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = HEAD_FILL; c.border = BORDER; c.alignment = { vertical: "middle", wrapText: true }; });
  row.height = 30;
}

/**
 * Builds the workbook. data = loadRun() result; meta = { version, generatedBy, generatedAt }.
 * Returns { buffer, totals } where totals are the database figures written into the report.
 */
export async function buildWorkbook(data, meta) {
  const { run } = data;
  const paid = data.lines.filter((l) => l.status === "ready");
  const held = data.lines.filter((l) => l.status !== "ready");
  const t = data.totals;
  const wb = new ExcelJS.Workbook();
  wb.creator = "HR Access Hub"; wb.company = COMPANY; wb.created = new Date(meta.generatedAt);
  wb.calcProperties.fullCalcOnLoad = true;   // formulas are recalculated when opened; cached results are the database figures
  const fyText = fyOf(run.period);
  const sub = `Payroll month ${monthName(run.period)} · FY ${fyText} · Status ${STATUS[run.status] || run.status} · Version ${meta.version} · Generated ${new Date(meta.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} by ${meta.generatedBy} · All amounts in INR`;

  /* ---------- Sheet 1 ---------- */
  const s1 = wb.addWorksheet(SHEET1, { views: [{ state: "frozen", xSplit: 2, ySplit: 4 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const W = SUMMARY_COLUMNS.length;
  title(s1, `${COMPANY} · Payroll for ${monthName(run.period)}`, sub, W);
  const ref = Object.fromEntries(SUMMARY_COLUMNS.map((c, i) => [c.key, colLetter(i)]));
  SUMMARY_COLUMNS.forEach((c, i) => { s1.getColumn(i + 1).width = c.width || 15; if (c.money) s1.getColumn(i + 1).numFmt = INR; });
  s1.getRow(4).values = SUMMARY_COLUMNS.map((c) => c.header);
  header(s1.getRow(4));
  const first = 5;
  paid.forEach((l, n) => {
    const r = first + n, s = l.summary;
    const v = { empNo: l.empNo || "", name: l.name, dept: l.dept || "", title: l.title || "", holder: l.bank.holder || "", acct: l.bank.onFile ? `XXXX${l.bank.last4}` : "Not on file",
      ifsc: l.bank.ifsc || "", bankName: l.bank.bankName || "", ...s };
    const cells = Object.fromEntries(SUMMARY_COLUMNS.map((c) => [c.key, `${ref[c.key]}${r}`]));
    SUMMARY_COLUMNS.forEach((c, i) => {
      const cell = s1.getCell(r, i + 1);
      cell.value = c.f ? { formula: c.f(cells), result: round2(v[c.key]) } : c.money ? round2(v[c.key]) : v[c.key];
      cell.border = BORDER;
      if (n % 2) cell.fill = BAND_FILL;
    });
  });
  const last = first + paid.length - 1, totalRow = last + 1;
  s1.getCell(totalRow, 1).value = "Grand total";
  s1.getCell(totalRow, 2).value = { formula: `COUNTA(B${first}:B${Math.max(first, last)})`, result: paid.length };
  s1.getCell(totalRow, 2).numFmt = '0" employees"';
  SUMMARY_COLUMNS.forEach((c, i) => {
    if (c.money) s1.getCell(totalRow, i + 1).value = { formula: `SUM(${ref[c.key]}${first}:${ref[c.key]}${Math.max(first, last)})`, result: round2(t[c.key]) };
  });
  s1.getRow(totalRow).eachCell({ includeEmpty: true }, (c) => { c.font = { bold: true }; c.fill = TOTAL_FILL; c.border = BORDER; });
  s1.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, last), column: W } };
  const totalRef = (key) => `'${SHEET1}'!${ref[key]}${totalRow}`;

  /* ---------- Sheet 2 ---------- */
  const s2 = wb.addWorksheet("Salary Calculation Details", { views: [{ state: "frozen", ySplit: 4 }] });
  [14, 26, 22, 46, 16, 60].forEach((w, i) => { s2.getColumn(i + 1).width = w; });
  s2.getColumn(5).numFmt = INR;
  title(s2, `Salary calculation details · ${monthName(run.period)}`, sub, 6);
  s2.getRow(4).values = ["Employee ID", "Employee Name", "Section", "Component", "Amount", "Notes"];
  header(s2.getRow(4));
  let r2 = 5;
  const put = (vals, style = {}) => { const row = s2.getRow(r2++); row.values = vals; row.eachCell({ includeEmpty: true }, (c) => { c.border = BORDER; Object.assign(c, style); }); return row; };
  for (const l of paid) {
    const id = l.empNo || "", d = l.days || {};
    put([id, l.name, "Employee", `${l.title || ""} · ${l.dept || ""}`, null, `Days in month ${d.total ?? "-"}, employed ${d.actual ?? "-"}, loss of pay ${d.lop ?? 0}, payable ${d.payable ?? "-"}`], { font: { bold: true }, fill: TOTAL_FILL });
    const startE = r2;
    for (const e of l.earnings) put([id, l.name, "Earning", e.name, round2(e.amount), ""]);
    const endE = r2 - 1;
    put([id, l.name, "Total", "Gross earnings (A)", endE >= startE ? { formula: `SUM(E${startE}:E${endE})`, result: round2(l.summary.gross) } : 0, ""], { font: { bold: true } });
    const grossRow = r2 - 1, startD = r2;
    for (const c of l.contributions) put([id, l.name, "Deduction", c.name, round2(c.amount), "Employee's contribution"]);
    for (const x of l.deductions) put([id, l.name, "Deduction", x.name, round2(x.amount), x.code === "tds" && l.tds && l.tds.override ? `Overridden by HR (calculated ₹${l.tds.override.calculated}): ${l.tds.override.reason}` : ""]);
    const endD = r2 - 1;
    put([id, l.name, "Total", "Total deductions (B)", endD >= startD ? { formula: `SUM(E${startD}:E${endD})`, result: round2(l.summary.totalDeductions) } : 0, ""], { font: { bold: true } });
    const dedRow = r2 - 1;
    put([id, l.name, "Net", "Net payable (A − B)", { formula: `E${grossRow}-E${dedRow}`, result: round2(l.summary.net) }, ""], { font: { bold: true }, fill: TOTAL_FILL });
    for (const e of l.employer) put([id, l.name, "Employer cost", e.name, round2(e.amount), "Paid by the company on top; not deducted from take-home pay"]);
    const b = l.tds && l.tds.breakdown;
    if (b) {
      const tx = [["Projected taxable salary for the year", b.projectedSalary], ["Other income and previous employer's salary", b.otherIncome + b.previousEmployerIncome],
        ["Deductions allowed", b.totalDeductions], ["Taxable income", b.taxableIncome], ["Tax on slabs", b.slabTax], ["Rebate (87A)", b.rebate], ["Surcharge", b.surcharge],
        ["Health & education cess", b.cess], ["Tax for the year", b.annualTax], ["TDS already deducted (incl. previous employer)", b.tdsDeductedSoFar + b.previousEmployerTds],
        ["Remaining tax", b.remainingTax], [`TDS this month (remaining ÷ ${b.monthsIncludingThis} months)`, b.monthlyTds]];
      for (const [k, v] of tx) put([id, l.name, `TDS working (${b.regime} regime, FY ${b.fy})`, k, round2(v), ""], { font: { color: { argb: "FF4A4A5A" } } });
    }
    for (const step of l.calc) put([id, l.name, "Calculation", "", null, step], { alignment: { wrapText: true, vertical: "top" } });
    r2++;
  }

  /* ---------- Sheet 3 ---------- */
  const s3 = wb.addWorksheet("Payroll Summary");
  [42, 22, 22, 16].forEach((w, i) => { s3.getColumn(i + 1).width = w; });
  title(s3, `Payroll summary · ${monthName(run.period)}`, sub, 4);
  const info = [["Company", COMPANY], ["Payroll month", monthName(run.period)], ["Financial year", fyText], ["Status", STATUS[run.status] || run.status],
    ["Report version", meta.version], ["Generated by", meta.generatedBy], ["Generated at", new Date(meta.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })]];
  let r3 = 4;
  for (const [k, v] of info) { s3.getCell(r3, 1).value = k; s3.getCell(r3, 1).font = { bold: true }; s3.getCell(r3, 2).value = v; r3++; }
  r3++;
  s3.getRow(r3).values = ["Measure", "From this workbook", "Payroll database", "Check"];
  header(s3.getRow(r3)); r3++;
  const measures = [
    ["Total employees processed", { formula: `COUNTA('${SHEET1}'!B${first}:B${Math.max(first, last)})`, result: paid.length }, paid.length, false],
    ["Total gross payroll", { formula: totalRef("gross"), result: round2(t.gross) }, round2(t.gross), true],
    ["Total PF (employee)", { formula: totalRef("pf"), result: round2(t.pf) }, round2(t.pf), true],
    ["Total professional tax", { formula: totalRef("pt"), result: round2(t.pt) }, round2(t.pt), true],
    ["Total TDS", { formula: totalRef("tds"), result: round2(t.tds) }, round2(t.tds), true],
    ["Total loss of pay", { formula: totalRef("lop"), result: round2(t.lop) }, round2(t.lop), true],
    ["Total other deductions", { formula: totalRef("otherDeductions"), result: round2(t.otherDeductions) }, round2(t.otherDeductions), true],
    ["Total deductions", { formula: totalRef("totalDeductions"), result: round2(t.totalDeductions) }, round2(t.totalDeductions), true],
    ["Total net salary payable", { formula: totalRef("net"), result: round2(t.net) }, round2(t.net), true],
    ["Employer PF (company cost, not deducted)", round2(t.employerPf), round2(t.employerPf), true],
  ];
  for (const [k, f, db, money] of measures) {
    s3.getCell(r3, 1).value = k;
    s3.getCell(r3, 2).value = f; s3.getCell(r3, 3).value = db;
    s3.getCell(r3, 4).value = { formula: `IF(ROUND(B${r3}-C${r3},2)=0,"Matches","Check")`, result: "Matches" };
    if (money) { s3.getCell(r3, 2).numFmt = INR; s3.getCell(r3, 3).numFmt = INR; }
    for (let c = 1; c <= 4; c++) s3.getCell(r3, c).border = BORDER;
    if (k === "Total net salary payable") s3.getRow(r3).eachCell((c) => { c.font = { bold: true }; c.fill = TOTAL_FILL; });
    r3++;
  }
  if (held.length) {
    r3++;
    s3.getCell(r3, 1).value = "Not paid this month"; s3.getCell(r3, 1).font = { bold: true }; r3++;
    for (const l of held) { s3.getCell(r3, 1).value = `${l.empNo || ""} ${l.name}`.trim(); s3.getCell(r3, 2).value = l.status === "hold" ? `On hold: ${l.inputs.holdReason || ""}` : l.incomplete.join(" "); r3++; }
  }
  r3++;
  s3.getCell(r3, 1).value = "The payroll database is the record. This workbook is a copy for review; it does not move any money.";
  s3.getCell(r3, 1).font = { italic: true, color: { argb: "FF6B6B7B" } };

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, totals: { people: paid.length, gross: round2(t.gross), pf: round2(t.pf), pt: round2(t.pt), tds: round2(t.tds), lop: round2(t.lop), otherDeductions: round2(t.otherDeductions), totalDeductions: round2(t.totalDeductions), net: round2(t.net) } };
}
