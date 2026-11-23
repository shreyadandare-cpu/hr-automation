import crypto from "node:crypto";
import { promisify } from "node:util";
import express from "express";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { pool } from "./db.js";
import { sessionKeyOf } from "./auth.js";
import { frontendUrl, mailConfigured, mailSkipped, maskEmail, publicUrl, sendMail } from "./mail.js";
import { MAROON, PRODUCT } from "./brand.js";

/* Pay section security: a second lock, on top of Google sign-in, in front of everything that shows pay.
   - Opening Pay needs one of the things the person set up: the fingerprint (Touch ID, Face ID or the device's own unlock, through a passkey),
     the 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy...), or, for a device with no
     fingerprint reader, a 6-digit PIN (only a salted hash is stored: HMAC with the server secret, then scrypt).
   - A correct check unlocks THIS browser session only (sessions.pay_unlocked_until), for 15 minutes after the last sign of activity
     (the page sends a quiet heartbeat while the person is active), and never longer than 8 hours in one go. Both are settings.
   - requirePayUnlock guards the personal pay endpoints (a person's own payslips and tax declaration): a direct call without a live
     unlock gets 423. Payroll and finance reports are not behind it; their own permissions guard them. The browser's lock screen is only a convenience; this is the lock.
   - 5 wrong authenticator codes (or 5 wrong PINs) lock those checks for 15 minutes. An authenticator code is accepted once only. Locking, signing out, a reset or the
     session ending all end the unlock.
   - Setting up (the first time, or after a lost phone) first needs proof it is the person: a 6-digit code emailed to their own work
     address (valid 10 minutes, 5 tries, one resend a minute, 5 emails an hour, only its hash stored) or a fresh Google sign-in as
     the same person. Either sets sessions.pay_recover_until and clears the old fingerprints, authenticator and PIN, so a lost device stops working.
   - Authenticator secrets are stored encrypted (AES-256-GCM, keyed from PAY_PIN_PEPPER); passkeys hold only a public key.
   - Every step is written to audit_log in words; neither a code nor any salary figure is ever logged. */
export const IDLE_SECONDS = (Number(process.env.PAY_IDLE_MINUTES) || 15) * 60;   // unlocked for this long after the last activity (PAY_IDLE_MINUTES, default 15)
const MAX_UNLOCK_MINUTES = (Number(process.env.PAY_MAX_HOURS) || 8) * 60;          // and never longer than this in one go (PAY_MAX_HOURS, default 8)
const MAX_FAILS = 5, LOCK_MINUTES = 15;   // wrong authenticator codes, and how long checking stops
const RECOVER_MINUTES = 10;               // how long proof of identity lets someone set up their security
const OTP_MINUTES = 10, OTP_TRIES = 5, OTP_RESEND_SECONDS = 60, OTP_PER_HOUR = 5;   // the emailed code
const CODE = /^\d{6}$/;
const TOTP_STEP = 30;                     // seconds an authenticator code lasts
const scrypt = promisify(crypto.scrypt);

