import express from "express";
import L from "../../frontend/leave-rules.cjs";
import { pool } from "./db.js";
import { requireHr } from "./auth.js";
import { publicUrl } from "./mail.js";
import { sendEmail } from "./notify.js";
import { hrList } from "./leave-mail.js";

/*
 * Daily leave digest: one email to each HR person, every working morning, listing everyone on approved leave today,
 * so HR doesn't have to open the app to see who is away (like Keka's "Daily Email Digest").
 *
 *   When      LEAVE_DIGEST_HOUR (India time, default 9), Monday to Friday, not on company holidays.
 *   To        LEAVE_DIGEST_EMAILS (comma separated) when set, else the same HR list as leave emails (LEAVE_HR_EMAILS or every HR login).
 *   Empty     no email when nobody is on leave, unless LEAVE_DIGEST_SEND_EMPTY=true.
 *   Checked   every 10 minutes by the background jobs; the work is skipped once the day has been sent.
 *   Once      the day is claimed in `settings` before sending, so a restart or a second server never sends it twice.
 * Runs with the other background jobs (BACKGROUND_JOBS), so a local copy on the shared database doesn't send it.
 */
const KEY = "leave_digest_last_sent";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ist = (d = new Date()) => new Date(d.getTime() + 330 * 60000);   // India time, read with getUTC*
const istDay = (d) => ist(d).toISOString().slice(0, 10);
const short = (iso) => { const [, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]}`; };
const longDay = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} ${MON[m - 1]} ${y}`; };
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = (n) => String(n || "").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
const dd = (n) => `${Number(n)} day${Number(n) === 1 ? "" : "s"}`;
const sendEmpty = () => process.env.LEAVE_DIGEST_SEND_EMPTY === "true";
const digestHour = () => { const h = Number(process.env.LEAVE_DIGEST_HOUR ?? 9); return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 9; };

/** The next working day after `to` (when the person is back). */
function backOn(to, holidays) {
  let d = to;
  for (let i = 0; i < 40; i++) { d = next(d); if (!isOff(d, holidays)) return d; }
  return d;
}
const next = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10); };
const isOff = (iso, holidays) => L.isWeekend(iso) || holidays.has(iso);

/** Everyone on approved leave on `day`, plus requests for the day still waiting for approval. */
export async function digestFor(day) {
  const holidays = new Set((await pool.query("SELECT day FROM holidays")).rows.map((h) => h.day));
  const { rows } = await pool.query(
    `SELECT r.type, r.from_date, r.to_date, r.half, r.days, e.name, e.title, e.manager, e.work_email
     FROM leave_requests r JOIN employees e ON lower(e.work_email) = lower(r.work_email)
     WHERE r.status = 'approved' AND r.from_date <= $1 AND r.to_date >= $1 AND e.status <> 'offboarded'
     ORDER BY e.name, r.half NULLS FIRST`, [day]);
  const { rows: waiting } = await pool.query(
    `SELECT count(*)::int AS n FROM leave_requests r JOIN employees e ON lower(e.work_email) = lower(r.work_email)
     WHERE r.status = 'pending' AND r.from_date <= $1 AND r.to_date >= $1 AND e.status <> 'offboarded'`, [day]);
  // One line per person (a morning and an afternoon half on the same day become one line).
  const people = [];
  for (const r of rows) {
    const p = people.find((x) => x.email.toLowerCase() === r.work_email.toLowerCase());
    const leave = { type: (L.TYPES[r.type] || { name: r.type }).name, half: r.half ? L.HALVES[r.half] : null, from: r.from_date, to: r.to_date, days: Number(r.days) };
    if (p) p.leaves.push(leave);
    else people.push({ email: r.work_email, name: r.name, title: r.title && r.title !== "—" ? r.title : "", manager: r.manager || "", leaves: [leave], back: null });
  }
  for (const p of people) {
    const full = p.leaves.some((l) => !l.half);
    p.back = full ? backOn(p.leaves.reduce((m, l) => (l.to > m ? l.to : m), day), holidays) : day;
  }
  return { day, workingDay: !isOff(day, holidays), holiday: holidays.has(day), people, waiting: waiting[0].n };
}

