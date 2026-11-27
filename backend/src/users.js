import express from "express";
import { pool } from "./db.js";
import {
  verifyPassword, hashPassword, startSession, endSession, endOtherSessions, requireAuth,
  getDefaultPassword, setDefaultPassword, createUser, lockedFor, noteFailure, clearFailures,
} from "./auth.js";
import { V, isCompanyEmail, COMPANY_EMAIL_MESSAGE } from "./validate.js";
import { sendInvite, acceptInvitation, tooMany } from "./invites.js";
import { mailConfigured, sendTestEmail } from "./mail.js";
import { googleEnabled } from "./google-signin.js";
import { canAll, isSuper, mayActOnLogin, needAll, needSuper, syncRoleGrants } from "./access.js";
import { summary } from "./access-rules.js";

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
/** Email and password sign-in is for testing: it works only when ALLOW_PASSWORD_LOGIN=true. Google sign-in is the normal way in. */
const passwordLoginOn = () => String(process.env.ALLOW_PASSWORD_LOGIN || "").toLowerCase() === "true";
const ROLES = ["hr", "employee"];
/** The shared starting password matters only when password sign-in is on, and only super admins see it. */
const showDefault = (req) => passwordLoginOn() && isSuper(req);

/* Public: sign in and out. */
export const sessionRouter = express.Router();

sessionRouter.post("/login", wrap(async (req, res) => {
  if (!passwordLoginOn()) return res.status(403).json({ error: "Password sign-in is turned off. Use Continue with Google." });
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (email && !isCompanyEmail(email)) return res.status(403).json({ error: COMPANY_EMAIL_MESSAGE.replace("have an account", "sign in") });
  const key = email || req.ip;
  const mins = await lockedFor(key);
  if (mins) return res.status(429).json({ error: `Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` });
  const { rows } = await pool.query("SELECT * FROM users WHERE lower(email)=$1", [email]);
  const ok = await verifyPassword(password, rows[0]?.password_hash);
  if (!rows[0] || !ok) { await noteFailure(key); return res.status(401).json({ error: "Wrong email or password." }); }
  await clearFailures(key);
  // A removed login, or someone who is leaving or has left, gets a clear answer instead of a session that would not work.
  const gone = await pool.query("SELECT 1 FROM employees WHERE lower(work_email)=$1 AND status IN ('offboarding','offboarded')", [email]);
  if (rows[0].login_blocked || gone.rowCount) return res.status(403).json({ error: "This login can no longer be used. Please contact the HR team if you think this is a mistake." });
  await pool.query("UPDATE users SET last_login=now() WHERE lower(email)=$1", [email]);
  await startSession(res, rows[0].email);
  res.json({ ok: true });
}));

// The new employee opens the emailed link, picks a password and is signed in. Public, so it is rate limited.
sessionRouter.post("/auth/accept-invitation", wrap(async (req, res) => {
  if (await tooMany(`accept:${req.ip}`, 10, 15 * 60 * 1000)) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  const r = await acceptInvitation(String(req.body?.token || ""), req.body?.password);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  await startSession(res, r.email);
  res.json({ ok: true });
}));

// Someone with "Logins" sends a fresh invitation (the old link stops working). The answer never says whether an address has an account.
sessionRouter.post("/auth/resend-invitation", needAll("users.manage"), wrap(async (req, res) => {
  if (await tooMany(`resend:${req.user.email}`, 30, 60 * 60 * 1000)) return res.status(429).json({ error: "Too many invitations sent. Try again later." });
  const email = String(req.body?.email || "").trim().toLowerCase();
  let mode = "email";
  if (V.email(email) && isCompanyEmail(email)) {
    const u = (await pool.query("SELECT email FROM users WHERE lower(email)=$1", [email])).rows[0];
    if (u) mode = (await sendInvite(u.email, req.user.email)).mode;
  }
  if (mode === "skipped") return res.json({ ok: true, skipped: true, message: "No invitation email is sent to this person for now." });
  if (mode === "failed" || mode === "not-configured") return res.status(502).json({ error: "The invitation email could not be sent. Check the email settings and try again." });
  res.json({ ok: true, message: "If that account exists, a new invitation has been sent." });
}));

