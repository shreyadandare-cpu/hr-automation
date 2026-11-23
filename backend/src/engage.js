import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { UPLOAD_DIR } from "./documents.js";
import { MAX_BYTES, checkFile } from "./extract.js";
import { pool } from "./db.js";
import { requireAuth, unlessHidden } from "./auth.js";
import { requirePayUnlock } from "./pay-security.js";
import { can, canAll, mayDecide, need, scopeOf } from "./access.js";
import { notify } from "./notify.js";
import { readProof } from "./finance-rules.js";
import { reportsOf } from "./teams.js";
import { financialYear, readAdvance, readAppLink, readArticle, readAttendanceRequest, readDecision, readGoal, readPoll, readPraise, readTaxDeclaration, tally } from "./engage-rules.js";

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
  r.use("/api/tax-declaration", requireAuth, requirePayUnlock);   // a person's own tax declaration is personal pay: behind Pay security (pay-security.js). The HR list of everyone's (/api/tax-declarations) is not: it is guarded by its permission.
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
    await pool.query("UPDATE polls SET deleted_at = now() WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id)]);
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
    await pool.query("UPDATE articles SET deleted_at = now() WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id)]);
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
    await pool.query("UPDATE app_links SET deleted_at = now() WHERE id=$1 AND deleted_at IS NULL", [idOf(req.params.id)]);
    res.json({ ok: true });
  }));

  /* ---------- Requests: advance and attendance ---------- */
  const REQ = {
    advance: { perm: "advances.approve", table: "advance_requests", cols: "id, email, amount_minor, currency, reason, status, decided_by, decided_at, decision_note, created_at", order: "created_at DESC",
      out: (x) => ({ amount: Number(x.amount_minor) / 100, currency: x.currency, reason: x.reason }), label: "advance request" },
    attendance: { perm: "attendance.edit", table: "attendance_requests", cols: "id, email, to_char(on_date, 'YYYY-MM-DD') AS on_date, kind, note, status, decided_by, decided_at, decision_note, created_at", order: "created_at DESC",
      out: (x) => ({ date: x.on_date, kind: x.kind, note: x.note }), label: "attendance request" },
  };
  r.get("/api/requests/:type", wrap(async (req, res) => {
    const t = REQ[req.params.type];
    if (!t) return res.status(404).json({ error: "Not found." });
    // scope=all: everyone the caller may decide for (null = the whole company), otherwise the caller's own.
    const holds = await can(req, t.perm), scope = holds ? await scopeOf(req, t.perm) : new Set();
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
    const { date, kind, note, errors } = readAttendanceRequest(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const { rows: [row] } = await pool.query("INSERT INTO attendance_requests (email, on_date, kind, note) VALUES ($1,$2,$3,$4) RETURNING id", [me(req), date, kind, note]);
    res.status(201).json({ id: row.id });
  }));
  r.post("/api/requests/:type/:id/decide", wrap(async (req, res) => {
    const t = REQ[req.params.type];
    if (!t) return res.status(404).json({ error: "Not found." });
    const { decision, note, errors } = readDecision(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    // Whoever holds the permission for this person decides, but never on their own request.
    const { rows: [owner] } = await pool.query(`SELECT email FROM ${t.table} WHERE id=$1 AND deleted_at IS NULL`, [idOf(req.params.id)]);
    if (!owner) return res.status(404).json({ error: "This request is no longer available." });
    if (!(await mayDecide(req, t.perm, owner.email))) return res.status(403).json(NO_ACCESS);
    const { rows: [x] } = await pool.query(`UPDATE ${t.table} SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1 AND status='pending' AND deleted_at IS NULL RETURNING email`, [idOf(req.params.id), decision, me(req), note || null]);
    if (!x) return res.status(409).json({ error: "This request has already been decided." });
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
    items: x ? x.items.map((i, n) => { const pr = (x.proofs || {})[n]; return { section: i.section, description: i.description, amount: Number(i.amountMinor) / 100, proof: pr ? { status: pr.status, note: pr.note || "", at: pr.at } : null, file: (() => { const f = files.find((y) => y.line_index === n); return f ? { name: f.name, size: f.size } : null; })() }; }) : [] });
  /* ---------- Regime policy: which regime a declaration starts on, and the policy document behind it. ----------
     payroll.prepare (company-wide) sets the default (New or Old) for a financial year and uploads the policy document. It carries over
     to the next year until it is changed. Everyone sees it on their declaration, which starts on that regime; they can still change it.
     It never changes a declaration someone has saved, and it does not touch payroll's own tax_declarations (which the calculation uses). */
  const policyOf = async (fy) => {
    const { rows: [p] } = await pool.query("SELECT financial_year, default_regime, doc_name, doc_size, updated_by, updated_at FROM tax_regime_policies WHERE financial_year <= $1 ORDER BY financial_year DESC LIMIT 1", [fy]);
    if (!p) return { financialYear: fy, defaultRegime: "new", set: false, document: null, updatedBy: null, updatedAt: null };
    const who = await namesFor([p.updated_by]);
    return { financialYear: fy, setForYear: p.financial_year, defaultRegime: p.default_regime, set: true, document: p.doc_name ? { name: p.doc_name, size: p.doc_size } : null, updatedBy: who(p.updated_by).name, updatedAt: p.updated_at };
  };
  const mayManagePolicy = (req, res) => (canAll(req, "payroll.prepare") ? true : (res.status(403).json(NO_ACCESS), false));
  const noteAudit = (req, text) => pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [text, me(req)]).catch(() => {});
  /** The row for this year (made from last year's policy if this year has none yet), so the default and the document are kept together. */
  const rowForYear = async (fy, email) => {
    const { rows: [mine] } = await pool.query("SELECT * FROM tax_regime_policies WHERE financial_year=$1", [fy]);
    if (mine) return mine;
    const { rows: [prev] } = await pool.query("SELECT * FROM tax_regime_policies WHERE financial_year < $1 ORDER BY financial_year DESC LIMIT 1", [fy]);
    const { rows: [made] } = await pool.query(
      "INSERT INTO tax_regime_policies (financial_year, default_regime, doc_name, doc_mime, doc_size, doc_stored, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [fy, prev ? prev.default_regime : "new", prev ? prev.doc_name : null, prev ? prev.doc_mime : null, prev ? prev.doc_size : null, prev ? prev.doc_stored : null, email]);
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

  r.get("/api/tax-declaration", wrap(async (req, res) => {
    const asked = req.query.email ? String(req.query.email).toLowerCase() : me(req);
    const target = asked === me(req) || (await can(req, "payroll.view", asked)) ? asked : me(req);
    const fy = financialYear(await today());
    const { rows: [x] } = await pool.query("SELECT id, regime, items, status, submitted_at, proofs FROM tax_declaration_requests WHERE lower(email)=$1 AND financial_year=$2", [target, fy]);
    const pol = await policyOf(fy);
    res.json({ ...taxOut(x, fy, await filesOf(x && x.id), pol.defaultRegime), policy: pol });   // someone who has not saved a declaration starts on the company's default regime
  }));
  r.put("/api/tax-declaration", wrap(async (req, res) => {
    const { regime, items, submit, errors } = readTaxDeclaration(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const fy = financialYear(await today());
    // Changed lines: the proof notes and the uploaded documents no longer belong to them, so both are cleared.
    const { rows: [old] } = await pool.query("SELECT id, items FROM tax_declaration_requests WHERE lower(email)=$1 AND financial_year=$2", [me(req), fy]);
    const same = (list) => JSON.stringify(list.map((i) => [i.section, i.description, Number(i.amountMinor)]));   // key order differs once stored
    if (old && same(old.items) !== same(items)) await dropFiles(old.id);
    const { rows: [x] } = await pool.query(
      `INSERT INTO tax_declaration_requests (email, financial_year, regime, items, status, submitted_at) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (lower(email), financial_year) DO UPDATE SET regime=EXCLUDED.regime, status=EXCLUDED.status, submitted_at=EXCLUDED.submitted_at, updated_at=now(),
         proofs = CASE WHEN tax_declaration_requests.items = EXCLUDED.items THEN tax_declaration_requests.proofs ELSE '{}'::jsonb END, items=EXCLUDED.items
       RETURNING id, regime, items, status, submitted_at, proofs`, [me(req), fy, regime, JSON.stringify(items), submit ? "submitted" : "draft", submit ? new Date() : null]);
    res.json(taxOut(x, fy, await filesOf(x.id)));
  }));
  r.get("/api/tax-declarations", requireAuth, need("payroll.view"), wrap(async (req, res) => {
    const fy = financialYear(await today()), scope = await scopeOf(req, "payroll.view");
    const { rows } = await pool.query(`SELECT id, email, regime, items, status, submitted_at, proofs FROM tax_declaration_requests WHERE financial_year=$1 AND status='submitted'
      ${scope ? "AND lower(email) = ANY($2)" : ""} ORDER BY submitted_at DESC LIMIT 200`, scope ? [fy, [...scope]] : [fy]);
    const { rows: allFiles } = rows.length ? await pool.query("SELECT request_id, line_index, name, size FROM tax_proof_files WHERE request_id = ANY($1)", [rows.map((x) => x.id)]) : { rows: [] };
    const person = await namesFor(rows.map((x) => x.email));
    res.json({ financialYear: fy, declarations: rows.map((x) => ({ person: person(x.email), ...taxOut(x, fy, allFiles.filter((f) => f.request_id === x.id)), total: x.items.reduce((n, i) => n + Number(i.amountMinor), 0) / 100 })) });
  }));

  /* Payroll (payroll.prepare) notes what happened with the proof for one line: waiting (clears the note), received, verified or rejected.
     Never on your own declaration. */
  r.put("/api/tax-declarations/:email/proofs", requireAuth, wrap(async (req, res) => {
    const target = String(req.params.email || "").toLowerCase(), fy = financialYear(await today());
    if (!(await mayDecide(req, "payroll.prepare", target))) return res.status(403).json(NO_ACCESS);
    const { rows: [x] } = await pool.query("SELECT id, items, proofs FROM tax_declaration_requests WHERE lower(email)=$1 AND financial_year=$2 AND status='submitted'", [target, fy]);
    if (!x) return res.status(404).json({ error: "This declaration was not found. It may have been changed back to a draft." });
    const { index, status, note, errors } = readProof(req.body, x.items.length);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const proofs = { ...(x.proofs || {}) };
    if (status === "waiting") delete proofs[index]; else proofs[index] = { status, note, by: me(req), at: new Date().toISOString() };
    const { rows: [row] } = await pool.query("UPDATE tax_declaration_requests SET proofs=$2, updated_at=now() WHERE id=$1 RETURNING id, regime, items, status, submitted_at, proofs", [x.id, JSON.stringify(proofs)]);
    const line = `${x.items[index].section}${x.items[index].description ? `, ${x.items[index].description}` : ""}`;
    if (status === "rejected") notify(target, { title: "A tax proof needs another look", body: `${line}: ${note}`.slice(0, 180), link: "/app/tax" }).catch(() => {});
    if (status === "verified") notify(target, { title: "A tax proof was verified", body: line.slice(0, 180), link: "/app/tax" }).catch(() => {});
    res.json(taxOut(row, fy, await filesOf(row.id)));
  }));

  /* The proof document for one line: the person uploads it (PDF, JPG or PNG, one per line), and they and HR can open it. */
  const ownRequest = async (req) => { const fy = financialYear(await today()); return { fy, x: (await pool.query("SELECT id, items FROM tax_declaration_requests WHERE lower(email)=$1 AND financial_year=$2", [me(req), fy])).rows[0] }; };
  const lineOf = (x, v) => { const n = Number(v); return x && Number.isInteger(n) && n >= 0 && n < x.items.length ? n : -1; };
  r.put("/api/tax-declaration/proofs/:index/file", express.raw({ type: () => true, limit: MAX_BYTES }), wrap(async (req, res) => {
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
