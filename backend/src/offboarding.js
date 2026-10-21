import express from "express";
import L from "../../frontend/leave-rules.js";
import { pool } from "./db.js";
import { requireHr } from "./auth.js";
import { TOOL_NAMES, removeAccess } from "./connectors.js";

// Tools offboarding removes for now: Claude only. Add ids from connectors.js (gws, gemini, github, gcp) to bring others back.
const TOOLS = ["claude"];

// Manual tasks HR ticks off; the order matches the checklist on the page.
const TASKS = [
  ["laptop", "Laptop returned"],
  ["settlement", "Final settlement cleared"],
];
const todayIso = () => new Date().toISOString().slice(0, 10);
const LAPTOP_CONDITION = ["Good", "Minor wear", "Damaged"];
const fmtDay = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Laptop return details: "returned" needs the serial and return date; the condition is optional. */
function laptopErrors(l) {
  const e = {};
  if (!String(l.serial || "").trim()) e.laptopSerial = "Enter the laptop serial number.";
  else if (String(l.serial).length > 60) e.laptopSerial = "Keep the serial number under 60 characters.";
  if (!L.validDate(l.date)) e.laptopDate = "Enter the date the laptop was returned.";
  else if (l.date > todayIso()) e.laptopDate = "The return date can't be in the future.";
  if (l.condition && !LAPTOP_CONDITION.includes(l.condition)) e.laptopCondition = "Pick the laptop's condition.";
  if (String(l.note || "").length > 300) e.laptopNote = "Keep the note under 300 characters.";
  return e;
}
const laptopDetail = (l) => [`Serial ${String(l.serial).trim()}`, `returned ${fmtDay(l.date)}`, l.condition, String(l.note || "").trim()].filter(Boolean).join(" · ");

/**
 * What HR recorded in the offboarding form for each manual task: [done, detail].
 * laptop: "returned", "pending" (not yet) or "none" (never issued). settlement: true or false.
 */
function readChecklist(c, errors) {
  c = c && typeof c === "object" ? c : {};
  const out = {};
  const lp = c.laptop || {};
  if (!["returned", "pending", "none"].includes(lp.status || "pending")) errors.laptop = "Choose whether the laptop was returned.";
  else if (lp.status === "returned") { Object.assign(errors, laptopErrors(lp)); out.laptop = [true, laptopDetail(lp)]; }
  else if (lp.status === "none") out.laptop = [true, "No laptop was issued"];
  else out.laptop = [false, null];
  out.settlement = [!!c.settlement, null];
  return out;
}
const audit = (db, action, email) => db.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]);

