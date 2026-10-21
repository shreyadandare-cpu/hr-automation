import express from "express";
import { pool } from "./db.js";
import { requireHr } from "./auth.js";
import { notify } from "./notify.js";

/*
 * Budget requests: spending that needs HR's approval before it happens (a team dinner, an offsite).
 *
 *   submitted -> under_review -> approved | partially_approved | rejected
 *
 * HR approves the requested budget or a lower amount (never more; the database enforces it too). The requester then
 * spends and files the final bill as a reimbursement claim linked to the budget (POST /api/reimbursements/from-document
 * ?budget=<id>). That claim's eligible amount is min(actual bill, approved budget); the excess is never reimbursed.
 * Everyone sees their own requests; HR sees all and decides.
 */
const REMIND_DAYS = Number(process.env.REIMB_REMINDER_DAYS || 3);
const isHr = (req) => req.user && req.user.role === "hr";
const me = (req) => req.user.email.toLowerCase();
const num = (v) => (v === null || v === undefined ? null : Number(v));
const inr = (n) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const clip = (s, n) => (String(s || "").trim().slice(0, n) || null);
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const OPEN = ["submitted", "under_review"];

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query(out.status >= 400 ? "ROLLBACK" : "COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function event(db, b, { actor, kind, status = null, note = null }) {
  await db.query("INSERT INTO budget_request_events (budget_request_id, actor, kind, status, note) VALUES ($1,$2,$3,$4,$5)", [b.id, actor, kind, status, note]);
  await db.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)",
    [`${b.request_no}: ${kind}${note ? ` (${note})` : ""}${actor && actor !== b.work_email ? ` by ${actor}` : ""}`, b.work_email]);
}

const SELECT = `SELECT b.*, e.name AS emp_name, e.emp_no, e.title,
    c.id AS claim_id, c.claim_no, c.status AS claim_status, c.amount AS claim_amount, c.eligible_amount AS claim_eligible,
    c.approved_amount AS claim_approved, c.paid_amount AS claim_paid, c.payroll_period AS claim_period, c.submitted_at AS claim_submitted_at
  FROM budget_requests b LEFT JOIN employees e ON lower(e.work_email)=lower(b.work_email)
  LEFT JOIN LATERAL (SELECT * FROM reimbursements r WHERE r.budget_request_id=b.id AND r.status <> 'rejected' ORDER BY r.id DESC LIMIT 1) c ON true`;

const toApi = (b) => {
  const approved = num(b.approved_budget), actual = num(b.claim_amount);
  return {
    id: b.id, requestNo: b.request_no, email: b.work_email, employee: { name: b.emp_name || b.work_email, empNo: b.emp_no, title: b.title },
    purpose: b.purpose, category: b.category, requestedBudget: num(b.requested_budget), approvedBudget: approved,
    headcount: b.headcount, eventDate: b.event_date, description: b.description, status: b.status, decisionReason: b.decision_reason,
    decidedBy: b.decided_by, decidedAt: b.decided_at, submittedAt: b.submitted_at, createdAt: b.created_at,
    // The final bill, once filed, and the budget-vs-actual comparison.
    claim: b.claim_id ? { id: b.claim_id, claimNo: b.claim_no, status: b.claim_status, actual, eligible: num(b.claim_eligible),
      approved: num(b.claim_approved), paid: num(b.claim_paid), payrollPeriod: b.claim_period, submittedAt: b.claim_submitted_at } : null,
    comparison: approved != null && actual != null ? { approvedBudget: approved, actual, covered: Math.min(approved, actual), excess: Math.max(0, Math.round((actual - approved) * 100) / 100) } : null,
  };
};
const canSee = (req, b) => b && (isHr(req) || b.work_email.toLowerCase() === me(req));

export const budgetsRouter = express.Router();

budgetsRouter.get("/", wrap(async (req, res) => {
  const args = [], where = [];
  if (!isHr(req)) { args.push(me(req)); where.push(`lower(b.work_email)=$${args.length}`); }
  if (req.query.status) { args.push(String(req.query.status)); where.push(`b.status=$${args.length}`); }
  if (req.query.q) { args.push(`%${String(req.query.q).slice(0, 60)}%`); where.push(`(e.name ILIKE $${args.length} OR b.request_no ILIKE $${args.length} OR b.purpose ILIKE $${args.length})`); }
  const { rows } = await pool.query(`${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY b.submitted_at DESC, b.id DESC LIMIT 300`, args);
  res.json({ requests: rows.map(toApi) });
}));

