import crypto from "node:crypto";
import { promisify } from "node:util";
import express from "express";
import { pool } from "./db.js";
import { sessionKeyOf } from "./auth.js";

/* Pay section PIN: a second lock, on top of Google sign-in, in front of everything that shows pay.
   - Each person sets a 6-digit PIN once. Only a salted hash is stored (HMAC with a server secret, then scrypt), never the PIN.
   - Opening Pay needs the PIN. A correct PIN unlocks THIS browser session only (sessions.pay_unlocked_until), for 2 minutes after the
     last sign of activity (the page sends a quiet heartbeat while the person is active), and never longer than an hour in one go.
   - requirePayUnlock guards every pay endpoint (payslips, payroll, finance reports, tax declarations): a direct call without a live
     unlock gets 423. The browser's lock screen is only a convenience; this is the lock.
   - 5 wrong PINs lock PIN checks for 15 minutes. Locking, signing out, a reset or the session ending all end the unlock.
   - "Forgot PIN" needs a fresh Google sign-in as the same person (google-signin.js sets sessions.pay_recover_until).
   - Every step is written to audit_log in words; neither the PIN nor any salary figure is ever logged. */
const scrypt = promisify(crypto.scrypt);
export const IDLE_SECONDS = 120;          // unlocked for this long after the last activity
const MAX_UNLOCK_MINUTES = 60;            // and never longer than this in one go
const MAX_FAILS = 5, LOCK_MINUTES = 15;   // wrong PINs, and how long checking stops
const RECOVER_MINUTES = 10;               // how long a fresh Google sign-in lets someone choose a new PIN
const PIN = /^\d{6}$/;

/* ---------- the PIN itself ---------- */
const pepper = () => {
  const p = process.env.PAY_PIN_PEPPER || process.env.PAYROLL_ENCRYPTION_KEY || "";
  if (!p && !pepper.warned) { pepper.warned = true; console.warn("PAY_PIN_PEPPER is not set: Pay PINs are hashed without a server secret. Set it in the server settings."); }
  return p || "wohlig-one-pay-pin";
};
const keyOf = (pin) => crypto.createHmac("sha256", pepper()).update(pin).digest("hex");
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

export async function hashPin(pin) {
  const salt = crypto.randomBytes(16), hash = await scrypt(keyOf(pin), salt, 64, SCRYPT);
  return `pin1$${salt.toString("hex")}$${hash.toString("hex")}`;
}
export async function verifyPin(pin, stored) {
  const [v, salt, hex] = String(stored || "").split("$");
  if (v !== "pin1" || !salt || !hex) return false;
  const want = Buffer.from(hex, "hex"), got = await scrypt(keyOf(pin), Buffer.from(salt, "hex"), want.length, SCRYPT);
  return crypto.timingSafeEqual(got, want);
}

const COMMON = new Set(["123123", "112233", "121212", "101010", "696969", "159753", "147258", "789456", "123321", "111222", "222333", "010203", "123789", "135790", "246810", "159357", "456456", "789789", "102030", "202020", "131313", "321321", "112211", "520520", "123654"]);
/** Why a PIN is not allowed (null when it is fine): six digits, not all the same, not a run (123456, 654321), not a repeated pattern, not a common choice. */
export function weakPin(pin) {
  const p = String(pin || "");
  if (!PIN.test(p)) return "Enter exactly 6 digits, numbers only.";
  const d = [...p].map(Number);
  if (d.every((x) => x === d[0])) return "That PIN is too easy to guess. Avoid repeating the same digit.";
  const steps = d.slice(1).map((x, i) => (x - d[i] + 10) % 10);
  if (steps.every((s) => s === 1) || steps.every((s) => s === 9)) return "That PIN is too easy to guess. Avoid a run of numbers such as 123456.";
  if (p.slice(0, 3) === p.slice(3) || p.slice(0, 2) === p.slice(2, 4) && p.slice(2, 4) === p.slice(4) || (p[0] === p[1] && p[2] === p[3] && p[4] === p[5])) return "That PIN is too easy to guess. Avoid repeated patterns.";
  if (COMMON.has(p)) return "That PIN is too common. Please choose a less obvious one.";
  return null;
}

/* ---------- state ---------- */
const audit = (email, action) => pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]).catch((e) => console.error("Pay PIN audit failed:", e.message));
const minutesLeft = (ts) => Math.max(1, Math.ceil((new Date(ts) - Date.now()) / 60000));

