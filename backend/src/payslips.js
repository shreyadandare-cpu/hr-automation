import express from "express";
import PDFDocument from "pdfkit";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";

/* Payslips: everyone can list and download their own for any month HR has processed payroll for.
   HR can download anyone's with ?email=. A payslip is built from the stored payroll line, so it never changes after the fact. */
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const num = (v) => (v === null || v === undefined ? null : Number(v));
const inr = (n) => "INR " + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthName = (p) => new Date(p + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const dmy = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "-");
const isHr = (req) => req.user && req.user.role === "hr";

/** Whose payslips: yourself, or anyone when you are HR. */
const targetOf = (req) => {
  const asked = req.query.email ? String(req.query.email).toLowerCase() : null;
  return asked && isHr(req) ? asked : req.user.email.toLowerCase();
};

async function payslipOf(email, period) {
  const { rows } = await pool.query(
    `SELECT i.*, r.status, r.processed_at, r.paid_at, e.name, e.emp_no, e.title, e.dept, e.start_date, e.work_location, e.work_email AS email
     FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id LEFT JOIN employees e ON lower(e.work_email)=lower(i.work_email)
     WHERE lower(i.work_email)=$1 AND r.period=$2`, [email, period]);
  if (!rows[0]) return null;
  const x = rows[0];
  const { rows: claims } = await pool.query("SELECT claim_no, category, coalesce(approved_amount, amount) AS amount FROM reimbursements WHERE payroll_run_id=$1 AND lower(work_email)=$2 ORDER BY id", [x.run_id, email]);
  return { period, status: x.status, paidAt: x.paid_at, name: x.name || email, empNo: x.emp_no, title: x.title, dept: x.dept, start: x.start_date, location: x.work_location, email: x.email || email,
    base: num(x.base_salary), lopDays: num(x.lop_days), lopDeduction: num(x.lop_deduction), reimbursement: num(x.reimbursement_total), net: num(x.payable),
    claims: claims.map((c) => ({ no: c.claim_no, category: c.category, amount: num(c.amount) })) };
}

function drawPdf(doc, p) {
  const L = 50, R = 545, W = R - L;
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#1c1b3a").text("WOHLIG TRANSFORMATIONS PRIVATE LIMITED", L, 50);
  doc.font("Helvetica").fontSize(11).fillColor("#555177").text(`Payslip for ${monthName(p.period)}`, L, 72);
  doc.moveTo(L, 96).lineTo(R, 96).lineWidth(2).strokeColor("#4254d4").stroke();

  const info = [["Employee", p.name], ["Employee no.", p.empNo || "-"], ["Designation", p.title || "-"], ["Work location", p.location || "-"],
    ["Date of joining", dmy(p.start)], ["Work email", p.email], ["Pay period", monthName(p.period)], ["Loss of pay days", String(p.lopDays || 0)]];
  let y = 112;
  info.forEach(([k, v], i) => {
    const x = i % 2 ? L + W / 2 + 10 : L; if (i && i % 2 === 0) y += 30;
    doc.font("Helvetica").fontSize(9).fillColor("#7c7aa0").text(k, x, y);
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#1c1b3a").text(String(v), x, y + 11, { width: W / 2 - 20 });
  });
  y += 56;

  const row = (label, amount, o = {}) => {
    if (o.fill) doc.rect(L, y - 4, W, 24).fill(o.fill);
    doc.font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(o.size || 10.5).fillColor(o.color || "#1c1b3a").text(label, L + 10, y, { width: W - 160 });
    doc.text(amount, R - 150, y, { width: 140, align: "right" });
    y += 24;
  };
  row("Earnings", "Amount", { bold: true, fill: "#eceeff", color: "#3242b2" });
  row("Monthly gross salary", p.base === null ? "Not set" : inr(p.base));
  if (p.reimbursement) row("Approved reimbursements", inr(p.reimbursement));
  p.claims.forEach((c) => row(`   ${c.no || "Claim"} (${c.category})`, inr(c.amount), { size: 9, color: "#555177" }));
  y += 6;
  row("Deductions", "Amount", { bold: true, fill: "#eceeff", color: "#3242b2" });
  row(`Loss of pay (${p.lopDays || 0} day${p.lopDays === 1 ? "" : "s"})`, p.lopDeduction ? "- " + inr(p.lopDeduction) : inr(0));
  y += 10;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(0.7).strokeColor("#d9d9ea").stroke(); y += 10;
  row("Net pay", inr(p.net), { bold: true, size: 13 });
  doc.font("Helvetica").fontSize(9).fillColor("#7c7aa0").text(p.status === "paid" ? `Paid on ${dmy(p.paidAt)}.` : "Payroll for this month is processed. Payment is not marked as made yet.", L, y + 6, { width: W });
  doc.fontSize(8.5).text("This is a computer-generated payslip and does not need a signature. It shows the salary and adjustments recorded in the HR Access Hub.", L, 760, { width: W, align: "center" });
}

export function payslipsRouter(wrap) {
  const r = express.Router();
  r.use("/api/payslips", requireAuth);

  // Months with a payslip, newest first.
  r.get("/api/payslips", wrap(async (req, res) => {
    const email = targetOf(req);
    const { rows } = await pool.query(
      `SELECT r.period, r.status, r.paid_at, i.payable FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id
       WHERE lower(i.work_email)=$1 ORDER BY r.period DESC`, [email]);
    res.json(rows.map((x) => ({ period: x.period, status: x.status, paidAt: x.paid_at, net: num(x.payable) })));
  }));

  r.get("/api/payslips/:period/pdf", wrap(async (req, res) => {
    const { period } = req.params;
    if (!PERIOD.test(period)) return res.status(400).json({ error: "Choose a month like 2026-10." });
    const p = await payslipOf(targetOf(req), period);
    if (!p) return res.status(404).json({ error: `There is no payslip for ${monthName(period)}. Payroll for that month has not been processed.` });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Payslip-${period}-${p.name.replace(/[^A-Za-z0-9]+/g, "-")}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Payslip ${monthName(period)}`, Author: "Wohlig Transformations Private Limited" } });
    doc.pipe(res);
    drawPdf(doc, p);
    doc.end();
  }));
  return r;
}
