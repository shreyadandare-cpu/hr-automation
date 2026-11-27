import express from "express";
import L from "../../frontend/leave-rules.cjs";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { can, canAll, need, needAll, scopeOf } from "./access.js";
import { managerMap } from "./teams.js";
import { dayMarks, isWeeklyOff, minutesOf, shiftOn, statusFromMinutes } from "./shift-rules.js";
import { shiftsFor } from "./shifts.js";
import { checkPunch, farText, readPoint, readPolicy, readSite } from "./clockin-rules.js";
import { policyOf, readMissingPolicy } from "./missing-punch-rules.js";
import { NOW_SQL, byOrd, late, ord, ordSql } from "./work-day.js";

/* A reporting manager sees their own team (the people HR set under them); there is no separate manager login role. */
const teamEmails = async (email) => Object.entries(await managerMap(pool)).filter(([, rm]) => rm === email).map(([e]) => e);

/* Attendance: people punch in and out on the web page; "See attendance" (attendance.view) sees the people in scope and
   "Correct attendance" (attendance.edit) adds or removes their punches with a reason.
   Days are counted in Indian time, against each person's shift for the day (shift-rules.js; the default shift is 9:30 to 6:30
   with Saturday and Sunday off): a day is Present from the shift's full-day minutes (6 hours) and a Half day from its half-day
   minutes (3 hours); until the shift ends, today is "Working". Late arrival, early leaving and overtime are marked on each day. */
const IST = "Asia/Kolkata";
/** A finished day whose last punch is an IN (the person forgot to punch out). No hours are made up for it. */
export const MISSING_OUT = "Punch-out missing";
/** People who work from a place other than the office (a client site, another city) do not use the office machine, so no punches is not absent for them. */
const offSite = (loc) => !!loc && !/office/i.test(String(loc));
const hhmm = (t) => String(t).slice(0, 5);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
// The attendance day starts at 5 am (work-day.js): `day` is the working day, `time` the clock time and `min` the minutes from
// midnight of the working day (after midnight counts on: 01:00 is 1500).
const nowIst = async (db) => { const r = (await db.query(NOW_SQL)).rows[0]; return { ...r, min: ord(r.time) }; };
const audit = (db, action, email) => db.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]);

// A punch from the app may say where it was made (the nearest office, how far, outside every office).
const toPunch = (p) => ({ id: p.id, date: p.work_date, time: hhmm(p.punch_time), direction: p.direction, source: p.source, note: p.note,
  place: p.site_name || p.distance_m !== null && p.distance_m !== undefined ? { site: p.site_name || null, distance: p.distance_m, outside: !!p.outside } : null });

/** Minutes worked from a day's punches in time order: each IN pairs with the next OUT. An IN with no OUT counts to `until` (today) or nothing. */
function worked(punches, until) {
  let total = 0, open = null;
  for (const p of punches) {
    if (p.direction === "IN" && open === null) open = ord(p.time);
    else if (p.direction === "OUT" && open !== null) { total += Math.max(0, ord(p.time) - open); open = null; }
  }
  return { minutes: total + (open !== null && until !== null ? Math.max(0, until - open) : 0), missingOut: open !== null };
}

/** The office machine does not say IN or OUT, so the stored direction is only a guess made as punches arrive. For a finished day the people's habit
    is clearer: the first punch is the way in and the last punch is the way out. Hours are first to last. Punches in between (stepping out to eat,
    for example) are not counted as a break and do not reduce the hours. */
function deriveDay(ps) {
  const n = ps.length;
  const punches = ps.map((p, i) => ({ ...p, direction: i === 0 ? "IN" : i === n - 1 ? "OUT" : i % 2 === 1 ? "OUT" : "IN" }));
  return { punches, minutes: n < 2 ? 0 : Math.max(0, ord(ps[n - 1].time) - ord(ps[0].time)), missingOut: n < 2, missingSwipe: false };
}

/** One person's days for a month. Past days get a status; days before they joined and in the future get none. `shiftFor(date)` is the
    person's shift that day (the roster, or the default). */
