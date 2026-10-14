import { pool, withTx } from "./db.js";
import { writeAudit, verifyChain } from "./audit.js";
import { grant, revoke, check } from "./connectors.js";
import { OFF_TASKS, ON_TASKS, BUNDLES, bundleKey } from "./rules.js";

const bundleApps = (department) => BUNDLES[bundleKey(department)];

// Plain names for the audit log, so people read "Google Workspace" rather than a code.
const NAME = { gws: "Google Workspace", gemini: "Gemini", claude: "Claude", github: "GitHub", gcp: "Google Cloud" };
const nameOf = (app) => NAME[app] ?? app;

// Only Wohlig staff may use this system. Anyone else is refused before the role is even checked.
export const COMPANY_DOMAIN = "@wohlig.com";
export const isWohligEmail = (email) =>
  typeof email === "string" && /^[^@\s]+@wohlig\.com$/i.test(email.trim());

// Only HR admins and IT admins may use the system at all. Anyone else, including old viewer accounts, is refused.
export async function requireStaff(actor) {
  if (!isWohligEmail(actor)) throw new Error(`${actor} is not a Wohlig email; only @wohlig.com accounts can use this system`);
  return roleOf(actor);
}

// admin = HR admin, it = IT admin, employee = any other @wohlig.com person (view only).
export async function roleOf(actor) {
  if (!isWohligEmail(actor)) return null;
  const { rows } = await pool.query("SELECT role FROM hr_users WHERE email = $1", [actor]);
  return rows[0] ? rows[0].role : "employee";
}

// Role check: every action names the caller. HR admins change access; IT admins only tick checklist items.
async function requireRole(c, actor, allowed) {
  if (!isWohligEmail(actor)) throw new Error(`${actor} is not a Wohlig email; only @wohlig.com accounts can use this system`);
  const { rows } = await c.query("SELECT role FROM hr_users WHERE email = $1", [actor]);
  const role = rows[0] ? rows[0].role : "employee";
  if (!allowed.includes(role)) throw new Error(`${role === "employee" ? "employees can view only" : "role '" + role + "'"} cannot do this`);
}

async function loadEmployee(c, id) {
  const { rows } = await c.query("SELECT * FROM employees WHERE id = $1", [id]);
  if (!rows[0]) throw new Error(`employee ${id} not found`);
  return rows[0];
}

const MAX_ATTEMPTS = 3;

// Who may change things: HR admin and IT admin. Everyone else can view only.
const EDITORS = ["admin", "it"];

// Emergency stop: while paused, no tool is touched. Records can still be read and checklists ticked.
async function assertNotPaused(c) {
  const { rows } = await c.query("SELECT value FROM settings WHERE key='automation_paused'");
  if (rows[0]?.value === "true") {
    throw new Error("Automatic changes are paused. Use the manual runbook, or resume automation.");
  }
}

export async function getPaused() {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='automation_paused'");
  return { paused: rows[0]?.value === "true" };
}

export async function setPaused({ actor, paused }) {
  return withTx(async (c) => {
    await requireRole(c, actor, ["admin"]);
    await c.query("UPDATE settings SET value=$1 WHERE key='automation_paused'", [String(paused)]);
    await writeAudit(c, { actor, action: paused ? "Automation paused (emergency stop)" : "Automation resumed", result: "info" });
    return { paused };
  });
}

export async function listEmployees({ status } = {}) {
  const { rows } = await pool.query(
    `SELECT id, emp_no, full_name, work_email, job_title, department,
            to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(last_working_day,'YYYY-MM-DD') AS last_working_day, status
     FROM employees WHERE ($1::text IS NULL OR status = $1) ORDER BY id`,
    [status ?? null],
  );
  return rows;
}

export async function getEmployee(id) {
  const { rows: [emp] } = await pool.query(
    `SELECT id, emp_no, full_name, work_email, job_title, department, status, created_at,
            to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(last_working_day,'YYYY-MM-DD') AS last_working_day
     FROM employees WHERE id = $1`, [id]);
  if (!emp) throw new Error(`employee ${id} not found`);
  const { rows: grants } = await pool.query(
    `SELECT g.app_code, a.name, g.status, g.external_id, g.error FROM access_grants g
     JOIN applications a ON a.code = g.app_code WHERE g.employee_id = $1 ORDER BY a.phase, g.app_code`, [id]);
  const { rows: checklist } = await pool.query(
    "SELECT id, phase, title, done, done_by, done_at FROM checklist_items WHERE employee_id = $1 ORDER BY id", [id]);
  return { ...emp, grants, checklist };
}

