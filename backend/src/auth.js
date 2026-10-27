import crypto from "node:crypto";
import { promisify } from "node:util";
import { pool } from "./db.js";
import { isCompanyEmail, COMPANY_EMAIL_MESSAGE } from "./validate.js";

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

/**
 * Checks a password against a stored hash. Two formats: this app's own "salthex:hashhex", and the Employee Portal's
 * "scrypt:N:r:p$salt$hashhex" (so logins copied from the portal keep working with the same passwords).
 */
export async function verifyPassword(pw, stored) {
  if (stored && stored.startsWith("scrypt:")) {
    const [params, salt, hex] = stored.split("$");
    const [, N, r, p] = params.split(":").map(Number);
    const want = Buffer.from(hex || "", "hex");
    if (!salt || !want.length || !N || !r || !p) return false;
    const got = await scrypt(pw, Buffer.from(salt, "utf8"), want.length, { N, r, p, maxmem: 256 * N * r });
    return crypto.timingSafeEqual(got, want);
  }
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
  if (!isCompanyEmail(email)) throw new Error(COMPANY_EMAIL_MESSAGE);
  const pw = await getDefaultPassword();
  const hash = await hashPassword(pw);
  const r = await client.query(
    "INSERT INTO users (email,password_hash,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
    [email.toLowerCase(), hash, role]);
  return r.rowCount === 1;
}

/**
 * An account for someone on the staff list who will sign in with Google. Its password is random and never shown, so it cannot be
 * guessed (not even with the shared default password). HR can still send an invitation or reset it later. False if it already exists.
 */
export async function createGoogleUser(client, email, role = "employee") {
  if (!isCompanyEmail(email)) throw new Error(COMPANY_EMAIL_MESSAGE);
  const hash = await hashPassword(crypto.randomBytes(24).toString("base64url"));
  const r = await client.query("INSERT INTO users (email,password_hash,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [email.toLowerCase(), hash, role]);
  return r.rowCount === 1;
}

/**
 * The account for a verified company email at sign-in. Anyone with an account gets it. Someone on the staff list who has never signed in
 * gets one made now (as an employee), so a first Google sign-in just works. Anyone else, or a person who has left, gets null.
 */
export async function accountForSignIn(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!isCompanyEmail(e)) return null;
  const have = (await pool.query("SELECT email FROM users WHERE lower(email)=$1", [e])).rows[0];
  if (have) return have;
  const emp = (await pool.query("SELECT name, status FROM employees WHERE lower(work_email)=$1", [e])).rows[0];
  if (!emp || emp.status === "offboarded") return null;
  await createGoogleUser(pool, e, "employee");
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", ["Login created automatically at first Google sign-in (employee role)", e]);
  return (await pool.query("SELECT email FROM users WHERE lower(email)=$1", [e])).rows[0] || null;
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
  for (const a of admins) {
    if (!isCompanyEmail(a)) throw new Error(`HR_ADMIN_EMAIL ${a}: ${COMPANY_EMAIL_MESSAGE}`);
    await createUser(pool, a, "hr");
  }
}

/* ---------- sessions ---------- */
// Behind https the session cookie must not travel over plain http.
const cookieSecure = () => ((process.env.PUBLIC_URL || "").startsWith("https://") ? "; Secure" : "");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

export async function startSession(res, email) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query("INSERT INTO sessions (token_hash,email,expires_at) VALUES ($1,$2, now() + $3 * interval '1 hour')",
    [sha(token), email, SESSION_HOURS]);
  await pool.query("DELETE FROM sessions WHERE expires_at < now()");
  res.append("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${cookieSecure()}`);
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
      // A session only counts for a company address, whatever else is in the table.
      if (rows[0] && isCompanyEmail(rows[0].email)) req.user = rows[0];
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