function monthDays(month, punches, leave, holidays, emp, today, nowMin, shiftFor, corrections = new Map(), penalties = new Map()) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const hol = new Map(holidays.map((h) => [h.day, h.name]));
  const days = [];
  for (let d = 1; d <= last; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    let ps = punches.filter((p) => p.date === date).sort(byOrd);   // the small hours after the evening (work-day.js)
    // A finished day with punches from the office machine: work out in and out from the order of the punches (see deriveDay).
    const dd = date !== today && ps.some((p) => p.source === "device") ? deriveDay(ps) : null;
    if (dd) ps = dd.punches;
    const ins = ps.filter((p) => p.direction === "IN"), outs = ps.filter((p) => p.direction === "OUT");
    const shift = shiftFor(date), shiftEnd = minutesOf(shift.end);
    const w = dd ? { minutes: dd.minutes, missingOut: dd.missingOut } : worked(ps, date === today ? nowMin : null);
    // Forgot to punch out (as in Keka, a missing swipe): once the day is over, no hours are made up. The day shows
    // "Punch-out missing" and counts only the time between punches that were made, until the person asks for a correction
    // with the time they left and their manager approves it (the punch is then added; see engage.js).
    const forgot = date < today && ps.length > 0 && w.missingOut;
    const lv = leave.find((r) => r.from <= date && r.to >= date);
    const off = isWeeklyOff(shift, date) ? "Weekend" : hol.has(date) ? "Holiday" : null;
    let status = null;
    if (date > today || (emp.start && date < emp.start) || (emp.lastDay && date > emp.lastDay)) status = null;
    else if (ps.length) status = forgot ? MISSING_OUT : date === today && nowMin < shiftEnd ? "Working" : date === today && w.minutes < shift.halfDayMinutes ? "Working" : statusFromMinutes(shift, w.minutes);
    else if (lv) status = lv.half ? "Half day leave" : "On leave";
    else status = off || (offSite(emp.location) ? "Off-site" : "No punch");   // only an approved leave is shown as On leave; no punch and no leave is just No punch
    if (/^Present/.test(status || "") && off) status = "Worked on " + off.toLowerCase();
    const firstIn = ins[0] ? ins[0].time : ps.length ? ps[0].time : null, lastOut = outs.length ? outs[outs.length - 1].time : null;
    // Late, early and overtime on a working day; a forgotten punch out says nothing about leaving early or staying late.
    const marks = status ? dayMarks(shift, { firstIn, lastOut: forgot ? null : late(lastOut), minutes: forgot ? 0 : w.minutes, workingDay: !off, finished: date < today || (date === today && nowMin >= shiftEnd) }) : dayMarks(shift);
    days.push({ date, status, off, holiday: hol.get(date) || null, firstIn: ins[0] ? ins[0].time : null, lastOut,
      shift: { id: shift.id, name: shift.name, start: shift.start, end: shift.end, isDefault: !!shift.isDefault }, ...marks,
      minutes: w.minutes, missingOut: w.missingOut && date !== today && !forgot, forgotOut: forgot, correction: forgot ? corrections.get(date) || null : null, penalty: penalties.get(date) || null, missingSwipe: !!(dd && dd.missingSwipe), site: status === "Off-site" ? emp.location : null, punches: ps });
  }
  return days;
}
const summarize = (days) => {
  const c = (f) => days.filter(f).length;
  return { present: c((d) => /^(Present|Worked on)/.test(d.status || "")), half: c((d) => d.status === "Half day"), leave: c((d) => /leave$/i.test(d.status || "")),
    absent: 0, missingOut: c((d) => d.forgotOut), offsite: c((d) => d.status === "Off-site"), short: c((d) => d.status === "Short hours"), minutes: days.reduce((n, d) => n + d.minutes, 0),
    late: c((d) => d.late), early: c((d) => d.early), overtimeMinutes: days.reduce((n, d) => n + (d.overtimeMinutes || 0), 0) };
};

async function employeeByEmail(db, email) {
  return (await db.query("SELECT id, name, work_email, start_date, last_day, status, work_location FROM employees WHERE lower(work_email)=$1", [String(email || "").toLowerCase()])).rows[0] || null;
}
// First and last day of a YYYY-MM month (30-day months and February end on their real last day, never a day that does not exist).
const monthRange = (month) => {
  const [y, m] = month.split("-").map(Number);
  return [`${month}-01`, `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`];
};
async function monthOf(emp, month) {
  const [from, to] = monthRange(month);
  const [p, l, h, now, sh, cr, pen] = await Promise.all([
    pool.query(`SELECT id, to_char(work_date,'YYYY-MM-DD') AS work_date, punch_time, direction, source, note, site_name, distance_m, outside FROM attendance_punches
                WHERE employee_id=$1 AND work_date BETWEEN $2 AND $3 ORDER BY work_date, punch_time, id`, [emp.id, from, to]),
    pool.query(`SELECT to_char(from_date,'YYYY-MM-DD') AS f, to_char(to_date,'YYYY-MM-DD') AS t, half FROM leave_requests
                WHERE lower(work_email)=$1 AND status='approved' AND from_date<=$3 AND to_date>=$2`, [emp.work_email.toLowerCase(), from, to]),
    pool.query("SELECT to_char(day,'YYYY-MM-DD') AS day, name FROM holidays WHERE day BETWEEN $1 AND $2", [from, to]),
    nowIst(pool),
    shiftsFor(pool, from, to, [emp.work_email]),
    pool.query(`SELECT DISTINCT ON (on_date) to_char(on_date,'YYYY-MM-DD') AS d, status FROM attendance_requests
                WHERE lower(email)=$1 AND kind='missed-punch' AND deleted_at IS NULL AND on_date BETWEEN $2 AND $3 ORDER BY on_date, created_at DESC`, [emp.work_email.toLowerCase(), from, to]),
    pool.query("SELECT to_char(work_date,'YYYY-MM-DD') AS d, days FROM attendance_penalties WHERE lower(email)=$1 AND work_date BETWEEN $2 AND $3", [emp.work_email.toLowerCase(), from, to]),
  ]);
  const corrections = new Map(cr.rows.map((x) => [x.d, x.status]));
  const penalties = new Map(pen.rows.map((x) => [x.d, Number(x.days)]));
  const mine = sh.of(emp.work_email);
  const days = monthDays(month, p.rows.map(toPunch), l.rows.map((r) => ({ from: r.f, to: r.t, half: r.half })), h.rows,
    { start: emp.start_date && String(emp.start_date).slice(0, 10), lastDay: emp.last_day && String(emp.last_day).slice(0, 10), location: emp.work_location }, now.day, now.min,
    (date) => shiftOn(mine, sh.fallback, date), corrections, penalties);
  return { email: emp.work_email, name: emp.name, month, days, summary: summarize(days), today: now.day };
}

