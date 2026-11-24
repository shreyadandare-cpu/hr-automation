/*
 * The careers page, applications and referrals, as Keka Hire has them. The rules are in careers-rules.js.
 *
 * Public (no sign-in; the page is /careers, served from site.html):
 *   GET  /api/careers                          the roles HR published, still open
 *   GET  /api/careers/:id                      one of them
 *   POST /api/careers/:id/apply                apply: details first, then the CV with the key this returns (limited per address)
 *   PUT  /api/careers/applications/:key/resume the CV (PDF or Word, up to 5 MB), within 30 minutes of applying
 * Signed in:
 *   GET  /api/jobs                             every open role, for staff (the internal job board)
 *   POST /api/jobs/:id/refer                   refer someone; PUT /api/jobs/referrals/:key/resume adds their CV
 *   GET  /api/jobs/my-referrals                the people you referred and how far they are (never the hiring notes)
 *   GET  /api/hr/candidates/:id/resume         a candidate's CV (hiring.manage)
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { canAll } from "./access.js";
import { notify } from "./notify.js";
import { tooMany } from "./limits.js";
import { UPLOAD_DIR } from "./documents.js";
import { readApplication, referralStatus, RESUME_MAX, resumeType } from "./careers-rules.js";

const job = (o) => ({ id: o.id, title: o.title, dept: o.dept, description: o.description, location: o.location, kind: o.kind, experience: o.experience, postedAt: o.created_at });
const JOB_COLS = "id, title, dept, description, location, kind, experience, created_at";

export function careersRouter(wrap) {
  const r = express.Router();
  const me = (req) => req.user.email.toLowerCase();

  /* ---------- public ---------- */
  r.get("/api/careers", wrap(async (_req, res) => {
    const { rows } = await pool.query(`SELECT ${JOB_COLS} FROM job_openings WHERE is_public AND status='open' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`);
    res.set("Cache-Control", "public, max-age=60");
    res.json({ jobs: rows.map(job) });
  }));
  r.get("/api/careers/:id", wrap(async (req, res) => {
    const { rows: [o] } = await pool.query(`SELECT ${JOB_COLS} FROM job_openings WHERE id=$1 AND is_public AND status='open' AND deleted_at IS NULL`, [Number(req.params.id) || 0]);
    if (!o) return res.status(404).json({ error: "This role is no longer open. Please see our other openings." });
    res.json(job(o));
  }));
  /** Saves an application or a referral and returns the key to send the CV with. */
  const saveCandidate = async (openingId, v, source, referredBy) => {
    const key = crypto.randomBytes(24).toString("hex");
    const { rows: [c] } = await pool.query(`INSERT INTO candidates (opening_id, name, email, phone, notes, stage, source, referred_by, cover_note, profile_link, upload_key, upload_until)
      VALUES ($1,$2,$3,$4,'', 'applied', $5, $6, $7, $8, $9, now() + interval '30 minutes') RETURNING id`, [openingId, v.name, v.email, v.phone, source, referredBy, v.note, v.link, key]);
    return { id: c.id, key };
  };
  r.post("/api/careers/:id/apply", wrap(async (req, res) => {
    if (await tooMany(`apply:${req.ip}`, 8, 60 * 60 * 1000)) return res.status(429).json({ error: "We have received several applications from this connection. Please try again in an hour." });
    const { rows: [o] } = await pool.query("SELECT id, title FROM job_openings WHERE id=$1 AND is_public AND status='open' AND deleted_at IS NULL", [Number(req.params.id) || 0]);
    if (!o) return res.status(404).json({ error: "This role is no longer open. Please see our other openings." });
    const { value: v, errors, bot } = readApplication(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    if (bot) return res.status(201).json({ ok: true });   // a filled hidden field: thank the bot and keep nothing
    const { rowCount } = await pool.query("SELECT 1 FROM candidates WHERE opening_id=$1 AND lower(email)=$2 AND deleted_at IS NULL", [o.id, v.email]);
    if (rowCount) return res.status(409).json({ error: "You have already applied for this role. Our team will be in touch." });
    const c = await saveCandidate(o.id, v, "careers", null);
    notify("perm:hiring.manage", { title: `New application for ${o.title}`, body: `${v.name} applied on the careers page.`, link: `/app/hiring/${o.id}` }).catch(() => {});
    res.status(201).json({ ok: true, uploadKey: c.key });
  }));
  /** The CV for a candidate just created with this key. */
  const saveResume = async (req, res, key, by = null) => {
    const { rows: [c] } = await pool.query("SELECT id, resume_stored, referred_by FROM candidates WHERE upload_key=$1 AND upload_until > now() AND deleted_at IS NULL", [String(key || "")]);
    if (!c || (by && String(c.referred_by || "").toLowerCase() !== by)) return res.status(404).json({ error: "This upload link has expired. Please apply again or send your CV to the hiring team." });
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: "Please choose your CV as a PDF or Word file." });
    if (buf.length > RESUME_MAX) return res.status(400).json({ error: "Please keep the CV under 5 MB." });
    const type = resumeType(buf);
    if (!type) return res.status(400).json({ error: "Please send the CV as a PDF or a Word (.docx) file." });
    const stored = `cv-${crypto.randomUUID()}.${type.ext}`, name = String(req.query.name || `cv.${type.ext}`).replace(/[^\w.\- ()]/g, "_").slice(0, 120);
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(path.join(UPLOAD_DIR, stored), buf);
    await pool.query("UPDATE candidates SET resume_name=$2, resume_mime=$3, resume_size=$4, resume_stored=$5, upload_key=NULL, upload_until=NULL, updated_at=now() WHERE id=$1", [c.id, name, type.mime, buf.length, stored]);
    if (c.resume_stored) await fs.rm(path.join(UPLOAD_DIR, path.basename(c.resume_stored)), { force: true }).catch(() => {});
    res.json({ ok: true });
  };
  const raw = express.raw({ type: () => true, limit: RESUME_MAX + 1024 });
  r.put("/api/careers/applications/:key/resume", raw, wrap((req, res) => saveResume(req, res, req.params.key)));

  /* ---------- staff: the internal job board and referrals ---------- */
  r.use(["/api/jobs"], requireAuth);
  r.get("/api/jobs", wrap(async (_req, res) => {
    const { rows } = await pool.query(`SELECT ${JOB_COLS}, is_public FROM job_openings WHERE status='open' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`);
    res.json({ jobs: rows.map((o) => ({ ...job(o), isPublic: o.is_public })) });
  }));
  r.post("/api/jobs/:id/refer", wrap(async (req, res) => {
    const { rows: [o] } = await pool.query("SELECT id, title FROM job_openings WHERE id=$1 AND status='open' AND deleted_at IS NULL", [Number(req.params.id) || 0]);
    if (!o) return res.status(404).json({ error: "This role is no longer open." });
    const { value: v, errors } = readApplication(req.body, { referral: true });
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    if (v.email === me(req)) return res.status(400).json({ errors: { email: "Please refer someone else. To move to this role yourself, please talk to the HR team." } });
    const { rowCount } = await pool.query("SELECT 1 FROM candidates WHERE opening_id=$1 AND lower(email)=$2 AND deleted_at IS NULL", [o.id, v.email]);
    if (rowCount) return res.status(409).json({ error: "This person is already being considered for this role." });
    const c = await saveCandidate(o.id, v, "referral", me(req));
    const { rows: [who] } = await pool.query("SELECT name FROM employees WHERE lower(work_email)=$1", [me(req)]);
    notify("perm:hiring.manage", { title: `${who ? who.name : me(req)} referred ${v.name} for ${o.title}`, body: v.note.slice(0, 160), link: `/app/hiring/${o.id}` }).catch(() => {});
    res.status(201).json({ ok: true, uploadKey: c.key });
  }));
  r.put("/api/jobs/referrals/:key/resume", raw, wrap((req, res) => saveResume(req, res, req.params.key, me(req))));
  r.get("/api/jobs/my-referrals", wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT c.id, c.name, c.stage, c.created_at, o.title FROM candidates c JOIN job_openings o ON o.id=c.opening_id
      WHERE lower(c.referred_by)=$1 AND c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 100`, [me(req)]);
    res.json({ referrals: rows.map((c) => ({ id: c.id, name: c.name, role: c.title, status: referralStatus(c.stage), referredAt: c.created_at })) });
  }));

  /* ---------- HR: a candidate's CV ---------- */
  r.get("/api/hr/candidates/:id/resume", requireAuth, wrap(async (req, res) => {
    if (!canAll(req, "hiring.manage")) return res.status(403).json({ error: "You do not have access to this." });
    const { rows: [c] } = await pool.query("SELECT resume_name, resume_mime, resume_stored FROM candidates WHERE id=$1 AND deleted_at IS NULL", [Number(req.params.id) || 0]);
    if (!c || !c.resume_stored) return res.status(404).json({ error: "No CV was sent for this candidate." });
    const file = path.join(UPLOAD_DIR, path.basename(c.resume_stored));
    try { await fs.access(file); } catch { return res.status(410).json({ error: "The CV is missing from storage." }); }
    res.set({ "Content-Type": c.resume_mime, "Content-Disposition": `inline; filename="${c.resume_name.replace(/"/g, "")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" });
    res.sendFile(file);
  }));
  return r;
}
