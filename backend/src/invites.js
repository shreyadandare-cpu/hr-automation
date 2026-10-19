import crypto from "node:crypto";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import express from "express";
import { pool } from "./db.js";
import { startSession } from "./auth.js";
import { isCompanyEmail } from "./validate.js";
import { mailConfigured, sendMail, publicUrl, maskEmail } from "./mail.js";

const VALID_MINUTES = 30;   // an invite not accepted in this time is cancelled
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PAGE = fileURLToPath(new URL("../../frontend/public/invite.html", import.meta.url));

/** A new link for this account. Any older unused link for the same person stops working. Returns the full link. */
async function createInvite(email, createdBy) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query("DELETE FROM invites WHERE lower(email)=$1 AND used_at IS NULL", [email.toLowerCase()]);
  await pool.query(
    "INSERT INTO invites (email, token_hash, created_by, expires_at) VALUES ($1,$2,$3, now() + $4 * interval '1 minute')",
    [email.toLowerCase(), sha(token), createdBy, VALID_MINUTES]);
  return `${publicUrl()}/invite/${token}`;
}

/** Who to write to: the personal email on record (a new joiner may not use the work mailbox yet), else the work email. */
async function recipientFor(email) {
  const { rows } = await pool.query("SELECT name, personal_email FROM employees WHERE lower(work_email)=$1", [email.toLowerCase()]);
  const r = rows[0];
  return { to: (r && r.personal_email) || email, name: r?.name || "" };
}

const COMPANY = "Wohlig Transformations Private Limited";

/**
 * Cancels invites nobody accepted in time: the link stops working and the account stays, so HR can send a new invite.
 * Each cancelled invite is written to the audit log. Runs every minute.
 */
export async function expireInvites() {
  const { rows } = await pool.query("DELETE FROM invites WHERE used_at IS NULL AND expires_at < now() RETURNING email");
  for (const r of rows) await audit(r.email, `Invite cancelled: not accepted within ${VALID_MINUTES} minutes`);
  return rows.length;
}

/**
 * The invitation email: a bordered card with an "Invitation" heading, a greeting, one button and a sign-off.
 * It uses tables and inline styles only, because email programs ignore most modern CSS.
 */