/** The days (before today, up to 14, never past HR's correction window) whose punch-out is missing and has no correction asked
    for or approved yet, newest first. A day that can no longer be corrected is not offered. */
async function missingOutsOf(emp, today) {
  const back = (n) => new Date(Date.parse(today + "T00:00:00Z") - n * 86400000).toISOString().slice(0, 10);
  const months = [...new Set([back(14).slice(0, 7), today.slice(0, 7)])];
  const [pol, ...ms] = await Promise.all([pool.query("SELECT * FROM attendance_policy WHERE id=1"), ...months.map((m) => monthOf(emp, m))]);
  const from = back(Math.min(14, policyOf(pol.rows[0]).daysBack));
  const days = ms.flatMap((x) => x.days);
  return days.filter((d) => d.forgotOut && d.date >= from && d.date < today && !["pending", "approved"].includes(d.correction))
    .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5).map((d) => ({ date: d.date, firstIn: d.firstIn }));
}

/** Everyone's month at once (or only `emails`): one query per kind of data, then matched in memory. Returns [{ emp, days, summary }]
    for the people employed in the month. Used by the monthly report and by overtime (shifts.js). */
export async function monthsFor(month, emails = null) {
  const [from, to] = monthRange(month);
  const list = emails ? emails.map((e) => String(e).toLowerCase()) : null;
  const [emps, ps, lv, hol, now, sh] = await Promise.all([
    pool.query(`SELECT id, emp_no, name, work_email, title, start_date, last_day, work_location FROM employees
                WHERE (status <> 'offboarded' OR last_day >= $1) AND (start_date IS NULL OR start_date <= $2) AND (last_day IS NULL OR last_day >= $1)
                ${list ? "AND lower(work_email) = ANY($3)" : ""}`, list ? [from, to, list] : [from, to]),
    pool.query(`SELECT p.employee_id, p.id, to_char(p.work_date,'YYYY-MM-DD') AS work_date, p.punch_time, p.direction, p.source, p.note, p.site_name, p.distance_m, p.outside FROM attendance_punches p
                ${list ? "JOIN employees e ON e.id = p.employee_id AND lower(e.work_email) = ANY($3)" : ""}
                WHERE p.work_date BETWEEN $1 AND $2 ORDER BY p.work_date, p.punch_time, p.id`, list ? [from, to, list] : [from, to]),
    pool.query(`SELECT lower(work_email) AS e, to_char(from_date,'YYYY-MM-DD') AS f, to_char(to_date,'YYYY-MM-DD') AS t, half FROM leave_requests
                WHERE status='approved' AND from_date<=$2 AND to_date>=$1 ${list ? "AND lower(work_email) = ANY($3)" : ""}`, list ? [from, to, list] : [from, to]),
    pool.query("SELECT to_char(day,'YYYY-MM-DD') AS day, name FROM holidays WHERE day BETWEEN $1 AND $2", [from, to]),
    nowIst(pool),
    shiftsFor(pool, from, to, list),
  ]);
  const punchesOf = new Map(), leaveOf = new Map();
  for (const p of ps.rows) { if (!punchesOf.has(p.employee_id)) punchesOf.set(p.employee_id, []); punchesOf.get(p.employee_id).push(toPunch(p)); }
  for (const x of lv.rows) { if (!leaveOf.has(x.e)) leaveOf.set(x.e, []); leaveOf.get(x.e).push({ from: x.f, to: x.t, half: x.half }); }
  return emps.rows.map((e) => {
    const mine = sh.of(e.work_email);
    const days = monthDays(month, punchesOf.get(e.id) || [], leaveOf.get(e.work_email.toLowerCase()) || [], hol.rows,
      { start: e.start_date && String(e.start_date).slice(0, 10), lastDay: e.last_day && String(e.last_day).slice(0, 10), location: e.work_location }, now.day, now.min,
      (date) => shiftOn(mine, sh.fallback, date));
    return { emp: e, days, summary: summarize(days) };
  });
}

