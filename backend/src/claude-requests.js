import express from "express";
import { pool } from "./db.js";
import { notify } from "./notify.js";
import { frontendUrl } from "./mail.js";
import { requireItAdmin } from "./assets.js";

/* Claude access without an Admin API key. HR asks for it (tool_access status "requested"), the Claude admin invites the
   person in Claude itself, then clicks Done here ("invited") and later marks them accepted ("active").
   With an Admin API key the app invites by itself and none of this is used. */
const REMIND_DAYS = Number(process.env.CLAUDE_REMIND_DAYS) || 2;
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const audit = (action, email) => pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]);
const PAGE = "/app/claude-requests";

/** Who is told about a request: Samay (or the addresses in CLAUDE_ADMIN_EMAILS) plus every IT admin; HR if there is nobody. */
const DEFAULT_CLAUDE_ADMIN = "samay.gada@wohlig.com";
async function claudeAdmins() {
  const fromEnv = String(process.env.CLAUDE_ADMIN_EMAILS ?? DEFAULT_CLAUDE_ADMIN).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const { rows } = await pool.query("SELECT lower(email) AS email FROM users WHERE it_admin");
  const all = [...new Set([...fromEnv, ...rows.map((r) => r.email)])];
  return all.length ? all : "hr";
}

/** HR asks for Claude access for someone. Does nothing if it is already requested, invited or active. */
export async function requestClaude(email, by) {
  const key = String(email).toLowerCase();
  const emp = (await pool.query("SELECT name FROM employees WHERE lower(work_email)=$1", [key])).rows[0];
  const now = (await pool.query("SELECT status FROM tool_access WHERE work_email=$1 AND tool='claude'", [key])).rows[0];
  if (now && ["requested", "invited", "active"].includes(now.status)) {
    const said = { requested: "Already requested. Waiting for the Claude admin to invite them", invited: "Already invited. Waiting for them to accept", active: "Already has Claude access" }[now.status];
    return { status: now.status, detail: said, already: true };
  }
  const detail = `Requested by ${by}. Waiting for the Claude admin to invite them`;
  await pool.query(
    `INSERT INTO tool_access (work_email, tool, status, detail, updated_at, requested_by, requested_at, reminded_at)
     VALUES ($1,'claude','requested',$2,now(),$3,now(),NULL)
     ON CONFLICT (work_email, tool) DO UPDATE SET status='requested', detail=$2, updated_at=now(), requested_by=$3, requested_at=now(), reminded_at=NULL`, [key, detail, by]);
  await audit(`Claude: access requested (by ${by})`, key);
  await notify(await claudeAdmins(), {
    title: `Claude access needed for ${emp.name}`, body: `${key}. Invite them in Claude, then click Done here.`, link: PAGE,
    email: { subject: `Claude access needed for ${emp.name}`, body: `Name: ${emp.name}\nWork email: ${key}\nRequested by: ${by}\n\nPlease invite them to the Claude organisation (Claude, Settings, Members, Invite), then click Done on the requests page:\n${frontendUrl()}${PAGE}` },
  });
  return { status: "requested", detail: "Request sent to the Claude admin. They invite the person in Claude and mark it done here" };
}

/** A daily nudge for requests nobody has dealt with after REMIND_DAYS days. */
export async function runClaudeReminders() {
  const { rows } = await pool.query(
    `SELECT t.work_email, e.name FROM tool_access t JOIN employees e ON lower(e.work_email)=t.work_email
     WHERE t.tool='claude' AND t.status='requested' AND e.status <> 'offboarded'
       AND t.requested_at < now() - make_interval(days => $1::int)
       AND (t.reminded_at IS NULL OR t.reminded_at < now() - interval '1 day')`, [REMIND_DAYS]);
  if (!rows.length) return 0;
  const to = await claudeAdmins();
  for (const r of rows) {
    await pool.query("UPDATE tool_access SET reminded_at=now() WHERE work_email=$1 AND tool='claude'", [r.work_email]);
    await notify(to, {
      title: `Claude access for ${r.name} is still waiting`, body: `${r.work_email} was requested over ${REMIND_DAYS} days ago.`, link: PAGE,
      email: { subject: `Reminder: Claude access for ${r.name}`, body: `${r.name} (${r.work_email}) is still waiting to be invited to Claude:\n${frontendUrl()}${PAGE}` },
    });
  }
  return rows.length;
}