/** Starts (or extends) this session's unlock: IDLE_SECONDS from now, but never past MAX_UNLOCK_MINUTES after it was first opened. */
async function openUnlock(key, first) {
  const { rowCount } = await pool.query(
    `UPDATE sessions SET pay_unlocked_at = CASE WHEN $2 THEN now() ELSE pay_unlocked_at END,
            pay_unlocked_until = LEAST(now() + $3 * interval '1 second', (CASE WHEN $2 THEN now() ELSE pay_unlocked_at END) + $4 * interval '1 minute')
      WHERE token_hash=$1 AND expires_at > now()
        AND ($2 OR (pay_unlocked_until > now() AND pay_unlocked_at + $4 * interval '1 minute' > now()))`, [key, first, IDLE_SECONDS, MAX_UNLOCK_MINUTES]);
  return rowCount === 1;
}
/** Ends this session's unlock. True when it was open (so a lock is written to the log once, not for every call). */
async function closeUnlock(key) {
  const { rowCount } = await pool.query("UPDATE sessions SET pay_unlocked_until=NULL, pay_unlocked_at=NULL WHERE token_hash=$1 AND pay_unlocked_until > now()", [key]);
  return rowCount === 1;
}
async function stateOf(req) {
  const email = req.user.email.toLowerCase(), key = sessionKeyOf(req);
  const [{ rows: [pin] }, { rows: [s] }] = await Promise.all([
    pool.query("SELECT locked_until FROM pay_pins WHERE email=$1", [email]),
    pool.query("SELECT pay_unlocked_until, pay_recover_until, (pay_unlocked_until > now() AND pay_unlocked_at + $2 * interval '1 minute' > now()) AS open FROM sessions WHERE token_hash=$1", [key, MAX_UNLOCK_MINUTES])]);
  return { email, key, pinSet: !!pin, lockedUntil: pin && pin.locked_until && new Date(pin.locked_until) > new Date() ? pin.locked_until : null,
    open: !!(s && s.open), recoverOk: !!(s && s.pay_recover_until && new Date(s.pay_recover_until) > new Date()), until: s && s.pay_unlocked_until };
}
const publicState = (st) => ({ pinSet: st.pinSet, unlocked: st.open, idleSeconds: IDLE_SECONDS, recoverOk: st.recoverOk,
  lockedOutMinutes: st.lockedUntil ? minutesLeft(st.lockedUntil) : 0 });

/**
 * Guards a pay endpoint: the signed-in person's session must hold a live Pay unlock. It does not extend the unlock (only the
 * heartbeat, POST /api/pay/touch, does, and the page sends that only while the person is active). Otherwise 423 with a code the page understands.
 */
export async function requirePayUnlock(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: "Please sign in." });
    const st = await stateOf(req);
    if (st.open) return next();
    if (st.until) { await closeUnlock(st.key); if (st.until && new Date(st.until) < new Date()) audit(st.email, "Pay locked automatically after inactivity"); }
    res.setHeader("Cache-Control", "no-store");
    res.status(423).json({ error: st.pinSet ? "Your Pay section is locked. Please enter your security PIN." : "Please create your Pay security PIN first.", code: st.pinSet ? "PAY_LOCKED" : "PAY_SETUP" });
  } catch (err) { next(err); }
}

/* ---------- the endpoints (/api/pay, signed in) ---------- */
export const payPinRouter = express.Router();
payPinRouter.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
payPinRouter.use((req, res, next) => (req.user ? next() : res.status(401).json({ error: "Please sign in." })));
const guard = (fn) => (req, res) => fn(req, res).catch((err) => { console.error(err); res.status(500).json({ error: "Server error" }); });
const body = (req) => (req.body && typeof req.body === "object" ? req.body : {});

payPinRouter.get("/status", guard(async (req, res) => { res.json(publicState(await stateOf(req))); }));

// First time: choose the PIN. Allowed only while the person has none; a PIN that exists can only be changed through "Forgot PIN".
payPinRouter.post("/pin", guard(async (req, res) => {
  const { pin, confirm } = body(req), st = await stateOf(req);
  if (st.pinSet) return res.status(409).json({ error: "You have already set a Pay PIN. Use Forgot PIN if you need a new one." });
  if (pin !== confirm) return res.status(400).json({ error: "The two PINs do not match." });
  const bad = weakPin(pin); if (bad) return res.status(400).json({ error: bad });
  const made = await pool.query("INSERT INTO pay_pins (email, pin_hash) VALUES ($1,$2) ON CONFLICT DO NOTHING", [st.email, await hashPin(pin)]);
  if (!made.rowCount) return res.status(409).json({ error: "You have already set a Pay PIN. Use Forgot PIN if you need a new one." });
  await audit(st.email, "Pay PIN created");
  await openUnlock(st.key, true);
  res.status(201).json(publicState(await stateOf(req)));
}));

