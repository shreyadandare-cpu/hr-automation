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

export const maskEmail = (v) => {
  const [a, b] = String(v || "").split("@");
  return b ? `${a.slice(0, 2)}•••@${b}` : "";
};
