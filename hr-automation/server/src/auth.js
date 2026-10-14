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

// Every new password must have at least one uppercase letter, one lowercase letter, one number and one special character.
export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (!/[A-Z]/.test(pw)) return "Password needs at least one uppercase letter (A-Z).";
  if (!/[a-z]/.test(pw)) return "Password needs at least one lowercase letter (a-z).";
  if (!/[0-9]/.test(pw)) return "Password needs at least one number (0-9).";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Password needs at least one special character, such as ! @ # $ % &.";
  return null;
}

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
export async function signIn(email, password, chosenRole = "employee") {
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
    // A person may sign in with a lower role than they hold (for example HR admin viewing as Employee),
    // but never a higher one. The role HR has given is the ceiling.
    const assigned = await roleOf(addr);
    const want = ["admin", "it", "employee"].includes(chosenRole) ? chosenRole : "employee";
    if (want !== "employee" && want !== assigned) {
      throw new Error(`Your account is not ${want === "admin" ? "an HR admin" : "an IT admin"}. Sign in as Employee, or ask HR to check your access.`);
    }
    const sessionRole = want;
    const token = randomBytes(32).toString("base64url");
    await c.query("INSERT INTO sessions (token_hash, email, expires_at, session_role) VALUES ($1,$2, now() + ($3 || ' hours')::interval, $4)",
      [sha256(token), addr, String(SESSION_HOURS), sessionRole]);
    await writeAudit(c, { actor: addr, action: `Signed in as ${sessionRole}`, result: "info" });
    return { session: token, email: addr, role: sessionRole, expires_hours: SESSION_HOURS };
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

// The only way the server learns who is calling, and in which role. Expired or unknown sessions are refused.
export async function sessionFor(token) {
  if (!token) throw new Error("Please sign in.");
  const { rows: [s] } = await pool.query(
    "SELECT email, session_role FROM sessions WHERE token_hash=$1 AND expires_at > now()", [sha256(token)]);
  if (!s) throw new Error("Your sign-in has expired. Please sign in again.");
  return { email: s.email, role: s.session_role };
}
export async function emailForSession(token) {
  return (await sessionFor(token)).email;
}

// An HR or IT admin sets or resets an account's password. Staff must change it on next use.
export async function setPassword({ actor, email, password }) {
  const role = await roleOf(actor);
  if (role !== "admin" && role !== "it") throw new Error("Only HR and IT admins can set passwords.");
  const addr = String(email ?? "").trim().toLowerCase();
  if (!isWohligEmail(addr)) throw new Error("Only @wohlig.com accounts can have a password.");
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
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
  const problem = passwordProblem(newPassword);
  if (problem) throw new Error(problem);
  const hashed = await hashPassword(newPassword);
  await pool.query("UPDATE accounts SET password_hash=$2, updated_at=now() WHERE email=$1", [email, hashed]);
  return { ok: true };
}


// Self sign-up. Only a @wohlig.com email that is already in the employee list may create an account,
// and only once. The person then signs in with the password they chose. Their role is still set by HR.
export async function signUp({ email, password }) {
  const addr = String(email ?? "").trim().toLowerCase();
  if (!isWohligEmail(addr)) throw new Error("Only @wohlig.com email addresses can create an account.");
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  return withTx(async (c) => {
    const { rows: [emp] } = await c.query("SELECT id FROM employees WHERE lower(work_email)=$1", [addr]);
    if (!emp) throw new Error("This email is not in the employee list. Ask HR to add you first.");
    const { rows: [exists] } = await c.query("SELECT 1 FROM accounts WHERE email=$1", [addr]);
    if (exists) throw new Error("An account already exists for this email. Sign in instead.");
    const hashed = await hashPassword(password);
    await c.query("INSERT INTO accounts (email, password_hash, failed_count, locked_until, updated_at) VALUES ($1,$2,0,NULL,now())", [addr, hashed]);
    await writeAudit(c, { actor: addr, action: "Account created (self sign-up)", employeeId: emp.id, result: "info" });
    return { ok: true, email: addr };
  });
}
