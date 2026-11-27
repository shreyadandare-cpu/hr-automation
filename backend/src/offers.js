/*
 * Offer letters and e-signature, as Keka's offer management and Keka Sign. The rules and the letter's words are in offers-rules.js.
 *
 * HR (hiring.manage):
 *   GET  /api/hr/candidates/:id/offers           the candidate's offers, newest first
 *   POST /api/hr/candidates/:id/offers           prepare one; it waits for approval
 *   POST /api/hr/offers/:id/approve | /return    approve, or send back with a note (offers.approve; never your own offer)
 *   POST /api/hr/offers/:id/send                 fix the words, make the signing link (valid 14 days) and email it to the candidate
 *   POST /api/hr/offers/:id/withdraw             stop an offer that is not signed
 *   GET  /api/hr/offers/:id/pdf                  the letter, with the signature and its record once signed
 * The candidate, with the private link (/sign/<key>, public, no sign-in):
 *   GET  /api/sign/:key       the letter     POST /api/sign/:key   sign it     POST /api/sign/:key/decline   decline it
 *   GET  /api/sign/:key/pdf   the letter as a PDF
 * The key is never stored, only its fingerprint; a signature keeps the typed name, the time, the address and the letter's fingerprint.
 */
import { sealFields } from "./secret-box.js";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { canAll } from "./access.js";
import { notify } from "./notify.js";
import { sendMail, frontendUrl, mailConfigured } from "./mail.js";
import { tooMany } from "./limits.js";
import { BRAND, COMPANY_LEGAL, PRODUCT } from "./brand.js";
import { leaveHtml } from "./leave-mail.js";
import { fingerprint, hashKey, newSignKey, offerText, readOffer, readSignature, SIGN_DAYS } from "./offers-rules.js";

const LOGO = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/public/wohlig-logo.png");
const NO_ACCESS = { error: "You do not have access to this. Please ask a super admin if you need it." };
const istDay = async () => (await pool.query("SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date,'YYYY-MM-DD') AS d")).rows[0].d;
const stamp = (t) => new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const OFFER_COLS = `o.*, to_char(o.joining_date,'YYYY-MM-DD') AS joining, c.name AS candidate, c.email AS candidate_email, c.opening_id`;
const offerOut = (o) => ({ id: o.id, status: o.status, title: o.title, ctc: Number(o.ctc_annual), joiningDate: o.joining, location: o.location, terms: o.terms,
  createdBy: o.created_by, createdAt: o.created_at, decidedBy: o.decided_by, decisionNote: o.decision_note || "", sentAt: o.sent_at, signUntil: o.sign_until,
  signedName: o.signed_name, signedAt: o.signed_at, declinedReason: o.declined_reason || "", fingerprint: o.letter_sha256 });

/** The letter as a PDF: letterhead, the words, and once signed the signature with its record. */
export function offerPdf(o) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: `Offer letter: ${o.candidate}`, Author: COMPANY_LEGAL } });
    const parts = []; doc.on("data", (b) => parts.push(b)); doc.on("end", () => resolve(Buffer.concat(parts))); doc.on("error", reject);
    const L = 56, W = doc.page.width - 112, ink = "#2a1016", grey = "#6b5a58";
    try { doc.image(LOGO, L, 40, { width: 120 }); } catch { /* the letter works without the logo */ }
    doc.fillColor(grey).font("Helvetica").fontSize(9).text(COMPANY_LEGAL, L, 48, { width: W, align: "right" });
    doc.moveDown(3).fillColor(ink).font("Helvetica-Bold").fontSize(15).text("Offer of employment", L, 110);
    doc.moveDown(0.8).font("Helvetica").fontSize(10.5).fillColor(ink).text(o.letter_text || offerText({ company: BRAND.company.name, candidate: o.candidate, title: o.title, ctc: o.ctc_annual, joiningDate: o.joining, location: o.location, terms: o.terms, expires: o.joining }), L, doc.y, { width: W, lineGap: 3 });
    doc.moveDown(1.5);
    if (o.status === "signed") {
      doc.font("Helvetica-Bold").fontSize(11).text("Accepted and signed", L, doc.y);
      doc.moveDown(0.3).font("Helvetica-Oblique").fontSize(16).text(o.signed_name, L, doc.y);
      doc.moveDown(0.3).font("Helvetica").fontSize(9).fillColor(grey)
        .text(`Signed electronically on ${stamp(o.signed_at)} (India time) from address ${o.signed_ip || "unknown"}, by typing the name above and confirming acceptance on ${PRODUCT}.`, L, doc.y, { width: W })
        .text(`Letter fingerprint (SHA-256): ${o.letter_sha256}`, L, doc.y + 4, { width: W });
    } else if (o.status === "declined") {
      doc.font("Helvetica-Bold").fontSize(11).text("Declined by the candidate", L, doc.y).font("Helvetica").fontSize(10).text(o.declined_reason || "", L, doc.y + 4, { width: W });
    } else doc.font("Helvetica").fontSize(9).fillColor(grey).text(o.status === "sent" ? `Waiting for the candidate's signature, until ${stamp(o.sign_until)}.` : "Not yet sent to the candidate.", L, doc.y, { width: W });
    doc.end();
  });
}

