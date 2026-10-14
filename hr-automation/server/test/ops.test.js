// Runs against the local database. Test employees are named "TEST ..." and removed at the end.
// Audit rows are never deleted (the database forbids it), so they remain as a record of the tests.
process.env.STUB_FAIL = "github"; // github always fails in these tests, to exercise the failure path
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool, withTx } from "../src/db.js";
import * as ops from "../src/ops.js";

const ADMIN = "test-admin@wohlig.com";
const VIEWER = "test-viewer@wohlig.com";
const created = [];

async function makeEmployee(name, status, grantStatus) {
  const { rows: [e] } = await pool.query(
    `INSERT INTO employees (full_name, work_email, department, start_date, status)
     VALUES ($1, $2, 'Engineering', '2026-10-01', $3) RETURNING id`,
    [`TEST ${name}`, `test.${name.toLowerCase().replace(/\s+/g, ".")}.${Date.now()}@example.com`, status]);
  created.push(e.id);
  for (const app of ["gws", "gemini", "claude", "github"]) {
    await pool.query("INSERT INTO access_grants (employee_id, app_code, status) VALUES ($1,$2,$3)", [e.id, app, grantStatus]);
  }
  return e.id;
}

before(async () => {
  await pool.query("INSERT INTO hr_users (email, role) VALUES ($1,'admin'),($2,'viewer') ON CONFLICT DO NOTHING", [ADMIN, VIEWER]);
});

after(async () => {
  for (const id of created) {
    await pool.query("DELETE FROM checklist_items WHERE employee_id=$1", [id]);
    await pool.query("DELETE FROM access_grants WHERE employee_id=$1", [id]);
    await pool.query("DELETE FROM employees WHERE id=$1", [id]);
  }
  await pool.query("DELETE FROM hr_users WHERE email = ANY($1)", [[ADMIN, VIEWER]]);
  await pool.end();
});

test("a viewer cannot confirm onboarding", async () => {
  const id = await makeEmployee("Viewer Try", "onboarding", "none");
  await assert.rejects(() => ops.confirmOnboarding({ actor: VIEWER, employeeId: id }), /cannot do this/);
  const { rows } = await pool.query("SELECT count(*)::int n FROM access_grants WHERE employee_id=$1 AND status='none'", [id]);
  assert.equal(rows[0].n, 4, "nothing was granted");
});

test("a person not in hr_users is refused", async () => {
  const id = await makeEmployee("Stranger", "onboarding", "none");
  await assert.rejects(() => ops.confirmOnboarding({ actor: "nobody@wohlig.com", employeeId: id }), /can view only/);
});

test("failed tool stays failed and the joiner is not closed", async () => {
  const id = await makeEmployee("Joiner Fail", "onboarding", "none");
  const results = await ops.confirmOnboarding({ actor: ADMIN, employeeId: id });
  const gh = results.find((r) => r.app === "github");
  assert.equal(gh.status, "failed");
  assert.match(gh.error, /simulated failure/);
  const emp = await ops.getEmployee(id);
  assert.equal(emp.status, "onboarding");
  assert.equal(emp.grants.find((g) => g.app_code === "github").status, "failed");
});

test("joiner closes to active only after every tool and checklist item is done", async () => {
  const id = await makeEmployee("Joiner Clean", "onboarding", "none");
  await pool.query("UPDATE access_grants SET status='active' WHERE employee_id=$1", [id]); // assume the failing github is fixed for this case
  await pool.query("INSERT INTO checklist_items (employee_id, phase, title) VALUES ($1,'onboarding','Laptop issued'),($1,'onboarding','ID card issued')", [id]);
  const { rows: items } = await pool.query("SELECT id FROM checklist_items WHERE employee_id=$1 ORDER BY id", [id]);
  await ops.tickChecklist({ actor: ADMIN, itemId: items[0].id, done: true });
  assert.equal((await ops.getEmployee(id)).status, "onboarding", "one item still open");
  await ops.tickChecklist({ actor: ADMIN, itemId: items[1].id, done: true });
  assert.equal((await ops.getEmployee(id)).status, "active");
});

