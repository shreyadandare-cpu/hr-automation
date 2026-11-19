import express from "express";
import crypto from "node:crypto";
import { pool } from "./db.js";
import { requireAuth, requireHr } from "./auth.js";
import * as gmail from "./gmail-api.js";
import { sendEmail } from "./notify.js";
import { publicUrl } from "./mail.js";
import { parseMessage, processMessage, claudeConfigured } from "./gmail-intel.js";

/* Gmail Intelligence Engine: database side, sync and the HR screens' API. Everything is HR-only except the Pub/Sub push,
   which proves itself with GMAIL_PUSH_TOKEN. Off unless GMAIL_INTEL_ENABLED=true and the service account is set (gmail-api.js). */
const DOMAIN = () => (process.env.GMAIL_COMPANY_DOMAIN || "wohlig.com").toLowerCase();
const EMAIL = /^[\w.+'-]+@[\w-]+(?:\.[\w-]+)+$/;

/** Active projects with the work emails of the people allocated to them. */
export async function projectContext(db = pool) {
  const { rows } = await db.query(
    `SELECT p.id, p.name, lower(e.work_email) AS email
       FROM projects p
       LEFT JOIN employee_project_allocations a ON a.project_id = p.id AND a.status = 'Active'
       LEFT JOIN employees e ON e.id = a.employee_id
      WHERE p.status = 'Active'`);
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.id)) byId.set(r.id, { id: r.id, name: r.name, members: new Set() });
    if (r.email) byId.get(r.id).members.add(r.email);
  }
  const projects = [...byId.values()];
  return { projects, ctx: { domain: DOMAIN(), memberEmails: new Set(projects.flatMap((p) => [...p.members])) } };
}