/* ---------- secrets ---------- */
const pepper = () => {
  const p = process.env.PAY_PIN_PEPPER || process.env.PAYROLL_ENCRYPTION_KEY || "";
  if (!p && !pepper.warned) { pepper.warned = true; console.warn("PAY_PIN_PEPPER is not set: Pay security uses a built-in secret. Set it in the server settings."); }
  return p || "wohlig-one-pay-pin";
};
const box = () => crypto.createHash("sha256").update(`pay-2fa:${pepper()}`).digest();
export function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", box(), iv);
  const ct = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
}
export function unseal(sealed) {
  const [v, iv, tag, ct] = String(sealed || "").split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("bad sealed value");
  const d = crypto.createDecipheriv("aes-256-gcm", box(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

/* ---------- the PIN (for a device with no fingerprint reader) ---------- */
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
  if (!CODE.test(p)) return "Enter exactly 6 digits, numbers only.";
  const d = [...p].map(Number);
  if (d.every((x) => x === d[0])) return "That PIN is too easy to guess. Avoid repeating the same digit.";
  const steps = d.slice(1).map((x, i) => (x - d[i] + 10) % 10);
  if (steps.every((s) => s === 1) || steps.every((s) => s === 9)) return "That PIN is too easy to guess. Avoid a run of numbers such as 123456.";
  if (p.slice(0, 3) === p.slice(3) || p.slice(0, 2) === p.slice(2, 4) && p.slice(2, 4) === p.slice(4) || (p[0] === p[1] && p[2] === p[3] && p[4] === p[5])) return "That PIN is too easy to guess. Avoid repeated patterns.";
  if (COMMON.has(p)) return "That PIN is too common. Please choose a less obvious one.";
  return null;
}

/* ---------- authenticator codes (RFC 6238: HMAC-SHA1, 30 seconds, 6 digits) ---------- */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(buf) {
  let bits = 0, val = 0, out = "";
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function unbase32(str) {
  let bits = 0, val = 0; const out = [];
  for (const ch of String(str).toUpperCase().replace(/[^A-Z2-7]/g, "")) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newSecret = () => base32(crypto.randomBytes(20));
export function totp(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", unbase32(secret)).update(msg).digest(), o = h[h.length - 1] & 15;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000).padStart(6, "0");
}
/** The time step the code belongs to (one step either side of now is allowed for clock drift), or null. A step at or before `last` is refused: a code works once. */
export function checkTotp(secret, code, last = 0, now = Date.now()) {
  if (!CODE.test(String(code))) return null;
  const here = Math.floor(now / 1000 / TOTP_STEP);
  for (const step of [here, here - 1, here + 1]) {
    if (step <= last) continue;
    const want = Buffer.from(totp(secret, step)), got = Buffer.from(String(code));
    if (crypto.timingSafeEqual(want, got)) return step;
  }
  return null;
}
export const otpauthUrl = (email, secret) =>
  `otpauth://totp/${encodeURIComponent(PRODUCT)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(PRODUCT)}&algorithm=SHA1&digits=6&period=${TOTP_STEP}`;

/* The emailed code: 6 random digits, stored only as an HMAC (with the server secret) tied to the person's address. */
export const newOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");
export const otpKey = (email, code) => crypto.createHmac("sha256", pepper()).update(`otp:${String(email).toLowerCase()}:${code}`).digest("hex");
const sameKey = (a, b) => { const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex"); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/* ---------- state ---------- */
const audit = (email, action) => pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]).catch((e) => console.error("Pay security audit failed:", e.message));
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
  const [{ rows: [t] }, { rows: [k] }, { rows: [n] }, { rows: [s] }] = await Promise.all([
    pool.query("SELECT locked_until FROM pay_totp WHERE email=$1 AND confirmed", [email]),
    pool.query("SELECT count(*)::int AS n FROM pay_passkeys WHERE email=$1", [email]),
    pool.query("SELECT locked_until FROM pay_pins WHERE email=$1", [email]),
    pool.query("SELECT pay_unlocked_until, pay_recover_until, (pay_unlocked_until > now() AND pay_unlocked_at + $2 * interval '1 minute' > now()) AS open FROM sessions WHERE token_hash=$1", [key, MAX_UNLOCK_MINUTES])]);
  const live = (row) => (row && row.locked_until && new Date(row.locked_until) > new Date() ? row.locked_until : null);
  return { email, key, totp: !!t, passkeys: k.n, pin: !!n, lockedUntil: live(t), pinLockedUntil: live(n),
    open: !!(s && s.open), recoverOk: !!(s && s.pay_recover_until && new Date(s.pay_recover_until) > new Date()), until: s && s.pay_unlocked_until };
}
const factorCount = (st) => (st.totp ? 1 : 0) + st.passkeys + (st.pin ? 1 : 0);
const publicState = (st) => ({ enrolled: factorCount(st) > 0, totp: st.totp, passkeys: st.passkeys, pin: st.pin, unlocked: st.open, idleSeconds: IDLE_SECONDS, recoverOk: st.recoverOk,
  lockedOutMinutes: st.lockedUntil ? minutesLeft(st.lockedUntil) : 0, pinLockedOutMinutes: st.pinLockedUntil ? minutesLeft(st.pinLockedUntil) : 0 });

/**
 * Guards a pay endpoint: the signed-in person's session must hold a live Pay unlock. It does not extend the unlock (only the
 * heartbeat, POST /api/pay/touch, does, and the page sends that only while the person is active). Otherwise 423 with a code the page understands.
 */
/** The Pay lock is switched off for now (decided 2026-11-23): set to true here, and PAY_LOCK_ON in frontend/src/modules/paysecurity/PayLock.jsx, to bring it back. */
export const PAY_LOCK_ON = false;
export async function requirePayUnlock(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: "Please sign in." });
    if (!PAY_LOCK_ON) return next();
    const st = await stateOf(req);
    if (st.open) return next();
    if (st.until) { await closeUnlock(st.key); if (st.until && new Date(st.until) < new Date()) audit(st.email, "Pay locked automatically after inactivity"); }
    res.setHeader("Cache-Control", "no-store");
    const set = factorCount(st) > 0;
    res.status(423).json({ error: set ? "Your Pay section is locked. Please verify it is you." : "Please set up your Pay security first.", code: set ? "PAY_LOCKED" : "PAY_SETUP" });
  } catch (err) { next(err); }
}

