import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { can, needAll } from "./access.js";
import { BRAND } from "./brand.js";
import { UPLOAD_DIR } from "./documents.js";

/*
 * Staff ID cards, one standard size for everyone: CR80 (the credit-card size every card printer takes), 85.6 x 54 mm,
 * upright, two pages per person (front, then back). Everyone downloads their own; people.view holders download anyone's
 * in their scope; people.view for the whole company downloads everyone's in one file.
 *   GET /api/id-card.pdf?email=<work email, default: me>      GET /api/id-cards.pdf (all current staff)
 * Fonts are the PDF's built-in Helvetica, so the file needs nothing installed to print.
 */
const MM = 72 / 25.4, W = Math.round(54 * MM * 100) / 100, H = Math.round(85.6 * MM * 100) / 100;   // 153.07 x 242.65 pt
const C = BRAND.colors;
const LOGO_DARK = fileURLToPath(new URL("../../frontend/public/wohlig-logo-dark.png", import.meta.url));
const LOGO = fileURLToPath(new URL("../../frontend/public/wohlig-logo.png", import.meta.url));
const initials = (n) => String(n || "").split(/\s+/).filter(Boolean).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
const day = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "");

async function people(where, args) {
  const { rows } = await pool.query(
    `SELECT e.name, e.emp_no, e.title, e.dept, e.work_email, e.start_date, p.stored_name
       FROM employees e LEFT JOIN profile_photos p ON lower(p.email)=lower(e.work_email)
      WHERE e.status NOT IN ('offboarding','offboarded') AND e.work_email IS NOT NULL ${where} ORDER BY e.emp_no, e.name LIMIT 500`, args);
  return rows;
}

function front(doc, p) {
  doc.addPage({ size: [W, H], margin: 0 });
  doc.rect(0, 0, W, H).fill(C.ivory);
  doc.rect(0, 0, W, 66).fill(C.maroon);
  doc.image(LOGO_DARK, (W - 74) / 2, 18, { width: 74 });
  const cx = W / 2, cy = 98, r = 34;
  doc.save().circle(cx, cy, r + 2.5).fill(C.ivory).restore();
  let drawn = false;
  if (p.stored_name) {
    try {
      doc.save().circle(cx, cy, r).clip();
      doc.image(path.join(UPLOAD_DIR, p.stored_name), cx - r, cy - r, { cover: [r * 2, r * 2], align: "center", valign: "center" });
      doc.restore(); drawn = true;
    } catch { doc.restore(); }
  }
  if (!drawn) { doc.circle(cx, cy, r).fill(C.beige); doc.font("Helvetica-Bold").fontSize(24).fillColor(C.maroon).text(initials(p.name), cx - r, cy - 9, { width: r * 2, align: "center" }); }
  doc.circle(cx, cy, r + 1).lineWidth(1.5).stroke(C.maroon);
  // Text flows down from the photo, so a long name or title never runs into what follows. Long names get a smaller size.
  const size = p.name.length > 26 ? 9.5 : p.name.length > 18 ? 11 : 12.5, box = { width: W - 20, align: "center" };
  doc.font("Helvetica-Bold").fontSize(size).fillColor(C.maroon).text(p.name, 10, 148, box);
  if (p.title && p.title !== "—") doc.font("Helvetica").fontSize(8).fillColor(C.ink).text(p.title, 10, doc.y + 2, box);
  if (p.dept && p.dept !== "—") doc.font("Helvetica").fontSize(7.5).fillColor(C.muted).text(p.dept, 10, doc.y + 1, box);
  const y = Math.max(doc.y + 7, 188);
  doc.moveTo(W / 2 - 14, y).lineTo(W / 2 + 14, y).lineWidth(1.5).stroke(C.orange);
  doc.font("Helvetica").fontSize(6.5).fillColor(C.muted).text("EMPLOYEE ID", 10, y + 6, { ...box, characterSpacing: 0.8 });
  doc.font("Helvetica-Bold").fontSize(11).fillColor(C.ink).text(p.emp_no || "—", 10, y + 15, box);
  doc.rect(0, H - 8, W, 8).fill(C.maroon);
}

function back(doc, p) {
  doc.addPage({ size: [W, H], margin: 0 });
  doc.rect(0, 0, W, H).fill(C.ivory);
  doc.image(LOGO, (W - 70) / 2, 22, { width: 70 });
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C.maroon).text(BRAND.company.legalName.toUpperCase(), 10, 62, { width: W - 20, align: "center" });
  const rows = [["EMAIL", p.work_email], ["JOINED", day(p.start_date)], ["WEBSITE", BRAND.company.website.replace(/^https?:\/\//, "")]].filter((r) => r[1]);
  let y = 92;
  for (const [k, v] of rows) {
    doc.font("Helvetica").fontSize(6).fillColor(C.muted).text(k, 14, y, { width: W - 28, characterSpacing: 0.8 });
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C.ink).text(v, 14, y + 8, { width: W - 28 });
    y += 30;
  }
  doc.font("Helvetica").fontSize(6.5).fillColor(C.muted).text("This card belongs to Wohlig. If found, please return it to the HR team or write to hr@" + BRAND.company.emailDomain + ".", 14, 196, { width: W - 28, align: "center" });
  doc.rect(0, H - 8, W, 8).fill(C.maroon);
}

function send(res, list, filename) {
  const doc = new PDFDocument({ autoFirstPage: false, size: [W, H], margin: 0, info: { Title: "Wohlig staff ID card" } });
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  doc.pipe(res);
  for (const p of list) { front(doc, p); back(doc, p); }
  doc.end();
}

export function idCardRouter(wrap) {
  const r = express.Router();
  r.use(["/api/id-card.pdf", "/api/id-cards.pdf"], requireAuth);
  r.get("/api/id-card.pdf", wrap(async (req, res) => {
    const me = req.user.email.toLowerCase(), email = String(req.query.email || me).toLowerCase();
    if (email !== me && !(await can(req, "people.view", email))) return res.status(403).json({ error: "You can download your own ID card. Please ask the HR team for anyone else's." });
    const [p] = await people("AND lower(e.work_email)=$1", [email]);
    if (!p) return res.status(404).json({ error: "No ID card is available for this person." });
    send(res, [p], `ID-card-${String(p.emp_no || p.name).replace(/[^A-Za-z0-9]+/g, "-")}.pdf`);
  }));
  r.get("/api/id-cards.pdf", needAll("people.view"), wrap(async (_req, res) => {
    const list = await people("", []);
    if (!list.length) return res.status(404).json({ error: "There are no current employees." });
    send(res, list, "ID-cards-all-staff.pdf");
  }));
  return r;
}
