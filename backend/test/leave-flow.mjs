/*
 * Leave: approver comments, HR balance corrections and the policy numbers, against a LOCAL server and a LOCAL database (never the shared one).
 *
 *   DATABASE_URL=postgresql://postgres:x@localhost:55434/postgres BASE=http://localhost:3190 node test/leave-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server). It removes its test rows afterwards.
 */
import crypto from "node:crypto";
import pg from "pg";
import L from "../../frontend/leave-rules.cjs";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3190";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB) || !/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: a local database and a local server only."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB }), sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const HR = "test.leave.admin@wohlig.com", EMP = "test.leave.employee@wohlig.com", EMP2 = "test.leave.employee.two@wohlig.com";   // clearly named test people; a local server sends no email
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
const login = async (email, superAdmin = false) => {
  await db.query("INSERT INTO users (email, password_hash, role, is_super_admin) VALUES ($1,'x',$2,$3) ON CONFLICT DO NOTHING", [email, superAdmin ? "hr" : "employee", superAdmin]);
  const t = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(t), email]);
  return t;
};
const call = async (tok, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${tok}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, d: await r.json().catch(() => null) };
};
const balanceOf = async (tok, email) => {
  const g = (await call(tok, "GET", "/api/leave")).d, p = g.pay.find((x) => x.email === email);
  const b = L.balances(Number(g.today.slice(0, 4)), { start: p.start, casualOpening: p.casualOpening, openings: p.openings }, g.requests.filter((r) => r.email === email), g.compOffs.filter((c) => c.email === email));
  return { b, g };
};

