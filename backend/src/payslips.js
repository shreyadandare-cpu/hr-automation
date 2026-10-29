import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";

/* Payslips: everyone can see and download their own for any month HR has processed payroll for.
   HR can see anyone's with ?email=. Anyone else asking for another person's payslip gets 403.
   A payslip is the one stored with the payroll run (payroll_items.slip), so it never changes after the month is processed.
   Payslips made automatically are a draft until published (payslip-auto.js): only HR sees a draft.
   The amounts are worked out in payroll-calc.js; nothing here calculates or accepts an amount from the browser. */
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const EMAIL = /^[^@\s]+@[^@\s]+$/;
const LOGO = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/public/wohlig-logo.png");
const num = (v) => (v === null || v === undefined ? null : Number(v));
const monthName = (p) => new Date(p + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const isHr = (req) => req.user && req.user.role === "hr";
const INCOMPLETE = "Payroll information is incomplete. Please contact HR.";

/** Whose payslips: your own, or anyone's when you are HR. Never trusts an address from the request otherwise. */
function targetOf(req, res) {
  const self = req.user.email.toLowerCase();
  if (!req.query.email) return self;
  const asked = String(req.query.email).toLowerCase();
  if (!EMAIL.test(asked)) { res.status(400).json({ error: "That isn't a valid email address." }); return null; }
  if (asked !== self && !isHr(req)) { res.status(403).json({ error: "You are not authorized to access this payslip." }); return null; }
  return asked;
}

/** Runs processed before payslips were stored: rebuilt from that run's own saved amounts, never from today's salary. */
function legacySlip(x) {
  const base = num(x.base_salary), lop = num(x.lop_deduction), reimb = num(x.reimbursement_total);
  const earnings = [];
  if (base) earnings.push({ name: "Monthly gross salary", amount: base });
  if (reimb) earnings.push({ name: "Reimbursements (Ad Hoc)", amount: reimb });
  const deductions = lop ? [{ name: `Loss of Pay (${num(x.lop_days)} days)`, amount: lop }] : [];
  const total = (l) => l.reduce((n, i) => n + i.amount, 0);
  return { period: x.period, employee: {}, days: { lop: num(x.lop_days) || 0 }, earnings, contributions: [], deductions,
    totals: { earnings: total(earnings), contributions: 0, deductions: total(deductions), net: num(x.payable) },
    incomplete: base ? [] : ["Salary is not set."] };
}

/** The stored payslip for one person and month: { slip } or { status, error }. */
async function payslipOf(email, period, drafts) {
  const { rows } = await pool.query(
    `SELECT i.*, r.period, r.status, r.paid_at, r.published_at, r.publish_at, e.name, e.emp_no, e.title, e.dept, e.start_date, e.pan_masked, e.pf_number
     FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id LEFT JOIN employees e ON lower(e.work_email)=lower(i.work_email)
     WHERE lower(i.work_email)=$1 AND r.period=$2 ${drafts ? "" : "AND r.published_at IS NOT NULL"}`, [email, period]);
  const x = rows[0];
  if (!x) return { status: 404, error: `Payslip is not available for ${monthName(period)}.` };
  const s = x.slip || legacySlip(x);
  if (s.incomplete && s.incomplete.length) return { status: 422, error: INCOMPLETE };
  const e = s.employee || {};
  return { slip: {
    period, status: x.status, paidAt: x.paid_at, draft: !x.published_at, publishAt: x.published_at ? null : x.publish_at,
    employee: { name: e.name || x.name || email, empNo: e.empNo || x.emp_no, title: e.title || x.title, dept: e.dept || x.dept,
      start: e.start || x.start_date, pan: e.pan || x.pan_masked, pfNumber: e.pfNumber || x.pf_number, paymentMode: e.paymentMode || null, email },
    days: s.days, earnings: s.earnings, contributions: s.contributions, deductions: s.deductions, totals: s.totals,
  } };
}

/* ---------- PDF, laid out like the company payslip ---------- */

const amt = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = (d) => { if (!d) return "-"; const s = typeof d === "string" ? d.slice(0, 10) : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); return `${s.slice(8)} ${MON[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`; };
const maskId = (v) => (!v ? "-" : v.length <= 6 ? v : v.slice(0, 3) + "x".repeat(v.length - 5) + v.slice(-2));

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : ""));
const three = (n) => { const h = Math.floor(n / 100), r = n % 100; return [h ? ONES[h] + " Hundred" : "", r ? (h ? "and " : "") + two(r) : ""].filter(Boolean).join(" "); };
/** Indian numbering: 133800 -> "One Lakh Thirty Three Thousand Eight Hundred Rupees only". */
export function inWords(amount) {
  const rupees = Math.floor(Number(amount)), paise = Math.round((Number(amount) - rupees) * 100);
  if (!rupees && !paise) return "Zero Rupees only";
  const parts = [];
  let n = rupees;
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push((crore > 99 ? three(crore) : two(crore)) + " Crore");
  if (lakh) parts.push(two(lakh) + " Lakh");
  if (thousand) parts.push(two(thousand) + " Thousand");
  if (n) parts.push(three(n));
  return `${parts.join(" ")}${rupees ? " Rupees" : ""}${paise ? `${rupees ? " and " : ""}${two(paise)} Paise` : ""} only`;
}