test("offboarding suspends Google first and removes every other tool", async () => {
  const id = await makeEmployee("Leaver", "active", "active");
  const results = await ops.offboard({ actor: ADMIN, employeeId: id, nominee: "Manager" });
  assert.equal(results[0].app, "gws", "Google goes first");
  assert.equal(results.find((r) => r.app === "github").status, "failed", "github failure is flagged, not hidden");
  const emp = await ops.getEmployee(id);
  assert.equal(emp.status, "offboarding", "not offboarded while a tool failed and checklist is open");
  assert.equal(emp.grants.find((g) => g.app_code === "gemini").status, "revoked");
  assert.equal(emp.checklist.filter((c) => c.phase === "offboarding").length, 4);
});

test("audit rows cannot be changed or deleted", async () => {
  await assert.rejects(() => pool.query("UPDATE audit_log SET result='ok' WHERE id=(SELECT min(id) FROM audit_log)"), /append-only/);
  await assert.rejects(() => pool.query("DELETE FROM audit_log WHERE id=(SELECT min(id) FROM audit_log)"), /append-only/);
});

test("audit hash chain verifies", async () => {
  const res = await ops.checkAudit();
  assert.equal(res.ok, true, `chain broken at ${res.brokenAt}`);
});

test("a tool that still shows access after removal is a failure, not a success", async () => {
  const id = await makeEmployee("Leaver Leak", "active", "active");
  process.env.STUB_LEAK = "gemini";
  try {
    const results = await ops.offboard({ actor: ADMIN, employeeId: id });
    const gem = results.find((r) => r.app === "gemini");
    assert.equal(gem.status, "failed");
    assert.match(gem.error, /still present/);
  } finally {
    delete process.env.STUB_LEAK;
  }
  assert.equal((await ops.getEmployee(id)).status, "offboarding", "case stays open while access remains");
});

test("offboarding closes only when every tool is removed and every item is ticked", async () => {
  const id = await makeEmployee("Leaver Clean", "active", "active");
  await pool.query("UPDATE access_grants SET status='revoked' WHERE employee_id=$1", [id]); // all tools already confirmed gone
  await pool.query("UPDATE employees SET status='offboarding' WHERE id=$1", [id]);
  await pool.query("INSERT INTO checklist_items (employee_id, phase, title) VALUES ($1,'offboarding','Laptop returned'),($1,'offboarding','ID card returned')", [id]);
  const { rows: items } = await pool.query("SELECT id FROM checklist_items WHERE employee_id=$1 ORDER BY id", [id]);
  await ops.tickChecklist({ actor: ADMIN, itemId: items[0].id, done: true });
  assert.equal((await ops.getEmployee(id)).status, "offboarding", "one item still open");
  await ops.tickChecklist({ actor: ADMIN, itemId: items[1].id, done: true });
  assert.equal((await ops.getEmployee(id)).status, "offboarded");
});

test("a failed tool blocks closing even when the checklist is complete", async () => {
  const id = await makeEmployee("Leaver Blocked", "active", "active");
  await pool.query("UPDATE access_grants SET status='revoked' WHERE employee_id=$1 AND app_code<>'github'", [id]);
  await pool.query("UPDATE access_grants SET status='failed', error='x' WHERE employee_id=$1 AND app_code='github'", [id]);
  await pool.query("UPDATE employees SET status='offboarding' WHERE id=$1", [id]);
  await pool.query("INSERT INTO checklist_items (employee_id, phase, title, done) VALUES ($1,'offboarding','Laptop returned', false)", [id]);
  const { rows: [item] } = await pool.query("SELECT id FROM checklist_items WHERE employee_id=$1", [id]);
  await ops.tickChecklist({ actor: ADMIN, itemId: item.id, done: true });
  assert.equal((await ops.getEmployee(id)).status, "offboarding", "github still open, so the case stays open");
});

