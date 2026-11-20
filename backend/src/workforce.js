import express from "express";
import { pool } from "./db.js";
import { requireAuth, unlessHidden } from "./auth.js";
import { can, canAll, mayDecide, need, needAll, scopeOf } from "./access.js";
import { notify } from "./notify.js";
import { coveredBy, managerOf, reportsOf } from "./teams.js";
import { deptOf } from "./payroll/store.js";
import {
  addDays, noticeDefault, noticeInfo, readAnswers, readAssignees, readCompletion, readResignation, readStandIn, readSurvey,
  readTimesheet, readTraining, surveyResults, weekStart,
} from "./workforce-rules.js";

/*
 * Timesheets, surveys, training, notice periods and approval stand-ins. Roles are checked here, never only on the page.
 *   Timesheets  GET/PUT /api/timesheet (your week), GET /api/timesheets/to-approve, POST /api/timesheets/:id/decision
 *               A week is approved by the person's reporting manager, a stand-in covering them, or timesheets.approve
 *               for the people in scope; never your own.
 *   Surveys     GET /api/surveys, POST /api/surveys (engage.manage), GET /api/surveys/:id, POST /api/surveys/:id/answers,
 *               GET /api/surveys/:id/results (engage.manage), DELETE /api/surveys/:id (engage.manage)
 *   Training    GET /api/training (yours), PUT /api/training/:id (mark done), GET/POST /api/trainings (engage.manage),
 *               GET /api/trainings/:id, POST /api/trainings/:id/assign, DELETE /api/trainings/:id (engage.manage)
 *   Notice      GET/PUT /api/hr/resignations, POST /api/hr/resignations/:email/withdraw (exit.manage, for the people in scope)
 *   Stand-ins   GET/POST /api/stand-ins, DELETE /api/stand-ins/:id (others' with leave.approve for the whole company)
 * Design: docs/HR_GAPS_DESIGN.md.
 */
const me = (req) => req.user.email.toLowerCase();
const idOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const NO_ACCESS = { error: "You do not have access to this. Please ask a super admin if you need it." };
const manages = (req) => canAll(req, "engage.manage");   // surveys and training
const bad = (res, errors) => res.status(400).json({ errors });
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);   // India
const INTERNAL = "Internal work";

async function people(emails) {
  const list = [...new Set(emails.filter(Boolean).map((e) => String(e).toLowerCase()))];
  const { rows } = list.length ? await pool.query("SELECT lower(work_email) AS email, name, title, dept FROM employees WHERE lower(work_email) = ANY($1)", [list]) : { rows: [] };
  const by = Object.fromEntries(rows.map((p) => [p.email, p]));
  return (email) => { const p = by[String(email).toLowerCase()]; return { email, name: p ? p.name : String(email).split("@")[0], title: p ? p.title || "" : "", dept: p ? p.dept || "" : "" }; };
}
/** Everyone on the staff list, or one department. The department is the one shown on screen: the stored one, or else the
    one worked out from the job title (payroll/store.js deptOf, the same rule the pages use). */
const activeStaff = async (dept = "") => (await pool.query("SELECT lower(work_email) AS email, dept, title FROM employees WHERE status NOT IN ('offboarded') LIMIT 5000")).rows
  .filter((r) => !dept || deptOf(r.dept, r.title).toLowerCase() === dept.toLowerCase()).map((r) => r.email);

/** Whether `req` may approve `owner`'s timesheet: timesheets.approve covering them, their reporting manager, or a stand-in
    covering that manager. Never your own. */
async function mayApprove(req, owner) {
  if (String(owner).toLowerCase() === me(req)) return false;
  if (await mayDecide(req, "timesheets.approve", owner)) return true;
  const m = await managerOf(pool, owner);
  return !!m && (m === me(req) || (await coveredBy(pool, me(req))).includes(m));
}

