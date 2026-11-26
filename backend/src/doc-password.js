import crypto from "node:crypto";
import { promisify } from "node:util";
import express from "express";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";

/*
 * The document password: each person's own password for opening personal documents and payslips.
 *
 *   GET  /api/document-password          { set, unlockedUntil }
 *   PUT  /api/document-password          { password } sets it, or resets it (the person is signed in with their work account,
 *                                        which is how they prove who they are; nobody can set or reset anyone else's)
 *   POST /api/document-password/unlock   { password } opens documents for UNLOCK_MINUTES
 *   POST /api/document-password/lock     closes them again
 *
 * Only a scrypt hash is stored (document_passwords). While unlocked, the password is kept in this server's memory, never on disk,
 * because a payslip PDF is locked with it (pdfkit needs the password itself); it is dropped when the time is up or on lock.
 * Five wrong tries in a row lock the person out for 15 minutes.
 */
const scrypt = promisify(crypto.scrypt);
export const UNLOCK_MINUTES = 10;
const MIN_LEN = 8, MAX_LEN = 128, MAX_TRIES = 5, LOCKOUT_MS = 15 * 60_000;

const unlocked = new Map();   // email -> { password, until }
const tries = new Map();      // email -> { count, until }
const me = (req) => String(req.user.email).toLowerCase();

async function hashOf(password, salt = crypto.randomBytes(16)) {
  const key = await scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `s1:${salt.toString("base64")}:${key.toString("base64")}`;
}
async function matches(password, stored) {
  const [v, salt, key] = String(stored).split(":");
  if (v !== "s1") return false;
  const got = Buffer.from((await hashOf(password, Buffer.from(salt, "base64"))).split(":")[2], "base64");
  const want = Buffer.from(key, "base64");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** The password the person unlocked with, while it is still open; null otherwise. */
export function unlockedPassword(req) {
  const u = unlocked.get(me(req));
  if (!u) return null;
  if (u.until < Date.now()) { unlocked.delete(me(req)); return null; }
  return u.password;
}

/** Route guard for personal documents and payslip PDFs: the person must have unlocked with their document password. */
export const needDocUnlock = (req, res, next) => (unlockedPassword(req) ? next()
  : res.status(423).json({ error: "Please enter your document password to open this file.", locked: true }));

/** pdfkit options that lock a PDF with `password`: it opens only with it, and can be printed but not changed or copied from. */
export const pdfLock = (password) => !password ? {} : {
  userPassword: password, ownerPassword: crypto.randomBytes(24).toString("base64"), pdfVersion: "1.7ext3",
  permissions: { printing: "highResolution", modifying: false, copying: false, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false },
};

const readPassword = (b) => {
  const p = typeof b?.password === "string" ? b.password : "";
  if (p.length < MIN_LEN) return { error: `Please use at least ${MIN_LEN} characters.` };
  if (p.length > MAX_LEN) return { error: `Please use at most ${MAX_LEN} characters.` };
  return { value: p };
};

export const docPasswordRouter = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
docPasswordRouter.use(requireAuth, (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

docPasswordRouter.get("/", wrap(async (req, res) => {
  const { rowCount } = await pool.query("SELECT 1 FROM document_passwords WHERE email=$1", [me(req)]);
  const u = unlockedPassword(req) ? unlocked.get(me(req)) : null;
  res.json({ set: rowCount > 0, unlockedUntil: u ? new Date(u.until).toISOString() : null, minLength: MIN_LEN });
}));

docPasswordRouter.put("/", wrap(async (req, res) => {
  const { value, error } = readPassword(req.body);
  if (error) return res.status(400).json({ error, errors: { password: error } });
  const had = (await pool.query("SELECT 1 FROM document_passwords WHERE email=$1", [me(req)])).rowCount > 0;
  await pool.query(
    `INSERT INTO document_passwords (email, hash, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (email) DO UPDATE SET hash=EXCLUDED.hash, updated_at=now()`, [me(req), await hashOf(value)]);
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [had ? "Document password reset" : "Document password set", me(req)]);
  tries.delete(me(req));
  unlocked.set(me(req), { password: value, until: Date.now() + UNLOCK_MINUTES * 60_000 });
  res.json({ ok: true, set: true, unlockedUntil: new Date(unlocked.get(me(req)).until).toISOString() });
}));

docPasswordRouter.post("/unlock", wrap(async (req, res) => {
  const t = tries.get(me(req));
  if (t && t.count >= MAX_TRIES && t.until > Date.now()) {
    return res.status(429).json({ error: "Too many wrong tries. Please wait 15 minutes, or set a new document password." });
  }
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const row = (await pool.query("SELECT hash FROM document_passwords WHERE email=$1", [me(req)])).rows[0];
  if (!row) return res.status(409).json({ error: "Please set a document password first.", needsSetup: true });
  if (!password || !(await matches(password.slice(0, MAX_LEN), row.hash))) {
    const n = t && t.until > Date.now() ? t.count + 1 : 1;
    tries.set(me(req), { count: n, until: Date.now() + LOCKOUT_MS });
    if (n >= MAX_TRIES) await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", ["Document password: too many wrong tries", me(req)]);
    return res.status(400).json({ error: "That password is not right. Please try again.", errors: { password: "That password is not right." } });
  }
  tries.delete(me(req));
  unlocked.set(me(req), { password, until: Date.now() + UNLOCK_MINUTES * 60_000 });
  res.json({ ok: true, unlockedUntil: new Date(unlocked.get(me(req)).until).toISOString() });
}));

docPasswordRouter.post("/lock", (req, res) => { unlocked.delete(me(req)); res.json({ ok: true }); });
