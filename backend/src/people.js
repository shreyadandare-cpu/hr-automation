// People: the directory and roster everyone sees, reporting lines and teams, employee IDs and status. Mounted by index.js.
import express from "express";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { mailPlanOf } from "./mail-plan.js";
import { can, canAll, invalidateTree, need, scopeOf } from "./access.js";

/**
 * Checks and saves one reporting-manager change (an empty manager clears it). The manager is found by email when one is given,
 * otherwise by name among current staff; a name two people share is refused, so nobody lands in the wrong team.
 * Saves the name (for older pages) and the email (what the reporting tree and every access decision use).
 * Returns { ok: true, manager } or { status, error }.
 */
async function applyManager(email, manager, actor, managerEmail = "") {
  const checked = await checkManager(email, manager, managerEmail);
  if (checked.error) return checked;
  const { boss } = checked;
  await pool.query("UPDATE employees SET manager=$1, manager_email=$2 WHERE lower(work_email)=$3", [boss ? boss.name : null, boss ? boss.email : null, email]);
  // Open reviews follow the new manager, so the old one no longer reads colleague feedback or writes the manager review.
  await pool.query("UPDATE reviews SET manager_email=$2 WHERE lower(email)=$1 AND status <> 'done'", [email, boss ? boss.email : null]);
  invalidateTree();
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)",
    [boss ? `Reporting manager set to ${boss.name} (by ${actor})` : `Reporting manager cleared (by ${actor})`, email]);
  return { ok: true, manager: boss ? boss.name : "", managerEmail: boss ? boss.email : "" };
}

/**
 * The checks for a reporting-manager change, without saving it (onboarding uses them too): the manager exists, is here, is one
 * person (a shared name is refused), is not the person, keeps the top of the company at the top, and makes no loop.
 * Returns { boss } (null to clear) or { status, error }.
 */
