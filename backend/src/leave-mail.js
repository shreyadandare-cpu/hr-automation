import L from "../../frontend/leave-rules.cjs";
import { pool } from "./db.js";
import { hrEmails, notify } from "./notify.js";
import { emailLink, linkMinutes } from "./email-links.js";
import { DIRECTORS, approverOf, hrLeaveApprovers } from "./teams.js";

/*
 * Leave emails. Every leave and comp-off action tells the people involved: an in-app notification and an email.
 *
 *   Leave applied             approver (reporting manager, HR, or the directors for HR staff), with a link straight to a
 *                             page where they approve or decline it; + the employee, when HR applied on their behalf
 *   Approved                  employee + the colleagues they chose to notify + HR copy (HR hears about leave only here)
 *   Declined                  employee
 *   Cancelled                 approver
 *   Comp off asked for        approver + HR copy
 *   Comp off approved / declined, or recorded by HR     employee + HR copy
 *
 * HR copy: every HR login, or LEAVE_HR_EMAILS (comma separated) when set. Whoever did the action is not emailed about it.
 * Links work for EMAIL_LINK_MINUTES (30); the approver's link for LEAVE_APPROVAL_LINK_HOURS (72), since approvals often wait.
 * Each email has a plain text and an HTML version (the HTML one has a button for the link).
 * Without SMTP settings the emails are logged in email_outbox and skipped; the in-app notifications still arrive.
 *
 * WORDING: each email is one entry in TEMPLATES below. To use the company's predefined format, change only that entry.
 * Every template gets the same fields, listed in `fields()`.
 */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const daysText = (n) => `${n} day${Number(n) === 1 ? "" : "s"}`;

const sign = "\n\nRegards,\nHR Access Hub\nWOHLIG TRANSFORMATIONS PRIVATE LIMITED";
// "" is a blank line between paragraphs; null leaves a line out.
const lines = (...l) => l.filter((x) => x !== null && x !== undefined && x !== false).join("\n");

