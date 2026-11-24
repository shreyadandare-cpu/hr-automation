/*
 * Performance: OKRs and 1:1 meetings (Performance > OKRs and 1:1s). The rules are in performance-rules.js.
 *
 *   GET    /api/okrs?quarter=                     every objective of the quarter, with key results and linked goals (everyone)
 *   POST   /api/okrs                              a company objective (okrs.manage) or a team objective (okrs.manage, or a manager)
 *   PUT    /api/okrs/:id      DELETE /api/okrs/:id   change or archive it (its owner, or okrs.manage)
 *   POST   /api/okrs/:id/key-results              add a key result (the objective's owner, or okrs.manage)
 *   PUT    /api/okrs/key-results/:id  DELETE ...  update the current value or remove it (same people)
 *   PUT    /api/okrs/goals/:goalId                link your own goal to an objective, or unlink it (objectiveId null)
 *   GET    /api/one-on-ones                       your meetings, as a manager or as a report, and who you can meet
 *   POST   /api/one-on-ones                       schedule one with a direct report or with your manager
 *   GET    /api/one-on-ones/:id                   a meeting: talking points, actions, shared notes and your private notes (the two people only)
 *   PUT    /api/one-on-ones/:id                   change the date, mark it done or cancelled, or write the shared notes
 *   POST   /api/one-on-ones/:id/items             add a talking point or an action;  PUT/DELETE /api/one-on-ones/items/:id
 *   PUT    /api/one-on-ones/:id/private           your private notes, which the other person never sees
 */
import express from "express";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { canAll } from "./access.js";
import { notify } from "./notify.js";
import { reportsOf, managerOf } from "./teams.js";
import { health, krProgress, objectiveProgress, quarterOf, readItem, readKeyResult, readMeeting, readObjective } from "./performance-rules.js";

const NO_ACCESS = { error: "You do not have access to this. Please ask a super admin if you need it." };
const istDay = async () => (await pool.query("SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date,'YYYY-MM-DD') AS d")).rows[0].d;
const num = (v) => Number(v);
async function namesOf(emails) {
  const list = [...new Set(emails.filter(Boolean).map((e) => String(e).toLowerCase()))];
  const { rows } = list.length ? await pool.query("SELECT lower(work_email) AS e, name, title FROM employees WHERE lower(work_email) = ANY($1)", [list]) : { rows: [] };
  const m = new Map(rows.map((r) => [r.e, r]));
  return (email) => { const r = m.get(String(email || "").toLowerCase()); return { email, name: r ? r.name : String(email || "").split("@")[0], title: r ? r.title || "" : "" }; };
}
/** How much of the quarter has passed, 0 to 1, for on track or behind. */
function elapsedOf(quarter, today) {
  const [y, q] = quarter.split("-Q").map(Number), m0 = 3 + (q - 1) * 3;   // April is month 3 counted from 0
  const start = Date.UTC(y + Math.floor(m0 / 12), m0 % 12, 1), end = Date.UTC(y + Math.floor((m0 + 3) / 12), (m0 + 3) % 12, 1), now = Date.parse(`${today}T00:00:00Z`);
  return Math.max(0, Math.min(1, (now - start) / (end - start)));
}