export function drawPdf(doc, p) {
  const L = 45, R = 550, W = R - L, ink = "#000000", grey = "#6b6b6b", rule = "#d5d5d5";
  const [y0, m0] = p.period.split("-");
  doc.font("Helvetica-Bold").fontSize(20).fillColor(ink).text("PAYSLIP ", L, 48, { continued: true }).font("Helvetica").text(`${MON[Number(m0) - 1].toUpperCase()} ${y0}`);
  doc.fontSize(8.5).text("WOHLIG TRANSFORMATIONS PVT LTD", L, 88);
  doc.fontSize(7.5).text("HMP BUILDING, 2ND FLOOR, OFFICE NO. 201,\n111, INDUSTRIAL AREA, SION EAST\nMUMBAI MAHARASHTRA 400022", L, 108, { lineGap: 2 });
  try { doc.image(LOGO, R - 165, 40, { width: 165 }); } catch { /* the PDF still works without the logo */ }

  const e = p.employee;
  doc.font("Helvetica-Bold").fontSize(9.5).text(e.name, L, 200);
  doc.moveTo(L, 216).lineTo(R, 216).lineWidth(0.8).strokeColor(ink).stroke();
  const col = W / 4;
  const grid = (y, cells, small = false) => {
    cells.forEach(([k, v], i) => {
      doc.font("Helvetica").fontSize(7).fillColor(grey).text(k, L + i * col, y);
      doc.fontSize(small ? 9 : 9.5).fillColor(ink).text(v === null || v === undefined || v === "" ? "-" : String(v), L + i * col, y + 11, { width: col - 8 });
    });
    doc.moveTo(L, y + 32).lineTo(R, y + 32).lineWidth(0.5).strokeColor(rule).stroke();
  };
  grid(224, [["Employee Number", e.empNo], ["Date Joined", dmy(e.start)], ["Department", e.dept], ["Designation", e.title]]);
  grid(264, [["Payment Mode", e.paymentMode], ["PF Number", maskId(e.pfNumber)], ["PAN Number", e.pan]]);

  doc.font("Helvetica").fontSize(9.5).fillColor(ink).text("SALARY DETAILS", L, 314);
  doc.moveTo(L, 340).lineTo(R, 340).lineWidth(0.8).strokeColor(ink).stroke();
  const d = p.days || {};
  const f1 = (n) => (n === null || n === undefined ? "-" : Number(n).toFixed(1));
  grid(348, [["Actual Payable Days", f1(d.actual)], ["Total Working Days", f1(d.total)], ["Loss Of Pay Days", Number(d.lop || 0).toFixed(2)], ["Days Payable", d.payable ?? "-"]]);

  // Earnings on the left, contributions and deductions on the right, as in the company format.
  const top = 398, mid = L + W / 2, lx = L + 3, lw = W / 2 - 18, rx = mid + 12, rw = R - rx - 3, lh = 15.5;
  const line = (x, w, y, label, value, bold) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(ink).text(label, x, y, { width: w - 90 });
    doc.text(value, x + w - 90, y, { width: 90, align: "right" });
  };
  let ly = top;
  doc.font("Helvetica-Bold").fontSize(9).text("EARNINGS", lx, ly); ly += lh + 2;
  for (const i of p.earnings) { line(lx, lw, ly, i.name, amt(i.amount)); ly += lh; }
  line(lx, lw, ly, "Total Earnings (A)", amt(p.totals.earnings), true); ly += lh;

  let ry = top;
  doc.font("Helvetica-Bold").fontSize(9).text("CONTRIBUTIONS", rx, ry); ry += lh + 2;
  for (const i of p.contributions) { line(rx, rw, ry, i.name, amt(i.amount)); ry += lh; }
  line(rx, rw, ry, "Total Contributions (B)", amt(p.totals.contributions), true); ry += lh + 4;
  doc.font("Helvetica-Bold").fontSize(9).text("TAXES & DEDUCTIONS", rx, ry); ry += lh + 2;
  for (const i of p.deductions) { line(rx, rw, ry, i.name, amt(i.amount)); ry += lh; }
  line(rx, rw, ry, "Total Taxes & Deductions (C)", amt(p.totals.deductions), true); ry += lh;
  doc.moveTo(mid, top - 4).lineTo(mid, Math.max(ly, ry)).lineWidth(0.5).strokeColor(rule).stroke();

  // Net salary box
  const by = Math.max(ly, ry) + 22, words = inWords(p.totals.net);
  doc.font("Helvetica-Bold").fontSize(9);
  const wordsH = doc.heightOfString(words, { width: 230 });
  const bh = 44 + wordsH;
  doc.rect(L, by, W, bh).fill("#f4f5f7");
  doc.font("Helvetica").fontSize(9).fillColor(ink).text("Net Salary Payable ( A - B - C )", L + 12, by + 12);
  doc.text(amt(p.totals.net), R - 160, by + 12, { width: 150, align: "right" });
  doc.text("Net Salary in words", L + 12, by + 32 + (wordsH > 12 ? 5 : 0));
  doc.font("Helvetica-Bold").text(words, R - 240, by + 32, { width: 230, align: "right" });
  doc.font("Helvetica-Bold").fontSize(8.5).text("**Note :", L + 2, by + bh + 8, { continued: true }).font("Helvetica-Oblique").text("   All amounts displayed in this payslip are in ", { continued: true }).font("Helvetica-BoldOblique").text("INR");
  doc.moveTo(L, by + bh + 28).lineTo(R, by + bh + 28).lineWidth(0.8).strokeColor(ink).stroke();
  doc.font("Helvetica").fontSize(11).text("*", L, by + bh + 46, { continued: true }).font("Helvetica-Oblique").fontSize(7).text("  This is computer generated statement, does not require signature.");
}

