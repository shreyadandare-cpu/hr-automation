import express from "express";
import { pool } from "./db.js";
import { mailConfigured, sendMail } from "./mail.js";

// Email goes out through SMTP when it is set up (see mail.js). Without it (local development) nothing is sent: the message is
// recorded in email_outbox as "skipped" and the app carries on. Failures are recorded too, never thrown.
export const emailMode = () => (mailConfigured() ? "smtp" : "off");

export async function sendEmail(to, subject, body) {
  if (!to) return;
  if (!mailConfigured()) {
    console.log(`[email skipped: SMTP not configured] to=${to} subject="${subject}"`);
    await pool.query("INSERT INTO email_outbox (recipient, subject, body, status) VALUES ($1,$2,$3,'skipped')", [to, subject, body]);
    return;
  }
  try {
    await sendMail({ to, subject, text: body });
    await pool.query("INSERT INTO email_outbox (recipient, subject, body, status) VALUES ($1,$2,$3,'sent')", [to, subject, body]);
  } catch (err) {
    console.error("Email failed:", err.message);
    await pool.query("INSERT INTO email_outbox (recipient, subject, body, status, error) VALUES ($1,$2,$3,'failed',$4)",
      [to, subject, body, String(err.message).slice(0, 500)]);
  }
}

export async function hrEmails() {
  const { rows } = await pool.query("SELECT email FROM users WHERE role='hr' ORDER BY email");
  return rows.map((r) => r.email);
}

/**
 * Tells people about something: an in-app notification for each recipient and, when email is given, an email.
 * to: one address, a list, or "hr" for every HR login. Never throws, so a notification problem can't undo the action.
 */
export async function notify(to, { title, body = "", link = null, email = null }) {
  try {
    const list = to === "hr" ? await hrEmails() : [].concat(to).filter(Boolean);
    for (const r of list) {
      await pool.query("INSERT INTO notifications (recipient, title, body, link) VALUES ($1,$2,$3,$4)", [r, title, body, link]);
      if (email) await sendEmail(r, email.subject || title, email.body || body);
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
  const { rows } = await pool.query(
    "SELECT id, title, body, link, created_at, read_at FROM notifications WHERE lower(recipient)=$1 ORDER BY id DESC LIMIT 30", [me]);
  const { rows: n } = await pool.query("SELECT count(*)::int AS n FROM notifications WHERE lower(recipient)=$1 AND read_at IS NULL", [me]);
  res.json({ unread: n[0].n, items: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, link: r.link, at: r.created_at, read: !!r.read_at })) });
}));
notificationsRouter.post("/read", wrap(async (req, res) => {
  const me = req.user.email.toLowerCase(), id = Number(req.body && req.body.id) || null;
  await pool.query(`UPDATE notifications SET read_at=now() WHERE lower(recipient)=$1 AND read_at IS NULL ${id ? "AND id=$2" : ""}`, id ? [me, id] : [me]);
  res.json({ ok: true });
}));
