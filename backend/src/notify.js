import express from "express";
import { SALARY_PERMS, salaryOwners } from "./access-rules.js";
import { pool } from "./db.js";
import { mailConfigured, mailSkipped, sendMail } from "./mail.js";
export { mailSkipped };

// Email goes out through SendGrid when it is set up (see mail.js). Without it (local development) nothing is sent: the message is
// recorded in email_outbox as "skipped" and the app carries on. Failures are recorded too, never thrown.
export const emailMode = () => (mailConfigured() ? "sendgrid" : "off");

export async function sendEmail(to, subject, body, html = null) {   // html: optional rich version of body
  if (!to) return;
  if (mailSkipped().includes(String(to).trim().toLowerCase())) {
    await pool.query("INSERT INTO email_outbox (recipient, subject, body, status) VALUES ($1,$2,$3,'skipped')", [to, subject, body]);
    return;
  }
  if (!mailConfigured()) {
    console.log(`[email skipped: SendGrid not configured] to=${to} subject="${subject}"`);
    await pool.query("INSERT INTO email_outbox (recipient, subject, body, status) VALUES ($1,$2,$3,'skipped')", [to, subject, body]);
    return;
  }
  try {
    await sendMail({ to, subject, text: body, html: html || undefined });
    await pool.query("INSERT INTO email_outbox (recipient, subject, body, status) VALUES ($1,$2,$3,'sent')", [to, subject, body]);
  } catch (err) {
    console.error("Email failed:", err.message);
    await pool.query("INSERT INTO email_outbox (recipient, subject, body, status, error) VALUES ($1,$2,$3,'failed',$4)",
      [to, subject, body, String(err.message).slice(0, 500)]);
  }
}

/**
 * Who handles something: everyone holding `perm` for the whole company (access_grants; super admins only when ticked, so the
 * directors are not sent every notice), and still-active logins only. Without a permission, or when nobody holds it, the super admins.
 */
export async function hrEmails(perm = null) {
  // Salary notices go to the salary owners only, never to the super admins (access-rules.js).
  if (perm && SALARY_PERMS.has(perm)) {
    const { rows } = await pool.query("SELECT lower(email) AS email FROM users WHERE lower(email) = ANY($1) AND NOT login_blocked ORDER BY 1", [salaryOwners()]);
    return rows.map((r) => r.email);
  }
  if (perm) {
    const { rows } = await pool.query(
      `SELECT DISTINCT lower(g.email) AS email FROM access_grants g JOIN users u ON lower(u.email)=lower(g.email)
        WHERE g.permission=$1 AND g.scope='company' AND g.revoked_at IS NULL AND NOT u.login_blocked
          AND (g.expires_at IS NULL OR g.expires_at >= (now() AT TIME ZONE 'Asia/Kolkata')::date) ORDER BY 1`, [perm]);
    if (rows.length) return rows.map((r) => r.email);
  }
  const { rows } = await pool.query("SELECT email FROM users WHERE is_super_admin AND NOT login_blocked ORDER BY email");
  return rows.map((r) => r.email);
}

/**
 * Tells people about something: an in-app notification for each recipient and, when email is given, an email.
 * to: one address, a list, "perm:<permission>" for everyone who holds that permission company-wide (for example
 * "perm:expenses.approve"), or "hr" for the super admins. Never throws, so a notification problem can't undo the action.
 */
export async function notify(to, { title, body = "", link = null, email = null }) {
  try {
    const list = to === "hr" ? await hrEmails() : typeof to === "string" && to.startsWith("perm:") ? await hrEmails(to.slice(5)) : [].concat(to).filter(Boolean);
    for (const r of list) {
      await pool.query("INSERT INTO notifications (recipient, title, body, link) VALUES ($1,$2,$3,$4)", [r, title, body, link]);
      if (email) await sendEmail(r, email.subject || title, email.body || body, email.html || null);
    }
  } catch (err) {
    console.error("Notification failed:", err);
  }
}

// The bell: your latest notifications and how many are unread; mark one or all as read.
export const notificationsRouter = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
notificationsRouter.get("/", wrap(async (req, res) => {
  const me = req.user.email.toLowerCase();
  // Through an access key (the Wohlig One MCP) notices about pay are left out: their notes can carry what a salary owner wrote.
  const payNotices = req.access && req.access.viaKey ? " AND COALESCE(link,'') !~* '^/app/(payroll|payslips|reimbursements|loans|budgets|tax|my-finances|finance-reports|hr-requests)|^(claim|budget):|advance'" : "";
  const { rows } = await pool.query(
    `SELECT id, title, body, link, created_at, read_at FROM notifications WHERE lower(recipient)=$1${payNotices} ORDER BY id DESC LIMIT 30`, [me]);
  const { rows: n } = await pool.query("SELECT count(*)::int AS n FROM notifications WHERE lower(recipient)=$1 AND read_at IS NULL", [me]);
  res.json({ unread: n[0].n, items: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, link: r.link, at: r.created_at, read: !!r.read_at })) });
}));
notificationsRouter.post("/read", wrap(async (req, res) => {
  const me = req.user.email.toLowerCase(), id = Number(req.body && req.body.id) || null;
  await pool.query(`UPDATE notifications SET read_at=now() WHERE lower(recipient)=$1 AND read_at IS NULL ${id ? "AND id=$2" : ""}`, id ? [me, id] : [me]);
  res.json({ ok: true });
}));
