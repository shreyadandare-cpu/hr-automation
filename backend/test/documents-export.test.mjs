import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildDocumentsWorkbook } from "../src/documents-export.js";

test("the documents workbook shows each type as Uploaded or Missing, with a count for multi-file types", async () => {
  const buf = await buildDocumentsWorkbook({
    today: "2026-11-24",
    employees: [
      { email: "b@wohlig.com", name: "Bala", empNo: "WT/2", dept: "Tech", title: "Engineer", status: "active", start: "2025-01-01" },
      { email: "a@wohlig.com", name: "Asha", empNo: "WT/1", dept: "HR", title: "Executive", status: "onboarding", start: "2026-11-01", pan: "ABXXX0000C", aadhaar: "1234 5678 6462" },
      { email: "x@wohlig.com", name: "Gone", status: "offboarded" },
    ],
    documents: [
      { email: "a@wohlig.com", key: "aadhaar", name: "aadhaar.pdf", size: 52000, uploadedAt: new Date("2026-11-20T10:00:00Z") },
      { email: "a@wohlig.com", key: "edu", name: "degree.pdf", size: 1000, uploadedAt: "2026-11-21T10:00:00Z" },
      { email: "a@wohlig.com", key: "edu", name: "school.pdf", size: 1000, uploadedAt: "2026-11-22T10:00:00Z" },
    ],
  }, { generatedBy: "hr@wohlig.com" });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Document status", "Files"]);
  const ws = wb.worksheets[0];
  const head = ws.getRow(3).values.slice(1);
  assert.ok(head.includes("Aadhaar card") && head.includes("Education certificates") && head.includes("Document types on record") && head.includes("PAN") && head.includes("Aadhaar"));
  assert.equal(ws.rowCount, 5);                                   // title, note, header, two current people (the leaver is left out)
  const asha = Object.fromEntries(head.map((h, i) => [h, ws.getRow(4).values.slice(1)[i]]));
  assert.equal(asha["Employee Name"], "Asha");
  assert.equal(asha["Aadhaar card"], "Uploaded");
  assert.equal(asha["Education certificates"], "2 files");
  assert.equal(asha["PAN card"], "Number on file", "a masked number counts as on file even with no scan");
  assert.equal(asha["PAN"], "ABXXX0000C");
  assert.equal(asha["Aadhaar"], "1234 5678 6462");
  assert.equal(asha["Driving licence"], "Missing");
  assert.equal(asha["Document types on record"], "3 of 8");   // Aadhaar (a file), PAN (the number only) and education (two files)
  assert.equal(asha["Last upload"], "2026-11-22");
  const bala = Object.fromEntries(head.map((h, i) => [h, ws.getRow(5).values.slice(1)[i]]));
  assert.equal(bala["Document types on record"], "0 of 8");
  assert.equal(wb.worksheets[1].rowCount, 6);                      // title, note, header, three files
});
