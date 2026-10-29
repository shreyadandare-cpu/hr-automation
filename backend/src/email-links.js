import crypto from "node:crypto";
import express from "express";
import { pool } from "./db.js";
import { publicUrl } from "./mail.js";

/*
 * Links in automatic emails (leave, payslips, the onboarding work-account email) work for a short time only:
 * EMAIL_LINK_MINUTES, 30 by default. The email holds /l/<token>; opening it in time goes to the page (which still asks
 * the person to sign in). After that it shows "This link has expired" with a sign-in button.
 * Only a hash of the token is stored, so the database alone can't be used to open a link.
 * Invitation links have their own 30-minute rule in invites.js.
 */
export const linkMinutes = () => { const n = Number(process.env.EMAIL_LINK_MINUTES || 30); return Number.isFinite(n) && n > 0 ? n : 30; };
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** A link to `path` (inside this site) that works for linkMinutes(). */
export async function emailLink(path) {
  const target = String(path || "/").startsWith("/") ? String(path) : "/";
  const token = crypto.randomBytes(24).toString("base64url");
  await pool.query("DELETE FROM email_links WHERE expires_at < now() - interval '1 day'");   // tidy up old ones
  await pool.query("INSERT INTO email_links (token_hash, path, expires_at) VALUES ($1,$2, now() + $3 * interval '1 minute')", [sha(token), target, linkMinutes()]);
  return `${publicUrl()}/l/${token}`;
}

const page = (title, text) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="robots" content="noindex"></head>
<body style="margin:0;font:16px/1.6 Arial,Helvetica,sans-serif;color:#1c1b3a;background:#f4f4fb">
<div style="max-width:460px;margin:12vh auto 0;padding:32px 32px 28px;background:#fff;border:1px solid #d9d9ea">
<p style="margin:0 0 6px;font-weight:700;font-size:20px">${title}</p><div style="width:48px;height:3px;background:#4254d4;margin:0 0 18px"></div>
<p style="margin:0 0 22px">${text}</p>
<a href="/login" style="display:inline-block;padding:12px 26px;background:#4254d4;color:#fff;text-decoration:none;font-weight:bold">Sign in</a>
</div></body></html>`;

export const emailLinkRouter = express.Router();
emailLinkRouter.get("/:token", async (req, res, next) => {
  try {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    const t = String(req.params.token);
    const { rows: [l] } = /^[A-Za-z0-9_-]{32}$/.test(t)
      ? await pool.query("SELECT path, expires_at < now() AS expired FROM email_links WHERE token_hash=$1", [sha(t)]) : { rows: [] };
    if (l && !l.expired) return res.redirect(l.path);
    res.status(410).type("html").send(page("This link has expired",
      `Links in our emails work for ${linkMinutes()} minutes. Sign in to the HR Access Hub to see the latest details.`));
  } catch (e) { next(e); }
});
