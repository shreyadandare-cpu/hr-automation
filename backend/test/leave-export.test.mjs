import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildLeaveWorkbook } from "../src/leave-export.js";

const sample = () => buildLeaveWorkbook({
  year: 2026, today: "2026-11-23", approvers: {},
  employees: [
    { email: "b@wohlig.com", name: "Bala", empNo: "WT/2", title: "MD", dept: "DIRECTOR", location: "Mumbai", manager: "Chirag", status: "active", start: "2024-01-01" },
    { email: "a@wohlig.com", name: "Asha", empNo: "WT/1", title: "Engineer", dept: "Tech", location: "Mumbai", manager: "Bala", status: "active", start: "2025-03-01" },
    { email: "x@wohlig.com", name: "Gone", status: "offboarded", start: "2024-01-01" },
  ],
  requests: [
    { id: 1, email: "a@wohlig.com", type: "casual", from: "2026-11-02", to: "2026-11-03", days: 2, status: "approved", paidDays: 2, lopDays: 0, reason: "Trip" },
    { id: 2, email: "a@wohlig.com", type: "unpaid", from: "2026-11-10", to: "2026-11-10", days: 1, status: "approved", paidDays: 0, lopDays: 1, reason: "Personal" },
  ],
  compOffs: [], holidays: [],
});

test("the first sheet follows the old system's leave quota report", async () => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await sample());
  const ws = wb.worksheets[0];
  assert.equal(ws.name, "Leave Quota");
  assert.match(String(ws.getCell(2, 1).value), /^Employees Leave Balance YTD of Default Leave Plan \( 01-Jan-2026\s+- 31-Dec-2026 \)$/);
  const head = ws.getRow(3).values.slice(1);
  assert.deepEqual(head.slice(0, 11), ["Employee Number", "Employee Name", "Job Title", "Business Unit", "Department", "Sub Department", "Location", "Cost Center", "Reporting Manager", "Sick Leave - Accrued", "Sick Leave - Consumed"]);
  assert.equal(head.length, 29);
  assert.deepEqual(head.slice(-5), ["Unpaid Leave - Accrued", "Unpaid Leave - Consumed", "Unpaid Leave - Balance", "Unpaid Leave - AnnualQuota", "Unpaid Leave - Unit"]);
  // sorted by name, leavers left out
  assert.equal(ws.rowCount, 5);
  const asha = ws.getRow(4).values.slice(1);
  assert.equal(asha[1], "Asha");
  assert.deepEqual(asha.slice(9, 14), [0, 0, 6, 6, "Days"]);          // sick: accrued, consumed, balance, quota, unit
  assert.equal(asha[15], 2);                                           // casual consumed
  assert.deepEqual(asha.slice(24, 29), [0, 1, -1, 0, "Days"]);         // unpaid: taken 1, balance -1
});
