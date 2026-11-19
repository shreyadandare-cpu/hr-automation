// Projects and who is allocated to them. HR, managers and project leads start projects; HR or the lead manages members.
// Mounted by index.js.
import express from "express";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { canAll, scopeOf } from "./access.js";

// Who the signed-in person is for project work: "Edit people" for the whole company (isHr), a manager (has a team) or a project lead may start projects; HR or a project's lead manages its members.
async function projectActor(req) {
  const me = (await pool.query("SELECT name, status FROM employees WHERE lower(work_email)=$1", [req.user.email.toLowerCase()])).rows[0];
  const isHr = canAll(req, "people.edit"), name = me?.name || "";
  const lead = name ? (await pool.query("SELECT 1 FROM projects WHERE lower(project_lead)=lower($1) LIMIT 1", [name])).rowCount > 0 : false;
  const hasTeam = (await pool.query("SELECT 1 FROM employees WHERE lower(manager_email)=$1 AND status <> 'offboarded' LIMIT 1", [req.user.email.toLowerCase()])).rowCount > 0;
  return { isHr, name, canCreate: isHr || hasTeam || lead };
}
// A project is closed once it is marked Completed or its end date has passed. Closed projects cannot be changed by anyone.
const isClosed = (p) => p.status === "Completed" || (!!p.end_date && String(p.end_date instanceof Date ? p.end_date.toISOString() : p.end_date).slice(0, 10) < new Date().toISOString().slice(0, 10));
const CLOSED_MSG = "This project is closed, so it can no longer be changed.";
// HR and the project's lead can take people off a project or hand their work over.
const canManageProject = (actor, project) => actor.isHr || (!!actor.name && String(project.project_lead || "").toLowerCase() === actor.name.toLowerCase());

