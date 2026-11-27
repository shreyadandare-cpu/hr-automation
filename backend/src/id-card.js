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
const LOGO = fileURLToPath(new URL("../../frontend/public/wohlig-logo.png", import.meta.url));
const initials = (n) => String(n || "").split(/\s+/).filter(Boolean).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
const day = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "");

async function people(where, args) {
  const { rows } = await pool.query(
    `SELECT e.name, e.emp_no, e.title, e.dept, e.work_email, e.start_date, e.work_location, e.phone, e.person_sealed, p.stored_name, pr.data, pr.profile_sealed
       FROM employees e LEFT JOIN profile_photos p ON lower(p.email)=lower(e.work_email) LEFT JOIN profiles pr ON lower(pr.email)=lower(e.work_email)
      WHERE e.status NOT IN ('offboarding','offboarded') AND e.work_email IS NOT NULL ${where} ORDER BY e.emp_no, e.name LIMIT 500`, args);
  // The phone and the profile are stored encrypted, so the card's lines are picked out here once they are opened.
  return rows.map(({ data, ...r }) => {
    const c = (data && data.contact) || {}, pr = (data && data.primary) || {};
    return { ...r, phone: r.phone || c.phone || null, blood: pr.blood || null, em_name: c.emergencyName || null, em_rel: c.emergencyRelation || null, em_phone: c.emergencyPhone || null };
  });
}

/** The back of the card: the person's first emergency contact, as { phone, who } ("Name (relation)"). Empty until they add it on My profile. */
export const emergencyOf = (p) => ({ phone: p.em_phone || "", who: p.em_name ? `${p.em_name}${p.em_rel ? ` (${p.em_rel})` : ""}` : "" });
/** The lines under the photo, in the order of the card: label and value. The emergency contact is on the back only. */
export const cardRows = (p) => [
  ["Employee code", p.emp_no], ["Mobile", p.phone], ["Blood group", p.blood],
  ["Date of joining", day(p.start_date)], ["Email", p.work_email],
].map(([k, v]) => [k, v || "—"]);   // "—" means not filled in yet, so every card keeps the same layout

