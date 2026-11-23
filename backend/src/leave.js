import express from "express";
import L from "../../frontend/leave-rules.cjs";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { can, isSuper, mayDecide, need, needAll, scopeOf, treeOf } from "./access.js";
import { approverOf, approverMap, coveredBy, hrLeaveApprovers, reportsOf } from "./teams.js";
import { tellLeave } from "./leave-mail.js";
import { compare, parseHolidays, readTable, templateXlsx } from "./holiday-import.js";

const num = (v) => (v === null || v === undefined ? null : Number(v));
// Today in India (UTC+5:30), so "today" turns over at midnight IST, not 5:30 am.
const todayIso = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const plural = (n) => `${n} day${n === 1 ? "" : "s"}`;
const when = (r) => (r.half ? `${r.from} (${L.HALVES[r.half]})` : `${r.from} to ${r.to}`);

const toRequest = (r) => ({
  id: r.id, email: r.work_email, type: r.type, from: r.from_date, to: r.to_date, half: r.half || null, days: num(r.days), reason: r.reason, notify: r.notify || [],
  status: r.status, paidDays: num(r.paid_days), lopDays: num(r.lop_days), decidedAt: r.decided_at, createdAt: r.created_at,
  createdBy: r.created_by || null, decidedBy: r.decided_by || null,
});
const toCompOff = (c) => ({ id: c.id, email: c.work_email, workedOn: c.worked_on, days: num(c.days), reason: c.reason, status: c.status,
  createdAt: c.created_at, decidedAt: c.decided_at, createdBy: c.created_by || null, decidedBy: c.decided_by || null });
const toEmp = (e) => ({ name: e.name, status: e.status, start: e.start_date, casualOpening: num(e.casual_opening), openings: e.leave_opening || null });

// Employees see and act on their own leave only. "Approve leave" (leave.approve) sees and decides for the people in scope;
// "Manage leave settings" (leave.manage, whole company) runs holidays, pay and salary cuts.
const self = (req) => req.user.email.toLowerCase();
// Who decides a leave request: anyone above the person in the reporting lines (their manager, that manager's manager, and so on
// up to the top), a stand-in their direct manager named while it lasts (`covers`), or a super admin. Nobody decides their own
// request, HR staff included. Someone with no manager: the super admins decide.
const mayDecideLeave = async (req, approver, owner, covers = []) => {
  const o = String(owner).toLowerCase();
  if (o === self(req)) return false;
  if (isSuper(req)) return true;
  if (approver !== "hr" && covers.includes(approver)) return true;
  return (await treeOf(self(req))).has(o);   // the caller is above this person in the reporting lines
};
const notYours = (approver) => ({ error: approver === "hr"
  ? "This person has no reporting manager, so a super admin decides this request. Nobody can decide their own request."
  : "Only this person's reporting manager or a super admin can approve or decline this request. Nobody can decide their own." });

const holidayDays = async (db) => (await db.query("SELECT day FROM holidays ORDER BY day")).rows.map((h) => h.day);

/** Locks the employee row so two approvals or requests for the same person can't race each other. */
async function lockEmployee(client, email) {
  const { rows } = await client.query("SELECT * FROM employees WHERE lower(work_email)=$1 FOR UPDATE", [String(email || "").toLowerCase()]);
  return rows[0] || null;
}
async function historyOf(client, email) {
  const lc = email.toLowerCase();
  const [reqs, comps] = await Promise.all([
    client.query("SELECT * FROM leave_requests WHERE lower(work_email)=$1", [lc]),
    client.query("SELECT * FROM comp_off_credits WHERE lower(work_email)=$1", [lc]),
  ]);
  return { requests: reqs.rows.map(toRequest), compOffs: comps.rows.map(toCompOff) };
}
const audit = (client, action, email) => client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]);

/** Runs fn inside a transaction; fn returns [status, body, after]. `after` (optional) runs once the change is saved:
 *  the emails, so nobody is told about something that was rolled back. */
