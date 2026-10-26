import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import express from "express";
import { pool } from "./db.js";
import { startSession, hashPassword } from "./auth.js";
import { isCompanyEmail } from "./validate.js";
import { mailConfigured, sendMail, frontendUrl, maskEmail } from "./mail.js";

const VALID_MINUTES = 30;   // an invite not accepted in this time is cancelled
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const REACT_PAGE = fileURLToPath(new URL("../../frontend/dist/login.html", import.meta.url));

/**
 * A new link for this account. Any older unused link for the same person is revoked. Only a hash of the token is stored.
 * Returns the full link, which goes into the email and nowhere else.
 */
export async function createInvite(email, createdBy) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query("UPDATE invites SET status='revoked' WHERE lower(email)=$1 AND status='pending'", [email.toLowerCase()]);
  await pool.query(
    "INSERT INTO invites (email, token_hash, created_by, expires_at) VALUES ($1,$2,$3, now() + $4 * interval '1 minute')",
    [email.toLowerCase(), sha(token), createdBy, VALID_MINUTES]);
  return `${frontendUrl()}/invite/${token}`;
}

/** Who to write to: the personal email on record (a new joiner may not use the work mailbox yet), else the work email. */
async function recipientFor(email) {
  const { rows } = await pool.query("SELECT name, personal_email FROM employees WHERE lower(work_email)=$1", [email.toLowerCase()]);
  const r = rows[0];
  return { to: (r && r.personal_email) || email, name: r?.name || "" };
}

const COMPANY = "Wohlig Transformations Private Limited";

/**
 * Marks invites nobody accepted in time as expired: the link stops working and the account stays, so HR can send a new
 * invite. (The backend also refuses an expired link on its own, whether or not this has run.) Runs every minute.
 */
export async function expireInvites() {
  const { rows } = await pool.query("UPDATE invites SET status='expired' WHERE status='pending' AND expires_at < now() RETURNING email");
  for (const r of rows) await audit(r.email, `Invite expired: not accepted within ${VALID_MINUTES} minutes`);
  return rows.length;
}

/**
 * The invitation email: a bordered card with an "Invitation" heading, a greeting, one button and a sign-off.
 * It uses tables and inline styles only, because email programs ignore most modern CSS.
 */
