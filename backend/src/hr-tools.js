import express from "express";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { can, canAll, mayDecide, need, needAll, scopeOf } from "./access.js";
import { notify } from "./notify.js";
import { managerOf, reportsOf } from "./teams.js";
import { deptOf } from "./payroll/store.js";
import { afterSelf, candidateDraft, interviewIcs, readCycle, readFeedbackAsk, readInterview, readVerdict } from "./workforce-rules.js";
import { readJobDetails } from "./careers-rules.js";
import { postToChat } from "./chat.js";
import { probationEnd, readCandidate, readExit, readOpening, readProbation, readReply, readReviewStart, readReviewText, readTicket, readCalibration, nineBox, spread, POTENTIAL } from "./hr-tools-rules.js";
import { COMPANY_LEGAL, MAROON, PRODUCT, SIGN_OFF } from "./brand.js";

/*
 * HR tools: probation decisions, the helpdesk, exit interviews, hiring and performance reviews.
 * - Probation (probation.manage) and exit interviews (exit.manage) for the people in scope; hiring (hiring.manage) company-wide.
 * - Helpdesk: everyone raises and follows their own tickets; helpdesk.answer sees and answers all of them.
 * - Reviews: reviews.manage opens a review for a person in scope; that person writes a self-review; the manager writes theirs;
 *   reviews.manage writes the final review and a rating, never on their own. Cycles are company-wide (reviews.manage for the
 *   whole company). A person sees only their own reviews, and never colleague feedback about themselves.
 *   Permissions are checked here, never only on the page.
 */
const me = (req) => req.user.email.toLowerCase();
const idOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const NO_ACCESS = { error: "You do not have access to this. Please ask a super admin if you need it." };
const answers = (req) => canAll(req, "helpdesk.answer");
const hires = needAll("hiring.manage");
const bad = (res, errors) => res.status(400).json({ errors });
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

async function namesFor(emails) {
  const list = [...new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))];
  const { rows } = list.length ? await pool.query("SELECT lower(work_email) AS email, name, title FROM employees WHERE lower(work_email) = ANY($1)", [list]) : { rows: [] };
  const who = Object.fromEntries(rows.map((p) => [p.email, p]));
  return (email) => { const p = who[String(email).toLowerCase()]; return { email, name: p ? p.name : String(email).split("@")[0], title: p ? p.title : "" }; };
}
const isEmployee = async (email) => (await pool.query("SELECT 1 FROM employees WHERE lower(work_email)=$1", [email])).rows.length > 0;

