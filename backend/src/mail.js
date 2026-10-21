import nodemailer from "nodemailer";

/* Outgoing email over SMTP. Settings are read when needed, so the .env file is already loaded. */
export const mailConfigured = () => Boolean(process.env.SMTP_HOST);

/** The address people use to reach this app. Links in emails and the Google sign-in redirect are built from it. */
export const publicUrl = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");

let transport;
const getTransport = () => (transport ??= nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
}));

export async function sendMail({ to, subject, text, html }) {
  if (!mailConfigured()) throw new Error("Email is not set up");
  await getTransport().sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text, html });
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
export async function sendWorkAccountEmail({ to, name, workEmail, password }) {
  const url = publicUrl();
  await sendMail({
    to,
    subject: "Your Wohlig work email account",
    text: `Hello ${name},\n\nYour Wohlig work email has been created.\n\nEmail: ${workEmail}\nPassword: ${password}\n\nThis password is only for you. Google will ask you to choose a new one when you first sign in at https://mail.google.com. Please do not share it.\n\nThe HR Access Hub is at ${url}.\n\nRegards,\nWOHLIG TRANSFORMATIONS PRIVATE LIMITED\n`,
    html: `<div style="font:15px/1.6 Arial,Helvetica,sans-serif;color:#1c1b3a;max-width:520px;border:1px solid #d9d9ea;padding:28px 32px">`
      + `<p style="margin:0 0 6px;font-weight:700;font-size:18px">Your work email account</p><div style="width:48px;height:3px;background:#4254d4;margin:0 0 18px"></div>`
      + `<p style="margin:0 0 14px">Hello ${clean(name)},</p><p style="margin:0 0 14px">Your Wohlig work email has been created.</p>`
      + `<table role="presentation" style="border-collapse:collapse;margin:0 0 14px"><tr><td style="padding:4px 14px 4px 0;color:#555177">Email</td><td><b>${clean(workEmail)}</b></td></tr>`
      + `<tr><td style="padding:4px 14px 4px 0;color:#555177">Password</td><td><b style="font-family:Menlo,Consolas,monospace">${clean(password)}</b></td></tr></table>`
      + `<p style="margin:0 0 14px">This password is only for you. Google will ask you to choose a new one when you first sign in. Please do not share it.</p>`
      + `<p style="margin:0">Regards,<br>WOHLIG TRANSFORMATIONS PRIVATE LIMITED</p></div>`,
  });
}

export const maskEmail = (v) => {
  const [a, b] = String(v || "").split("@");
  return b ? `${a.slice(0, 2)}•••@${b}` : "";
};
