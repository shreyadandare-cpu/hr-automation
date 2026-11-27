import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { UPLOAD_DIR } from "./documents.js";
import { MAX_BYTES, checkFile } from "./extract.js";
import { pool } from "./db.js";
import { requireAuth, unlessHidden } from "./auth.js";
import { can, canAll, mayDecide, need, scopeOf, treeOf } from "./access.js";
import { hrEmails, notify } from "./notify.js";
import { readProof } from "./finance-rules.js";
import { managerOf, reportsOf } from "./teams.js";
import { financialYear, readAdvance, readAppLink, readArticle, readAttendanceRequest, readDecision, readGoal, readPoll, readPraise, readLateDecision, readLateRequest, readTaxDeclaration, readTaxDates, readUnlock, tally, windowOpen, joinerUntil, BOTH_REGIMES } from "./engage-rules.js";
import { form124Pdf } from "./tax-forms.js";
import { correctionFits, correctionRoute, policyOf as missingPolicyOf } from "./missing-punch-rules.js";
import { NOW_SQL, ord } from "./work-day.js";
import { shiftOn } from "./shift-rules.js";
import { shiftsFor } from "./shifts.js";
import { estimateTax, yearForReturn } from "./tax-estimate.js";
import { postToChat } from "./chat.js";

/*
 * Engage and requests: polls, praise, articles, app links, advance requests and attendance requests.
 * Everyone signed in can read polls, praise, live articles and app links, vote once per poll and praise a colleague.
 * "Company posts and pages" (engage.manage) creates and removes polls, articles and app links and removes any praise.
 * Advance requests are decided with advances.approve and attendance requests with attendance.edit, for the people in scope,
 * never your own. People see only their own requests; holders see those of the people in scope.
 * Roles are checked here, never only on the page. Text is stored and shown as plain text.
 */
const mayManage = (req) => canAll(req, "engage.manage");
const me = (req) => req.user.email.toLowerCase();
const idOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const NO_ACCESS = { error: "You do not have access to this. Please ask a super admin if you need it." };
const PAGE = 50;

async function namesFor(emails) {
  const list = [...new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))];
  const { rows } = list.length ? await pool.query("SELECT lower(work_email) AS email, name, title FROM employees WHERE lower(work_email) = ANY($1)", [list]) : { rows: [] };
  const who = Object.fromEntries(rows.map((p) => [p.email, p]));
  return (email) => { const p = who[String(email).toLowerCase()]; return { email, name: p ? p.name : String(email).split("@")[0], title: p ? p.title : "" }; };
}