function inviteEmail({ name, email, link }) {
  const hello = name || "Hello";
  const note = `The link works once and stops working after ${VALID_MINUTES} minutes. Your sign-in email is ${email}. `
    + `Next time, choose "Continue with Google" with your @wohlig.com account, or use the password HR gave you.`;
  const text = `${hello},\n\nYour account on the HR Access Hub is ready.\n\n`
    + `${COMPANY} has set you up. Open the app to check your profile, upload your documents and see your leave and your team.\n\n`
    + `Open the HR Access Hub: ${link}\n\n${note}\n\nRegards,\n${COMPANY}\n`;
  const ink = "#1c1b3a", dim = "#555177", blue = "#4254d4";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f4f4fb">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Your account on the HR Access Hub is ready. Open it with the button inside.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4fb"><tr><td align="center" style="padding:28px 12px">
 <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #d9d9ea">
  <tr><td align="center" style="padding:36px 40px 8px;font:700 22px/1.3 Arial,Helvetica,sans-serif;color:${ink}">Invitation
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px"><tr><td style="width:56px;height:3px;background:${blue};font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>
  <tr><td style="padding:28px 44px 0;font:15px/1.65 Arial,Helvetica,sans-serif;color:${ink}">
    <p style="margin:0 0 18px">${escHtml(hello)},</p>
    <p style="margin:0 0 18px"><b>Your account on the HR Access Hub is ready.</b></p>
    <p style="margin:0 0 24px">${escHtml(COMPANY)} has set you up. Open the app to check your profile, upload your documents and see your leave and your team.</p></td></tr>
  <tr><td style="padding:0 44px 6px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${blue}" style="background:${blue}">
      <a href="${escHtml(link)}" style="display:inline-block;padding:14px 30px;font:bold 15px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none">Open the HR Access Hub</a></td></tr></table></td></tr>
  <tr><td style="padding:24px 44px 0;font:13.5px/1.6 Arial,Helvetica,sans-serif;color:${dim}">
    <p style="margin:0 0 12px">${escHtml(note)}</p>
    <p style="margin:0;word-break:break-all">Button not working? Copy this link into your browser:<br><a href="${escHtml(link)}" style="color:${blue}">${escHtml(link)}</a></p></td></tr>
  <tr><td style="padding:26px 44px 38px;font:15px/1.6 Arial,Helvetica,sans-serif;color:${ink}">Regards,<br>${escHtml(COMPANY.toUpperCase())}</td></tr>
 </table>
</td></tr></table></body></html>`;
  return { subject: `Invitation to join the ${COMPANY} HR Access Hub`, text, html };
}

const audit = (email, action) => pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]);

/**
 * Makes an invite link for the account and emails it. Without a mail server, nothing is sent and the link comes back
 * so HR can pass it on. Returns { mode: "email" | "link", to, link? }.
 */
export async function sendInvite(email, createdBy) {
  const link = await createInvite(email, createdBy);
  const { to, name } = await recipientFor(email);
  if (!mailConfigured()) { await audit(email, "Invite link created (email is not set up)"); return { mode: "link", to: maskEmail(to), link }; }
  try {
    await sendMail({ to, ...inviteEmail({ name, email, link }) });
    await audit(email, `Invite emailed to ${maskEmail(to)}`);
    return { mode: "email", to: maskEmail(to) };
  } catch (err) {
    console.error("Invite email failed:", err.message);
    await audit(email, "Invite email failed");
    return { mode: "link", to: maskEmail(to), link, error: "The email could not be sent. Share the link yourself." };
  }
}

/* The link in the email. Opening it only shows a button, and the button signs in. Mail scanners and link previews
   open links on their own, and they must not use up the one-time link. */
export const inviteRouter = express.Router();
inviteRouter.use((_req, res, next) => { res.set({ "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" }); next(); });

const isToken = (t) => /^[A-Za-z0-9_-]{43}$/.test(t);

inviteRouter.get("/:token", async (req, res, next) => {
  try {
    if (!isToken(req.params.token)) return res.redirect("/login?error=invite");
    const { rows } = await pool.query(
      `SELECT i.email, e.name FROM invites i JOIN users u ON lower(u.email)=lower(i.email)
       LEFT JOIN employees e ON lower(e.work_email)=lower(i.email)
       WHERE i.token_hash=$1 AND i.used_at IS NULL AND i.expires_at > now()`, [sha(req.params.token)]);
    if (!rows[0] || !isCompanyEmail(rows[0].email)) return res.redirect("/login?error=invite");
    const first = (rows[0].name || "").split(/\s+/)[0] || "there";
    res.type("html").send((await fs.readFile(PAGE, "utf8")).replace("{{name}}", escHtml(first)));
  } catch (e) { next(e); }
});

inviteRouter.post("/:token", async (req, res, next) => {
  try {
    if (!isToken(req.params.token)) return res.redirect("/login?error=invite");
    // One statement checks and uses the link, so two clicks at once cannot both succeed.
    const { rows } = await pool.query(
      "UPDATE invites SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now() RETURNING email", [sha(req.params.token)]);
    if (!rows[0]) return res.redirect("/login?error=invite");
    const u = (await pool.query("SELECT email FROM users WHERE lower(email)=$1", [rows[0].email.toLowerCase()])).rows[0];
    if (!u || !isCompanyEmail(u.email)) return res.redirect("/login?error=invite");
    await pool.query("UPDATE users SET last_login=now() WHERE lower(email)=$1", [u.email.toLowerCase()]);
    await startSession(res, u.email);
    res.redirect("/");
  } catch (e) { next(e); }
});
