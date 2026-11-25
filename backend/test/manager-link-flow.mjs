/*
 * A reporting manager can approve their team's leave even when the manager link was made in an awkward order, against a LOCAL
 * server and database (never the shared one). Leave approval follows employees.manager_email; the name alone is not enough.
 *   - A team member added BEFORE their manager's own row, with the manager's name typed with extra spaces, is linked as soon as
 *     the manager's row is added (before this fix they stayed unlinked, so only a super admin could decide their leave).
 *   - The manager then sees the request as theirs and can approve it; a colleague outside the team still cannot.
 * It makes its own test people (test-link-*@wohlig.com), and removes everything it made.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/manager-link-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server), like manager-flow.mjs.
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: BASE must be a local server."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const one = async (q, v = []) => (await db.query(q, v)).rows[0];

let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => { if (cond) { pass += 1; console.log(`PASS  ${name}`); } else { fail += 1; console.log(`FAIL  ${name}${extra ? `  ${extra}` : ""}`); } };

const TAG = `test-link-${Date.now().toString(36)}`;
const mail = (k) => `${TAG}-${k}@wohlig.com`;
const BOSS = `Linky ${TAG.slice(-5)} Boss`;
const made = { sessions: [], emails: ["boss", "member", "other"].map(mail) };

async function signIn(email) {
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1, '00:00', 'employee') ON CONFLICT DO NOTHING", [email]);
  const t = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '15 minutes')", [sha(t), email]);
  made.sessions.push(sha(t));
  return t;
}
async function api(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", Cookie: `sid=${token}` }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}
async function cleanup() {
  await db.query("DELETE FROM leave_requests WHERE lower(work_email) = ANY($1)", [made.emails]);
  await db.query("DELETE FROM audit_log WHERE lower(work_email) = ANY($1)", [made.emails]);
  if (made.sessions.length) await db.query("DELETE FROM sessions WHERE token_hash = ANY($1)", [made.sessions]);
  await db.query("DELETE FROM users WHERE lower(email) = ANY($1) AND password_hash='00:00'", [made.emails]);
  await db.query("DELETE FROM employees WHERE lower(work_email) = ANY($1)", [made.emails]);
}

try {
  // The member first, with the manager's name typed with a double space and a trailing space; the manager is not in the list yet.
  await db.query("INSERT INTO employees (name, title, work_email, status, start_date, manager) VALUES ($1,'Software Development Engineer',$2,'active','2024-01-01',$3)",
    [`Linky ${TAG.slice(-5)} Member`, mail("member"), BOSS.replace(" ", "  ") + " "]);
  ok((await one("SELECT manager_email FROM employees WHERE work_email=$1", [mail("member")])).manager_email === null, "before the manager exists, the link is empty");
  await db.query("INSERT INTO employees (name, title, work_email, status, start_date) VALUES ($1,'Tech Lead',$2,'active','2024-01-01')", [BOSS, mail("boss")]);
  await db.query("INSERT INTO employees (name, title, work_email, status, start_date) VALUES ($1,'Software Development Engineer',$2,'active','2024-01-01')", [`Linky ${TAG.slice(-5)} Other`, mail("other")]);
  const linked = (await one("SELECT manager_email FROM employees WHERE work_email=$1", [mail("member")])).manager_email;
  ok(linked === mail("boss"), "adding the manager links their team member at once", `manager_email=${linked}`);

  const { rows } = await db.query("INSERT INTO leave_requests (work_email, type, from_date, to_date, days, reason) VALUES ($1,'casual','2026-12-21','2026-12-21',1,'Family function') RETURNING id", [mail("member")]);
  const id = rows[0].id;
  await new Promise((r) => setTimeout(r, 15500));   // the reporting tree is cached for 15 seconds
  const boss = await signIn(mail("boss")), other = await signIn(mail("other"));

  let r = await api("GET", "/api/leave", null, boss);
  ok(r.status === 200 && r.data?.approvers?.[mail("member")] === mail("boss"), "the manager sees the request as theirs to decide", JSON.stringify(r.data?.approvers || r.data));
  ok(r.status === 200 && (r.data?.requests || []).some((x) => x.id === id), "the request is in the manager's list");
  r = await api("POST", `/api/leave/requests/${id}/decision`, { decision: "approved" }, other);
  ok(r.status === 403, "a colleague outside the team cannot approve it", JSON.stringify(r));
  r = await api("POST", `/api/leave/requests/${id}/decision`, { decision: "approved" }, boss);
  ok(r.status === 200 && r.data?.status === "approved", "the manager approves it", JSON.stringify(r));
} catch (err) {
  fail += 1;
  console.log("FAIL  the test stopped:", err.message);
} finally {
  await cleanup().catch((e) => console.log("Clean-up problem:", e.message));
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