export function performanceRouter(wrap) {
  const r = express.Router();
  r.use(["/api/okrs", "/api/one-on-ones"], requireAuth);
  const me = (req) => req.user.email.toLowerCase();
  const audit = (req, action) => pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, me(req)]).catch(() => {});
  const isManager = async (req) => (await reportsOf(pool, me(req))).length > 0;
  const mayEdit = (req, o) => canAll(req, "okrs.manage") || String(o.owner_email).toLowerCase() === me(req);

  /* ---------- OKRs ---------- */
  r.get("/api/okrs", wrap(async (req, res) => {
    const today = await istDay(), quarter = /^\d{4}-Q[1-4]$/.test(String(req.query.quarter || "")) ? String(req.query.quarter) : quarterOf(today);
    const { rows: objs } = await pool.query("SELECT * FROM okr_objectives WHERE quarter=$1 AND archived_at IS NULL ORDER BY level='team', id LIMIT 300", [quarter]);
    const ids = objs.map((o) => o.id);
    const [{ rows: krs }, { rows: goals }] = await Promise.all([
      ids.length ? pool.query("SELECT * FROM okr_key_results WHERE objective_id = ANY($1) ORDER BY id", [ids]) : { rows: [] },
      ids.length ? pool.query("SELECT id, email, title, progress, objective_id FROM goals WHERE objective_id = ANY($1) AND deleted_at IS NULL ORDER BY id LIMIT 2000", [ids]) : { rows: [] },
    ]);
    const person = await namesOf([...objs.map((o) => o.owner_email), ...goals.map((g) => g.email)]);
    const elapsed = elapsedOf(quarter, today), manage = canAll(req, "okrs.manage");
    const objectives = objs.map((o) => {
      const k = krs.filter((x) => x.objective_id === o.id).map((x) => ({ id: x.id, title: x.title, unit: x.unit, start: num(x.start_value), target: num(x.target_value), current: num(x.current_value),
        progress: krProgress({ start: x.start_value, target: x.target_value, current: x.current_value }), updatedAt: x.updated_at }));
      const g = goals.filter((x) => x.objective_id === o.id).map((x) => ({ id: x.id, title: x.title, progress: x.progress, person: person(x.email) }));
      const progress = objectiveProgress(k.map((x) => ({ start: x.start, target: x.target, current: x.current })), g);
      return { id: o.id, title: o.title, detail: o.detail, level: o.level, quarter: o.quarter, parentId: o.parent_id, owner: person(o.owner_email),
        keyResults: k, goals: g, progress, health: health(progress, elapsed), canEdit: manage || String(o.owner_email).toLowerCase() === me(req) };
    });
    const { rows: mine } = await pool.query("SELECT id, title, progress, objective_id FROM goals WHERE lower(email)=$1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 100", [me(req)]);
    res.json({ quarter, today, elapsed, objectives, myGoals: mine.map((g) => ({ id: g.id, title: g.title, progress: g.progress, objectiveId: g.objective_id })),
      canCompany: manage, canTeam: manage || (await isManager(req)) });
  }));
  r.post("/api/okrs", wrap(async (req, res) => {
    const { value: v, errors } = readObjective(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    if (v.level === "company" && !canAll(req, "okrs.manage")) return res.status(403).json({ error: "Only the people who set company OKRs can add a company objective. Add a team objective instead." });
    if (v.level === "team" && !canAll(req, "okrs.manage") && !(await isManager(req))) return res.status(403).json({ error: "Team objectives are set by managers. Please link your own goals to an objective instead." });
    if (v.parentId) { const { rowCount } = await pool.query("SELECT 1 FROM okr_objectives WHERE id=$1 AND archived_at IS NULL", [v.parentId]); if (!rowCount) return res.status(400).json({ errors: { parentId: "That objective was not found." } }); }
    const { rows: [o] } = await pool.query("INSERT INTO okr_objectives (title, detail, level, quarter, owner_email, parent_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$5) RETURNING id",
      [v.title, v.detail, v.level, v.quarter, me(req), v.parentId]);
    await audit(req, `OKR objective added (${v.level}, ${v.quarter}): ${v.title}`);
    res.status(201).json({ id: o.id });
  }));
  const objective = async (id) => (await pool.query("SELECT * FROM okr_objectives WHERE id=$1 AND archived_at IS NULL", [Number(id) || 0])).rows[0];
  r.put("/api/okrs/:id", wrap(async (req, res) => {
    const o = await objective(req.params.id);
    if (!o) return res.status(404).json({ error: "This objective was not found." });
    if (!mayEdit(req, o)) return res.status(403).json(NO_ACCESS);
    const { value: v, errors } = readObjective({ ...req.body, level: req.body && req.body.level ? req.body.level : o.level });
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    if (v.level === "company" && !canAll(req, "okrs.manage")) return res.status(403).json(NO_ACCESS);
    if (v.parentId === o.id) return res.status(400).json({ errors: { parentId: "An objective cannot support itself." } });
    await pool.query("UPDATE okr_objectives SET title=$2, detail=$3, level=$4, quarter=$5, parent_id=$6, updated_at=now() WHERE id=$1", [o.id, v.title, v.detail, v.level, v.quarter, v.parentId]);
    res.json({ ok: true });
  }));
  r.delete("/api/okrs/:id", wrap(async (req, res) => {
    const o = await objective(req.params.id);
    if (!o) return res.status(404).json({ error: "This objective was not found." });
    if (!mayEdit(req, o)) return res.status(403).json(NO_ACCESS);
    await pool.query("UPDATE okr_objectives SET archived_at=now() WHERE id=$1", [o.id]);
    await pool.query("UPDATE goals SET objective_id=NULL WHERE objective_id=$1", [o.id]);
    await pool.query("UPDATE okr_objectives SET parent_id=NULL WHERE parent_id=$1", [o.id]);
    await audit(req, `OKR objective removed: ${o.title}`);
    res.json({ ok: true });
  }));
  r.post("/api/okrs/:id/key-results", wrap(async (req, res) => {
    const o = await objective(req.params.id);
    if (!o) return res.status(404).json({ error: "This objective was not found." });
    if (!mayEdit(req, o)) return res.status(403).json(NO_ACCESS);
    const { value: v, errors } = readKeyResult(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const { rows: [k] } = await pool.query("INSERT INTO okr_key_results (objective_id, title, unit, start_value, target_value, current_value, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [o.id, v.title, v.unit, v.start, v.target, v.current, me(req)]);
    res.status(201).json({ id: k.id });
  }));
  const keyResult = async (id) => (await pool.query("SELECT k.*, o.owner_email FROM okr_key_results k JOIN okr_objectives o ON o.id=k.objective_id WHERE k.id=$1 AND o.archived_at IS NULL", [Number(id) || 0])).rows[0];
  r.put("/api/okrs/key-results/:id", wrap(async (req, res) => {
    const k = await keyResult(req.params.id);
    if (!k) return res.status(404).json({ error: "This key result was not found." });
    if (!mayEdit(req, k)) return res.status(403).json(NO_ACCESS);
    const { value: v, errors } = readKeyResult({ title: k.title, unit: k.unit, start: k.start_value, target: k.target_value, ...req.body });
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    await pool.query("UPDATE okr_key_results SET title=$2, unit=$3, start_value=$4, target_value=$5, current_value=$6, updated_by=$7, updated_at=now() WHERE id=$1", [k.id, v.title, v.unit, v.start, v.target, v.current, me(req)]);
    res.json({ ok: true, progress: krProgress(v) });
  }));
  r.delete("/api/okrs/key-results/:id", wrap(async (req, res) => {
    const k = await keyResult(req.params.id);
    if (!k) return res.status(404).json({ error: "This key result was not found." });
    if (!mayEdit(req, k)) return res.status(403).json(NO_ACCESS);
    await pool.query("DELETE FROM okr_key_results WHERE id=$1", [k.id]);
    res.json({ ok: true });
  }));
  r.put("/api/okrs/goals/:goalId", wrap(async (req, res) => {
    const raw = req.body && req.body.objectiveId, objectiveId = raw === null || raw === "" || raw === undefined ? null : Number(raw);
    if (objectiveId !== null && !(await objective(objectiveId))) return res.status(400).json({ errors: { objectiveId: "That objective was not found." } });
    const { rowCount } = await pool.query("UPDATE goals SET objective_id=$3, updated_at=now() WHERE id=$1 AND lower(email)=$2 AND deleted_at IS NULL", [Number(req.params.goalId) || 0, me(req), objectiveId]);
    if (!rowCount) return res.status(404).json({ error: "This goal is no longer available." });
    res.json({ ok: true });
  }));

  /* ---------- 1:1 meetings ---------- */
  const meetingOf = async (req, id) => {
    const { rows: [m] } = await pool.query("SELECT *, to_char(meets_on,'YYYY-MM-DD') AS on_day FROM one_on_ones WHERE id=$1", [Number(id) || 0]);
    if (!m || ![m.manager_email.toLowerCase(), m.report_email.toLowerCase()].includes(me(req))) return null;   // the two people only
    return m;
  };
  r.get("/api/one-on-ones", wrap(async (req, res) => {
    const [reports, manager, { rows }] = await Promise.all([reportsOf(pool, me(req)), managerOf(pool, me(req)),
      pool.query(`SELECT m.id, m.manager_email, m.report_email, to_char(m.meets_on,'YYYY-MM-DD') AS on_day, m.status,
          (SELECT count(*) FROM one_on_one_items i WHERE i.meeting_id=m.id AND i.kind='action' AND NOT i.done)::int AS open_actions
        FROM one_on_ones m WHERE lower(m.manager_email)=$1 OR lower(m.report_email)=$1 ORDER BY m.meets_on DESC, m.id DESC LIMIT 200`, [me(req)])]);
    const person = await namesOf([...reports, manager, ...rows.flatMap((x) => [x.manager_email, x.report_email])]);
    res.json({ today: await istDay(), meetings: rows.map((x) => {
      const asManager = x.manager_email.toLowerCase() === me(req);
      return { id: x.id, on: x.on_day, status: x.status, openActions: x.open_actions, role: asManager ? "manager" : "report", with: person(asManager ? x.report_email : x.manager_email) };
    }), canMeet: [...reports.map((e) => ({ ...person(e), relation: "report" })), ...(manager && typeof manager === "string" && manager !== "directors" ? [{ ...person(manager), relation: "manager" }] : [])] });
  }));
  r.post("/api/one-on-ones", wrap(async (req, res) => {
    const { value: v, errors } = readMeeting(req.body, await istDay());
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const [reports, manager] = await Promise.all([reportsOf(pool, me(req)), managerOf(pool, me(req))]);
    const asManager = reports.includes(v.withEmail), asReport = !asManager && manager && String(manager).toLowerCase() === v.withEmail;
    if (!asManager && !asReport) return res.status(400).json({ errors: { with: "You can meet your direct reports or your own manager." } });
    const managerEmail = asManager ? me(req) : v.withEmail, reportEmail = asManager ? v.withEmail : me(req);
    const { rows: [m] } = await pool.query("INSERT INTO one_on_ones (manager_email, report_email, meets_on, created_by) VALUES ($1,$2,$3,$4) RETURNING id", [managerEmail, reportEmail, v.on, me(req)]);
    const who = (await namesOf([me(req)]))(me(req)).name;
    notify(v.withEmail, { title: `${who} scheduled a 1:1 with you`, body: `On ${v.on}. Add your talking points before you meet.`, link: `/app/performance?meeting=${m.id}` }).catch(() => {});
    res.status(201).json({ id: m.id });
  }));
  r.get("/api/one-on-ones/:id", wrap(async (req, res) => {
    const m = await meetingOf(req, req.params.id);
    if (!m) return res.status(404).json({ error: "This meeting was not found." });
    const [{ rows: items }, { rows: [priv] }, { rows: earlier }] = await Promise.all([
      pool.query("SELECT id, kind, body, owner_email, done, added_by, created_at FROM one_on_one_items WHERE meeting_id=$1 ORDER BY id", [m.id]),
      pool.query("SELECT notes FROM one_on_one_private WHERE meeting_id=$1 AND lower(email)=$2", [m.id, me(req)]),
      // Actions still open from earlier meetings of the same two people, so nothing agreed is lost.
      pool.query(`SELECT i.id, i.body, i.owner_email, to_char(o.meets_on,'YYYY-MM-DD') AS on_day FROM one_on_one_items i JOIN one_on_ones o ON o.id=i.meeting_id
        WHERE lower(o.manager_email)=lower($1) AND lower(o.report_email)=lower($2) AND o.id <> $3 AND o.meets_on <= $4 AND i.kind='action' AND NOT i.done ORDER BY o.meets_on DESC, i.id LIMIT 50`,
        [m.manager_email, m.report_email, m.id, m.on_day]),
    ]);
    const person = await namesOf([m.manager_email, m.report_email, ...items.map((i) => i.owner_email), ...earlier.map((i) => i.owner_email)]);
    res.json({ id: m.id, on: m.on_day, status: m.status, sharedNotes: m.shared_notes, manager: person(m.manager_email), report: person(m.report_email),
      role: m.manager_email.toLowerCase() === me(req) ? "manager" : "report", privateNotes: priv ? priv.notes : "",
      items: items.map((i) => ({ id: i.id, kind: i.kind, text: i.body, owner: i.owner_email ? person(i.owner_email) : null, done: i.done, mine: i.added_by.toLowerCase() === me(req) })),
      openFromEarlier: earlier.map((i) => ({ id: i.id, text: i.body, owner: i.owner_email ? person(i.owner_email) : null, on: i.on_day })) });
  }));
  r.put("/api/one-on-ones/:id", wrap(async (req, res) => {
    const m = await meetingOf(req, req.params.id);
    if (!m) return res.status(404).json({ error: "This meeting was not found." });
    const b = req.body || {}, errors = {};
    const status = b.status === undefined ? m.status : ["scheduled", "done", "cancelled"].includes(b.status) ? b.status : (errors.status = "Please choose scheduled, done or cancelled.", m.status);
    const on = b.on === undefined ? m.on_day : /^\d{4}-\d{2}-\d{2}$/.test(String(b.on)) ? String(b.on) : (errors.on = "Please choose the date.", m.on_day);
    const notes = b.sharedNotes === undefined ? m.shared_notes : String(b.sharedNotes).slice(0, 5000);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    await pool.query("UPDATE one_on_ones SET status=$2, meets_on=$3, shared_notes=$4, updated_at=now() WHERE id=$1", [m.id, status, on, notes]);
    const other = m.manager_email.toLowerCase() === me(req) ? m.report_email : m.manager_email, who = (await namesOf([me(req)]))(me(req)).name;
    if (status !== m.status && status === "cancelled") notify(other, { title: `${who} cancelled your 1:1 on ${m.on_day}`, body: "", link: "/app/performance" }).catch(() => {});
    else if (on !== m.on_day) notify(other, { title: `${who} moved your 1:1 to ${on}`, body: "", link: `/app/performance?meeting=${m.id}` }).catch(() => {});
    res.json({ ok: true });
  }));
  r.post("/api/one-on-ones/:id/items", wrap(async (req, res) => {
    const m = await meetingOf(req, req.params.id);
    if (!m) return res.status(404).json({ error: "This meeting was not found." });
    const { value: v, errors } = readItem(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const owner = v.owner && [m.manager_email.toLowerCase(), m.report_email.toLowerCase()].includes(v.owner) ? v.owner : v.kind === "action" ? me(req) : null;
    const { rows: [i] } = await pool.query("INSERT INTO one_on_one_items (meeting_id, kind, body, owner_email, added_by) VALUES ($1,$2,$3,$4,$5) RETURNING id", [m.id, v.kind, v.text, owner, me(req)]);
    res.status(201).json({ id: i.id });
  }));
  const itemOf = async (req, id) => {
    const { rows: [i] } = await pool.query("SELECT i.*, o.manager_email, o.report_email FROM one_on_one_items i JOIN one_on_ones o ON o.id=i.meeting_id WHERE i.id=$1", [Number(id) || 0]);
    return i && [i.manager_email.toLowerCase(), i.report_email.toLowerCase()].includes(me(req)) ? i : null;
  };
  r.put("/api/one-on-ones/items/:id", wrap(async (req, res) => {
    const i = await itemOf(req, req.params.id);
    if (!i) return res.status(404).json({ error: "This item was not found." });
    if (typeof (req.body || {}).done !== "boolean") return res.status(400).json({ error: "Please say whether it is done." });
    await pool.query("UPDATE one_on_one_items SET done=$2 WHERE id=$1", [i.id, req.body.done]);
    res.json({ ok: true });
  }));
  r.delete("/api/one-on-ones/items/:id", wrap(async (req, res) => {
    const i = await itemOf(req, req.params.id);
    if (!i) return res.status(404).json({ error: "This item was not found." });
    if (i.added_by.toLowerCase() !== me(req)) return res.status(403).json({ error: "Only the person who added it can remove it." });
    await pool.query("DELETE FROM one_on_one_items WHERE id=$1", [i.id]);
    res.json({ ok: true });
  }));
  r.put("/api/one-on-ones/:id/private", wrap(async (req, res) => {
    const m = await meetingOf(req, req.params.id);
    if (!m) return res.status(404).json({ error: "This meeting was not found." });
    const notes = String((req.body || {}).notes ?? "").slice(0, 5000);
    await pool.query(`INSERT INTO one_on_one_private (meeting_id, email, notes) VALUES ($1,$2,$3) ON CONFLICT (meeting_id, email) DO UPDATE SET notes=EXCLUDED.notes, updated_at=now()`, [m.id, me(req), notes]);
    res.json({ ok: true });
  }));
  return r;
}
