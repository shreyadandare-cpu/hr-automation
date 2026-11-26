/*
 * Attendance reminders and missing punch-out penalties, as Keka handles them. Reminders go to the app (the bell), each once:
 *   - "Remember to punch out": HR's minutes before the shift ends (attendance_policy), when the last punch today is an IN;
 *   - "You are still punched in": the follow-up, 30 minutes after the person's shift ends, when they are still in;
 *   - "Your punch-out is missing": from 10 am, for each of the last 3 days that ended without a punch-out and has no
 *     correction asked for or approved, with a link that opens the correction form for that day.
 * No hours are ever made up for a missing punch-out (attendance.js); the person asks for a correction and their manager
 * approves it (engage.js), which adds the punch. Run by jobs.js every 10 minutes; nothing runs when BACKGROUND_JOBS=off.
 */
import { pool } from "./db.js";
import { monthsFor } from "./attendance.js";
import { addPenaltyLeave } from "./leave.js";
import { penalisedDays, policyOf } from "./missing-punch-rules.js";
import { notify } from "./notify.js";
import { shiftOn } from "./shift-rules.js";
import { shiftsFor } from "./shifts.js";

export const STILL_IN_AFTER_MIN = 30;   // minutes after the shift ends
export const MISSING_FROM = "10:00";    // the next morning's reminder goes out from this time
export const LOOK_BACK_DAYS = 3;

const mins = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** Whether a finished day's punches end without a punch-out. Office-machine days are read as first in, last out (as attendance.js
    does), so one punch is missing its out; app punches carry their direction, so a last IN is missing its out. */
export function missingOutOn(punches) {
  if (!punches.length) return false;
  if (punches.some((p) => p.source === "device")) return punches.length < 2;
  const last = [...punches].sort((a, b) => (a.time < b.time ? -1 : 1)).pop();
  return last.direction === "IN";
}

/**
 * Which reminders are due now. people: [{ email, punches: [{ date, time, direction, source }] }]; shiftEndOf(email, date) is the
 * shift's end ("18:30"); sent: Set of "email|date|kind"; corrected: Set of "email|date" with a pending or approved correction.
 * Returns [{ email, date, kind, shiftEnd }].
 */
export function dueReminders({ people, today, nowTime, shiftEndOf, sent, corrected, remindBeforeMin = 10 }) {
  const out = [], now = mins(nowTime);
  for (const p of people) {
    const on = (d) => p.punches.filter((x) => x.date === d);
    const todays = on(today).sort((a, b) => (a.time < b.time ? -1 : 1));
    const end = shiftEndOf(p.email, today);
    const stillIn = todays.length && todays[todays.length - 1].direction === "IN";
    if (stillIn && remindBeforeMin > 0 && now >= mins(end) - remindBeforeMin && now < mins(end) && !sent.has(`${p.email}|${today}|before-end`))
      out.push({ email: p.email, date: today, kind: "before-end", shiftEnd: end });
    if (todays.length && todays[todays.length - 1].direction === "IN" && now >= mins(end) + STILL_IN_AFTER_MIN && !sent.has(`${p.email}|${today}|still-in`))
      out.push({ email: p.email, date: today, kind: "still-in", shiftEnd: end });
    if (nowTime < MISSING_FROM) continue;
    for (let i = 1; i <= LOOK_BACK_DAYS; i++) {
      const d = addDays(today, -i);
      if (missingOutOn(on(d)) && !corrected.has(`${p.email}|${d}`) && !sent.has(`${p.email}|${d}|missing-out`))
        out.push({ email: p.email, date: d, kind: "missing-out" });
    }
  }
  return out;
}