export function projectsRouter(wrap) {
  const r = express.Router();
  // Every project (even ones nobody is on yet) and every allocation, for everyone signed in. `canManage` says whether this person may add people to a project.
  r.get("/api/allocations", wrap(async (req, res) => {
    const actor = await projectActor(req);
    // "Left the company" as an end reason tells who left; it is shown only to people who may see that person's details.
    const pv = await scopeOf(req, "people.view"), me = req.user.email.toLowerCase();
    const leaveSeen = (email) => canAll(req, "offboarding.manage") || !pv || pv.has(String(email).toLowerCase()) || String(email).toLowerCase() === me;
    const { rows } = await pool.query(
      `SELECT a.id, p.id AS project_id, p.name AS project, e.name AS employee, e.work_email AS email, e.emp_no,
              a.start_date, a.end_date, coalesce(a.project_lead, p.project_lead) AS lead, a.location, a.status,
              a.handover_to AS handed_over_to, a.transferred_to AS moved_to, a.end_reason
       FROM employee_project_allocations a
       JOIN projects p ON p.id = a.project_id JOIN employees e ON e.id = a.employee_id
       ORDER BY p.name, e.name`);
    const projects = (await pool.query("SELECT id, name, project_lead, start_date, end_date, status, description, location FROM projects ORDER BY name")).rows;
    res.json({
      canCreate: actor.canCreate,
      projects: projects.map((p) => ({ id: p.id, name: p.name, lead: p.project_lead, start: p.start_date, end: p.end_date, status: p.status,
        description: p.description, location: p.location, closed: isClosed(p), canManage: !isClosed(p) && canManageProject(actor, p), canHandover: !isClosed(p) && canManageProject(actor, p) })),
      rows: rows.map((r) => ({ id: r.id, projectId: r.project_id, project: r.project, employee: r.employee, email: r.email, no: r.emp_no,
        start: r.start_date, end: r.end_date, lead: r.lead, location: r.location, status: r.status, handedOverTo: r.handed_over_to, movedTo: r.moved_to, endReason: r.end_reason === "Left the company" && !leaveSeen(r.email) ? null : r.end_reason })),
    });
  }));

  // Start a project. HR picks the lead; a manager's own projects are led by them.
  r.post("/api/projects", requireAuth, wrap(async (req, res) => {
    const actor = await projectActor(req);
    if (!actor.canCreate) return res.status(403).json({ error: "Only HR and managers can add projects." });
    const name = String(req.body?.name || "").trim();
    if (!name || name.length > 120) return res.status(400).json({ error: "Give the project a name (up to 120 characters)." });
    if ((await pool.query("SELECT 1 FROM projects WHERE lower(name)=lower($1)", [name])).rowCount) return res.status(409).json({ error: "A project with this name already exists." });
    let lead = actor.name;
    if (actor.isHr) {
      lead = String(req.body?.lead || "").trim();
      if (lead && !(await pool.query("SELECT 1 FROM employees WHERE lower(name)=lower($1) AND status <> 'offboarded'", [lead])).rowCount) return res.status(400).json({ error: "The project lead must be a current employee." });
    }
    const start = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.start || "") ? req.body.start : null;
    const description = String(req.body?.description || "").trim().slice(0, 500) || null;
    const location = String(req.body?.location || "").trim().slice(0, 80) || null;
    const emails = [...new Set((Array.isArray(req.body?.members) ? req.body.members : []).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean))].slice(0, 200);
    const client = await pool.connect();
    let id, added = 0; const skipped = [];
    try {
      await client.query("BEGIN");
      id = (await client.query("INSERT INTO projects (name, project_lead, start_date, description, location) VALUES ($1,$2,$3,$4,$5) RETURNING id", [name, lead || null, start, description, location])).rows[0].id;
      // People chosen in the form are put on the project straight away, at the project's location unless they work elsewhere on record.
      for (const email of emails) {
        const emp = (await client.query("SELECT id, name, status, work_location FROM employees WHERE lower(work_email)=$1", [email])).rows[0];
        if (!emp || emp.status === "offboarded") { skipped.push(emp ? emp.name : email); continue; }
        await client.query("INSERT INTO employee_project_allocations (employee_id, project_id, start_date, project_lead, location, status) VALUES ($1,$2,$3,$4,$5,'Active')",
          [emp.id, id, start || new Date().toISOString().slice(0, 10), lead || null, location || emp.work_location || null]);
        added++;
      }
      await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Project "${name}" added${lead ? `, led by ${lead}` : ""}${location ? `, at ${location}` : ""}${added ? `, ${added} ${added === 1 ? "person" : "people"} added` : ""}`, req.user.email]);
      await client.query("COMMIT");
    } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
    res.json({ id, added, skipped });
  }));

  // Change a project's end date (empty clears it). HR, or the project's lead. A date that has passed marks the project Completed.
  r.patch("/api/projects/:id", requireAuth, wrap(async (req, res) => {
    const actor = await projectActor(req);
    const project = (await pool.query("SELECT id, name, project_lead, status, end_date, to_char(start_date,'YYYY-MM-DD') AS start FROM projects WHERE id=$1", [Number(req.params.id) || 0])).rows[0];
    if (!project) return res.status(404).json({ error: "Project not found." });
    if (!canManageProject(actor, project)) return res.status(403).json({ error: "Only HR or the project lead can change the end date." });
    if (isClosed(project)) return res.status(400).json({ error: CLOSED_MSG });
    const raw = String(req.body?.end || "").trim();
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return res.status(400).json({ error: "Give the end date as a valid date." });
    if (raw && project.start && raw < project.start) return res.status(400).json({ error: "The end date cannot be before the start date." });
    const today = new Date().toISOString().slice(0, 10);
    const done = !!raw && raw <= today;
    await pool.query("UPDATE projects SET end_date=$2, status=$3 WHERE id=$1", [project.id, raw || null, done ? "Completed" : "Active"]);
    // Closing a project ends everyone's current allocation on it, so it drops off their Employees entry too.
    if (done) await pool.query("UPDATE employee_project_allocations SET status='Ended', end_date=coalesce(end_date, $2) WHERE project_id=$1 AND status='Active'", [project.id, raw]);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [raw ? `Project "${project.name}" end date set to ${raw}` : `Project "${project.name}" end date cleared`, req.user.email]);
    res.json({ ok: true });
  }));

  // Put someone on a project. HR, or the project's lead.
  r.post("/api/projects/:id/members", requireAuth, wrap(async (req, res) => {
    const actor = await projectActor(req);
    const project = (await pool.query("SELECT id, name, project_lead, status, end_date, location FROM projects WHERE id=$1", [Number(req.params.id) || 0])).rows[0];
    if (!project) return res.status(404).json({ error: "Project not found." });
    if (!canManageProject(actor, project)) return res.status(403).json({ error: "Only HR or the project lead can add people to this project." });
    if (isClosed(project)) return res.status(400).json({ error: CLOSED_MSG });
    const emp = (await pool.query("SELECT id, name, status, work_location FROM employees WHERE lower(work_email)=$1", [String(req.body?.email || "").trim().toLowerCase()])).rows[0];
    if (!emp) return res.status(404).json({ error: "Employee not found." });
    if (emp.status === "offboarded") return res.status(400).json({ error: `${emp.name} has left, so cannot join a project.` });
    if ((await pool.query("SELECT 1 FROM employee_project_allocations WHERE project_id=$1 AND employee_id=$2 AND status='Active'", [project.id, emp.id])).rowCount)
      return res.status(409).json({ error: `${emp.name} is already on ${project.name}.` });
    const start = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.start || "") ? req.body.start : new Date().toISOString().slice(0, 10);
    const location = String(req.body?.location || "").trim().slice(0, 80) || project.location || emp.work_location || null;
    await pool.query(`INSERT INTO employee_project_allocations (employee_id, project_id, start_date, project_lead, location, status) VALUES ($1,$2,$3,$4,$5,'Active')`,
      [emp.id, project.id, start, project.project_lead, location]);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`${emp.name} added to project "${project.name}"`, req.user.email]);
    res.json({ ok: true });
  }));

  // Take someone off a project: the allocation ends today and stays in the history. They can be handed over to a colleague
  // (with notes) and/or moved to another project. Moving adds them there too when the caller manages that project.
  r.post("/api/allocations/:id/end", requireAuth, wrap(async (req, res) => {
    const actor = await projectActor(req);
    const a = (await pool.query(`SELECT a.id, a.status, a.employee_id, a.location, e.name AS employee, p.name AS project, p.project_lead, p.status AS pstatus, p.end_date
      FROM employee_project_allocations a JOIN projects p ON p.id=a.project_id JOIN employees e ON e.id=a.employee_id WHERE a.id=$1`, [Number(req.params.id) || 0])).rows[0];
    if (!a) return res.status(404).json({ error: "Allocation not found." });
    if (!canManageProject(actor, a)) return res.status(403).json({ error: "Only HR or the project lead can take people off this project or hand their work over." });
    if (isClosed({ status: a.pstatus, end_date: a.end_date })) return res.status(400).json({ error: CLOSED_MSG });
    if (a.status !== "Active") return res.status(400).json({ error: "This allocation has already ended." });
    const reason = ["Moved to another project", "Leaving the company", "Other"].includes(req.body?.reason) ? req.body.reason : null;
    const notes = String(req.body?.notes || "").trim().slice(0, 1000) || null;
    let handoverTo = null;
    if (req.body?.handoverTo) {
      const h = (await pool.query(`SELECT e.name FROM employees e JOIN employee_project_allocations x ON x.employee_id=e.id AND x.project_id=(SELECT project_id FROM employee_project_allocations WHERE id=$2) AND x.status='Active'
        WHERE lower(e.work_email)=$1 AND e.status <> 'offboarded'`, [String(req.body.handoverTo).trim().toLowerCase(), a.id])).rows[0];
      if (!h) return res.status(400).json({ error: "Only someone currently working on this project can take over." });
      if (h.name.toLowerCase() === a.employee.toLowerCase()) return res.status(400).json({ error: "Choose someone other than the person leaving the project." });
      handoverTo = h.name;
    }
    let target = null;
    if (req.body?.moveToProjectId) {
      target = (await pool.query("SELECT id, name, project_lead, status, end_date FROM projects WHERE id=$1", [Number(req.body.moveToProjectId) || 0])).rows[0];
      if (!target) return res.status(400).json({ error: "The project to move to was not found." });
      if (isClosed(target)) return res.status(400).json({ error: `${target.name} is closed.` });
    }
    const added = !!target && canManageProject(actor, target)
      && !(await pool.query("SELECT 1 FROM employee_project_allocations WHERE project_id=$1 AND employee_id=$2 AND status='Active'", [target.id, a.employee_id])).rowCount;
    await pool.query(`UPDATE employee_project_allocations SET status='Ended', end_date=CURRENT_DATE, end_reason=$2, handover_to=$3, handover_notes=$4, transferred_to=$5 WHERE id=$1`,
      [a.id, reason, handoverTo, notes, target ? target.name : null]);
    if (added) await pool.query(`INSERT INTO employee_project_allocations (employee_id, project_id, start_date, project_lead, location, status) VALUES ($1,$2,CURRENT_DATE,$3,$4,'Active')`,
      [a.employee_id, target.id, target.project_lead, a.location]);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)",
      [`${a.employee} taken off project "${a.project}"${handoverTo ? `, handed over to ${handoverTo}` : ""}${target ? `, moving to "${target.name}"` : ""}`, req.user.email]);
    res.json({ ok: true, moved: added, movedTo: target ? target.name : null });
  }));
  return r;
}