export async function checkManager(email, manager, managerEmail = "") {
  email = String(email).toLowerCase();
  const emp = (await pool.query("SELECT name, title, work_email FROM employees WHERE lower(work_email)=$1", [email])).rows[0];
  if (!emp) return { status: 404, error: "Employee not found." };
  let boss = null;
  if (managerEmail || manager) {
    const found = managerEmail
      ? (await pool.query("SELECT name, title, status, lower(work_email) AS email FROM employees WHERE lower(work_email)=$1", [String(managerEmail).toLowerCase()])).rows
      : (await pool.query("SELECT name, title, status, lower(work_email) AS email FROM employees WHERE lower(name)=lower($1) AND status <> 'offboarded'", [manager])).rows;
    if (!found.length) return { status: 400, error: `${manager || managerEmail} is not in the employee list.` };
    if (found.length > 1) return { status: 400, error: `Two people are called ${found[0].name}. Please choose the manager from the list so the right person is picked.` };
    boss = found[0];
    if (boss.status === "offboarded") return { status: 400, error: `${boss.name} has left, so cannot be a manager.` };
    if (boss.email === email) return { status: 400, error: "Nobody can be their own reporting manager." };
    // Directors and the Vice President report only to someone at the top too (for example the CEO, also a director).
    const top = (t) => /\b(director|vice president|ceo|chief executive)\b/i.test(t || "");
    if (top(emp.title) && !top(boss.title)) return { status: 400, error: `${emp.name} is at the top of the company, so they can only report to another director or the CEO.` };
    // Walk up from the new manager: reaching this person again would make a loop.
    let cur = boss.email;
    for (let i = 0; cur && i < 60; i++) {
      if (cur === email) return { status: 400, error: `${boss.name} already reports up to ${emp.name}, so that would make a loop.` };
      cur = (await pool.query("SELECT lower(manager_email) AS m FROM employees WHERE lower(work_email)=$1", [cur])).rows[0]?.m || "";
    }
  }
  return { boss };
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
  r.get("/api/roster", wrap(async (req, res) => {
    const scope = (await scopeOf(req, "people.view")), offs = canAll(req, "offboarding.manage"), me = req.user.email.toLowerCase();
    const sees = (email) => offs || !scope || scope.has(String(email).toLowerCase()) || String(email).toLowerCase() === me;
    const { rows } = await pool.query(
      `SELECT e.id, e.emp_no, e.name, e.work_email, e.title, e.sub_title, e.work_location, e.manager, e.manager_email, e.start_date, e.last_day, e.status, e.onboarding_closed_at, e.employment_type,
         (SELECT COALESCE(json_agg(json_build_object('project', p.name, 'lead', a.project_lead, 'location', a.location,
                                                     'status', a.status, 'start', a.start_date, 'end', a.end_date)
                                   ORDER BY (a.status = 'Active') DESC, p.name), '[]'::json)
          FROM employee_project_allocations a JOIN projects p ON p.id = a.project_id WHERE a.employee_id = e.id) AS projects,
         (SELECT extract(epoch FROM ph.updated_at)::bigint FROM profile_photos ph WHERE lower(ph.email) = lower(e.work_email)) AS photo_v,
         EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(e.work_email) AND u.login_blocked) AS login_off
       FROM employees e ORDER BY e.id`);
    res.json(rows.map((r) => ({ id: r.id, no: r.emp_no, name: r.name, email: r.work_email, title: r.title, subTitle: r.sub_title,
      location: r.work_location, manager: r.manager, managerEmail: r.manager_email || "", start: r.start_date,
      // Who is leaving, and when, is shown only to people who may see personal details for that person (and to the person).
      lastDay: sees(r.work_email) ? r.last_day : null, status: r.status === "offboarding" && !sees(r.work_email) ? "active" : r.status, onboarded: !!r.onboarding_closed_at, employmentType: r.employment_type, mailPlan: mailPlanOf(r.title), projects: r.projects, photoV: r.photo_v, loginOff: r.login_off })));
  }));

  // Who reports to whom, for everyone. Only the manager's name is sent, so this is safe for employees too.
  r.get("/api/managers", wrap(async (_req, res) => {
    const { rows } = await pool.query("SELECT work_email, manager, manager_email FROM employees WHERE (manager IS NOT NULL AND manager <> '') OR manager_email IS NOT NULL");
    res.json(rows.map((r) => ({ email: r.work_email, manager: r.manager, managerEmail: r.manager_email })));
  }));

  // Changing someone's reporting manager (or clearing it) takes "Edit people": for the whole company, or within a team, where the
  // new manager must also be in that team (or the person holding it), so nobody moves people out of the part they look after.
  r.put("/api/employees/manager", need("people.edit"), wrap(async (req, res) => {
    const email = String(req.body?.email || "").toLowerCase();
    const manager = String(req.body?.manager || "").trim(), managerEmail = String(req.body?.managerEmail || "").trim().toLowerCase();
    if (!(await can(req, "people.edit", email))) return res.status(403).json({ error: "This person is not in a team you look after." });
    if ((await scopeOf(req, "people.edit")) !== null && (manager || managerEmail)) {
      // Within a team: the new manager must be the caller, the person at the top of that team, or someone in it.
      const pick = managerEmail || (await pool.query("SELECT lower(work_email) AS e FROM employees WHERE lower(name)=lower($1) AND status <> 'offboarded'", [manager])).rows.map((x) => x.e);
      const list = Array.isArray(pick) ? pick : [pick];
      const roots = (req.access.grants || []).filter((g) => g.permission === "people.edit").map((g) => String(g.scope_root_email || req.access.email).toLowerCase());
      const ok = list.length === 1 && (list[0] === req.user.email.toLowerCase() || roots.includes(list[0]) || (await can(req, "people.edit", list[0])));
      if (!ok) return res.status(403).json({ error: "The new manager must be in a team you look after." });
    }
    const r = await applyManager(email, manager, req.user.email, managerEmail);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ email, manager: r.manager, managerEmail: r.managerEmail });
  }));

  // Someone with "Edit people" for this person corrects their employee ID (for example WT/17). It must be unique across the
  // company, and the change is recorded in the audit log.
  r.put("/api/employees/number", need("people.edit"), wrap(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!(await can(req, "people.edit", email))) return res.status(403).json({ error: "This person is not in a team you look after." });
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

  // Someone with "Edit people" for this person corrects their full name, job title and joining date. Saved on the server, so every page, the payroll list,
  // letters and the ID card show it and it survives a reload. The work email is not changed here: it is the person's sign-in and the key of their records.
  // People who report to them keep showing the right manager name.
  r.put("/api/employees/details", need("people.edit"), wrap(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!(await can(req, "people.edit", email))) return res.status(403).json({ error: "This person is not in a team you look after." });
    const name = String(req.body?.name || "").trim().replace(/\s+/g, " "), title = String(req.body?.title || "").trim(), start = String(req.body?.start || "").trim();
    if (name.length < 2 || name.length > 120) return res.status(400).json({ error: "Enter the employee's full name." });
    if (title.length > 120) return res.status(400).json({ error: "The job title is too long." });
    if (start && !(/^\d{4}-\d{2}-\d{2}$/.test(start) && !isNaN(new Date(`${start}T00:00:00`)))) return res.status(400).json({ error: "Enter a valid date of joining." });
    const emp = (await pool.query("SELECT id, name, title, to_char(start_date, 'YYYY-MM-DD') AS start FROM employees WHERE lower(work_email)=$1", [email])).rows[0];
    if (!emp) return res.status(404).json({ error: "Employee not found." });
    await pool.query("UPDATE employees SET name=$2, title=$3, start_date=$4 WHERE id=$1", [emp.id, name, title && title !== "—" ? title : null, start || null]);
    if (name !== emp.name) await pool.query("UPDATE employees SET manager=$2 WHERE lower(manager_email)=$1", [email, name]);
    invalidateTree();
    const changed = [name !== emp.name && `name ${emp.name} → ${name}`, (title || "") !== (emp.title || "") && "job title", (start || "") !== (emp.start || "") && "date of joining"].filter(Boolean);
    if (changed.length) await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Details changed by ${req.user.email}: ${changed.join(", ")}`, email]);
    res.json({ email, name, title: title || "", start });
  }));

  // Someone with "Edit people" for this person marks them, while still onboarding, as active. It is saved on the server, so
  // everyone sees it and it survives a page reload.
  r.put("/api/employees/status", need("people.edit"), wrap(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!(await can(req, "people.edit", email))) return res.status(403).json({ error: "This person is not in a team you look after." });
    const emp = (await pool.query("SELECT id, name, status FROM employees WHERE lower(work_email)=$1", [email])).rows[0];
    if (!emp) return res.status(404).json({ error: "Employee not found." });
    if (String(req.body?.status) !== "active") return res.status(400).json({ error: "Only the change from Onboarding to Active is allowed here." });
    if (emp.status === "offboarded") return res.status(400).json({ error: `${emp.name} has left, so the status cannot be changed here.` });
    await pool.query("UPDATE employees SET status='active', onboarding_closed_at=coalesce(onboarding_closed_at, now()) WHERE id=$1", [emp.id]);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Onboarding of ${emp.name} marked finished: status Active, by ${req.user.email}`, email]);
    res.json({ email, status: "active" });
  }));

  // A reporting manager (or someone who may edit people) adds a person who has no manager yet to their own team. Taking someone
  // out of another manager's team, or adding outside a team, needs "Edit people" for the whole company (the route above).
  r.post("/api/team/members", requireAuth, wrap(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const me = (await pool.query("SELECT name, status FROM employees WHERE lower(work_email)=$1", [req.user.email.toLowerCase()])).rows[0];
    if (!me || me.status === "offboarded") return res.status(403).json({ error: "Your employee record was not found." });
    // Built in for reporting managers (anyone with people reporting to them), as before; otherwise "Edit people" in any scope.
    const hasTeam = (await pool.query("SELECT 1 FROM employees WHERE lower(manager_email)=$1 AND status <> 'offboarded' LIMIT 1", [req.user.email.toLowerCase()])).rowCount > 0;
    if (!hasTeam && !(await can(req, "people.edit"))) return res.status(403).json({ error: "Only managers and people given access can add team members." });
    const emp = (await pool.query("SELECT name, manager, manager_email, status FROM employees WHERE lower(work_email)=$1", [email])).rows[0];
    if (!emp) return res.status(404).json({ error: "Employee not found." });
    if (emp.status === "offboarded") return res.status(400).json({ error: `${emp.name} has left, so cannot join a team.` });
    const company = (await scopeOf(req, "people.edit")) === null;
    if (!company && (emp.manager || emp.manager_email)) return res.status(403).json({ error: `${emp.name} already reports to ${emp.manager}. Please ask HR to move them.` });
    if (!company) {
      // Within a team: nobody with access of their own (or a super admin) can be pulled into it, since that would put them under
      // the caller's team permissions (salaries, documents, approvals).
      const strong = await pool.query(
        `SELECT 1 FROM users u WHERE lower(u.email)=$1 AND (u.is_super_admin OR EXISTS (SELECT 1 FROM access_grants g WHERE lower(g.email)=$1 AND g.revoked_at IS NULL))`, [email]);
      if (strong.rowCount) return res.status(403).json({ error: `${emp.name} has access of their own, so please ask a super admin or HR to set their manager.` });
    }
    const r = await applyManager(email, "", req.user.email, req.user.email.toLowerCase());
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ email, manager: r.manager, managerEmail: r.managerEmail });
  }));
  return r;
}