async function tx(res, fn) {
  const client = await pool.connect();
  let after = null;
  try {
    await client.query("BEGIN");
    const [status, body, then] = await fn(client);
    await client.query(status < 400 ? "COMMIT" : "ROLLBACK");
    if (status < 400) after = then;
    res.status(status).json(body);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  if (after) await after();
}

export function leaveRouter(wrap) {
  const r = express.Router();
  r.use(["/api/leave", "/api/employees"], requireAuth);

  // Everything the Leave page needs; the page works out balances with the same leave-rules.js.
  r.get("/api/leave", wrap(async (req, res) => {
    // null = everyone (leave.approve for the whole company); otherwise the people in its scope plus the built-in views below
    const granted = await scopeOf(req, "leave.approve");
    let scope = null;
    if (granted) {
      scope = [self(req), ...granted];
      // plus everyone below them in the reporting lines (they decide those requests)
      scope.push(...(await treeOf(self(req))));
    }
    // plus the teams of managers this person is standing in for; their requests show as this person's to decide
    const covers = !scope ? [] : await coveredBy(pool, self(req));
    if (scope) for (const m of covers) scope.push(...(await reportsOf(pool, m)));
    if (scope) scope = [...new Set(scope)];
    const where = scope ? "WHERE lower(work_email) = ANY($1)" : "";
    const args = scope ? [scope] : [];
    const approvers = await approverMap(pool, scope);
    const payScope = await scopeOf(req, "payroll.view");   // salaries: payroll.view for the people in scope, or your own
    // Requests this person may decide show as theirs: everyone below them, the teams they stand in for, and for a super admin everyone.
    const below = await treeOf(self(req)), boss = isSuper(req);
    for (const [who, a] of Object.entries(approvers)) if (who !== self(req) && (boss || below.has(who) || covers.includes(a))) approvers[who] = self(req);
    const [reqs, comps, hols, pay] = await Promise.all([
      pool.query(`SELECT * FROM leave_requests ${where} ORDER BY from_date DESC, id DESC`, args),
      pool.query(`SELECT * FROM comp_off_credits ${where} ORDER BY worked_on DESC`, args),
      pool.query("SELECT day, name, type, source FROM holidays ORDER BY day"),
      pool.query(`SELECT work_email, start_date, monthly_gross, casual_opening, leave_opening FROM employees ${where}`, args),
    ]);
    res.json({
      policy: L.POLICY,
      today: todayIso(),
      requests: reqs.rows.map(toRequest),
      compOffs: comps.rows.map(toCompOff),
      holidays: hols.rows,
      pay: pay.rows.map((p) => ({ email: p.work_email, start: p.start_date,
        monthlyGross: !payScope || payScope.has(p.work_email.toLowerCase()) || p.work_email.toLowerCase() === self(req) ? num(p.monthly_gross) : null, casualOpening: num(p.casual_opening), openings: p.leave_opening || null })),
      approvers,
      hrLeaveApprovers: hrLeaveApprovers(),
    });
  }));

  // Who is on leave today and whose birthday is coming up, for everyone signed in (like the HR home page in Keka).
  // Only names and job titles go out: no leave type or reason, and birthdays as day and month (never the year, so no ages).
  const UPCOMING_DAYS = 14;
  r.get("/api/leave/today", wrap(async (_req, res) => {
    const today = todayIso();
    const soonUntil = new Date(Date.parse(today) + UPCOMING_DAYS * 86400000).toISOString().slice(0, 10);
    const [away, soon, people] = await Promise.all([
      pool.query(
        `SELECT DISTINCT ON (lower(e.work_email)) e.work_email, e.name, e.title, r.half
         FROM leave_requests r JOIN employees e ON lower(e.work_email) = lower(r.work_email)
         WHERE r.status = 'approved' AND r.from_date <= $1 AND r.to_date >= $1 AND e.status <> 'offboarded'
         ORDER BY lower(e.work_email), r.half NULLS FIRST`, [today]),
      // Approved leave starting in the next UPCOMING_DAYS days. Like today's list: no leave type or reason.
      pool.query(
        `SELECT e.work_email, e.name, e.title, r.from_date, r.to_date, r.half, r.days
         FROM leave_requests r JOIN employees e ON lower(e.work_email) = lower(r.work_email)
         WHERE r.status = 'approved' AND r.from_date > $1 AND r.from_date <= $2 AND e.status <> 'offboarded'
         ORDER BY r.from_date, e.name`, [today, soonUntil]),
      // The date of birth from the person's own profile wins over the one HR entered at onboarding.
      pool.query(
        `SELECT e.work_email, e.name, e.title, COALESCE(NULLIF(p.data->'primary'->>'dob', ''), e.dob::text) AS dob
         FROM employees e LEFT JOIN profiles p ON lower(p.email) = lower(e.work_email)
         WHERE e.status <> 'offboarded'`),
    ]);
    // The next time each birthday falls, today included. 29 Feb is kept on 28 Feb in other years.
    const y = Number(today.slice(0, 4));
    const leap = (yr) => (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
    const on = (yr, md) => (md === "02-29" && !leap(yr) ? `${yr}-02-28` : `${yr}-${md}`);
    const limit = new Date(Date.parse(today) + 30 * 86400000).toISOString().slice(0, 10);
    const birthdays = people.rows
      .filter((p) => /^\d{4}-\d{2}-\d{2}/.test(p.dob || ""))
      .map((p) => { const md = p.dob.slice(5, 10), d = on(y, md) >= today ? on(y, md) : on(y + 1, md);
        return { email: p.work_email, name: p.name, title: p.title, date: d }; })
      .filter((b) => b.date <= limit)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
    res.json({
      today,
      onLeave: away.rows.map((p) => ({ email: p.work_email, name: p.name, title: p.title, half: p.half || null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      upcomingLeave: soon.rows.map((p) => ({ email: p.work_email, name: p.name, title: p.title, from: p.from_date, to: p.to_date,
        half: p.half || null, days: Number(p.days) })),
      upcomingDays: UPCOMING_DAYS,
      birthdays,
    });
  }));

  r.post("/api/leave/requests", wrap(async (req, res) => {
    const { type, from, reason } = req.body || {};
    // Employees apply for themselves; leave.approve may apply for a person in scope.
    const asked = req.body && req.body.email ? String(req.body.email).toLowerCase() : self(req);
    const email = asked === self(req) || (await can(req, "leave.approve", asked)) ? asked : self(req);
    const half = req.body && req.body.half ? req.body.half : null;
    const to = half ? from : req.body && req.body.to;   // a half day is always a single date
    await tx(res, async (client) => {
      const emp = await lockEmployee(client, email);
      const hist = emp ? await historyOf(client, emp.work_email) : { requests: [], compOffs: [] };
      const holidays = await holidayDays(client);
      const bal = emp && L.validDate(from) ? L.balances(Number(from.slice(0, 4)), toEmp(emp), hist.requests, hist.compOffs) : null;
      // split: days over the balance of a paid type go in a second, unpaid request (the page asks for this).
      const split = Boolean(req.body && req.body.split);
      const errors = L.requestProblems({ emp: emp && toEmp(emp), type, from, to, half, reason, holidays, existing: hist.requests, bal, split, today: todayIso() });
      // People to notify must be colleagues on the employee list; anything else is dropped.
      const asked = Array.isArray(req.body.notify) ? req.body.notify.map((x) => String(x).toLowerCase()).slice(0, 20) : [];
      const { rows: known } = asked.length
        ? await client.query("SELECT work_email FROM employees WHERE lower(work_email) = ANY($1)", [asked]) : { rows: [] };
      const notify = known.map((k) => k.work_email).filter((x) => !emp || x.toLowerCase() !== emp.work_email.toLowerCase());
      if (Object.keys(errors).length) return [400, { errors }];
      const saved = [];
      for (const p of L.planRequest({ type, from, to, half, holidays, bal, existing: hist.requests, today: todayIso() })) {
        const { rows } = await client.query(
          `INSERT INTO leave_requests (work_email, type, from_date, to_date, half, days, reason, notify, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [emp.work_email, p.type, p.from, p.to, p.half, p.days, String(reason).trim(), JSON.stringify(notify), req.user.email.toLowerCase()]);
        const lr = toRequest(rows[0]);
        await audit(client, `${L.TYPES[p.type].name} requested: ${when(lr)} (${plural(p.days)})`, emp.work_email);
        saved.push(lr);
      }
      return [201, { ...saved[0], requests: saved }, () => Promise.all(saved.map((request) => tellLeave("requested", { request, actor: self(req) })))];
    });
  }));

  // Approve or decline. Approval fixes how many days are paid and how many are loss of pay, using the balance right now.
  r.post("/api/leave/requests/:id/decision", wrap(async (req, res) => {
    const decision = req.body && req.body.decision;
    if (!["approved", "declined"].includes(decision)) return res.status(400).json({ error: "Decision must be approved or declined." });
    await tx(res, async (client) => {
      const found = await client.query("SELECT work_email FROM leave_requests WHERE id=$1", [Number(req.params.id) || 0]);
      if (!found.rows[0]) return [404, { error: "Leave request not found." }];
      const approver = await approverOf(client, found.rows[0].work_email);
      if (!(await mayDecideLeave(req, approver, found.rows[0].work_email, await coveredBy(client, self(req))))) return [403, notYours(approver)];
      const emp = await lockEmployee(client, found.rows[0].work_email);
      const { rows } = await client.query("SELECT * FROM leave_requests WHERE id=$1 FOR UPDATE", [Number(req.params.id)]);
      const lr = toRequest(rows[0]);
      if (lr.status !== "pending") return [409, { error: `This request was already ${lr.status}.` }];
      const name = L.TYPES[lr.type].name;
      if (decision === "declined") {
        const { rows: out } = await client.query(
          "UPDATE leave_requests SET status='declined', decided_at=now(), decided_by=$2 WHERE id=$1 RETURNING *", [lr.id, self(req)]);
        await audit(client, `${name} declined by ${req.user.email}: ${when(lr)}`, lr.email);
        const request = toRequest(out[0]);
        return [200, request, () => tellLeave("decided", { request, actor: self(req), decision: "declined" })];
      }
      const holidays = await holidayDays(client);
      const days = L.requestDays(lr.from, lr.to, lr.half, holidays);   // recount in case holidays changed since the request
      const hist = await historyOf(client, lr.email);
      const bal = L.balances(Number(lr.from.slice(0, 4)), emp ? toEmp(emp) : {}, hist.requests, hist.compOffs);
      const { paid, lop } = L.allocate(lr.type, days, bal);
      const { rows: out } = await client.query(
        `UPDATE leave_requests SET status='approved', days=$2, paid_days=$3, lop_days=$4, decided_at=now(), decided_by=$5 WHERE id=$1 RETURNING *`,
        [lr.id, days, paid, lop, self(req)]);
      await audit(client, `${name} approved by ${req.user.email}: ${when(lr)} (${plural(paid)} paid${lop ? `, ${plural(lop)} loss of pay` : ""})`, lr.email);
      const request = toRequest(out[0]);
      return [200, request, () => tellLeave("decided", { request, actor: self(req), decision: "approved" })];
    });
  }));

  // The employee withdraws a request that is still waiting.
  r.post("/api/leave/requests/:id/cancel", wrap(async (req, res) => {
    await tx(res, async (client) => {
      const { rows } = await client.query("SELECT * FROM leave_requests WHERE id=$1 FOR UPDATE", [Number(req.params.id) || 0]);
      if (!rows[0]) return [404, { error: "Leave request not found." }];
      const lr = toRequest(rows[0]);
      if (lr.email.toLowerCase() !== self(req) && !(await can(req, "leave.approve", lr.email))) return [404, { error: "Leave request not found." }];
      if (lr.status !== "pending") return [409, { error: `This request was already ${lr.status}, so it can't be cancelled.` }];
      const { rows: out } = await client.query("UPDATE leave_requests SET status='cancelled', decided_at=now(), decided_by=$2 WHERE id=$1 RETURNING *", [lr.id, self(req)]);
      const by = lr.email.toLowerCase() === self(req) ? "the employee" : req.user.email;
      await audit(client, `${L.TYPES[lr.type].name} cancelled by ${by}: ${when(lr)}`, lr.email);
      const request = toRequest(out[0]);
      return [200, request, () => tellLeave("cancelled", { request, actor: self(req) })];
    });
  }));

  // leave.approve records a comp off directly for a person in scope (approved at once, never your own), or an employee asks
  // for one (pending until it is decided).
  const addCompOff = (status) => wrap(async (req, res) => {
    const { workedOn, reason } = req.body || {};
    const asked = req.body && req.body.email ? String(req.body.email).toLowerCase() : self(req);
    let email;
    if (status === "approved") {
      if (!(await mayDecide(req, "leave.approve", asked))) return res.status(403).json({ error: "You do not have access to record a comp off for this person. Nobody can approve their own." });
      email = asked;
    } else email = asked === self(req) || (await can(req, "leave.approve", asked)) ? asked : self(req);
    await tx(res, async (client) => {
      const emp = await lockEmployee(client, email);
      const { compOffs } = emp ? await historyOf(client, emp.work_email) : { compOffs: [] };
      const errors = L.compOffProblems({ emp, workedOn, reason, holidays: await holidayDays(client), today: todayIso(), existing: compOffs });
      if (Object.keys(errors).length) return [400, { errors }];
      const final = status;
      const { rows } = await client.query(
        "INSERT INTO comp_off_credits (work_email, worked_on, reason, status, decided_at, created_by, decided_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [emp.work_email, workedOn, String(reason).trim(), final, final === "approved" ? new Date() : null, self(req), final === "approved" ? self(req) : null]);
      await audit(client, final === "approved" ? `Comp off earned for working on ${workedOn}` : `Comp off credit requested for working on ${workedOn}`, emp.work_email);
      const compOff = toCompOff(rows[0]);
      return [201, compOff, () => tellLeave(final === "approved" ? "compoff_decided" : "compoff_requested", { compOff, actor: self(req), decision: "approved" })];
    });
  });
  r.post("/api/leave/comp-off-requests", addCompOff("pending"));

  r.post("/api/leave/comp-offs/:id/decision", wrap(async (req, res) => {
    const decision = req.body && req.body.decision;
    if (!["approved", "declined"].includes(decision)) return res.status(400).json({ error: "Decision must be approved or declined." });
    await tx(res, async (client) => {
      const { rows } = await client.query("SELECT * FROM comp_off_credits WHERE id=$1 FOR UPDATE", [Number(req.params.id) || 0]);
      if (!rows[0]) return [404, { error: "Comp off request not found." }];
      const approver = await approverOf(client, rows[0].work_email);
      if (!(await mayDecideLeave(req, approver, rows[0].work_email, await coveredBy(client, self(req))))) return [403, notYours(approver)];
      if (rows[0].status !== "pending") return [409, { error: `This comp off was already ${rows[0].status}.` }];
      const { rows: out } = await client.query("UPDATE comp_off_credits SET status=$2, decided_at=now(), decided_by=$3 WHERE id=$1 RETURNING *", [rows[0].id, decision, self(req)]);
      await audit(client, `Comp off credit ${decision} by ${req.user.email} for working on ${rows[0].worked_on}`, rows[0].work_email);
      const compOff = toCompOff(out[0]);
      return [200, compOff, () => tellLeave("compoff_decided", { compOff, actor: self(req), decision })];
    });
  }));

  r.post("/api/leave/comp-offs", need("leave.approve"), addCompOff("approved"));
  /* ---------- Holiday list as an Excel sheet (holiday-import.js): download a template, upload the sheet, check the preview, confirm.
     Any year, any number of years in one file. Each row becomes a holiday like the 2026 ones (date, name, type, marked imported). ---------- */
  r.get("/api/leave/holidays/template", needAll("leave.manage"), wrap(async (req, res) => {
    const year = Number(req.query.year) >= 1990 && Number(req.query.year) <= 2100 ? Number(req.query.year) : Number(todayIso().slice(0, 4));
    const { rows } = await pool.query("SELECT to_char(day,'YYYY-MM-DD') AS day, name, type FROM holidays WHERE extract(year FROM day) = $1 ORDER BY day", [year]);
    res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="holiday-list-${year}.xlsx"` });
    res.send(await templateXlsx(year, rows));
  }));
  // Reads the file and says what would change. Nothing is saved here.
  r.post("/api/leave/holidays/import", needAll("leave.manage"), express.raw({ type: () => true, limit: 1024 * 1024 }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Choose the Excel or CSV file with the holiday list." });
    let table;
    try { table = await readTable(req.body); } catch (err) { return res.status(422).json({ error: err.message }); }
    const { holidays, errors } = parseHolidays(table);
    const { rows } = holidays.length ? await pool.query("SELECT to_char(day,'YYYY-MM-DD') AS day, name, type FROM holidays WHERE day = ANY($1::date[])", [holidays.map((h) => h.day)]) : { rows: [] };
    const list = compare(holidays, new Map(rows.map((h) => [h.day, h])));
    res.json({ holidays: list, errors, years: [...new Set(list.map((h) => Number(h.day.slice(0, 4))))],
      counts: { new: list.filter((h) => h.status === "new").length, changed: list.filter((h) => h.status === "changed").length, same: list.filter((h) => h.status === "same").length } });
  }));
  // Saves what HR confirmed. Every row is checked again here; a date that is already a holiday takes the new name and type.
  r.post("/api/leave/holidays/import/apply", needAll("leave.manage"), wrap(async (req, res) => {
    const sent = Array.isArray(req.body && req.body.holidays) ? req.body.holidays : [];
    if (!sent.length || sent.length > 400) return res.status(400).json({ error: "There are no holidays to save." });
    const days = new Set(), list = [];
    for (const h of sent) {
      const name = String((h && h.name) || "").trim().replace(/\s+/g, " "), type = String((h && h.type) || "").trim() || null;
      if (!L.validDate(h && h.day) || !name || name.length > 80 || (type && type.length > 40) || days.has(h.day)) return res.status(400).json({ error: "The list changed or has a problem. Please upload the file again." });
      days.add(h.day); list.push({ day: h.day, name, type });
    }
    await tx(res, async (client) => {
      let added = 0, updated = 0;
      for (const h of list) {
        const { rows: [was] } = await client.query("SELECT name, type FROM holidays WHERE day=$1 FOR UPDATE", [h.day]);
        if (!was) { await client.query("INSERT INTO holidays (day, name, type, source, updated_by, updated_at) VALUES ($1,$2,$3,'imported',$4,now())", [h.day, h.name, h.type, req.user.email]); added++; }
        else if (was.name !== h.name || (was.type || null) !== h.type) { await client.query("UPDATE holidays SET name=$2, type=$3, source='imported', updated_by=$4, updated_at=now() WHERE day=$1", [h.day, h.name, h.type, req.user.email]); updated++; }
      }
      const years = [...new Set(list.map((h) => h.day.slice(0, 4)))].join(", ");
      await audit(client, `Holiday list uploaded for ${years}: ${added} added, ${updated} updated, ${list.length - added - updated} unchanged`, null);
      return [200, { added, updated, unchanged: list.length - added - updated, years: [...new Set(list.map((h) => Number(h.day.slice(0, 4))))] }];
    });
  }));

  r.post("/api/leave/holidays", needAll("leave.manage"), wrap(async (req, res) => {
    const { day, name } = req.body || {};
    const type = String((req.body && req.body.type) || "").trim().slice(0, 40) || null;
    if (!L.validDate(day) || !String(name || "").trim()) return res.status(400).json({ error: "Enter a date and a name for the holiday." });
    if (String(name).trim().length > 80) return res.status(400).json({ error: "Keep the holiday name under 80 characters." });
    await tx(res, async (client) => {
      const { rowCount } = await client.query("INSERT INTO holidays (day, name, type, source, updated_by, updated_at) VALUES ($1,$2,$3,'manual',$4,now()) ON CONFLICT DO NOTHING",
        [day, String(name).trim(), type, req.user.email]);
      if (!rowCount) return [409, { error: "That date is already a holiday." }];
      await audit(client, `Holiday added: ${String(name).trim()} on ${day}`, null);
      return [201, { day, name: String(name).trim(), type, source: "manual" }];
    });
  }));

  // Rename a holiday, change its type, or move it to another date. An imported holiday stays marked as imported.
  r.put("/api/leave/holidays/:day", needAll("leave.manage"), wrap(async (req, res) => {
    const { day, name } = req.body || {};
    const type = String((req.body && req.body.type) || "").trim().slice(0, 40) || null;
    if (!L.validDate(day) || !String(name || "").trim()) return res.status(400).json({ error: "Enter a date and a name for the holiday." });
    if (String(name).trim().length > 80) return res.status(400).json({ error: "Keep the holiday name under 80 characters." });
    await tx(res, async (client) => {
      const old = L.validDate(req.params.day) ? req.params.day : null;
      const { rows: [h] } = await client.query("SELECT * FROM holidays WHERE day=$1 FOR UPDATE", [old]);
      if (!h) return [404, { error: "Holiday not found." }];
      if (day !== old) {
        const { rowCount } = await client.query("SELECT 1 FROM holidays WHERE day=$1", [day]);
        if (rowCount) return [409, { error: "That date is already a holiday." }];
      }
      await client.query("UPDATE holidays SET day=$2, name=$3, type=$4, updated_by=$5, updated_at=now() WHERE day=$1", [old, day, String(name).trim(), type, req.user.email]);
      const what = [h.name !== String(name).trim() ? `renamed "${h.name}" to "${String(name).trim()}"` : null, day !== old ? `moved from ${old} to ${day}` : null,
        (h.type || null) !== type ? `type ${type || "none"}` : null].filter(Boolean).join(", ");
      await audit(client, `Holiday updated: ${what || "no change"}`, null);
      return [200, { day, name: String(name).trim(), type, source: h.source }];
    });
  }));

  r.delete("/api/leave/holidays/:day", needAll("leave.manage"), wrap(async (req, res) => {
    await tx(res, async (client) => {
      const { rows } = await client.query("DELETE FROM holidays WHERE day=$1 RETURNING name", [L.validDate(req.params.day) ? req.params.day : null]);
      if (!rows[0]) return [404, { error: "Holiday not found." }];
      await audit(client, `Holiday removed: ${rows[0].name} on ${req.params.day}`, null);
      return [200, { ok: true }];
    });
  }));

  // Monthly gross (for the salary cut) and the casual balance someone had before this system started.
  r.put("/api/employees/:email/pay", needAll("leave.manage"), wrap(async (req, res) => {
    const { monthlyGross, casualOpening } = req.body || {};
    const gross = monthlyGross === "" || monthlyGross === null || monthlyGross === undefined ? null : Number(monthlyGross);
    const opening = Number(casualOpening ?? 0);
    const errors = {};
    if (gross !== null && !(gross > 0 && gross < 1e8)) errors.monthlyGross = "Enter the monthly gross salary in rupees.";
    if (!(opening >= 0 && opening <= 365 && Number.isInteger(opening * 2))) errors.casualOpening = "Enter whole or half days, 0 to 365.";
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    await tx(res, async (client) => {
      const emp = await lockEmployee(client, req.params.email);
      if (!emp) return [404, { error: "Employee not found." }];
      const changed = [];
      if (num(emp.monthly_gross) !== gross) changed.push("monthly salary");
      if (num(emp.casual_opening) !== opening) changed.push(`opening casual balance (${num(emp.casual_opening)} → ${opening})`);
      if (!changed.length) return [200, { ok: true, changed: false }];
      await client.query("UPDATE employees SET monthly_gross=$2, casual_opening=$3 WHERE id=$1", [emp.id, gross, opening]);
      await audit(client, `Updated ${changed.join(" and ")}`, emp.work_email);   // the salary figure itself is not logged
      return [200, { ok: true, changed: true }];
    });
  }));

  // Salary cuts for one month: loss-of-pay days that fall in that month × monthly gross / 30.
  r.get("/api/leave/salary-cuts", needAll("leave.manage"), wrap(async (req, res) => {
    const month = String(req.query.month || "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: "Month must look like 2026-10." });
    const [reqs, emps, holidays] = await Promise.all([
      pool.query("SELECT * FROM leave_requests WHERE status='approved' AND lop_days > 0"),
      pool.query("SELECT work_email, name, monthly_gross FROM employees"),
      holidayDays(pool),
    ]);
    const byEmail = new Map(emps.rows.map((e) => [e.work_email.toLowerCase(), e]));
    const days = new Map();
    for (const lr of reqs.rows.map(toRequest)) {
      const n = L.lopByMonth(lr, holidays)[month] || 0;
      if (n) days.set(lr.email.toLowerCase(), (days.get(lr.email.toLowerCase()) || 0) + n);
    }
    res.json([...days].map(([email, lop]) => {
      const e = byEmail.get(email) || {};
      const gross = num(e.monthly_gross);
      return { email: e.work_email || email, name: e.name || email, lopDays: lop, monthlyGross: gross, cut: gross ? L.salaryCut(gross, lop) : null };
    }));
  }));

  return r;
}