export const pgStore = (db, mailbox) => ({
  async saveMessage(m) {
    await db.query(
      `INSERT INTO gmail_messages (gmail_message_id, thread_id, mailbox, sent_at, stage, relevance, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (gmail_message_id) DO UPDATE SET stage = EXCLUDED.stage, relevance = EXCLUDED.relevance, reason = EXCLUDED.reason, processed_at = now()`,
      [m.id, m.threadId, mailbox, m.sentAt, m.stage, m.relevance || null, m.reason || null]);
  },
  async saveExtraction(x) {
    await db.query(
      `INSERT INTO gmail_extractions (gmail_message_id, thread_id, project_id, project_name, employee_name, subject, email_date, summary,
         completed, pending, blockers, decisions, deadlines, next_steps, relevance, confidence, needs_review)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [x.messageId, x.threadId, x.projectId, x.projectName, x.employeeName, x.subject, x.emailDate, x.summary,
        JSON.stringify(x.completed), JSON.stringify(x.pending), JSON.stringify(x.blockers), JSON.stringify(x.decisions),
        JSON.stringify(x.deadlines), JSON.stringify(x.next_steps), x.relevance, x.confidence, x.needsReview]);
  },
  async logUsage(u) {
    await db.query("INSERT INTO gmail_ai_usage (model, purpose, input_tokens, output_tokens, cost_usd) VALUES ($1,$2,$3,$4,$5)",
      [u.model, u.purpose, u.inputTokens, u.outputTokens, u.costUsd]);
  },
});

const sortByDate = (a, b) => String(a.date).localeCompare(String(b.date));
let running = false;   // one sync at a time, so the same message is never processed twice

/** Collects and processes new mail for one mailbox row. `api` is injectable for tests. Returns counts. */
export async function syncMailbox(box, { db = pool, api = gmail, ask } = {}) {
  const out = { fetched: 0, skipped: 0, stages: {} };
  try {
    if (!box.history_id) {   // first time: start from now, history before that is not collected
      const p = await api.profile(box.work_email);
      await db.query("UPDATE gmail_mailboxes SET history_id=$2, last_synced_at=now(), last_error=NULL WHERE id=$1", [box.id, String(p.historyId)]);
      return out;
    }
    let found;
    try { found = await api.newMessageIds(box.work_email, box.history_id); }
    catch (err) {
      if (err.status !== 404) throw err;   // the saved point is too old: restart from now and say so
      const p = await api.profile(box.work_email);
      await db.query("UPDATE gmail_mailboxes SET history_id=$2, last_synced_at=now(), last_error='Gmail history was too old, restarted from now' WHERE id=$1", [box.id, String(p.historyId)]);
      return out;
    }
    const { projects, ctx } = await projectContext(db);
    const store = pgStore(db, box.work_email);
    for (const id of found.ids) {
      if ((await db.query("SELECT 1 FROM gmail_messages WHERE gmail_message_id=$1", [id])).rowCount) { out.skipped++; continue; }
      out.fetched++;
      const msg = parseMessage(await api.getMessage(box.work_email, id));
      const thread = ((await api.getThread(box.work_email, msg.threadId)).messages || []).map(parseMessage).sort(sortByDate);
      const stage = await processMessage(msg, thread, { ctx, projects, store, ask });
      out.stages[stage] = (out.stages[stage] || 0) + 1;
    }
    await db.query("UPDATE gmail_mailboxes SET history_id=$2, last_synced_at=now(), last_error=NULL WHERE id=$1", [box.id, found.historyId]);
  } catch (err) {
    await db.query("UPDATE gmail_mailboxes SET last_error=$2 WHERE id=$1", [box.id, String(err.message || err).slice(0, 300)]);
    out.error = err.message;
  }
  return out;
}

/** Syncs every enabled mailbox (or just `only`). Returns { skipped: true } if a sync is already running. */
export async function syncAll({ only, ...opts } = {}) {
  if (running) return { skipped: true };
  running = true;
  try {
    const { rows } = await pool.query("SELECT * FROM gmail_mailboxes WHERE enabled" + (only ? " AND lower(work_email)=lower($1)" : "") + " ORDER BY id", only ? [only] : []);
    const results = {};
    for (const box of rows) results[box.work_email] = await syncMailbox(box, opts);
    return { results };
  } finally { running = false; }
}

/** Gmail watches expire after about a week: renew any ending within a day. Without a Pub/Sub topic, the periodic sync alone keeps working. */
export async function renewWatches(api = gmail) {
  if (!process.env.GMAIL_PUBSUB_TOPIC) return;
  const { rows } = await pool.query("SELECT * FROM gmail_mailboxes WHERE enabled AND (watch_expires_at IS NULL OR watch_expires_at < now() + interval '1 day')");
  for (const box of rows) {
    try { const w = await api.watch(box.work_email); await pool.query("UPDATE gmail_mailboxes SET watch_expires_at=$2 WHERE id=$1", [box.id, w.expiresAt]); }
    catch (err) { await pool.query("UPDATE gmail_mailboxes SET last_error=$2 WHERE id=$1", [box.id, String(err.message).slice(0, 300)]); }
  }
}

/** Repeating job: a full sync every GMAIL_SYNC_MINUTES (default 15, at least 5) to catch missed notifications, and watch renewal. */
export function startGmailIntel() {
  if (!gmail.gmailReady()) return;
  const tick = async () => { await renewWatches().catch((e) => console.error("Gmail watch renewal failed:", e.message)); await syncAll().catch((e) => console.error("Gmail sync failed:", e.message)); };
  setInterval(tick, Math.max(5, Number(process.env.GMAIL_SYNC_MINUTES || 15)) * 60_000);
  setTimeout(tick, 20_000);
  console.log("Gmail Intelligence Engine: on");
}

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// Same error wrapper as index.js; mounted early there (before `wrap` exists), so it has its own copy.
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => { console.error(err); res.status(500).json({ error: "Server error" }); });

export function gmailIntelRouter() {
  const r = express.Router();

  r.get("/api/gmail-intel/status", requireHr, wrap(async (_req, res) => {
    const boxes = (await pool.query("SELECT work_email, enabled, last_synced_at, watch_expires_at, last_error FROM gmail_mailboxes ORDER BY work_email")).rows;
    const n = (await pool.query("SELECT count(*) FILTER (WHERE needs_review AND reviewed_by IS NULL)::int AS review, count(*)::int AS total FROM gmail_extractions")).rows[0];
    res.json({ on: gmail.gmailReady(), claude: claudeConfigured(), pubsub: Boolean(process.env.GMAIL_PUBSUB_TOPIC), domain: DOMAIN(), mailboxes: boxes, ...n });
  }));

  r.post("/api/gmail-intel/mailboxes", requireHr, wrap(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!EMAIL.test(email) || !email.endsWith("@" + DOMAIN())) return res.status(400).json({ error: `Enter a ${DOMAIN()} work email.` });
    await pool.query("INSERT INTO gmail_mailboxes (work_email) VALUES ($1) ON CONFLICT (work_email) DO UPDATE SET enabled = TRUE", [email]);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", ["Gmail reading switched on for this mailbox by " + req.user.email, email]);
    res.json({ ok: true });
  }));
  r.delete("/api/gmail-intel/mailboxes/:email", requireHr, wrap(async (req, res) => {
    const email = String(req.params.email).toLowerCase();
    await pool.query("UPDATE gmail_mailboxes SET enabled = FALSE WHERE work_email = $1", [email]);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", ["Gmail reading switched off for this mailbox by " + req.user.email, email]);
    res.json({ ok: true });
  }));

  r.post("/api/gmail-intel/sync", requireHr, wrap(async (_req, res) => {
    if (!gmail.gmailReady()) return res.status(400).json({ error: "Gmail reading is not set up on the server yet." });
    res.json(await syncAll());
  }));

  r.get("/api/gmail-intel/extractions", requireHr, wrap(async (req, res) => {
    const { project, from, to, review } = req.query;
    const w = [], v = [];
    if (project) { v.push(Number(project)); w.push(`project_id = $${v.length}`); }
    if (from) { v.push(String(from)); w.push(`email_date >= $${v.length}::date`); }
    if (to) { v.push(String(to)); w.push(`email_date < ($${v.length}::date + 1)`); }
    if (review === "1") w.push("needs_review AND reviewed_by IS NULL");
    const { rows } = await pool.query(`SELECT * FROM gmail_extractions ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY email_date DESC NULLS LAST LIMIT 200`, v);
    res.json(rows);
  }));
  r.post("/api/gmail-intel/extractions/:id/review", requireHr, wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (req.body?.decision === "reject") await pool.query("DELETE FROM gmail_extractions WHERE id=$1", [id]);
    else await pool.query("UPDATE gmail_extractions SET needs_review = FALSE, reviewed_by = $2 WHERE id=$1", [id, req.user.email]);
    res.json({ ok: true });
  }));

  r.get("/api/gmail-intel/usage", requireHr, wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT to_char(day,'YYYY-MM') AS month, purpose, sum(input_tokens)::int AS input_tokens, sum(output_tokens)::int AS output_tokens, round(sum(cost_usd),4)::float AS cost_usd
         FROM gmail_ai_usage GROUP BY 1,2 ORDER BY 1 DESC, 2`);
    res.json({ note: "Costs are estimates from the price settings, not Anthropic's invoice.", rows });
  }));

  // Google Pub/Sub push: no login, proven by the secret in the URL. Answer at once, then sync that mailbox.
  r.post("/api/gmail-intel/push", wrap(async (req, res) => {
    const token = process.env.GMAIL_PUSH_TOKEN;
    if (!token || !same(req.query.token || "", token)) return res.status(403).json({ error: "Not allowed" });
    res.status(204).end();
    try {
      const data = JSON.parse(Buffer.from(req.body?.message?.data || "", "base64").toString("utf8"));
      if (gmail.gmailReady() && EMAIL.test(data.emailAddress || "")) syncAll({ only: data.emailAddress }).catch((e) => console.error("Gmail push sync failed:", e.message));
    } catch { /* a malformed push is ignored; the periodic sync covers it */ }
  }));

  return r;
}