// Checks the PIN (a wrong one answers 403, never 401: the app treats 401 as "signed out"). Five wrong tries stop the checking for 15 minutes (for this person, whichever browser they use).
payPinRouter.post("/unlock", guard(async (req, res) => {
  const pin = String(body(req).pin || ""), email = req.user.email.toLowerCase(), key = sessionKeyOf(req);
  const { rows: [row] } = await pool.query("SELECT pin_hash, failed_attempts, locked_until FROM pay_pins WHERE email=$1", [email]);
  if (!row) return res.status(409).json({ error: "Please create your Pay security PIN first.", code: "PAY_SETUP" });
  if (row.locked_until && new Date(row.locked_until) > new Date()) return res.status(429).json({ error: `Too many wrong PINs. Please try again in ${minutesLeft(row.locked_until)} minute${minutesLeft(row.locked_until) === 1 ? "" : "s"}, or use Forgot PIN.`, lockedOutMinutes: minutesLeft(row.locked_until) });
  const ok = PIN.test(pin) && (await verifyPin(pin, row.pin_hash));
  if (ok) {
    await pool.query("UPDATE pay_pins SET failed_attempts=0, locked_until=NULL WHERE email=$1", [email]);
    await openUnlock(key, true);
    await audit(email, "Pay PIN verified");
    return res.json(publicState(await stateOf(req)));
  }
  const { rows: [n] } = await pool.query(
    `UPDATE pay_pins SET failed_attempts = failed_attempts + 1,
            locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + $3 * interval '1 minute' ELSE locked_until END,
            updated_at = now() WHERE email=$1 RETURNING failed_attempts, locked_until`, [email, MAX_FAILS, LOCK_MINUTES]);
  const lockedNow = n.failed_attempts >= MAX_FAILS;
  await audit(email, lockedNow ? `Wrong Pay PIN entered ${n.failed_attempts} times: PIN checks locked for ${LOCK_MINUTES} minutes` : `Wrong Pay PIN entered (attempt ${n.failed_attempts} of ${MAX_FAILS})`);
  if (lockedNow) {   // the counter starts again once the lockout is over
    await pool.query("UPDATE pay_pins SET failed_attempts=0 WHERE email=$1", [email]);
    return res.status(429).json({ error: `Too many wrong PINs. Please try again in ${LOCK_MINUTES} minutes, or use Forgot PIN.`, lockedOutMinutes: LOCK_MINUTES });
  }
  res.status(403).json({ error: `That PIN is not correct. ${MAX_FAILS - n.failed_attempts} ${MAX_FAILS - n.failed_attempts === 1 ? "try" : "tries"} left.`, triesLeft: MAX_FAILS - n.failed_attempts });
}));

// The page calls this about every 30 seconds while the person is active. Without it the unlock runs out after 2 minutes.
payPinRouter.post("/touch", guard(async (req, res) => {
  const ok = await openUnlock(sessionKeyOf(req), false);
  if (!ok) return res.status(423).json({ error: "Your Pay section is locked.", code: "PAY_LOCKED" });
  res.json({ unlocked: true, idleSeconds: IDLE_SECONDS });
}));

// Locks Pay now: the Lock Pay button, leaving the Pay pages, the tab being hidden, or two idle minutes.
const REASONS = { manual: "Pay locked manually", navigated: "Pay locked after leaving the Pay section", hidden: "Pay locked when the browser tab was hidden", idle: "Pay locked automatically after inactivity" };
payPinRouter.post("/lock", guard(async (req, res) => {
  const why = REASONS[body(req).reason] ? body(req).reason : "manual";
  if (await closeUnlock(sessionKeyOf(req))) await audit(req.user.email.toLowerCase(), REASONS[why]);
  res.json({ unlocked: false });
}));

// "Forgot PIN", second half: after a fresh Google sign-in as this same person (see google-signin.js) they may choose a new PIN.
payPinRouter.post("/recover/reset", guard(async (req, res) => {
  const { pin, confirm } = body(req), st = await stateOf(req);
  if (!st.recoverOk) return res.status(403).json({ error: "Please confirm it is you with Google first.", code: "PAY_RECOVER_NEEDED" });
  if (pin !== confirm) return res.status(400).json({ error: "The two PINs do not match." });
  const bad = weakPin(pin); if (bad) return res.status(400).json({ error: bad });
  await pool.query(
    `INSERT INTO pay_pins (email, pin_hash) VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET pin_hash=$2, failed_attempts=0, locked_until=NULL, updated_at=now()`, [st.email, await hashPin(pin)]);
  // Every earlier unlock, in every browser, ends now; this browser then unlocks with the new PIN.
  await pool.query("UPDATE sessions SET pay_unlocked_until=NULL, pay_unlocked_at=NULL WHERE lower(email)=$1", [st.email]);
  await pool.query("UPDATE sessions SET pay_recover_until=NULL WHERE token_hash=$1", [st.key]);
  await audit(st.email, "Pay PIN reset after confirming with Google");
  await openUnlock(st.key, true);
  res.json(publicState(await stateOf(req)));
}));

/** Used by google-signin.js after a fresh Google sign-in as the signed-in person: lets this session choose a new PIN. */
export async function allowPinReset(key) {
  const { rowCount } = await pool.query("UPDATE sessions SET pay_recover_until = now() + $2 * interval '1 minute' WHERE token_hash=$1 AND expires_at > now()", [key, RECOVER_MINUTES]);
  return rowCount === 1;
}
export { audit as auditPay };