test("nightly check finds leftover access and reopens the case", async () => {
  const id = await makeEmployee("Leaver Reopened", "offboarded", "revoked");
  process.env.STUB_LEAK = "claude";
  let res;
  try {
    res = await ops.reconcileOffboarded({ actor: "system" });
  } finally {
    delete process.env.STUB_LEAK;
  }
  assert.ok(res.leftovers.some((l) => l.employee_id === id && l.app === "claude"), "leftover reported");
  const emp = await ops.getEmployee(id);
  assert.equal(emp.status, "offboarding", "closed case is reopened");
  assert.equal(emp.grants.find((g) => g.app_code === "claude").status, "failed");
});

test("nightly check is clean when nothing is left open", async () => {
  const id = await makeEmployee("Leaver Fine", "offboarded", "revoked");
  const res = await ops.reconcileOffboarded({ actor: "system" });
  assert.ok(!res.leftovers.some((l) => l.employee_id === id));
});

test("a viewer cannot run the nightly check", async () => {
  await assert.rejects(() => ops.reconcileOffboarded({ actor: VIEWER }), /cannot do this/);
});

test("an active employee cannot be onboarded again", async () => {
  const id = await makeEmployee("Already Active", "active", "active");
  await assert.rejects(() => ops.confirmOnboarding({ actor: ADMIN, employeeId: id }), /nothing to onboard/);
  const emp = await ops.getEmployee(id);
  assert.ok(emp.grants.every((g) => g.status === "active"), "no grant was touched");
});

test("a tool that keeps failing stops after 3 attempts and is flagged for manual action", async () => {
  const id = await makeEmployee("Retry Cap", "onboarding", "none");
  for (let i = 1; i <= 3; i++) {
    const r = await ops.confirmOnboarding({ actor: ADMIN, employeeId: id });
    assert.equal(r.find((x) => x.app === "github").status, "failed", `attempt ${i} fails`);
  }
  const fourth = await ops.confirmOnboarding({ actor: ADMIN, employeeId: id });
  const gh = fourth.find((x) => x.app === "github");
  assert.equal(gh.status, "needs_manual");
  const { rows: [g] } = await pool.query("SELECT attempts FROM access_grants WHERE employee_id=$1 AND app_code='github'", [id]);
  assert.equal(g.attempts, 3, "no fourth call to the tool was made");
});

test("emergency stop blocks every automatic change and resume restores it", async () => {
  const joiner = await makeEmployee("Paused Joiner", "onboarding", "none");
  const leaver = await makeEmployee("Paused Leaver", "active", "active");
  await ops.setPaused({ actor: ADMIN, paused: true });
  try {
    await assert.rejects(() => ops.confirmOnboarding({ actor: ADMIN, employeeId: joiner }), /paused/);
    await assert.rejects(() => ops.offboard({ actor: ADMIN, employeeId: leaver }), /paused/);
    const emp = await ops.getEmployee(leaver);
    assert.ok(emp.grants.every((g) => g.status === "active"), "leaver's access untouched while paused");
    assert.equal((await ops.getPaused()).paused, true);
  } finally {
    await ops.setPaused({ actor: ADMIN, paused: false });
  }
  assert.equal((await ops.getPaused()).paused, false);
  const r = await ops.confirmOnboarding({ actor: ADMIN, employeeId: joiner });
  assert.ok(r.length > 0, "works again after resume");
});

test("a viewer cannot pause automation", async () => {
  await assert.rejects(() => ops.setPaused({ actor: VIEWER, paused: true }), /cannot do this/);
  assert.equal((await ops.getPaused()).paused, false);
});

test("test directory: an account is active after grant and not active after removal", async () => {
  const { grant, revoke, check } = await import("../src/connectors.js");
  const emp = { id: 9999, work_email: `test.directory.${Date.now()}@example.com` };
  await grant("gws", emp);
  assert.equal(await check("gws", emp), true, "active after grant");
  await revoke("gws", emp);
  assert.equal(await check("gws", emp), false, "not active after suspension");
});