const clock = (t) => { const [h, m] = String(t).split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
const dayName = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Finds the reminders due now and sends each once. Returns how many were sent. */
export async function runAttendanceReminders(db = pool) {
  const { rows: [now] } = await db.query("SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS d, to_char(now() AT TIME ZONE 'Asia/Kolkata','HH24:MI') AS t");
  const from = addDays(now.d, -LOOK_BACK_DAYS);
  const [ps, sentRows, reqRows, sh, pol] = await Promise.all([
    db.query(`SELECT lower(e.work_email) AS email, to_char(p.work_date,'YYYY-MM-DD') AS date, to_char(p.punch_time,'HH24:MI') AS time, p.direction, p.source
                FROM attendance_punches p JOIN employees e ON e.id = p.employee_id
               WHERE p.work_date BETWEEN $1 AND $2 AND e.status NOT IN ('offboarding','offboarded') ORDER BY p.work_date, p.punch_time LIMIT 20000`, [from, now.d]),
    db.query("SELECT lower(email) AS email, to_char(work_date,'YYYY-MM-DD') AS date, kind FROM attendance_reminders WHERE work_date BETWEEN $1 AND $2", [from, now.d]),
    db.query(`SELECT lower(email) AS email, to_char(on_date,'YYYY-MM-DD') AS date FROM attendance_requests
               WHERE kind='missed-punch' AND status IN ('pending','approved') AND deleted_at IS NULL AND on_date BETWEEN $1 AND $2`, [from, now.d]),
    shiftsFor(db, from, now.d),
    db.query("SELECT * FROM attendance_policy WHERE id=1"),
  ]);
  const byEmail = new Map();
  for (const r of ps.rows) { if (!byEmail.has(r.email)) byEmail.set(r.email, []); byEmail.get(r.email).push(r); }
  const due = dueReminders({
    people: [...byEmail].map(([email, punches]) => ({ email, punches })), today: now.d, nowTime: now.t,
    shiftEndOf: (email, date) => shiftOn(sh.of(email), sh.fallback, date).end,
    sent: new Set(sentRows.rows.map((x) => `${x.email}|${x.date}|${x.kind}`)), corrected: new Set(reqRows.rows.map((x) => `${x.email}|${x.date}`)),
    remindBeforeMin: policyOf(pol.rows[0]).remindBeforeMin,
  });
  let n = 0;
  for (const r of due) {
    // Claim it first, so two servers never send the same reminder.
    const { rowCount } = await db.query("INSERT INTO attendance_reminders (email, work_date, kind) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [r.email, r.date, r.kind]);
    if (!rowCount) continue;
    if (r.kind === "before-end") await notify(r.email, { title: "Remember to punch out", body: `Your shift ends at ${clock(r.shiftEnd)}. Please punch out when you leave.`, link: "/app/my-attendance" });
    else if (r.kind === "still-in") await notify(r.email, { title: "You are still punched in", body: `Your shift ended at ${clock(r.shiftEnd)}. Please punch out when you leave, so your day is counted.`, link: "/app/my-attendance" });
    else await notify(r.email, { title: "Your punch-out is missing", body: `${dayName(r.date)} has no punch-out, so no hours are counted for it yet. Please ask for a correction with the time you left.`, link: `/app/requests?new=missed-punch&date=${r.date}` });
    n += 1;
  }
  return n;
}

/**
 * Missing punch-out penalties (only when HR switched the penalty on). A day is judged once it is closed: older than HR's
 * correction window, with no correction waiting. In each month the first `freePerMonth` missing days are free; each one after
 * deducts `penaltyDays` as casual leave, or loss of pay when no casual leave is left (leave.js addPenaltyLeave). Days off are
 * never penalised. Each day is penalised once (attendance_penalties). Returns how many were applied.
 */
export async function runMissingPunchPenalties(db = pool, { emails = null } = {}) {   // emails: only these people (tests)
  const policy = policyOf((await db.query("SELECT * FROM attendance_policy WHERE id=1")).rows[0]);
  if (!policy.penaltyOn) return 0;
  const { rows: [now] } = await db.query("SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS d");
  const closedBefore = addDays(now.d, -policy.daysBack);   // days before this can no longer be corrected
  const months = [...new Set([addDays(now.d.slice(0, 7) + "-01", -1).slice(0, 7), now.d.slice(0, 7)])];
  const [waiting, done] = await Promise.all([
    db.query(`SELECT lower(email) AS email, to_char(on_date,'YYYY-MM-DD') AS d FROM attendance_requests
               WHERE kind='missed-punch' AND status='pending' AND deleted_at IS NULL AND on_date >= $1`, [months[0] + "-01"]),
    db.query("SELECT lower(email) AS email, to_char(work_date,'YYYY-MM-DD') AS d FROM attendance_penalties WHERE work_date >= $1", [months[0] + "-01"]),
  ]);
  const pending = new Set(waiting.rows.map((x) => `${x.email}|${x.d}`)), penalised = new Set(done.rows.map((x) => `${x.email}|${x.d}`));
  let n = 0;
  for (const month of months) {
    for (const { emp, days } of await monthsFor(month, emails)) {
      const email = emp.work_email.toLowerCase();
      // Every missing day of the month that is a working day and still missing counts towards the free ones, in date order;
      // a day waiting for a decision holds the count until it is decided.
      const missing = days.filter((d) => d.forgotOut && !d.off).map((d) => d.date);
      if (missing.some((d) => pending.has(`${email}|${d}`))) continue;
      for (const date of penalisedDays(missing, policy)) {
        if (date >= closedBefore || penalised.has(`${email}|${date}`)) continue;
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          const claim = await client.query("INSERT INTO attendance_penalties (email, work_date, days) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [email, date, policy.penaltyDays]);
          if (!claim.rowCount) { await client.query("ROLLBACK"); continue; }
          const leave = await addPenaltyLeave(client, email, date, policy.penaltyDays, `Penalty: punch-out missing on ${date}`);
          await client.query("UPDATE attendance_penalties SET leave_request_id=$3 WHERE email=$1 AND work_date=$2", [email, date, leave ? leave.id : null]);
          await client.query("COMMIT");
          n += 1;
          const amount = (d) => (d === 1 ? "1 day" : d === 0.5 ? "half a day" : `${d} days`);
          const paid = leave ? Number(leave.paidDays || 0) : 0, lop = leave ? Number(leave.lopDays || 0) : 0;
          const taken = [paid && `${amount(paid)} of casual leave`, lop && `${amount(lop)} as loss of pay${paid ? "" : " because no casual leave was left"}`].filter(Boolean).join(" and ");
          notify(email, { title: "Penalty for a missing punch-out", body: `${dayName(date)} had no punch-out and was not corrected, after the ${policy.freePerMonth} free missing punch-out${policy.freePerMonth === 1 ? "" : "s"} this month. ${taken ? `${taken[0].toUpperCase()}${taken.slice(1)} was deducted.` : ""}`, link: "/app/my-attendance" }).catch(() => {});
        } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
      }
    }
  }
  return n;
}