budgetsRouter.get("/:id", wrap(async (req, res) => {
  const { rows } = await pool.query(`${SELECT} WHERE b.id=$1`, [Number(req.params.id) || 0]);
  if (!canSee(req, rows[0])) return res.status(404).json({ error: "Budget request not found." });
  const { rows: ev } = await pool.query(
    `SELECT v.*, e.name AS actor_name FROM budget_request_events v LEFT JOIN employees e ON lower(e.work_email)=lower(v.actor)
     WHERE budget_request_id=$1 ORDER BY v.id`, [rows[0].id]);
  res.json({ request: toApi(rows[0]),
    events: ev.map((e) => ({ at: e.at, actor: e.actor === "system" ? "System" : e.actor_name || e.actor, kind: e.kind, status: e.status, note: e.note })) });
}));

// A team lead (anyone) asks for a budget. Sent to HR straight away.
budgetsRouter.post("/", wrap(async (req, res) => {
  const b = req.body || {};
  const errors = {};
  const purpose = clip(b.purpose, 120), description = clip(b.description, 1000);
  if (!purpose) errors.purpose = "Say what the budget is for.";
  const { rows: cats } = await pool.query("SELECT key FROM reimbursement_categories WHERE active");
  if (!cats.some((c) => c.key === b.category)) errors.category = "Pick a category.";
  const amt = Number(b.requestedBudget);
  if (!(amt > 0) || amt > 1e7 || Math.round(amt * 100) !== amt * 100) errors.requestedBudget = "Enter the budget in rupees.";
  const hc = b.headcount === "" || b.headcount == null ? null : Number(b.headcount);
  if (hc !== null && !(Number.isInteger(hc) && hc > 0 && hc <= 10000)) errors.headcount = "Enter the number of people, or leave it empty.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.eventDate || "") || isNaN(new Date(b.eventDate))) errors.eventDate = "Enter the date of the event or expense.";
  if (!description) errors.description = "Describe what the money will be spent on.";
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  const out = await tx(async (db) => {
    const { rows: [r] } = await db.query(
      `INSERT INTO budget_requests (work_email, purpose, category, requested_budget, headcount, event_date, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [me(req), purpose, b.category, amt, hc, b.eventDate, description, me(req)]);
    r.request_no = `BUD-${r.created_at.getFullYear()}-${String(r.id).padStart(4, "0")}`;
    await db.query("UPDATE budget_requests SET request_no=$2 WHERE id=$1", [r.id, r.request_no]);
    await event(db, r, { actor: me(req), kind: "Budget request submitted", status: "submitted", note: `${inr(amt)} for ${purpose}${hc ? `, ${hc} people` : ""}` });
    return { status: 201, body: { id: r.id, requestNo: r.request_no }, r };
  });
  const { rows: [who] } = await pool.query("SELECT name FROM employees WHERE lower(work_email)=$1", [me(req)]);
  const name = who ? who.name : req.user.email;
  await notify("hr", { title: `${name} requested a budget of ${inr(amt)}: ${purpose}.`, body: out.r.request_no, link: `budget:${out.r.id}`,
    email: { subject: `Budget request: ${out.r.request_no}`, body: `${name} requested a budget of ${inr(amt)} for "${purpose}" on ${b.eventDate}.\n\n${description}` } });
  res.status(201).json(out.body);
}));

// HR opening it moves it to Under review.
budgetsRouter.post("/:id/open", requireHr, wrap(async (req, res) => {
  const out = await tx(async (db) => {
    const { rows: [b] } = await db.query("SELECT * FROM budget_requests WHERE id=$1 FOR UPDATE", [Number(req.params.id) || 0]);
    if (!b) return { status: 404, body: { error: "Budget request not found." } };
    if (b.status !== "submitted") return { status: 200, body: { changed: false } };
    await db.query("UPDATE budget_requests SET status='under_review', updated_at=now() WHERE id=$1", [b.id]);
    await event(db, b, { actor: me(req), kind: "HR opened the request", status: "under_review" });
    return { status: 200, body: { changed: true } };
  });
  res.status(out.status).json(out.body);
}));

/*
 * Approve the requested budget or a lower amount (Automation 6). approvedBudget <= requestedBudget is enforced here and
 * by a database check; the requested budget is kept as it was.
 */
budgetsRouter.post("/:id/approve", requireHr, wrap(async (req, res) => {
  const body = req.body || {}, reason = clip(body.reason, 500);
  const out = await tx(async (db) => {
    const { rows: [b] } = await db.query("SELECT * FROM budget_requests WHERE id=$1 FOR UPDATE", [Number(req.params.id) || 0]);
    if (!b) return { status: 404, body: { error: "Budget request not found." } };
    if (!OPEN.includes(b.status)) return { status: 409, body: { error: "This budget request has already been decided." } };
    const requested = Number(b.requested_budget);
    const amt = body.approvedBudget === undefined || body.approvedBudget === "" || body.approvedBudget === null ? requested : Number(body.approvedBudget);
    if (!(amt > 0) || Math.round(amt * 100) !== amt * 100) return { status: 400, body: { errors: { approvedBudget: "Enter the approved budget in rupees, more than zero." } } };
    if (amt > requested) return { status: 400, body: { errors: { approvedBudget: `The approved budget can't be more than the ${inr(requested)} requested.` } } };
    const partial = amt < requested;
    if (partial && !reason) return { status: 400, body: { errors: { reason: "Give a reason for approving a lower amount." } } };
    const status = partial ? "partially_approved" : "approved";
    await db.query(`UPDATE budget_requests SET status=$2, approved_budget=$3, decision_reason=$4, decided_by=$5, decided_at=now(), updated_at=now() WHERE id=$1`,
      [b.id, status, amt, reason, me(req)]);
    await event(db, b, { actor: me(req), kind: partial ? "Approved a lower budget" : "Budget approved", status,
      note: partial ? `approved ${inr(amt)} of ${inr(requested)}` : `approved ${inr(amt)}` });
    if (reason) await event(db, b, { actor: me(req), kind: "Decision reason recorded", note: reason });
    return { status: 200, body: { ok: true, status, approvedBudget: amt }, b, partial, requested, amt };
  });
  if (out.status === 200) {
    const { b, partial, requested, amt } = out;
    const body = partial
      ? `Your budget request ${b.request_no} (${b.purpose}) of ${inr(requested)} has been reviewed.\n\nApproved budget: ${inr(amt)}\nNot approved: ${inr(requested - amt)}${reason ? `\n\nReason:\n${reason}` : ""}\n\nAfter the expense, upload the final bill in the app. Up to ${inr(amt)} is reimbursed.`
      : `Your budget request ${b.request_no} (${b.purpose}) of ${inr(amt)} has been approved.\n\nAfter the expense, upload the final bill in the app. Up to ${inr(amt)} is reimbursed.`;
    await notify(b.work_email, { title: partial ? `Your budget request was approved for ${inr(amt)} of ${inr(requested)}.` : `Your budget request of ${inr(amt)} has been approved.`,
      body: `${b.request_no} · ${b.purpose}`, link: `budget:${b.id}`, email: { subject: `Budget ${partial ? "partly approved" : "approved"}: ${b.request_no}`, body } });
  }
  res.status(out.status).json(out.body);
}));

budgetsRouter.post("/:id/reject", requireHr, wrap(async (req, res) => {
  const reason = clip(req.body && req.body.reason, 500);
  if (!reason) return res.status(400).json({ errors: { reason: "Tell the requester why." } });
  const out = await tx(async (db) => {
    const { rows: [b] } = await db.query("SELECT * FROM budget_requests WHERE id=$1 FOR UPDATE", [Number(req.params.id) || 0]);
    if (!b) return { status: 404, body: { error: "Budget request not found." } };
    if (!OPEN.includes(b.status)) return { status: 409, body: { error: "This budget request has already been decided." } };
    await db.query("UPDATE budget_requests SET status='rejected', decision_reason=$2, decided_by=$3, decided_at=now(), updated_at=now() WHERE id=$1", [b.id, reason, me(req)]);
    await event(db, b, { actor: me(req), kind: "Budget request rejected", status: "rejected", note: reason });
    return { status: 200, body: { ok: true }, b };
  });
  if (out.status === 200) {
    const b = out.b;
    await notify(b.work_email, { title: "Your budget request has been rejected.", body: `${b.request_no} · ${reason}`, link: `budget:${b.id}`,
      email: { subject: `Budget request rejected: ${b.request_no}`, body: `Your budget request ${b.request_no} (${b.purpose}, ${inr(b.requested_budget)}) has been rejected.\n\nReason: ${reason}` } });
  }
  res.status(out.status).json(out.body);
}));

/** Automation 10 for budgets: requests waiting longer than REIMB_REMINDER_DAYS remind HR, at most once a day. */
export async function runBudgetReminders() {
  const { rows } = await pool.query(
    `SELECT * FROM budget_requests WHERE status IN ('submitted','under_review') AND submitted_at < now() - make_interval(days => $1::int)
     AND (last_reminded_at IS NULL OR last_reminded_at < now() - interval '1 day')`, [REMIND_DAYS]);
  for (const b of rows) {
    const days = Math.floor((Date.now() - new Date(b.submitted_at)) / 864e5);
    await pool.query("UPDATE budget_requests SET last_reminded_at=now() WHERE id=$1", [b.id]);
    await event(pool, b, { actor: "system", kind: "Review reminder sent to HR", note: `waiting ${days} days` });
    await notify("hr", { title: `Budget request ${b.request_no} has been awaiting review for ${days} days.`, body: `${b.purpose} · ${inr(b.requested_budget)}`, link: `budget:${b.id}`,
      email: { subject: `Reminder: ${b.request_no} awaiting review`, body: `Budget request ${b.request_no} has been awaiting review for ${days} days.` } });
  }
  return rows.length;
}