// What the sign-in page can offer.
sessionRouter.get("/login-options", (_req, res) => res.json({ google: googleEnabled(), password: passwordLoginOn() }));

sessionRouter.post("/logout", wrap(async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
}));

/* Signed in: who am I, change my password. */
export const accountRouter = express.Router();
accountRouter.use(requireAuth);

accountRouter.get("/me", wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT name FROM employees WHERE lower(work_email)=$1", [req.user.email.toLowerCase()]);
  // superAdmin and access (each permission held: "company" or the emails whose teams it covers) drive the menu and pages.
  res.json({ email: req.user.email, role: req.user.role, itAdmin: !!req.user.it_admin, payrollReviewer: ["payroll.approve", "payroll.bank", "payroll.view"].some((k) => k in summary(req.access)), financeViewer: canAll(req, "finance.view") || canAll(req, "payroll.approve"), name: rows[0]?.name || req.user.email,
    superAdmin: isSuper(req), access: summary(req.access), hidden: req.user.hidden || [] });
}));

accountRouter.post("/password", wrap(async (req, res) => {
  const { current = "", next = "" } = req.body || {};
  if (String(next).length < 8) return res.status(400).json({ error: "The new password must be at least 8 characters." });
  const { rows } = await pool.query("SELECT password_hash FROM users WHERE lower(email)=$1", [req.user.email.toLowerCase()]);
  if (!(await verifyPassword(String(current), rows[0].password_hash)))
    return res.status(400).json({ error: "The current password is wrong." });
  await pool.query("UPDATE users SET password_hash=$1 WHERE lower(email)=$2",
    [await hashPassword(String(next)), req.user.email.toLowerCase()]);
  await endOtherSessions(req, req.user.email);   // a new password signs out every other device
  res.json({ ok: true });
}));

/* "Logins" (users.manage, company-wide): manage logins. Giving the HR role or IT admin still widens what someone can do on
   pages not yet moved to permissions, so those two stay with super admins. */
export const usersRouter = express.Router();
usersRouter.use(needAll("users.manage"));

const toApi = (r) => ({ email: r.email, role: r.role, itAdmin: !!r.it_admin, superAdmin: !!r.is_super_admin, blocked: !!r.login_blocked, hidden: r.hidden_features || [], name: r.name || "", no: r.emp_no || "", title: r.title || "", lastLogin: r.last_login, createdAt: r.created_at, inviteExpires: r.invite_expires });