// Turn on each tool for a joiner, one at a time. A failed tool stays failed and is flagged.
export async function confirmOnboarding({ actor, employeeId }) {
  return withTx(async (c) => {
    await requireRole(c, actor, EDITORS);
    await assertNotPaused(c);
    const emp = await loadEmployee(c, employeeId);
    if (emp.status !== "onboarding") throw new Error(`${emp.full_name} is ${emp.status}, so there is nothing to onboard`);
    const { rows: pending } = await c.query(
      "SELECT app_code, attempts FROM access_grants WHERE employee_id = $1 AND status IN ('none','failed') ORDER BY app_code", [employeeId]);
    const results = [];
    for (const { app_code: app, attempts } of pending) {
      if (attempts >= MAX_ATTEMPTS) {
        results.push({ app, status: "needs_manual", error: `gave up after ${MAX_ATTEMPTS} attempts; fix this tool by hand` });
        continue;
      }
      await c.query("UPDATE access_grants SET status='provisioning', attempts=attempts+1, updated_at=now() WHERE employee_id=$1 AND app_code=$2", [employeeId, app]);
      try {
        const externalId = await grant(app, emp);
        await c.query("UPDATE access_grants SET status='active', external_id=$3, error=NULL, updated_at=now() WHERE employee_id=$1 AND app_code=$2", [employeeId, app, externalId]);
        await writeAudit(c, { actor, action: `${nameOf(app)} access granted`, employeeId, appCode: app, result: "ok" });
        results.push({ app, status: "active" });
      } catch (err) {
        await c.query("UPDATE access_grants SET status='failed', error=$3, updated_at=now() WHERE employee_id=$1 AND app_code=$2", [employeeId, app, err.message]);
        await writeAudit(c, { actor, action: `${nameOf(app)} access failed`, employeeId, appCode: app, result: "fail", detail: { error: err.message } });
        results.push({ app, status: "failed", error: err.message });
      }
    }
    await closeIfComplete(c, actor, emp);
    return results;
  });
}

export async function tickChecklist({ actor, itemId, done }) {
  return withTx(async (c) => {
    await requireRole(c, actor, EDITORS);
    const { rows: [item] } = await c.query(
      "UPDATE checklist_items SET done=$2, done_by=$3, done_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1 RETURNING *", [itemId, done, actor]);
    if (!item) throw new Error(`checklist item ${itemId} not found`);
    await writeAudit(c, { actor, action: `Checklist: ${item.title} ${done ? "ticked" : "unticked"}`, employeeId: item.employee_id, result: "ok" });
    const emp = await loadEmployee(c, item.employee_id);
    await closeIfComplete(c, actor, emp);
    return item;
  });
}

// Onboarding closes to active when every tool is active and every item is ticked.
// Offboarding closes to offboarded only when every tool is confirmed removed and every item is ticked.
async function closeIfComplete(c, actor, emp) {
  if (emp.status === "onboarding") {
    const { rows: [open] } = await c.query(
      `SELECT (SELECT count(*) FROM access_grants WHERE employee_id=$1 AND status<>'active')::int AS grants_open,
              (SELECT count(*) FROM checklist_items WHERE employee_id=$1 AND phase='onboarding' AND NOT done)::int AS items_open`, [emp.id]);
    if (open.grants_open === 0 && open.items_open === 0) {
      await c.query("UPDATE employees SET status='active' WHERE id=$1", [emp.id]);
      await writeAudit(c, { actor, action: "Onboarding completed", employeeId: emp.id, result: "ok" });
    }
  } else if (emp.status === "offboarding") {
    const { rows: [open] } = await c.query(
      `SELECT (SELECT count(*) FROM access_grants WHERE employee_id=$1 AND status NOT IN ('revoked','none'))::int AS grants_open,
              (SELECT count(*) FROM checklist_items WHERE employee_id=$1 AND phase='offboarding' AND NOT done)::int AS items_open`, [emp.id]);
    if (open.grants_open === 0 && open.items_open === 0) {
      await c.query("UPDATE employees SET status='offboarded' WHERE id=$1", [emp.id]);
      await writeAudit(c, { actor, action: "Offboarding completed", employeeId: emp.id, result: "ok" });
    }
  }
}

