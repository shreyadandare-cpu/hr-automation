/*
 * A forgotten punch-out, end to end, as Keka handles it, against a LOCAL server and database (never the shared one):
 *   - the day shows "Punch-out missing" with no hours made up (nothing is counted to the end of the shift);
 *   - Home lists it; the person sends a correction with the time they left (one at a time per day);
 *   - only someone above them in the reporting lines (or HR) decides it, never themselves or a colleague;
 *   - approving adds the punch, and the day is counted from the real times.
 * It makes its own test people (test-mp-*@wohlig.com) and removes everything it made.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/missing-punch-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server).
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

const TAG = `test-mp-${Date.now().toString(36)}`;
const mail = (k) => `${TAG}-${k}@wohlig.com`;
const made = { sessions: [], emails: ["boss", "emp", "peer"].map(mail) };

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
  await db.query("DELETE FROM attendance_requests WHERE lower(email) = ANY($1)", [made.emails]);
  await db.query("DELETE FROM attendance_punches WHERE employee_id IN (SELECT id FROM employees WHERE lower(work_email) = ANY($1))", [made.emails]);
  await db.query("DELETE FROM notifications WHERE lower(recipient) = ANY($1)", [made.emails]);
  await db.query("DELETE FROM audit_log WHERE lower(work_email) = ANY($1)", [made.emails]);
  if (made.sessions.length) await db.query("DELETE FROM sessions WHERE token_hash = ANY($1)", [made.sessions]);
  await db.query("DELETE FROM users WHERE lower(email) = ANY($1) AND password_hash='00:00'", [made.emails]);
  await db.query("DELETE FROM employees WHERE lower(work_email) = ANY($1)", [made.emails]);
}

try {
  const { d: today } = await one("SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS d");
  // A weekday before today, so the shift and its end apply (the day only needs to be finished).
  let day = new Date(Date.parse(today + "T00:00:00Z") - 86400000);
  while ([0, 6].includes(day.getUTCDay())) day = new Date(day.getTime() - 86400000);
  const date = day.toISOString().slice(0, 10);

  await db.query("INSERT INTO employees (name, title, work_email, status, start_date) VALUES ($1,'Tech Lead',$2,'active','2024-01-01')", [`Mp ${TAG.slice(-5)} Boss`, mail("boss")]);
  await db.query("INSERT INTO employees (name, title, work_email, status, start_date, manager_email) VALUES ($1,'Software Development Engineer',$2,'active','2024-01-01',$3)", [`Mp ${TAG.slice(-5)} Emp`, mail("emp"), mail("boss")]);
  await db.query("INSERT INTO employees (name, title, work_email, status, start_date) VALUES ($1,'Software Development Engineer',$2,'active','2024-01-01')", [`Mp ${TAG.slice(-5)} Peer`, mail("peer")]);
  const empId = (await one("SELECT id FROM employees WHERE work_email=$1", [mail("emp")])).id;
  await db.query("INSERT INTO attendance_punches (employee_id, work_date, punch_time, direction, source, created_by) VALUES ($1,$2,'09:40','IN','web',$3)", [empId, date, mail("emp")]);
  await new Promise((r) => setTimeout(r, 15500));   // the reporting tree is cached for 15 seconds
  const emp = await signIn(mail("emp")), boss = await signIn(mail("boss")), peer = await signIn(mail("peer"));
  const dayOf = async () => (await api("GET", `/api/attendance/month?month=${date.slice(0, 7)}`, null, emp)).data.days.find((x) => x.date === date);

  let d = await dayOf();
  ok(d.status === "Punch-out missing", "a day with no punch-out shows Punch-out missing", d.status);
  ok(d.minutes === 0 && d.forgotOut === true && !d.countedTo, "no hours are made up for it (nothing counted to the end of the shift)", JSON.stringify({ minutes: d.minutes, countedTo: d.countedTo }));
  let r = await api("GET", "/api/attendance/today", null, emp);
  ok((r.data.missingOut || []).some((x) => x.date === date), "Home lists the missing punch-out", JSON.stringify(r.data.missingOut));

  r = await api("POST", "/api/requests/attendance", { date, kind: "missed-punch", note: "Forgot to punch out" }, emp);
  ok(r.status === 400 && r.data?.errors?.time, "a correction needs the time they left", JSON.stringify(r.data));
  r = await api("POST", "/api/requests/attendance", { date, kind: "missed-punch", direction: "OUT", time: "18:50", note: "Forgot to punch out" }, emp);
  ok(r.status === 201, "the correction is sent", JSON.stringify(r));
  const id = r.data?.id;
  r = await api("POST", "/api/requests/attendance", { date, kind: "missed-punch", direction: "OUT", time: "18:55", note: "Again" }, emp);
  ok(r.status === 409, "a second correction for the same day is refused while one waits", JSON.stringify(r));
  d = await dayOf();
  ok(d.correction === "pending", "the day shows the correction is waiting", d.correction);
  const told = await one("SELECT count(*)::int AS n FROM notifications WHERE lower(recipient)=$1 AND title='Attendance correction to review'", [mail("boss")]);
  ok(told.n === 1, "their manager is told", JSON.stringify(told));

  r = await api("POST", `/api/requests/attendance/${id}/decide`, { decision: "approve" }, emp);
  ok(r.status === 403, "nobody approves their own correction", JSON.stringify(r));
  r = await api("POST", `/api/requests/attendance/${id}/decide`, { decision: "approve" }, peer);
  ok(r.status === 403, "a colleague outside the team cannot approve it", JSON.stringify(r));
  r = await api("GET", "/api/requests/attendance?scope=all", null, boss);
  ok(r.status === 200 && (r.data.requests || []).some((x) => x.id === id && x.canDecide && x.time === "18:50" && x.direction === "OUT"), "the manager sees it, with the time, as theirs to decide", JSON.stringify(r.data).slice(0, 300));
  r = await api("POST", `/api/requests/attendance/${id}/decide`, { decision: "approve" }, boss);
  ok(r.status === 200, "the manager approves it", JSON.stringify(r));
  const added = await one("SELECT source, to_char(punch_time,'HH24:MI') AS t, direction FROM attendance_punches WHERE employee_id=$1 AND work_date=$2 AND direction='OUT'", [empId, date]);
  ok(added && added.t === "18:50" && added.source === "request", "approving adds the punch out at the time given", JSON.stringify(added));
  d = await dayOf();
  ok(!d.forgotOut && d.lastOut === "18:50" && d.minutes === 9 * 60 + 10 && d.status !== "Punch-out missing", "the day is counted from the real times", JSON.stringify({ status: d.status, minutes: d.minutes, lastOut: d.lastOut }));
  r = await api("GET", "/api/attendance/today", null, emp);
  ok(!(r.data.missingOut || []).some((x) => x.date === date), "Home no longer lists it");
  r = await api("POST", `/api/requests/attendance/${id}/decide`, { decision: "decline", note: "No" }, boss);
  ok(r.status === 409, "a decided correction cannot be decided again", JSON.stringify(r));
} catch (err) {
  fail += 1;
  console.log("FAIL  the test stopped:", err.message);
} finally {
  await cleanup().catch((e) => console.log("Clean-up problem:", e.message));
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
