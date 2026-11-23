import { COMPANY_LEGAL, MAROON, PRODUCT, SIGN_OFF } from "./brand.js";
/* Outgoing email through the SendGrid Web API (HTTPS, no SMTP). Settings are read when needed, so the .env file is already loaded.
   Needs SENDGRID_API_KEY (Mail Send permission) and a MAIL_FROM address verified in SendGrid (Sender Authentication). */
const SENDGRID_URL = () => `https://api.${process.env.SENDGRID_EU === "true" ? "eu." : ""}sendgrid.com/v3/mail/send`;
export const mailConfigured = () => Boolean(process.env.SENDGRID_API_KEY);

/** The address people use to reach this app. Links in emails and the Google sign-in redirect are built from it. */
export const publicUrl = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");

/** The address of the web app. Invitation links are built from it (FRONTEND_URL, else PUBLIC_URL). */
export const frontendUrl = () => (process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/+$/, "") : publicUrl());

/** "Wohlig HR <info@wohlig.com>" -> { email, name }; a bare address -> { email }. */
const parseAddress = (v) => {
  const m = String(v || "").match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? (m[1] ? { email: m[2].trim(), name: m[1].trim() } : { email: m[2].trim() }) : { email: String(v || "").trim() };
};

/* Every email the app sends is automatic and can't be answered: replies go to the no-reply address (MAIL_REPLY_TO, else the
   sender), the headers mark it as automatic so out-of-office replies are not sent back, and each one says so at the end.
   For replies to bounce instead of piling up, send from a no-reply mailbox that refuses incoming mail (a Google Workspace setting). */
export const NO_REPLY_NOTE = "This is an automated email. Please do not reply to it.";
const noReplyHtml = `<p style="margin:18px 0 0;font:12px/1.5 Arial,Helvetica,sans-serif;color:#8a7a78">${NO_REPLY_NOTE}</p>`;

/* attachments: [{ content: Buffer, filename, type, cid? }]. With a cid the file is shown inline: <img src="cid:..."> in the html. */
/* Addresses the app sends no email to (the directors, for now). Their website access and the bell notifications are not affected.
   MAIL_SKIP_RECIPIENTS replaces the list, comma separated; leave it empty to email everyone again. It is checked here, in the one
   place every email goes through, so no feature (invitation, leave, celebration, festival) can mail these addresses by mistake. */
export const mailSkipped = () =>
  (process.env.MAIL_SKIP_RECIPIENTS ?? "chirag@wohlig.com,chintan@wohlig.com").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export async function sendMail({ to, subject, text, html, attachments = [] }) {
  if (mailSkipped().includes(String(to || "").trim().toLowerCase())) { console.log(`[email skipped: no email is sent to this address] subject="${subject}"`); return; }
  if (!mailConfigured()) throw new Error("Email is not set up");
  if (!process.env.MAIL_FROM) throw new Error("MAIL_FROM is not set");
  const from = parseAddress(process.env.MAIL_FROM);
  const body = text ? `${text.trimEnd()}\n\n--\n${NO_REPLY_NOTE}\n` : text;
  const page = html ? (html.includes("</body>") ? html.replace("</body>", `${noReplyHtml}</body>`) : html + noReplyHtml) : html;
  const content = [body && { type: "text/plain", value: body }, page && { type: "text/html", value: page }].filter(Boolean);
  const res = await fetch(SENDGRID_URL(), {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from, reply_to: parseAddress(process.env.MAIL_REPLY_TO || process.env.MAIL_FROM), subject, content,
      ...(attachments.length && { attachments: attachments.map((a) => ({ content: a.content.toString("base64"), type: a.type, filename: a.filename,
        disposition: a.cid ? "inline" : "attachment", ...(a.cid && { content_id: a.cid }) })) }),
      headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" },
    }),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null))?.errors?.map((e) => e.message).join("; ");
    throw new Error(`SendGrid ${res.status}${detail ? `: ${detail}` : ""}`);
  }
}

