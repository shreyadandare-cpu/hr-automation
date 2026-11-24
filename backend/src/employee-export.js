import ExcelJS from "exceljs";
import { BRAND } from "./brand.js";
import { tenureText } from "../../frontend/src/lib/tenure.js";

/*
 * The employee details workbook HR downloads (GET /api/employees/export): the details shown at the top of every person's page, for the whole company on one sheet.
 * PAN and Aadhaar are the full numbers where HR holds them (masked otherwise). Only company-wide HR can ask for this file, and every preview or download is audited.
 * Pure given its inputs, so the layout can be tested.
 */
const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF800D35" } };
const thin = { style: "thin", color: { argb: "FFE3D9C8" } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };
const day = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : "");
const STATUS = { active: "Active", onboarding: "Onboarding", offboarding: "Leaving", offboarded: "Left" };

export const COLUMNS = [
  { header: "Employee Number", key: "no", width: 16 }, { header: "Employee Name", key: "name", width: 28 }, { header: "Work email", key: "email", width: 32 },
  { header: "Job Title", key: "title", width: 30 }, { header: "Department", key: "dept", width: 22 }, { header: "Employment type", key: "type", width: 17 }, { header: "Status", key: "status", width: 13 },
  { header: "Date of joining", key: "start", width: 15 }, { header: "Time at Wohlig", key: "tenure", width: 18 }, { header: "Reporting manager", key: "manager", width: 26 },
  { header: "Works from", key: "location", width: 16 }, { header: "Last working day", key: "lastDay", width: 17 }, { header: "Phone number", key: "phone", width: 16 },
  { header: "PAN", key: "pan", width: 16 }, { header: "Aadhaar", key: "aadhaar", width: 19 },
];

/** employees = [{ no, name, email, title, dept, type, status, start, lastDay, manager, location, phone, pan, aadhaar }]. Returns the workbook's buffer. */
export async function buildEmployeeWorkbook(data, meta = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.generatedBy || BRAND.company.legalNameShort;
  wb.created = new Date();
  const ws = wb.addWorksheet("Employee details", { views: [{ state: "frozen", xSplit: 2, ySplit: 3 }] });
  const rows = data.employees.slice().sort((a, b) => (a.status === "offboarded") - (b.status === "offboarded") || String(a.name).localeCompare(String(b.name))).map((e) => ({
    no: e.no || "", name: e.name, email: e.email, title: e.title || "", dept: e.dept || "", type: e.type || "Employee", status: STATUS[e.status] || e.status || "",
    start: day(e.start), tenure: tenureText(day(e.start), e.status === "offboarded" ? day(e.lastDay) : null), manager: e.manager || "", location: e.location || "",
    lastDay: day(e.lastDay), phone: e.phone || "", pan: e.pan || "", aadhaar: e.aadhaar || "",
  }));
  ws.mergeCells(1, 1, 1, COLUMNS.length); ws.mergeCells(2, 1, 2, COLUMNS.length);
  Object.assign(ws.getCell(1, 1), { value: `${BRAND.company.legalNameShort}: Employee details`, font: { bold: true, size: 14, color: { argb: "FF800D35" } } });
  Object.assign(ws.getCell(2, 1), { value: `Prepared ${data.today}${meta.generatedBy ? ` by ${meta.generatedBy}` : ""}. ${rows.length} people. This file holds full PAN and Aadhaar numbers, so keep it safe and delete it when you are done.`, font: { size: 10, color: { argb: "FF6B6B6B" } } });
  const head = ws.getRow(3);
  COLUMNS.forEach((c, i) => {
    head.getCell(i + 1).value = c.header;
    ws.getColumn(i + 1).width = Math.min(48, Math.max(c.header.length + 5, c.width, ...rows.map((r) => String(r[c.key] ?? "").length + 2)));
  });
  head.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = HEAD_FILL; c.border = BORDER; c.alignment = { vertical: "middle", wrapText: true }; });
  head.height = 32;
  for (const r of rows) ws.addRow(COLUMNS.map((c) => r[c.key] ?? "")).eachCell((cell) => { cell.border = BORDER; });
  // phone numbers and the like stay as text: no scientific notation, no lost leading zero
  ws.getColumn(COLUMNS.findIndex((c) => c.key === "phone") + 1).numFmt = "@";
  if (rows.length) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COLUMNS.length } };
  else ws.addRow(["Nothing to show."]);
  return wb.xlsx.writeBuffer();
}