usersRouter.get("/", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.*, e.name, e.emp_no, e.title,
       (SELECT max(i.expires_at) FROM invites i WHERE lower(i.email)=lower(u.email) AND i.status='pending' AND i.expires_at > now()) AS invite_expires
     FROM users u LEFT JOIN employees e ON lower(e.work_email)=lower(u.email) ORDER BY u.role, u.email`);
  const { rows: miss } = await pool.query(
    `SELECT count(*)::int AS n FROM employees e WHERE e.last_day IS NULL AND e.status <> 'offboarded'
     AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email)=lower(e.work_email))`);
  // Everyone on the staff list who has no login yet, so the page can show the full list of people.
  const { rows: none } = await pool.query(
    `SELECT e.name, e.work_email AS email, e.emp_no, e.title FROM employees e WHERE e.status <> 'offboarded'
     AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email)=lower(e.work_email)) ORDER BY e.id`);
  res.json({ users: rows.map(toApi), noLogin: none.map((r) => ({ email: r.email, name: r.name, no: r.emp_no || "", title: r.title || "" })), withoutAccount: miss[0].n, defaultPassword: showDefault(_req) ? await getDefaultPassword() : "", mailConfigured: mailConfigured() });
}));

usersRouter.post("/", wrap(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const role = req.body?.role;
  if (!V.email(email)) return res.status(400).json({ error: "Enter a valid email." });
  if (!isCompanyEmail(email)) return res.status(400).json({ error: COMPANY_EMAIL_MESSAGE });
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Pick a role." });
  if (role === "hr" && !isSuper(req)) return res.status(403).json({ error: "Only a super admin can give the HR role." });
  if (!(await createUser(pool, email, role))) {
    // A login that was removed is blocked, not deleted: adding it again lets the person back in.
    // Checked before anything changes, so a refused caller never unblocks the login or changes its role, even for a moment.
    if (!(await mayActOnLogin(req, email))) {
      return res.status(403).json({ error: "This login has more access than yours, so a super admin must give it back." });
    }
    const back = await pool.query("UPDATE users SET login_blocked=false, role=$2 WHERE lower(email)=$1 AND login_blocked RETURNING email", [email, role]);
    if (!back.rowCount) return res.status(409).json({ error: `${email} already has an account.` });
    await syncRoleGrants(email, { hr: role === "hr" }, req.user.email);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Login given back with the ${role === "hr" ? "HR (full rights)" : role} role by ${req.user.email}`, email]);
    return res.status(201).json({ ok: true, defaultPassword: showDefault(req) ? await getDefaultPassword() : "", invite: null });
  }
  if (role === "hr") await syncRoleGrants(email, { hr: true }, req.user.email);
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Login created with the ${role === "hr" ? "HR (full rights)" : role} role by ${req.user.email}`, email]);
  // Optional: send them a one-time link that opens the app.
  const invite = req.body?.sendInvite === true ? await sendInvite(email, req.user.email) : null;
  res.status(201).json({ ok: true, defaultPassword: showDefault(req) ? await getDefaultPassword() : "", invite });
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
  if (!(await mayActOnLogin(req, email))) return res.status(403).json({ error: "This login has more access than yours, so only a super admin can send it a new sign-in link." });
  res.json({ invite: await sendInvite(u.email, req.user.email) });
}));

// Send one test message, to prove that email works before invites depend on it.
const lastTest = new Map();
usersRouter.post("/test-email", wrap(async (req, res) => {
  const to = String(req.body?.to || "").trim();
  if (!V.email(to)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!mailConfigured()) return res.status(503).json({ error: "Email isn't set up on the server yet. Add SENDGRID_API_KEY to backend/.env and restart." });
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

usersRouter.put("/default-password", needSuper, wrap(async (req, res) => {
  const value = String(req.body?.value || "");
  if (value.length < 8) return res.status(400).json({ error: "The default password must be at least 8 characters." });
  await setDefaultPassword(value);
  res.json({ ok: true });
}));

// A super admin decides who is an IT admin.
usersRouter.put("/:email/it-admin", needSuper, wrap(async (req, res) => {
  const email = req.params.email.toLowerCase(), on = req.body?.value === true;
  const r = await pool.query("UPDATE users SET it_admin=$1 WHERE lower(email)=$2", [on, email]);
  if (!r.rowCount) return res.status(404).json({ error: "No such account." });
  await syncRoleGrants(email, { itAdmin: on }, req.user.email);
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`${on ? "Made IT admin" : "IT admin removed"} by ${req.user.email}`, email]);
  res.json({ ok: true });
}));

// Hide articles, polls or surveys for one person (users.manage). The server refuses those pages for them and the menu drops them.
export const HIDEABLE = ["articles", "polls", "surveys"];
usersRouter.put("/:email/hidden", wrap(async (req, res) => {
  const email = req.params.email.toLowerCase();
  const features = [...new Set((Array.isArray(req.body?.features) ? req.body.features : []).filter((f) => HIDEABLE.includes(f)))];
  const r = await pool.query("UPDATE users SET hidden_features=$1 WHERE lower(email)=$2", [features, email]);
  if (!r.rowCount) return res.status(404).json({ error: "This person has no login yet, so there is nothing to hide." });
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Hidden pages set to ${features.join(", ") || "none"} by ${req.user.email}`, email]);
  res.json({ ok: true, hidden: features });
}));

