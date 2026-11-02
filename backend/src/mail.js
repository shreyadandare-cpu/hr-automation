import nodemailer from "nodemailer";

/* Outgoing email over SMTP. Settings are read when needed, so the .env file is already loaded.
   MAILTRAP_* or MAIL_* (Mailtrap's own names) win over the older SMTP_* names, so any of the three sets works. */
const env = (...names) => names.map((n) => process.env[n]).find(Boolean) || "";
export const smtpSettings = () => ({
  host: env("MAILTRAP_HOST", "MAIL_HOST", "SMTP_HOST"),
  port: Number(env("MAILTRAP_PORT", "MAIL_PORT", "SMTP_PORT") || 587),
  secure: process.env.SMTP_SECURE === "true",
  user: env("MAILTRAP_USER", "MAIL_USERNAME", "SMTP_USER"),
  pass: env("MAILTRAP_PASS", "MAIL_PASSWORD", "SMTP_PASS"),
});
export const mailConfigured = () => Boolean(smtpSettings().host);

/** The address people use to reach this app. Links in emails and the Google sign-in redirect are built from it. */
export const publicUrl = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");

/** The address of the web app. Invitation links are built from it (FRONTEND_URL, else PUBLIC_URL). */
export const frontendUrl = () => (process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/+$/, "") : publicUrl());

let transport;
const getTransport = () => {
  if (transport) return transport;
  const s = smtpSettings();
  return (transport = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: s.user ? { user: s.user, pass: s.pass } : undefined }));
};

/* Every email the app sends is automatic and can't be answered: replies go to the no-reply address (MAIL_REPLY_TO, else the
   sender), the headers mark it as automatic so out-of-office replies are not sent back, and each one says so at the end.
   For replies to bounce instead of piling up, send from a no-reply mailbox that refuses incoming mail (a Google Workspace setting). */
export const NO_REPLY_NOTE = "This is an automated email. Please do not reply to it.";
const noReplyHtml = `<p style="margin:18px 0 0;font:12px/1.5 Arial,Helvetica,sans-serif;color:#8a87a6">${NO_REPLY_NOTE}</p>`;

export async function sendMail({ to, subject, text, html }) {
  if (!mailConfigured()) throw new Error("Email is not set up");
  const from = process.env.MAIL_FROM || smtpSettings().user;
  await getTransport().sendMail({
    from, to, subject, replyTo: process.env.MAIL_REPLY_TO || from,
    headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" },
    text: text ? `${text.trimEnd()}\n\n--\n${NO_REPLY_NOTE}\n` : text,
    html: html ? (html.includes("</body>") ? html.replace("</body>", `${noReplyHtml}</body>`) : html + noReplyHtml) : html,
  });
}

/** A short message that proves email works: it goes through the same path as invites. */
export async function sendTestEmail(to, by) {
  const when = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  await sendMail({
    to,
    subject: "Test email from the HR Access Hub",
    text: `This is a test email from the HR Access Hub.\n\nIf you can read it, email sending works. Nothing else is needed.\n\nSent by ${by} on ${when}.\n`,
    html: `<div style="font:15px/1.6 Arial,Helvetica,sans-serif;color:#1c1b3a;max-width:520px;border:1px solid #d9d9ea;padding:28px 32px">`
      + `<p style="margin:0 0 6px;font-weight:700;font-size:18px">Test email</p><div style="width:48px;height:3px;background:#4254d4;margin:0 0 18px"></div>`
      + `<p style="margin:0 0 14px">This is a test email from the <b>HR Access Hub</b>.</p>`
      + `<p style="margin:0 0 14px">If you can read it, email sending works. Nothing else is needed.</p>`
      + `<p style="margin:0;color:#555177;font-size:13px">Sent by ${String(by).replace(/[<>&]/g, "")} on ${when}.</p></div>`,
  });
}

const clean = (v) => String(v).replace(/[<>&"]/g, "");

/** Sends the new work email address and its one-time password to the person's personal email. */
/** link: the one-time HR Access Hub activation link (invites.js): the person sets their password there. It works for `minutes`. */
export async function sendWorkAccountEmail({ to, name, workEmail, password, link, minutes }) {
  const url = link || publicUrl();
  const hub = link
    ? `Activate your HR Access Hub account (you choose its password and are signed in): ${url}\nThis link works once, for ${minutes} minutes. If it expires, ask HR for a new one.`
    : `The HR Access Hub is at ${url}.`;
  await sendMail({
    to,
    subject: "Your Wohlig work email account",
    text: `Hello ${name},\n\nYour Wohlig work email has been created.\n\nEmail: ${workEmail}\nPassword: ${password}\n\nThis password is only for you. Google will ask you to choose a new one when you first sign in at https://mail.google.com. Please do not share it.\n\n${hub}\n\nRegards,\nWOHLIG TRANSFORMATIONS PRIVATE LIMITED\n`,
    html: `<div style="font:15px/1.6 Arial,Helvetica,sans-serif;color:#1c1b3a;max-width:520px;border:1px solid #d9d9ea;padding:28px 32px">`
      + `<p style="margin:0 0 6px;font-weight:700;font-size:18px">Your work email account</p><div style="width:48px;height:3px;background:#4254d4;margin:0 0 18px"></div>`
      + `<p style="margin:0 0 14px">Hello ${clean(name)},</p><p style="margin:0 0 14px">Your Wohlig work email has been created.</p>`
      + `<table role="presentation" style="border-collapse:collapse;margin:0 0 14px"><tr><td style="padding:4px 14px 4px 0;color:#555177">Email</td><td><b>${clean(workEmail)}</b></td></tr>`
      + `<tr><td style="padding:4px 14px 4px 0;color:#555177">Password</td><td><b style="font-family:Menlo,Consolas,monospace">${clean(password)}</b></td></tr></table>`
      + `<p style="margin:0 0 14px">This password is only for you. Google will ask you to choose a new one when you first sign in. Please do not share it.</p>`
      + (link
        ? `<p style="margin:0 0 8px"><b>Activate your HR Access Hub account.</b> You choose its password and are signed in.</p>`
          + `<p style="margin:0 0 8px"><a href="${clean(url)}" style="display:inline-block;padding:11px 24px;background:#4254d4;color:#fff;text-decoration:none;font-weight:bold">Activate account</a></p>`
          + `<p style="margin:0 0 14px;color:#555177;font-size:13px">This link works once, for ${minutes} minutes. If it expires, ask HR for a new one.</p>`
        : `<p style="margin:0 0 14px">The HR Access Hub is at <a href="${clean(url)}" style="color:#4254d4">${clean(url)}</a>.</p>`)
      + `<p style="margin:0">Regards,<br>WOHLIG TRANSFORMATIONS PRIVATE LIMITED</p></div>`,
  });
}

export const maskEmail = (v) => {
  const [a, b] = String(v || "").split("@");
  return b ? `${a.slice(0, 2)}•••@${b}` : "";
};
