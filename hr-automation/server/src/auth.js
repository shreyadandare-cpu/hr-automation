// Passwords and sessions for the HR system. Passwords are stored only as salted scrypt hashes.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { pool, withTx } from "./db.js";
import { writeAudit } from "./audit.js";
import { isWohligEmail, roleOf } from "./ops.js";

const scrypt = promisify(scryptCb);
const SESSION_HOURS = 8;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
export const MIN_PASSWORD = 10;

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${key.toString("base64url")}`;
}

export async function checkPassword(password, stored) {
  const [kind, salt, hashed] = String(stored).split("$");
  if (kind !== "scrypt" || !salt || !hashed) return false;
  const expected = Buffer.from(hashed, "base64url");
  const actual = await scrypt(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

// Signs in with email and password. The same message is given for an unknown email and a wrong
// password, so the form cannot be used to discover which emails have accounts.
export async function signIn(email, password) {
  const fail = () => { throw new Error("Email or password is not correct."); };
  const addr = String(email ?? "").trim().toLowerCase();
  if (!isWohligEmail(addr) || typeof password !== "string") fail();
  // Failures are saved inside the transaction and reported after it, so a lock is never rolled back.
  const outcome = await withTx(async (c) => {
    const { rows: [acc] } = await c.query("SELECT * FROM accounts WHERE email=$1", [addr]);
    if (!acc) return { error: "not correct" };
    if (acc.locked_until && new Date(acc.locked_until) > new Date()) return { error: "locked" };
    const ok = await checkPassword(password, acc.password_hash);
    if (!ok) {
      const fails = acc.failed_count + 1;
      const lock = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60000) : null;
      await c.query("UPDATE accounts SET failed_count=$2, locked_until=$3 WHERE email=$1", [addr, lock ? 0 : fails, lock]);
      await writeAudit(c, { actor: addr, action: lock ? "Account locked after wrong passwords" : "Wrong password", result: "fail" });
      return { error: "not correct" };
    }
    await c.query("UPDATE accounts SET failed_count=0, locked_until=NULL WHERE email=$1", [addr]);
    const token = randomBytes(32).toString("base64url");
    await c.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + ($3 || ' hours')::interval)",
      [sha256(token), addr, String(SESSION_HOURS)]);
    await writeAudit(c, { actor: addr, action: "Signed in", result: "info" });
    return { session: token, email: addr, role: await roleOf(addr), expires_hours: SESSION_HOURS };
  });
  if (outcome.error === "locked") throw new Error("Too many wrong attempts. Try again in 15 minutes.");
  if (outcome.error) fail();
  return outcome;
}

export async function signOut(token) {
  if (!token) return { ok: true };
  const { rows: [s] } = await pool.query("DELETE FROM sessions WHERE token_hash=$1 RETURNING email", [sha256(token)]);
  if (s) await withTx((c) => writeAudit(c, { actor: s.email, action: "Signed out", result: "info" }));
  return { ok: true };
}

// The only way the server learns who is calling. Expired or unknown sessions are refused.
export async function emailForSession(token) {
  if (!token) throw new Error("Please sign in.");
  const { rows: [s] } = await pool.query(
    "SELECT email FROM sessions WHERE token_hash=$1 AND expires_at > now()", [sha256(token)]);
  if (!s) throw new Error("Your sign-in has expired. Please sign in again.");
  return s.email;
}

// An HR or IT admin sets or resets an account's password. Staff must change it on next use.
export async function setPassword({ actor, email, password }) {
  const role = await roleOf(actor);
  if (role !== "admin" && role !== "it") throw new Error("Only HR and IT admins can set passwords.");
  const addr = String(email ?? "").trim().toLowerCase();
  if (!isWohligEmail(addr)) throw new Error("Only @wohlig.com accounts can have a password.");
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters.`);
  }
  const hashed = await hashPassword(password);
  return withTx(async (c) => {
    await c.query(`INSERT INTO accounts (email, password_hash, failed_count, locked_until, updated_at)
                   VALUES ($1,$2,0,NULL,now())
                   ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, failed_count=0, locked_until=NULL, updated_at=now()`,
      [addr, hashed]);
    await c.query("DELETE FROM sessions WHERE email=$1", [addr]); // resetting a password signs them out everywhere
    await writeAudit(c, { actor, action: `Password set for ${addr}`, result: "info" });
    return { email: addr, ok: true };
  });
}

export async function changeOwnPassword({ session, oldPassword, newPassword }) {
  const email = await emailForSession(session);
  const { rows: [acc] } = await pool.query("SELECT password_hash FROM accounts WHERE email=$1", [email]);
  if (!acc || !(await checkPassword(oldPassword ?? "", acc.password_hash))) throw new Error("Current password is not correct.");
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD) throw new Error(`New password must be at least ${MIN_PASSWORD} characters.`);
  const hashed = await hashPassword(newPassword);
  await pool.query("UPDATE accounts SET password_hash=$2, updated_at=now() WHERE email=$1", [email, hashed]);
  return { ok: true };
}