// ---------- the weekly project report (what people see) ----------
export const SECTIONS = [["completed", "Completed this week"], ["pending", "Still pending"], ["blockers", "Blockers"], ["decisions", "Decisions made"], ["deadlines", "Deadlines"], ["next_steps", "Next steps"]];

/** Monday to Sunday containing `date` (YYYY-MM-DD, default today), as plain dates. */
export function weekRange(date) {
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + "T00:00:00Z") : new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return weekRange();
  const from = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5), to = new Date(from.getTime() + 6 * 864e5);
  const f = (x) => x.toISOString().slice(0, 10);
  return { from: f(from), to: f(to) };
}

/** Turns a week's extracted rows into the report: each section lists every item once, with the people who reported it. */
export function buildReport(rows) {
  const people = new Map();
  const sections = SECTIONS.map(([key, title]) => {
    const seen = new Map();
    for (const r of rows) for (const t of r[key] || []) {
      const k = t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!seen.has(k)) seen.set(k, { text: t, by: [] });
      const who = r.employee_name || "Someone";
      if (!seen.get(k).by.includes(who)) seen.get(k).by.push(who);
    }
    return { key, title, items: [...seen.values()] };
  });
  for (const r of rows) {
    const n = r.employee_name || "Someone";
    if (!people.has(n)) people.set(n, { name: n, updates: [] });
    if (r.summary) people.get(n).updates.push({ date: r.email_date, subject: r.subject, summary: r.summary });
  }
  return { sections, people: [...people.values()], updates: rows.length };
}