/* ---------- passkeys (fingerprint, Face ID, device unlock) ---------- */
/** The web addresses this site is reached on; a passkey belongs to one of them (its host is the passkey's "relying party"). */
const allowedOrigins = () => [...new Set([publicUrl(), frontendUrl()].map((u) => { try { return new URL(u).origin; } catch { return null; } }).filter(Boolean))];
function originOf(req) {
  const o = String(req.headers.origin || "");
  if (allowedOrigins().includes(o)) return o;
  try {   // the page's own address: the browser says it came from the very host it asked (an address the site is reached on, e.g. behind a proxy)
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    if (host && new URL(o).host === host) return o;
  } catch { /* no usable origin */ }
  return null;
}
const saveChallenge = async (key, kind, challenge) => {
  await pool.query("DELETE FROM pay_challenges WHERE expires_at < now()");
  await pool.query(
    `INSERT INTO pay_challenges (token_hash, kind, challenge, expires_at) VALUES ($1,$2,$3, now() + interval '5 minutes')
     ON CONFLICT (token_hash, kind) DO UPDATE SET challenge=$3, expires_at=now() + interval '5 minutes'`, [key, kind, challenge]);
};
const takeChallenge = async (key, kind) => {
  const { rows: [c] } = await pool.query("DELETE FROM pay_challenges WHERE token_hash=$1 AND kind=$2 RETURNING challenge, (expires_at > now()) AS live", [key, kind]);
  return c && c.live ? c.challenge : null;
};
const userIdOf = (email) => new Uint8Array(crypto.createHash("sha256").update(`pay-passkey:${email}`).digest());
const deviceName = (req) => {
  const ua = String(req.headers["user-agent"] || "");
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Android/.test(ua) ? "Android phone" : /Windows/.test(ua) ? "Windows PC" : /Linux/.test(ua) ? "Linux PC" : "This device";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "";
  return br ? `${os} (${br})` : os;
};

/* ---------- the endpoints (/api/pay, signed in) ---------- */
export const paySecurityRouter = express.Router();
paySecurityRouter.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
paySecurityRouter.use((req, res, next) => (req.user ? next() : res.status(401).json({ error: "Please sign in." })));
const guard = (fn) => (req, res) => fn(req, res).catch((err) => { console.error(err); res.status(500).json({ error: "Server error" }); });
const body = (req) => (req.body && typeof req.body === "object" ? req.body : {});
/** Setting up a factor is allowed after proof of identity (a fresh email code or Google sign-in), or from an already unlocked Pay. */
const mayEnrol = (st) => st.recoverOk || st.open;

paySecurityRouter.get("/status", guard(async (req, res) => { res.json(publicState(await stateOf(req))); }));

// The settings panel (an unlocked Pay only): what is set up.
paySecurityRouter.get("/factors", guard(async (req, res) => {
  const st = await stateOf(req);
  if (!st.open) return res.status(423).json({ error: "Your Pay section is locked.", code: "PAY_LOCKED" });
  const { rows } = await pool.query("SELECT id, device_name AS name, created_at AS \"createdAt\", last_used_at AS \"lastUsedAt\" FROM pay_passkeys WHERE email=$1 ORDER BY id", [st.email]);
  res.json({ totp: st.totp, pin: st.pin, passkeys: rows });
}));

