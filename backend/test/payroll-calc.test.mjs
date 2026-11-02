// Payslip numbers from src/payroll-calc.js: npm test
// The two fixtures are the sample payslips for September 2026 (Sample 1 - ABC, Sample 2 - XYZ).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlip, calculateTds, cleanStructure, isTdsApplicable, payWindow, TDS_THRESHOLD } from "../src/payroll-calc.js";

const sample1 = {
  earnings: [
    { name: "Basic", amount: 38192 }, { name: "HRA", amount: 19096 }, { name: "Medical Allowance", amount: 1250 },
    { name: "Conveyance Allowance", amount: 1600 }, { name: "Special Allowance", amount: 13064 }, { name: "Statutory Bonus", amount: 3182 },
  ],
  pfEmployee: 3000, professionalTax: 200, tdsMonthly: null,
};
const sample2 = {
  earnings: [
    { name: "Basic", amount: 75000 }, { name: "HRA", amount: 37500 }, { name: "Medical Allowance", amount: 1250 },
    { name: "Conveyance Allowance", amount: 1600 }, { name: "Special Allowance", amount: 17754 }, { name: "Fuel Reimbursement", amount: 1800 },
    { name: "LTA", amount: 6248 }, { name: "Driver Salary Reimbursement", amount: 900 }, { name: "Books & Periodicals", amount: 1200 },
    { name: "Statutory Bonus", amount: 6248 }, { name: "Mobile/Data Reimbursement", amount: 500 },
  ],
  pfEmployee: 3000, professionalTax: 200, tdsMonthly: 13000,
};

test("Sample 1: below ₹12 lakh a year, so no TDS; net ₹78,986", () => {
  const s = buildSlip({ period: "2026-09", structure: sample1, start: "2026-09-01", reimbursement: 5802 });
  assert.equal(s.annualIncome, 76384 * 12);
  assert.deepEqual(s.tds, { applicable: false, amount: 0 });
  assert.deepEqual(s.totals, { earnings: 82186, contributions: 3000, deductions: 200, net: 78986 });
  assert.equal(s.earnings.at(-1).name, "Reimbursements (Ad Hoc)");
  assert.deepEqual(s.days, { total: 30, actual: 30, lop: 0, payable: 30 });
  assert.deepEqual(s.incomplete, []);
});

test("Sample 2: ₹18 lakh a year, so TDS applies and the entered ₹13,000 is deducted; net ₹1,33,800", () => {
  const s = buildSlip({ period: "2026-09", structure: sample2, start: "2026-09-01" });
  assert.equal(s.annualIncome, 1800000);
  assert.deepEqual(s.tds, { applicable: true, amount: 13000 });
  assert.deepEqual(s.totals, { earnings: 150000, contributions: 3000, deductions: 13200, net: 133800 });
  assert.deepEqual(s.deductions.map((d) => d.name), ["Professional Tax", "Total Income Tax"]);
  assert.deepEqual(s.incomplete, []);
});

test("TDS eligibility: ₹12,00,000 exactly is not taxed, one rupee more is", () => {
  assert.equal(TDS_THRESHOLD, 1200000);
  assert.equal(isTdsApplicable(1199999), false);
  assert.equal(isTdsApplicable(1200000), false);
  assert.equal(isTdsApplicable(1200001), true);
});

test("below the threshold, an entered TDS amount is ignored", () => {
  assert.deepEqual(calculateTds({ annualIncome: 900000, structure: { tdsMonthly: 5000 } }), { applicable: false, amount: 0, missing: false });
});

test("above the threshold with no TDS entered: payslip is incomplete, not issued with zero tax", () => {
  const s = buildSlip({ period: "2026-09", structure: { ...sample2, tdsMonthly: null } });
  assert.equal(s.tds.applicable, true);
  assert.match(s.incomplete.join(" "), /monthly TDS has not been entered/);
});

test("no salary breakdown: incomplete", () => {
  const s = buildSlip({ period: "2026-09", structure: null, reimbursement: 500 });
  assert.match(s.incomplete.join(" "), /Salary breakdown is not set/);
});