// One confirmed action: Google first (blocks sign-in), then every other active tool.
export async function offboard({ actor, employeeId, lastDay, nominee }) {
  return withTx(async (c) => {
    if (actor !== "system") await requireRole(c, actor, EDITORS);
    await assertNotPaused(c);
    const emp = await loadEmployee(c, employeeId);
    if (emp.status === "offboarded") throw new Error("already offboarded");
    await c.query("UPDATE employees SET status='offboarding', last_working_day=COALESCE($2::date, last_working_day) WHERE id=$1", [employeeId, lastDay ?? null]);
    for (const t of OFF_TASKS) {
      await c.query("INSERT INTO checklist_items (employee_id, phase, title) VALUES ($1,'offboarding',$2)", [employeeId, t]);
    }
    await writeAudit(c, { actor, action: "Offboarding started", employeeId, result: "ok", detail: { nominee: nominee ?? null } });
    const { rows: live } = await c.query(
      `SELECT g.app_code FROM access_grants g JOIN applications a ON a.code=g.app_code
       WHERE g.employee_id=$1 AND g.status IN ('active','failed') ORDER BY (g.app_code='gws') DESC, a.phase, g.app_code`, [employeeId]);
    const results = [];
    for (const { app_code: app } of live) {
      await c.query("UPDATE access_grants SET status='revoking', updated_at=now() WHERE employee_id=$1 AND app_code=$2", [employeeId, app]);
      try {
        await revoke(app, emp);
        // Do not trust the request: ask the tool whether access is really gone.
        if (await check(app, emp)) throw new Error(`${app}: access is still present after removal`);
        await c.query("UPDATE access_grants SET status='revoked', error=NULL, updated_at=now() WHERE employee_id=$1 AND app_code=$2", [employeeId, app]);
        await writeAudit(c, { actor, action: app === "gws" ? "Google Workspace account suspended" : `${nameOf(app)} access removed`, employeeId, appCode: app, result: "ok" });
        results.push({ app, status: "revoked" });
      } catch (err) {
        await c.query("UPDATE access_grants SET status='failed', error=$3, updated_at=now() WHERE employee_id=$1 AND app_code=$2", [employeeId, app, err.message]);
        await writeAudit(c, { actor, action: `${nameOf(app)} removal failed`, employeeId, appCode: app, result: "fail", detail: { error: err.message } });
        results.push({ app, status: "failed", error: err.message });
      }
    }
    return results;
  });
}

