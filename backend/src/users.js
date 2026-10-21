import express from "express";
import { pool } from "./db.js";
import {
  verifyPassword, hashPassword, startSession, endSession, requireAuth, requireHr,
  getDefaultPassword, setDefaultPassword, createUser, lockedFor, noteFailure, clearFailures,
} from "./auth.js";
import { V, isCompanyEmail, COMPANY_EMAIL_MESSAGE } from "./validate.js";
import { sendInvite } from "./invites.js";
import { mailConfigured, sendTestEmail } from "./mail.js";
import { googleEnabled } from "./google-signin.js";

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const ROLES = ["hr", "employee"];

/* Public: sign in and out. */
export const sessionRouter = express.Router();

sessionRouter.post("/login", wrap(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (email && !isCompanyEmail(email)) return res.status(403).json({ error: COMPANY_EMAIL_MESSAGE.replace("have an account", "sign in") });
  const key = email || req.ip;
  const mins = lockedFor(key);
  if (mins) return res.status(429).json({ error: `Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` });
  const { rows } = await pool.query("SELECT * FROM users WHERE lower(email)=$1", [email]);
  const ok = await verifyPassword(password, rows[0]?.password_hash);
  if (!rows[0] || !ok) { noteFailure(key); return res.status(401).json({ error: "Wrong email or password." }); }
  clearFailures(key);
  await pool.query("UPDATE users SET last_login=now() WHERE lower(email)=$1", [email]);
  await startSession(res, rows[0].email);
  res.json({ ok: true });
}));

// What the sign-in page can offer.
sessionRouter.get("/login-options", (_req, res) => res.json({ google: googleEnabled() }));

sessionRouter.post("/logout", wrap(async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
}));

/* Signed in: who am I, change my password. */
export const accountRouter = express.Router();
accountRouter.use(requireAuth);

accountRouter.get("/me", wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT name FROM employees WHERE lower(work_email)=$1", [req.user.email.toLowerCase()]);
  res.json({ email: req.user.email, role: req.user.role, name: rows[0]?.name || req.user.email });
}));

accountRouter.post("/password", wrap(async (req, res) => {
  const { current = "", next = "" } = req.body || {};
  if (String(next).length < 8) return res.status(400).json({ error: "The new password must be at least 8 characters." });
  const { rows } = await pool.query("SELECT password_hash FROM users WHERE lower(email)=$1", [req.user.email.toLowerCase()]);
  if (!(await verifyPassword(String(current), rows[0].password_hash)))
    return res.status(400).json({ error: "The current password is wrong." });
  await pool.query("UPDATE users SET password_hash=$1 WHERE lower(email)=$2",
    [await hashPassword(String(next)), req.user.email.toLowerCase()]);
  res.json({ ok: true });
}));

/* HR only: manage logins. */
export const usersRouter = express.Router();
usersRouter.use(requireHr);

const toApi = (r) => ({ email: r.email, role: r.role, name: r.name || "", lastLogin: r.last_login, createdAt: r.created_at, inviteExpires: r.invite_expires });

usersRouter.get("/", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.*, e.name,
       (SELECT max(i.expires_at) FROM invites i WHERE lower(i.email)=lower(u.email) AND i.used_at IS NULL AND i.expires_at > now()) AS invite_expires
     FROM users u LEFT JOIN employees e ON lower(e.work_email)=lower(u.email) ORDER BY u.role, u.email`);
  const { rows: miss } = await pool.query(
    `SELECT count(*)::int AS n FROM employees e WHERE e.last_day IS NULL AND e.status <> 'offboarded'
     AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email)=lower(e.work_email))`);
  res.json({ users: rows.map(toApi), withoutAccount: miss[0].n, defaultPassword: await getDefaultPassword(), mailConfigured: mailConfigured() });
}));

usersRouter.post("/", wrap(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const role = req.body?.role;
  if (!V.email(email)) return res.status(400).json({ error: "Enter a valid email." });
  if (!isCompanyEmail(email)) return res.status(400).json({ error: COMPANY_EMAIL_MESSAGE });
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Pick a role." });
  if (!(await createUser(pool, email, role))) return res.status(409).json({ error: `${email} already has an account.` });
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Login created with the ${role === "hr" ? "HR (full rights)" : role} role by ${req.user.email}`, email]);
  // Optional: send them a one-time link that opens the app.
  const invite = req.body?.sendInvite === true ? await sendInvite(email, req.user.email) : null;
  res.status(201).json({ ok: true, defaultPassword: await getDefaultPassword(), invite });
}));

