/*
 * Shifts and overtime, end to end, against a LOCAL server and database (never the shared one): a shift is created and checked,
 * a person is put on it for some days, their punches show late arrival and overtime against the right shift, overtime is approved
 * only for staff marked as paid overtime, payroll shows the approved hours without paying them, and a shift in use cannot be retired.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/shifts-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server). The test people are clearly named and removed afterwards;
 * a server on a local database sends no email (live-services.js).
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: BASE must be a local server."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const EMP = "test.shift.employee@wohlig.com", HR = "test.shift.admin@wohlig.com", SHIFT = "Test early shift";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
async function login(email, perms = []) {
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x','employee') ON CONFLICT DO NOTHING", [email]);
  for (const p of perms) await db.query("INSERT INTO access_grants (email, permission, scope, granted_by, note) VALUES ($1,$2,'company','test','flow-test')", [email, p]);
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(token), email]);
  return token;
}
const call = async (token, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${token}`, origin: BASE, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = r.headers.get("content-type") || "";
  return { status: r.status, data: type.includes("json") ? await r.json().catch(() => null) : await r.text() };
};
const clean = async () => {
  await db.query("DELETE FROM attendance_punches WHERE employee_id IN (SELECT id FROM employees WHERE lower(work_email)=$1)", [EMP]);
  await db.query("DELETE FROM shift_assignments WHERE lower(email)=$1", [EMP]);
  await db.query("DELETE FROM salary_structures WHERE lower(work_email)=$1", [EMP]);   // left by a run that stopped early
  await db.query("DELETE FROM shifts WHERE name=$1", [SHIFT]);
  await db.query("DELETE FROM overtime_approvals WHERE lower(email)=$1", [EMP]);
  await db.query("DELETE FROM overtime_staff WHERE lower(email)=$1", [EMP]);
  await db.query("DELETE FROM employees WHERE lower(work_email)=$1", [EMP]);
  await db.query("DELETE FROM access_grants WHERE lower(email)=ANY($1) AND note='flow-test'", [[EMP, HR]]);
  await db.query("DELETE FROM notifications WHERE lower(recipient)=ANY($1)", [[EMP, HR]]);
  await db.query("DELETE FROM audit_log WHERE lower(work_email)=ANY($1) OR action LIKE $2", [[EMP, HR], `%${SHIFT}%`]);
  await db.query("DELETE FROM sessions WHERE lower(email)=ANY($1)", [[EMP, HR]]);
  await db.query("DELETE FROM users WHERE lower(email)=ANY($1)", [[EMP, HR]]);
};
try {
  await clean();
  const { rows: [emp] } = await db.query("INSERT INTO employees (work_email, name, start_date, status) VALUES ($1,'Test Shift Employee','2020-01-01','active') RETURNING id", [EMP]);
  const e = await login(EMP), hr = await login(HR, ["shifts.manage", "overtime.approve", "attendance.view", "attendance.edit"]);

  // --- Shifts
  let r = await call(e, "POST", "/api/shifts", { name: SHIFT, start: "07:00", end: "16:00" });
  ok("an employee cannot create a shift", r.status === 403, String(r.status));
  r = await call(hr, "POST", "/api/shifts", { name: SHIFT, start: "16:00", end: "07:00" });
  ok("a shift that ends before it starts is refused", r.status === 400 && r.data.errors.end, JSON.stringify(r.data));
  r = await call(hr, "POST", "/api/shifts", { name: SHIFT, start: "07:00", end: "16:00", graceMinutes: 15, weeklyOffs: [0] });
  ok("HR creates a shift", r.status === 201 && r.data.weeklyOffs.join() === "0", JSON.stringify(r.data));
  const shiftId = r.data.id;
  r = await call(hr, "POST", "/api/shifts", { name: SHIFT, start: "08:00", end: "17:00" });
  ok("two shifts cannot share a name", r.status === 409, String(r.status));
  r = await call(e, "GET", "/api/shifts");
  ok("everyone can read the shifts, with the default one first", r.status === 200 && r.data.shifts[0].isDefault && r.data.shifts.some((s) => s.name === SHIFT) && r.data.canManage === false);

  // --- Roster: on the early shift from Monday 2 to Friday 6 November
  r = await call(hr, "POST", "/api/shifts/roster", { emails: [EMP], shiftId, from: "2026-11-02", to: "2026-11-06" });
  ok("HR puts the person on the shift for a week", r.status === 201 && r.data.added === 1, JSON.stringify(r.data));
  r = await call(hr, "POST", "/api/shifts/roster", { emails: ["nobody.here@wohlig.com"], shiftId, from: "2026-11-02" });
  ok("someone with no employee record cannot be rostered", r.status === 400 && r.data.errors.emails);
  r = await call(hr, "GET", "/api/shifts/roster?month=2026-11");
  ok("the roster for November lists them", r.data.entries.some((x) => x.person.email.toLowerCase() === EMP && x.shift.name === SHIFT));

  // --- Punches: Tue 3 Nov on the early shift (7:20 to 17:30: late by 20 minutes, 70 minutes of overtime), Mon 9 Nov on the default (9:30 to 19:15: 45 minutes)
  for (const [day, time, dir] of [["2026-11-03", "07:20", "IN"], ["2026-11-03", "17:30", "OUT"], ["2026-11-09", "09:30", "IN"], ["2026-11-09", "19:15", "OUT"]])
    await db.query("INSERT INTO attendance_punches (employee_id, work_date, punch_time, direction, source, created_by) VALUES ($1,$2,$3,$4,'web',$5)", [emp.id, day, time, dir, EMP]);
  r = await call(e, "GET", "/api/attendance/month?month=2026-11");
  const d3 = r.data.days.find((d) => d.date === "2026-11-03"), d9 = r.data.days.find((d) => d.date === "2026-11-09"), d7 = r.data.days.find((d) => d.date === "2026-11-07");
  ok("3 November is on the early shift, late by 20 minutes, with 70 minutes of overtime", d3.shift.name === SHIFT && d3.late && d3.lateBy === 20 && d3.overtimeMinutes === 70, JSON.stringify(d3));
  ok("9 November is back on the default shift, on time, with 45 minutes of overtime", d9.shift.isDefault && !d9.late && d9.overtimeMinutes === 45, JSON.stringify(d9));
  ok("Saturday 7 November is a weekly day off again on the default shift", d7.off === "Weekend", JSON.stringify(d7 && d7.off));
  ok("the month counts one late arrival and 115 minutes of overtime", r.data.summary.late === 1 && r.data.summary.overtimeMinutes === 115, JSON.stringify(r.data.summary));
  r = await call(hr, "GET", "/api/attendance/day?date=2026-11-03");
  const p3 = r.data.people.find((x) => x.email.toLowerCase() === EMP);
  ok("HR's day view shows the shift and the late mark", p3 && p3.shift.name === SHIFT && p3.late === true, JSON.stringify(p3));

  // --- Overtime: only for staff marked as paid overtime
  r = await call(hr, "GET", "/api/overtime?month=2026-11");
  ok("not on the paid list: not in the overtime list", r.status === 200 && !r.data.people.some((x) => x.person.email.toLowerCase() === EMP));
  r = await call(e, "PUT", "/api/overtime/staff", { email: EMP, eligible: true });
  ok("an employee cannot add themselves to the paid list", r.status === 403);
  r = await call(hr, "PUT", "/api/overtime/staff", { email: EMP, eligible: true });
  ok("HR adds them to the staff paid overtime", r.status === 200);
  r = await call(hr, "GET", "/api/overtime?month=2026-11");
  const row = r.data.people.find((x) => x.person.email.toLowerCase() === EMP);
  ok("their November overtime is worked out from punches: 115 minutes on 2 days", row && row.overtimeMinutes === 115 && row.days.length === 2 && !row.decision, JSON.stringify(row));
  r = await call(e, "PUT", `/api/overtime/${EMP}/2026-11`, { decision: "approved" });
  ok("nobody approves their own overtime", r.status === 403, String(r.status));
  r = await call(hr, "PUT", `/api/overtime/${EMP}/2026-11`, { decision: "approved", hours: "1" });
  ok("approving fewer hours needs a reason", r.status === 400 && r.data.errors.note);
  r = await call(hr, "PUT", `/api/overtime/${EMP}/2099-01`, { decision: "approved" });
  ok("a future month cannot be decided", r.status === 400);
  r = await call(hr, "PUT", `/api/overtime/${EMP}/2026-11`, { decision: "approved" });
  ok("HR approves the hours worked out", r.status === 200 && r.data.decision.status === "approved" && r.data.decision.approvedMinutes === 115, JSON.stringify(r.data && r.data.decision));
  r = await call(e, "GET", "/api/overtime/mine?month=2026-11");
  ok("the person sees their approved overtime", r.data.eligible && r.data.decision.approvedMinutes === 115);
  const { rows: told } = await db.query("SELECT title FROM notifications WHERE lower(recipient)=$1", [EMP]);
  ok("and was told in the app", told.some((t) => /overtime for 2026-11 was approved/.test(t.title)), JSON.stringify(told));

  // --- Payroll shows the approved hours, and pays nothing by itself
  const { buildLines } = await import("../src/payroll/store.js");
  const { payPool, pool } = await import("../src/db.js");
  await db.query("INSERT INTO salary_structures (work_email, effective_from, earnings, professional_tax, updated_by) VALUES ($1,'2026-01',$2,0,'test')", [EMP, JSON.stringify([{ name: "Basic", amount: 30000 }])]);
  const line = (await buildLines(payPool, "2026-11")).find((x) => x.email.toLowerCase() === EMP);
  ok("payroll's November line shows the 115 approved minutes", line && line.slip.overtime && line.slip.overtime.approvedMinutes === 115, JSON.stringify(line && line.slip.overtime));
  ok("but adds no overtime pay until HR enters an amount", line && line.slip.summary.gross === 30000 && line.slip.warnings.some((w) => /overtime was approved/.test(w)), JSON.stringify(line && line.slip.summary));
  await db.query("DELETE FROM salary_structures WHERE lower(work_email)=$1", [EMP]);
  await payPool.end().catch(() => {}); if (pool !== payPool) await pool.end().catch(() => {});

  // --- The report and retiring a shift
  r = await call(hr, "GET", "/api/attendance/report?month=2026-11&format=csv");
  ok("the attendance report has late arrivals and overtime", r.status === 200 && (typeof r.data === "string" && /Late arrivals/.test(r.data) && /Overtime hours/.test(r.data)), String(r.status));
  r = await call(hr, "POST", "/api/shifts/roster", { emails: [EMP], shiftId, from: "2099-01-01" });
  r = await call(hr, "DELETE", `/api/shifts/${shiftId}`);
  ok("a shift someone is still rostered on cannot be retired", r.status === 409, String(r.status));
  const { rows: entries } = await db.query("SELECT id FROM shift_assignments WHERE lower(email)=$1", [EMP]);
  for (const x of entries) await call(hr, "DELETE", `/api/shifts/roster/${x.id}`);
  r = await call(hr, "DELETE", `/api/shifts/${shiftId}`);
  ok("once nobody is on it, it is retired", r.status === 200, String(r.status));
  r = await call(hr, "GET", "/api/shifts");
  ok("and no longer listed", !r.data.shifts.some((s) => s.name === SHIFT));
} catch (err) { fail++; console.log("ERROR  " + err.stack); }
finally {
  await clean();
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
