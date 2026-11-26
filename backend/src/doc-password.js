import crypto from "node:crypto";
import { promisify } from "node:util";
import express from "express";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { notify } from "./notify.js";

/*
 * The document password: each person's own password for opening personal documents and payslips.
 *
 *   GET  /api/document-password          { set, unlockedUntil, freshSignIn }
 *   PUT  /api/document-password          { password, current? } sets it the first time; to change it, the current password, or
 *                                        (forgotten) a sign-in from the last FRESH_MINUTES. Nobody can set anyone else's.
 *   POST /api/document-password/unlock   { password } opens documents for UNLOCK_MINUTES, in this browser's sign-in only
 *   POST /api/document-password/lock     closes them again
 *
 * Only a scrypt hash is stored (document_passwords). While unlocked, the password is kept in this server's memory, never on disk,
 * because a payslip PDF is locked with it (pdfkit needs the password itself); it is dropped when the time is up or on lock.
 * Five wrong tries (unlock or change) lock the person out for 15 minutes; each try is counted before it is checked, so tries sent
 * at the same moment cannot get round the limit. Unlocks and tries live in this server's memory: Wohlig One runs as one server
 * process (docker-compose.yml); a restart locks everything again.
 */
const scrypt = promisify(crypto.scrypt);
export const UNLOCK_MINUTES = 10;
const FRESH_MINUTES = 10;
const MIN_LEN = 10, MAX_LEN = 128, MAX_TRIES = 5, LOCKOUT_MS = 15 * 60_000;

const unlocked = new Map();   // session key -> { email, password, until }
const tries = new Map();      // email -> { count, until }
const me = (req) => String(req.user.email).toLowerCase();
const sessionKey = (req) => (req.session && req.session.key) || null;
const freshSignIn = (req) => !!(req.session && req.session.signedInAt && Date.now() - req.session.signedInAt.getTime() < FRESH_MINUTES * 60_000);

/** Counts a try before it is checked. Returns false when the person is locked out. */
function takeTry(email) {
  const now = Date.now(), t = tries.get(email);
  const cur = t && t.until > now ? t : { count: 0, until: now + LOCKOUT_MS };
  if (cur.count >= MAX_TRIES) return false;
  cur.count++; cur.until = now + LOCKOUT_MS;
  tries.set(email, cur);
  return true;
}
/** For tests only. */
export const _forTests = { takeTry, clearTries: () => tries.clear(), MAX_TRIES };
const LOCKED_OUT = "Too many wrong tries. Please wait 15 minutes and try again.";
function openFor(req, password) {
  const k = sessionKey(req);
  if (!k) return null;
  for (const [key, u] of unlocked) if (u.until < Date.now()) unlocked.delete(key);   // tidy expired ones
  const until = Date.now() + UNLOCK_MINUTES * 60_000;
  unlocked.set(k, { email: me(req), password, until });
  return new Date(until).toISOString();
}

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

/** The password the person unlocked with in this sign-in, while it is still open; null otherwise. */
export function unlockedPassword(req) {
  const k = sessionKey(req), u = k && unlocked.get(k);
  if (!u) return null;
  if (u.until < Date.now() || u.email !== me(req)) { unlocked.delete(k); return null; }
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
  const u = unlockedPassword(req) ? unlocked.get(sessionKey(req)) : null;
  res.json({ set: rowCount > 0, unlockedUntil: u ? new Date(u.until).toISOString() : null, minLength: MIN_LEN, freshSignIn: freshSignIn(req) });
}));

docPasswordRouter.put("/", wrap(async (req, res) => {
  const { value, error } = readPassword(req.body);
  if (error) return res.status(400).json({ error, errors: { password: error } });
  const row = (await pool.query("SELECT hash FROM document_passwords WHERE email=$1", [me(req)])).rows[0];
  if (row) {
    // Changing it needs proof that this is the person: the current password, or a sign-in from the last few minutes.
    const current = typeof req.body?.current === "string" ? req.body.current.slice(0, MAX_LEN) : "";
    if (current) {
      if (!takeTry(me(req))) return res.status(429).json({ error: LOCKED_OUT });
      if (!(await matches(current, row.hash))) return res.status(400).json({ error: "Your current document password is not right.", errors: { current: "This is not your current document password." } });
    } else if (!freshSignIn(req)) {
      return res.status(403).json({ needsFreshSignIn: true,
        error: `To set a new document password without the current one, please sign out, sign in again, and set it within ${FRESH_MINUTES} minutes.` });
    }
  }
  await pool.query(
    `INSERT INTO document_passwords (email, hash, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (email) DO UPDATE SET hash=EXCLUDED.hash, updated_at=now()`, [me(req), await hashOf(value)]);
  for (const [k, u] of unlocked) if (u.email === me(req)) unlocked.delete(k);   // other browsers must unlock with the new one
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [row ? "Document password changed" : "Document password set", me(req)]);
  tries.delete(me(req));
  if (row) {
    notify(me(req), { title: "Your document password was changed", body: "If this was not you, please tell the HR team at once.", link: "/app/account" }).catch(() => {});
  }
  res.json({ ok: true, set: true, unlockedUntil: openFor(req, value) });
}));

docPasswordRouter.post("/unlock", wrap(async (req, res) => {
  const password = typeof req.body?.password === "string" ? req.body.password.slice(0, MAX_LEN) : "";
  const row = (await pool.query("SELECT hash FROM document_passwords WHERE email=$1", [me(req)])).rows[0];
  if (!row) return res.status(409).json({ error: "Please set a document password first.", needsSetup: true });
  if (!takeTry(me(req))) return res.status(429).json({ error: LOCKED_OUT });
  if (!password || !(await matches(password, row.hash))) {
    const t = tries.get(me(req));
    if (t && t.count >= MAX_TRIES) await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", ["Document password: too many wrong tries", me(req)]);
    return res.status(400).json({ error: "That password is not right. Please try again.", errors: { password: "That password is not right." } });
  }
  tries.delete(me(req));
  res.json({ ok: true, unlockedUntil: openFor(req, password) });
}));

docPasswordRouter.post("/lock", (req, res) => { const k = sessionKey(req); if (k) unlocked.delete(k); res.json({ ok: true }); });