/* ---------- routes: HR and IT admins ---------- */
export const claudeRequestsRouter = express.Router();
claudeRequestsRouter.use(requireItAdmin);

const personOf = async (email) => (await pool.query("SELECT name FROM employees WHERE lower(work_email)=$1", [String(email || "").toLowerCase()])).rows[0];

claudeRequestsRouter.get("/", wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.work_email, t.status, t.updated_at, t.requested_by, t.requested_at, e.name, e.title
     FROM tool_access t JOIN employees e ON lower(e.work_email)=t.work_email
     WHERE t.tool='claude' AND t.status IN ('requested','invited') AND e.status <> 'offboarded'
     ORDER BY coalesce(t.requested_at, t.updated_at), e.name`);
  const row = (r) => ({ email: r.work_email, name: r.name, title: r.title || "", requestedBy: r.requested_by || "", since: r.requested_at || r.updated_at });
  res.json({ remindDays: REMIND_DAYS, toInvite: rows.filter((r) => r.status === "requested").map(row), invited: rows.filter((r) => r.status === "invited").map(row) });
}));

// The Claude admin has invited them in Claude.
claudeRequestsRouter.post("/done", wrap(async (req, res) => {
  const email = String((req.body && req.body.email) || "").toLowerCase(), who = await personOf(email);
  const r = await pool.query(
    `UPDATE tool_access SET status='invited', detail=$2, updated_at=now() WHERE work_email=$1 AND tool='claude' AND status='requested' RETURNING requested_by`,
    [email, `Invited in Claude by ${req.user.email}. Waiting for them to accept`]);
  if (!r.rowCount) return res.status(409).json({ error: "There is no open request for this person." });
  await audit(`Claude: marked as invited in Claude (by ${req.user.email})`, email);
  const asker = r.rows[0].requested_by;
  if (asker && asker.toLowerCase() !== req.user.email.toLowerCase()) await notify(asker, { title: `${(who && who.name) || email} has been invited to Claude`, body: "They get access when they accept the email from Claude.", link: `/app/employees/${encodeURIComponent(email)}` });
  res.json({ status: "invited" });
}));

// They accepted the invite.
claudeRequestsRouter.post("/active", wrap(async (req, res) => {
  const email = String((req.body && req.body.email) || "").toLowerCase();
  const r = await pool.query(
    `UPDATE tool_access SET status='active', detail=$2, updated_at=now() WHERE work_email=$1 AND tool='claude' AND status='invited'`,
    [email, `Marked as accepted by ${req.user.email}`]);
  if (!r.rowCount) return res.status(409).json({ error: "This person has no invite waiting." });
  await audit(`Claude: marked as having access (by ${req.user.email})`, email);
  res.json({ status: "active" });
}));

// The request is no longer needed.
claudeRequestsRouter.post("/cancel", wrap(async (req, res) => {
  const email = String((req.body && req.body.email) || "").toLowerCase();
  const r = await pool.query("DELETE FROM tool_access WHERE work_email=$1 AND tool='claude' AND status='requested'", [email]);
  if (!r.rowCount) return res.status(409).json({ error: "There is no open request for this person." });
  await audit(`Claude: request cancelled (by ${req.user.email})`, email);
  res.json({ status: "none" });
}));

/**
 * The person says they have accepted the Claude invite (the banner they see after signing in). Only for the request flow:
 * with an Admin API key the app learns this from Claude itself.
 */
export async function confirmOwnClaude(email) {
  const key = String(email).toLowerCase();
  const r = await pool.query(
    `UPDATE tool_access SET status='active', detail='The person confirmed they accepted the Claude invite', updated_at=now()
     WHERE work_email=$1 AND tool='claude' AND status='invited' RETURNING requested_by`, [key]);
  if (!r.rowCount) return null;
  await audit("Claude: the person confirmed they have access", key);
  const emp = (await pool.query("SELECT name FROM employees WHERE lower(work_email)=$1", [key])).rows[0];
  const asker = r.rows[0].requested_by;
  if (asker) await notify(asker, { title: `${(emp && emp.name) || key} confirmed they have Claude access`, link: `/app/employees/${encodeURIComponent(key)}` });
  return { status: "active" };
}