test("scheduled leaving: future date does nothing, past date offboards on the day", async () => {
  const id = await makeEmployee("Scheduled Leaver", "active", "active");
  await ops.scheduleLeaving({ actor: ADMIN, employeeId: id, lastDay: "2099-01-01" });
  let res = await ops.runScheduledOffboarding({ today: "2026-10-14" });
  assert.ok(!res.offboarded.some((x) => x.employee_id === id), "not offboarded before its date");
  assert.equal((await ops.getEmployee(id)).status, "active");

  await ops.scheduleLeaving({ actor: ADMIN, employeeId: id, lastDay: "2026-10-13" });
  res = await ops.runScheduledOffboarding({ today: "2026-10-14" });
  assert.ok(res.offboarded.some((x) => x.employee_id === id), "offboarded once its date has passed");
  assert.equal((await ops.getEmployee(id)).status, "offboarding");
});

test("scheduled leaving is refused for a person who is not active", async () => {
  const id = await makeEmployee("Not Active Yet", "onboarding", "none");
  await assert.rejects(() => ops.scheduleLeaving({ actor: ADMIN, employeeId: id, lastDay: "2026-10-20" }), /only active people/);
});

test("the emergency stop blocks the daily offboarding job", async () => {
  const id = await makeEmployee("Paused Scheduled", "active", "active");
  await ops.scheduleLeaving({ actor: ADMIN, employeeId: id, lastDay: "2026-10-01" });
  await ops.setPaused({ actor: ADMIN, paused: true });
  try {
    const res = await ops.runScheduledOffboarding({ today: "2026-10-14" });
    assert.match(res.skipped, /paused/);
    assert.equal((await ops.getEmployee(id)).status, "active", "nothing changed while paused");
  } finally {
    await ops.setPaused({ actor: ADMIN, paused: false });
  }
});

test("creating a joiner with an email already in use is refused", async () => {
  const email = `test.dup.${Date.now()}@wohlig.com`;
  const first = await ops.createEmployee({ actor: ADMIN, fullName: "TEST Dup One", workEmail: email, department: "Engineering", startDate: "2026-10-26" });
  created.push(first.id);
  await assert.rejects(() => ops.createEmployee({ actor: ADMIN, fullName: "TEST Dup Two", workEmail: email, department: "Engineering", startDate: "2026-10-26" }), /already exists/);
});

test("a viewer cannot tick a checklist item", async () => {
  const id = await makeEmployee("Tick Viewer", "onboarding", "none");
  await pool.query("INSERT INTO checklist_items (employee_id, phase, title) VALUES ($1,'onboarding','Laptop issued')", [id]);
  const { rows: [item] } = await pool.query("SELECT id FROM checklist_items WHERE employee_id=$1", [id]);
  await assert.rejects(() => ops.tickChecklist({ actor: VIEWER, itemId: item.id, done: true }), /cannot do this/);
});

test("audit view shows plain tool names and hides test entries", async () => {
  const id = await makeEmployee("Label Check", "onboarding", "none");
  await ops.confirmOnboarding({ actor: ADMIN, employeeId: id });
  const { rows } = await pool.query("SELECT action FROM audit_log WHERE employee_id=$1 ORDER BY id", [id]);
  assert.ok(rows.some((r) => r.action === "Google Workspace access granted"), "plain name in the log");
  const visible = await ops.listAudit({ limit: 500 });
  assert.ok(!visible.some((r) => r.actor.startsWith("test-")), "test actors hidden");
  assert.ok(!visible.some((r) => /^TEST /.test(r.employee ?? "")), "test employees hidden");
});

test("only @wohlig.com accounts can use the system", async () => {
  await pool.query("INSERT INTO hr_users (email, role) VALUES ('outsider@gmail.com','admin') ON CONFLICT DO NOTHING");
  try {
    await assert.rejects(() => ops.confirmOnboarding({ actor: "outsider@gmail.com", employeeId: 1 }), /only @wohlig.com accounts/);
    const id = await makeEmployee("Domain Check", "onboarding", "none");
    await assert.rejects(() => ops.createEmployee({ actor: ADMIN, fullName: "TEST Outside", workEmail: "someone@gmail.com", department: "Engineering", startDate: "2026-10-26" }), /must end in @wohlig.com/);
    assert.ok(id);
  } finally {
    await pool.query("DELETE FROM hr_users WHERE email='outsider@gmail.com'");
  }
});