/* One entry per email. f = the fields from fields(). Returns { subject, body } (plain text). */
export const TEMPLATES = {
  // to the approver
  requested_approver: (f) => ({
    subject: `Leave request from ${f.name}: ${f.type}, ${f.dates}`,
    body: lines(`Hello ${f.toName},`, "", `${f.name} has applied for leave and it is waiting for your approval.`, "",
      `Type: ${f.type}`, `Dates: ${f.dates}`, `Days: ${f.days}`, `Reason: ${f.reason}`, f.byHr ? `Applied by: ${f.actorName} (HR) on their behalf` : null, "",
      `Approve or decline it here: ${f.link}`) + sign,
    button: "Review and approve",
  }),
  // copy to HR (not sent at the moment: HR is emailed only once the leave is approved)
  requested_hr: (f) => ({
    subject: `Leave applied: ${f.name}, ${f.type}, ${f.dates}`,
    body: lines("Hello HR,", "", `${f.name} has applied for leave.`, "",
      `Type: ${f.type}`, `Dates: ${f.dates}`, `Days: ${f.days}`, `Reason: ${f.reason}`, `Approver: ${f.approverName}`, f.byHr ? `Applied by: ${f.actorName} on their behalf` : null, "",
      `Details: ${f.link}`) + sign,
  }),
  // to the employee, when HR applied for them
  requested_employee: (f) => ({
    subject: `Leave applied for you: ${f.type}, ${f.dates}`,
    body: lines(`Hello ${f.name},`, "", `${f.actorName} (HR) has applied for leave on your behalf. It is waiting for ${f.approverName}'s approval.`, "",
      `Type: ${f.type}`, `Dates: ${f.dates}`, `Days: ${f.days}`, `Reason: ${f.reason}`, "", `See it here: ${f.link}`) + sign,
  }),
  // to the employee
  approved_employee: (f) => ({
    subject: `Your leave is approved: ${f.type}, ${f.dates}`,
    body: lines(`Hello ${f.name},`, "", `${f.actorName} has approved your leave.`, "",
      `Type: ${f.type}`, `Dates: ${f.dates}`, `Days: ${f.days}`, f.lopDays ? `Paid days: ${f.paidDays}` : null, f.lopDays ? `Loss of pay: ${f.lopDays} (deducted from salary)` : null, "",
      `See your leave here: ${f.link}`) + sign,
  }),
  declined_employee: (f) => ({
    subject: `Your leave is declined: ${f.type}, ${f.dates}`,
    body: lines(`Hello ${f.name},`, "", `${f.actorName} has declined your leave request.`, "",
      `Type: ${f.type}`, `Dates: ${f.dates}`, `Days: ${f.days}`, "", `Please speak to ${f.actorName} if you have questions. See your leave here: ${f.link}`) + sign,
  }),
  // copy to HR
  decided_hr: (f) => ({
    subject: `Leave ${f.decision}: ${f.name}, ${f.type}, ${f.dates}`,
    body: lines("Hello HR,", "", `${f.actorName} has ${f.decision} ${f.name}'s leave.`, "",
      `Type: ${f.type}`, `Dates: ${f.dates}`, `Days: ${f.days}`, f.lopDays ? `Loss of pay: ${f.lopDays}` : null, "", `Details: ${f.link}`) + sign,
  }),
  // to the colleagues the employee chose to notify
  approved_colleague: (f) => ({
    subject: `${f.name}'s ${f.type.toLowerCase()} is approved: ${f.dates}`,
    body: lines(`Hello ${f.toName},`, "", `${f.name}'s ${f.type.toLowerCase()} has been approved by ${f.actorName}. ${f.name} asked us to let you know.`, "",
      `Type: ${f.type}`, `Dates: ${f.dates}`, `Days: ${f.days}`, `Approved by: ${f.actorName}`) + sign,
    button: null,
  }),
  // to the approver, and a copy to HR
  cancelled: (f) => ({
    subject: `Leave request withdrawn: ${f.name}, ${f.type}, ${f.dates}`,
    body: lines(`Hello ${f.toName},`, "", `${f.name}'s leave request was withdrawn by ${f.actorName}. Nothing needs to be done.`, "",
      `Type: ${f.type}`, `Dates: ${f.dates}`, `Days: ${f.days}`) + sign,
  }),
  compoff_requested: (f) => ({
    subject: `Comp off request from ${f.name}: worked on ${f.dates}`,
    body: lines(`Hello ${f.toName},`, "", `${f.name} worked on ${f.dates} (a weekend or holiday) and is asking for a comp off.`, "",
      `Reason: ${f.reason}`, `Approver: ${f.approverName}`, "", `Approve or decline it here: ${f.link}`) + sign,
    button: "Review and approve",
  }),
  compoff_decided: (f) => ({
    subject: `Comp off ${f.decision}: ${f.name}, worked on ${f.dates}`,
    body: lines(`Hello ${f.toName},`, "", `${f.actorName} has ${f.decision} the comp off for ${f.name} for working on ${f.dates}.`,
      f.decision === "approved" ? "One extra day of leave has been added to the balance." : null, "", `Details: ${f.link}`) + sign,
  }),
};

async function nameOf(db, email) {
  if (!email) return "";
  const { rows } = await db.query("SELECT name FROM employees WHERE lower(work_email)=lower($1)", [email]);
  return rows[0] ? rows[0].name : email;
}