/* ----- authenticator app ----- */
// Starts the setup: a new secret, shown as a QR code and as text. Nothing counts until the person types a code from it.
paySecurityRouter.post("/totp/start", guard(async (req, res) => {
  const st = await stateOf(req);
  if (!mayEnrol(st)) return res.status(403).json({ error: "Please confirm it is you first.", code: "PAY_RECOVER_NEEDED" });
  const secret = newSecret();
  await pool.query(
    `INSERT INTO pay_totp (email, secret_enc, confirmed, last_step, failed_attempts, locked_until) VALUES ($1,$2,false,0,0,NULL)
     ON CONFLICT (email) DO UPDATE SET secret_enc = CASE WHEN pay_totp.confirmed THEN pay_totp.secret_enc ELSE $2 END WHERE NOT pay_totp.confirmed`, [st.email, seal(secret)]);
  const { rows: [row] } = await pool.query("SELECT secret_enc, confirmed FROM pay_totp WHERE email=$1", [st.email]);
  if (row.confirmed) return res.status(409).json({ error: "An authenticator app is already set up." });
  const shown = unseal(row.secret_enc);
  res.json({ secret: shown, uri: otpauthUrl(st.email, shown) });
}));
// Confirms the setup with the first code; this browser is then unlocked.
paySecurityRouter.post("/totp/confirm", guard(async (req, res) => {
  const st = await stateOf(req), code = String(body(req).code || "").trim();
  if (!mayEnrol(st)) return res.status(403).json({ error: "Please confirm it is you first.", code: "PAY_RECOVER_NEEDED" });
  const { rows: [row] } = await pool.query("SELECT secret_enc, confirmed FROM pay_totp WHERE email=$1", [st.email]);
  if (!row || row.confirmed) return res.status(409).json({ error: "Please start the authenticator setup again." });
  const step = checkTotp(unseal(row.secret_enc), code, 0);
  if (!step) return res.status(403).json({ error: "That code is not correct. Check the code in your authenticator app and try again." });
  await pool.query("UPDATE pay_totp SET confirmed=true, last_step=$2, failed_attempts=0, locked_until=NULL, updated_at=now() WHERE email=$1", [st.email, step]);
  await audit(st.email, "Pay authenticator app set up");
  await pool.query("UPDATE sessions SET pay_recover_until=NULL WHERE token_hash=$1", [st.key]);   // the proof of identity is used up
  if (!st.open) await openUnlock(st.key, true);
  res.json(publicState(await stateOf(req)));
}));
// Unlocks with a code from the authenticator app. A wrong one answers 403 (never 401: the app treats 401 as "signed out"); five lock checking for 15 minutes.
paySecurityRouter.post("/totp/unlock", guard(async (req, res) => {
  const email = req.user.email.toLowerCase(), key = sessionKeyOf(req), code = String(body(req).code || "").trim();
  const { rows: [row] } = await pool.query("SELECT secret_enc, last_step, locked_until FROM pay_totp WHERE email=$1 AND confirmed", [email]);
  if (!row) return res.status(409).json({ error: "The authenticator app is not set up.", code: "PAY_SETUP" });
  if (row.locked_until && new Date(row.locked_until) > new Date()) return res.status(429).json({ error: `Too many wrong codes. Please try again in ${minutesLeft(row.locked_until)} minute${minutesLeft(row.locked_until) === 1 ? "" : "s"}, or use another way.`, lockedOutMinutes: minutesLeft(row.locked_until) });
  const step = checkTotp(unseal(row.secret_enc), code, Number(row.last_step));
  if (step) {
    await pool.query("UPDATE pay_totp SET last_step=$2, failed_attempts=0, locked_until=NULL WHERE email=$1", [email, step]);
    await openUnlock(key, true);
    await audit(email, "Pay opened with the authenticator app");
    return res.json(publicState(await stateOf(req)));
  }
  const { rows: [n] } = await pool.query(
    `UPDATE pay_totp SET failed_attempts = failed_attempts + 1,
            locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + $3 * interval '1 minute' ELSE locked_until END,
            updated_at = now() WHERE email=$1 RETURNING failed_attempts`, [email, MAX_FAILS, LOCK_MINUTES]);
  const lockedNow = n.failed_attempts >= MAX_FAILS;
  await audit(email, lockedNow ? `Pay authenticator code entered wrongly ${n.failed_attempts} times: code checks locked for ${LOCK_MINUTES} minutes` : `Wrong Pay authenticator code entered (attempt ${n.failed_attempts} of ${MAX_FAILS})`);
  if (lockedNow) {   // the counter starts again once the lockout is over
    await pool.query("UPDATE pay_totp SET failed_attempts=0 WHERE email=$1", [email]);
    return res.status(429).json({ error: `Too many wrong codes. Please try again in ${LOCK_MINUTES} minutes, or use another way.`, lockedOutMinutes: LOCK_MINUTES });
  }
  res.status(403).json({ error: `That code is not correct. ${MAX_FAILS - n.failed_attempts} ${MAX_FAILS - n.failed_attempts === 1 ? "try" : "tries"} left.`, triesLeft: MAX_FAILS - n.failed_attempts });
}));

