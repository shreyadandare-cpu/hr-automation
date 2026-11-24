import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildEmployeeWorkbook, COLUMNS } from "../src/employee-export.js";

test("the employee details workbook carries the details shown at the top of a person's page, with the PAN and Aadhaar HR holds", async () => {
  const buf = await buildEmployeeWorkbook({ today: "2026-11-24", employees: [
    { no: "WT/51", name: "Rajvee Gala", email: "rajvee.gala@wohlig.com", title: "Data Engineer", dept: "Data", type: "Employee", status: "active", start: "2022-07-11", manager: "Chintan Shah", location: "Airoli", phone: "8850756143", pan: "DKXXX0000D", aadhaar: "1234 5678 9012" },
    { no: "WT/9", name: "Aman Left", email: "aman@wohlig.com", status: "offboarded", start: "2020-01-15", lastDay: "2021-03-20", phone: "09876543210" },
  ] }, { generatedBy: "hr@wohlig.com" });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const head = ws.getRow(3).values.slice(1);
  for (const h of ["Employee Number", "Work email", "Date of joining", "Reporting manager", "Works from", "Last working day", "Time at Wohlig", "Phone number", "PAN", "Aadhaar"]) assert.ok(head.includes(h), h);
  assert.equal(head.length, COLUMNS.length);
  const row = (n) => Object.fromEntries(head.map((h, i) => [h, ws.getRow(n).values.slice(1)[i]]));
  const a = row(4);
  assert.equal(a["Employee Name"], "Rajvee Gala"); assert.equal(a["Date of joining"], "2022-07-11"); assert.equal(a["Time at Wohlig"], "4 years, 4 months");
  assert.equal(a["Phone number"], "8850756143"); assert.equal(a["PAN"], "DKXXX0000D"); assert.equal(a["Aadhaar"], "1234 5678 9012");
  const left = row(5);   // people who have left come last, and their time counts to the last working day
  assert.equal(left["Status"], "Left"); assert.equal(left["Time at Wohlig"], "1 year, 2 months"); assert.equal(left["Phone number"], "09876543210");
  assert.equal(left["PAN"], "", "no PAN on file is an empty cell");
});
