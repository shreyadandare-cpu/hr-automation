import ExcelJS from "exceljs";
import { BRAND } from "./brand.js";

/*
 * The documents workbook HR downloads (GET /api/documents/export): who has uploaded which document. Two sheets:
 *   1. Document status   one row per current employee: the PAN and Aadhaar numbers HR holds (full where stored, masked otherwise), then each document type as Uploaded (a file is in),
 *                        Number on file (PAN and Aadhaar when only the masked number is held) or Missing (a count for the types that take several files),
 *                        how many of the 8 types are on record, and the date of the latest upload
 *   2. Files             one row per uploaded file: person, document type, file name, size and upload date
 * Only names and dates go in: never the files themselves or their stored names. Pure given its inputs, so the layout can be tested.
 */
export const DOC_TYPES = [
  { key: "aadhaar", name: "Aadhaar card" }, { key: "pan", name: "PAN card" }, { key: "dl", name: "Driving licence" }, { key: "passport", name: "Passport" },
  { key: "voter", name: "Voter ID" }, { key: "exp", name: "Previous experience letters", multi: true }, { key: "edu", name: "Education certificates", multi: true },
  { key: "bank", name: "Bank passbook or cancelled cheque" },
];
const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF800D35" } };
const thin = { style: "thin", color: { argb: "FFE3D9C8" } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };
const OK_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F1E4" } };
const MISSING_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBE9E3" } };
const day = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : "");

function sheet(wb, name, subtitle, columns, rows, paint) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 3 }] });
  ws.mergeCells(1, 1, 1, columns.length); ws.mergeCells(2, 1, 2, columns.length);
  Object.assign(ws.getCell(1, 1), { value: `${BRAND.company.legalNameShort}: ${name}`, font: { bold: true, size: 14, color: { argb: "FF800D35" } } });
  Object.assign(ws.getCell(2, 1), { value: subtitle, font: { size: 10, color: { argb: "FF6B6B6B" } } });
  const head = ws.getRow(3);
  columns.forEach((c, i) => {
    head.getCell(i + 1).value = c.header;
    ws.getColumn(i + 1).width = Math.min(48, Math.max(c.header.length + 5, c.width || 0, ...rows.map((r) => String(r[c.key] ?? "").length + 2)));
  });
  head.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = HEAD_FILL; c.border = BORDER; c.alignment = { vertical: "middle", wrapText: true }; });
  head.height = 32;
  for (const r of rows) {
    const row = ws.addRow(columns.map((c) => r[c.key] ?? ""));
    row.eachCell((cell, i) => { cell.border = BORDER; if (paint) paint(cell, columns[i - 1], r); });
  }
  if (rows.length) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: columns.length } };
  else ws.addRow(["Nothing to show."]);
}

/**
 * data = { today, employees: [{ email, name, empNo, dept, title, status, start, pan, aadhaar }], documents: [{ email, key, name, size, uploadedAt }] }
 * Returns the workbook's buffer.
 */
export async function buildDocumentsWorkbook(data, meta = {}) {
  const { employees, documents } = data;
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.generatedBy || BRAND.company.legalNameShort;
  wb.created = new Date();
  const lc = (s) => String(s || "").toLowerCase();
  const filesOf = new Map();
  for (const d of documents) { const k = lc(d.email); (filesOf.get(k) || filesOf.set(k, []).get(k)).push(d); }
  const nameOf = new Map(employees.map((e) => [lc(e.email), e.name]));
  const current = employees.filter((e) => e.status !== "offboarded").sort((a, b) => a.name.localeCompare(b.name));
  const stamp = `Prepared ${data.today}${meta.generatedBy ? ` by ${meta.generatedBy}` : ""}. The PAN and Aadhaar numbers are in this file, so keep it safe. The documents themselves are opened in Wohlig One.`;

  const statusRows = current.map((e) => {
    const mine = filesOf.get(lc(e.email)) || [];
    const row = { empNo: e.empNo || "", name: e.name, email: e.email, dept: e.dept || "", title: e.title || "", status: e.status === "onboarding" ? "Onboarding" : "Active", start: day(e.start) };
    row.panNo = e.pan || ""; row.aadhaarNo = e.aadhaar || "";
    const number = { pan: e.pan, aadhaar: e.aadhaar };   // the masked number counts as "on file" even when no scan has been uploaded
    let have = 0;
    for (const t of DOC_TYPES) {
      const n = mine.filter((f) => f.key === t.key).length;
      if (n || number[t.key]) have++;
      row[t.key] = n ? (t.multi ? `${n} file${n === 1 ? "" : "s"}` : "Uploaded") : number[t.key] ? "Number on file" : "Missing";
    }
    row.have = `${have} of ${DOC_TYPES.length}`;
    row.files = mine.length;
    row.last = mine.map((f) => day(f.uploadedAt)).filter(Boolean).sort().pop() || "";
    return row;
  });
  sheet(wb, "Document status", `${stamp} ${statusRows.filter((r) => r.files > 0).length} of ${statusRows.length} people have uploaded a file; ${statusRows.filter((r) => r.panNo || r.aadhaarNo).length} have a PAN or Aadhaar number on file.`, [
    { header: "Employee Number", key: "empNo" }, { header: "Employee Name", key: "name", width: 26 }, { header: "Work email", key: "email", width: 30 },
    { header: "Department", key: "dept" }, { header: "Job Title", key: "title" }, { header: "Status", key: "status" }, { header: "Joined", key: "start" },
    { header: "PAN", key: "panNo", width: 16 }, { header: "Aadhaar", key: "aadhaarNo", width: 18 },
    ...DOC_TYPES.map((t) => ({ header: t.name, key: t.key, width: 16 })),
    { header: "Document types on record", key: "have" }, { header: "Files", key: "files" }, { header: "Last upload", key: "last" },
  ], statusRows, (cell, col, r) => { if (DOC_TYPES.some((t) => t.key === col.key)) cell.fill = r[col.key] === "Missing" ? MISSING_FILL : OK_FILL; });

  const typeName = new Map(DOC_TYPES.map((t) => [t.key, t.name]));
  const fileRows = documents.filter((d) => nameOf.has(lc(d.email))).map((d) => ({ name: nameOf.get(lc(d.email)), email: d.email, type: typeName.get(d.key) || d.key,
    file: d.name, size: `${Math.max(1, Math.round(Number(d.size || 0) / 1024))} KB`, on: day(d.uploadedAt) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
  sheet(wb, "Files", stamp, [
    { header: "Employee Name", key: "name", width: 26 }, { header: "Work email", key: "email", width: 30 }, { header: "Document type", key: "type" },
    { header: "File name", key: "file", width: 30 }, { header: "Size", key: "size" }, { header: "Uploaded on", key: "on" },
  ], fileRows);
  return wb.xlsx.writeBuffer();
}