// Disable or enable a login without deleting it (users.manage). A disabled login cannot sign in and is signed out everywhere.
usersRouter.put("/:email/disabled", wrap(async (req, res) => {
  const email = req.params.email.toLowerCase(), off = req.body?.value === true;
  if (off && email === req.user.email.toLowerCase()) return res.status(400).json({ error: "You cannot disable your own login." });
  const u = (await pool.query("SELECT is_super_admin, login_blocked FROM users WHERE lower(email)=$1", [email])).rows[0];
  if (!u) return res.status(404).json({ error: "No such account." });
  if (off && u.is_super_admin) return res.status(400).json({ error: "This person is a super admin. A super admin must remove that first on the Access page." });
  if (!(await mayActOnLogin(req, email))) return res.status(403).json({ error: "This login has more access than yours, so only a super admin can change it." });
  const r = await pool.query(
    `UPDATE users SET login_blocked=$2 WHERE lower(email)=$1
       AND (NOT $2 OR role <> 'hr' OR EXISTS (SELECT 1 FROM users o WHERE o.role='hr' AND NOT o.login_blocked AND lower(o.email)<>$1))`, [email, off]);
  if (!r.rowCount) return res.status(400).json({ error: "There must be at least one HR account." });
  if (off) await pool.query("DELETE FROM sessions WHERE lower(email)=$1", [email]);
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Login ${off ? "disabled" : "enabled"} by ${req.user.email}`, email]);
  res.json({ ok: true });
}));

usersRouter.post("/:email/reset", wrap(async (req, res) => {
  const email = req.params.email.toLowerCase();
  if (!(await mayActOnLogin(req, email))) return res.status(403).json({ error: "This login has more access than yours, so only a super admin can reset it." });
  const hash = await hashPassword(await getDefaultPassword());
  const r = await pool.query("UPDATE users SET password_hash=$1 WHERE lower(email)=$2", [hash, email]);
  if (!r.rowCount) return res.status(404).json({ error: "No such account." });
  await pool.query("DELETE FROM sessions WHERE lower(email)=$1", [email]); // signs them out
  res.json({ ok: true });
}));

usersRouter.put("/:email/role", needSuper, wrap(async (req, res) => {
  const email = req.params.email.toLowerCase();
  if (!ROLES.includes(req.body?.role)) return res.status(400).json({ error: "Pick a role." });
  // One guarded statement, so two HR users removing each other at the same moment cannot leave none.
  const r = await pool.query(
    `UPDATE users SET role=$1 WHERE lower(email)=$2
       AND ($1 = 'hr' OR EXISTS (SELECT 1 FROM users o WHERE o.role='hr' AND NOT o.login_blocked AND lower(o.email)<>$2))`, [req.body.role, email]);
  if (!r.rowCount) {
    const exists = (await pool.query("SELECT 1 FROM users WHERE lower(email)=$1", [email])).rowCount;
    return exists ? res.status(400).json({ error: "There must be at least one HR account." }) : res.status(404).json({ error: "No such account." });
  }
  await syncRoleGrants(email, { hr: req.body.role === "hr" }, req.user.email);
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Role changed to ${req.body.role === "hr" ? "HR (full rights)" : req.body.role} by ${req.user.email}`, email]);
  res.json({ ok: true });
}));

usersRouter.delete("/:email", wrap(async (req, res) => {
  const email = req.params.email.toLowerCase();
  if (email === req.user.email.toLowerCase()) return res.status(400).json({ error: "You cannot delete your own account." });
  const u = (await pool.query("SELECT is_super_admin FROM users WHERE lower(email)=$1", [email])).rows[0];
  if (!u) return res.status(404).json({ error: "No such account." });
  if (u.is_super_admin) return res.status(400).json({ error: "This person is a super admin. A super admin must remove that first on the Access page." });
  if (!(await mayActOnLogin(req, email))) return res.status(403).json({ error: "This login has more access than yours, so only a super admin can remove it." });
  // Removing a login blocks it rather than deleting it: otherwise their next Google sign-in would simply make a new one.
  const r = await pool.query(
    `UPDATE users SET login_blocked=true WHERE lower(email)=$1
       AND (role <> 'hr' OR EXISTS (SELECT 1 FROM users o WHERE o.role='hr' AND NOT o.login_blocked AND lower(o.email)<>$1))`, [email]);
  if (!r.rowCount) return res.status(400).json({ error: "There must be at least one HR account." });
  await pool.query("DELETE FROM sessions WHERE lower(email)=$1", [email]);
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Login removed (blocked) by ${req.user.email}`, email]);
  res.json({ ok: true });
}));