/* ----- PIN (for a device with no fingerprint reader) ----- */
// Sets the PIN (after proof of identity, or from an unlocked Pay, where it replaces the old one). This browser is then unlocked.
paySecurityRouter.post("/pin/set", guard(async (req, res) => {
  const { pin, confirm } = body(req), st = await stateOf(req);
  if (!mayEnrol(st)) return res.status(403).json({ error: "Please confirm it is you first.", code: "PAY_RECOVER_NEEDED" });
  if (pin !== confirm) return res.status(400).json({ error: "The two PINs do not match." });
  const bad = weakPin(pin); if (bad) return res.status(400).json({ error: bad });
  await pool.query(
    `INSERT INTO pay_pins (email, pin_hash) VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET pin_hash=$2, failed_attempts=0, locked_until=NULL, updated_at=now()`, [st.email, await hashPin(pin)]);
  await audit(st.email, st.pin ? "Pay PIN changed" : "Pay PIN created");
  await pool.query("UPDATE sessions SET pay_recover_until=NULL WHERE token_hash=$1", [st.key]);   // the proof of identity is used up
  if (!st.open) await openUnlock(st.key, true);
  res.status(st.pin ? 200 : 201).json(publicState(await stateOf(req)));
}));
// Unlocks with the PIN. A wrong one answers 403 (never 401: the app treats 401 as "signed out"); five lock checking for 15 minutes.
paySecurityRouter.post("/pin/unlock", guard(async (req, res) => {
  const pin = String(body(req).pin || ""), email = req.user.email.toLowerCase(), key = sessionKeyOf(req);
  const { rows: [row] } = await pool.query("SELECT pin_hash, locked_until FROM pay_pins WHERE email=$1", [email]);
  if (!row) return res.status(409).json({ error: "No PIN is set up.", code: "PAY_SETUP" });
  if (row.locked_until && new Date(row.locked_until) > new Date()) return res.status(429).json({ error: `Too many wrong PINs. Please try again in ${minutesLeft(row.locked_until)} minute${minutesLeft(row.locked_until) === 1 ? "" : "s"}, or use another way.`, pinLockedOutMinutes: minutesLeft(row.locked_until) });
  if (CODE.test(pin) && (await verifyPin(pin, row.pin_hash))) {
    await pool.query("UPDATE pay_pins SET failed_attempts=0, locked_until=NULL WHERE email=$1", [email]);
    await openUnlock(key, true);
    await audit(email, "Pay opened with the PIN");
    return res.json(publicState(await stateOf(req)));
  }
  const { rows: [n] } = await pool.query(
    `UPDATE pay_pins SET failed_attempts = failed_attempts + 1,
            locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + $3 * interval '1 minute' ELSE locked_until END,
            updated_at = now() WHERE email=$1 RETURNING failed_attempts`, [email, MAX_FAILS, LOCK_MINUTES]);
  const lockedNow = n.failed_attempts >= MAX_FAILS;
  await audit(email, lockedNow ? `Wrong Pay PIN entered ${n.failed_attempts} times: PIN checks locked for ${LOCK_MINUTES} minutes` : `Wrong Pay PIN entered (attempt ${n.failed_attempts} of ${MAX_FAILS})`);
  if (lockedNow) {   // the counter starts again once the lockout is over
    await pool.query("UPDATE pay_pins SET failed_attempts=0 WHERE email=$1", [email]);
    return res.status(429).json({ error: `Too many wrong PINs. Please try again in ${LOCK_MINUTES} minutes, or use another way.`, pinLockedOutMinutes: LOCK_MINUTES });
  }
  res.status(403).json({ error: `That PIN is not correct. ${MAX_FAILS - n.failed_attempts} ${MAX_FAILS - n.failed_attempts === 1 ? "try" : "tries"} left.`, triesLeft: MAX_FAILS - n.failed_attempts });
}));
// Removes the PIN (an unlocked Pay only), as long as another way in is left.
paySecurityRouter.delete("/pin", guard(async (req, res) => {
  const st = await stateOf(req);
  if (!st.open) return res.status(423).json({ error: "Your Pay section is locked.", code: "PAY_LOCKED" });
  if (!st.pin) return res.json({ removed: false });
  if (factorCount(st) <= 1) return res.status(409).json({ error: "Set up the authenticator app or a fingerprint first. Otherwise you would have no way into Pay." });
  await pool.query("DELETE FROM pay_pins WHERE email=$1", [st.email]);
  await audit(st.email, "Pay PIN removed");
  res.json({ removed: true });
}));

