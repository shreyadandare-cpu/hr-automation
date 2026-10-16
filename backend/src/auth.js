import crypto from "node:crypto";
import { promisify } from "node:util";
import { pool } from "./db.js";

const scrypt = promisify(crypto.scrypt);
const SESSION_HOURS = 12;
const COOKIE = "sid";

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

// A throwaway hash, so a login for an unknown email takes as long as one for a real account.
const dummy = await hashPassword("not-a-real-password");

export async function verifyPassword(pw, stored) {
  const [salt, hash] = (stored || dummy).split(":");
  const got = await scrypt(pw, Buffer.from(salt, "hex"), 64);
  const want = Buffer.from(hash, "hex");
  const same = crypto.timingSafeEqual(got, want);
  return Boolean(stored) && same;
}

/* ---------- default password ---------- */
export async function getDefaultPassword() {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='default_password'");
  return rows[0]?.value;
}

export async function setDefaultPassword(value) {
  await pool.query(
    `INSERT INTO settings (key,value) VALUES ('default_password',$1)
     ON CONFLICT (key) DO UPDATE SET value=$1`, [value]);
}

/** Creates a login with the current default password. Returns false when the email already has one. */
export async function createUser(client, email, role) {
  const pw = await getDefaultPassword();
  const hash = await hashPassword(pw);
  const r = await client.query(
    "INSERT INTO users (email,password_hash,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
    [email.toLowerCase(), hash, role]);
  return r.rowCount === 1;
}

/** First run: set the default password from the environment and create the first HR login(s). */
export async function bootstrapAuth() {
  if (!(await getDefaultPassword())) {
    const pw = process.env.DEFAULT_PASSWORD;
    if (!pw || pw.length < 8) throw new Error("Set DEFAULT_PASSWORD (at least 8 characters) in server/.env");
    await setDefaultPassword(pw);
  }
  const { rows } = await pool.query("SELECT 1 FROM users WHERE role='hr' LIMIT 1");
  if (rows.length) return;
  const admins = (process.env.HR_ADMIN_EMAIL || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!admins.length) throw new Error("Set HR_ADMIN_EMAIL in server/.env so there is a first HR login");
  for (const a of admins) await createUser(pool, a, "hr");
}

/* ---------- sessions ---------- */
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

export async function startSession(res, email) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query("INSERT INTO sessions (token_hash,email,expires_at) VALUES ($1,$2, now() + $3 * interval '1 hour')",
    [sha(token), email, SESSION_HOURS]);
  await pool.query("DELETE FROM sessions WHERE expires_at < now()");
  res.append("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}`);
}

const tokenOf = (req) => /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || "")?.[1];

export async function endSession(req, res) {
  const t = tokenOf(req);
  if (t) await pool.query("DELETE FROM sessions WHERE token_hash=$1", [sha(t)]);
  res.append("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

/** Puts { email, role } on req.user when the cookie holds a live session. */
export async function loadSession(req, _res, next) {
  try {
    const t = tokenOf(req);
    if (t) {
      const { rows } = await pool.query(
        `SELECT u.email, u.role FROM sessions s JOIN users u ON lower(u.email)=lower(s.email)
         WHERE s.token_hash=$1 AND s.expires_at > now()`, [sha(t)]);
      if (rows[0]) req.user = rows[0];
    }
    next();
  } catch (e) { next(e); }
}

export const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: "Please sign in." });

export const requireHr = (req, res, next) =>
  !req.user ? res.status(401).json({ error: "Please sign in." })
  : req.user.role !== "hr" ? res.status(403).json({ error: "HR only." })
  : next();

/* ---------- brute-force guard: 5 wrong passwords lock an email for 15 minutes ---------- */
const fails = new Map();
const LIMIT = 5, LOCK_MS = 15 * 60 * 1000;

export function lockedFor(key) {
  const f = fails.get(key);
  return f && f.n >= LIMIT && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0;
}
export function noteFailure(key) {
  const f = fails.get(key);
  const n = f && f.until > Date.now() ? f.n + 1 : 1;
  fails.set(key, { n, until: Date.now() + LOCK_MS });
}
export const clearFailures = (key) => fails.delete(key);