// One login for every current employee who does not have one yet.
usersRouter.post("/bulk", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT work_email FROM employees e WHERE e.last_day IS NULL AND e.status <> 'offboarded'
     AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email)=lower(e.work_email))`);
  let made = 0;
  for (const r of rows) if (isCompanyEmail(r.work_email) && await createUser(pool, r.work_email, "employee")) made++;
  res.json({ created: made });
}));

// Send a fresh invite link (the old one stops working).
usersRouter.post("/:email/invite", wrap(async (req, res) => {
  const email = req.params.email.toLowerCase();
  const u = (await pool.query("SELECT email FROM users WHERE lower(email)=$1", [email])).rows[0];
  if (!u) return res.status(404).json({ error: "No such account." });
  res.json({ invite: await sendInvite(u.email, req.user.email) });
}));

// Send one test message, to prove that email works before invites depend on it.
const lastTest = new Map();
usersRouter.post("/test-email", wrap(async (req, res) => {
  const to = String(req.body?.to || "").trim();
  if (!V.email(to)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!mailConfigured()) return res.status(503).json({ error: "Email isn't set up on the server yet. Add the SMTP settings to backend/.env and restart." });
  const now = Date.now(), prev = lastTest.get(req.user.email) || 0;
  if (now - prev < 5000) return res.status(429).json({ error: "Wait a few seconds before sending another test." });
  lastTest.set(req.user.email, now);
  try {
    await sendTestEmail(to, req.user.email);
  } catch (err) {
    console.error("Test email failed:", err.message);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Test email to ${to} failed`, to]);
    return res.status(502).json({ error: `The mail server refused it: ${String(err.message).slice(0, 200)}` });
  }
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Test email sent by ${req.user.email}`, to]);
  res.json({ ok: true, to });
}));

usersRouter.put("/default-password", wrap(async (req, res) => {
  const value = String(req.body?.value || "");
  if (value.length < 8) return res.status(400).json({ error: "The default password must be at least 8 characters." });
  await setDefaultPassword(value);
  res.json({ ok: true });
}));

usersRouter.post("/:email/reset", wrap(async (req, res) => {
  const email = req.params.email.toLowerCase();
  const hash = await hashPassword(await getDefaultPassword());
  const r = await pool.query("UPDATE users SET password_hash=$1 WHERE lower(email)=$2", [hash, email]);
  if (!r.rowCount) return res.status(404).json({ error: "No such account." });
  await pool.query("DELETE FROM sessions WHERE lower(email)=$1", [email]); // signs them out
  res.json({ ok: true });
}));

usersRouter.put("/:email/role", wrap(async (req, res) => {
  const email = req.params.email.toLowerCase();
  if (!ROLES.includes(req.body?.role)) return res.status(400).json({ error: "Pick a role." });
  if (req.body.role !== "hr") {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM users WHERE role='hr' AND lower(email)<>$1", [email]);
    if (!rows[0].n) return res.status(400).json({ error: "There must be at least one HR account." });
  }
  const r = await pool.query("UPDATE users SET role=$1 WHERE lower(email)=$2", [req.body.role, email]);
  if (!r.rowCount) return res.status(404).json({ error: "No such account." });
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Role changed to ${req.body.role === "hr" ? "HR (full rights)" : req.body.role} by ${req.user.email}`, email]);
  res.json({ ok: true });
}));

usersRouter.delete("/:email", wrap(async (req, res) => {
  const email = req.params.email.toLowerCase();
  if (email === req.user.email.toLowerCase()) return res.status(400).json({ error: "You cannot delete your own account." });
  const r = await pool.query("DELETE FROM users WHERE lower(email)=$1", [email]);
  await pool.query("DELETE FROM sessions WHERE lower(email)=$1", [email]);
  if (!r.rowCount) return res.status(404).json({ error: "No such account." });
  res.json({ ok: true });
}));