/** Web clock-in: with WEB_CLOCK_IN=true everyone can punch in and out from the app. Off by default: the office machine
    records attendance, and only HR can punch from the app. Hours are counted the same way either way (each IN with the next OUT). */
export const webClockOn = () => String(process.env.WEB_CLOCK_IN || "").toLowerCase() === "true";
/** HR's clock-in settings (Shifts > Clock-in). Web punching is on when HR switched it on there, or WEB_CLOCK_IN=true. */
export async function clockPolicy(db = pool) {
  const { rows: [x] } = await db.query("SELECT enabled, need_location, allow_outside FROM clock_in_policy WHERE id=1");
  return { enabled: webClockOn() || !!(x && x.enabled), needLocation: !!(x && x.need_location), allowOutside: !!(x && x.allow_outside),
    fromEnv: webClockOn() };
}

export function attendanceRouter(wrap) {
  const r = express.Router();
  r.use("/api/attendance", requireAuth);
  const me = (req) => req.user.email.toLowerCase();

  // Today for the signed-in person: their punches and whether they are in or out right now.
  r.get("/api/attendance/today", wrap(async (req, res) => {
    const emp = await employeeByEmail(pool, me(req));
    if (!emp) return res.status(404).json({ error: "Your employee record was not found. Ask HR to check your work email." });
    const now = await nowIst(pool);
    const ps = (await pool.query(`SELECT id, to_char(work_date,'YYYY-MM-DD') AS work_date, punch_time, direction, source, note, site_name, distance_m, outside FROM attendance_punches
      WHERE employee_id=$1 AND work_date=$2 ORDER BY punch_time, id`, [emp.id, now.day])).rows.map(toPunch).sort(byOrd);
    const w = worked(ps, now.min);
    const [pol, missingOut] = await Promise.all([clockPolicy(), missingOutsOf(emp, now.day)]);
    res.json({ date: now.day, time: hhmm(now.time), punches: ps, state: ps.length && ps[ps.length - 1].direction === "IN" ? "in" : "out", minutes: w.minutes,
      canPunch: pol.enabled, needLocation: pol.enabled && pol.needLocation, missingOut });
  }));

  // Who is in right now, for the directory and the dashboard (everyone signed in may read it). People who work away from the
  // office (a client site, another city) are left out, because no punch is not "not in" for them; people on approved leave say so.
  r.get("/api/attendance/presence", wrap(async (_req, res) => {
    const now = await nowIst(pool);
    const { rows } = await pool.query(
      `SELECT lower(e.work_email) AS email, e.work_location,
              (SELECT p.direction FROM attendance_punches p WHERE p.employee_id=e.id AND p.work_date=$1 ORDER BY ${ordSql("p.punch_time")} DESC, p.id DESC LIMIT 1) AS last,
              (SELECT p.punch_time FROM attendance_punches p WHERE p.employee_id=e.id AND p.work_date=$1 AND p.direction='IN' ORDER BY ${ordSql("p.punch_time")}, p.id LIMIT 1) AS first_in,
              EXISTS (SELECT 1 FROM leave_requests l WHERE lower(l.work_email)=lower(e.work_email) AND l.status='approved' AND l.from_date<=$1 AND l.to_date>=$1) AS on_leave
         FROM employees e WHERE e.status NOT IN ('offboarding','offboarded') AND e.work_email IS NOT NULL LIMIT 500`, [now.day]);
    const out = {};
    for (const x of rows) {
      if (offSite(x.work_location)) continue;
      out[x.email] = x.last ? { state: x.last === "IN" ? "in" : "out", since: hhmm(x.first_in || "00:00") } : { state: x.on_leave ? "leave" : "notin" };
    }
    res.json({ date: now.day, people: out });
  }));

  // One tap: punches IN when you are out, OUT when you are in. The server's clock is used, never the browser's.
  r.post("/api/attendance/punch", wrap(async (req, res) => {
    const pol = await clockPolicy();
    if (!pol.enabled && !canAll(req, "attendance.edit")) return res.status(403).json({ error: "Attendance is recorded by the office machine. If a punch is missing, please ask HR to add it." });
    // Location: checked against HR's offices only when web clock-in is on (HR's own fix-up punches skip it). No selfie is ever asked for.
    const { point, error: pointError } = readPoint(req.body || {});
    if (pointError) return res.status(400).json({ error: pointError });
    let where = { siteId: null, distance: null, outside: false };
    if (pol.enabled) {
      const sites = (await pool.query("SELECT id, name, lat::float8 AS lat, lng::float8 AS lng, radius_m AS radius FROM clock_in_sites WHERE deleted_at IS NULL LIMIT 200")).rows;
      const check = checkPunch(pol, sites, point);
      if (!check.ok) return res.status(400).json({ error: check.error });
      where = { ...check, siteName: check.siteId ? sites.find((x) => x.id === check.siteId).name : null };
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const emp = (await client.query("SELECT id, name, work_email, status FROM employees WHERE lower(work_email)=$1 FOR UPDATE", [me(req)])).rows[0];
      if (!emp) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Your employee record was not found. Ask HR to check your work email." }); }
      if (emp.status === "offboarded") { await client.query("ROLLBACK"); return res.status(403).json({ error: "Your employment has ended, so you cannot punch." }); }
      const now = await nowIst(client);
      const last = (await client.query(
        `SELECT direction, punch_time FROM attendance_punches WHERE employee_id=$1 AND work_date=$2 ORDER BY ${ordSql("punch_time")} DESC, id DESC LIMIT 1`, [emp.id, now.day])).rows[0];
      if (last && now.min - ord(last.punch_time) < 1) { await client.query("ROLLBACK"); return res.status(429).json({ error: "You just punched. Wait a minute before punching again." }); }
      const direction = last && last.direction === "IN" ? "OUT" : "IN";
      await client.query(
        `INSERT INTO attendance_punches (employee_id, work_date, punch_time, direction, source, created_by, lat, lng, accuracy_m, site_name, distance_m, outside)
         VALUES ($1,$2,$3,$4,'web',$5,$6,$7,$8,$9,$10,$11)`,
        [emp.id, now.day, now.time, direction, me(req), point ? point.lat : null, point ? point.lng : null, point ? point.accuracy : null,
          where.siteName || null, where.distance, !!where.outside]);
      await client.query("COMMIT");
      res.json({ direction, time: hhmm(now.time), place: where.siteName ? { site: where.siteName, distance: where.distance, outside: !!where.outside } : null,
        note: where.outside ? `Recorded ${farText(where.distance)} from ${where.siteName}. HR can see this.` : "" });
    } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
  }));

  /* ---------- HR: clock-in settings and offices (shifts.manage for the whole company) ---------- */
  const settingsOut = async () => {
    const [pol, sites] = await Promise.all([clockPolicy(), pool.query(
      "SELECT id, name, lat::float8 AS lat, lng::float8 AS lng, radius_m AS radius FROM clock_in_sites WHERE deleted_at IS NULL ORDER BY name LIMIT 200")]);
    return { ...pol, sites: sites.rows };
  };
  r.get("/api/attendance/clock-in", needAll("shifts.manage"), wrap(async (_req, res) => res.json(await settingsOut())));
  r.put("/api/attendance/clock-in", needAll("shifts.manage"), wrap(async (req, res) => {
    const x = readPolicy(req.body);
    await pool.query(`INSERT INTO clock_in_policy (id, enabled, need_location, allow_outside, updated_by, updated_at) VALUES (1,$1,$2,$3,$4,now())
      ON CONFLICT (id) DO UPDATE SET enabled=$1, need_location=$2, allow_outside=$3, updated_by=$4, updated_at=now()`,
      [x.enabled, x.needLocation, x.allowOutside, me(req)]);
    await audit(pool, `Clock-in settings: ${x.enabled ? "on" : "off"}, location ${x.needLocation ? "needed" : "not needed"}`, me(req));
    res.json(await settingsOut());
  }));
  r.post("/api/attendance/clock-in/sites", needAll("shifts.manage"), wrap(async (req, res) => {
    const { value: v, errors } = readSite(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const { rows: [x] } = await pool.query("INSERT INTO clock_in_sites (name, lat, lng, radius_m, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id", [v.name, v.lat, v.lng, v.radius, me(req)]);
    res.status(201).json({ id: x.id });
  }));
  r.put("/api/attendance/clock-in/sites/:id", needAll("shifts.manage"), wrap(async (req, res) => {
    const { value: v, errors } = readSite(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const { rowCount } = await pool.query("UPDATE clock_in_sites SET name=$2, lat=$3, lng=$4, radius_m=$5 WHERE id=$1 AND deleted_at IS NULL", [Number(req.params.id) || 0, v.name, v.lat, v.lng, v.radius]);
    if (!rowCount) return res.status(404).json({ error: "This office was not found." });
    res.json({ ok: true });
  }));
  r.delete("/api/attendance/clock-in/sites/:id", needAll("shifts.manage"), wrap(async (req, res) => {
    const { rowCount } = await pool.query("UPDATE clock_in_sites SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL", [Number(req.params.id) || 0]);
    if (!rowCount) return res.status(404).json({ error: "This office was not found." });
    res.json({ ok: true });
  }));

  /* ---------- Missing punch-out policy (as Keka's): everyone reads it, HR (shifts.manage, whole company) sets it ---------- */
  r.get("/api/attendance/missing-policy", wrap(async (_req, res) => res.json(policyOf((await pool.query("SELECT * FROM attendance_policy WHERE id=1")).rows[0]))));
  r.put("/api/attendance/missing-policy", needAll("shifts.manage"), wrap(async (req, res) => {
    const { value: v, errors } = readMissingPolicy(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    // Switching the penalty on (from off) sets the day it starts: today, in Indian time. Days before it are never penalised.
    await pool.query(`INSERT INTO attendance_policy (id, penalty_on, free_per_month, penalty_days, self_fix_per_month, requests_per_month, days_back, remind_before_min, updated_by, updated_at, penalty_from)
      VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,now(), CASE WHEN $1 THEN (now() AT TIME ZONE 'Asia/Kolkata')::date END)
      ON CONFLICT (id) DO UPDATE SET penalty_on=$1, free_per_month=$2, penalty_days=$3, self_fix_per_month=$4,
      requests_per_month=$5, days_back=$6, remind_before_min=$7, updated_by=$8, updated_at=now(),
      penalty_from = CASE WHEN $1 AND NOT attendance_policy.penalty_on THEN (now() AT TIME ZONE 'Asia/Kolkata')::date WHEN $1 THEN attendance_policy.penalty_from END`,
      [v.penaltyOn, v.freePerMonth, v.penaltyDays, v.selfFixPerMonth, v.requestsPerMonth, v.daysBack, v.remindBeforeMin, me(req)]);
    await audit(pool, `Missing punch-out policy: penalty ${v.penaltyOn ? `on, ${v.penaltyDays} day after ${v.freePerMonth} free a month` : "off"}; ${v.selfFixPerMonth} self-fixes and ${v.requestsPerMonth} corrections a month, up to ${v.daysBack} days back; reminder ${v.remindBeforeMin} minutes before the shift ends`, me(req));
    res.json(policyOf((await pool.query("SELECT * FROM attendance_policy WHERE id=1")).rows[0]));
  }));

  // A month of days. Everyone reads their own; attendance.view the people in scope, and a manager their team, with ?email=.
  r.get("/api/attendance/month", wrap(async (req, res) => {
    const month = String(req.query.month || (await nowIst(pool)).day.slice(0, 7));
    if (!MONTH.test(month)) return res.status(400).json({ error: "Month must look like 2026-10." });
    const email = req.query.email ? String(req.query.email).toLowerCase() : me(req);
    if (email !== me(req) && !(await can(req, "attendance.view", email)) && !(await teamEmails(me(req))).includes(email))
      return res.status(403).json({ error: "You can only see your own attendance and your team's." });
    const emp = await employeeByEmail(pool, email);
    if (!emp) return res.status(404).json({ error: "Employee not found." });
    res.json(await monthOf(emp, month));
  }));

  // Everyone for one day: attendance.view sees the people in scope (all of them for the whole company), a reporting manager
  // sees their team as well, anyone else is refused.
  r.get("/api/attendance/day", wrap(async (req, res) => {
    const granted = await scopeOf(req, "attendance.view");
    const team = granted ? [...new Set([...granted, ...(await teamEmails(me(req)))])] : null;
    if (team && !team.length) return res.status(403).json({ error: "You do not have access to this. Only reporting managers and people given access can see it." });
    const now = await nowIst(pool);
    const date = String(req.query.date || now.day);
    if (!L.validDate(date)) return res.status(400).json({ error: "Date must look like 2026-10-21." });
    const [emps, ps, lv, hol, sh] = await Promise.all([
      pool.query("SELECT id, name, work_email, title, start_date, last_day, work_location FROM employees WHERE status <> 'offboarded' ORDER BY name"),
      pool.query(`SELECT employee_id, to_char(work_date,'YYYY-MM-DD') AS work_date, punch_time, direction, source, note, site_name, distance_m, outside, id FROM attendance_punches WHERE work_date=$1 ORDER BY punch_time, id`, [date]),
      pool.query("SELECT lower(work_email) AS e, half FROM leave_requests WHERE status='approved' AND from_date<=$1 AND to_date>=$1", [date]),
      pool.query("SELECT name FROM holidays WHERE day=$1", [date]),
      shiftsFor(pool, date, date),
    ]);
    const holidayOff = hol.rows[0] ? "Holiday" : null;
    const people = emps.rows.filter((e) => (!team || team.includes(e.work_email.toLowerCase())))
      .filter((e) => (!e.start_date || String(e.start_date).slice(0, 10) <= date) && (!e.last_day || String(e.last_day).slice(0, 10) >= date)).map((e) => {
      const shift = shiftOn(sh.of(e.work_email), sh.fallback, date), shiftEnd = minutesOf(shift.end);
      const off = isWeeklyOff(shift, date) ? "Weekend" : holidayOff;
      let mine = ps.rows.filter((p) => p.employee_id === e.id).map(toPunch).sort(byOrd);
      const dd = date !== now.day && mine.some((p) => p.source === "device") ? deriveDay(mine) : null;   // same in/out rule as a person's own month
      if (dd) mine = dd.punches;
      const w = dd ? { minutes: dd.minutes, missingOut: dd.missingOut } : worked(mine, date === now.day ? now.min : null), l = lv.rows.find((x) => x.e === e.work_email.toLowerCase());
      const forgot = date < now.day && mine.length > 0 && w.missingOut;   // forgot to punch out: no hours are made up (see monthDays)
      const ins = mine.filter((p) => p.direction === "IN"), outs = mine.filter((p) => p.direction === "OUT");
      let status;
      if (date > now.day) status = null;
      else if (mine.length) status = forgot ? MISSING_OUT : date === now.day && now.min < shiftEnd ? "Working" : date === now.day && w.minutes < shift.halfDayMinutes ? "Working" : statusFromMinutes(shift, w.minutes);
      else status = l ? (l.half ? "Half day leave" : "On leave") : off || (offSite(e.work_location) ? "Off-site" : "No punch");
      const firstIn = ins[0] ? ins[0].time : mine.length ? mine[0].time : null, lastOut = outs.length ? outs[outs.length - 1].time : null;
      const marks = status ? dayMarks(shift, { firstIn, lastOut: forgot ? null : late(lastOut), minutes: forgot ? 0 : w.minutes, workingDay: !off, finished: date < now.day || now.min >= shiftEnd }) : dayMarks(shift);
      return { no: e.emp_no || "", email: e.work_email, name: e.name, title: e.title, status, firstIn, lastOut, shift: { id: shift.id, name: shift.name, start: shift.start, end: shift.end, isDefault: !!shift.isDefault }, ...marks,
        lastPunch: mine.length ? mine[mine.length - 1].time : null, punchCount: mine.length,
        minutes: w.minutes, missingOut: w.missingOut && date !== now.day && !forgot, forgotOut: forgot, in: mine.length > 0 && mine[mine.length - 1].direction === "IN" };
    });
    res.json({ date, today: now.day, off: L.isWeekend(date) ? "Weekend" : holidayOff, holiday: hol.rows[0] ? hol.rows[0].name : null, people });
  }));

  // One month for everyone, one row per person (attendance.edit for the whole company). ?format=csv downloads it as a spreadsheet file.
  r.get("/api/attendance/report", needAll("attendance.edit"), wrap(async (req, res) => {
    const now = await nowIst(pool);
    const month = String(req.query.month || now.day.slice(0, 7));
    if (!MONTH.test(month)) return res.status(400).json({ error: "Month must look like 2026-10." });
    const rows = (await monthsFor(month)).map(({ emp: e, days, summary: sum }) => {
      const c = (f) => days.filter(f).length;
      return { no: e.emp_no || "", name: e.name, title: e.title || "", email: e.work_email,
        workingDays: c((d) => d.status && !d.off), present: sum.present, half: sum.half, short: sum.short, leave: c((d) => d.status === "On leave"), halfLeave: c((d) => d.status === "Half day leave"),
        offsite: sum.offsite, noPunch: c((d) => d.status === "No punch"), forgotOut: c((d) => d.forgotOut), minutes: sum.minutes,
        late: sum.late, early: sum.early, overtimeMinutes: sum.overtimeMinutes };
    }).sort((a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true }) || a.name.localeCompare(b.name));
    if (req.query.format !== "csv") return res.json({ month, rows });
    const safe = (v) => { const t = String(v ?? ""); const x = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t; return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const head = ["Employee ID", "Name", "Designation", "Email", "Working days", "Present", "Half days", "Under 3 hours", "On leave", "Half-day leave", "Off-site", "No punch", "Forgot punch out", "Hours worked", "Late arrivals", "Left early", "Overtime hours"];
    const lines = rows.map((x) => [x.no, x.name, x.title, x.email, x.workingDays, x.present, x.half, x.short, x.leave, x.halfLeave, x.offsite, x.noPunch, x.forgotOut, (x.minutes / 60).toFixed(1), x.late, x.early, (x.overtimeMinutes / 60).toFixed(1)].map(safe).join(","));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="attendance-${month}.csv"`);
    res.send("\ufeff" + [head.map(safe).join(","), ...lines].join("\r\n") + "\r\n");
  }));

  // attendance.edit: switch a person between working from the office (On-site) and from somewhere else (Off-site). Off-site people are not
  // marked "No punch" on days without an office punch. The place is the person's work location on record.
  r.put("/api/attendance/work-site", need("attendance.edit"), wrap(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const emp = (await pool.query("SELECT id, name, work_location FROM employees WHERE lower(work_email)=$1", [email])).rows[0];
    if (!emp) return res.status(404).json({ error: "Employee not found." });
    if (!(await can(req, "attendance.edit", email))) return res.status(403).json({ error: "You do not have access to change this person's attendance." });
    let place;
    if (req.body?.site === "on") place = (process.env.OFFICE_LOCATION || "Office").trim();
    else if (req.body?.site === "off") {
      place = String(req.body?.location || "").trim().slice(0, 80);
      if (!place) return res.status(400).json({ error: "Enter where they work from, for example Client site or Pune." });
      if (/office/i.test(place)) return res.status(400).json({ error: "That counts as the office. Use a place that is not the office, for example Client site." });
    } else return res.status(400).json({ error: "Choose On-site or Off-site." });
    await pool.query("UPDATE employees SET work_location=$2 WHERE id=$1", [emp.id, place]);
    await audit(pool, `${emp.name} marked ${req.body.site === "on" ? "On-site" : "Off-site"} (work location ${emp.work_location || "none"} → ${place}) by ${req.user.email}`, email);
    res.json({ email, location: place, offSite: offSite(place) });
  }));

  // attendance.edit: add a missed punch for a person in scope. A reason is required and goes in the audit log.
  r.post("/api/attendance/punches", need("attendance.edit"), wrap(async (req, res) => {
    const { email, date, time, direction, note } = req.body || {};
    const now = await nowIst(pool);
    if (!L.validDate(date)) return res.status(400).json({ error: "Choose a valid date." });
    if (date > now.day) return res.status(400).json({ error: "You cannot add a punch for a future date." });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ""))) return res.status(400).json({ error: "Enter the time as HH:MM, like 09:30." });
    if (!["IN", "OUT"].includes(direction)) return res.status(400).json({ error: "Choose IN or OUT." });
    if (!String(note || "").trim()) return res.status(400).json({ error: "Give a reason, for example forgot to punch." });
    const emp = await employeeByEmail(pool, email);
    if (!emp) return res.status(404).json({ error: "Employee not found." });
    if (emp.work_email.toLowerCase() === me(req)) return res.status(403).json({ error: "Your own attendance is corrected by someone else. Please send an attendance request." });
    if (!(await can(req, "attendance.edit", emp.work_email))) return res.status(403).json({ error: "You do not have access to change this person's attendance." });
    await pool.query("INSERT INTO attendance_punches (employee_id, work_date, punch_time, direction, source, note, created_by) VALUES ($1,$2,$3,$4,'hr',$5,$6)",
      [emp.id, date, time, direction, String(note).trim().slice(0, 300), me(req)]);
    await audit(pool, `Attendance: ${direction} at ${time} added for ${date} by ${me(req)} (${String(note).trim().slice(0, 100)})`, emp.work_email);
    res.status(201).json(await monthOf(emp, date.slice(0, 7)));
  }));

  r.delete("/api/attendance/punches/:id", need("attendance.edit"), wrap(async (req, res) => {
    const id = Number(req.params.id) || 0;
    const { rows: [owner] } = await pool.query("SELECT e.work_email FROM attendance_punches p JOIN employees e ON e.id=p.employee_id WHERE p.id=$1", [id]);
    if (!owner) return res.status(404).json({ error: "Punch not found." });
    if (owner.work_email.toLowerCase() === me(req)) return res.status(403).json({ error: "Your own attendance is corrected by someone else. Please send an attendance request." });
    if (!(await can(req, "attendance.edit", owner.work_email))) return res.status(403).json({ error: "You do not have access to change this person's attendance." });
    const { rows } = await pool.query(
      `DELETE FROM attendance_punches p USING employees e WHERE p.id=$1 AND e.id=p.employee_id
       RETURNING e.work_email, to_char(p.work_date,'YYYY-MM-DD') AS d, p.punch_time, p.direction`, [id]);
    if (!rows[0]) return res.status(404).json({ error: "Punch not found." });
    await audit(pool, `Attendance: ${rows[0].direction} at ${hhmm(rows[0].punch_time)} on ${rows[0].d} removed by ${me(req)}`, rows[0].work_email);
    res.json({ ok: true });
  }));
  return r;
}
