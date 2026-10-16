import express from "express";
import { pool } from "./db.js";
import {
  verifyPassword, hashPassword, startSession, endSession, requireAuth, requireHr,
  getDefaultPassword, setDefaultPassword, createUser, lockedFor, noteFailure, clearFailures,
} from "./auth.js";
import { V } from "./validate.js";

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const ROLES = ["hr", "employee"];

/* Public: sign in and out. */
export const sessionRouter = express.Router();

sessionRouter.post("/login", wrap(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
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

const toApi = (r) => ({ email: r.email, role: r.role, name: r.name || "", lastLogin: r.last_login, createdAt: r.created_at });

usersRouter.get("/", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.*, e.name FROM users u LEFT JOIN employees e ON lower(e.work_email)=lower(u.email) ORDER BY u.role, u.email`);
  const { rows: miss } = await pool.query(
    `SELECT count(*)::int AS n FROM employees e WHERE e.last_day IS NULL AND e.status <> 'offboarded'
     AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email)=lower(e.work_email))`);
  res.json({ users: rows.map(toApi), withoutAccount: miss[0].n, defaultPassword: await getDefaultPassword() });
}));

usersRouter.post("/", wrap(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const role = req.body?.role;
  if (!V.email(email)) return res.status(400).json({ error: "Enter a valid email." });
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Pick a role." });
  if (!(await createUser(pool, email, role))) return res.status(409).json({ error: `${email} already has an account.` });
  res.status(201).json({ ok: true, defaultPassword: await getDefaultPassword() });
}));

// One login for every current employee who does not have one yet.
usersRouter.post("/bulk", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT work_email FROM employees e WHERE e.last_day IS NULL AND e.status <> 'offboarded'
     AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email)=lower(e.work_email))`);
  let made = 0;
  for (const r of rows) if (await createUser(pool, r.work_email, "employee")) made++;
  res.json({ created: made });
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