async function loadReport(project, week) {
  const { rows } = await pool.query(
    `SELECT employee_name, subject, email_date, summary, completed, pending, blockers, decisions, deadlines, next_steps
       FROM gmail_extractions
      WHERE project_id = $1 AND NOT (needs_review AND reviewed_by IS NULL)
        AND email_date >= $2::date AND email_date < ($3::date + 1)
      ORDER BY email_date`, [project.id, week.from, week.to]);
  return { project, week, ...buildReport(rows) };
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso) => { const [, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]}`; };

/** The report as an email (plain text and HTML). Everything from emails is escaped. */
export function renderReportEmail(rep, link) {
  const range = `${short(rep.week.from)} to ${short(rep.week.to)}`;
  const subject = `Weekly report: ${rep.project.name} (${range})`;
  const text = [`${rep.project.name}: weekly report, ${range}`, `${rep.updates} update${rep.updates === 1 ? "" : "s"} from ${rep.people.length} ${rep.people.length === 1 ? "person" : "people"}`, "",
    ...rep.sections.filter((x) => x.items.length).flatMap((x) => [x.title.toUpperCase(), ...x.items.map((i) => `- ${i.text} (${i.by.join(", ")})`), ""]),
    "UPDATES BY PERSON", ...rep.people.flatMap((p) => [p.name, ...p.updates.map((u) => `  ${u.summary}`)]), "", link].join("\n");
  const sec = (x) => `<div style="margin-top:18px"><div style="font:700 12px/1.4 Arial,Helvetica,sans-serif;letter-spacing:.1em;color:#800d35">${esc(x.title.toUpperCase())}</div>
    <ul style="margin:6px 0 0;padding-left:18px;font:14px/1.6 Arial,Helvetica,sans-serif;color:#2a1016">${x.items.map((i) => `<li>${esc(i.text)} <span style="color:#8a7a78;font-size:12px">${esc(i.by.join(", "))}</span></li>`).join("")}</ul></div>`;
  const html = `<!doctype html><html><body style="margin:0;background:#fff7e9;padding:24px 12px">
  <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #eadfcf">
    <div style="background:#800d35;padding:26px 32px"><div style="font:600 13px/1.4 Arial,Helvetica,sans-serif;letter-spacing:.18em;color:#f3dcc6">WEEKLY PROJECT REPORT</div>
      <div style="font:700 24px/1.3 Arial,Helvetica,sans-serif;color:#ffffff;margin-top:6px">${esc(rep.project.name)}</div>
      <div style="font:14px/1.5 Arial,Helvetica,sans-serif;color:#f3dcc6">${esc(range)} · ${rep.updates} update${rep.updates === 1 ? "" : "s"} from ${rep.people.length} ${rep.people.length === 1 ? "person" : "people"}</div></div>
    <div style="padding:8px 32px 22px">${rep.sections.filter((x) => x.items.length).map(sec).join("")}
      <div style="margin-top:22px"><div style="font:700 12px/1.4 Arial,Helvetica,sans-serif;letter-spacing:.1em;color:#800d35">UPDATES BY PERSON</div>
      ${rep.people.map((p) => `<div style="margin-top:8px;font:14px/1.5 Arial,Helvetica,sans-serif;color:#2a1016"><b>${esc(p.name)}</b>${p.updates.map((u) => `<div>${esc(u.summary)}</div>`).join("")}</div>`).join("")}</div>
      <div style="margin:24px 0 4px"><a href="${esc(link)}" style="display:inline-block;background:#800d35;color:#ffffff;text-decoration:none;font:600 14px/1 Arial,Helvetica,sans-serif;padding:12px 20px;border-radius:999px">Open in Wohlig One</a></div></div>
    <div style="padding:14px 32px 20px;border-top:1px solid #f1e4d0;font:12px/1.5 Arial,Helvetica,sans-serif;color:#8a7a78">Wohlig One · WOHLIG TRANSFORMATIONS PRIVATE LIMITED</div>
  </div></body></html>`;
  return { subject, text, html };
}

export function projectReportRouter() {
  const r = express.Router();
  const visible = async (req) => {
    const hr = req.user.role === "hr";
    const { rows } = await pool.query(
      `SELECT DISTINCT p.id, p.name, p.status FROM projects p
         ${hr ? "" : `JOIN employee_project_allocations a ON a.project_id = p.id AND a.status = 'Active'
                      JOIN employees e ON e.id = a.employee_id AND lower(e.work_email) = lower($1)`}
        ORDER BY p.name`, hr ? [] : [req.user.email]);
    return rows;
  };
  r.get("/api/project-reports", requireAuth, wrap(async (req, res) => {
    res.json({ projects: await visible(req), week: weekRange() });
  }));
  r.get("/api/project-reports/:id", requireAuth, wrap(async (req, res) => {
    const project = (await visible(req)).find((p) => p.id === Number(req.params.id));
    if (!project) return res.status(404).json({ error: "No such project report." });
    res.json(await loadReport(project, weekRange(String(req.query.week || ""))));
  }));

  // Email the report to colleagues. Anyone who can see the report can send it, but only to company addresses (at most 10).
  r.post("/api/project-reports/:id/email", requireAuth, wrap(async (req, res) => {
    const project = (await visible(req)).find((p) => p.id === Number(req.params.id));
    if (!project) return res.status(404).json({ error: "No such project report." });
    const raw = Array.isArray(req.body?.to) ? req.body.to : String(req.body?.to || "").split(/[\s,;]+/);
    const to = [...new Set(raw.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
    if (!to.length) return res.status(400).json({ error: "Enter at least one email address." });
    if (to.length > 10) return res.status(400).json({ error: "You can send to at most 10 people at a time." });
    const bad = to.filter((e) => !EMAIL.test(e) || !e.endsWith("@" + DOMAIN()));
    if (bad.length) return res.status(400).json({ error: `Only ${DOMAIN()} addresses are allowed. Not accepted: ${bad.join(", ")}` });
    const report = await loadReport(project, weekRange(String(req.body?.week || "")));
    if (!report.updates) return res.status(400).json({ error: "There are no updates for this week to send." });
    const mail = renderReportEmail(report, `${publicUrl()}/app/project-reports`);
    for (const t of to) await sendEmail(t, mail.subject, mail.text, mail.html);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Weekly report for ${project.name} (${report.week.from}) emailed to ${to.join(", ")} by ${req.user.email}`, req.user.email]);
    res.json({ ok: true, sent: to.length });
  }));
  return r;
}