/** Runs fn inside a transaction; fn returns [status, body]. */
async function tx(res, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const [status, body] = await fn(client);
    await client.query(status < 400 ? "COMMIT" : "ROLLBACK");
    if (res) res.status(status).json(body);
    return [status, body];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** One offboarding with its steps and the leave figures for the final settlement. */
async function load(db, id) {
  const { rows } = await db.query("SELECT * FROM offboardings WHERE id=$1", [id]);
  if (!rows[0]) return null;
  const o = rows[0];
  const lc = o.work_email.toLowerCase();
  const [steps, emp, reqs, comps, hols] = await Promise.all([
    db.query("SELECT * FROM offboarding_steps WHERE offboarding_id=$1 ORDER BY id", [id]),
    db.query("SELECT start_date, casual_opening, monthly_gross FROM employees WHERE lower(work_email)=$1", [lc]),
    db.query("SELECT * FROM leave_requests WHERE lower(work_email)=$1", [lc]),
    db.query("SELECT * FROM comp_off_credits WHERE lower(work_email)=$1", [lc]),
    db.query("SELECT day FROM holidays"),
  ]);
  const e = emp.rows[0] || {};
  const n = (v) => (v === null || v === undefined ? null : Number(v));
  const settlement = L.exitSettlement({
    emp: { start: e.start_date, casualOpening: n(e.casual_opening) || 0 },
    lastDay: o.last_day,
    requests: reqs.rows.map((r) => ({ type: r.type, from: r.from_date, to: r.to_date, half: r.half, status: r.status,
      days: n(r.days), paidDays: n(r.paid_days), lopDays: n(r.lop_days) })),
    compOffs: comps.rows.map((c) => ({ workedOn: c.worked_on, days: n(c.days), status: c.status })),
    monthlyGross: n(e.monthly_gross),
    holidays: hols.rows.map((h) => h.day),
  });
  return {
    id: o.id, email: o.work_email, lastDay: o.last_day, transferTo: o.transfer_to, status: o.status, runAt: o.run_at,
    startedAt: o.started_at, completedAt: o.completed_at,
    steps: steps.rows.map((s) => ({ kind: s.kind, key: s.key, label: s.label, status: s.status, detail: s.detail, doneAt: s.done_at })),
    settlement,
  };
}

/** Moves the offboarding (and the employee) on once every tool, then every task, is done. */
async function settle(db, id) {
  const { rows: o } = await db.query("SELECT * FROM offboardings WHERE id=$1", [id]);
  if (!o[0] || o[0].status === "cancelled" || o[0].status === "scheduled") return;
  const { rows: steps } = await db.query("SELECT kind, status FROM offboarding_steps WHERE offboarding_id=$1", [id]);
  const toolsDone = steps.filter((s) => s.kind === "tool").every((s) => s.status === "done");
  const allDone = toolsDone && steps.every((s) => s.status === "done");
  const next = allDone ? "completed" : toolsDone ? "access_removed" : "in_progress";
  if (next === o[0].status) return;
  await db.query("UPDATE offboardings SET status=$2, completed_at=$3 WHERE id=$1", [id, next, allDone ? new Date() : null]);
  if (allDone) {
    await db.query("UPDATE employees SET status='offboarded' WHERE lower(work_email)=$1", [o[0].work_email.toLowerCase()]);
    await audit(db, "Offboarding completed", o[0].work_email);
  } else if (toolsDone) {
    await audit(db, "All tool access removed", o[0].work_email);
  }
}

/**
 * Removes access tool by tool, Google Workspace first (that also blocks sign-in to every tool using Google login).
 * Only one run per offboarding at a time; a tool that fails is marked failed and can be retried.
 */
export async function runRemoval(id) {
  const { rows: before } = await pool.query("SELECT status FROM offboardings WHERE id=$1", [id]);
  const { rows } = await pool.query(
    `UPDATE offboardings SET running=true, status='in_progress', started_at=COALESCE(started_at, now())
     WHERE id=$1 AND running=false AND status IN ('scheduled','in_progress') RETURNING *`, [id]);
  if (!rows[0]) return false;   // already running elsewhere, or not in a state that removes access
  const o = rows[0];
  try {
    await pool.query("UPDATE employees SET status='offboarding' WHERE lower(work_email)=$1", [o.work_email.toLowerCase()]);
    // Their HR Access Hub login goes too (signing them out), unless they are the last HR account.
    const lc = o.work_email.toLowerCase();
    const { rows: hrLeft } = await pool.query("SELECT count(*)::int AS n FROM users WHERE role='hr' AND lower(email)<>$1", [lc]);
    const { rowCount: gone } = await pool.query(
      "DELETE FROM users WHERE lower(email)=$1 AND (role<>'hr' OR $2::int > 0)", [lc, hrLeft[0].n]);
    if (gone) {
      await pool.query("DELETE FROM sessions WHERE lower(email)=$1", [lc]);
      await audit(pool, "HR Access Hub login removed", o.work_email);
    }
    if (before[0] && before[0].status === "scheduled") await audit(pool, "Scheduled offboarding started: removing tool access", o.work_email);
    const { rows: tools } = await pool.query(
      "SELECT * FROM offboarding_steps WHERE offboarding_id=$1 AND kind='tool' AND status<>'done' ORDER BY (key='gws') DESC, id", [id]);
    const { rows: to } = await pool.query("SELECT name FROM employees WHERE lower(work_email)=$1", [String(o.transfer_to || "").toLowerCase()]);
    for (const t of tools) {
      try {
        const detail = await removeAccess(t.key, { transferTo: to[0] ? to[0].name : o.transfer_to, email: o.work_email });
        await pool.query("UPDATE offboarding_steps SET status='done', detail=$2, done_at=now() WHERE id=$1", [t.id, detail]);
        await audit(pool, `${TOOL_NAMES[t.key]}: ${detail}`, o.work_email);
      } catch (err) {
        await pool.query("UPDATE offboarding_steps SET status='failed', detail=$2 WHERE id=$1", [t.id, err.message]);
        await audit(pool, `${TOOL_NAMES[t.key]}: removing access failed. ${err.message}`, o.work_email);
      }
    }
    await settle(pool, id);
  } finally {
    await pool.query("UPDATE offboardings SET running=false WHERE id=$1", [id]);
  }
  return true;
}

/** Starts any scheduled offboarding whose time has come (6 pm India time on the last working day). */
export async function runDue() {
  const { rows } = await pool.query("SELECT id FROM offboardings WHERE status='scheduled' AND run_at <= now()");
  for (const r of rows) await runRemoval(r.id);
}

export function offboardingRouter(wrap) {
  const r = express.Router();
  r.use("/api/offboarding", requireHr);   // offboarding is HR work

  r.get("/api/offboarding", wrap(async (_req, res) => {
    const { rows } = await pool.query("SELECT id FROM offboardings WHERE status<>'cancelled' ORDER BY created_at");
    res.json(await Promise.all(rows.map((x) => load(pool, x.id))));
  }));

  // Start offboarding now, or schedule it for 6 pm on the last working day.
  r.post("/api/offboarding", wrap(async (req, res) => {
    const { email, lastDay, transferTo, when } = req.body || {};
    const tools = Array.isArray(req.body && req.body.tools) ? [...new Set(req.body.tools)] : [];
    const [status, body] = await tx(null, async (db) => {
      const errors = {};
      const checklist = readChecklist(req.body && req.body.checklist, errors);
      const { rows: e } = await db.query("SELECT * FROM employees WHERE lower(work_email)=$1 FOR UPDATE", [String(email || "").toLowerCase()]);
      const emp = e[0];
      if (!emp) errors.email = "Pick the employee who is leaving.";
      else if (emp.status === "offboarded") errors.email = `${emp.name} has already been offboarded.`;
      if (!L.validDate(lastDay)) errors.lastDay = "Enter the last working day.";
      if (!["now", "later"].includes(when)) errors.when = "Choose now or on the last working day.";
      else if (when === "later" && L.validDate(lastDay) && lastDay < todayIso()) errors.lastDay = "That day has passed. Offboard now instead.";
      if (tools.some((t) => !TOOLS.includes(t))) errors.tools = "Offboarding only removes Claude access for now.";
      const { rows: t } = await db.query("SELECT work_email, name, status FROM employees WHERE lower(work_email)=$1", [String(transferTo || "").toLowerCase()]);
      if (tools.includes("gws")) {
        if (!t[0]) errors.transferTo = "Pick who receives their Drive files and email.";
        else if (emp && t[0].work_email.toLowerCase() === emp.work_email.toLowerCase()) errors.transferTo = "Pick someone other than the person leaving.";
        else if (!["active", "onboarding"].includes(t[0].status)) errors.transferTo = `${t[0].name} is not an active employee.`;
      }
      if (emp && !errors.email) {
        const { rowCount } = await db.query("SELECT 1 FROM offboardings WHERE lower(work_email)=$1 AND status<>'cancelled'", [emp.work_email.toLowerCase()]);
        if (rowCount) errors.email = `${emp.name} is already being offboarded.`;
      }
      if (Object.keys(errors).length) return [400, { errors }];

      const { rows: o } = await db.query(
        `INSERT INTO offboardings (work_email, last_day, transfer_to, status, run_at)
         VALUES ($1, $2, $3, $4, CASE WHEN $4='scheduled' THEN ($2::date + time '18:00') AT TIME ZONE 'Asia/Kolkata' ELSE now() END)
         RETURNING id`, [emp.work_email, lastDay, t[0] ? t[0].work_email : null, when === "later" ? "scheduled" : "in_progress"]);
      const id = o[0].id;
      for (const k of tools) await db.query("INSERT INTO offboarding_steps (offboarding_id, kind, key, label) VALUES ($1,'tool',$2,$3)", [id, k, `Remove access: ${TOOL_NAMES[k]}`]);
      for (const [k, label] of TASKS) {
        const [done, detail] = checklist[k] || [false, null];
        await db.query("INSERT INTO offboarding_steps (offboarding_id, kind, key, label, status, detail, done_at) VALUES ($1,'task',$2,$3,$4,$5,$6)",
          [id, k, label, done ? "done" : "pending", detail, done ? new Date() : null]);
      }
      const doneTasks = TASKS.filter(([k]) => checklist[k] && checklist[k][0]);
      if (doneTasks.length) await audit(db, `Checklist at start: ${doneTasks.map(([k, label]) => label + (checklist[k][1] ? ` (${checklist[k][1]})` : "")).join("; ")}`, emp.work_email);
      await db.query("UPDATE employees SET last_day=$2 WHERE id=$1", [emp.id, lastDay]);

      // Leave after the last working day will never be taken, so it is cancelled now.
      const { rowCount: dropped } = await db.query(
        `UPDATE leave_requests SET status='cancelled', decided_at=now()
         WHERE lower(work_email)=$1 AND status IN ('pending','approved') AND from_date > $2`, [emp.work_email.toLowerCase(), lastDay]);
      await audit(db, when === "later" ? `Offboarding scheduled for ${lastDay}, 6:00 pm` : `Offboarding started, last working day ${lastDay}`, emp.work_email);
      if (dropped) await audit(db, `${dropped} leave request${dropped === 1 ? "" : "s"} after the last working day cancelled`, emp.work_email);
      return [201, { id }];
    });
    if (status >= 400) return res.status(status).json(body);
    if (when === "now") await runRemoval(body.id);
    res.status(201).json(await load(pool, body.id));
  }));

  // Run a scheduled offboarding straight away.
  r.post("/api/offboarding/:id/run", wrap(async (req, res) => {
    const { rows } = await pool.query("SELECT status FROM offboardings WHERE id=$1", [Number(req.params.id) || 0]);
    if (!rows[0]) return res.status(404).json({ error: "Offboarding not found." });
    if (rows[0].status !== "scheduled") return res.status(409).json({ error: "This offboarding is not waiting to run." });
    await runRemoval(Number(req.params.id));
    res.json(await load(pool, Number(req.params.id)));
  }));

  // Call off a scheduled offboarding (for example, the person is staying). Only possible before any access is removed.
  r.post("/api/offboarding/:id/cancel", wrap(async (req, res) => {
    await tx(res, async (db) => {
      const { rows } = await db.query("SELECT * FROM offboardings WHERE id=$1 FOR UPDATE", [Number(req.params.id) || 0]);
      if (!rows[0]) return [404, { error: "Offboarding not found." }];
      if (rows[0].status !== "scheduled" || rows[0].running) return [409, { error: "Access removal has already started, so this can't be called off." }];
      await db.query("UPDATE offboardings SET status='cancelled' WHERE id=$1", [rows[0].id]);
      await db.query("UPDATE employees SET last_day=NULL WHERE lower(work_email)=$1", [rows[0].work_email.toLowerCase()]);
      await audit(db, "Scheduled offboarding called off", rows[0].work_email);
      return [200, { ok: true }];
    });
  }));

  // Tick or untick a manual task.
  r.post("/api/offboarding/:id/steps/:key", wrap(async (req, res) => {
    const done = !!(req.body && req.body.done);
    let detail = null;
    if (done && req.params.key === "laptop") {
      const lp = (req.body && req.body.laptop) || {};
      if (lp.status === "none") detail = "No laptop was issued";
      else { const errors = laptopErrors(lp); if (Object.keys(errors).length) return res.status(400).json({ errors }); detail = laptopDetail(lp); }
    }
    await tx(null, async (db) => {
      const { rows } = await db.query(
        `SELECT s.*, o.work_email, o.status AS ostatus FROM offboarding_steps s JOIN offboardings o ON o.id=s.offboarding_id
         WHERE s.offboarding_id=$1 AND s.key=$2 AND s.kind='task' FOR UPDATE`, [Number(req.params.id) || 0, req.params.key]);
      const s = rows[0];
      if (!s) return [404, { error: "Task not found." }];
      if (["completed", "cancelled"].includes(s.ostatus)) return [409, { error: "This offboarding is closed." }];
      if ((s.status === "done") === done && !detail) return [200, {}];
      await db.query("UPDATE offboarding_steps SET status=$2, done_at=$3, detail=$4 WHERE id=$1", [s.id, done ? "done" : "pending", done ? new Date() : null, done ? detail : null]);
      await audit(db, `Checklist: ${s.label}${done ? (detail ? ` (${detail})` : "") : " (unticked)"}`, s.work_email);
      await settle(db, s.offboarding_id);
      return [200, {}];
    }).then(async ([status, body]) => res.status(status).json(status < 400 ? await load(pool, Number(req.params.id)) : body));
  }));

  // Try a tool that failed again.
  r.post("/api/offboarding/:id/steps/:key/retry", wrap(async (req, res) => {
    const id = Number(req.params.id) || 0;
    const { rows } = await pool.query(
      "SELECT s.status, o.status AS ostatus FROM offboarding_steps s JOIN offboardings o ON o.id=s.offboarding_id WHERE s.offboarding_id=$1 AND s.key=$2 AND s.kind='tool'",
      [id, req.params.key]);
    if (!rows[0]) return res.status(404).json({ error: "Tool not found on this offboarding." });
    if (rows[0].status !== "failed") return res.status(409).json({ error: "Only a tool that failed can be retried." });
    await pool.query("UPDATE offboarding_steps SET status='pending' WHERE offboarding_id=$1 AND key=$2", [id, req.params.key]);
    if (rows[0].ostatus !== "in_progress") await pool.query("UPDATE offboardings SET status='in_progress' WHERE id=$1", [id]);
    await runRemoval(id);
    res.json(await load(pool, id));
  }));

  return r;
}