export function workforceRouter(wrap) {
  const r = express.Router();
  r.use(["/api/timesheet", "/api/timesheets", "/api/surveys", "/api/training", "/api/trainings", "/api/hr/resignations", "/api/stand-ins"], requireAuth);

  /* ---------- Timesheets ---------- */
  /** The projects a person was on during a week (any allocation that overlaps it). */
  const projectsFor = async (email, week) => (await pool.query(
    `SELECT DISTINCT p.id, p.name FROM employee_project_allocations a JOIN employees e ON e.id = a.employee_id JOIN projects p ON p.id = a.project_id
     WHERE lower(e.work_email)=$1 AND (a.start_date IS NULL OR a.start_date <= $3::date) AND (a.end_date IS NULL OR a.end_date >= $2::date) ORDER BY p.name`,
    [email, week, addDays(week, 6)])).rows;
  async function weekOut(email, week) {
    const { rows: [w] } = await pool.query("SELECT id, status, submitted_at, decided_by, decided_at, decision_note FROM timesheet_weeks WHERE lower(email)=$1 AND week_start=$2", [email, week]);
    const { rows: entries } = w ? await pool.query(
      "SELECT e.project_id, p.name AS project, to_char(e.work_date,'YYYY-MM-DD') AS day, e.minutes FROM timesheet_entries e LEFT JOIN projects p ON p.id = e.project_id WHERE e.week_id=$1", [w.id]) : { rows: [] };
    const projects = await projectsFor(email, week);
    const lines = new Map([[null, { projectId: null, project: INTERNAL, minutes: Array(7).fill(0) }]]);
    for (const p of projects) lines.set(p.id, { projectId: p.id, project: p.name, minutes: Array(7).fill(0) });
    for (const e of entries) {
      if (!lines.has(e.project_id)) lines.set(e.project_id, { projectId: e.project_id, project: e.project || "A removed project", minutes: Array(7).fill(0) });
      lines.get(e.project_id).minutes[Math.round((Date.parse(e.day) - Date.parse(week)) / 86400000)] += e.minutes;
    }
    const rows = [...lines.values()].sort((a, b) => (a.projectId == null) - (b.projectId == null) || a.project.localeCompare(b.project));
    return { week, id: w ? w.id : null, status: w ? w.status : "draft", submittedAt: w ? w.submitted_at : null, decidedAt: w ? w.decided_at : null,
      decisionNote: w ? w.decision_note : "", projects: projects.map((p) => ({ id: p.id, name: p.name })), rows,
      total: rows.reduce((n, l) => n + l.minutes.reduce((a, b) => a + b, 0), 0) };
  }
  r.get("/api/timesheet", wrap(async (req, res) => {
    const week = weekStart(String(req.query.week || today())) || weekStart(today());
    const email = req.query.email ? String(req.query.email).toLowerCase() : me(req);
    if (email !== me(req) && !(await mayApprove(req, email))) return res.status(404).json({ error: "This timesheet was not found." });
    const p = await people([email]);
    res.json({ person: p(email), mine: email === me(req), ...(await weekOut(email, week)) });
  }));
  r.put("/api/timesheet", wrap(async (req, res) => {
    const week = String((req.body || {}).week || "");
    const projects = weekStart(week) === week ? await projectsFor(me(req), week) : [];
    const t = readTimesheet(req.body, week, projects.map((p) => p.id));
    if (Object.keys(t.errors).length) return bad(res, t.errors);
    if (t.submit && !t.total) return bad(res, { form: "Please enter some hours before you submit the week." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [w] } = await client.query(
        `INSERT INTO timesheet_weeks (email, week_start) VALUES ($1,$2) ON CONFLICT (lower(email), week_start) DO UPDATE SET updated_at=now()
         RETURNING id, status`, [me(req), week]);
      if (w.status === "approved") { await client.query("ROLLBACK"); return res.status(409).json({ error: "This week is approved, so it can no longer be changed." }); }
      await client.query("DELETE FROM timesheet_entries WHERE week_id=$1", [w.id]);
      if (t.entries.length) await client.query(
        "INSERT INTO timesheet_entries (week_id, project_id, work_date, minutes) SELECT $1, x.p, x.d::date, x.m FROM unnest($2::int[], $3::text[], $4::int[]) AS x(p, d, m)",
        [w.id, t.entries.map((e) => e.projectId), t.entries.map((e) => e.day), t.entries.map((e) => e.minutes)]);
      await client.query("UPDATE timesheet_weeks SET status=$2, submitted_at=$3, decision_note=CASE WHEN $2='submitted' THEN '' ELSE decision_note END, updated_at=now() WHERE id=$1",
        [w.id, t.submit ? "submitted" : "draft", t.submit ? new Date() : null]);
      await client.query("COMMIT");
    } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
    res.json(await weekOut(me(req), week));
    if (t.submit) { const m = await managerOf(pool, me(req)); notify(m || "hr", { title: "A timesheet is waiting for you", body: `${(await people([me(req)]))(me(req)).name}, week of ${week}`, link: "/app/timesheet?view=approve" }).catch(() => {}); }
  }));
  r.get("/api/timesheets/to-approve", wrap(async (req, res) => {
    const status = ["submitted", "approved", "returned"].includes(req.query.status) ? req.query.status : "submitted";
    // null = everyone (timesheets.approve for the whole company); otherwise its scope plus direct reports and covered teams. Never your own.
    const granted = await scopeOf(req, "timesheets.approve");
    let scope = null;
    if (granted) {
      scope = [...granted, ...(await reportsOf(pool, me(req)))];
      for (const m of await coveredBy(pool, me(req))) scope.push(...(await reportsOf(pool, m)));
      scope = [...new Set(scope)].filter((e) => e !== me(req));
      if (!scope.length) return res.json({ canApprove: false, weeks: [] });
    }
    const { rows } = await pool.query(
      `SELECT w.id, lower(w.email) AS email, to_char(w.week_start,'YYYY-MM-DD') AS week, w.status, w.submitted_at, w.decided_at,
         (SELECT coalesce(sum(minutes),0)::int FROM timesheet_entries e WHERE e.week_id=w.id) AS minutes
       FROM timesheet_weeks w WHERE w.status=$1 AND lower(w.email) <> $2 ${scope ? "AND lower(w.email) = ANY($3)" : ""} ORDER BY w.week_start DESC, w.id DESC LIMIT 300`,
      scope ? [status, me(req), scope] : [status, me(req)]);
    const p = await people(rows.map((x) => x.email));
    res.json({ canApprove: true, weeks: rows.map((x) => ({ id: x.id, person: p(x.email), week: x.week, status: x.status, minutes: x.minutes, submittedAt: x.submitted_at, decidedAt: x.decided_at })) });
  }));
  r.post("/api/timesheets/:id/decision", wrap(async (req, res) => {
    const decision = (req.body || {}).decision, note = String((req.body || {}).note || "").trim().slice(0, 500);
    if (!["approved", "returned"].includes(decision)) return bad(res, { decision: "Please approve the week or send it back." });
    if (decision === "returned" && !note) return bad(res, { note: "Please say what should change, so the person knows what to fix." });
    const { rows: [w] } = await pool.query("SELECT id, email, to_char(week_start,'YYYY-MM-DD') AS week, status FROM timesheet_weeks WHERE id=$1", [idOf(req.params.id)]);
    if (!w || !(await mayApprove(req, w.email))) return res.status(404).json({ error: "This timesheet was not found." });
    if (w.status !== "submitted") return res.status(409).json({ error: "This week is not waiting for a decision." });
    await pool.query("UPDATE timesheet_weeks SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4, updated_at=now() WHERE id=$1", [w.id, decision, me(req), note]);
    res.json({ ok: true });
    notify(w.email, decision === "approved"
      ? { title: "Your timesheet was approved", body: `Week of ${w.week}`, link: `/app/timesheet?week=${w.week}` }
      : { title: "Your timesheet was sent back", body: `Week of ${w.week}: ${note}`.slice(0, 180), link: `/app/timesheet?week=${w.week}` }).catch(() => {});
  }));

  r.use("/api/surveys", unlessHidden("surveys"));

  /* ---------- Surveys ---------- */
  const surveyOut = (s) => ({ id: s.id, title: s.title, intro: s.intro, questions: s.questions, anonymous: s.anonymous, closesOn: s.closes_on, createdAt: s.created_at });
  r.get("/api/surveys", wrap(async (req, res) => {
    const manage = manages(req);
    const { rows } = await pool.query(
      `SELECT s.id, s.title, s.intro, s.questions, s.anonymous, to_char(s.closes_on,'YYYY-MM-DD') AS closes_on, s.created_at,
         EXISTS (SELECT 1 FROM survey_takers t WHERE t.survey_id=s.id AND t.email=$1) AS answered,
         (SELECT count(*)::int FROM survey_takers t WHERE t.survey_id=s.id) AS answers
       FROM surveys s WHERE s.deleted_at IS NULL ${manage ? "" : "AND s.closes_on >= $2::date - 30"} ORDER BY s.closes_on DESC, s.id DESC LIMIT 100`,
      manage ? [me(req)] : [me(req), today()]);
    res.json({ canManage: manage, today: today(), surveys: rows.map((s) => ({ ...surveyOut(s), answered: s.answered, open: s.closes_on >= today(), ...(manage ? { answers: s.answers } : {}) })) });
  }));
  r.post("/api/surveys", needAll("engage.manage"), wrap(async (req, res) => {
    const s = readSurvey(req.body, today());
    if (Object.keys(s.errors).length) return bad(res, s.errors);
    const { rows: [row] } = await pool.query("INSERT INTO surveys (title, intro, questions, anonymous, closes_on, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [s.title, s.intro, JSON.stringify(s.questions), s.anonymous, s.closesOn, me(req)]);
    res.status(201).json({ id: row.id });
    notify(await activeStaff(), { title: `New survey: ${s.title}`, body: `Please answer by ${s.closesOn}.${s.anonymous ? " Your answers are anonymous." : ""}`, link: `/app/surveys/${row.id}` }).catch(() => {});
  }));
  const loadSurvey = async (id) => (await pool.query("SELECT id, title, intro, questions, anonymous, to_char(closes_on,'YYYY-MM-DD') AS closes_on, created_at FROM surveys WHERE id=$1 AND deleted_at IS NULL", [idOf(id)])).rows[0];
  r.get("/api/surveys/:id", wrap(async (req, res) => {
    const s = await loadSurvey(req.params.id);
    if (!s) return res.status(404).json({ error: "This survey was not found." });
    const answered = (await pool.query("SELECT 1 FROM survey_takers WHERE survey_id=$1 AND email=$2", [s.id, me(req)])).rowCount > 0;
    res.json({ ...surveyOut(s), answered, open: s.closes_on >= today(), canManage: manages(req) });
  }));
  r.post("/api/surveys/:id/answers", wrap(async (req, res) => {
    const s = await loadSurvey(req.params.id);
    if (!s) return res.status(404).json({ error: "This survey was not found." });
    if (s.closes_on < today()) return res.status(409).json({ error: "This survey has closed." });
    const a = readAnswers(s.questions, (req.body || {}).answers);
    if (Object.keys(a.errors).length) return bad(res, a.errors);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rowCount } = await client.query("INSERT INTO survey_takers (survey_id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING", [s.id, me(req)]);
      if (!rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ error: "You have already answered this survey." }); }
      await client.query("INSERT INTO survey_responses (survey_id, email, answers) VALUES ($1,$2,$3)", [s.id, s.anonymous ? null : me(req), JSON.stringify(a.answers)]);
      await client.query("COMMIT");
    } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
    res.status(201).json({ ok: true });
  }));
  r.get("/api/surveys/:id/results", needAll("engage.manage"), wrap(async (req, res) => {
    const s = await loadSurvey(req.params.id);
    if (!s) return res.status(404).json({ error: "This survey was not found." });
    const { rows } = await pool.query("SELECT email, answers FROM survey_responses WHERE survey_id=$1", [s.id]);
    const staff = (await activeStaff()).length;
    const named = !s.anonymous ? await people(rows.map((x) => x.email)) : null;
    res.json({ survey: surveyOut(s), staff, ...surveyResults(s.questions, rows.map((x) => ({ answers: x.answers })), s.anonymous),
      ...(named ? { people: rows.map((x) => ({ person: named(x.email), answers: x.answers })) } : {}) });
  }));
  r.delete("/api/surveys/:id", needAll("engage.manage"), wrap(async (req, res) => {
    const { rowCount } = await pool.query("UPDATE surveys SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: "This survey was not found." });
    res.json({ ok: true });
  }));

  /* ---------- Training ---------- */
  const trainingOut = (t) => ({ id: t.id, title: t.title, detail: t.detail, link: t.link, dueOn: t.due_on });
  r.get("/api/training", wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.detail, t.link, to_char(t.due_on,'YYYY-MM-DD') AS due_on, to_char(a.completed_on,'YYYY-MM-DD') AS completed_on, a.note
       FROM training_assignments a JOIN trainings t ON t.id = a.training_id WHERE lower(a.email)=$1 AND t.deleted_at IS NULL
       ORDER BY (a.completed_on IS NOT NULL), t.due_on NULLS LAST, t.id DESC LIMIT 200`, [me(req)]);
    res.json({ today: today(), canManage: manages(req), trainings: rows.map((t) => ({ ...trainingOut(t), completedOn: t.completed_on, note: t.note })) });
  }));
  r.put("/api/training/:id", wrap(async (req, res) => {
    const c = readCompletion(req.body, today());
    if (Object.keys(c.errors).length) return bad(res, c.errors);
    const { rowCount } = await pool.query(
      "UPDATE training_assignments a SET completed_on=$3, note=$4 FROM trainings t WHERE t.id=a.training_id AND t.deleted_at IS NULL AND a.training_id=$1 AND lower(a.email)=$2",
      [idOf(req.params.id), me(req), c.completedOn, c.note]);
    if (!rowCount) return res.status(404).json({ error: "This training is not assigned to you." });
    res.json({ ok: true });
  }));
  async function assign(id, a) {
    const emails = a.to === "everyone" ? await activeStaff() : a.to === "department" ? await activeStaff(a.dept) : a.emails;
    if (!emails.length) return [];
    const { rows } = await pool.query(
      `INSERT INTO training_assignments (training_id, email) SELECT $1, lower(e.work_email) FROM employees e
       WHERE lower(e.work_email) = ANY($2) AND e.status <> 'offboarded' ON CONFLICT DO NOTHING RETURNING email`, [id, emails]);
    return rows.map((x) => x.email);
  }
  r.get("/api/trainings", needAll("engage.manage"), wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.detail, t.link, to_char(t.due_on,'YYYY-MM-DD') AS due_on,
         (SELECT count(*)::int FROM training_assignments a WHERE a.training_id=t.id) AS assigned,
         (SELECT count(*)::int FROM training_assignments a WHERE a.training_id=t.id AND a.completed_on IS NOT NULL) AS done
       FROM trainings t WHERE t.deleted_at IS NULL ORDER BY t.due_on DESC NULLS LAST, t.id DESC LIMIT 200`);
    res.json({ today: today(), trainings: rows.map((t) => ({ ...trainingOut(t), assigned: t.assigned, done: t.done })) });
  }));
  r.post("/api/trainings", needAll("engage.manage"), wrap(async (req, res) => {
    const t = readTraining(req.body), a = readAssignees(req.body);
    const errors = { ...t.errors, ...a.errors };
    if (Object.keys(errors).length) return bad(res, errors);
    const { rows: [row] } = await pool.query("INSERT INTO trainings (title, detail, link, due_on, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id", [t.title, t.detail, t.link, t.dueOn, me(req)]);
    const added = await assign(row.id, a);
    res.status(201).json({ id: row.id, assigned: added.length });
    notify(added, { title: `Training to do: ${t.title}`, body: t.dueOn ? `Please finish it by ${t.dueOn}.` : "Please finish it when you can.", link: "/app/training" }).catch(() => {});
  }));
  r.get("/api/trainings/:id", needAll("engage.manage"), wrap(async (req, res) => {
    const { rows: [t] } = await pool.query("SELECT id, title, detail, link, to_char(due_on,'YYYY-MM-DD') AS due_on FROM trainings WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id)]);
    if (!t) return res.status(404).json({ error: "This training was not found." });
    const { rows } = await pool.query("SELECT lower(email) AS email, to_char(completed_on,'YYYY-MM-DD') AS completed_on, note FROM training_assignments WHERE training_id=$1 LIMIT 5000", [t.id]);
    const p = await people(rows.map((x) => x.email));
    res.json({ today: today(), training: trainingOut(t), people: rows.map((x) => ({ person: p(x.email), completedOn: x.completed_on, note: x.note })).sort((a, b) => (!!a.completedOn - !!b.completedOn) || a.person.name.localeCompare(b.person.name)) });
  }));
  r.post("/api/trainings/:id/assign", needAll("engage.manage"), wrap(async (req, res) => {
    const a = readAssignees(req.body);
    if (Object.keys(a.errors).length) return bad(res, a.errors);
    const { rows: [t] } = await pool.query("SELECT id, title, to_char(due_on,'YYYY-MM-DD') AS due_on FROM trainings WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id)]);
    if (!t) return res.status(404).json({ error: "This training was not found." });
    const added = await assign(t.id, a);
    res.json({ assigned: added.length });
    notify(added, { title: `Training to do: ${t.title}`, body: t.due_on ? `Please finish it by ${t.due_on}.` : "Please finish it when you can.", link: "/app/training" }).catch(() => {});
  }));
  r.delete("/api/trainings/:id", needAll("engage.manage"), wrap(async (req, res) => {
    const { rowCount } = await pool.query("UPDATE trainings SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: "This training was not found." });
    res.json({ ok: true });
  }));

  /* ---------- Notice periods (exit.manage, for the people in scope) ---------- */
  r.get("/api/hr/resignations", need("exit.manage"), wrap(async (req, res) => {
    const scope = await scopeOf(req, "exit.manage");
    const { rows } = await pool.query(
      `SELECT lower(r.email) AS email, to_char(r.resigned_on,'YYYY-MM-DD') AS resigned_on, r.notice_days, to_char(r.agreed_last_day,'YYYY-MM-DD') AS agreed_last_day, r.note,
         to_char(e.last_day,'YYYY-MM-DD') AS last_day, e.status
       FROM resignations r LEFT JOIN employees e ON lower(e.work_email) = lower(r.email)
       WHERE r.withdrawn_at IS NULL AND (e.status IS DISTINCT FROM 'offboarded' OR e.last_day > now() - interval '60 days')
         ${scope ? "AND lower(r.email) = ANY($1)" : ""} ORDER BY r.resigned_on DESC LIMIT 300`, scope ? [[...scope]] : []);
    const p = await people(rows.map((x) => x.email)), t = today();
    res.json({ today: t, noticeDefault: noticeDefault(), resignations: rows.map((x) => ({ person: p(x.email), resignedOn: x.resigned_on, noticeDays: x.notice_days, agreedLastDay: x.agreed_last_day, lastDay: x.last_day, note: x.note, status: x.status,
      ...noticeInfo({ resignedOn: x.resigned_on, noticeDays: x.notice_days, agreedLastDay: x.agreed_last_day, lastDay: x.last_day }, t) })) });
  }));
  r.put("/api/hr/resignations", need("exit.manage"), wrap(async (req, res) => {
    const x = readResignation(req.body, today());
    if (!x.errors.email && !(await can(req, "exit.manage", x.email))) return res.status(403).json(NO_ACCESS);
    if (!x.errors.email && !(await pool.query("SELECT 1 FROM employees WHERE lower(work_email)=$1 AND status <> 'offboarded'", [x.email])).rowCount) x.errors.email = "That person was not found on the staff list.";
    if (Object.keys(x.errors).length) return bad(res, x.errors);
    await pool.query(
      `INSERT INTO resignations (email, resigned_on, notice_days, agreed_last_day, note, recorded_by) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (email) DO UPDATE SET resigned_on=EXCLUDED.resigned_on, notice_days=EXCLUDED.notice_days, agreed_last_day=EXCLUDED.agreed_last_day,
         note=EXCLUDED.note, recorded_by=EXCLUDED.recorded_by, updated_at=now(), withdrawn_at=NULL`,
      [x.email, x.resignedOn, x.noticeDays, x.agreedLastDay, x.note, me(req)]);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Resignation recorded for ${x.email}, notice ${x.noticeDays} days`, req.user.email]);
    res.json({ ok: true });
  }));
  r.post("/api/hr/resignations/:email/withdraw", need("exit.manage"), wrap(async (req, res) => {
    const email = String(req.params.email || "").toLowerCase();
    if (!(await can(req, "exit.manage", email))) return res.status(403).json(NO_ACCESS);
    const { rowCount } = await pool.query("UPDATE resignations SET withdrawn_at=now(), updated_at=now() WHERE email=$1 AND withdrawn_at IS NULL", [email]);
    if (!rowCount) return res.status(404).json({ error: "This resignation was not found." });
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Resignation withdrawn for ${email}`, req.user.email]);
    res.json({ ok: true });
  }));

  /* ---------- Approval stand-ins ---------- */
  r.get("/api/stand-ins", wrap(async (req, res) => {
    const setsAny = canAll(req, "leave.approve");   // naming and seeing stand-ins for anyone
    const all = setsAny && req.query.scope === "all";
    const { rows } = await pool.query(
      `SELECT id, lower(for_email) AS for_email, lower(stand_in_email) AS stand_in, to_char(from_day,'YYYY-MM-DD') AS from_day, to_char(to_day,'YYYY-MM-DD') AS to_day
       FROM approval_stand_ins WHERE cancelled_at IS NULL AND to_day >= $1::date ${all ? "" : "AND (lower(for_email)=$2 OR lower(stand_in_email)=$2)"} ORDER BY from_day LIMIT 300`,
      all ? [today()] : [today(), me(req)]);
    const p = await people(rows.flatMap((x) => [x.for_email, x.stand_in]));
    res.json({ today: today(), canSetForOthers: setsAny, standIns: rows.map((x) => ({ id: x.id, for: p(x.for_email), standIn: p(x.stand_in), from: x.from_day, to: x.to_day, active: x.from_day <= today(), mine: x.for_email === me(req) })) });
  }));
  r.post("/api/stand-ins", wrap(async (req, res) => {
    const x = readStandIn(req.body, me(req), today());
    if (x.forEmail !== me(req) && !canAll(req, "leave.approve")) return res.status(403).json({ error: "You can only name a stand-in for your own approvals." });
    if (!x.errors.standIn && !(await pool.query("SELECT 1 FROM employees WHERE lower(work_email)=$1 AND status NOT IN ('offboarding','offboarded')", [x.standIn])).rowCount) x.errors.standIn = "That person was not found on the staff list.";
    if (Object.keys(x.errors).length) return bad(res, x.errors);
    const { rows: [row] } = await pool.query("INSERT INTO approval_stand_ins (for_email, stand_in_email, from_day, to_day, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id", [x.forEmail, x.standIn, x.from, x.to, me(req)]);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`${x.standIn} covers leave approvals for ${x.forEmail} from ${x.from} to ${x.to}`, req.user.email]);
    res.status(201).json({ id: row.id });
    const p = await people([x.forEmail]);
    notify(x.standIn, { title: "You are covering leave approvals", body: `For ${p(x.forEmail).name}, from ${x.from} to ${x.to}.`, link: "/app/team-leave" }).catch(() => {});
  }));
  r.delete("/api/stand-ins/:id", wrap(async (req, res) => {
    const { rows: [x] } = await pool.query("SELECT id, lower(for_email) AS for_email, lower(created_by) AS by FROM approval_stand_ins WHERE id=$1 AND cancelled_at IS NULL", [idOf(req.params.id)]);
    if (!x || (!canAll(req, "leave.approve") && x.for_email !== me(req) && x.by !== me(req))) return res.status(404).json({ error: "This stand-in was not found." });
    await pool.query("UPDATE approval_stand_ins SET cancelled_at=now() WHERE id=$1", [x.id]);
    res.json({ ok: true });
  }));

  return r;
}

/** Approved timesheet minutes per person per project in a month, for cost by project: [{ email, project, minutes }]. */
export async function approvedMinutes(db, from, to) {
  const { rows } = await db.query(
    `SELECT lower(w.email) AS email, coalesce(p.name, $3) AS project, sum(e.minutes)::int AS minutes FROM timesheet_entries e
     JOIN timesheet_weeks w ON w.id = e.week_id LEFT JOIN projects p ON p.id = e.project_id
     WHERE w.status='approved' AND e.work_date BETWEEN $1::date AND $2::date GROUP BY 1, 2`, [from, to, INTERNAL]);
  return rows;
}
