import express from "express";
import L from "../../frontend/leave-rules.cjs";
import { pool } from "./db.js";
import { requireAuth, requireHr } from "./auth.js";
import { managerMap } from "./teams.js";

/* A reporting manager sees their own team (the people HR set under them); there is no separate manager login role. */
const teamEmails = async (email) => Object.entries(await managerMap(pool)).filter(([, rm]) => rm === email).map(([e]) => e);

/* Attendance: people punch in and out on the web page; HR sees everyone and can add or remove a punch with a reason.
   Days are counted in Indian time. A day is Present from 6 hours worked, a Half day from 3 hours. */
const PRESENT_MIN = 360, HALF_MIN = 180;
const IST = "Asia/Kolkata";
const isHr = (req) => req.user && req.user.role === "hr";
const hhmm = (t) => String(t).slice(0, 5);
const mins = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const nowIst = async (db) => (await db.query(
  `SELECT to_char(now() AT TIME ZONE '${IST}','YYYY-MM-DD') AS day, to_char(now() AT TIME ZONE '${IST}','HH24:MI:SS') AS time`)).rows[0];
const audit = (db, action, email) => db.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]);

const toPunch = (p) => ({ id: p.id, date: p.work_date, time: hhmm(p.punch_time), direction: p.direction, source: p.source, note: p.note });

/** Minutes worked from a day's punches in time order: each IN pairs with the next OUT. An IN with no OUT counts to `until` (today) or nothing. */
function worked(punches, until) {
  let total = 0, open = null;
  for (const p of punches) {
    if (p.direction === "IN" && open === null) open = mins(p.time);
    else if (p.direction === "OUT" && open !== null) { total += Math.max(0, mins(p.time) - open); open = null; }
  }
  return { minutes: total + (open !== null && until !== null ? Math.max(0, until - open) : 0), missingOut: open !== null };
}

/** The office machine does not say IN or OUT, so the stored direction is only a guess made as punches arrive. For a finished day the people's habit
    is clearer: the first punch is the way in, the last punch is the way out, and the ones in between are breaks (out, then back in).
    Hours are then first to last, less the completed breaks. A leftover break punch with no return is flagged as a missing swipe, not guessed at. */
function deriveDay(ps) {
  const n = ps.length;
  const punches = ps.map((p, i) => ({ ...p, direction: i === 0 ? "IN" : i === n - 1 ? "OUT" : i % 2 === 1 ? "OUT" : "IN" }));
  if (n < 2) return { punches, minutes: 0, missingOut: true, missingSwipe: false };
  let brk = 0;
  for (let i = 1; i + 1 <= n - 2; i += 2) brk += Math.max(0, mins(ps[i + 1].time) - mins(ps[i].time));
  return { punches, minutes: Math.max(0, mins(ps[n - 1].time) - mins(ps[0].time) - brk), missingOut: false, missingSwipe: (n - 2) % 2 === 1 };
}

/** One person's days for a month. Past days get a status; days before they joined and in the future get none. */
function monthDays(month, punches, leave, holidays, emp, today, nowMin) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const hol = new Map(holidays.map((h) => [h.day, h.name]));
  const days = [];
  for (let d = 1; d <= last; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    let ps = punches.filter((p) => p.date === date).sort((a, b) => (a.time < b.time ? -1 : 1));
    // A finished day with punches from the office machine: work out in and out from the order of the punches (see deriveDay).
    const dd = date !== today && ps.some((p) => p.source === "device") ? deriveDay(ps) : null;
    if (dd) ps = dd.punches;
    const ins = ps.filter((p) => p.direction === "IN"), outs = ps.filter((p) => p.direction === "OUT");
    const w = dd ? { minutes: dd.minutes, missingOut: dd.missingOut } : worked(ps, date === today ? nowMin : null);
    const lv = leave.find((r) => r.from <= date && r.to >= date);
    const off = L.isWeekend(date) ? "Weekend" : hol.has(date) ? "Holiday" : null;
    let status = null;
    if (date > today || (emp.start && date < emp.start) || (emp.lastDay && date > emp.lastDay)) status = null;
    else if (ps.length) status = w.minutes >= PRESENT_MIN ? "Present" : w.minutes >= HALF_MIN ? "Half day" : (date === today ? "Working" : "Short hours");
    else if (lv) status = lv.half ? "Half day leave" : "On leave";
    else status = off || "Absent";
    if (status === "Present" && off) status = "Worked on " + off.toLowerCase();
    days.push({ date, status, off, holiday: hol.get(date) || null, firstIn: ins[0] ? ins[0].time : null, lastOut: outs.length ? outs[outs.length - 1].time : null,
      minutes: w.minutes, missingOut: w.missingOut && date !== today, missingSwipe: !!(dd && dd.missingSwipe), punches: ps });
  }
  return days;
}
const summarize = (days) => {
  const c = (f) => days.filter(f).length;
  return { present: c((d) => /^(Present|Worked on)/.test(d.status || "")), half: c((d) => d.status === "Half day"), leave: c((d) => /leave$/i.test(d.status || "")),
    absent: c((d) => d.status === "Absent"), short: c((d) => d.status === "Short hours"), minutes: days.reduce((n, d) => n + d.minutes, 0) };
};