test("an IT admin can tick checklist items and change access", async () => {
  const IT = "test-it@wohlig.com";
  await pool.query("INSERT INTO hr_users (email, role) VALUES ($1,'it') ON CONFLICT (email) DO UPDATE SET role='it'", [IT]);
  const id = await makeEmployee("IT Ticks", "onboarding", "none");
  await pool.query("INSERT INTO checklist_items (employee_id, phase, title) VALUES ($1,'onboarding','Laptop issued')", [id]);
  const { rows: [item] } = await pool.query("SELECT id FROM checklist_items WHERE employee_id=$1", [id]);
  await ops.tickChecklist({ actor: IT, itemId: item.id, done: true });
  const r = await ops.confirmOnboarding({ actor: IT, employeeId: id });
  assert.ok(r.length > 0, "IT admin can change access");
});

test("roles: HR and IT are admins; any other Wohlig person can view; outsiders are refused", async () => {
  assert.equal(await ops.requireStaff(ADMIN), "admin");
  assert.equal(await ops.requireStaff("nobody@wohlig.com"), "employee");
  await assert.rejects(() => ops.requireStaff("someone@gmail.com"), /only @wohlig.com/);
});

test("an employee can view but cannot edit", async () => {
  const EMP = "plain.employee@wohlig.com";
  assert.equal(await ops.requireStaff(EMP), "employee");
  const id = await makeEmployee("Employee Edit Try", "onboarding", "none");
  await assert.rejects(() => ops.confirmOnboarding({ actor: EMP, employeeId: id }), /can view only/);
  await assert.rejects(() => ops.offboard({ actor: EMP, employeeId: id }), /can view only/);
  await assert.rejects(() => ops.setPaused({ actor: EMP, paused: true }), /cannot do this/);
});

test("sign-in: right password works, wrong password is refused, five wrong tries lock the account", async () => {
  const { setPassword, signIn, emailForSession, signOut } = await import("../src/auth.js");
  const who = "test-signin@wohlig.com";
  await setPassword({ actor: ADMIN, email: who, password: "correct-horse-1" });
  await assert.rejects(() => signIn(who, "wrong-password-x"), /not correct/);
  const ok = await signIn(who, "correct-horse-1");
  assert.equal(await emailForSession(ok.session), who);
  await signOut(ok.session);
  await assert.rejects(() => emailForSession(ok.session), /sign in again/);
  for (let i = 0; i < 4; i++) await assert.rejects(() => signIn(who, "nope-nope-nope"), /not correct/);
  await assert.rejects(() => signIn(who, "nope-nope-nope"), /not correct/);
  await assert.rejects(() => signIn(who, "correct-horse-1"), /Too many wrong attempts/);
  await pool.query("DELETE FROM accounts WHERE email=$1", [who]);
});

test("sign-in: outsiders are refused and passwords are never stored in plain text", async () => {
  const { signIn, setPassword } = await import("../src/auth.js");
  await assert.rejects(() => signIn("someone@gmail.com", "anything-long"), /not correct/);
  await assert.rejects(() => setPassword({ actor: ADMIN, email: "x@wohlig.com", password: "short" }), /at least 10/);
  const who = "test-hash@wohlig.com";
  await setPassword({ actor: ADMIN, email: who, password: "plain-text-check-1" });
  const { rows: [a] } = await pool.query("SELECT password_hash FROM accounts WHERE email=$1", [who]);
  assert.ok(a.password_hash.startsWith("scrypt$") && !a.password_hash.includes("plain-text-check-1"));
  await pool.query("DELETE FROM accounts WHERE email=$1", [who]);
});
