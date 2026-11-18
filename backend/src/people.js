// People: the directory and roster everyone sees, reporting lines and teams, employee IDs and status. Mounted by index.js.
import express from "express";
import { pool } from "./db.js";
import { requireAuth, requireHr } from "./auth.js";
import { mailPlanOf } from "./mail-plan.js";

/** Checks and saves one reporting-manager change (an empty manager clears it). Returns { ok: true } or { status, error }. */
async function applyManager(email, manager, actor) {
  const emp = (await pool.query("SELECT name, title FROM employees WHERE lower(work_email)=$1", [email])).rows[0];
  if (!emp) return { status: 404, error: "Employee not found." };
  // Directors and the Vice President are at the top of the company, so nobody is above them.
  if (manager && /\b(director|vice president)\b/i.test(emp.title || "")) {
    return { status: 400, error: `${emp.name} is at the top of the company and has no reporting manager.` };
  }
  if (manager) {
    const boss = (await pool.query("SELECT name, status FROM employees WHERE lower(name)=lower($1) LIMIT 1", [manager])).rows[0];
    if (!boss) return { status: 400, error: `${manager} is not in the employee list.` };
    if (boss.status === "offboarded") return { status: 400, error: `${boss.name} has left, so cannot be a manager.` };
    // Walk up from the new manager: reaching this person again would make a loop.
    let cur = boss.name;
    for (let i = 0; cur && i < 50; i++) {
      if (cur.toLowerCase() === emp.name.toLowerCase()) {
        return { status: 400, error: cur === boss.name && boss.name.toLowerCase() === emp.name.toLowerCase()
          ? "Nobody can be their own reporting manager."
          : `${boss.name} already reports up to ${emp.name}, so that would make a loop.` };
      }
      cur = (await pool.query("SELECT manager FROM employees WHERE lower(name)=lower($1) LIMIT 1", [cur])).rows[0]?.manager || "";
    }
  }
  await pool.query("UPDATE employees SET manager=$1 WHERE lower(work_email)=$2", [manager || null, email]);
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)",
    [manager ? `Reporting manager set to ${manager} (by ${actor})` : `Reporting manager cleared (by ${actor})`, email]);
  return { ok: true };
}

