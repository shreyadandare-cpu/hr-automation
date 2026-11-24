/*
 * Holiday list upload, end to end, against a LOCAL server and database (never the shared one): the template, the preview, saving, and
 * who may do it. It removes the 2027 holidays it adds.
 *
 *   DATABASE_URL=postgresql://postgres:x@localhost:55434/postgres BASE=http://localhost:3190 node test/holiday-import-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server).
 */
import crypto from "node:crypto";
import ExcelJS from "exceljs";
import pg from "pg";
import { parseHolidays, readTable } from "../src/holiday-import.js";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3190";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: BASE must be a local server."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB }), sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
// users.role is only a label: access comes from grants (access.js), so HR is given leave.manage for the holiday list.
const login = async (email, role) => { await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x',$2) ON CONFLICT DO NOTHING", [email, role]);
  if (role === "hr") await db.query("INSERT INTO access_grants (email, permission, scope, granted_by, note) VALUES ($1,'leave.manage','company','test','flow-test')", [email]);
  const t = crypto.randomBytes(32).toString("hex"); await db.query("INSERT INTO sessions (token_hash,email,expires_at) VALUES ($1,$2,now()+interval '1 hour')", [sha(t), email]); return t; };
const call = async (t, method, path, body, raw) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${t}`, ...(raw ? { "content-type": "application/octet-stream" } : body ? { "content-type": "application/json" } : {}) }, body: raw || (body ? JSON.stringify(body) : undefined) });
  const type = r.headers.get("content-type") || "";
  return { status: r.status, type, data: type.includes("json") ? await r.json().catch(() => null) : Buffer.from(await r.arrayBuffer()) };
};
const sheet = async (rows) => { const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Holidays"); ws.addRow(["Date", "Holiday", "Type"]); rows.forEach((r) => ws.addRow(r)); return Buffer.from(await wb.xlsx.writeBuffer()); };
const HR = "test.holiday.admin@wohlig.com", EMP = "test.holiday.employee@wohlig.com";   // clearly named test people; a local server sends no email
try {
  await db.query("DELETE FROM holidays WHERE day >= '2027-01-01' AND day < '2028-01-01'");
  const hr = await login(HR, "hr"), emp = await login(EMP, "employee");
  const before = (await db.query("SELECT count(*)::int n FROM holidays WHERE day < '2027-01-01'")).rows[0].n;

  ok("an employee cannot download the template", (await call(emp, "GET", "/api/leave/holidays/template?year=2026")).status === 403);
  ok("an employee cannot upload a list", (await call(emp, "POST", "/api/leave/holidays/import", null, await sheet([["26-Jan-2027", "Republic Day", ""]]))).status === 403);
  ok("an employee cannot save a list", (await call(emp, "POST", "/api/leave/holidays/import/apply", { holidays: [{ day: "2027-01-26", name: "x" }] })).status === 403);

  let r = await call(hr, "GET", "/api/leave/holidays/template?year=2026");
  const back = parseHolidays(await readTable(r.data));
  ok("HR downloads the template with the 2026 holidays already in it", r.status === 200 && r.type.includes("spreadsheetml") && back.holidays.length === 13 && back.holidays[0].name === "New Year Day", `${r.status} ${back.holidays.length}`);
  r = await call(hr, "GET", "/api/leave/holidays/template?year=2027");
  ok("the template for a year with no list is empty and ready to fill", parseHolidays(await readTable(r.data)).errors.length === 1);

  const file = await sheet([[new Date(Date.UTC(2027, 0, 1)), "New Year Day", "National"], ["26/01/2027", "Republic Day", "National"], ["22-Mar-2027", "Holi", "Festival"], ["soon", "Mystery", ""], ["15-08-2027", "", ""], ["2027-10-21", "Dasara", ""]]);
  r = await call(hr, "POST", "/api/leave/holidays/import", null, file);
  ok("the preview finds the 4 good rows as new", r.status === 200 && r.data.counts.new === 4 && r.data.counts.changed === 0 && r.data.years.join() === "2027", JSON.stringify(r.data && r.data.counts));
  ok("and lists the 2 bad rows with their row numbers", r.data.errors.length === 2 && r.data.errors.map((e) => e.row).join() === "5,6", JSON.stringify(r.data.errors));
  ok("previewing saves nothing", (await db.query("SELECT count(*)::int n FROM holidays WHERE day >= '2027-01-01'")).rows[0].n === 0);
  ok("a file that is not a sheet is refused clearly", (await call(hr, "POST", "/api/leave/holidays/import", null, Buffer.from("PK\x03\x04 not really"))).status === 422);
  ok("an empty upload is refused", (await call(hr, "POST", "/api/leave/holidays/import", null, Buffer.alloc(0))).status === 400);

  const good = r.data.holidays.filter((h) => h.status !== "same").map(({ day, name, type }) => ({ day, name, type }));
  ok("a tampered list is refused (bad date)", (await call(hr, "POST", "/api/leave/holidays/import/apply", { holidays: [{ day: "2027-02-31", name: "x" }] })).status === 400);
  ok("and a long name", (await call(hr, "POST", "/api/leave/holidays/import/apply", { holidays: [{ day: "2027-02-01", name: "x".repeat(81) }] })).status === 400);
  r = await call(hr, "POST", "/api/leave/holidays/import/apply", { holidays: good });
  ok("HR saves them: 4 added", r.status === 200 && r.data.added === 4 && r.data.updated === 0, JSON.stringify(r.data));
  const rows = (await db.query("SELECT to_char(day,'YYYY-MM-DD') d, name, type, source FROM holidays WHERE day >= '2027-01-01' ORDER BY day")).rows;
  ok("they are stored like the 2026 ones (date, name, type, marked imported)", rows.length === 4 && rows.every((h) => h.source === "imported") && rows[1].name === "Republic Day" && rows[1].type === "National", JSON.stringify(rows));
  ok("the 2026 holidays are untouched", (await db.query("SELECT count(*)::int n FROM holidays WHERE day < '2027-01-01'")).rows[0].n === before);
  const lv = await call(emp, "GET", "/api/leave");
  ok("everyone sees the 2027 holidays on the calendar", lv.data.holidays.filter((h) => h.day.startsWith("2027")).length === 4);

  r = await call(hr, "POST", "/api/leave/holidays/import", null, await sheet([["26-Jan-2027", "Republic Day", "National"], ["22-Mar-2027", "Holi (Second Day)", "Festival"], ["12-Nov-2027", "Diwali", ""]]));
  ok("uploading again: one unchanged, one updated, one new", r.data.counts.same === 1 && r.data.counts.changed === 1 && r.data.counts.new === 1 && r.data.holidays.find((h) => h.status === "changed").was.name === "Holi", JSON.stringify(r.data.counts));
  r = await call(hr, "POST", "/api/leave/holidays/import/apply", { holidays: r.data.holidays.filter((h) => h.status !== "same").map(({ day, name, type }) => ({ day, name, type })) });
  ok("saving: 1 added, 1 updated", r.data.added === 1 && r.data.updated === 1, JSON.stringify(r.data));
  ok("the other 2027 holidays stay", (await db.query("SELECT count(*)::int n FROM holidays WHERE day >= '2027-01-01'")).rows[0].n === 5);

  const log = (await db.query("SELECT action FROM audit_log WHERE action ILIKE 'Holiday list uploaded%' ORDER BY id")).rows.map((x) => x.action).join("\n");
  ok("each upload is in the audit log", /uploaded for 2027: 4 added, 0 updated/.test(log) && /1 added, 1 updated/.test(log), log);
} catch (e) { fail++; console.log("ERROR  " + e.stack); }
finally {
  await db.query("DELETE FROM holidays WHERE day >= '2027-01-01' AND day < '2028-01-01'");
  await db.query("DELETE FROM sessions WHERE lower(email) IN ($1,$2)", [HR, EMP]);
  await db.query("DELETE FROM access_grants WHERE lower(email)=$1 AND note='flow-test'", [HR]);
  await db.query("DELETE FROM users WHERE email IN ($1,$2)", [EMP, HR]);   // the HR test user too, or a later access check picks it up
  await db.query("DELETE FROM audit_log WHERE action ILIKE 'Holiday list uploaded%'");
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