export async function listAudit({ employeeId, limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT a.ts, a.actor, a.action, a.employee_id, e.full_name AS employee, a.app_code, a.result
     FROM audit_log a LEFT JOIN employees e ON e.id = a.employee_id
     WHERE ($1::int IS NULL OR a.employee_id = $1)
       AND a.actor NOT LIKE 'test-%'
       AND (e.full_name IS NULL OR e.full_name NOT LIKE 'TEST %')
     ORDER BY a.id DESC LIMIT $2`, [employeeId ?? null, limit]);
  return rows;
}

export async function checkAudit() {
  const c = await pool.connect();
  try { return await verifyChain(c); } finally { c.release(); }
}

// New joiner from the onboarding form. Creates the record, the bundle's tool rows (not yet granted)
// and the onboarding checklist. Nothing is switched on until confirmOnboarding.
export async function createEmployee({ actor, fullName, department, jobTitle, startDate, workEmail }) {
  return withTx(async (c) => {
    await requireRole(c, actor, EDITORS);
    if (!isWohligEmail(workEmail)) throw new Error("work email must end in @wohlig.com");
    const { rows: [dup] } = await c.query("SELECT id FROM employees WHERE work_email = $1", [workEmail]);
    if (dup) throw new Error(`${workEmail} already exists (employee ${dup.id})`);
    const { rows: [emp] } = await c.query(
      `INSERT INTO employees (full_name, work_email, job_title, department, start_date, status)
       VALUES ($1,$2,$3,$4,$5,'onboarding') RETURNING *`,
      [fullName, workEmail, jobTitle ?? null, department, startDate]);
    for (const app of bundleApps(department)) {
      await c.query("INSERT INTO access_grants (employee_id, app_code, status) VALUES ($1,$2,'none')", [emp.id, app]);
    }
    for (const t of ON_TASKS) {
      await c.query("INSERT INTO checklist_items (employee_id, phase, title) VALUES ($1,'onboarding',$2)", [emp.id, t]);
    }
    await writeAudit(c, { actor, action: "Employee record created", employeeId: emp.id, result: "ok" });
    return emp;
  });
}

// Everything the page needs in one call: people, tool access and checklists.
// Dates are sent as plain YYYY-MM-DD so no time-zone shift can change the day.
export async function getRoster() {
  const { rows: emps } = await pool.query(
    `SELECT id, emp_no, full_name, work_email, job_title, department,
            to_char(start_date,'YYYY-MM-DD') AS start_date,
            to_char(last_working_day,'YYYY-MM-DD') AS last_working_day, status
     FROM employees ORDER BY id`);
  const { rows: grants } = await pool.query("SELECT employee_id, app_code, status, error FROM access_grants");
  const { rows: items } = await pool.query("SELECT id, employee_id, phase, title, done FROM checklist_items ORDER BY id");
  const byEmp = (rows) => rows.reduce((m, r) => ((m[r.employee_id] ??= []).push(r), m), {});
  const g = byEmp(grants), k = byEmp(items);
  return emps.map((e) => ({
    ...e,
    grants: Object.fromEntries((g[e.id] ?? []).map((x) => [x.app_code, { status: x.status, error: x.error }])),
    checklist: (k[e.id] ?? []).map((x) => ({ id: x.id, phase: x.phase, title: x.title, done: x.done })),
  }));
}


// Nightly safety net: re-check every leaver in every tool. Anyone still found is flagged and the case reopens.
export async function reconcileOffboarded({ actor = "system" } = {}) {
  return withTx(async (c) => {
    if (actor !== "system") await requireRole(c, actor, EDITORS);
    const { rows: people } = await c.query("SELECT * FROM employees WHERE status IN ('offboarding','offboarded') ORDER BY id");
    const leftovers = [];
    for (const emp of people) {
      const { rows: grants } = await c.query("SELECT app_code FROM access_grants WHERE employee_id=$1 AND status <> 'none'", [emp.id]);
      for (const { app_code: app } of grants) {
        if (await check(app, emp)) {
          leftovers.push({ employee_id: emp.id, name: emp.full_name, app });
          await c.query("UPDATE access_grants SET status='failed', error='access still present (found by nightly check)', updated_at=now() WHERE employee_id=$1 AND app_code=$2", [emp.id, app]);
          await c.query("UPDATE employees SET status='offboarding' WHERE id=$1", [emp.id]);
          await writeAudit(c, { actor, action: `${nameOf(app)} still has access (nightly check)`, employeeId: emp.id, appCode: app, result: "fail" });
        }
      }
    }
    await writeAudit(c, { actor, action: "Nightly access check finished", result: leftovers.length ? "fail" : "ok", detail: { checked: people.length, leftovers: leftovers.length } });
    return { checked: people.length, leftovers };
  });
}


// Records a future leaving date. The person keeps working and their access stays on until that day.
export async function scheduleLeaving({ actor, employeeId, lastDay }) {
  return withTx(async (c) => {
    await requireRole(c, actor, EDITORS);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay ?? "")) throw new Error("last working day must look like 2026-10-31");
    const emp = await loadEmployee(c, employeeId);
    if (emp.status !== "active") throw new Error(`${emp.full_name} is ${emp.status}; only active people can be scheduled to leave`);
    await c.query("UPDATE employees SET last_working_day=$2 WHERE id=$1", [employeeId, lastDay]);
    await writeAudit(c, { actor, action: `Leaving scheduled for ${lastDay}`, employeeId, result: "info" });
    return { employee_id: employeeId, last_working_day: lastDay };
  });
}

// Today's date in India time, as YYYY-MM-DD. The company works in IST.
export function todayIST(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

// Daily job: offboards every active person whose last working day is today or earlier.
// Each person is offboarded in their own transaction, so one failure does not stop the rest.
export async function runScheduledOffboarding({ today = todayIST() } = {}) {
  const paused = await assertPausedOff();
  if (paused) return { today, skipped: paused.skipped, offboarded: [] };
  const { rows } = await pool.query(
    "SELECT id, full_name FROM employees WHERE status='active' AND last_working_day IS NOT NULL AND last_working_day <= $1 ORDER BY last_working_day, id",
    [today]);
  const done = [];
  for (const emp of rows) {
    try {
      const results = await offboard({ actor: "system", employeeId: emp.id });
      done.push({ employee_id: emp.id, name: emp.full_name, tools: results.length, failed: results.filter((r) => r.status === "failed").length });
    } catch (err) {
      done.push({ employee_id: emp.id, name: emp.full_name, error: err.message });
    }
  }
  return { today, offboarded: done };
}

async function assertPausedOff() {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='automation_paused'");
  if (rows[0]?.value === "true") return { skipped: "automation is paused" };
  return null;
}


// Tells the page who is signed in and what role they have. Never reveals data.
export async function whoami(actor) {
  if (!isWohligEmail(actor)) return { email: actor, role: null };
  const { rows } = await pool.query("SELECT role FROM hr_users WHERE email = $1", [actor]);
  return { email: actor, role: rows[0] && ["admin", "it"].includes(rows[0].role) ? rows[0].role : null };
}
