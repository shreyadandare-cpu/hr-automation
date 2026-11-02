// Makes a payslip PDF from dummy data, without touching any database: node scripts/sample-payslip.mjs [out.pdf]
// Uses the same calculation (payroll-calc.js) and PDF layout (payslips.js) as the app.
import fs from "node:fs";
import PDFDocument from "pdfkit";
import { buildSlip } from "../src/payroll-calc.js";
import { drawPdf } from "../src/payslips.js";

const out = process.argv[2] || "Payslip-2026-09-XYZ.pdf";
const structure = {   // Sample 2 - Salary Slip for testing.pdf
  earnings: [
    { name: "Basic", amount: 75000 }, { name: "HRA", amount: 37500 }, { name: "Medical Allowance", amount: 1250 },
    { name: "Conveyance Allowance", amount: 1600 }, { name: "Special Allowance", amount: 17754 }, { name: "Fuel Reimbursement", amount: 1800 },
    { name: "LTA", amount: 6248 }, { name: "Driver Salary Reimbursement", amount: 900 }, { name: "Books & Periodicals", amount: 1200 },
    { name: "Statutory Bonus", amount: 6248 }, { name: "Mobile/Data Reimbursement", amount: 500 },
  ],
  pfEmployee: 3000, professionalTax: 200, tdsMonthly: 13000,
};
const employee = { name: "XYZ", empNo: "WT/000", start: "2026-09-01", dept: "Wohlig", title: "Wohlig", paymentMode: "Bank Transfer", pfNumber: "10123456784", pan: "DxxxxxxxxD" };
const slip = buildSlip({ period: "2026-09", structure, employee, start: employee.start });
if (slip.incomplete.length) throw new Error(slip.incomplete.join(" "));

const doc = new PDFDocument({ size: "A4", margin: 45, info: { Title: "Payslip September 2026", Author: "Wohlig Transformations Pvt Ltd" } });
doc.pipe(fs.createWriteStream(out));
drawPdf(doc, slip);
doc.end();
console.log(`${out}: net ${slip.totals.net}, TDS ${slip.tds.amount}`);