try {
  for (const e of [HR, EMP, EMP2]) await db.query("DELETE FROM employees WHERE work_email=$1", [e]);
  await db.query("INSERT INTO employees (emp_no, name, work_email, title, start_date, status, onboarded_at, manager_email, leave_opening) VALUES ('T/1','Test Leave Admin',$1,'HR','2020-01-01','active',now(),NULL,NULL),('T/2','Test Leave Employee',$2,'Dev','2022-01-01','active',now(),$1,$3),('T/3','Test Leave Employee Two',$4,'Dev','2022-01-01','active',now(),$1,NULL)",
    [HR, EMP, JSON.stringify({ asOf: "2026-11-23", casual: 5, sick: 2, compoff: 1, casualQuota: 12, casualUsed: 7, sickQuota: 6, sickUsed: 4, compoffUsed: 0 }), EMP2]);
  const hr = await login(HR, true), emp = await login(EMP), emp2 = await login(EMP2);

  // ---- the approver's comment ----
  let r = await call(emp, "POST", "/api/leave/requests", { type: "casual", from: "2026-12-07", to: "2026-12-08", reason: "Trip", split: false });
  ok("an employee applies for leave", r.s === 201, JSON.stringify(r.d));
  const id1 = r.d.id || (r.d.requests && r.d.requests[0].id);
  r = await call(hr, "POST", `/api/leave/requests/${id1}/decision`, { decision: "declined" });
  ok("declining without a reason is refused (400)", r.s === 400 && /reason/i.test(r.d.error), JSON.stringify(r.d));
  r = await call(hr, "POST", `/api/leave/requests/${id1}/decision`, { decision: "declined", note: "Release week, please pick another date." });
  ok("declining with a reason works", r.s === 200 && r.d.status === "declined" && r.d.note === "Release week, please pick another date.", JSON.stringify(r.d));
  let g = (await call(emp, "GET", "/api/leave")).d;
  ok("the employee sees the reason", g.requests.find((x) => x.id === id1).note === "Release week, please pick another date.");
  ok("a declined request takes nothing off the balance", (await balanceOf(emp, EMP)).b.casual.left === 5);
  r = await call(emp, "POST", "/api/leave/requests", { type: "casual", from: "2026-12-09", to: "2026-12-10", reason: "Trip 2", split: false });
  const id2 = r.d.id || (r.d.requests && r.d.requests[0].id);
  r = await call(hr, "POST", `/api/leave/requests/${id2}/decision`, { decision: "approved", note: "Enjoy, please hand over first." });
  ok("approving with a comment works and the comment is kept", r.s === 200 && r.d.status === "approved" && r.d.note === "Enjoy, please hand over first.", JSON.stringify(r.d));
  ok("an approval takes its days off the brought-over balance (5 - 2 = 3)", (await balanceOf(emp, EMP)).b.casual.left === 3);
  r = await call(emp, "POST", "/api/leave/requests", { type: "casual", from: "2026-12-14", to: "2026-12-14", reason: "x", split: false });
  const id3 = r.d.id || (r.d.requests && r.d.requests[0].id);
  ok("an employee cannot decide leave (403)", (await call(emp, "POST", `/api/leave/requests/${id3}/decision`, { decision: "approved" })).s === 403);
  r = await call(hr, "POST", `/api/leave/requests/${id3}/decision`, { decision: "approved" });
  ok("approving with no comment is fine (note stays empty)", r.s === 200 && r.d.note === null);

  // ---- HR corrects balances ----
  const before = (await balanceOf(hr, EMP)).b;   // casual 5 - 3 days approved after the date = 2; sick 2; comp off 1
  ok("before the correction: casual 2, sick 2, comp off 1", before.casual.left === 2 && before.sick.left === 2 && before.compoff.left === 1, JSON.stringify([before.casual.left, before.sick.left, before.compoff.left]));
  ok("an employee cannot correct balances (403)", (await call(emp, "PUT", `/api/leave/balances/${EMP}`, { casual: 20, reason: "mine" })).s === 403);
  ok("a correction needs a reason (400)", (await call(hr, "PUT", `/api/leave/balances/${EMP}`, { casual: 6 })).s === 400);
  ok("a correction needs a change (400)", (await call(hr, "PUT", `/api/leave/balances/${EMP}`, { reason: "x" })).s === 400);
  ok("a figure that is not days is refused (400)", (await call(hr, "PUT", `/api/leave/balances/${EMP}`, { casual: -1, reason: "x" })).s === 400);
  r = await call(hr, "PUT", `/api/leave/balances/${EMP}`, { casual: 6, sick: 3, reason: "Two days missed from the old system" });
  ok("HR corrects casual and sick", r.s === 200 && r.d.changed === true, JSON.stringify(r.d));
  let after = (await balanceOf(hr, EMP)).b;
  ok("the balances are now what HR entered (casual 6, sick 3), comp off untouched", after.casual.left === 6 && after.sick.left === 3 && after.compoff.left === 1, JSON.stringify([after.casual.left, after.sick.left, after.compoff.left]));
  ok("the page figures stay consistent: carried + quota - used = left", Math.abs(after.casual.carried + after.casual.quota - after.casual.used - after.casual.left) < 1e-9);
  ok("a correction with the same figures changes nothing", (await call(hr, "PUT", `/api/leave/balances/${EMP}`, { casual: 6, reason: "again" })).d.changed === false);
  r = await call(emp, "POST", "/api/leave/requests", { type: "sick", from: "2026-12-22", to: "2026-12-22", reason: "Unwell", split: false });
  const id4 = r.d.id || (r.d.requests && r.d.requests[0].id);
  await call(hr, "POST", `/api/leave/requests/${id4}/decision`, { decision: "approved" });
  ok("leave after a correction comes off the corrected balance (sick 3 - 1 = 2)", (await balanceOf(hr, EMP)).b.sick.left === 2);
  const log = (await db.query("SELECT action FROM audit_log WHERE work_email=$1 ORDER BY id", [EMP])).rows.map((x) => x.action).join("\n");
  ok("the audit log names who corrected what and why", /Leave balance corrected by test\.leave\.admin@wohlig\.com: casual 2 → 6, sick 2 → 3\. Reason: Two days missed from the old system/.test(log), log);
  ok("the audit log keeps the decline reason and the approval comment", /Reason: Release week/.test(log) && /Comment: Enjoy, please hand over first\./.test(log));
  // someone with nothing brought over can be corrected too
  r = await call(hr, "PUT", `/api/leave/balances/${EMP2}`, { casual: 9, reason: "Opening figure from the old sheet" });
  const fresh = (await balanceOf(hr, EMP2)).b;
  ok("a person with no brought-over figures can be corrected (casual 9; sick stays at the policy figure)", r.s === 200 && fresh.casual.left === 9 && fresh.sick.left === L.POLICY.sickPerYear, JSON.stringify([r.s, fresh.casual.left, fresh.sick.left]));

  // ---- policy numbers ----
  ok("anyone signed in can read the policy", (await call(emp, "GET", "/api/leave/policy")).d.policy.casualPerYear === L.POLICY.casualPerYear);
  ok("an employee cannot change the policy (403)", (await call(emp, "PUT", "/api/leave/policy", { casualPerYear: 30 })).s === 403);
  ok("an out-of-range policy figure is refused (400)", (await call(hr, "PUT", "/api/leave/policy", { casualPerYear: 99 })).s === 400);
  ok("a figure that is not in half days is refused (400)", (await call(hr, "PUT", "/api/leave/policy", { sickPerYear: 6.3 })).s === 400);
  const was = (await call(hr, "GET", "/api/leave/policy")).d.policy;
  r = await call(hr, "PUT", "/api/leave/policy", { casualPerYear: 10, sickPerYear: 7 });
  ok("HR saves new policy numbers", r.s === 200 && r.d.changed && r.d.policy.casualPerYear === 10 && r.d.policy.sickPerYear === 7, JSON.stringify(r.d));
  ok("they are stored in the database", (await db.query("SELECT key, value::float AS v FROM leave_policy ORDER BY key")).rows.map((x) => `${x.key}=${x.v}`).join() === "casualPerYear=10,sickPerYear=7");
  ok("the pages get them from /leave-rules.js", /Object\.assign\(window\.LeaveRules\.POLICY, \{[^}]*"casualPerYear":10/.test(await (await fetch(BASE + "/leave-rules.js")).text()));
  ok("the leave data carries them too", (await call(emp, "GET", "/api/leave")).d.policy.casualPerYear === 10);
  ok("the audit log records the policy change", (await db.query("SELECT 1 FROM audit_log WHERE action LIKE 'Leave policy changed by test.leave.admin@wohlig.com: casualPerYear % → 10%'")).rowCount === 1);
  ok("saving the same numbers changes nothing", (await call(hr, "PUT", "/api/leave/policy", { casualPerYear: 10 })).d.changed === false);
  await call(hr, "PUT", "/api/leave/policy", { casualPerYear: was.casualPerYear, sickPerYear: was.sickPerYear });
  ok("and the numbers can be put back", (await call(hr, "GET", "/api/leave/policy")).d.policy.casualPerYear === was.casualPerYear);
} catch (e) { fail++; console.log("ERROR  " + e.stack); }
finally {
  await db.query("DELETE FROM leave_requests WHERE lower(work_email) IN ($1,$2,$3)", [HR, EMP, EMP2]);
  await db.query("DELETE FROM leave_policy");
  await db.query("DELETE FROM audit_log WHERE work_email IN ($1,$2,$3) OR action LIKE 'Leave policy changed by test.leave.admin%'", [HR, EMP, EMP2]);
  await db.query("DELETE FROM sessions WHERE lower(email) IN ($1,$2,$3)", [HR, EMP, EMP2]);
  await db.query("DELETE FROM employees WHERE work_email IN ($1,$2,$3)", [HR, EMP, EMP2]);
  await db.query("DELETE FROM users WHERE email IN ($1,$2,$3)", [HR, EMP, EMP2]);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