const hexagon = (cx, cy, r) => [0, 1, 2, 3, 4, 5].map((k) => { const a = ((-90 + 60 * k) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
const shape = (doc, pts, colour) => { doc.polygon(...pts).fill(colour); };

/* Front: the logo, maroon bands with orange stripes meeting behind a hexagon photo frame, the name and designation, then the details as label and value. */
function front(doc, p) {
  doc.addPage({ size: [W, H], margin: 0 });
  doc.rect(0, 0, W, H).fill("#ffffff");
  const cx = W / 2, cy = 88, R = 33;
  doc.image(LOGO, cx - 29, 9, { width: 58 });
  shape(doc, [[0, 38], [cx, 62], [cx, 76], [0, 52]], C.maroon); shape(doc, [[W, 38], [cx, 62], [cx, 76], [W, 52]], C.maroon);
  shape(doc, [[0, 54], [cx, 78], [cx, 81], [0, 57]], C.orange); shape(doc, [[W, 54], [cx, 78], [cx, 81], [W, 57]], C.orange);
  for (const [y, c] of [[108, C.maroon], [116, C.orange]]) {   // short stripes on each side of the photo
    shape(doc, [[0, y], [17, y + 7], [17, y + 11], [0, y + 4]], c); shape(doc, [[W, y], [W - 17, y + 7], [W - 17, y + 11], [W, y + 4]], c);
  }
  doc.polygon(...hexagon(cx, cy, R)).lineWidth(2.4).fillAndStroke("#ffffff", C.maroon);
  const inner = hexagon(cx, cy, R - 2.4);
  let drawn = false;
  if (p.stored_name) {
    try {
      doc.save(); doc.polygon(...inner).clip();
      doc.image(path.join(UPLOAD_DIR, p.stored_name), cx - R, cy - R, { cover: [R * 2, R * 2], align: "center", valign: "center" });
      doc.restore(); drawn = true;
    } catch { doc.restore(); }
  }
  if (!drawn) { doc.polygon(...inner).fill(C.beige); doc.font("Helvetica-Bold").fontSize(22).fillColor(C.maroon).text(initials(p.name), cx - R, cy - 8, { width: R * 2, align: "center" }); }
  const box = { width: W - 16, align: "center" };
  doc.font("Helvetica-Bold").fontSize(p.name.length > 24 ? 8.5 : p.name.length > 18 ? 9.5 : 11).fillColor(C.ink).text(p.name.toUpperCase(), 8, 128, box);
  if (p.title && p.title !== "—") doc.font("Helvetica").fontSize(6.2).fillColor(C.muted).text(p.title.toUpperCase(), 8, doc.y + 1.5, { ...box, characterSpacing: 0.3 });
  let y = 153;
  const LX = 10, VX = 60, VW = W - VX - 6;
  for (const [k, v] of cardRows(p)) {
    doc.font("Helvetica").fontSize(5.6).fillColor(C.muted).text(k, LX, y + 0.6, { width: VX - LX - 2, lineBreak: false });
    let fs = 6.6; doc.font("Helvetica");
    while (fs > 4.4 && doc.fontSize(fs).widthOfString(String(v)) > VW) fs -= 0.2;   // one line each: the text shrinks to fit
    doc.fillColor(C.ink).text(String(v), VX, y, { width: VW, lineBreak: false });
    y += 12;
  }
  doc.moveTo(0, H - 11).quadraticCurveTo(W / 2, H - 21, W, H - 11).lineTo(W, H).lineTo(0, H).fill(C.maroon);
  doc.moveTo(0, H - 12.5).quadraticCurveTo(W / 2, H - 22.5, W, H - 12.5).lineWidth(1.2).stroke(C.orange);
}

const TERMS = [
  "The holder of this card is a registered employee of Wohlig Transformations.",
  "By the registration, the holder agrees to abide by the rules and regulations of the company.",
  "Anyone finding this card is requested to return it to the HR team at the address below.",
];

/* Back: the card's terms, the holder's own emergency contact, and the address on a maroon panel with an orange rule. */
function back(doc, p) {
  doc.addPage({ size: [W, H], margin: 0 });
  doc.rect(0, 0, W, H).fill("#ffffff");
  doc.image(LOGO, (W - 64) / 2, 16, { width: 64 });
  let y = 56;
  for (const t of TERMS) {
    doc.font("Helvetica").fontSize(5.8).fillColor(C.ink).text("•", 12, y, { lineBreak: false });
    doc.text(t, 20, y, { width: W - 32, lineGap: 1 });
    y = doc.y + 5;
  }
  const em = emergencyOf(p);
  doc.font("Helvetica-Bold").fontSize(6.4).fillColor(C.ink).text("Emergency Contact No.", 8, 146, { width: W - 16, align: "center" });
  doc.font("Helvetica-Bold").fontSize(8.2).fillColor(C.maroon).text(em.phone || "—", 8, doc.y + 1.5, { width: W - 16, align: "center" });
  if (em.who) doc.font("Helvetica").fontSize(5.6).fillColor(C.ink).text(em.who, 8, doc.y + 1.5, { width: W - 16, align: "center" });
  const top = H - 66;
  doc.rect(0, top, W, 66).fill(C.maroon);
  doc.rect(0, top, W, 2.6).fill(C.orange);
  doc.font("Helvetica-Bold").fontSize(6.6).fillColor("#ffffff").text(BRAND.company.legalNameShort.replace(/ Pvt Ltd$/, " Pvt. Ltd."), 8, top + 10, { width: W - 16, align: "center" });
  doc.font("Helvetica").fontSize(5.2).fillColor(C.ivory).text(BRAND.company.address, 10, doc.y + 3, { width: W - 20, align: "center", lineGap: 1 });
  doc.font("Helvetica-Bold").fontSize(6.2).fillColor("#ffffff").text(BRAND.company.website.replace(/^https?:\/\//, "www."), 8, H - 14, { width: W - 16, align: "center" });
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
    res.json({ name: p.name, title: p.title, email: p.work_email, photoV: Number(photo) || 0, joined: day(p.start_date), rows: cardRows(p), emergency: emergencyOf(p) });
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
