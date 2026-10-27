// Checks the biometric device sync against the real database and a throwaway server: npm run test:device
// It makes a temporary employee and HR login, sends punches the way the office connector does, then removes everything it made.
import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { pool } from "../src/db.js";
import { createUser, getDefaultPassword } from "../src/auth.js";

const PORT = 3101, base = `http://localhost:${PORT}`, KEY = process.env.ATTENDANCE_DEVICE_KEY;
assert.ok(KEY && KEY.length >= 32, "Set ATTENDANCE_DEVICE_KEY (32+ characters) in backend/.env first");
const tag = crypto.randomBytes(3).toString("hex"), devId = String(9000 + (parseInt(tag, 16) % 900));
const empEmail = `device.test.${tag}@wohlig.com`, hrEmail = `device.hr.${tag}@wohlig.com`;
const post = (punches, key = KEY) => fetch(`${base}/api/attendance/device/punches`, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ device: "test", punches }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const day = "2026-10-20";
const stored = async (id) => (await pool.query("SELECT to_char(punch_time,'HH24:MI:SS') t, direction d, source FROM attendance_punches WHERE employee_id=$1 ORDER BY work_date, punch_time", [id])).rows;

const before = (await pool.query("SELECT value FROM settings WHERE key='device_last_sync'")).rows[0];
const server = spawn("node", ["src/index.js"], { env: { ...process.env, PORT: String(PORT), ALLOW_PASSWORD_LOGIN: "true" }, stdio: "ignore" });
let n = 0, empId;
const ok = (name) => console.log(`  ✓ ${++n}. ${name}`);
try {
  for (let i = 0; i < 40; i++) { try { await fetch(base + "/login"); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  empId = (await pool.query("INSERT INTO employees (emp_no, name, work_email, status) VALUES ($1,'Device Test','" + empEmail + "','active') RETURNING id", [`TST/${devId}`])).rows[0].id;
  await createUser(pool, hrEmail, "hr");
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: hrEmail, password: await getDefaultPassword() }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const hr = (method, path, body) => fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));
  console.log(`Testing with device ID ${devId} and ${empEmail}`);

  assert.equal((await post([{ userId: devId, time: `${day} 09:00:00` }], "")).status, 401); ok("no key: refused");
  assert.equal((await post([{ userId: devId, time: `${day} 09:00:00` }], "x".repeat(40))).status, 401); ok("wrong key: refused");

  const first = await post([
    { userId: devId, time: `${day} 18:05:00` }, { userId: devId, time: `${day} 09:00:10` }, { userId: devId, time: `${day} 13:00:00` },
    { userId: devId, time: `${day} 14:00:00` }, { userId: devId, time: `${day} 09:00:40` },
  ]);
  assert.equal(first.status, 200); assert.equal(first.body.unmatched, 5); assert.deepEqual(first.body.unmatchedIds, [devId]);
  assert.equal((await stored(empId)).length, 0); ok("an ID nobody linked yet is kept aside, not recorded");

  const list = await hr("GET", "/api/attendance/device/users");
  const row = list.body.unmatched.find((u) => u.deviceUserId === devId);
  assert.ok(row && row.punches === 5); assert.equal(row.suggestion?.email, empEmail); ok("HR sees the waiting ID, with a suggestion from the employee number");

  const link = await hr("PUT", "/api/attendance/device/users", { matches: [{ deviceUserId: devId, email: empEmail }] });
  assert.equal(link.status, 200); assert.equal(link.body.applied, 4);
  const rows = await stored(empId);
  assert.deepEqual(rows.map((r) => `${r.t} ${r.d}`), ["09:00:10 IN", "13:00:00 OUT", "14:00:00 IN", "18:05:00 OUT"]);
  assert.ok(rows.every((r) => r.source === "device")); ok("linking applies the waiting punches, in time order, alternating IN and OUT; a double tap within a minute is ignored");

  const again = await post([{ userId: devId, time: `${day} 09:00:10` }, { userId: devId, time: `${day} 13:00:00` }]);
  assert.equal(again.body.added, 0); assert.equal(again.body.duplicates, 2); assert.equal((await stored(empId)).length, 4); ok("sending the same punches again adds nothing");

  const live = await post([{ userId: devId, time: "2026-10-21 09:30:00" }]);
  assert.equal(live.body.added, 1); ok("a punch for a linked ID is recorded straight away");

  const zone = await post([{ userId: devId, time: "2026-10-21T04:00:00Z" }, { userId: devId, time: "2026-10-22T09:15:00+05:30" }]);
  assert.equal(zone.body.duplicates, 1); assert.equal(zone.body.added, 1);
  assert.ok((await stored(empId)).some((r) => r.t === "09:15:00")); ok("times with a zone are converted to Indian time (04:00Z = 09:30 IST, already recorded)");

  const bad = await post([{ userId: devId, time: "2099-01-01 10:00:00" }, { userId: devId, time: "not a time" }, { userId: "", time: `${day} 10:00:00` }]);
  assert.equal(bad.body.rejected, 3); assert.equal(bad.body.added, 0); ok("future, malformed and empty-ID punches are rejected");

  assert.equal((await hr("DELETE", `/api/attendance/device/users/${devId}`)).status, 200);
  assert.equal((await stored(empId)).length, 6); ok("unlinking keeps the punches already recorded");

  const plain = await fetch(`${base}/api/attendance/device/users`); assert.equal(plain.status, 401); ok("linking screens need a sign-in");
  console.log("\nAll device sync checks passed.");
} finally {
  server.kill();
  await pool.query("DELETE FROM device_unmatched WHERE device_user_id = $1", [devId]);
  await pool.query("DELETE FROM device_users WHERE device_user_id = $1", [devId]);
  if (empId) await pool.query("DELETE FROM employees WHERE id = $1", [empId]);   // punches go with the employee
  await pool.query("DELETE FROM sessions WHERE lower(email) = $1", [hrEmail]);
  await pool.query("DELETE FROM users WHERE lower(email) = $1", [hrEmail]);
  await pool.query("DELETE FROM audit_log WHERE work_email IN ($1,$2)", [empEmail, hrEmail]);
  if (before) await pool.query("UPDATE settings SET value=$1 WHERE key='device_last_sync'", [before.value]); else await pool.query("DELETE FROM settings WHERE key='device_last_sync'");
  await pool.end();
}