async function employeeByEmail(db, email) {
  return (await db.query("SELECT id, name, work_email, start_date, last_day, status FROM employees WHERE lower(work_email)=$1", [String(email || "").toLowerCase()])).rows[0] || null;
}
async function monthOf(emp, month) {
  const from = `${month}-01`, to = `${month}-31`;
  const [p, l, h, now] = await Promise.all([
    pool.query(`SELECT id, to_char(work_date,'YYYY-MM-DD') AS work_date, punch_time, direction, source, note FROM attendance_punches
                WHERE employee_id=$1 AND work_date BETWEEN $2 AND $3 ORDER BY work_date, punch_time, id`, [emp.id, from, to]),
    pool.query(`SELECT to_char(from_date,'YYYY-MM-DD') AS f, to_char(to_date,'YYYY-MM-DD') AS t, half FROM leave_requests
                WHERE lower(work_email)=$1 AND status='approved' AND from_date<=$3 AND to_date>=$2`, [emp.work_email.toLowerCase(), from, to]),
    pool.query("SELECT to_char(day,'YYYY-MM-DD') AS day, name FROM holidays WHERE day BETWEEN $1 AND $2", [from, to]),
    nowIst(pool),
  ]);
  const days = monthDays(month, p.rows.map(toPunch), l.rows.map((r) => ({ from: r.f, to: r.t, half: r.half })), h.rows,
    { start: emp.start_date && String(emp.start_date).slice(0, 10), lastDay: emp.last_day && String(emp.last_day).slice(0, 10) }, now.day, mins(now.time));
  return { email: emp.work_email, name: emp.name, month, days, summary: summarize(days), today: now.day };
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
    const ps = (await pool.query(`SELECT id, to_char(work_date,'YYYY-MM-DD') AS work_date, punch_time, direction, source, note FROM attendance_punches
      WHERE employee_id=$1 AND work_date=$2 ORDER BY punch_time, id`, [emp.id, now.day])).rows.map(toPunch);
    const w = worked(ps, mins(now.time));
    res.json({ date: now.day, time: hhmm(now.time), punches: ps, state: ps.length && ps[ps.length - 1].direction === "IN" ? "in" : "out", minutes: w.minutes });
  }));

  // One tap: punches IN when you are out, OUT when you are in. The server's clock is used, never the browser's.
  r.post("/api/attendance/punch", wrap(async (req, res) => {
    if (!isHr(req)) return res.status(403).json({ error: "Attendance is recorded by the office machine. If a punch is missing, ask HR to add it." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const emp = (await client.query("SELECT id, name, work_email, status FROM employees WHERE lower(work_email)=$1 FOR UPDATE", [me(req)])).rows[0];
      if (!emp) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Your employee record was not found. Ask HR to check your work email." }); }
      if (emp.status === "offboarded") { await client.query("ROLLBACK"); return res.status(403).json({ error: "Your employment has ended, so you cannot punch." }); }
      const now = await nowIst(client);
      const last = (await client.query(
        "SELECT direction, punch_time FROM attendance_punches WHERE employee_id=$1 AND work_date=$2 ORDER BY punch_time DESC, id DESC LIMIT 1", [emp.id, now.day])).rows[0];
      if (last && mins(now.time) - mins(last.punch_time) < 1) { await client.query("ROLLBACK"); return res.status(429).json({ error: "You just punched. Wait a minute before punching again." }); }
      const direction = last && last.direction === "IN" ? "OUT" : "IN";
      await client.query("INSERT INTO attendance_punches (employee_id, work_date, punch_time, direction, source, created_by) VALUES ($1,$2,$3,$4,'web',$5)",
        [emp.id, now.day, now.time, direction, me(req)]);
      await client.query("COMMIT");
      res.json({ direction, time: hhmm(now.time) });
    } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
  }));

  // A month of days. Everyone reads their own; HR can ask for anyone with ?email=.
  r.get("/api/attendance/month", wrap(async (req, res) => {
    const month = String(req.query.month || (await nowIst(pool)).day.slice(0, 7));
    if (!MONTH.test(month)) return res.status(400).json({ error: "Month must look like 2026-10." });
    const email = req.query.email ? String(req.query.email).toLowerCase() : me(req);
    if (email !== me(req) && !isHr(req) && !(await teamEmails(me(req))).includes(email))
      return res.status(403).json({ error: "You can only see your own attendance and your team's." });
    const emp = await employeeByEmail(pool, email);
    if (!emp) return res.status(404).json({ error: "Employee not found." });
    res.json(await monthOf(emp, month));
  }));

  // Everyone for one day: HR sees all, a reporting manager sees their team, anyone else is refused.
  r.get("/api/attendance/day", wrap(async (req, res) => {
    const team = isHr(req) ? null : await teamEmails(me(req));
    if (team && !team.length) return res.status(403).json({ error: "Only HR and reporting managers can see this." });
    const now = await nowIst(pool);
    const date = String(req.query.date || now.day);
    if (!L.validDate(date)) return res.status(400).json({ error: "Date must look like 2026-10-21." });
    const [emps, ps, lv, hol] = await Promise.all([
      pool.query("SELECT id, name, work_email, title, start_date, last_day FROM employees WHERE status <> 'offboarded' ORDER BY name"),
      pool.query(`SELECT employee_id, to_char(work_date,'YYYY-MM-DD') AS work_date, punch_time, direction, source, note, id FROM attendance_punches WHERE work_date=$1 ORDER BY punch_time, id`, [date]),
      pool.query("SELECT lower(work_email) AS e, half FROM leave_requests WHERE status='approved' AND from_date<=$1 AND to_date>=$1", [date]),
      pool.query("SELECT name FROM holidays WHERE day=$1", [date]),
    ]);
    const off = L.isWeekend(date) ? "Weekend" : hol.rows[0] ? "Holiday" : null;
    const people = emps.rows.filter((e) => (!team || team.includes(e.work_email.toLowerCase())))
      .filter((e) => (!e.start_date || String(e.start_date).slice(0, 10) <= date) && (!e.last_day || String(e.last_day).slice(0, 10) >= date)).map((e) => {
      let mine = ps.rows.filter((p) => p.employee_id === e.id).map(toPunch);
      const dd = date !== now.day && mine.some((p) => p.source === "device") ? deriveDay(mine) : null;   // same in/out rule as a person's own month
      if (dd) mine = dd.punches;
      const w = dd ? { minutes: dd.minutes, missingOut: dd.missingOut } : worked(mine, date === now.day ? mins(now.time) : null), l = lv.rows.find((x) => x.e === e.work_email.toLowerCase());
      const ins = mine.filter((p) => p.direction === "IN"), outs = mine.filter((p) => p.direction === "OUT");
      let status;
      if (date > now.day) status = null;
      else if (mine.length) status = w.minutes >= PRESENT_MIN ? "Present" : w.minutes >= HALF_MIN ? "Half day" : date === now.day ? "Working" : "Short hours";
      else status = l ? (l.half ? "Half day leave" : "On leave") : off || "Absent";
      return { email: e.work_email, name: e.name, title: e.title, status, firstIn: ins[0] ? ins[0].time : null, lastOut: outs.length ? outs[outs.length - 1].time : null,
        minutes: w.minutes, missingOut: w.missingOut && date !== now.day, in: mine.length > 0 && mine[mine.length - 1].direction === "IN" };
    });
    res.json({ date, today: now.day, off, holiday: hol.rows[0] ? hol.rows[0].name : null, people });
  }));

  // HR: add a missed punch. A reason is required and goes in the audit log.
  r.post("/api/attendance/punches", requireHr, wrap(async (req, res) => {
    const { email, date, time, direction, note } = req.body || {};
    const now = await nowIst(pool);
    if (!L.validDate(date)) return res.status(400).json({ error: "Choose a valid date." });
    if (date > now.day) return res.status(400).json({ error: "You cannot add a punch for a future date." });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ""))) return res.status(400).json({ error: "Enter the time as HH:MM, like 09:30." });
    if (!["IN", "OUT"].includes(direction)) return res.status(400).json({ error: "Choose IN or OUT." });
    if (!String(note || "").trim()) return res.status(400).json({ error: "Give a reason, for example forgot to punch." });
    const emp = await employeeByEmail(pool, email);
    if (!emp) return res.status(404).json({ error: "Employee not found." });
    await pool.query("INSERT INTO attendance_punches (employee_id, work_date, punch_time, direction, source, note, created_by) VALUES ($1,$2,$3,$4,'hr',$5,$6)",
      [emp.id, date, time, direction, String(note).trim().slice(0, 300), me(req)]);
    await audit(pool, `Attendance: ${direction} at ${time} added for ${date} by ${me(req)} (${String(note).trim().slice(0, 100)})`, emp.work_email);
    res.status(201).json(await monthOf(emp, date.slice(0, 7)));
  }));

  r.delete("/api/attendance/punches/:id", requireHr, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `DELETE FROM attendance_punches p USING employees e WHERE p.id=$1 AND e.id=p.employee_id
       RETURNING e.work_email, to_char(p.work_date,'YYYY-MM-DD') AS d, p.punch_time, p.direction`, [Number(req.params.id) || 0]);
    if (!rows[0]) return res.status(404).json({ error: "Punch not found." });
    await audit(pool, `Attendance: ${rows[0].direction} at ${hhmm(rows[0].punch_time)} on ${rows[0].d} removed by ${me(req)}`, rows[0].work_email);
    res.json({ ok: true });
  }));
  return r;
}