export function hrToolsRouter(wrap) {
  const r = express.Router();
  r.use(["/api/hr", "/api/tickets", "/api/reviews", "/api/review-cycles", "/api/feedback-requests", "/api/interviews"], requireAuth);

  /* ---------- Probation (probation.manage, for the people in scope; never your own) ---------- */
  r.get("/api/hr/probations", need("probation.manage"), wrap(async (req, res) => {
    const scope = await scopeOf(req, "probation.manage");
    const { rows } = await pool.query(
      `SELECT e.name, lower(e.work_email) AS email, e.title, e.dept, to_char(e.start_date,'YYYY-MM-DD') AS start, p.status, to_char(p.ends_on,'YYYY-MM-DD') AS ends_on, p.note
       FROM employees e LEFT JOIN probations p ON p.email = lower(e.work_email)
       WHERE e.status <> 'offboarded' AND e.start_date IS NOT NULL AND (p.status IS DISTINCT FROM 'confirmed' OR p.decided_at > now() - interval '90 days')
         AND (p.email IS NOT NULL OR e.start_date > (now() - interval '9 months')) AND lower(e.work_email) <> $1
         ${scope ? "AND lower(e.work_email) = ANY($2)" : ""}
       ORDER BY coalesce(p.ends_on, e.start_date + interval '6 months') LIMIT 300`, scope ? [me(req), [...scope]] : [me(req)]);
    res.json({ people: rows.map((x) => ({ name: x.name, email: x.email, title: x.title, dept: x.dept, start: x.start, status: x.status || "in-probation", endsOn: x.ends_on || probationEnd(x.start), note: x.note || "" })) });
  }));
  r.post("/api/hr/probations", need("probation.manage"), wrap(async (req, res) => {
    const { email, action, endsOn, note, errors } = readProbation(req.body);
    if (Object.keys(errors).length) return bad(res, errors);
    if (!(await mayDecide(req, "probation.manage", email))) return res.status(403).json(NO_ACCESS);
    const { rows: [e] } = await pool.query("SELECT to_char(start_date,'YYYY-MM-DD') AS start FROM employees WHERE lower(work_email)=$1", [email]);
    if (!e) return res.status(404).json({ error: "That person was not found." });
    const end = endsOn || day(new Date()) ;
    await pool.query(
      `INSERT INTO probations (email, ends_on, status, note, decided_by, decided_at) VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (email) DO UPDATE SET ends_on=EXCLUDED.ends_on, status=EXCLUDED.status, note=EXCLUDED.note, decided_by=EXCLUDED.decided_by, decided_at=now(), updated_at=now()`,
      [email, action === "confirmed" ? (probationEnd(e.start) || end) : end, action, note || null, me(req)]);
    res.json({ ok: true });
    notify(email, action === "confirmed"
      ? { title: "Your probation is complete", body: "HR has confirmed your employment. Congratulations.", link: "/app/profile" }
      : { title: "Your probation has been extended", body: `It now ends on ${end}. ${note}`.trim(), link: "/app/profile" }).catch(() => {});
  }));

  /* ---------- Helpdesk ---------- */
  const ticketOut = (t, person) => ({ id: t.id, person: person(t.email), category: t.category, subject: t.subject, status: t.status, createdAt: t.created_at, updatedAt: t.updated_at });
  r.get("/api/tickets", wrap(async (req, res) => {
    const all = answers(req) && req.query.scope === "all";
    const { rows } = await pool.query(`SELECT id, email, category, subject, status, created_at, updated_at FROM tickets WHERE deleted_at IS NULL ${all ? "" : "AND lower(email)=$2"} ORDER BY (status='closed'), updated_at DESC LIMIT $1`, all ? [200] : [200, me(req)]);
    const person = await namesFor(rows.map((t) => t.email));
    res.json({ canAnswer: answers(req), tickets: rows.map((t) => ticketOut(t, person)) });
  }));
  r.post("/api/tickets", wrap(async (req, res) => {
    const { category, subject, body, errors } = readTicket(req.body);
    if (Object.keys(errors).length) return bad(res, errors);
    const { rows: [t] } = await pool.query("INSERT INTO tickets (email, category, subject, body) VALUES ($1,$2,$3,$4) RETURNING id", [me(req), category, subject, body]);
    res.status(201).json({ id: t.id });
  }));
  const loadTicket = async (req, res) => {
    const { rows: [t] } = await pool.query("SELECT id, email, category, subject, body, status, created_at, updated_at FROM tickets WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id)]);
    if (!t || (!answers(req) && t.email.toLowerCase() !== me(req))) { res.status(404).json({ error: "This request is not available." }); return null; }
    return t;
  };
  r.get("/api/tickets/:id", wrap(async (req, res) => {
    const t = await loadTicket(req, res); if (!t) return;
    const { rows } = await pool.query("SELECT id, author_email, body, created_at FROM ticket_replies WHERE ticket_id=$1 ORDER BY id LIMIT 300", [t.id]);
    const person = await namesFor([t.email, ...rows.map((x) => x.author_email)]);
    res.json({ canAnswer: answers(req), ticket: { ...ticketOut(t, person), body: t.body }, replies: rows.map((x) => ({ id: x.id, author: person(x.author_email), body: x.body, createdAt: x.created_at, mine: x.author_email.toLowerCase() === me(req) })) });
  }));
  r.post("/api/tickets/:id/reply", wrap(async (req, res) => {
    const t = await loadTicket(req, res); if (!t) return;
    if (t.status === "closed") return res.status(400).json({ error: "This request is closed. Please raise a new one." });
    const { body, errors } = readReply(req.body);
    if (Object.keys(errors).length) return bad(res, errors);
    const owner = t.email.toLowerCase() === me(req);
    await pool.query("INSERT INTO ticket_replies (ticket_id, author_email, body) VALUES ($1,$2,$3)", [t.id, me(req), body]);
    await pool.query("UPDATE tickets SET status=$2, updated_at=now() WHERE id=$1", [t.id, owner ? "open" : "answered"]);
    res.status(201).json({ ok: true });
    if (!owner) notify(t.email, { title: `HR replied: ${t.subject}`, body: body.slice(0, 140), link: `/app/helpdesk/${t.id}` }).catch(() => {});
  }));
  r.post("/api/tickets/:id/close", wrap(async (req, res) => {
    const t = await loadTicket(req, res); if (!t) return;
    await pool.query("UPDATE tickets SET status='closed', updated_at=now() WHERE id=$1", [t.id]);
    res.json({ ok: true });
  }));

  /* ---------- Exit interviews (exit.manage, for the people in scope) ---------- */
  r.get("/api/hr/exit-interviews", need("exit.manage"), wrap(async (req, res) => {
    const scope = await scopeOf(req, "exit.manage");
    const { rows } = await pool.query(`SELECT email, reason, notes, would_rehire, recorded_by, updated_at FROM exit_interviews
      ${scope ? "WHERE lower(email) = ANY($1)" : ""} ORDER BY updated_at DESC LIMIT 300`, scope ? [[...scope]] : []);
    const person = await namesFor(rows.map((x) => x.email));
    res.json({ interviews: rows.map((x) => ({ person: person(x.email), reason: x.reason, notes: x.notes, wouldRehire: x.would_rehire, updatedAt: x.updated_at })) });
  }));
  r.post("/api/hr/exit-interviews", need("exit.manage"), wrap(async (req, res) => {
    const { email, reason, notes, wouldRehire, errors } = readExit(req.body);
    if (!errors.email && !(await can(req, "exit.manage", email))) return res.status(403).json(NO_ACCESS);
    if (!errors.email && !(await isEmployee(email))) errors.email = "That person was not found.";
    if (Object.keys(errors).length) return bad(res, errors);
    await pool.query(
      `INSERT INTO exit_interviews (email, reason, notes, would_rehire, recorded_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (email) DO UPDATE SET reason=EXCLUDED.reason, notes=EXCLUDED.notes, would_rehire=EXCLUDED.would_rehire, recorded_by=EXCLUDED.recorded_by, updated_at=now()`,
      [email, reason, notes, wouldRehire, me(req)]);
    res.json({ ok: true });
  }));

  /* ---------- Hiring (hiring.manage, company-wide) ---------- */
  r.get("/api/hr/openings", hires, wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT o.id, o.title, o.dept, o.description, o.status, o.created_at, o.is_public, o.location, o.kind, o.experience,
         (SELECT count(*)::int FROM candidates c WHERE c.opening_id=o.id AND c.deleted_at IS NULL AND c.source='referral') AS referrals,
         (SELECT count(*)::int FROM candidates c WHERE c.opening_id=o.id AND c.deleted_at IS NULL) AS candidates,
         (SELECT count(*)::int FROM candidates c WHERE c.opening_id=o.id AND c.deleted_at IS NULL AND c.stage NOT IN ('hired','rejected')) AS active
       FROM job_openings o WHERE o.deleted_at IS NULL ORDER BY (o.status='closed'), o.created_at DESC LIMIT 200`);
    res.json({ openings: rows.map((o) => ({ id: o.id, title: o.title, dept: o.dept, description: o.description, status: o.status, createdAt: o.created_at, candidates: o.candidates, active: o.active,
      isPublic: o.is_public, location: o.location, kind: o.kind, experience: o.experience, referrals: o.referrals })) });
  }));
  r.post("/api/hr/openings", hires, wrap(async (req, res) => {
    const { title, dept, description, errors } = readOpening(req.body);
    const d = readJobDetails(req.body);
    if (Object.keys(errors).length) return bad(res, errors);
    const { rows: [o] } = await pool.query("INSERT INTO job_openings (title, dept, description, created_by, is_public, location, kind, experience) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [title, dept, description, me(req), d.isPublic, d.location, d.kind, d.experience]);
    res.status(201).json({ id: o.id });
    if (d.isPublic) postToChat("openings", { title: `We are hiring: ${title}`, text: [dept, d.location, d.kind].filter(Boolean).join(" · "), link: `/careers/${o.id}` });
  }));
  // Change a role: its text, and whether it shows on the public careers page.
  r.put("/api/hr/openings/:id", hires, wrap(async (req, res) => {
    const { title, dept, description, errors } = readOpening(req.body);
    const d = readJobDetails(req.body);
    if (Object.keys(errors).length) return bad(res, errors);
    const { rows: [was] } = await pool.query("SELECT is_public FROM job_openings WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id)]);
    const { rowCount } = await pool.query("UPDATE job_openings SET title=$2, dept=$3, description=$4, is_public=$5, location=$6, kind=$7, experience=$8 WHERE id=$1 AND deleted_at IS NULL",
      [idOf(req.params.id), title, dept, description, d.isPublic, d.location, d.kind, d.experience]);
    if (!rowCount) return res.status(404).json({ error: "This role is not available." });
    res.json({ ok: true });
    // Posted once, when a role first goes on the careers page.
    if (d.isPublic && was && !was.is_public) postToChat("openings", { title: `We are hiring: ${title}`, text: [dept, d.location, d.kind].filter(Boolean).join(" · "), link: `/careers/${idOf(req.params.id)}` });
  }));
  r.post("/api/hr/openings/:id/status", hires, wrap(async (req, res) => {
    const status = (req.body || {}).status === "closed" ? "closed" : "open";
    const { rowCount } = await pool.query("UPDATE job_openings SET status=$2 WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id), status]);
    if (!rowCount) return res.status(404).json({ error: "This role is not available." });
    res.json({ ok: true });
  }));
  r.get("/api/hr/openings/:id/candidates", hires, wrap(async (req, res) => {
    const { rows: [o] } = await pool.query("SELECT id, title, dept, description, status, is_public, location, kind, experience FROM job_openings WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id)]);
    if (!o) return res.status(404).json({ error: "This role is not available." });
    const { rows } = await pool.query(`SELECT c.id, c.name, c.email, c.phone, c.stage, c.notes, c.updated_at, c.source, c.referred_by, c.cover_note, c.profile_link, c.resume_name,
        (SELECT name FROM employees e WHERE lower(e.work_email)=lower(c.referred_by)) AS referrer
      FROM candidates c WHERE c.opening_id=$1 AND c.deleted_at IS NULL ORDER BY c.id LIMIT 500`, [o.id]);
    res.json({ opening: { ...o, isPublic: o.is_public }, candidates: rows.map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, stage: c.stage, notes: c.notes, updatedAt: c.updated_at,
      source: c.source, referredBy: c.referred_by ? { email: c.referred_by, name: c.referrer || c.referred_by } : null, coverNote: c.cover_note, link: c.profile_link, resume: c.resume_name ? { name: c.resume_name } : null })) });
  }));
  r.post("/api/hr/openings/:id/candidates", hires, wrap(async (req, res) => {
    const { name, email, phone, notes, stage, errors } = readCandidate(req.body);
    if (Object.keys(errors).length) return bad(res, errors);
    const { rows: [o] } = await pool.query("SELECT id FROM job_openings WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id)]);
    if (!o) return res.status(404).json({ error: "This role is not available." });
    const { rows: [c] } = await pool.query("INSERT INTO candidates (opening_id, name, email, phone, notes, stage) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [o.id, name, email, phone, notes, stage]);
    res.status(201).json({ id: c.id });
  }));
  r.put("/api/hr/candidates/:id", hires, wrap(async (req, res) => {
    const { name, email, phone, notes, stage, errors } = readCandidate(req.body);
    if (Object.keys(errors).length) return bad(res, errors);
    const { rowCount } = await pool.query("UPDATE candidates SET name=$2, email=$3, phone=$4, notes=$5, stage=$6, updated_at=now() WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id), name, email, phone, notes, stage]);
    if (!rowCount) return res.status(404).json({ error: "This candidate is not available." });
    res.json({ ok: true });
  }));
  r.delete("/api/hr/candidates/:id", hires, wrap(async (req, res) => {
    const { rowCount } = await pool.query("UPDATE candidates SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: "This candidate was not found. They may already have been removed." });
    res.json({ ok: true });
  }));

  /* A hired candidate becomes this user's onboarding draft, so Onboarding opens with their details filled in. */
  r.post("/api/hr/candidates/:id/onboard", hires, wrap(async (req, res) => {
    const { rows: [c] } = await pool.query(
      `SELECT c.name, c.email, c.phone, c.stage, o.title, o.dept FROM candidates c JOIN job_openings o ON o.id = c.opening_id WHERE c.id=$1 AND c.deleted_at IS NULL`, [idOf(req.params.id)]);
    if (!c) return res.status(404).json({ error: "This candidate is not available." });
    if (c.stage !== "hired") return res.status(409).json({ error: "Please mark the candidate as hired first." });
    await pool.query("INSERT INTO onboarding_drafts (id, data) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET data=$2, updated_at=now()",
      [me(req), JSON.stringify(candidateDraft(c, { title: c.title, dept: c.dept }))]);
    res.json({ ok: true, to: "/app/onboarding" });
  }));

  /* ---------- Interviews: hiring.manage schedules, interviewers see theirs and leave a recommendation ---------- */
  const ivOut = (x, who, withVerdicts) => ({ id: x.id, candidateId: x.candidate_id, candidate: x.candidate, role: x.role, at: x.at, minutes: x.minutes, mode: x.mode, place: x.place, note: x.note,
    cancelled: !!x.cancelled_at, interviewers: (x.interviewers || []).map((e) => ({ ...who(e), verdict: withVerdicts ? (x.verdicts || {})[e] || null : undefined })) });
  const IV_SELECT = `SELECT i.*, c.name AS candidate, o.title AS role FROM interviews i JOIN candidates c ON c.id = i.candidate_id JOIN job_openings o ON o.id = c.opening_id`;
  r.get("/api/hr/candidates/:id/interviews", hires, wrap(async (req, res) => {
    const { rows } = await pool.query(`${IV_SELECT} WHERE i.candidate_id=$1 ORDER BY i.at DESC LIMIT 50`, [idOf(req.params.id)]);
    const who = await namesFor(rows.flatMap((x) => x.interviewers || []));
    res.json({ interviews: rows.map((x) => ivOut(x, who, true)) });
  }));
  r.post("/api/hr/candidates/:id/interviews", hires, wrap(async (req, res) => {
    const x = readInterview(req.body);
    if (!x.errors.interviewers) {
      const { rows } = await pool.query("SELECT lower(work_email) AS e FROM employees WHERE lower(work_email) = ANY($1) AND status NOT IN ('offboarding','offboarded')", [x.interviewers]);
      if (rows.length !== x.interviewers.length) x.errors.interviewers = "Please choose interviewers from the staff list.";
    }
    if (Object.keys(x.errors).length) return bad(res, x.errors);
    const { rows: [c] } = await pool.query("SELECT c.id, c.name, c.stage, o.title FROM candidates c JOIN job_openings o ON o.id=c.opening_id WHERE c.id=$1 AND c.deleted_at IS NULL", [idOf(req.params.id)]);
    if (!c) return res.status(404).json({ error: "This candidate is not available." });
    const { rows: [row] } = await pool.query("INSERT INTO interviews (candidate_id, at, minutes, mode, place, note, interviewers, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [c.id, x.at, x.minutes, x.mode, x.place, x.note, JSON.stringify(x.interviewers), me(req)]);
    if (["applied", "screening"].includes(c.stage)) await pool.query("UPDATE candidates SET stage='interview', updated_at=now() WHERE id=$1", [c.id]);
    res.status(201).json({ id: row.id });
    const when = new Date(x.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    notify(x.interviewers, { title: `Interview: ${c.name}`, body: `${c.title}, ${when}. Please add it to your calendar from Interviews.`, link: "/app/interviews" }).catch(() => {});
  }));
  r.post("/api/hr/interviews/:id/cancel", hires, wrap(async (req, res) => {
    const { rows: [x] } = await pool.query("UPDATE interviews SET cancelled_at=now() WHERE id=$1 AND cancelled_at IS NULL RETURNING interviewers", [idOf(req.params.id)]);
    if (!x) return res.status(404).json({ error: "This interview was not found." });
    res.json({ ok: true });
    notify(x.interviewers || [], { title: "An interview was cancelled", body: "Please remove it from your calendar.", link: "/app/interviews" }).catch(() => {});
  }));
  /* Interviews you are on: upcoming ones and recent ones still waiting for your recommendation. */
  r.get("/api/interviews", wrap(async (req, res) => {
    const { rows } = await pool.query(`${IV_SELECT} WHERE i.interviewers ? $1 AND c.deleted_at IS NULL AND (i.at > now() - interval '60 days') ORDER BY i.at DESC LIMIT 100`, [me(req)]);
    const who = await namesFor(rows.flatMap((x) => x.interviewers || []));
    res.json({ interviews: rows.map((x) => ({ ...ivOut(x, who, false), mine: (x.verdicts || {})[me(req)] || null })) });
  }));
  r.put("/api/interviews/:id/verdict", wrap(async (req, res) => {
    const v = readVerdict(req.body);
    if (Object.keys(v.errors).length) return bad(res, v.errors);
    const { rows: [x] } = await pool.query(
      `UPDATE interviews SET verdicts = verdicts || jsonb_build_object($2::text, jsonb_build_object('verdict', $3::text, 'notes', $4::text, 'at', now()))
       WHERE id=$1 AND interviewers ? $2 AND cancelled_at IS NULL RETURNING candidate_id`, [idOf(req.params.id), me(req), v.verdict, v.notes]);
    if (!x) return res.status(404).json({ error: "This interview was not found." });
    res.json({ ok: true });
  }));
  r.get("/api/interviews/:id/calendar", wrap(async (req, res) => {
    const { rows: [x] } = await pool.query(`${IV_SELECT} WHERE i.id=$1 AND i.cancelled_at IS NULL`, [idOf(req.params.id)]);
    if (!x || (!canAll(req, "hiring.manage") && !(x.interviewers || []).includes(me(req)))) return res.status(404).json({ error: "This interview was not found." });
    const ics = interviewIcs({ id: x.id, at: new Date(x.at).toISOString(), minutes: x.minutes, title: `Interview: ${x.candidate}, ${x.role}`, place: x.place,
      description: [`${PRODUCT} interview (${x.mode}).`, x.note].filter(Boolean).join("\n") });
    res.set({ "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="interview-${x.id}.ics"`, "Cache-Control": "private, no-store" }).send(ics);
  }));

  /* ---------- Review cycles (reviews.manage for the whole company) ---------- */
  r.get("/api/review-cycles", needAll("reviews.manage"), wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.dept, to_char(c.self_due,'YYYY-MM-DD') AS self_due, to_char(c.manager_due,'YYYY-MM-DD') AS manager_due, c.status, c.created_at,
         count(r.id)::int AS total, count(r.id) FILTER (WHERE r.status='self-pending')::int AS self_pending,
         count(r.id) FILTER (WHERE r.status='manager-pending')::int AS manager_pending, count(r.id) FILTER (WHERE r.status='hr-pending')::int AS hr_pending,
         count(r.id) FILTER (WHERE r.status='done')::int AS done
       FROM review_cycles c LEFT JOIN reviews r ON r.cycle_id = c.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 50`);
    res.json({ cycles: rows.map((c) => ({ id: c.id, name: c.name, dept: c.dept, selfDue: c.self_due, managerDue: c.manager_due, status: c.status, total: c.total,
      selfPending: c.self_pending, managerPending: c.manager_pending, hrPending: c.hr_pending, done: c.done })) });
  }));
  r.post("/api/review-cycles", needAll("reviews.manage"), wrap(async (req, res) => {
    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const x = readCycle(req.body, today);
    if (Object.keys(x.errors).length) return bad(res, x.errors);
    // The department shown on screen: the stored one, or the one worked out from the job title (payroll/store.js deptOf).
    const staff = (await pool.query(
      `SELECT lower(e.work_email) AS email, lower(m.work_email) AS manager, e.dept, e.title FROM employees e
       LEFT JOIN employees m ON lower(m.work_email) = lower(e.manager_email) AND m.status NOT IN ('offboarding','offboarded')
       WHERE e.status NOT IN ('offboarding','offboarded') LIMIT 5000`)).rows.filter((p) => !x.dept || deptOf(p.dept, p.title).toLowerCase() === x.dept.toLowerCase());
    if (!staff.length) return bad(res, { dept: "No one is on the staff list for that department." });
    const client = await pool.connect();
    let made = [];
    try {
      await client.query("BEGIN");
      const { rows: [c] } = await client.query("INSERT INTO review_cycles (name, dept, self_due, manager_due, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id", [x.name, x.dept, x.selfDue, x.managerDue, me(req)]);
      const { rows } = await client.query(
        `INSERT INTO reviews (email, period, created_by, cycle_id, manager_email)
         SELECT s.e, $1, $2, $3, s.m FROM unnest($4::text[], $5::text[]) AS s(e, m) ON CONFLICT (lower(email), period) DO NOTHING RETURNING email`,
        [x.name, me(req), c.id, staff.map((p) => p.email), staff.map((p) => (p.manager && p.manager !== p.email ? p.manager : null))]);
      made = rows.map((y) => y.email);
      await client.query("COMMIT");
      res.status(201).json({ id: c.id, opened: made.length, skipped: staff.length - made.length });
    } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
    notify(made, { title: `Your ${x.name} review is open`, body: `Please write your self-review by ${x.selfDue}.`, link: "/app/reviews" }).catch(() => {});
  }));
  r.post("/api/review-cycles/:id/close", needAll("reviews.manage"), wrap(async (req, res) => {
    const { rowCount } = await pool.query("UPDATE review_cycles SET status='closed' WHERE id=$1 AND status='open'", [idOf(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: "This cycle is not open." });
    res.json({ ok: true });
  }));

  /* Calibration for one cycle: every review with the manager's rating, HR's calibrated rating and potential, the spread of
     ratings before and after, and the 9-box. reviews.manage for the whole company, like cycles. */
  r.get("/api/review-cycles/:id/calibration", needAll("reviews.manage"), wrap(async (req, res) => {
    const id = idOf(req.params.id);
    const { rows: [c] } = await pool.query("SELECT id, name, dept, status FROM review_cycles WHERE id=$1", [id]);
    if (!c) return res.status(404).json({ error: "This cycle was not found." });
    const { rows } = await pool.query(
      `SELECT r.id, r.email, r.status, r.self_at, r.manager_email, r.manager_rating, r.calibrated_rating, r.potential, r.calibration_note, r.calibrated_by,
         r.calibrated_at, r.rating, e.name, e.dept, e.title, m.name AS manager_name
       FROM reviews r LEFT JOIN employees e ON lower(e.work_email) = lower(r.email)
       LEFT JOIN employees m ON lower(m.work_email) = lower(r.manager_email)
       WHERE r.cycle_id = $1 ORDER BY e.name NULLS LAST, r.email LIMIT 2000`, [id]);
    const out = rows.map((x) => {
      const now = x.calibrated_rating || x.manager_rating || null;   // the rating as it stands: HR's if moved, else the manager's
      return { id: x.id, name: x.name || x.email, email: x.email, dept: deptOf(x.dept, x.title), status: x.status, selfDone: !!x.self_at,
        manager: x.manager_email ? (x.manager_name || x.manager_email) : null, managerRating: x.manager_rating, calibratedRating: x.calibrated_rating,
        rating: now, finalRating: x.rating, potential: x.potential, note: x.calibration_note || "", calibratedAt: x.calibrated_at, box: nineBox(now, x.potential) };
    });
    const dept = String(req.query.dept || "").trim().toLowerCase();
    const shown = dept ? out.filter((x) => String(x.dept).toLowerCase() === dept) : out;
    res.set("Cache-Control", "private, no-store");
    res.json({ cycle: { id: c.id, name: c.name, dept: c.dept, status: c.status }, depts: [...new Set(out.map((x) => x.dept).filter(Boolean))].sort(),
      potentials: POTENTIAL, reviews: shown,
      spread: { manager: spread(shown.map((x) => x.managerRating)), now: spread(shown.map((x) => x.rating)) } });
  }));
  /* Move a rating (with the reason when it differs from the manager's) and set potential. Not on a finished review, never your own. */
  r.put("/api/reviews/:id/calibrate", need("reviews.manage"), wrap(async (req, res) => {
    const { rows: [rv] } = await pool.query("SELECT id, email, status, manager_rating FROM reviews WHERE id=$1", [idOf(req.params.id)]);
    if (!rv) return res.status(404).json({ error: "This review is not available." });
    if (!(await mayDecide(req, "reviews.manage", rv.email))) return res.status(403).json(NO_ACCESS);
    if (rv.status === "done") return res.status(409).json({ error: "This review is finished, so its rating can no longer be calibrated." });
    const { rating, potential, note, errors } = readCalibration(req.body, rv.manager_rating);
    if (Object.keys(errors).length) return bad(res, errors);
    await pool.query(`UPDATE reviews SET calibrated_rating=$2, potential=$3, calibration_note=$4, calibrated_by=$5, calibrated_at=now(), updated_at=now()
      WHERE id=$1 AND status <> 'done'`, [rv.id, rating, potential, note, me(req)]);
    res.json({ ok: true, box: nineBox(rating, potential) });
  }));

  /* ---------- Performance reviews ---------- */
  // view: "own" (the person), "team" (their manager) or "all" (reviews.manage, for the people in scope).
  const reviewOut = (x, person, view, feedback = []) => {
    const done = x.status === "done", hr = view === "all", lead = view === "team" || hr;
    return { id: x.id, person: person(x.email), period: x.period, status: x.status, selfText: x.self_text || "", selfAt: x.self_at,
      manager: x.manager_email ? person(x.manager_email) : null,
      // The person sees the manager's and HR's review and rating only once it is finished.
      managerText: lead || done ? x.manager_text || "" : "", managerRating: lead || done ? x.manager_rating : null, managerAt: lead || done ? x.manager_at : null,
      hrText: hr || done ? x.hr_text || "" : "", rating: hr || done ? x.rating : null, updatedAt: x.updated_at,
      ...(hr ? { calibratedRating: x.calibrated_rating, calibrationNote: x.calibration_note || "" } : {}),
      // Colleague feedback: HR and the manager only, never the person reviewed.
      ...(lead ? { feedback: feedback.filter((f) => f.review_id === x.id).map((f) => ({ from: person(f.from_email), text: f.text || "", submittedAt: f.submitted_at })) } : {}) };
  };
  r.get("/api/reviews", wrap(async (req, res) => {
    const reviews = await can(req, "reviews.manage"), scope = reviews ? await scopeOf(req, "reviews.manage") : new Set();
    const view = reviews && req.query.scope === "all" ? "all" : req.query.scope === "team" ? "team" : "own";
    const where = view === "all" ? (scope ? "WHERE lower(email) = ANY($2)" : "") : view === "team" ? "WHERE lower(manager_email)=$2" : "WHERE lower(email)=$2";
    const { rows } = await pool.query(`SELECT id, email, period, self_text, self_at, hr_text, rating, status, updated_at, manager_email, manager_text, manager_rating, manager_at,
      calibrated_rating, calibration_note FROM reviews ${where} ORDER BY updated_at DESC LIMIT $1`, view !== "all" ? [500, me(req)] : scope ? [500, [...scope]] : [500]);
    const { rows: feedback } = view !== "own" && rows.length ? await pool.query("SELECT review_id, from_email, text, submitted_at FROM review_feedback WHERE review_id = ANY($1)", [rows.map((x) => x.id)]) : { rows: [] };
    const person = await namesFor([...rows.flatMap((x) => [x.email, x.manager_email]), ...feedback.map((f) => f.from_email)]);
    // A lead: anyone with people reporting to them, or named as the manager on a review.
    const isLead = view === "team" || (await reportsOf(pool, me(req))).length > 0
      || (await pool.query("SELECT 1 FROM reviews WHERE lower(manager_email)=$1 LIMIT 1", [me(req)])).rowCount > 0;
    // canManage: review cycles (whole company). canReviewOthers (new): the "all" view and the final review for the people in scope.
    // Your own review is always shown as its owner sees it: no colleague feedback, no unfinished reviews about you.
    res.json({ canManage: canAll(req, "reviews.manage"), canReviewOthers: reviews, isLead,
      reviews: rows.map((x) => reviewOut(x, person, x.email.toLowerCase() === me(req) ? "own" : view, feedback)) });
  }));
  r.post("/api/reviews", need("reviews.manage"), wrap(async (req, res) => {
    const { email, period, errors } = readReviewStart(req.body);
    if (!errors.email && !(await mayDecide(req, "reviews.manage", email))) return res.status(403).json(NO_ACCESS);
    if (!errors.email && !(await isEmployee(email))) errors.email = "That person was not found.";
    if (Object.keys(errors).length) return bad(res, errors);
    const manager = await managerOf(pool, email);
    const { rows: [x] } = await pool.query("INSERT INTO reviews (email, period, created_by, manager_email) VALUES ($1,$2,$3,$4) ON CONFLICT (lower(email), period) DO NOTHING RETURNING id", [email, period, me(req), manager && manager !== email ? manager : null]);
    if (!x) return res.status(409).json({ error: "This person already has a review for that period." });
    res.status(201).json({ id: x.id });
    notify(email, { title: `Your ${period} review is open`, body: "Please write your self-review.", link: "/app/reviews" }).catch(() => {});
  }));
  r.put("/api/reviews/:id/self", wrap(async (req, res) => {
    const { text, errors } = readReviewText(req.body);
    if (Object.keys(errors).length) return bad(res, errors);
    // Next step: the manager when there is one (and they have not written yet), otherwise HR.
    const { rows: [x] } = await pool.query(
      `UPDATE reviews SET self_text=$3, self_at=now(), updated_at=now(),
         status = CASE WHEN manager_email IS NOT NULL AND manager_text IS NULL THEN 'manager-pending' ELSE 'hr-pending' END
       WHERE id=$1 AND lower(email)=$2 AND status <> 'done' RETURNING status, manager_email, period`, [idOf(req.params.id), me(req), text]);
    if (!x) return res.status(409).json({ error: "This review is finished, so the self-review can no longer be changed." });
    res.json({ ok: true, status: x.status });
    if (x.status === afterSelf(x.manager_email) && x.status === "manager-pending") {
      const who = await namesFor([me(req)]);
      notify(x.manager_email, { title: `${who(me(req)).name} wrote their self-review`, body: `${x.period}: please write your review.`, link: "/app/reviews?view=team" }).catch(() => {});
    }
  }));
  /* The reporting manager's review, after the self-review and before HR finishes it. */
  r.put("/api/reviews/:id/manager", wrap(async (req, res) => {
    const { text, rating, errors } = readReviewText(req.body, true);
    if (Object.keys(errors).length) return bad(res, errors);
    const { rows: [x] } = await pool.query(
      `UPDATE reviews SET manager_text=$3, manager_rating=$4, manager_at=now(), updated_at=now(), status = CASE WHEN status='manager-pending' THEN 'hr-pending' ELSE status END
       WHERE id=$1 AND lower(manager_email)=$2 AND status <> 'done' RETURNING email`, [idOf(req.params.id), me(req), text, rating]);
    if (!x) return res.status(404).json({ error: "This review is not waiting for you." });
    res.json({ ok: true });
  }));
  /* Colleague feedback: reviews.manage (for the person, never about yourself) or the manager asks up to eight colleagues; each writes once; the person reviewed never sees it. */
  r.post("/api/reviews/:id/feedback-requests", wrap(async (req, res) => {
    const { rows: [rv] } = await pool.query("SELECT id, email, period, manager_email, status FROM reviews WHERE id=$1", [idOf(req.params.id)]);
    if (!rv || (String(rv.manager_email || "").toLowerCase() !== me(req) && !(await mayDecide(req, "reviews.manage", rv.email)))) return res.status(404).json({ error: "This review is not available." });
    if (rv.status === "done") return res.status(409).json({ error: "This review is finished." });
    const { emails, errors } = readFeedbackAsk(req.body, rv.email);
    if (Object.keys(errors).length) return bad(res, errors);
    const { rows: ok } = await pool.query("SELECT lower(work_email) AS e FROM employees WHERE lower(work_email) = ANY($1) AND status NOT IN ('offboarding','offboarded')", [emails]);
    const list = ok.map((x) => x.e);
    if (!list.length) return bad(res, { emails: "Please choose colleagues from the staff list." });
    const { rows } = await pool.query(
      "INSERT INTO review_feedback (review_id, from_email, asked_by) SELECT $1, e, $2 FROM unnest($3::text[]) AS e ON CONFLICT DO NOTHING RETURNING from_email", [rv.id, me(req), list]);
    res.json({ asked: rows.length });
    const who = await namesFor([rv.email]);
    notify(rows.map((x) => x.from_email), { title: `Feedback asked about ${who(rv.email).name}`, body: `For their ${rv.period} review. Your name is not shown to them.`, link: "/app/reviews?view=feedback" }).catch(() => {});
  }));
  r.get("/api/feedback-requests", wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT f.id, f.text, f.submitted_at, r.email, r.period, r.status FROM review_feedback f JOIN reviews r ON r.id = f.review_id
       WHERE lower(f.from_email)=$1 ORDER BY (f.submitted_at IS NOT NULL), f.created_at DESC LIMIT 100`, [me(req)]);
    const who = await namesFor(rows.map((x) => x.email));
    res.json({ requests: rows.map((x) => ({ id: x.id, about: who(x.email), period: x.period, text: x.text || "", submittedAt: x.submitted_at, open: x.status !== "done" })) });
  }));
  r.put("/api/feedback-requests/:id", wrap(async (req, res) => {
    const { text, errors } = readReviewText(req.body);
    if (Object.keys(errors).length) return bad(res, errors);
    const { rowCount } = await pool.query(
      `UPDATE review_feedback f SET text=$3, submitted_at=now() FROM reviews r WHERE r.id = f.review_id AND f.id=$1 AND lower(f.from_email)=$2 AND r.status <> 'done'`,
      [idOf(req.params.id), me(req), text]);
    if (!rowCount) return res.status(409).json({ error: "This review is finished, so feedback can no longer be added." });
    res.json({ ok: true });
  }));
  r.put("/api/reviews/:id/hr", need("reviews.manage"), wrap(async (req, res) => {
    const { text, rating, errors } = readReviewText(req.body, true);
    if (Object.keys(errors).length) return bad(res, errors);
    // The final review: reviews.manage for this person, and never your own.
    const { rows: [owner] } = await pool.query("SELECT email FROM reviews WHERE id=$1", [idOf(req.params.id)]);
    if (!owner) return res.status(404).json({ error: "This review is not available." });
    if (!(await mayDecide(req, "reviews.manage", owner.email))) return res.status(403).json(NO_ACCESS);
    const { rows: [x] } = await pool.query("UPDATE reviews SET hr_text=$2, rating=$3, status='done', updated_at=now() WHERE id=$1 RETURNING email, period", [idOf(req.params.id), text, rating]);
    if (!x) return res.status(404).json({ error: "This review is not available." });
    res.json({ ok: true });
    notify(x.email, { title: `Your ${x.period} review is ready`, body: "HR has finished your review.", link: "/app/reviews" }).catch(() => {});
  }));
  return r;
}