/* ----- fingerprint / Face ID (passkey) ----- */
paySecurityRouter.post("/passkey/register/options", guard(async (req, res) => {
  const st = await stateOf(req), origin = originOf(req);
  if (!mayEnrol(st)) return res.status(403).json({ error: "Please confirm it is you first.", code: "PAY_RECOVER_NEEDED" });
  if (!origin) return res.status(400).json({ error: "This web address cannot be used for fingerprint sign-in." });
  const { rows: have } = await pool.query("SELECT credential_id, transports FROM pay_passkeys WHERE email=$1", [st.email]);
  const options = await generateRegistrationOptions({
    rpName: PRODUCT, rpID: new URL(origin).hostname, userName: st.email, userDisplayName: st.email, userID: userIdOf(st.email), attestationType: "none",
    excludeCredentials: have.map((c) => ({ id: c.credential_id, transports: c.transports ? c.transports.split(",") : undefined })),
    authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
  });
  await saveChallenge(st.key, "register", options.challenge);
  res.json(options);
}));
paySecurityRouter.post("/passkey/register/verify", guard(async (req, res) => {
  const st = await stateOf(req), origin = originOf(req);
  if (!mayEnrol(st)) return res.status(403).json({ error: "Please confirm it is you first.", code: "PAY_RECOVER_NEEDED" });
  const challenge = await takeChallenge(st.key, "register");
  if (!origin || !challenge) return res.status(400).json({ error: "The fingerprint setup took too long. Please try again." });
  let info;
  try {
    info = await verifyRegistrationResponse({ response: body(req).response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: new URL(origin).hostname, requireUserVerification: true });
  } catch (e) { console.error("Passkey registration failed:", e.message); return res.status(400).json({ error: "The fingerprint could not be set up. Please try again." }); }
  if (!info.verified || !info.registrationInfo) return res.status(400).json({ error: "The fingerprint could not be set up. Please try again." });
  const c = info.registrationInfo.credential;
  const name = String(body(req).name || "").trim().slice(0, 60) || deviceName(req);
  await pool.query(
    "INSERT INTO pay_passkeys (email, credential_id, public_key, counter, transports, device_name) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (credential_id) DO NOTHING",
    [st.email, c.id, Buffer.from(c.publicKey).toString("base64url"), c.counter || 0, (c.transports || []).join(",") || null, name]);
  await audit(st.email, `Pay fingerprint added (${name})`);
  await pool.query("UPDATE sessions SET pay_recover_until=NULL WHERE token_hash=$1", [st.key]);   // the proof of identity is used up
  if (!st.open) await openUnlock(st.key, true);
  res.status(201).json(publicState(await stateOf(req)));
}));
paySecurityRouter.post("/passkey/auth/options", guard(async (req, res) => {
  const st = await stateOf(req), origin = originOf(req);
  if (!origin) return res.status(400).json({ error: "This web address cannot be used for fingerprint sign-in." });
  const { rows } = await pool.query("SELECT credential_id, transports FROM pay_passkeys WHERE email=$1", [st.email]);
  if (!rows.length) return res.status(409).json({ error: "No fingerprint is set up on your account.", code: "PAY_SETUP" });
  const options = await generateAuthenticationOptions({
    rpID: new URL(origin).hostname, userVerification: "required",
    allowCredentials: rows.map((c) => ({ id: c.credential_id, transports: c.transports ? c.transports.split(",") : undefined })),
  });
  await saveChallenge(st.key, "auth", options.challenge);
  res.json(options);
}));
paySecurityRouter.post("/passkey/auth/verify", guard(async (req, res) => {
  const st = await stateOf(req), origin = originOf(req), response = body(req).response;
  const challenge = await takeChallenge(st.key, "auth");
  if (!origin || !challenge || !response || !response.id) return res.status(400).json({ error: "The fingerprint check took too long. Please try again." });
  const { rows: [c] } = await pool.query("SELECT id, credential_id, public_key, counter, transports FROM pay_passkeys WHERE email=$1 AND credential_id=$2", [st.email, response.id]);
  if (!c) { await audit(st.email, "Pay fingerprint refused: not one of this person's"); return res.status(403).json({ error: "That fingerprint is not set up on your account." }); }
  let info;
  try {
    info = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: new URL(origin).hostname, requireUserVerification: true,
      credential: { id: c.credential_id, publicKey: new Uint8Array(Buffer.from(c.public_key, "base64url")), counter: Number(c.counter), transports: c.transports ? c.transports.split(",") : undefined },
    });
  } catch (e) { console.error("Passkey check failed:", e.message); await audit(st.email, "Pay fingerprint check failed"); return res.status(403).json({ error: "The fingerprint could not be checked. Please try again." }); }
  if (!info.verified) { await audit(st.email, "Pay fingerprint check failed"); return res.status(403).json({ error: "The fingerprint could not be checked. Please try again." }); }
  await pool.query("UPDATE pay_passkeys SET counter=$2, last_used_at=now() WHERE id=$1", [c.id, info.authenticationInfo.newCounter]);
  await openUnlock(st.key, true);
  await audit(st.email, "Pay opened with the fingerprint");
  res.json(publicState(await stateOf(req)));
}));
// Removes one fingerprint (an unlocked Pay only), as long as another way in is left.
paySecurityRouter.delete("/passkey/:id", guard(async (req, res) => {
  const st = await stateOf(req);
  if (!st.open) return res.status(423).json({ error: "Your Pay section is locked.", code: "PAY_LOCKED" });
  if (factorCount(st) <= 1) return res.status(409).json({ error: "Set up the authenticator app or a PIN first. Otherwise you would have no way into Pay." });
  const { rowCount } = await pool.query("DELETE FROM pay_passkeys WHERE id=$1 AND email=$2", [Number(req.params.id) || 0, st.email]);
  if (rowCount) await audit(st.email, "Pay fingerprint removed");
  res.json({ removed: rowCount === 1 });
}));