export function offersRouter(wrap) {
  const r = express.Router();
  const me = (req) => req.user.email.toLowerCase();
  const audit = (req, action, who = null) => pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, who || me(req)]).catch(() => {});
  const hires = (req, res, next) => (canAll(req, "hiring.manage") ? next() : res.status(403).json(NO_ACCESS));
  const offerById = async (id) => (await pool.query(`SELECT ${OFFER_COLS} FROM offer_letters o JOIN candidates c ON c.id=o.candidate_id WHERE o.id=$1`, [Number(id) || 0])).rows[0];
  const byKey = async (key) => (await pool.query(`SELECT ${OFFER_COLS} FROM offer_letters o JOIN candidates c ON c.id=o.candidate_id WHERE o.sign_key_hash=$1`, [hashKey(key)])).rows[0];

  /* ---------- the candidate, with the link (public) ---------- */
  const signGuard = async (req, res) => (await tooMany(`sign:${req.ip}`, 60, 60 * 60 * 1000) ? (res.status(429).json({ error: "Too many tries from this connection. Please try again in an hour." }), true) : false);
  const linkProblem = (o) => (!o ? "This link is not valid. Please use the latest link from your email, or contact the hiring team."
    : o.status === "withdrawn" ? "This offer has been withdrawn. Please contact the hiring team." : null);
  r.get("/api/sign/:key", wrap(async (req, res) => {
    if (await signGuard(req, res)) return;
    const o = await byKey(req.params.key), problem = linkProblem(o);
    if (problem) return res.status(404).json({ error: problem });
    res.set("Cache-Control", "private, no-store");
    res.json({ company: BRAND.company.name, candidate: o.candidate, title: o.title, status: o.status, text: o.letter_text, signUntil: o.sign_until,
      expired: o.status === "sent" && new Date(o.sign_until) < new Date(), signedName: o.signed_name, signedAt: o.signed_at, fingerprint: o.letter_sha256 });
  }));
  r.post("/api/sign/:key", wrap(async (req, res) => {
    if (await signGuard(req, res)) return;
    const o = await byKey(req.params.key), problem = linkProblem(o);
    if (problem) return res.status(404).json({ error: problem });
    if (o.status !== "sent") return res.status(409).json({ error: o.status === "signed" ? "You have already signed this offer. Thank you." : "This offer can no longer be signed." });
    if (new Date(o.sign_until) < new Date()) return res.status(410).json({ error: "The time to sign this offer has passed. Please contact the hiring team." });
    const { value, errors } = readSignature(req.body, o.candidate);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    // The words signed must still be the words sent: the fingerprint is checked again at the moment of signing.
    if (fingerprint(o.letter_text) !== o.letter_sha256) return res.status(409).json({ error: "This letter has changed since it was sent. Please contact the hiring team." });
    const { rowCount } = await pool.query(`UPDATE offer_letters SET status='signed', signed_name=$2, signed_at=now(), signed_ip=$3, signed_agent=$4, updated_at=now() WHERE id=$1 AND status='sent'`,
      [o.id, value.name, String(req.ip || "").slice(0, 60), String(req.get("user-agent") || "").slice(0, 300)]);
    if (!rowCount) return res.status(409).json({ error: "This offer can no longer be signed." });
    await audit(req, `Offer signed by ${value.name} (${o.candidate_email || "no email"}) for ${o.title}`, o.created_by);
    notify("perm:hiring.manage", { title: `${o.candidate} accepted the offer for ${o.title}`, body: "The signed letter is on the candidate's page.", link: `/app/hiring/${o.opening_id}` }).catch(() => {});
    res.json({ ok: true });
  }));
  r.post("/api/sign/:key/decline", wrap(async (req, res) => {
    if (await signGuard(req, res)) return;
    const o = await byKey(req.params.key), problem = linkProblem(o);
    if (problem) return res.status(404).json({ error: problem });
    if (o.status !== "sent") return res.status(409).json({ error: "This offer can no longer be declined here." });
    const reason = String((req.body || {}).reason || "").trim().slice(0, 1000);
    await pool.query("UPDATE offer_letters SET status='declined', declined_reason=$2, updated_at=now() WHERE id=$1 AND status='sent'", [o.id, reason]);
    notify("perm:hiring.manage", { title: `${o.candidate} declined the offer for ${o.title}`, body: reason.slice(0, 160), link: `/app/hiring/${o.opening_id}` }).catch(() => {});
    res.json({ ok: true });
  }));
  r.get("/api/sign/:key/pdf", wrap(async (req, res) => {
    if (await signGuard(req, res)) return;
    const o = await byKey(req.params.key), problem = linkProblem(o);
    if (problem) return res.status(404).json({ error: problem });
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Offer-letter-${o.candidate.replace(/[^\w]+/g, "-")}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    res.send(await offerPdf(o));
  }));

  /* ---------- HR ---------- */
  r.use(["/api/hr/offers", "/api/hr/candidates/:id/offers"], requireAuth);
  r.get("/api/hr/candidates/:id/offers", hires, wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT ${OFFER_COLS} FROM offer_letters o JOIN candidates c ON c.id=o.candidate_id WHERE o.candidate_id=$1 ORDER BY o.id DESC LIMIT 20`, [Number(req.params.id) || 0]);
    res.json({ offers: rows.map(offerOut), canApprove: canAll(req, "offers.approve"), me: me(req) });
  }));
  r.post("/api/hr/candidates/:id/offers", hires, wrap(async (req, res) => {
    const { rows: [c] } = await pool.query("SELECT id, name, email, stage FROM candidates WHERE id=$1 AND deleted_at IS NULL", [Number(req.params.id) || 0]);
    if (!c) return res.status(404).json({ error: "This candidate was not found." });
    if (!c.email) return res.status(400).json({ error: "Please add the candidate's email first: the offer is signed through a link sent there." });
    const { value: v, errors } = readOffer(req.body, await istDay());
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const { rowCount } = await pool.query("SELECT 1 FROM offer_letters WHERE candidate_id=$1 AND status IN ('pending_approval','approved','sent')", [c.id]);
    if (rowCount) return res.status(409).json({ error: "This candidate already has an offer in progress. Withdraw it first to make a new one." });
    const { sealed, plain: f } = sealFields("offer_sealed", { ctc_annual: v.ctc, letter_text: null });   // the CTC is stored sealed (secret-box.js)
    const { rows: [o] } = await pool.query("INSERT INTO offer_letters (candidate_id, title, ctc_annual, joining_date, location, terms, created_by, offer_sealed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [c.id, v.title, f.ctc_annual, v.joiningDate, v.location, v.terms, me(req), sealed]);
    if (["applied", "screening", "interview"].includes(c.stage)) await pool.query("UPDATE candidates SET stage='offer', updated_at=now() WHERE id=$1", [c.id]);
    await audit(req, `Offer prepared for ${c.name}: ${v.title}, joining ${v.joiningDate}`);   // the CTC is never written to the audit log
    notify("perm:offers.approve", { title: `An offer for ${c.name} is waiting for approval`, body: `${v.title}, prepared by ${me(req)}.`, link: "/app/hiring" }).catch(() => {});
    res.status(201).json({ id: o.id });
  }));
  const decide = (approve) => wrap(async (req, res) => {
    if (!canAll(req, "offers.approve")) return res.status(403).json(NO_ACCESS);
    const o = await offerById(req.params.id);
    if (!o) return res.status(404).json({ error: "This offer was not found." });
    if (o.created_by.toLowerCase() === me(req)) return res.status(403).json({ error: "Someone else has to approve an offer you prepared." });
    if (o.status !== "pending_approval") return res.status(409).json({ error: "This offer is not waiting for approval." });
    const note = String((req.body || {}).note || "").trim().slice(0, 500);
    if (!approve && !note) return res.status(400).json({ errors: { note: "Please say what needs to change." } });
    await pool.query("UPDATE offer_letters SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4, updated_at=now() WHERE id=$1", [o.id, approve ? "approved" : "returned", me(req), note || null]);
    await audit(req, `Offer for ${o.candidate} ${approve ? "approved" : "returned"}${note ? ` (${note})` : ""}`);
    notify(o.created_by, { title: `The offer for ${o.candidate} was ${approve ? "approved" : "sent back"}`, body: note || (approve ? "You can send it to the candidate now." : ""), link: `/app/hiring/${o.opening_id}` }).catch(() => {});
    res.json(offerOut(await offerById(o.id)));
  });
  r.post("/api/hr/offers/:id/approve", requireAuth, decide(true));
  r.post("/api/hr/offers/:id/return", requireAuth, decide(false));
  r.post("/api/hr/offers/:id/send", hires, wrap(async (req, res) => {
    const o = await offerById(req.params.id);
    if (!o) return res.status(404).json({ error: "This offer was not found." });
    if (!["approved", "sent"].includes(o.status)) return res.status(409).json({ error: "Only an approved offer can be sent." });
    if (o.status === "sent" && new Date(o.sign_until) > new Date() && !(req.body && req.body.newLink)) return res.status(409).json({ error: "This offer has already been sent. Make a new link only if the candidate lost it." });
    const { key, hash } = newSignKey();
    const until = new Date(Date.now() + SIGN_DAYS * 86400000), expires = until.toISOString().slice(0, 10);
    const words = o.letter_text && o.status === "sent" ? o.letter_text : offerText({ company: BRAND.company.name, candidate: o.candidate, title: o.title, ctc: o.ctc_annual, joiningDate: o.joining, location: o.location, terms: o.terms, expires });
    // The letter names the CTC, so it is stored sealed with it (secret-box.js).
    const { sealed, plain: f } = sealFields("offer_sealed", { ctc_annual: o.ctc_annual, letter_text: words });
    await pool.query("UPDATE offer_letters SET status='sent', letter_text=$2, letter_sha256=$3, sign_key_hash=$4, sent_by=$5, sent_at=now(), sign_until=$6, updated_at=now(), ctc_annual=$7, offer_sealed=$8 WHERE id=$1",
      [o.id, f.letter_text, fingerprint(words), hash, me(req), until, f.ctc_annual, sealed]);
    const link = `${frontendUrl()}/sign/${key}`;
    await audit(req, `Offer for ${o.candidate} sent for signature (until ${expires})`);
    let emailed = false;
    if (mailConfigured()) {
      const body = [`Dear ${o.candidate},`, "", `Congratulations. ${BRAND.company.name} is pleased to offer you the position of ${o.title}.`, "",
        `Please read and sign your offer letter here: ${link}`, "", `The link is private to you and works until ${until.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.`, "", "Regards,", `The hiring team, ${COMPANY_LEGAL}`].join("\n");
      try { await sendMail({ to: o.candidate_email, subject: `Your offer letter from ${BRAND.company.name}`, text: body, html: leaveHtml({ body, button: "Read and sign my offer" }, link) }); emailed = true; }
      catch (err) { console.error("Offer email failed:", err.message); }
    }
    res.json({ ...offerOut(await offerById(o.id)), link, emailed });
  }));
  r.post("/api/hr/offers/:id/withdraw", hires, wrap(async (req, res) => {
    const o = await offerById(req.params.id);
    if (!o) return res.status(404).json({ error: "This offer was not found." });
    if (["signed", "declined", "withdrawn"].includes(o.status)) return res.status(409).json({ error: "This offer can no longer be withdrawn." });
    await pool.query("UPDATE offer_letters SET status='withdrawn', sign_key_hash=NULL, updated_at=now() WHERE id=$1", [o.id]);
    await audit(req, `Offer for ${o.candidate} withdrawn`);
    res.json(offerOut(await offerById(o.id)));
  }));
  r.get("/api/hr/offers/:id/pdf", hires, wrap(async (req, res) => {
    const o = await offerById(req.params.id);
    if (!o) return res.status(404).json({ error: "This offer was not found." });
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Offer-letter-${o.candidate.replace(/[^\w]+/g, "-")}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    res.send(await offerPdf(o));
  }));
  return r;
}
