/*
 * A forgotten punch-out, end to end, as Keka handles it, against a LOCAL server and database (never the shared one).
 * HR's policy for the test: penalty on, 1 free missing punch-out a month, half a day each after; 1 correction a month without
 * approval, 3 in all, up to 7 days back. The test saves the policy it finds and puts it back afterwards.
 *   - the day shows "Punch-out missing" with no hours made up, and Home lists it;
 *   - the first correction of the month is added straight away (no approval); the next goes to the manager AND HR;
 *   - nobody approves their own, a colleague outside the team cannot; the manager can; approving adds the punch;
 *   - a correction past the window or past the month's limit is refused;
 *   - once a day is closed and still missing, after the free one, half a day of casual leave is taken (once only).
 * It makes its own test people (test-mp-*@wohlig.com) and removes everything it made.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local DB_SCHEMA= BASE=http://localhost:3100 node test/missing-punch-flow.mjs
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
const made = { sessions: [], emails: ["boss", "emp", "peer", "late"].map(mail), policy: undefined };
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const weekdayBefore = (d) => { let x = addDays(d, -1); while ([0, 6].includes(new Date(x + "T00:00:00Z").getUTCDay())) x = addDays(x, -1); return x; };

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
  await db.query("DELETE FROM attendance_penalties WHERE lower(email) = ANY($1)", [made.emails]);
  await db.query("DELETE FROM leave_requests WHERE lower(work_email) = ANY($1)", [made.emails]);
  await db.query("DELETE FROM attendance_requests WHERE lower(email) = ANY($1)", [made.emails]);
  await db.query("DELETE FROM attendance_punches WHERE employee_id IN (SELECT id FROM employees WHERE lower(work_email) = ANY($1))", [made.emails]);
  await db.query("DELETE FROM notifications WHERE lower(recipient) = ANY($1) OR body LIKE $2", [made.emails, `%${TAG}%`]);
  await db.query("DELETE FROM notifications WHERE title='Attendance correction to review' AND created_at > now() - interval '10 minutes'");
  await db.query("DELETE FROM audit_log WHERE lower(work_email) = ANY($1)", [made.emails]);
  if (made.sessions.length) await db.query("DELETE FROM sessions WHERE token_hash = ANY($1)", [made.sessions]);
  await db.query("DELETE FROM users WHERE lower(email) = ANY($1) AND password_hash='00:00'", [made.emails]);
  await db.query("DELETE FROM employees WHERE lower(work_email) = ANY($1)", [made.emails]);
  if (made.policy !== undefined) {
    await db.query("DELETE FROM attendance_policy WHERE id=1");
    if (made.policy) await db.query(`INSERT INTO attendance_policy SELECT * FROM json_populate_record(NULL::attendance_policy, $1::json)`, [JSON.stringify(made.policy)]);
  }
}

try {
  const { d: today } = await one("SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS d");
  made.policy = (await db.query("SELECT * FROM attendance_policy WHERE id=1")).rows[0] || null;
  await db.query(`INSERT INTO attendance_policy (id, penalty_on, free_per_month, penalty_days, self_fix_per_month, requests_per_month, days_back, remind_before_min, updated_by)
    VALUES (1, true, 1, 0.5, 1, 3, 7, 10, 'test') ON CONFLICT (id) DO UPDATE SET penalty_on=true, free_per_month=1, penalty_days=0.5, self_fix_per_month=1, requests_per_month=3, days_back=7, remind_before_min=10`);

  // Four recent weekdays for corrections (same month as each other when possible), one 10+ days back, and two closed ones for the penalty.
  const d1 = weekdayBefore(today), d2 = weekdayBefore(d1), d3 = weekdayBefore(d2), d4 = weekdayBefore(d3);
  let old = addDays(today, -10); while ([0, 6].includes(new Date(old + "T00:00:00Z").getUTCDay())) old = addDays(old, -1);
  const p1 = weekdayBefore(old), p2 = weekdayBefore(p1);   // the penalty person's two closed missing days (p2 earlier, free; p1 penalised)

  await db.query("INSERT INTO employees (name, title, work_email, status, start_date) VALUES ($1,'Tech Lead',$2,'active','2024-01-01')", [`Mp ${TAG.slice(-5)} Boss`, mail("boss")]);
  for (const k of ["emp", "late"]) await db.query("INSERT INTO employees (name, title, work_email, status, start_date, manager_email) VALUES ($1,'Software Development Engineer',$2,'active','2024-01-01',$3)", [`Mp ${TAG.slice(-5)} ${k}`, mail(k), mail("boss")]);
  await db.query("INSERT INTO employees (name, title, work_email, status, start_date) VALUES ($1,'Software Development Engineer',$2,'active','2024-01-01')", [`Mp ${TAG.slice(-5)} Peer`, mail("peer")]);
  const idOf = async (k) => (await one("SELECT id FROM employees WHERE work_email=$1", [mail(k)])).id;
  const empId = await idOf("emp"), lateId = await idOf("late");
  for (const d of [d1, d2, d3, d4, old]) await db.query("INSERT INTO attendance_punches (employee_id, work_date, punch_time, direction, source, created_by) VALUES ($1,$2,'11:00','IN','web','test')", [empId, d]);
  for (const d of [p1, p2]) await db.query("INSERT INTO attendance_punches (employee_id, work_date, punch_time, direction, source, created_by) VALUES ($1,$2,'11:00','IN','web','test')", [lateId, d]);
  await new Promise((r) => setTimeout(r, 15500));   // the reporting tree is cached for 15 seconds
  const emp = await signIn(mail("emp")), boss = await signIn(mail("boss")), peer = await signIn(mail("peer"));
  const dayOf = async (date, token = emp) => (await api("GET", `/api/attendance/month?month=${date.slice(0, 7)}`, null, token)).data.days.find((x) => x.date === date);

  let d = await dayOf(d1);
  ok(d.status === "Punch-out missing" && d.minutes === 0 && !d.countedTo, "a day punched in at 11 with no punch-out: Punch-out missing, 0 hours, nothing filled in", JSON.stringify({ s: d.status, m: d.minutes }));
  let r = await api("GET", "/api/attendance/today", null, emp);
  ok((r.data.missingOut || []).some((x) => x.date === d1), "Home lists it");
  r = await api("GET", "/api/attendance/missing-policy", null, emp);
  ok(r.status === 200 && r.data.selfFixPerMonth === 1 && r.data.penaltyOn === true, "everyone can read the policy", JSON.stringify(r.data));
  r = await api("PUT", "/api/attendance/missing-policy", { ...r.data, freePerMonth: 9 }, emp);
  ok(r.status === 403, "only HR can change the policy", JSON.stringify(r));

  // 1st correction: within the month's allowance, added straight away.
  r = await api("POST", "/api/requests/attendance", { date: d1, kind: "missed-punch", direction: "OUT", time: "19:30", note: "Forgot" }, emp);
  ok(r.status === 201 && r.data.selfFix === true && r.data.status === "approved", "the first correction is added with no approval", JSON.stringify(r.data));
  d = await dayOf(d1);
  ok(!d.forgotOut && d.lastOut === "19:30" && d.minutes === 510, "the day is counted at once: 11:00 to 7:30 pm, 8h 30m", JSON.stringify({ s: d.status, m: d.minutes, out: d.lastOut }));

  // 2nd: past the allowance, so it waits for the manager or HR, and both are told.
  if (d2.slice(0, 7) === d1.slice(0, 7)) {
    r = await api("POST", "/api/requests/attendance", { date: d2, kind: "missed-punch", direction: "OUT", time: "18:40", note: "Forgot again" }, emp);
    ok(r.status === 201 && r.data.status === "pending" && !r.data.selfFix, "the next correction waits for approval", JSON.stringify(r.data));
    const id = r.data.id;
    // The notices go out just after the answer: wait for them (up to 3 seconds).
    let toBoss, toHr;
    for (let i = 0; i < 15; i++) {
      toBoss = await one("SELECT count(*)::int AS n FROM notifications WHERE lower(recipient)=$1 AND title='Attendance correction to review'", [mail("boss")]);
      toHr = await one("SELECT count(*)::int AS n FROM notifications WHERE lower(recipient)<>$1 AND title='Attendance correction to review' AND link='/app/hr-requests' AND created_at > now() - interval '2 minutes'", [mail("boss")]);
      if (toBoss.n && toHr.n) break;
      await new Promise((res) => setTimeout(res, 200));
    }
    ok(toBoss.n === 1 && toHr.n >= 1, "both the manager and the HR team are told", JSON.stringify({ toBoss, toHr }));
    r = await api("POST", `/api/requests/attendance/${id}/decide`, { decision: "approve" }, emp);
    ok(r.status === 403, "nobody approves their own");
    r = await api("POST", `/api/requests/attendance/${id}/decide`, { decision: "approve" }, peer);
    ok(r.status === 403, "a colleague outside the team cannot approve it");
    r = await api("POST", `/api/requests/attendance/${id}/decide`, { decision: "approve" }, boss);
    ok(r.status === 200, "the manager approves it");
    d = await dayOf(d2);
    ok(!d.forgotOut && d.lastOut === "18:40", "approving adds the punch", JSON.stringify({ out: d.lastOut }));

    // Window and the month's limit (3 in all: two used).
    r = await api("POST", "/api/requests/attendance", { date: old, kind: "missed-punch", direction: "OUT", time: "18:00", note: "Old" }, emp);
    ok(r.status === 409 && /days back/.test(r.data?.error || ""), "a day more than 7 days back is refused", JSON.stringify(r));
    if (d3.slice(0, 7) === d1.slice(0, 7) && d4.slice(0, 7) === d1.slice(0, 7)) {
      r = await api("POST", "/api/requests/attendance", { date: d3, kind: "missed-punch", direction: "OUT", time: "18:30", note: "Third" }, emp);
      ok(r.status === 201 && r.data.status === "pending", "the third correction of the month is accepted (for approval)", JSON.stringify(r.data));
      r = await api("POST", "/api/requests/attendance", { date: d4, kind: "missed-punch", direction: "OUT", time: "18:30", note: "Fourth" }, emp);
      ok(r.status === 409 && /most allowed/.test(r.data?.error || ""), "the fourth is refused: the month's limit", JSON.stringify(r));
    } else console.log("SKIP  the month's limit (the test days cross a month)");
  } else console.log("SKIP  approval steps (the test days cross a month)");

  // The penalty: run the job for the test person only.
  process.env.DATABASE_URL = DB;
  const { runMissingPunchPenalties } = await import("../src/attendance-reminders.js");
  const { pool: appPool } = await import("../src/db.js");
  let n = await runMissingPunchPenalties(appPool, { emails: [mail("late")] });
  const pens = (await db.query("SELECT to_char(work_date,'YYYY-MM-DD') AS d, days, leave_request_id FROM attendance_penalties WHERE email=$1", [mail("late")])).rows;
  const sameMonth = p1.slice(0, 7) === p2.slice(0, 7);
  ok(sameMonth ? (n === 1 && pens.length === 1 && pens[0].d === p1 && Number(pens[0].days) === 0.5) : pens.length === 0,
    sameMonth ? "after the 1 free missing day, the next closed one is penalised half a day" : "two missing days in different months are each free", JSON.stringify({ n, pens, p1, p2 }));
  if (sameMonth && pens[0]) {
    const lr = await one("SELECT type, half, days, paid_days, lop_days, status, decided_by FROM leave_requests WHERE id=$1", [pens[0].leave_request_id]);
    ok(lr && lr.type === "casual" && lr.status === "approved" && Number(lr.days) === 0.5 && Number(lr.paid_days) === 0.5 && Number(lr.lop_days) === 0, "it is half a day of casual leave from the balance (no loss of pay while leave is left)", JSON.stringify(lr));
    const told = await one("SELECT count(*)::int AS n FROM notifications WHERE lower(recipient)=$1 AND title='Penalty for a missing punch-out'", [mail("late")]);
    ok(told.n === 1, "the person is told");
    const late = await signIn(mail("late"));
    d = await dayOf(p1, late);
    ok(d.status === "Punch-out missing" && d.penalty === 0.5, "the day still shows Punch-out missing, with the penalty", JSON.stringify({ s: d.status, p: d.penalty }));
  }
  n = await runMissingPunchPenalties(appPool, { emails: [mail("late")] });
  ok(n === 0, "running again penalises nothing twice", String(n));
  await appPool.end();
} catch (err) {
  fail += 1;
  console.log("FAIL  the test stopped:", err.message);
} finally {
  await cleanup().catch((e) => console.log("Clean-up problem:", e.message));
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