/** HR copies: LEAVE_HR_EMAILS when set, otherwise every HR login. */
export const hrList = async () => {
  const set = (process.env.LEAVE_HR_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return set.length ? set : (await hrEmails()).map((e) => e.toLowerCase());
};

/** Who decides this person's leave, as email addresses. */
async function approverEmails(email) {
  const a = await approverOf(pool, email);
  if (a === "hr") return { emails: await hrList(), name: "HR" };
  if (a === DIRECTORS) return { emails: hrLeaveApprovers(), name: "the directors" };
  return { emails: [a], name: await nameOf(pool, a) };
}

/** The fields every template can use. */
async function fields({ request, compOff, actor, decision }) {
  const x = request || compOff;
  const name = await nameOf(pool, x.email), approver = await approverEmails(x.email);
  return {
    name, email: x.email, actorName: await nameOf(pool, actor), approverName: approver.name, approverEmails: approver.emails,
    type: request ? L.TYPES[request.type].name : "Comp off",
    dates: request ? (request.half ? `${day(request.from)} (${L.HALVES[request.half]})` : request.from === request.to ? day(request.from) : `${day(request.from)} to ${day(request.to)}`) : day(compOff.workedOn),
    days: daysText(x.days), paidDays: request ? daysText(request.paidDays ?? x.days) : "", lopDays: request && request.lopDays ? daysText(request.lopDays) : "",
    reason: x.reason || "—", decision, byHr: !!(request && request.createdBy && request.createdBy !== x.email.toLowerCase()),
    notify: (request && request.notify) || [],
  };
}

export const approvalHours = () => { const n = Number(process.env.LEAVE_APPROVAL_LINK_HOURS || 72); return Number.isFinite(n) && n > 0 ? n : 72; };
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The HTML version of a template: the same text, the link clickable, and a button for it when the template names one. */
export function leaveHtml(t, url) {
  const text = esc(t.body).split(esc(url)).join(`<a href="${esc(url)}" style="color:#4254d4">${esc(url)}</a>`)
    .split("\n\n").map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`).join("");
  const button = t.button === null ? "" : `<p style="margin:6px 0 20px"><a href="${esc(url)}" style="display:inline-block;padding:12px 26px;background:#4254d4;color:#fff;text-decoration:none;font-weight:bold;border-radius:6px">${esc(t.button || "Open HR Access Hub")}</a></p>`;
  return `<!doctype html><html><body style="margin:0;background:#f4f4fb"><div style="max-width:560px;margin:0 auto;padding:28px 28px 20px;background:#fff;font:15px/1.6 Arial,Helvetica,sans-serif;color:#1c1b3a">${button}${text}</div></body></html>`;
}

/**
 * Sends one template to each address (deduplicated, never to the person who did it).
 * The approver's link opens the request itself (`review`); otherwise HR's opens Leave, a manager's Team leave, anyone else's My leave.
 */
async function send(to, key, f, actor, done, hr, { review = null, team = false } = {}) {
  for (const raw of to) {
    const r = String(raw || "").toLowerCase();
    if (!r || r === String(actor).toLowerCase() || done.has(r)) continue;
    done.add(r);
    const path = review || (hr.includes(r) ? "/app/leave" : team ? "/app/team-leave" : "/app/my-leave");
    const url = review ? await emailLink(path, approvalHours() * 60) : await emailLink(path);
    const t = TEMPLATES[key]({ ...f, toName: await nameOf(pool, r), link: `${url} (works for ${review ? `${approvalHours()} hours` : `${linkMinutes()} minutes`})` });
    await notify(r, { title: t.subject, link: path, email: { subject: t.subject, body: t.body, html: leaveHtml(t, url) } });
  }
}

/**
 * Tells everyone involved about a leave event. Never throws: a mail problem must not undo the leave action.
 * event: "requested" | "decided" | "cancelled" | "compoff_requested" | "compoff_decided"
 */
export async function tellLeave(event, { request, compOff, actor, decision }) {
  try {
    const f = await fields({ request, compOff, actor, decision });
    const done = new Set(), hr = await hrList();
    if (event === "requested") {
      await send(f.approverEmails, "requested_approver", f, actor, done, hr, { review: `/app/leave/review/${request.id}` });
      if (f.byHr) await send([f.email], "requested_employee", f, actor, done, hr);
    } else if (event === "decided") {
      await send([f.email], decision === "approved" ? "approved_employee" : "declined_employee", f, actor, done, hr);
      if (decision === "approved") {
        await send(f.notify, "approved_colleague", f, actor, done, hr);
        await send(hr, "decided_hr", f, actor, done, hr);
      }
    } else if (event === "cancelled") {
      await send(f.approverEmails, "cancelled", f, actor, done, hr, { team: true });
    } else if (event === "compoff_requested") {
      await send([...f.approverEmails, ...hr], "compoff_requested", f, actor, done, hr, { team: true });
    } else if (event === "compoff_decided") {
      await send([f.email, ...hr], "compoff_decided", f, actor, done, hr);
    }
  } catch (err) {
    console.error("Leave email failed:", err);
  }
}