export function payslipsRouter(wrap) {
  const r = express.Router();
  r.use("/api/payslips", requireAuth);
  r.use("/api/payslips", (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });

  // Months with a payslip, newest first.
  r.get("/api/payslips", wrap(async (req, res) => {
    const email = targetOf(req, res);
    if (!email) return;
    const { rows: [emp] } = await pool.query("SELECT name, emp_no, title, dept FROM employees WHERE lower(work_email)=$1", [email]);
    if (!emp && email !== req.user.email.toLowerCase()) return res.status(404).json({ error: "Employee not found." });
    const { rows } = await pool.query(
      `SELECT r.period, r.status, r.paid_at, r.published_at, r.publish_at, i.payable, i.base_salary, i.slip FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id
       WHERE lower(i.work_email)=$1 ${isHr(req) ? "" : "AND r.published_at IS NOT NULL"} ORDER BY r.period DESC`, [email]);
    res.json({
      employee: emp ? { name: emp.name, empNo: emp.emp_no, title: emp.title, dept: emp.dept, email } : { name: req.user.email, email },
      payslips: rows.map((x) => {
        const ready = x.slip ? !x.slip.incomplete.length : x.base_salary !== null;
        return { period: x.period, status: x.status, paidAt: x.paid_at, draft: !x.published_at, publishAt: x.published_at ? null : x.publish_at, available: ready, net: ready ? num(x.payable) : null, message: ready ? null : INCOMPLETE };
      }),
    });
  }));

  r.get("/api/payslips/:period", wrap(async (req, res) => {
    const { period } = req.params;
    if (!PERIOD.test(period)) return res.status(400).json({ error: "Choose a month like 2026-10." });
    const email = targetOf(req, res);
    if (!email) return;
    const p = await payslipOf(email, period, isHr(req));
    if (!p.slip) return res.status(p.status).json({ error: p.error });
    res.json(p.slip);
  }));

  r.get("/api/payslips/:period/pdf", wrap(async (req, res) => {
    const { period } = req.params;
    if (!PERIOD.test(period)) return res.status(400).json({ error: "Choose a month like 2026-10." });
    const email = targetOf(req, res);
    if (!email) return;
    const p = await payslipOf(email, period, isHr(req));
    if (!p.slip) return res.status(p.status).json({ error: p.error });
    const s = p.slip;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Payslip-${period}-${String(s.employee.name).replace(/[^A-Za-z0-9]+/g, "-")}.pdf"`);
    const doc = new PDFDocument({ size: "A4", margin: 45, info: { Title: `Payslip ${monthName(period)}`, Author: "Wohlig Transformations Pvt Ltd" } });
    doc.pipe(res);
    drawPdf(doc, s);
    doc.end();
  }));
  return r;
}
