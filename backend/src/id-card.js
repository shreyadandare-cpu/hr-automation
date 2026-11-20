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
const LOGO_MARK = fileURLToPath(new URL("../../frontend/public/wohlig-smile-mark.png", import.meta.url));
const LOGO = fileURLToPath(new URL("../../frontend/public/wohlig-logo.png", import.meta.url));
const initials = (n) => String(n || "").split(/\s+/).filter(Boolean).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
const day = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "");

async function people(where, args) {
  const { rows } = await pool.query(
    `SELECT e.name, e.emp_no, e.title, e.dept, e.work_email, e.start_date, e.work_location,
            COALESCE(NULLIF(e.phone,''), pr.data->'contact'->>'phone') AS phone, pr.data->'primary'->>'blood' AS blood, p.stored_name
       FROM employees e LEFT JOIN profile_photos p ON lower(p.email)=lower(e.work_email) LEFT JOIN profiles pr ON lower(pr.email)=lower(e.work_email)
      WHERE e.status NOT IN ('offboarding','offboarded') AND e.work_email IS NOT NULL ${where} ORDER BY e.emp_no, e.name LIMIT 500`, args);
  return rows;
}

const BLOOD = { "A+": "A Positive", "A-": "A Negative", "B+": "B Positive", "B-": "B Negative", "AB+": "AB Positive", "AB-": "AB Negative", "O+": "O Positive", "O-": "O Negative" };
/** The lines under the photo, in the order of the card: label and value. */
export const cardRows = (p) => [
  ["Employee Number", p.emp_no], ["Department", p.dept && p.dept !== "—" ? p.dept : ""], ["Phone", p.phone],
  ["Email", p.work_email], ["Location", p.work_location], ["Blood Group", p.blood ? `${p.blood}${BLOOD[p.blood] ? ` (${BLOOD[p.blood]})` : ""}` : ""],
].map(([k, v]) => [k, v || "—"]);   // all six always show, so every card has the same layout; "—" means not filled in yet

/* Front: a coloured panel with the photo, name and designation, then the details as label and value, and the smile mark. */
function front(doc, p) {
  doc.addPage({ size: [W, H], margin: 0 });
  doc.rect(0, 0, W, H).fill("#ffffff");
  const PANEL = 116;
  doc.rect(0, 0, W, PANEL).fill(C.maroon);
  const cx = W / 2, cy = 40, r = 28;
  doc.circle(cx, cy, r + 2.5).fill("#ffffff");
  let drawn = false;
  if (p.stored_name) {
    try {
      doc.save().circle(cx, cy, r).clip();
      doc.image(path.join(UPLOAD_DIR, p.stored_name), cx - r, cy - r, { cover: [r * 2, r * 2], align: "center", valign: "center" });
      doc.restore(); drawn = true;
    } catch { doc.restore(); }
  }
  if (!drawn) { doc.circle(cx, cy, r).fill(C.beige); doc.font("Helvetica-Bold").fontSize(21).fillColor(C.maroon).text(initials(p.name), cx - r, cy - 8, { width: r * 2, align: "center" }); }
  const box = { width: W - 16, align: "center" };
  doc.font("Helvetica").fontSize(p.name.length > 24 ? 9 : p.name.length > 18 ? 10.5 : 12).fillColor("#ffffff").text(p.name, 8, 76, box);
  if (p.title && p.title !== "—") doc.font("Helvetica").fontSize(7.5).fillColor(C.ivory).text(p.title, 8, doc.y + 2, box);
  let y = PANEL + 11;
  const LX = 10, VX = 68, VW = W - VX - 6;
  for (const [k, v] of cardRows(p)) {
    doc.font("Helvetica").fontSize(6).fillColor(C.muted).text(k, LX, y + 0.5, { width: VX - LX - 2, lineBreak: false });
    let fs = 6.8; doc.font("Helvetica");
    while (fs > 4.6 && doc.fontSize(fs).widthOfString(String(v)) > VW) fs -= 0.2;   // one line each: the text shrinks to fit
    doc.fillColor(C.ink).text(String(v), VX, y, { width: VW, lineBreak: false });
    y += 11.5;
  }
  doc.image(LOGO_MARK, (W - 16) / 2, H - 34, { width: 16 });
  doc.font("Helvetica").fontSize(5.8).fillColor(C.muted).text(BRAND.company.website.replace(/^https?:\/\//, ""), 8, H - 13, box);
}

function back(doc, p) {
  doc.addPage({ size: [W, H], margin: 0 });
  doc.rect(0, 0, W, H).fill(C.ivory);
  doc.image(LOGO, (W - 70) / 2, 22, { width: 70 });
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C.maroon).text(BRAND.company.legalName.toUpperCase(), 10, 62, { width: W - 20, align: "center" });
  const rows = [["EMAIL", p.work_email], ["JOINED", day(p.start_date)]].filter((r) => r[1]);
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
  r.use(["/api/id-card.pdf", "/api/id-card.json", "/api/id-cards.pdf"], requireAuth);
  // The card's details for the on-screen preview (same rules as the PDF).
  r.get("/api/id-card.json", wrap(async (req, res) => {
    const me = req.user.email.toLowerCase(), email = String(req.query.email || me).toLowerCase();
    if (email !== me && !(await can(req, "people.view", email))) return res.status(403).json({ error: "You can see your own ID card. Please ask the HR team for anyone else's." });
    const [p] = await people("AND lower(e.work_email)=$1", [email]);
    if (!p) return res.status(404).json({ error: "No ID card is available for this person." });
    const photo = p.stored_name ? (await pool.query("SELECT extract(epoch FROM updated_at)::bigint AS v FROM profile_photos WHERE lower(email)=$1", [email])).rows[0]?.v : 0;
    res.json({ name: p.name, title: p.title, email: p.work_email, photoV: Number(photo) || 0, joined: day(p.start_date), rows: cardRows(p) });
  }));
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
