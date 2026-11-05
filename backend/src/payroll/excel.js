import ExcelJS from "exceljs";
import { STATUS } from "./workflow.js";
import { monthName } from "./store.js";
import { fyOf } from "./tax.js";

/*
 * The month's payroll workbook, built from the run as stored in the database (loadRun). Three sheets:
 *   1. Employee Payroll Summary   Name, Gross, PF, PT, ESIC, TDS, Deduction (Adv/Late), Reimbur, Net Payable (a formula), grand total row
 *   2. Salary Calculation Details every earning and deduction per person, the calculation steps and the TDS working
 *   3. Payroll Summary            totals as formulas over sheet 1, next to the database's figures, and whether they match
 * Sheet 1 has only the columns of HR's sample sheet. Bank details are not in the report at all: they are only in the bank file.
 */
export const COMPANY = "Wohlig Transformations Pvt Ltd";
// Rows show "-" for nothing, like the sample sheet; totals always show the amount.
const ROW = '[>=100000]"₹"##\\,##\\,##0.00;[=0]"-";"₹"##,##0.00';
const INR = '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"##,##0.00';
const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F2A8C" } };
const TOTAL_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEBFA" } };
const BAND_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F6FB" } };
const thin = { style: "thin", color: { argb: "FFD5D5DE" } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };
const SHEET1 = "Employee Payroll Summary";

/** Sheet 1 columns, as in HR's sample sheet. Net = Gross − PF − PT − ESIC − TDS − Deduction + Reimbursements.
 *  Gross is salary only (reimbursements are not in it); Deduction (Adv/Late) is loss of pay plus other deductions (advances, late marks…). */
export const SUMMARY_COLUMNS = [
  { key: "name", header: "Name", width: 28 },
  { key: "gross", header: "Gross", money: true },
  { key: "pf", header: "PF", money: true },
  { key: "pt", header: "PT", money: true },
  { key: "esic", header: "ESIC", money: true },
  { key: "tds", header: "TDS", money: true },
  { key: "deduction", header: "Deduction (Adv/Late)", money: true, width: 21 },
  { key: "reimb", header: "Reimbur", money: true },
  { key: "net", header: "Net Payable", money: true, f: (c) => `${c.gross}-${c.pf}-${c.pt}-${c.esic}-${c.tds}-${c.deduction}+${c.reimb}` },
];
/** One person's figures for those columns, added in paise. */
const p100 = (n) => Math.round(Number(n || 0) * 100);
export const rowOf = (s) => ({ gross: (p100(s.gross) - p100(s.reimbursements)) / 100, pf: s.pf || 0, pt: s.pt || 0, esic: s.esic || 0, tds: s.tds || 0,
  deduction: (p100(s.lop) + p100(s.otherDeductions)) / 100, reimb: s.reimbursements || 0, net: s.net });
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
  // The totals row, in the same columns as the rows (from the database totals).
  const T = { gross: round2(t.gross - t.reimbursements), pf: t.pf, pt: t.pt, esic: t.esic, tds: t.tds, deduction: round2(t.lop + t.otherDeductions), reimb: t.reimbursements, net: t.net };
  const sub = `Payroll month ${monthName(run.period)} · FY ${fyText} · Status ${STATUS[run.status] || run.status} · Version ${meta.version} · Generated ${new Date(meta.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} by ${meta.generatedBy} · All amounts in INR`;

  /* ---------- Sheet 1 ---------- */
  const s1 = wb.addWorksheet(SHEET1, { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const W = SUMMARY_COLUMNS.length;
  title(s1, `${COMPANY} · Payroll for ${monthName(run.period)}`, sub, W);
  const ref = Object.fromEntries(SUMMARY_COLUMNS.map((c, i) => [c.key, colLetter(i)]));
  SUMMARY_COLUMNS.forEach((c, i) => { s1.getColumn(i + 1).width = c.width || 15; if (c.money) s1.getColumn(i + 1).numFmt = INR; });
  s1.getRow(4).values = SUMMARY_COLUMNS.map((c) => c.header);
  header(s1.getRow(4));
  const first = 5;
  paid.forEach((l, n) => {
    const r = first + n, v = { name: l.name, ...rowOf(l.summary) };
    const cells = Object.fromEntries(SUMMARY_COLUMNS.map((c) => [c.key, `${ref[c.key]}${r}`]));
    SUMMARY_COLUMNS.forEach((c, i) => {
      const cell = s1.getCell(r, i + 1);
      cell.value = c.f ? { formula: c.f(cells), result: round2(v[c.key]) } : c.money ? round2(v[c.key]) : v[c.key];
      if (c.money) cell.numFmt = ROW;
      cell.border = BORDER;
      if (n % 2) cell.fill = BAND_FILL;
    });
  });
  const last = first + paid.length - 1, totalRow = last + 1;
  s1.getCell(totalRow, 1).value = `Grand total · ${paid.length} employee${paid.length === 1 ? "" : "s"}`;
  SUMMARY_COLUMNS.forEach((c, i) => {
    if (c.money) { s1.getCell(totalRow, i + 1).value = { formula: `SUM(${ref[c.key]}${first}:${ref[c.key]}${Math.max(first, last)})`, result: round2(T[c.key]) }; s1.getCell(totalRow, i + 1).numFmt = INR; }
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
  const sum = (keys) => keys.map(totalRef).join("+");
  const measures = [
    ["Total employees processed", { formula: `COUNTA('${SHEET1}'!A${first}:A${Math.max(first, last)})`, result: paid.length }, paid.length, false],
    ["Total gross salary (before reimbursements)", { formula: totalRef("gross"), result: round2(T.gross) }, round2(T.gross), true],
    ["Total PF (employee)", { formula: totalRef("pf"), result: round2(T.pf) }, round2(T.pf), true],
    ["Total professional tax", { formula: totalRef("pt"), result: round2(T.pt) }, round2(T.pt), true],
    ["Total ESIC (employee)", { formula: totalRef("esic"), result: round2(T.esic) }, round2(T.esic), true],
    ["Total TDS", { formula: totalRef("tds"), result: round2(T.tds) }, round2(T.tds), true],
    ["Total deductions (adv/late/other)", { formula: totalRef("deduction"), result: round2(T.deduction) }, round2(T.deduction), true],
    ["Total deductions", { formula: sum(["pf", "pt", "esic", "tds", "deduction"]), result: round2(t.totalDeductions) }, round2(t.totalDeductions), true],
    ["Total reimbursements", { formula: totalRef("reimb"), result: round2(T.reimb) }, round2(T.reimb), true],
    ["Total net salary payable", { formula: totalRef("net"), result: round2(T.net) }, round2(T.net), true],
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
  return { buffer, totals: { people: paid.length, gross: round2(T.gross), pf: round2(T.pf), pt: round2(T.pt), esic: round2(T.esic), tds: round2(T.tds), deduction: round2(T.deduction), reimbursements: round2(T.reimb), totalDeductions: round2(t.totalDeductions), net: round2(T.net) } };
}