export function peopleRouter(wrap) {
  const r = express.Router();
  // Everyone signed in can see who is at the company. Only non-personal fields are sent, so this is safe for employees.
  r.get("/api/directory", wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT work_email, name, dept, title, manager, start_date, status, apps FROM employees
       WHERE onboarded_at IS NOT NULL OR google_status IS NOT NULL ORDER BY created_at`);
    res.json(rows.map((r) => ({ email: r.work_email, name: r.name, dept: r.dept, title: r.title, manager: r.manager,
      start: r.start_date, status: r.status, apps: r.apps })));
  }));

  // The company roster, for everyone signed in. Only non-personal fields are sent, so this is safe for employees too.
  r.get("/api/roster", wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT e.id, e.emp_no, e.name, e.work_email, e.title, e.sub_title, e.work_location, e.manager, e.start_date, e.last_day, e.status, e.onboarding_closed_at, e.employment_type,
         (SELECT COALESCE(json_agg(json_build_object('project', p.name, 'lead', a.project_lead, 'location', a.location,
                                                     'status', a.status, 'start', a.start_date, 'end', a.end_date)
                                   ORDER BY (a.status = 'Active') DESC, p.name), '[]'::json)
          FROM employee_project_allocations a JOIN projects p ON p.id = a.project_id WHERE a.employee_id = e.id) AS projects,
         (SELECT extract(epoch FROM ph.updated_at)::bigint FROM profile_photos ph WHERE lower(ph.email) = lower(e.work_email)) AS photo_v
       FROM employees e ORDER BY e.id`);
    res.json(rows.map((r) => ({ id: r.id, no: r.emp_no, name: r.name, email: r.work_email, title: r.title, subTitle: r.sub_title,
      location: r.work_location, manager: r.manager, start: r.start_date, lastDay: r.last_day, status: r.status, onboarded: !!r.onboarding_closed_at, employmentType: r.employment_type, mailPlan: mailPlanOf(r.title), projects: r.projects, photoV: r.photo_v })));
  }));

  // Who reports to whom, for everyone. Only the manager's name is sent, so this is safe for employees too.
  r.get("/api/managers", wrap(async (_req, res) => {
    const { rows } = await pool.query("SELECT work_email, manager FROM employees WHERE manager IS NOT NULL AND manager <> ''");
    res.json(rows.map((r) => ({ email: r.work_email, manager: r.manager })));
  }));

  // HR changes anyone's reporting manager (or clears it with an empty name).
  r.put("/api/employees/manager", requireHr, wrap(async (req, res) => {
    const email = String(req.body?.email || "").toLowerCase();
    const manager = String(req.body?.manager || "").trim();
    const r = await applyManager(email, manager, req.user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ email, manager });
  }));

  // HR corrects someone's employee ID (for example WT/17). It must be unique, and the change is recorded in the audit log.
  r.put("/api/employees/number", requireHr, wrap(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const no = String(req.body?.number || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9/._-]{0,19}$/.test(no)) return res.status(400).json({ error: "Use letters, numbers and / . _ - only, up to 20 characters, for example WT/17." });
    const emp = (await pool.query("SELECT id, name, emp_no FROM employees WHERE lower(work_email)=$1", [email])).rows[0];
    if (!emp) return res.status(404).json({ error: "Employee not found." });
    if (emp.emp_no === no) return res.json({ email, number: no });
    const dup = (await pool.query("SELECT name FROM employees WHERE lower(emp_no)=lower($1) AND id<>$2", [no, emp.id])).rows[0];
    if (dup) return res.status(409).json({ error: `${no} already belongs to ${dup.name}. Employee IDs must be different.` });
    await pool.query("UPDATE employees SET emp_no=$2 WHERE id=$1", [emp.id, no]);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Employee ID of ${emp.name} changed from ${emp.emp_no || "none"} to ${no} by ${req.user.email}`, email]);
    res.json({ email, number: no });
  }));

  // HR marks someone who is still onboarding as active. It is saved on the server, so everyone sees it and it survives a page reload.
  r.put("/api/employees/status", requireHr, wrap(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const emp = (await pool.query("SELECT id, name, status FROM employees WHERE lower(work_email)=$1", [email])).rows[0];
    if (!emp) return res.status(404).json({ error: "Employee not found." });
    if (String(req.body?.status) !== "active") return res.status(400).json({ error: "Only the change from Onboarding to Active is allowed here." });
    if (emp.status === "offboarded") return res.status(400).json({ error: `${emp.name} has left, so the status cannot be changed here.` });
    await pool.query("UPDATE employees SET status='active', onboarding_closed_at=coalesce(onboarding_closed_at, now()) WHERE id=$1", [emp.id]);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Onboarding of ${emp.name} marked finished: status Active, by ${req.user.email}`, email]);
    res.json({ email, status: "active" });
  }));

  // A manager adds someone to their OWN team. Allowed for anyone who already has people reporting to them (and for HR). The person
  // must have no manager yet: taking someone out of another manager's team is HR's call. The same checks apply (no loops, no top of the company).
  r.post("/api/team/members", requireAuth, wrap(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const me = (await pool.query("SELECT name, status FROM employees WHERE lower(work_email)=$1", [req.user.email.toLowerCase()])).rows[0];
    if (!me || me.status === "offboarded") return res.status(403).json({ error: "Your employee record was not found." });
    const isHr = req.user.role === "hr";
    const hasTeam = (await pool.query("SELECT 1 FROM employees WHERE lower(manager)=lower($1) AND status <> 'offboarded' LIMIT 1", [me.name])).rowCount > 0;
    if (!isHr && !hasTeam) return res.status(403).json({ error: "Only managers and HR can add team members." });
    const emp = (await pool.query("SELECT name, manager, status FROM employees WHERE lower(work_email)=$1", [email])).rows[0];
    if (!emp) return res.status(404).json({ error: "Employee not found." });
    if (emp.status === "offboarded") return res.status(400).json({ error: `${emp.name} has left, so cannot join a team.` });
    if (!isHr && emp.manager) return res.status(403).json({ error: `${emp.name} already reports to ${emp.manager}. Ask HR to move them.` });
    const r = await applyManager(email, me.name, req.user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ email, manager: me.name });
  }));
  return r;
}