const leaveText = (l) => `${l.type}${l.half ? ` (${l.half})` : ""}${l.half || l.from === l.to ? "" : `, ${short(l.from)} to ${short(l.to)} · ${dd(l.days)}`}`;

/** Subject, plain text and HTML for one day's digest. */
export function renderDigest(d) {
  const n = d.people.length, link = `${publicUrl()}/app/leave`;
  const subject = n ? `Daily leave digest · ${n} ${n === 1 ? "person" : "people"} on leave today (${short(d.day)})` : `Daily leave digest · everyone is in today (${short(d.day)})`;
  const text = [
    `DAILY LEAVE DIGEST · ${longDay(d.day).toUpperCase()}`, "",
    n ? `${n} ${n === 1 ? "person is" : "people are"} on leave today:` : "No one is on leave today.", "",
    ...d.people.map((p) => `• ${p.name}${p.title ? ` (${p.title})` : ""}: ${p.leaves.map(leaveText).join("; ")}${p.back !== d.day ? `. Back on ${short(p.back)}` : ""}`),
    ...(d.waiting ? ["", `${d.waiting} leave request${d.waiting === 1 ? "" : "s"} for today ${d.waiting === 1 ? "is" : "are"} still waiting for approval.`] : []),
    "", `Open Leave in the HR Access Hub: ${link}`,
    "", "Regards,", "HR Access Hub", "WOHLIG TRANSFORMATIONS PRIVATE LIMITED",
  ].join("\n");
  const row = (p) => `
    <tr><td style="padding:14px 0;border-top:1px solid #ececf6;vertical-align:top;width:56px">
      <div style="width:44px;height:44px;border-radius:50%;background:#eef0ff;color:#3242b2;font:600 15px/44px Arial,Helvetica,sans-serif;text-align:center">${esc(initials(p.name))}</div></td>
      <td style="padding:14px 0 14px 12px;border-top:1px solid #ececf6;vertical-align:top;font:14px/1.5 Arial,Helvetica,sans-serif;color:#1c1b3a">
        <div style="font-weight:700;font-size:15px">${esc(p.name)}</div>
        ${p.title ? `<div style="color:#7c7aa0;font-size:13px">${esc(p.title)}</div>` : ""}
        ${p.leaves.map((l) => `<div style="margin-top:4px"><span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${l.half ? "#fdf1dc" : "#eef0ff"};color:${l.half ? "#9a5a07" : "#3242b2"};font-size:12px;font-weight:700">${esc(l.type)}${l.half ? ` · ${esc(l.half)}` : ""}</span>
          <span style="color:#555177;font-size:13px">${l.half || l.from === l.to ? "Today only" : `${esc(short(l.from))} – ${esc(short(l.to))} · ${esc(dd(l.days))}`}</span></div>`).join("")}
      </td>
      <td style="padding:14px 0;border-top:1px solid #ececf6;vertical-align:top;text-align:right;font:13px/1.5 Arial,Helvetica,sans-serif;color:#555177;white-space:nowrap">
        ${p.back !== d.day ? `Back on<br><b style="color:#1c1b3a">${esc(short(p.back))}</b>` : `<b style="color:#9a5a07">Half day</b>`}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4fb;padding:24px 12px">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e3f1">
    <div style="background:#4254d4;padding:30px 32px">
      <div style="font:600 13px/1.4 Arial,Helvetica,sans-serif;letter-spacing:.18em;color:#dfe3ff">DAILY LEAVE DIGEST</div>
      <div style="font:600 20px/1.4 Arial,Helvetica,sans-serif;letter-spacing:.06em;color:#ffffff;margin-top:6px">${esc(longDay(d.day).toUpperCase())}</div>
    </div>
    <div style="padding:24px 32px 8px">
      <div style="font:700 26px/1.2 Arial,Helvetica,sans-serif;color:#1c1b3a">${n ? `${n} ${n === 1 ? "person" : "people"} on leave today` : "Everyone is in today"}</div>
      <div style="font:14px/1.5 Arial,Helvetica,sans-serif;color:#7c7aa0;margin-top:4px">${n ? "Approved leave covering today." : "No approved leave covers today."}</div>
      ${n ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:16px;border-collapse:collapse">${d.people.map(row).join("")}</table>` : ""}
      ${d.waiting ? `<div style="margin-top:12px;padding:12px 14px;border-radius:10px;background:#fdf1dc;font:13.5px/1.5 Arial,Helvetica,sans-serif;color:#7a4705">${d.waiting} leave request${d.waiting === 1 ? "" : "s"} for today ${d.waiting === 1 ? "is" : "are"} still waiting for approval.</div>` : ""}
      <div style="margin:22px 0 18px"><a href="${esc(link)}" style="display:inline-block;background:#4254d4;color:#ffffff;text-decoration:none;font:600 14px/1 Arial,Helvetica,sans-serif;padding:12px 20px;border-radius:999px">Open Leave in HR Access Hub</a></div>
    </div>
    <div style="padding:16px 32px 22px;border-top:1px solid #ececf6;font:12px/1.5 Arial,Helvetica,sans-serif;color:#8a87a6">HR Access Hub · WOHLIG TRANSFORMATIONS PRIVATE LIMITED</div>
  </div></body></html>`;
  return { subject, text, html };
}

const recipients = async () => {
  const set = (process.env.LEAVE_DIGEST_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return set.length ? set : hrList();
};

/** The scheduled run (every 10 minutes): sends today's digest once, at or after LEAVE_DIGEST_HOUR India time. */
export async function runLeaveDigest(now = new Date()) {
  if (ist(now).getUTCHours() < digestHour()) return { skipped: "too early" };
  const day = istDay(now);
  const { rows: last } = await pool.query("SELECT value FROM settings WHERE key=$1", [KEY]);
  if (last[0] && last[0].value >= day) return { skipped: "already sent" };
  const d = await digestFor(day);
  if (!d.workingDay) return { skipped: d.holiday ? "holiday" : "weekend" };
  // Claim the day first: only one run (on any server) gets past this line for a given date.
  const { rowCount } = await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value WHERE settings.value < EXCLUDED.value`, [KEY, day]);
  if (!rowCount) return { skipped: "already sent" };
  if (!d.people.length && !sendEmpty()) return { skipped: "nobody on leave" };
  const mail = renderDigest(d), to = await recipients();
  for (const r of to) await sendEmail(r, mail.subject, mail.text, mail.html);
  return { day, onLeave: d.people.length, sentTo: to.length };
}

/* HR can look at today's (or any day's) digest in the browser, or email it to themselves to check it. */
export function leaveDigestRouter(wrap) {
  const r = express.Router();
  r.use("/api/leave/digest", requireHr);
  const dayOf = (q) => (L.validDate(String(q || "")) ? String(q) : istDay());
  r.get("/api/leave/digest", wrap(async (req, res) => {
    const d = await digestFor(dayOf(req.query.date));
    res.json({ ...d, recipients: await recipients(), hour: digestHour(), sendEmpty: sendEmpty() });
  }));
  r.get("/api/leave/digest/preview", wrap(async (req, res) => {
    const { html } = renderDigest(await digestFor(dayOf(req.query.date)));
    res.set({ "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff" }).send(html);
  }));
  r.post("/api/leave/digest/send-me", wrap(async (req, res) => {
    const mail = renderDigest(await digestFor(dayOf(req.body && req.body.date)));
    await sendEmail(req.user.email, `[Test] ${mail.subject}`, mail.text, mail.html);
    res.json({ ok: true, to: req.user.email });
  }));
  return r;
}