// The page calls this about every 25 seconds while the person is active. Without it the unlock runs out after the idle time.
paySecurityRouter.post("/touch", guard(async (req, res) => {
  const ok = await openUnlock(sessionKeyOf(req), false);
  if (!ok) return res.status(423).json({ error: "Your Pay section is locked.", code: "PAY_LOCKED" });
  res.json({ unlocked: true, idleSeconds: IDLE_SECONDS });
}));

// Locks Pay now: the Lock Pay button, leaving the Pay pages, the tab being hidden, or two idle minutes.
const REASONS = { manual: "Pay locked manually", navigated: "Pay locked after leaving the Pay section", hidden: "Pay locked when the browser tab was hidden", idle: "Pay locked automatically after inactivity" };
paySecurityRouter.post("/lock", guard(async (req, res) => {
  const why = REASONS[body(req).reason] ? body(req).reason : "manual";
  if (await closeUnlock(sessionKeyOf(req))) await audit(req.user.email.toLowerCase(), REASONS[why]);
  res.json({ unlocked: false });
}));

/* ----- proof of identity: the emailed code (the Google sign-in is the other way, in google-signin.js) ----- */
// A 6-digit code goes to the person's own work address. They never type the address, so it cannot be redirected.
paySecurityRouter.post("/recover/email/send", guard(async (req, res) => {
  const st = await stateOf(req);
  if (!mailConfigured() || mailSkipped().includes(st.email)) return res.status(409).json({ error: "We cannot email a code to your address. Please confirm with Google instead.", code: "PAY_NO_EMAIL" });
  const { rows: [o] } = await pool.query(
    `SELECT EXTRACT(EPOCH FROM (now() - sent_at))::int AS since, send_count, (window_start > now() - interval '1 hour') AS in_window FROM pay_pin_otps WHERE email=$1`, [st.email]);
  if (o && o.since < OTP_RESEND_SECONDS) return res.status(429).json({ error: `Please wait ${OTP_RESEND_SECONDS - o.since} seconds before asking for another code.`, waitSeconds: OTP_RESEND_SECONDS - o.since });
  if (o && o.in_window && o.send_count >= OTP_PER_HOUR) return res.status(429).json({ error: "Too many codes were requested. Please try again in an hour, or confirm with Google.", code: "PAY_OTP_LIMIT" });
  const code = newOtp();
  await pool.query(
    `INSERT INTO pay_pin_otps (email, code_hash, expires_at, attempts, sent_at, send_count, window_start)
     VALUES ($1,$2, now() + $3 * interval '1 minute', 0, now(), 1, now())
     ON CONFLICT (email) DO UPDATE SET code_hash=$2, expires_at=now() + $3 * interval '1 minute', attempts=0, sent_at=now(),
       send_count = CASE WHEN pay_pin_otps.window_start > now() - interval '1 hour' THEN pay_pin_otps.send_count + 1 ELSE 1 END,
       window_start = CASE WHEN pay_pin_otps.window_start > now() - interval '1 hour' THEN pay_pin_otps.window_start ELSE now() END`, [st.email, otpKey(st.email, code), OTP_MINUTES]);
  try {
    await sendMail({
      to: st.email, subject: `${code} is your ${PRODUCT} Pay security code`,
      text: `Your code to set up the security of your Pay section is ${code}.\n\nIt works for ${OTP_MINUTES} minutes and only once. If you did not ask for it, ignore this email and nothing changes. Never share this code with anyone.\n`,
      html: `<div style="font:15px/1.6 Arial,Helvetica,sans-serif;color:#2a1016;max-width:520px;border:1px solid #e9d9c3;padding:28px 32px">`
        + `<p style="margin:0 0 6px;font-weight:700;font-size:18px">Pay security code</p><div style="width:48px;height:3px;background:${MAROON};margin:0 0 18px"></div>`
        + `<p style="margin:0 0 10px">Use this code to set up the security of your Pay section:</p>`
        + `<p style="margin:0 0 14px;font:700 30px Menlo,Consolas,monospace;letter-spacing:8px">${code}</p>`
        + `<p style="margin:0 0 8px;color:#6b5654;font-size:13px">It works for ${OTP_MINUTES} minutes and only once. If you did not ask for it, ignore this email and nothing changes. Never share this code with anyone.</p></div>`,
    });
  } catch (e) {
    console.error("Pay security code email failed:", e.message);
    await pool.query("DELETE FROM pay_pin_otps WHERE email=$1", [st.email]);
    return res.status(502).json({ error: "The code could not be emailed right now. Please try again, or confirm with Google.", code: "PAY_NO_EMAIL" });
  }
  await audit(st.email, "Pay security code emailed");
  res.json({ sent: true, to: maskEmail(st.email), expiresMinutes: OTP_MINUTES, resendSeconds: OTP_RESEND_SECONDS });
}));
// The right code lets this browser session set up its security.
paySecurityRouter.post("/recover/email/verify", guard(async (req, res) => {
  const st = await stateOf(req), code = String(body(req).code || "").trim();
  const { rows: [o] } = await pool.query("SELECT code_hash, attempts, (expires_at > now()) AS live FROM pay_pin_otps WHERE email=$1", [st.email]);
  if (!o || !o.live || o.attempts >= OTP_TRIES) return res.status(400).json({ error: "That code has expired. Please ask for a new one.", code: "PAY_OTP_EXPIRED" });
  if (!CODE.test(code) || !sameKey(otpKey(st.email, code), o.code_hash)) {
    const { rows: [n] } = await pool.query("UPDATE pay_pin_otps SET attempts = attempts + 1 WHERE email=$1 RETURNING attempts", [st.email]);
    await audit(st.email, `Wrong Pay security code entered (attempt ${n.attempts} of ${OTP_TRIES})`);
    if (n.attempts >= OTP_TRIES) return res.status(400).json({ error: "Too many wrong codes. Please ask for a new one.", code: "PAY_OTP_EXPIRED" });
    return res.status(403).json({ error: `That code is not correct. ${OTP_TRIES - n.attempts} ${OTP_TRIES - n.attempts === 1 ? "try" : "tries"} left.` });
  }
  await pool.query("DELETE FROM pay_pin_otps WHERE email=$1", [st.email]);   // a code works once
  await allowFactorReset(st.key);
  await audit(st.email, "Pay security code confirmed");
  res.json(publicState(await stateOf(req)));
}));

/** After proof of identity (the emailed code, or a fresh Google sign-in as the signed-in person): this session may set up its security.
 *  Whatever was set up before (fingerprints, authenticator) is cleared, so a lost phone or laptop stops working, and every earlier unlock ends. */
export async function allowFactorReset(key) {
  const { rows: [s] } = await pool.query("UPDATE sessions SET pay_recover_until = now() + $2 * interval '1 minute' WHERE token_hash=$1 AND expires_at > now() RETURNING lower(email) AS email", [key, RECOVER_MINUTES]);
  if (!s) return false;
  await pool.query("DELETE FROM pay_passkeys WHERE email=$1", [s.email]);
  await pool.query("DELETE FROM pay_totp WHERE email=$1", [s.email]);
  await pool.query("DELETE FROM pay_pins WHERE email=$1", [s.email]);
  await pool.query("UPDATE sessions SET pay_unlocked_until=NULL, pay_unlocked_at=NULL WHERE lower(email)=$1", [s.email]);
  return true;
}
export { audit as auditPay };