export function engageRouter(wrap) {
  const r = express.Router();
  r.use("/api/tax-declaration", requireAuth);   // a person's own tax declaration. The HR list of everyone's (/api/tax-declarations) is guarded by its permission.
  r.use("/api/tax-declarations", requireAuth);
  r.use(["/api/polls", "/api/praise", "/api/rewards", "/api/articles", "/api/apps", "/api/requests", "/api/remote-today", "/api/tax-declaration", "/api/goals"], requireAuth);

  r.use("/api/polls", unlessHidden("polls"));
  r.use("/api/articles", unlessHidden("articles"));

  /* ---------- Rewards (rewards.give gives; everyone reads their own) ---------- */
  r.get("/api/rewards", wrap(async (req, res) => {
    const all = req.query.scope === "all" && canAll(req, "rewards.give");
    const { rows } = await pool.query(`SELECT id, from_email, to_email, title, message, created_at FROM rewards WHERE deleted_at IS NULL ${all ? "" : "AND lower(to_email) = $2"} ORDER BY created_at DESC LIMIT $1`, all ? [PAGE] : [PAGE, me(req)]);
    const person = await namesFor(rows.flatMap((x) => [x.from_email, x.to_email]));
    res.json({ canGive: canAll(req, "rewards.give"), rewards: rows.map((x) => ({ id: x.id, from: person(x.from_email), to: person(x.to_email), title: x.title, message: x.message, createdAt: x.created_at })) });
  }));
  r.post("/api/rewards", wrap(async (req, res) => {
    if (!canAll(req, "rewards.give")) return res.status(403).json(NO_ACCESS);
    const to = String(req.body?.to || "").trim().toLowerCase(), title = String(req.body?.title || "").trim(), message = String(req.body?.message || "").trim();
    const errors = {};
    if (!to) errors.to = "Please choose who the reward is for.";
    else if (to === me(req)) errors.to = "Please choose a colleague. You cannot reward yourself.";
    else if (!(await pool.query("SELECT 1 FROM employees WHERE lower(work_email)=$1", [to])).rowCount) errors.to = "That person was not found.";
    if (!title) errors.title = "Please say what the reward is."; else if (title.length > 120) errors.title = "Please keep the reward under 120 characters.";
    if (message.length > 500) errors.message = "Please keep the note under 500 characters.";
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const { rows: [row] } = await pool.query("INSERT INTO rewards (to_email, from_email, title, message) VALUES ($1,$2,$3,$4) RETURNING id", [to, me(req), title, message]);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Reward "${title}" given by ${req.user.email}`, to]);
    res.status(201).json({ id: row.id });
    notify(to, { title: `You received a reward: ${title}`, body: message.slice(0, 140), link: "/app/praise?view=rewards" }).catch(() => {});
  }));

  /* ---------- Polls ---------- */
  r.get("/api/polls", wrap(async (req, res) => {
    const { rows: polls } = await pool.query("SELECT id, question, options, closes_at, created_by, created_at FROM polls WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1", [PAGE]);
    const ids = polls.map((p) => p.id);
    const { rows: counts } = ids.length ? await pool.query("SELECT poll_id, option_index, count(*)::int AS n FROM poll_votes WHERE poll_id = ANY($1) GROUP BY poll_id, option_index", [ids]) : { rows: [] };
    const { rows: mine } = ids.length ? await pool.query("SELECT poll_id, option_index FROM poll_votes WHERE poll_id = ANY($1) AND email = $2", [ids, me(req)]) : { rows: [] };
    const myVote = Object.fromEntries(mine.map((v) => [v.poll_id, v.option_index]));
    const now = Date.now();
    res.json({ canManage: mayManage(req), polls: polls.map((p) => {
      const t = tally(p.options.length, counts.filter((c) => c.poll_id === p.id));
      const closed = !!p.closes_at && new Date(p.closes_at).getTime() <= now;
      const voted = myVote[p.id] !== undefined;
      // Totals show once you have voted or the poll has closed, so the running count does not sway a vote. HR always sees them.
      return { id: p.id, question: p.question, options: p.options, closesAt: p.closes_at, createdAt: p.created_at, closed, myVote: voted ? myVote[p.id] : null,
        votes: t.votes, totals: voted || closed || mayManage(req) ? t.totals : null };
    }) });
  }));
  r.post("/api/polls", wrap(async (req, res) => {
    if (!mayManage(req)) return res.status(403).json(NO_ACCESS);
    const { question, options, closesAt, errors } = readPoll(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const { rows: [row] } = await pool.query("INSERT INTO polls (question, options, closes_at, created_by) VALUES ($1,$2,$3,$4) RETURNING id", [question, JSON.stringify(options), closesAt, me(req)]);
    res.status(201).json({ id: row.id });
  }));
  r.post("/api/polls/:id/vote", wrap(async (req, res) => {
    const id = idOf(req.params.id), option = Number((req.body || {}).option);
    const { rows: [p] } = await pool.query("SELECT options, closes_at FROM polls WHERE id=$1 AND deleted_at IS NULL", [id]);
    if (!p) return res.status(404).json({ error: "This poll is no longer available." });
    if (p.closes_at && new Date(p.closes_at) <= new Date()) return res.status(400).json({ error: "This poll has closed." });
    if (!Number.isInteger(option) || option < 0 || option >= p.options.length) return res.status(400).json({ error: "Please choose one of the options." });
    await pool.query("INSERT INTO poll_votes (poll_id, email, option_index) VALUES ($1,$2,$3) ON CONFLICT (poll_id, email) DO UPDATE SET option_index = EXCLUDED.option_index, created_at = now()", [id, me(req), option]);
    res.json({ ok: true });
  }));
  r.delete("/api/polls/:id", wrap(async (req, res) => {
    if (!mayManage(req)) return res.status(403).json(NO_ACCESS);
    const { rowCount } = await pool.query("UPDATE polls SET deleted_at = now() WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: "This poll was not found. It may already have been removed." });
    res.json({ ok: true });
  }));

  /* ---------- Praise ---------- */
  r.get("/api/praise", wrap(async (req, res) => {
    const scope = req.query.scope === "mine" ? "mine" : req.query.scope === "given" ? "given" : "all";
    const where = scope === "mine" ? "AND lower(to_email) = $2" : scope === "given" ? "AND lower(from_email) = $2" : "";
    const { rows } = await pool.query(`SELECT id, from_email, to_email, message, badge, created_at FROM praises WHERE deleted_at IS NULL ${where} ORDER BY created_at DESC LIMIT $1`, scope === "all" ? [PAGE] : [PAGE, me(req)]);
    const person = await namesFor(rows.flatMap((x) => [x.from_email, x.to_email]));
    res.json({ praise: rows.map((x) => ({ id: x.id, from: person(x.from_email), to: person(x.to_email), message: x.message, badge: x.badge, createdAt: x.created_at,
      canDelete: mayManage(req) || x.from_email.toLowerCase() === me(req) })) });
  }));
  r.post("/api/praise", wrap(async (req, res) => {
    const { to, message, badge, errors } = readPraise(req.body, me(req));
    if (!errors.to) { const { rows } = await pool.query("SELECT 1 FROM employees WHERE lower(work_email)=$1", [to]); if (!rows.length) errors.to = "That person was not found. Please choose a colleague from the list."; }
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const { rows: [row] } = await pool.query("INSERT INTO praises (from_email, to_email, message, badge) VALUES ($1,$2,$3,$4) RETURNING id", [me(req), to, message, badge]);
    const person = await namesFor([me(req)]);
    res.status(201).json({ id: row.id });
    namesFor([to]).then((p2) => postToChat("praise", { title: `${person(me(req)).name} praised ${p2(to).name}`, text: message.slice(0, 300), link: "/app/praise" })).catch(() => {});
    notify(to, { title: `${person(me(req)).name} praised you`, body: message.slice(0, 140), link: "/app/praise" }).catch(() => {});   // after the response; a failed notice never fails the praise
  }));
  r.delete("/api/praise/:id", wrap(async (req, res) => {
    const id = idOf(req.params.id);
    const { rows: [x] } = await pool.query("SELECT from_email FROM praises WHERE id=$1 AND deleted_at IS NULL", [id]);
    if (!x) return res.status(404).json({ error: "This praise is no longer available." });
    if (!mayManage(req) && x.from_email.toLowerCase() !== me(req)) return res.status(403).json({ error: "You can only remove praise you gave." });
    await pool.query("UPDATE praises SET deleted_at = now() WHERE id=$1", [id]);
    res.json({ ok: true });
  }));

  /* ---------- Articles ---------- */
  const article = (a, person, full) => ({ id: a.id, title: a.title, status: a.status, requiresAck: !!a.requires_ack, author: person(a.author_email), publishedAt: a.published_at, updatedAt: a.updated_at,
    ...(full ? { body: a.body } : { excerpt: a.body.slice(0, 220) }) });
  r.get("/api/articles", wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT id, title, body, status, requires_ack, author_email, published_at, updated_at FROM articles WHERE deleted_at IS NULL ${mayManage(req) ? "" : "AND status = 'live'"} ORDER BY coalesce(published_at, updated_at) DESC LIMIT $1`, [PAGE]);
    const person = await namesFor(rows.map((a) => a.author_email));
    res.json({ canManage: mayManage(req), articles: rows.map((a) => article(a, person, false)) });
  }));
  r.get("/api/articles/:id", wrap(async (req, res) => {
    const { rows: [a] } = await pool.query("SELECT id, title, body, status, requires_ack, author_email, published_at, updated_at FROM articles WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id)]);
    if (!a || (a.status !== "live" && !mayManage(req))) return res.status(404).json({ error: "This article is not available." });
    const { rows: [mine] } = await pool.query("SELECT acked_at FROM article_acks WHERE article_id=$1 AND email=$2", [a.id, me(req)]);
    res.json({ canManage: mayManage(req), article: { ...article(a, await namesFor([a.author_email]), true), ackedAt: mine ? mine.acked_at : null } });
  }));
  r.post("/api/articles", wrap(async (req, res) => {
    if (!mayManage(req)) return res.status(403).json(NO_ACCESS);
    const { title, body, status, requiresAck, errors } = readArticle(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const { rows: [row] } = await pool.query("INSERT INTO articles (title, body, status, author_email, published_at, requires_ack) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [title, body, status, me(req), status === "live" ? new Date() : null, requiresAck]);
    res.status(201).json({ id: row.id });
  }));
  r.put("/api/articles/:id", wrap(async (req, res) => {
    if (!mayManage(req)) return res.status(403).json(NO_ACCESS);
    const { title, body, status, requiresAck, errors } = readArticle(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const { rowCount } = await pool.query("UPDATE articles SET title=$2, body=$3, status=$4, requires_ack=$5, updated_at=now(), published_at = CASE WHEN $4 = 'live' THEN coalesce(published_at, now()) ELSE published_at END WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id), title, body, status, requiresAck]);
    if (!rowCount) return res.status(404).json({ error: "This article is not available." });
    res.json({ ok: true });
  }));
  r.delete("/api/articles/:id", wrap(async (req, res) => {
    if (!mayManage(req)) return res.status(403).json(NO_ACCESS);
    const { rowCount } = await pool.query("UPDATE articles SET deleted_at = now() WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: "This article was not found. It may already have been removed." });
    res.json({ ok: true });
  }));

  // Policy sign-off: "I have read this", once per person, and for HR the list of who has and who has not.
  r.post("/api/articles/:id/ack", wrap(async (req, res) => {
    const { rows: [a] } = await pool.query("SELECT id FROM articles WHERE id=$1 AND deleted_at IS NULL AND status='live' AND requires_ack", [idOf(req.params.id)]);
    if (!a) return res.status(404).json({ error: "This article does not ask for confirmation." });
    await pool.query("INSERT INTO article_acks (article_id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING", [a.id, me(req)]);
    res.json({ ok: true });
  }));
  r.get("/api/articles/:id/acks", wrap(async (req, res) => {
    if (!mayManage(req)) return res.status(403).json(NO_ACCESS);
    const id = idOf(req.params.id);
    const { rows } = await pool.query(
      `SELECT e.name, lower(e.work_email) AS email, a.acked_at FROM employees e LEFT JOIN article_acks a ON a.article_id=$1 AND a.email = lower(e.work_email)
       WHERE e.status <> 'offboarded' ORDER BY (a.acked_at IS NULL) DESC, e.name LIMIT 1000`, [id]);
    res.json({ done: rows.filter((x) => x.acked_at).length, total: rows.length, people: rows.map((x) => ({ name: x.name, email: x.email, ackedAt: x.acked_at })) });
  }));

  /* ---------- Apps ---------- */
  r.get("/api/apps", wrap(async (req, res) => {
    const { rows } = await pool.query("SELECT id, title, url, description FROM app_links WHERE deleted_at IS NULL ORDER BY lower(title) LIMIT 100");
    res.json({ canManage: mayManage(req), apps: rows });
  }));
  r.post("/api/apps", wrap(async (req, res) => {
    if (!mayManage(req)) return res.status(403).json(NO_ACCESS);
    const { title, url, description, errors } = readAppLink(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const { rows: [row] } = await pool.query("INSERT INTO app_links (title, url, description, created_by) VALUES ($1,$2,$3,$4) RETURNING id", [title, url, description, me(req)]);
    res.status(201).json({ id: row.id });
  }));
  r.delete("/api/apps/:id", wrap(async (req, res) => {
    if (!mayManage(req)) return res.status(403).json(NO_ACCESS);
    const { rowCount } = await pool.query("UPDATE app_links SET deleted_at = now() WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: "This app link was not found. It may already have been removed." });
    res.json({ ok: true });
  }));

  /* ---------- Requests: advance and attendance ---------- */
  const REQ = {
    advance: { perm: "advances.approve", table: "advance_requests", cols: "id, email, amount_minor, currency, reason, status, decided_by, decided_at, decision_note, created_at", order: "created_at DESC",
      out: (x) => ({ amount: Number(x.amount_minor) / 100, currency: x.currency, reason: x.reason }), label: "advance request" },
    // Attendance requests are also decided by anyone above the person in the reporting lines (their manager), as leave is.
    attendance: { perm: "attendance.edit", table: "attendance_requests", team: true,
      cols: "id, email, to_char(on_date, 'YYYY-MM-DD') AS on_date, kind, note, to_char(punch_time, 'HH24:MI') AS punch_time, direction, self_fix, status, decided_by, decided_at, decision_note, created_at", order: "created_at DESC",
      out: (x) => ({ date: x.on_date, kind: x.kind, note: x.note, time: x.punch_time || null, direction: x.direction || null, selfFix: !!x.self_fix }), label: "attendance request" },
  };
  r.get("/api/requests/:type", wrap(async (req, res) => {
    const t = REQ[req.params.type];
    if (!t) return res.status(404).json({ error: "Not found." });
    // scope=all: everyone the caller may decide for (null = the whole company), otherwise the caller's own. For attendance
    // that includes everyone below the caller in the reporting lines.
    const below = t.team ? await treeOf(me(req)) : new Set();
    const granted = await can(req, t.perm);
    const holds = granted || below.size > 0;
    let scope = granted ? await scopeOf(req, t.perm) : new Set();
    if (scope && below.size) scope = new Set([...scope, ...below]);
    const all = holds && req.query.scope === "all";
    const { rows } = await pool.query(`SELECT ${t.cols} FROM ${t.table} WHERE deleted_at IS NULL ${!all ? "AND lower(email) = $2" : scope ? "AND lower(email) = ANY($2)" : ""} ORDER BY ${t.order} LIMIT $1`,
      !all ? [100, me(req)] : scope ? [100, [...scope]] : [100]);
    const person = await namesFor(rows.map((x) => x.email));
    const decides = (e) => holds && String(e).toLowerCase() !== me(req) && (!scope || scope.has(String(e).toLowerCase()));   // never your own
    res.json({ canDecide: holds, requests: rows.map((x) => ({ id: x.id, person: person(x.email), status: x.status, decidedAt: x.decided_at, decisionNote: x.decision_note, createdAt: x.created_at,
      canDecide: decides(x.email), ...t.out(x) })) });
  }));
  r.post("/api/requests/advance", wrap(async (req, res) => {
    const { amountMinor, reason, errors } = readAdvance(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const { rows: [row] } = await pool.query("INSERT INTO advance_requests (email, amount_minor, reason) VALUES ($1,$2,$3) RETURNING id", [me(req), amountMinor, reason]);
    res.status(201).json({ id: row.id });
  }));
  r.post("/api/requests/attendance", wrap(async (req, res) => {
    const { rows: [w] } = await pool.query(NOW_SQL);
    const now = { d: w.day, t: w.time.slice(0, 5) };   // the working day (it starts at 5 am, work-day.js) and the clock time
    const { date, kind, note, time, direction, errors } = readAttendanceRequest(req.body, now.d, now.t);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    if (kind !== "missed-punch") {
      const { rows: [row] } = await pool.query("INSERT INTO attendance_requests (email, on_date, kind, note) VALUES ($1,$2,$3,$4) RETURNING id", [me(req), date, kind, note]);
      res.status(201).json({ id: row.id, status: "pending" });
      const boss = await managerOf(pool, me(req));
      notify([boss, ...(await hrEmails("attendance.edit"))].filter(Boolean), { title: "Attendance request to review", body: `A request about ${kind.replace(/-/g, " ")} on ${date} is waiting.`, link: boss ? "/app/team-requests" : "/app/hr-requests" }).catch(() => {});
      return;
    }
    // A missed punch, as Keka handles it: within HR's limits (how far back, how many a month), the first few each month are added
    // straight away with no approval (an adjustment); after that they go to the reporting manager and HR, either of whom approves.
    const client = await pool.connect();
    let out;
    try {
      await client.query("BEGIN");
      const emp = (await client.query("SELECT id FROM employees WHERE lower(work_email)=$1 FOR UPDATE", [me(req)])).rows[0];
      if (!emp) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Your employee record was not found. Please ask the HR team to check your work email." }); }
      const dup = await client.query("SELECT 1 FROM attendance_requests WHERE lower(email)=$1 AND on_date=$2 AND kind='missed-punch' AND status='pending' AND deleted_at IS NULL", [me(req), date]);
      if (dup.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ error: "You already asked for a correction for this day. It is waiting for a decision." }); }
      const policy = missingPolicyOf((await client.query("SELECT * FROM attendance_policy WHERE id=1")).rows[0]);
      const { rows: [used] } = await client.query(
        `SELECT count(*)::int AS requests, count(*) FILTER (WHERE self_fix)::int AS self_fixes FROM attendance_requests
          WHERE lower(email)=$1 AND kind='missed-punch' AND deleted_at IS NULL AND status <> 'declined' AND date_trunc('month', on_date) = date_trunc('month', $2::date)`, [me(req), date]);
      // Only a punch the day is really missing is added without approval; anything else (a whole day to the shift, a later
      // punch-out on a complete day) goes to the manager or HR, and a time that cannot fix the day is refused.
      const day = (await client.query("SELECT to_char(punch_time,'HH24:MI') AS time, direction, source FROM attendance_punches WHERE employee_id=$1 AND work_date=$2", [emp.id, date])).rows;
      const fit = correctionFits({ punches: day, time, direction });
      if (fit.refuse) { await client.query("ROLLBACK"); return res.status(409).json({ error: fit.refuse }); }
      let route = correctionRoute({ date, today: now.d, policy, used: { requests: used.requests, selfFixes: used.self_fixes } });
      if (route.selfFix && !fit.fits) route = { approval: true };
      if (route.refuse) { await client.query("ROLLBACK"); return res.status(409).json({ error: route.refuse }); }
      const { rows: [row] } = await client.query(
        `INSERT INTO attendance_requests (email, on_date, kind, note, punch_time, direction, self_fix, status, decided_by, decided_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [me(req), date, kind, note, time, direction, !!route.selfFix, route.selfFix ? "approved" : "pending", route.selfFix ? "self (no approval needed)" : null, route.selfFix ? new Date() : null]);
      if (route.selfFix) {
        const there = await client.query("SELECT 1 FROM attendance_punches WHERE employee_id=$1 AND work_date=$2 AND punch_time=$3::time AND direction=$4", [emp.id, date, time, direction]);
        if (!there.rowCount) await client.query("INSERT INTO attendance_punches (employee_id, work_date, punch_time, direction, source, note, created_by) VALUES ($1,$2,$3,$4,'request',$5,$6)",
          [emp.id, date, time, direction, "Added by the employee (no approval needed)", me(req)]);
        await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Attendance: ${direction} at ${time} on ${date} added by the employee (${used.self_fixes + 1} of ${policy.selfFixPerMonth} without approval this month)`, me(req)]);
      }
      await client.query("COMMIT");
      out = { id: row.id, status: route.selfFix ? "approved" : "pending", selfFix: !!route.selfFix, selfFixesLeft: Math.max(0, policy.selfFixPerMonth - used.self_fixes - (route.selfFix ? 1 : 0)) };
    } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
    res.status(201).json(out);
    if (out.selfFix) return;
    // Waiting for approval: the reporting manager and the HR team are both told, and either decides.
    const boss = await managerOf(pool, me(req));
    const what = direction === "SHIFT" ? `regularising ${date} to the shift` : `a missed punch ${direction === "OUT" ? "out" : "in"} at ${time} on ${date}`;
    if (boss) notify(boss, { title: "Attendance correction to review", body: `A request about ${what} is waiting for you.`, link: "/app/team-requests" }).catch(() => {});
    notify("perm:attendance.edit", { title: "Attendance correction to review", body: `A request about ${what} is waiting.`, link: "/app/hr-requests" }).catch(() => {});
  }));
  r.post("/api/requests/:type/:id/decide", wrap(async (req, res) => {
    const t = REQ[req.params.type];
    if (!t) return res.status(404).json({ error: "Not found." });
    const { decision, note, errors } = readDecision(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    // Whoever holds the permission for this person decides, but never on their own request.
    const { rows: [owner] } = await pool.query(`SELECT email FROM ${t.table} WHERE id=$1 AND deleted_at IS NULL`, [idOf(req.params.id)]);
    if (!owner) return res.status(404).json({ error: "This request is no longer available." });
    const own = String(owner.email).toLowerCase() === me(req);
    const above = t.team && !own && (await treeOf(me(req))).has(String(owner.email).toLowerCase());
    if (!above && !(await mayDecide(req, t.perm, owner.email))) return res.status(403).json(NO_ACCESS);
    const client = await pool.connect();
    let x;
    try {
      await client.query("BEGIN");
      x = (await client.query(`UPDATE ${t.table} SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1 AND status='pending' AND deleted_at IS NULL
        RETURNING email${t.team ? ", kind, to_char(on_date,'YYYY-MM-DD') AS on_date, to_char(punch_time,'HH24:MI') AS punch_time, direction" : ""}`, [idOf(req.params.id), decision, me(req), note || null])).rows[0];
      if (!x) { await client.query("ROLLBACK"); return res.status(409).json({ error: "This request has already been decided." }); }
      // An approved missed punch with a time adds that punch, so the day is counted from the real times (unless it is already there).
      // A day regularised to the shift (SHIFT) gets the shift's start and end, where the real punches do not already cover them.
      if (t.team && decision === "approved" && x.kind === "missed-punch" && (x.punch_time || x.direction === "SHIFT")) {
        const emp = (await client.query("SELECT id, work_email FROM employees WHERE lower(work_email)=lower($1)", [x.email])).rows[0];
        if (emp) {
          const have = (await client.query("SELECT to_char(punch_time,'HH24:MI') AS t, direction FROM attendance_punches WHERE employee_id=$1 AND work_date=$2", [emp.id, x.on_date])).rows;
          const add = async (time, direction, why) => {
            if (have.some((p) => p.t === time && p.direction === direction)) return;
            await client.query("INSERT INTO attendance_punches (employee_id, work_date, punch_time, direction, source, note, created_by) VALUES ($1,$2,$3,$4,'request',$5,$6)",
              [emp.id, x.on_date, time, direction, why, me(req)]);
          };
          if (x.direction === "SHIFT") {
            const sh = await shiftsFor(client, x.on_date, x.on_date, [emp.work_email]);
            const shift = shiftOn(sh.of(emp.work_email), sh.fallback, x.on_date);
            const ins = have.filter((p) => p.direction === "IN").map((p) => ord(p.t)), outs = have.filter((p) => p.direction === "OUT").map((p) => ord(p.t));
            if (!ins.length || Math.min(...ins) > ord(shift.start)) await add(shift.start, "IN", `Regularised to the shift by ${me(req)}`);
            if (!outs.length || Math.max(...outs) < ord(shift.end)) await add(shift.end, "OUT", `Regularised to the shift by ${me(req)}`);
            await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Attendance: ${x.on_date} regularised to the shift (${shift.start} to ${shift.end}) by ${me(req)}`, x.email]);
          } else {
            await add(x.punch_time, x.direction, `Correction approved by ${me(req)}`);
            await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Attendance: ${x.direction} at ${x.punch_time} on ${x.on_date} added from an approved correction by ${me(req)}`, x.email]);
          }
        }
      }
      await client.query("COMMIT");
    } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
    res.json({ ok: true });
    notify(x.email, { title: `Your ${t.label} was ${decision}`, body: note || "", link: "/app/requests" }).catch(() => {});
  }));
  r.post("/api/requests/:type/:id/cancel", wrap(async (req, res) => {
    const t = REQ[req.params.type];
    if (!t) return res.status(404).json({ error: "Not found." });
    const { rowCount } = await pool.query(`UPDATE ${t.table} SET deleted_at=now() WHERE id=$1 AND lower(email)=$2 AND status='pending' AND deleted_at IS NULL`, [idOf(req.params.id), me(req)]);
    if (!rowCount) return res.status(409).json({ error: "Only a request that is still waiting can be cancelled." });
    res.json({ ok: true });
  }));

  /* ---------- Working remotely today: approved work-from-home requests for today ---------- */
  r.get("/api/remote-today", wrap(async (_req, res) => {
    const { rows } = await pool.query("SELECT DISTINCT lower(email) AS email FROM attendance_requests WHERE deleted_at IS NULL AND status='approved' AND kind='work-from-home' AND on_date = (now() AT TIME ZONE 'Asia/Kolkata')::date LIMIT 100");
    const person = await namesFor(rows.map((x) => x.email));
    res.json({ people: rows.map((x) => person(x.email)) });
  }));

  /* ---------- Tax declaration request: the person's own, one per financial year. payroll.view reads those of the people in scope with ?email=.
     It is a submission for payroll to review. Payroll's own tax_declarations table, which the calculation uses, is never written here. ---------- */
  const today = async () => (await pool.query("SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS d")).rows[0].d;
  const filesOf = async (id) => (id ? (await pool.query("SELECT line_index, name, size FROM tax_proof_files WHERE request_id=$1", [id])).rows : []);
  const dropFiles = async (id, index = null) => {
    const { rows } = await pool.query(`DELETE FROM tax_proof_files WHERE request_id=$1 ${index == null ? "" : "AND line_index=$2"} RETURNING stored`, index == null ? [id] : [id, index]);
    for (const f of rows) await fs.rm(path.join(UPLOAD_DIR, path.basename(f.stored)), { force: true }).catch(() => {});
    return rows.length;
  };
  const taxOut = (x, fy, files = [], fallback = "new") => ({ financialYear: fy, regime: x ? x.regime : fallback, status: x ? x.status : "draft", submittedAt: x ? x.submitted_at : null,
    items: x ? x.items.map((i, n) => { const pr = (x.proofs || {})[n]; return { section: i.section, description: i.description, amount: Number(i.amountMinor) / 100, party: i.party || null, proof: pr ? { status: pr.status, note: pr.note || "", at: pr.at, approved: pr.approvedMinor != null ? Number(pr.approvedMinor) / 100 : null } : null, file: (() => { const f = files.find((y) => y.line_index === n); return f ? { name: f.name, size: f.size } : null; })() }; }) : [] });
  /* ---------- Regime policy: which regime a declaration starts on, and the policy document behind it. ----------
     payroll.prepare (company-wide) sets the default (New or Old) for a financial year and uploads the policy document. It carries over
     to the next year until it is changed. Everyone sees it on their declaration, which starts on that regime; they can still change it.
     It never changes a declaration someone has saved, and it does not touch payroll's own tax_declarations (which the calculation uses). */
  const policyOf = async (fy) => {
    const { rows: [p] } = await pool.query(`SELECT financial_year, default_regime, doc_name, doc_size, updated_by, updated_at, to_char(declaration_due,'YYYY-MM-DD') AS declaration_due,
      to_char(proof_due,'YYYY-MM-DD') AS proof_due, joiner_days FROM tax_regime_policies WHERE financial_year <= $1 ORDER BY financial_year DESC LIMIT 1`, [fy]);
    if (!p) return { financialYear: fy, defaultRegime: "new", set: false, document: null, updatedBy: null, updatedAt: null, declarationDue: null, proofDue: null, joinerDays: null };
    const who = await namesFor([p.updated_by]);
    const own = p.financial_year === fy;   // due dates belong to their own year only
    return { financialYear: fy, setForYear: p.financial_year, defaultRegime: p.default_regime, set: true, document: p.doc_name ? { name: p.doc_name, size: p.doc_size } : null, updatedBy: who(p.updated_by).name, updatedAt: p.updated_at,
      declarationDue: own ? p.declaration_due : null, proofDue: own ? p.proof_due : null, joinerDays: p.joiner_days };   // the joiner period carries over
  };
  /** Whether this person may still change their declaration and their proofs: the due dates, unless payroll reopened it for them. */
  const windowFor = async (email, fy, pol, day) => {
    const [{ rows }, { rows: [emp] }] = await Promise.all([
      pool.query("SELECT kind, to_char(until,'YYYY-MM-DD') AS until FROM tax_declaration_unlocks WHERE lower(email)=$1 AND financial_year=$2", [email, fy]),
      pool.query("SELECT to_char(start_date,'YYYY-MM-DD') AS start FROM employees WHERE lower(work_email)=$1", [email])]);
    const until = (k) => { const u = rows.find((x) => x.kind === k); return u ? u.until : null; };
    const joiner = joinerUntil(emp && emp.start, pol.joinerDays);   // a new joiner's own period, for both the declaration and the proofs
    const one = (k, due) => ({ due, unlockedUntil: until(k), joinerUntil: joiner, open: windowOpen({ today: day, due, unlockedUntil: until(k), joinerUntil: joiner }) });
    return { today: day, declaration: one("declaration", pol.declarationDue), proof: one("proof", pol.proofDue) };
  };
  const mayManagePolicy = (req, res) => (canAll(req, "payroll.prepare") ? true : (res.status(403).json(NO_ACCESS), false));
  const noteAudit = (req, text) => pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [text, me(req)]).catch(() => {});
  /** The row for this year (made from last year's policy if this year has none yet), so the default and the document are kept together. */
  const rowForYear = async (fy, email) => {
    const { rows: [mine] } = await pool.query("SELECT * FROM tax_regime_policies WHERE financial_year=$1", [fy]);
    if (mine) return mine;
    const { rows: [prev] } = await pool.query("SELECT * FROM tax_regime_policies WHERE financial_year < $1 ORDER BY financial_year DESC LIMIT 1", [fy]);
    const { rows: [made] } = await pool.query(
      "INSERT INTO tax_regime_policies (financial_year, default_regime, doc_name, doc_mime, doc_size, doc_stored, updated_by, joiner_days) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [fy, prev ? prev.default_regime : "new", prev ? prev.doc_name : null, prev ? prev.doc_mime : null, prev ? prev.doc_size : null, prev ? prev.doc_stored : null, email, prev ? prev.joiner_days : null]);
    return made;
  };
  const stillUsed = async (stored, fy) => stored && (await pool.query("SELECT 1 FROM tax_regime_policies WHERE doc_stored=$1 AND financial_year <> $2 LIMIT 1", [stored, fy])).rowCount > 0;
  r.get("/api/tax-declaration/policy", wrap(async (req, res) => {
    res.json({ ...(await policyOf(financialYear(await today()))), canManage: canAll(req, "payroll.prepare") });
  }));
  r.put("/api/tax-declaration/policy", wrap(async (req, res) => {
    if (!mayManagePolicy(req, res)) return;
    const regime = req.body && req.body.defaultRegime;
    if (regime !== "new" && regime !== "old") return res.status(400).json({ error: "Choose the New regime or the Old regime." });
    const fy = financialYear(await today());
    await rowForYear(fy, me(req));
    await pool.query("UPDATE tax_regime_policies SET default_regime=$2, updated_by=$3, updated_at=now() WHERE financial_year=$1", [fy, regime, me(req)]);
    await noteAudit(req, `Tax regime policy for ${fy}-${String(fy + 1).slice(2)}: ${regime === "old" ? "Old" : "New"} regime is the default`);
    res.json({ ...(await policyOf(fy)), canManage: true });
  }));
  r.put("/api/tax-declaration/policy/document", express.raw({ type: () => true, limit: MAX_BYTES }), wrap(async (req, res) => {
    if (!mayManagePolicy(req, res)) return;
    const file = await checkFile(req.body);
    if (!file.ok) return res.status(400).json({ error: file.checks.find((c) => !c.ok).label });
    const fy = financialYear(await today()), row = await rowForYear(fy, me(req));
    const stored = crypto.randomUUID() + "." + file.type.ext, name = String(req.query.name || "tax-policy").replace(/[^\w.\- ()]/g, "_").slice(0, 120);
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(path.join(UPLOAD_DIR, stored), req.body);
    await pool.query("UPDATE tax_regime_policies SET doc_name=$2, doc_mime=$3, doc_size=$4, doc_stored=$5, updated_by=$6, updated_at=now() WHERE financial_year=$1", [fy, name, file.type.mime, req.body.length, stored, me(req)]);
    if (row.doc_stored && !(await stillUsed(row.doc_stored, fy))) await fs.rm(path.join(UPLOAD_DIR, path.basename(row.doc_stored)), { force: true }).catch(() => {});
    await noteAudit(req, `Tax regime policy document uploaded for ${fy}-${String(fy + 1).slice(2)}`);
    res.json({ ...(await policyOf(fy)), canManage: true });
  }));
  r.delete("/api/tax-declaration/policy/document", wrap(async (req, res) => {
    if (!mayManagePolicy(req, res)) return;
    const fy = financialYear(await today()), row = await rowForYear(fy, me(req));
    await pool.query("UPDATE tax_regime_policies SET doc_name=NULL, doc_mime=NULL, doc_size=NULL, doc_stored=NULL, updated_by=$2, updated_at=now() WHERE financial_year=$1", [fy, me(req)]);
    if (row.doc_stored && !(await stillUsed(row.doc_stored, fy))) await fs.rm(path.join(UPLOAD_DIR, path.basename(row.doc_stored)), { force: true }).catch(() => {});
    await noteAudit(req, `Tax regime policy document removed for ${fy}-${String(fy + 1).slice(2)}`);
    res.json({ ...(await policyOf(fy)), canManage: true });
  }));
  r.get("/api/tax-declaration/policy/document", wrap(async (_req, res) => {
    const { rows: [p] } = await pool.query("SELECT doc_name, doc_mime, doc_stored FROM tax_regime_policies WHERE financial_year <= $1 AND doc_stored IS NOT NULL ORDER BY financial_year DESC LIMIT 1", [financialYear(await today())]);
    if (!p) return res.status(404).json({ error: "No policy document has been uploaded yet." });
    const file = path.join(UPLOAD_DIR, path.basename(p.doc_stored));
    try { await fs.access(file); } catch { return res.status(410).json({ error: "The policy document is missing from storage. Please ask the payroll team to upload it again." }); }
    res.set({ "Content-Type": p.doc_mime, "Content-Disposition": `inline; filename="${p.doc_name.replace(/"/g, "")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" });
    res.sendFile(file);
  }));

  /* Due dates for the year's declarations and proofs (payroll.prepare, company-wide). Empty clears a date. */
  r.put("/api/tax-declaration/policy/dates", wrap(async (req, res) => {
    if (!mayManagePolicy(req, res)) return;
    const fy = financialYear(await today());
    const { declarationDue, proofDue, joinerDays, errors } = readTaxDates(req.body, fy);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    await rowForYear(fy, me(req));
    await pool.query("UPDATE tax_regime_policies SET declaration_due=$2, proof_due=$3, joiner_days=$5, updated_by=$4, updated_at=now() WHERE financial_year=$1", [fy, declarationDue, proofDue, me(req), joinerDays]);
    await noteAudit(req, `Tax declaration due dates for ${fy}-${String(fy + 1).slice(2)}: declarations ${declarationDue || "no date"}, proofs ${proofDue || "no date"}`);
    res.json({ ...(await policyOf(fy)), canManage: true });
  }));
  /* Reopening the declaration or the proofs for one person after the due date (payroll.prepare, company-wide). */
  r.get("/api/tax-declaration/unlocks", wrap(async (req, res) => {
    if (!mayManagePolicy(req, res)) return;
    const fy = financialYear(await today());
    const { rows } = await pool.query("SELECT email, kind, to_char(until,'YYYY-MM-DD') AS until FROM tax_declaration_unlocks WHERE financial_year=$1 AND until >= (now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY until, email LIMIT 200", [fy]);
    const person = await namesFor(rows.map((x) => x.email));
    res.json({ unlocks: rows.map((x) => ({ person: person(x.email), kind: x.kind, until: x.until })) });
  }));
  r.post("/api/tax-declaration/unlocks", wrap(async (req, res) => {
    if (!mayManagePolicy(req, res)) return;
    const day = await today(), fy = financialYear(day);
    const { email, kind, until, errors } = readUnlock(req.body, day);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    await pool.query(`INSERT INTO tax_declaration_unlocks (email, financial_year, kind, until, granted_by) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (lower(email), financial_year, kind) DO UPDATE SET until=EXCLUDED.until, granted_by=EXCLUDED.granted_by, granted_at=now()`, [email, fy, kind, until, me(req)]);
    await noteAudit(req, `Tax ${kind === "proof" ? "proofs" : "declaration"} reopened for ${email} until ${until}`);
    notify(email, { title: kind === "proof" ? "You can add your tax proofs again" : "You can change your tax declaration again", body: `The payroll team reopened it until ${until}.`, link: "/app/tax" }).catch(() => {});
    res.status(201).json({ ok: true });
  }));
  r.delete("/api/tax-declaration/unlocks/:email/:kind", wrap(async (req, res) => {
    if (!mayManagePolicy(req, res)) return;
    const fy = financialYear(await today()), email = String(req.params.email || "").toLowerCase();
    const { rowCount } = await pool.query("DELETE FROM tax_declaration_unlocks WHERE lower(email)=$1 AND financial_year=$2 AND kind=$3", [email, fy, req.params.kind]);
    if (!rowCount) return res.status(404).json({ error: "This reopening was not found." });
    await noteAudit(req, `Tax ${req.params.kind === "proof" ? "proofs" : "declaration"} closed again for ${email}`);
    res.json({ ok: true });
  }));

  /* Late changes, as Keka takes a late declaration for approval: after the declaration or proof date, the person asks with a reason;
     payroll (payroll.prepare, company-wide) approves it until a date, which reopens it for them, or declines it with a note. Never
     your own request. */
  const lateOut = (x, person = null) => ({ id: x.id, kind: x.kind, reason: x.reason, status: x.status, until: x.until, note: x.note || "", createdAt: x.created_at, decidedAt: x.decided_at, ...(person ? { person } : {}) });
  const LATE_COLS = "id, email, kind, reason, status, to_char(until,'YYYY-MM-DD') AS until, note, created_at, decided_at";
  r.post("/api/tax-declaration/late-requests", wrap(async (req, res) => {
    const { kind, reason, errors } = readLateRequest(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const day = await today(), fy = financialYear(day), win = await windowFor(me(req), fy, await policyOf(fy), day);
    if (win[kind].open) return res.status(409).json({ error: kind === "proof" ? "Your proofs are still open, so you can add them now." : "Your declaration is still open, so you can change it now." });
    const { rows: [x] } = await pool.query(`INSERT INTO tax_late_requests (email, financial_year, kind, reason) VALUES ($1,$2,$3,$4)
      ON CONFLICT (lower(email), financial_year, kind) WHERE status = 'pending' DO NOTHING RETURNING ${LATE_COLS}`, [me(req), fy, kind, reason]);
    if (!x) return res.status(409).json({ error: "You have already asked. The payroll team will reply soon." });
    const name = (await namesFor([me(req)]))(me(req)).name;
    notify("perm:payroll.prepare", { title: `${name} asked to change their tax ${kind === "proof" ? "proofs" : "declaration"} after the due date`, body: reason.slice(0, 160), link: "/app/tax" }).catch(() => {});
    res.status(201).json(lateOut(x));
  }));
  r.get("/api/tax-declaration/late-requests", wrap(async (req, res) => {
    if (!mayManagePolicy(req, res)) return;
    const fy = financialYear(await today());
    const { rows } = await pool.query(`SELECT ${LATE_COLS} FROM tax_late_requests WHERE financial_year=$1 AND (status='pending' OR decided_at > now() - interval '30 days')
      ORDER BY status='pending' DESC, created_at DESC LIMIT 100`, [fy]);
    const who = await namesFor(rows.map((x) => x.email));
    res.json({ requests: rows.map((x) => lateOut(x, who(x.email))) });
  }));
  r.put("/api/tax-declaration/late-requests/:id", wrap(async (req, res) => {
    const id = Number(req.params.id);
    const { rows: [x] } = Number.isInteger(id) ? await pool.query("SELECT id, email, financial_year, kind, status FROM tax_late_requests WHERE id=$1", [id]) : { rows: [] };
    if (!x) return res.status(404).json({ error: "This request was not found." });
    if (!canAll(req, "payroll.prepare") || !(await mayDecide(req, "payroll.prepare", x.email.toLowerCase()))) return res.status(403).json(NO_ACCESS);
    if (x.status !== "pending") return res.status(409).json({ error: "This request has already been answered." });
    const day = await today();
    const { decision, until, note, errors } = readLateDecision(req.body, day);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const what = x.kind === "proof" ? "proofs" : "declaration";
    if (decision === "approved") await pool.query(`INSERT INTO tax_declaration_unlocks (email, financial_year, kind, until, granted_by) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (lower(email), financial_year, kind) DO UPDATE SET until=EXCLUDED.until, granted_by=EXCLUDED.granted_by, granted_at=now()`, [x.email.toLowerCase(), x.financial_year, x.kind, until, me(req)]);
    const { rows: [row] } = await pool.query(`UPDATE tax_late_requests SET status=$2, until=$3, note=$4, decided_by=$5, decided_at=now() WHERE id=$1 AND status='pending' RETURNING ${LATE_COLS}`,
      [id, decision, until, note || null, me(req)]);
    if (!row) return res.status(409).json({ error: "This request has already been answered." });
    await noteAudit(req, `Late tax ${what} request from ${x.email} ${decision}${until ? ` until ${until}` : ""}`);
    notify(x.email, decision === "approved"
      ? { title: `You can change your tax ${what} again`, body: `The payroll team approved your request until ${until}.${note ? ` ${note}` : ""}`.slice(0, 180), link: "/app/tax" }
      : { title: `Your request to change your tax ${what} was declined`, body: note.slice(0, 180), link: "/app/tax" }).catch(() => {});
    res.json(lateOut(row, (await namesFor([x.email]))(x.email)));
  }));

  /* The year's figures for filing the income tax return, from the person's approved payslips. Their own only. */
  r.get("/api/tax-declaration/year-summary", wrap(async (req, res) => {
    const day = await today(), current = financialYear(day);
    const fy = req.query.fy ? Number(req.query.fy) : current;
    if (!Number.isInteger(fy) || fy < current - 3 || fy > current) return res.status(400).json({ error: "Please choose one of the last four financial years." });
    const [{ rows: [own] }, pol] = await Promise.all([
      pool.query("SELECT regime, items, proofs FROM tax_declaration_requests WHERE lower(email)=$1 AND financial_year=$2 AND status='submitted'", [me(req), fy]),
      policyOf(fy),
    ]);
    res.json({ ...(await yearForReturn({ email: me(req), fy, own, proofsFinal: fy < current || (!!pol.proofDue && day > pol.proofDue) })), current });
  }));

  /* Form 124 (earlier Form 12BB): the person's statement of claims for the year, as a PDF to sign. The person, or payroll.view
     for the people in scope. */
  r.get("/api/tax-declaration/form-124", wrap(async (req, res) => {
    const asked = req.query.email ? String(req.query.email).toLowerCase() : me(req);
    if (asked !== me(req) && !(await can(req, "payroll.view", asked))) return res.status(404).json({ error: "This declaration was not found." });
    const fy = financialYear(await today());
    const [{ rows: [x] }, { rows: [e] }] = await Promise.all([
      pool.query("SELECT regime, items, status, submitted_at, proofs FROM tax_declaration_requests WHERE lower(email)=$1 AND financial_year=$2", [asked, fy]),
      pool.query("SELECT name, address, phone, pan_masked FROM employees WHERE lower(work_email)=$1", [asked]),
    ]);
    if (!x) return res.status(404).json({ error: "Please save your declaration first, then download the form." });
    const pdf = await form124Pdf({ fy, email: asked, person: e || { name: asked.split("@")[0] }, declaration: x });
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Form-${fy >= 2026 ? "124" : "12BB"}-${fy}-${String(fy + 1).slice(2)}.pdf"`,
      "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" });
    res.send(pdf);
  }));

  /* The person's own tax for the year under both regimes, from their salary in payroll and the lines on the page (not yet saved). */
  r.post("/api/tax-declaration/estimate", wrap(async (req, res) => {
    const { items } = readTaxDeclaration({ regime: "old", items: req.body && req.body.items });   // every line, checked the same way
    res.json(await estimateTax({ email: me(req), items }));
  }));

  r.get("/api/tax-declaration", wrap(async (req, res) => {
    const asked = req.query.email ? String(req.query.email).toLowerCase() : me(req);
    const target = asked === me(req) || (await can(req, "payroll.view", asked)) ? asked : me(req);
    const fy = financialYear(await today());
    const { rows: [x] } = await pool.query("SELECT id, regime, items, status, submitted_at, proofs FROM tax_declaration_requests WHERE lower(email)=$1 AND financial_year=$2", [target, fy]);
    const [pol, { rows: late }] = await Promise.all([policyOf(fy),
      pool.query(`SELECT DISTINCT ON (kind) ${LATE_COLS} FROM tax_late_requests WHERE lower(email)=$1 AND financial_year=$2 ORDER BY kind, created_at DESC`, [target, fy])]);
    res.json({ ...taxOut(x, fy, await filesOf(x && x.id), pol.defaultRegime), policy: pol, window: await windowFor(target, fy, pol, await today()), lateRequests: late.map((y) => lateOut(y)) });   // someone who has not saved a declaration starts on the company's default regime
  }));
  r.put("/api/tax-declaration", wrap(async (req, res) => {
    const day = await today(), fy = financialYear(day);
    // Leave travel journeys claimed in the four years before (two per block of four calendar years), unless HR rejected the proof.
    const { rows: earlier } = await pool.query("SELECT items, proofs FROM tax_declaration_requests WHERE lower(email)=$1 AND financial_year BETWEEN $2 AND $3 AND status='submitted'", [me(req), fy - 4, fy - 1]);
    const earlierJourneys = earlier.flatMap((y) => y.items.map((i, n) => (i.section === "Leave travel" && i.party && !((y.proofs || {})[n] && y.proofs[n].status === "rejected") ? i.party : null)).filter(Boolean));
    const { regime, items, submit, errors } = readTaxDeclaration(req.body, { fy, earlierJourneys });
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const win = await windowFor(me(req), fy, await policyOf(fy), day);
    if (!win.declaration.open) return res.status(409).json({ error: `Declarations for this year closed on ${win.declaration.due}. Please ask the payroll team to reopen yours if something needs to change.` });
    // Changed lines: the proof notes and the uploaded documents no longer belong to them, so both are cleared.
    const { rows: [old] } = await pool.query("SELECT id, items FROM tax_declaration_requests WHERE lower(email)=$1 AND financial_year=$2", [me(req), fy]);
    const same = (list) => JSON.stringify(list.map((i) => [i.section, i.description, Number(i.amountMinor)]));   // key order differs once stored
    if (old && same(old.items) !== same(items)) await dropFiles(old.id);
    const { rows: [x] } = await pool.query(
      `INSERT INTO tax_declaration_requests (email, financial_year, regime, items, status, submitted_at) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (lower(email), financial_year) DO UPDATE SET regime=EXCLUDED.regime, status=EXCLUDED.status, submitted_at=EXCLUDED.submitted_at, updated_at=now(),
         proofs = CASE WHEN tax_declaration_requests.items = EXCLUDED.items THEN tax_declaration_requests.proofs ELSE '{}'::jsonb END, items=EXCLUDED.items
       RETURNING id, regime, items, status, submitted_at, proofs`, [me(req), fy, regime, JSON.stringify(items), submit ? "submitted" : "draft", submit ? new Date() : null]);
    res.json({ ...taxOut(x, fy, await filesOf(x.id)), window: win });
  }));
  r.get("/api/tax-declarations", requireAuth, need("payroll.view"), wrap(async (req, res) => {
    const fy = financialYear(await today()), scope = await scopeOf(req, "payroll.view");
    const { rows } = await pool.query(`SELECT id, email, regime, items, status, submitted_at, proofs FROM tax_declaration_requests WHERE financial_year=$1 AND status='submitted'
      ${scope ? "AND lower(email) = ANY($2)" : ""} ORDER BY submitted_at DESC LIMIT 200`, scope ? [fy, [...scope]] : [fy]);
    const { rows: allFiles } = rows.length ? await pool.query("SELECT request_id, line_index, name, size FROM tax_proof_files WHERE request_id = ANY($1)", [rows.map((x) => x.id)]) : { rows: [] };
    const person = await namesFor(rows.map((x) => x.email));
    res.json({ financialYear: fy, declarations: rows.map((x) => ({ person: person(x.email), ...taxOut(x, fy, allFiles.filter((f) => f.request_id === x.id)), total: x.items.filter((i) => !BOTH_REGIMES.includes(i.section)).reduce((n, i) => n + Number(i.amountMinor), 0) / 100 })) });
  }));

  /* Payroll (payroll.prepare) notes what happened with the proof for one line: waiting (clears the note), received, verified or rejected.
     Never on your own declaration. */
  r.put("/api/tax-declarations/:email/proofs", requireAuth, wrap(async (req, res) => {
    const target = String(req.params.email || "").toLowerCase(), fy = financialYear(await today());
    if (!(await mayDecide(req, "payroll.prepare", target))) return res.status(403).json(NO_ACCESS);
    const { rows: [x] } = await pool.query("SELECT id, items, proofs FROM tax_declaration_requests WHERE lower(email)=$1 AND financial_year=$2 AND status='submitted'", [target, fy]);
    if (!x) return res.status(404).json({ error: "This declaration was not found. It may have been changed back to a draft." });
    const { index, status, note, approvedMinor, errors } = readProof(req.body, x.items.length, x.items.map((i) => Number(i.amountMinor)));
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const proofs = { ...(x.proofs || {}) };
    if (status === "waiting") delete proofs[index]; else proofs[index] = { status, note, by: me(req), at: new Date().toISOString(), ...(approvedMinor != null ? { approvedMinor } : {}) };
    const { rows: [row] } = await pool.query("UPDATE tax_declaration_requests SET proofs=$2, updated_at=now() WHERE id=$1 RETURNING id, regime, items, status, submitted_at, proofs", [x.id, JSON.stringify(proofs)]);
    const line = `${x.items[index].section}${x.items[index].description ? `, ${x.items[index].description}` : ""}`;
    if (status === "rejected") notify(target, { title: "A tax proof needs another look", body: `${line}: ${note}`.slice(0, 180), link: "/app/tax" }).catch(() => {});
    if (status === "verified") notify(target, approvedMinor != null
      ? { title: "A tax claim was approved for a lower amount", body: `${line}: ₹${(approvedMinor / 100).toLocaleString("en-IN")} approved. ${note}`.slice(0, 180), link: "/app/tax" }
      : { title: "A tax proof was verified", body: line.slice(0, 180), link: "/app/tax" }).catch(() => {});
    res.json(taxOut(row, fy, await filesOf(row.id)));
  }));

  /* The proof document for one line: the person uploads it (PDF, JPG or PNG, one per line), and they and HR can open it. */
  const ownRequest = async (req) => { const fy = financialYear(await today()); return { fy, x: (await pool.query("SELECT id, items FROM tax_declaration_requests WHERE lower(email)=$1 AND financial_year=$2", [me(req), fy])).rows[0] }; };
  /** Proofs can be added or removed until the proof due date, or until the date payroll reopened them for this person. */
  const proofClosed = async (req, res) => {
    const day = await today(), fy = financialYear(day), win = await windowFor(me(req), fy, await policyOf(fy), day);
    if (win.proof.open) return false;
    res.status(409).json({ error: `Proofs for this year closed on ${win.proof.due}. Please ask the payroll team to reopen them for you.` });
    return true;
  };
  const lineOf = (x, v) => { const n = Number(v); return x && Number.isInteger(n) && n >= 0 && n < x.items.length ? n : -1; };
  r.put("/api/tax-declaration/proofs/:index/file", express.raw({ type: () => true, limit: MAX_BYTES }), wrap(async (req, res) => {
    if (await proofClosed(req, res)) return;
    const { x } = await ownRequest(req), index = lineOf(x, req.params.index);
    if (index < 0) return res.status(404).json({ error: "Please save your declaration first, then add the proof to its line." });
    const file = await checkFile(req.body);
    if (!file.ok) return res.status(400).json({ error: file.checks.find((c) => !c.ok).label });
    const stored = crypto.randomUUID() + "." + file.type.ext;
    const name = String(req.query.name || "proof").replace(/[^\w.\- ()]/g, "_").slice(0, 120);
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(path.join(UPLOAD_DIR, stored), req.body);
    await dropFiles(x.id, index);
    await pool.query("INSERT INTO tax_proof_files (request_id, line_index, name, mime, size, stored) VALUES ($1,$2,$3,$4,$5,$6)", [x.id, index, name, file.type.mime, req.body.length, stored]);
    res.json({ file: { name, size: req.body.length } });
  }));
  r.delete("/api/tax-declaration/proofs/:index/file", wrap(async (req, res) => {
    if (await proofClosed(req, res)) return;
    const { x } = await ownRequest(req), index = lineOf(x, req.params.index);
    if (index < 0 || !(await dropFiles(x.id, index))) return res.status(404).json({ error: "This document was not found." });
    res.json({ ok: true });
  }));
  r.get("/api/tax-declarations/:email/proofs/:index/file", requireAuth, wrap(async (req, res) => {
    const target = String(req.params.email || "").toLowerCase();
    // The person, payroll.view for the people in scope, or payroll.prepare (who verifies the proofs).
    if (target !== me(req) && !canAll(req, "payroll.prepare") && !(await can(req, "payroll.view", target))) return res.status(404).json({ error: "This document was not found." });
    const { rows: [f] } = await pool.query(
      `SELECT f.name, f.mime, f.stored FROM tax_proof_files f JOIN tax_declaration_requests d ON d.id = f.request_id
       WHERE lower(d.email)=$1 AND d.financial_year=$2 AND f.line_index=$3`, [target, financialYear(await today()), Number(req.params.index) || 0]);
    if (!f) return res.status(404).json({ error: "This document was not found." });
    const file = path.join(UPLOAD_DIR, path.basename(f.stored));
    try { await fs.access(file); } catch { return res.status(410).json({ error: "The document is missing from storage. Please ask the person to upload it again." }); }
    res.set({ "Content-Type": f.mime, "Content-Disposition": `inline; filename="${f.name.replace(/"/g, "")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" });
    res.sendFile(file);
  }));

  /* ---------- Goals: the person's own. goals.view reads those of the people in scope with ?email=. ---------- */
  r.get("/api/goals", wrap(async (req, res) => {
    // goals.view for the people in scope, and a reporting manager their own team's.
    const asked = req.query.email ? String(req.query.email).toLowerCase() : me(req);
    const target = asked === me(req) || (await can(req, "goals.view", asked)) || (await reportsOf(pool, me(req))).includes(asked) ? asked : me(req);
    const { rows } = await pool.query("SELECT id, title, detail, to_char(due_on,'YYYY-MM-DD') AS due_on, progress, updated_at FROM goals WHERE lower(email)=$1 AND deleted_at IS NULL ORDER BY (progress >= 100), due_on NULLS LAST, id DESC LIMIT 100", [target]);
    res.json({ goals: rows.map((g) => ({ id: g.id, title: g.title, detail: g.detail, dueOn: g.due_on, progress: g.progress, updatedAt: g.updated_at })) });
  }));
  r.post("/api/goals", wrap(async (req, res) => {
    const { title, detail, dueOn, progress, errors } = readGoal(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const { rows: [row] } = await pool.query("INSERT INTO goals (email, title, detail, due_on, progress) VALUES ($1,$2,$3,$4,$5) RETURNING id", [me(req), title, detail, dueOn, progress]);
    res.status(201).json({ id: row.id });
  }));
  r.put("/api/goals/:id", wrap(async (req, res) => {
    const { title, detail, dueOn, progress, errors } = readGoal(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const { rowCount } = await pool.query("UPDATE goals SET title=$3, detail=$4, due_on=$5, progress=$6, updated_at=now() WHERE id=$1 AND lower(email)=$2 AND deleted_at IS NULL", [idOf(req.params.id), me(req), title, detail, dueOn, progress]);
    if (!rowCount) return res.status(404).json({ error: "This goal is no longer available." });
    res.json({ ok: true });
  }));
  r.delete("/api/goals/:id", wrap(async (req, res) => {
    const { rowCount } = await pool.query("UPDATE goals SET deleted_at=now() WHERE id=$1 AND lower(email)=$2 AND deleted_at IS NULL", [idOf(req.params.id), me(req)]);
    if (!rowCount) return res.status(404).json({ error: "This goal is no longer available." });
    res.json({ ok: true });
  }));
  return r;
}