test("joined mid-month: earnings are prorated by calendar days", () => {
  assert.deepEqual(payWindow("2026-09", "2026-09-16"), { total: 30, days: 15 });
  const s = buildSlip({ period: "2026-09", structure: sample1, start: "2026-09-16" });
  assert.equal(s.earnings[0].amount, 19096);   // Basic 38,192 × 15/30
  assert.deepEqual({ actual: s.days.actual, payable: s.days.payable }, { actual: 15, payable: 15 });
  assert.equal(s.annualIncome, 76384 * 12);   // TDS eligibility uses the full salary, not the partial month
});

test("left mid-month and joined before the month: only the employed days count", () => {
  assert.deepEqual(payWindow("2026-02", "2025-01-01", "2026-02-10"), { total: 28, days: 10 });
  assert.deepEqual(payWindow("2026-10", "2024-05-01", null), { total: 31, days: 31 });
});

test("loss of pay shows as a deduction with the days", () => {
  const s = buildSlip({ period: "2026-09", structure: sample1, lopDays: 2, lopDeduction: 5092 });
  assert.equal(s.deductions.at(-1).name, "Loss of Pay (2 days)");
  assert.equal(s.totals.net, 76384 - 3000 - 200 - 5092);
  assert.equal(s.days.payable, 28);
});

test("a salary structure from HR is checked", () => {
  const { value } = cleanStructure({ effectiveFrom: "2026-09", earnings: [{ name: "Basic", amount: "38192" }, { name: "", amount: "" }], pfEmployee: "3000", professionalTax: "200", tdsMonthly: "" });
  assert.deepEqual(value.earnings, [{ name: "Basic", amount: 38192 }]);
  assert.equal(value.tdsMonthly, null);
  assert.equal(value.pfNumber, undefined);   // not sent: the PF number on file is kept
  const { errors } = cleanStructure({ effectiveFrom: "Sep", earnings: [{ name: "Basic", amount: "-5" }], pfEmployee: "abc" });
  assert.deepEqual(Object.keys(errors).sort(), ["earnings.0", "effectiveFrom", "pfEmployee"]);
});

test("net pay in words, Indian numbering, as on the samples", async () => {
  const { inWords } = await import("../src/payslips.js");
  assert.equal(inWords(78986), "Seventy Eight Thousand Nine Hundred and Eighty Six Rupees only");
  assert.equal(inWords(133800), "One Lakh Thirty Three Thousand Eight Hundred Rupees only");
  assert.equal(inWords(1250.5), "One Thousand Two Hundred and Fifty Rupees and Fifty Paise only");
});

test("months: India time, and the month before", async () => {
  const { istMonth, previousMonth, monthOf } = await import("../src/payroll-calc.js");
  assert.equal(istMonth(new Date("2026-09-30T19:00:00Z")), "2026-10");   // 00:30 on 1 Oct in India
  assert.equal(istMonth(new Date("2026-09-30T18:00:00Z")), "2026-09");
  assert.equal(previousMonth("2026-01"), "2025-12");
  assert.equal(previousMonth("2026-10"), "2026-09");
  for (const v of ["2026-09", "2026-09-01", "09/2026", "Sep 2026", "September 2026", "Sep-26"]) assert.equal(monthOf(v), "2026-09", v);
});

test("a spreadsheet row becomes a salary structure (Sample 2 for the dummy employee)", async () => {
  const { structureFromRow } = await import("../src/payroll-calc.js");
  const { email, body } = structureFromRow({
    Email: "XYZ.Dummy@wohlig.com", "Employee Name": "XYZ (Dummy)", applies_from: "Sep-26", Basic: "75,000", HRA: "37500", "Medical Allowance": "1250",
    "Conveyance Allowance": "1600", "Special Allowance": "17754", "Fuel Reimbursement": "1800", LTA: "6248", "Driver Salary Reimbursement": "900",
    "Books & Periodicals": "1200", "Statutory Bonus": "6248", "Mobile/Data Reimbursement": "500", "PF Employee": "3000", "Professional Tax": "200",
    "Monthly TDS": "₹13,000", "PF Number": "", "Deduction: Canteen": "",
  });
  assert.equal(email, "xyz.dummy@wohlig.com");
  assert.equal(body.pfNumber, undefined);   // empty cell: keep the PF number on file
  const { value } = cleanStructure(body);
  assert.equal(value.effectiveFrom, "2026-09");
  assert.equal(value.earnings.length, 11);
  const s = buildSlip({ period: "2026-09", structure: value, start: "2026-09-01" });
  assert.equal(s.totals.net, 133800);
});