/** A short message that proves email works: it goes through the same path as invites. */
export async function sendTestEmail(to, by) {
  const when = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  await sendMail({
    to,
    subject: `Test email from ${PRODUCT}`,
    text: `This is a test email from ${PRODUCT}.\n\nIf you can read it, email sending works. Nothing else is needed.\n\nSent by ${by} on ${when}.\n`,
    html: `<div style="font:15px/1.6 Arial,Helvetica,sans-serif;color:#2a1016;max-width:520px;border:1px solid #e9d9c3;padding:28px 32px">`
      + `<p style="margin:0 0 6px;font-weight:700;font-size:18px">Test email</p><div style="width:48px;height:3px;background:${MAROON};margin:0 0 18px"></div>`
      + `<p style="margin:0 0 14px">This is a test email from <b>${PRODUCT}</b>.</p>`
      + `<p style="margin:0 0 14px">If you can read it, email sending works. Nothing else is needed.</p>`
      + `<p style="margin:0;color:#6b5654;font-size:13px">Sent by ${String(by).replace(/[<>&]/g, "")} on ${when}.</p></div>`,
  });
}

const clean = (v) => String(v).replace(/[<>&"]/g, "");

/** Sends the new work email address and its one-time password to the person's personal email. */
/** link: the one-time Wohlig One activation link (invites.js): the person sets their password there. It works for `minutes`. */
export async function sendWorkAccountEmail({ to, name, workEmail, password, link, minutes }) {
  const url = link || publicUrl();
  const hub = link
    ? `Activate your ${PRODUCT} account (you choose its password and are signed in): ${url}\nThis link works once, for ${minutes} minutes. If it expires, ask HR for a new one.`
    : `${PRODUCT} is at ${url}.`;
  await sendMail({
    to,
    subject: "Your Wohlig work email account",
    text: `Hello ${name},\n\nYour Wohlig work email has been created.\n\nEmail: ${workEmail}\nPassword: ${password}\n\nThis password is only for you. Google will ask you to choose a new one when you first sign in at https://mail.google.com. Please do not share it.\n\n${hub}\n\nRegards,\n${COMPANY_LEGAL.toUpperCase()}\n`,
    html: `<div style="font:15px/1.6 Arial,Helvetica,sans-serif;color:#2a1016;max-width:520px;border:1px solid #e9d9c3;padding:28px 32px">`
      + `<p style="margin:0 0 6px;font-weight:700;font-size:18px">Your work email account</p><div style="width:48px;height:3px;background:${MAROON};margin:0 0 18px"></div>`
      + `<p style="margin:0 0 14px">Hello ${clean(name)},</p><p style="margin:0 0 14px">Your Wohlig work email has been created.</p>`
      + `<table role="presentation" style="border-collapse:collapse;margin:0 0 14px"><tr><td style="padding:4px 14px 4px 0;color:#6b5654">Email</td><td><b>${clean(workEmail)}</b></td></tr>`
      + `<tr><td style="padding:4px 14px 4px 0;color:#6b5654">Password</td><td><b style="font-family:Menlo,Consolas,monospace">${clean(password)}</b></td></tr></table>`
      + `<p style="margin:0 0 14px">This password is only for you. Google will ask you to choose a new one when you first sign in. Please do not share it.</p>`
      + (link
        ? `<p style="margin:0 0 8px"><b>Activate your ${PRODUCT} account.</b> You choose its password and are signed in.</p>`
          + `<p style="margin:0 0 8px"><a href="${clean(url)}" style="display:inline-block;padding:11px 24px;background:${MAROON};color:#fff;text-decoration:none;font-weight:bold">Activate account</a></p>`
          + `<p style="margin:0 0 14px;color:#6b5654;font-size:13px">This link works once, for ${minutes} minutes. If it expires, ask HR for a new one.</p>`
        : `<p style="margin:0 0 14px">${PRODUCT} is at <a href="${clean(url)}" style="color:${MAROON}">${clean(url)}</a>.</p>`)
      + `<p style="margin:0">Regards,<br>${COMPANY_LEGAL.toUpperCase()}</p></div>`,
  });
}

export const maskEmail = (v) => {
  const [a, b] = String(v || "").split("@");
  return b ? `${a.slice(0, 2)}•••@${b}` : "";
};