function inviteEmail({ name, link }) {
  const hello = `Hello ${name || "there"},`;
  const text = `${hello}\n\nYou have been invited to join the HR Automation Platform by your organization's administrator.\n\n`
    + `Click the link below to accept your invitation and activate your account.\n\nAccept Invitation: ${link}\n\n`
    + `This invitation link is valid for ${VALID_MINUTES} minutes from the time it was generated. If it expires, please contact your HR administrator to request a new invitation.\n\n`
    + `If you were not expecting this invitation, please contact your HR team.\n\nRegards,\nHR Administration Team\n`;
  const ink = "#1c1b3a", dim = "#555177", blue = "#4254d4";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f4f4fb">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">You have been invited to join the HR Automation Platform. The link is valid for ${VALID_MINUTES} minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4fb"><tr><td align="center" style="padding:28px 12px">
 <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #d9d9ea">
  <tr><td align="center" style="padding:36px 40px 8px;font:700 22px/1.3 Arial,Helvetica,sans-serif;color:${ink}">Invitation
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px"><tr><td style="width:56px;height:3px;background:${blue};font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>
  <tr><td style="padding:28px 44px 0;font:15px/1.65 Arial,Helvetica,sans-serif;color:${ink}">
    <p style="margin:0 0 18px">${escHtml(hello)}</p>
    <p style="margin:0 0 18px">You have been invited to join the <b>HR Automation Platform</b> by your organization's administrator.</p>
    <p style="margin:0 0 24px">Click the button below to accept your invitation and activate your account.</p></td></tr>
  <tr><td style="padding:0 44px 6px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${blue}" style="background:${blue}">
      <a href="${escHtml(link)}" style="display:inline-block;padding:14px 30px;font:bold 15px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none">Accept Invitation</a></td></tr></table></td></tr>
  <tr><td style="padding:24px 44px 0;font:13.5px/1.6 Arial,Helvetica,sans-serif;color:${dim}">
    <p style="margin:0 0 12px">This invitation link is valid for ${VALID_MINUTES} minutes from the time it was generated. If it expires, please contact your HR administrator to request a new invitation.</p>
    <p style="margin:0 0 12px">If you were not expecting this invitation, please contact your HR team.</p>
    <p style="margin:0;word-break:break-all">Button not working? Copy this link into your browser:<br><a href="${escHtml(link)}" style="color:${blue}">${escHtml(link)}</a></p></td></tr>
  <tr><td style="padding:26px 44px 38px;font:15px/1.6 Arial,Helvetica,sans-serif;color:${ink}">Regards,<br>HR Administration Team</td></tr>
 </table>
</td></tr></table></body></html>`;
  return { subject: "You're Invited to Join the HR Automation Platform", text, html };
}

const audit = (email, action) => pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]);

/**
 * Makes an invite link for the account and emails it. The link is never returned to the caller.
 * Returns { mode: "email" | "not-configured" | "failed", to }. HR can retry with a fresh invite when it was not sent.
 */
export async function sendInvite(email, createdBy) {
  const link = await createInvite(email, createdBy);
  const { to, name } = await recipientFor(email);
  if (!mailConfigured()) { await audit(email, "Invite not sent (email is not set up)"); return { mode: "not-configured", to: maskEmail(to) }; }
  try {
    await sendMail({ to, ...inviteEmail({ name, link }) });
    await audit(email, `Invite emailed to ${maskEmail(to)}`);
    return { mode: "email", to: maskEmail(to) };
  } catch (err) {
    console.error("Invite email failed:", err.message);
    await audit(email, "Invite email failed");
    return { mode: "failed", to: maskEmail(to), error: "The invitation email could not be sent. Try again." };
  }
}

/** Looks a link up without using it up. state: pending | used | expired | revoked | invalid. */
async function inviteState(token) {
  if (!isToken(token)) return { state: "invalid" };
  const { rows } = await pool.query(
    `SELECT i.email, i.status, i.expires_at > now() AS live, e.name FROM invites i
     LEFT JOIN employees e ON lower(e.work_email)=lower(i.email) WHERE i.token_hash=$1`, [sha(token)]);
  const r = rows[0];
  if (!r) return { state: "invalid" };
  if (r.status === "accepted") return { state: "used" };
  if (r.status === "revoked") return { state: "revoked" };
  if (r.status === "expired" || !r.live) return { state: "expired" };
  return { state: "pending", email: r.email, name: r.name };
}

const MESSAGES = {
  invalid: "This invitation link is not valid. Please ask HR for a new invitation.",
  used: "This invitation has already been used. Sign in with your email and password.",
  expired: `This invitation has expired (links last ${VALID_MINUTES} minutes). Please ask HR to send a new one.`,
  revoked: "A newer invitation was sent to you, so this link no longer works. Use the latest email.",
};

/** A small in-memory limit per key: max attempts in a time window. */
const hits = new Map();
export function tooMany(key, max, windowMs) {
  const now = Date.now(), h = (hits.get(key) || []).filter((t) => now - t < windowMs);
  h.push(now); hits.set(key, h);
  return h.length > max;
}

/**
 * Accepts an invitation: checks the token against its stored hash, its expiry (by the server clock) and that it is unused,
 * then sets the person's own password and marks the invitation accepted, all in one transaction.
 * Returns { ok: true, email } or { ok: false, status, error }.
 */
export async function acceptInvitation(token, password) {
  const pw = String(password || "");
  if (pw.length < 8) return { ok: false, status: 400, error: "Choose a password of at least 8 characters." };
  if (pw.length > 200) return { ok: false, status: 400, error: "That password is too long." };
  if (!isToken(token)) return { ok: false, status: 400, error: MESSAGES.invalid };
  const hash = await hashPassword(pw);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // One statement checks and uses the link, so two requests at once cannot both succeed.
    const { rows } = await client.query(
      "UPDATE invites SET used_at=now(), status='accepted' WHERE token_hash=$1 AND status='pending' AND expires_at > now() RETURNING email", [sha(token)]);
    const email = rows[0]?.email;
    if (!email || !isCompanyEmail(email)) { await client.query("ROLLBACK"); const { state } = await inviteState(token); return { ok: false, status: 400, error: MESSAGES[state] || MESSAGES.invalid }; }
    const u = await client.query("UPDATE users SET password_hash=$1, last_login=now() WHERE lower(email)=$2 RETURNING email", [hash, email.toLowerCase()]);
    if (!u.rowCount) { await client.query("ROLLBACK"); return { ok: false, status: 400, error: MESSAGES.invalid }; }
    await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", ["Invitation accepted: own password set", email]);
    await client.query("COMMIT");
    return { ok: true, email: u.rows[0].email };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }
}

/* The link in the email. Opening it only shows a button, and the button signs in. Mail scanners and link previews
   open links on their own, and they must not use up the one-time link. */
export const inviteRouter = express.Router();
inviteRouter.use((_req, res, next) => { res.set({ "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" }); next(); });

const isToken = (t) => /^[A-Za-z0-9_-]{43}$/.test(t);

inviteRouter.get("/:token", async (req, res, next) => {
  try {
    if (!isToken(req.params.token)) return res.redirect("/login?error=invite");
    // The React page (built into frontend/dist). It asks /invite/:token/info what to show and never uses the link up.
    if (!existsSync(REACT_PAGE)) return res.status(503).type("text").send("The interface has not been built yet. Run `npm run build:ui` in the backend folder.");
    res.sendFile(REACT_PAGE);
  } catch (e) { next(e); }
});

// State of the link and the first name for the welcome line. It reads the link but never uses it up.
inviteRouter.get("/:token/info", async (req, res, next) => {
  try {
    const s = await inviteState(req.params.token);
    if (s.state === "pending") return res.json({ state: "pending", firstName: (s.name || "").split(/\s+/)[0] || "there" });
    res.json({ state: s.state, message: MESSAGES[s.state] });
  } catch (e) { next(e); }
});
