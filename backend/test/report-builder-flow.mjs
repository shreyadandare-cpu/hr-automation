/*
 * The custom report builder, end to end, against a LOCAL server and database (never the shared one): which datasets each
 * person may use, a team permission limiting rows to the team, filters, the department worked out from the job title, the
 * CSV (formulas made harmless, written to the audit log), and saved reports that only their owner sees.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/report-builder-flow.mjs
 *
 * Not part of `npm test`. The test people are clearly named and removed afterwards; a local server sends no email.
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const HR = "test.reports.hr@wohlig.com", LEAD = "test.reports.lead@wohlig.com", MEMBER = "test.reports.member@wohlig.com", OTHER = "test.reports.other@wohlig.com", NONE = "test.reports.none@wohlig.com";
const ALL = [HR, LEAD, MEMBER, OTHER, NONE];
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
async function login(email, grants = []) {
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x','employee') ON CONFLICT DO NOTHING", [email]);
  for (const [p, scope] of grants) await db.query("INSERT INTO access_grants (email, permission, scope, granted_by, note) VALUES ($1,$2,$3,'test','flow-test')", [email, p, scope]);
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(token), email]);
  return token;
}
const call = async (token, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${token}`, origin: BASE, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = r.headers.get("content-type") || "";
  return { status: r.status, type, headers: r.headers, data: /json/.test(type) ? await r.json().catch(() => null) : await r.text() };
};
const clean = async () => {
  await db.query("DELETE FROM saved_reports WHERE lower(owner)=ANY($1)", [ALL]);
  await db.query("DELETE FROM leave_requests WHERE lower(work_email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM employees WHERE lower(work_email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM access_grants WHERE lower(email)=ANY($1) AND note='flow-test'", [ALL]);
  await db.query("DELETE FROM notifications WHERE lower(recipient)=ANY($1)", [ALL]);
  await db.query("DELETE FROM audit_log WHERE lower(work_email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM sessions WHERE lower(email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM users WHERE lower(email)=ANY($1)", [ALL]);
};
try {
  await clean();
  await db.query(`INSERT INTO employees (work_email, name, start_date, status, title, manager_email) VALUES
    ($1,'Test Reports HR','2020-01-01','active','HR Executive',NULL), ($2,'Test Reports Lead','2021-01-01','active','Engineering Lead',NULL),
    ($3,'=HYPERLINK("http://bad")','2026-01-15','active','Developer',$2), ($4,'Test Reports Other','2022-01-01','active','Sales Manager',NULL)`, [HR, LEAD, MEMBER, OTHER]);
  await db.query(`INSERT INTO leave_requests (work_email, type, from_date, to_date, days, reason, status) VALUES ($1,'casual','2026-05-04','2026-05-05',2,'Family function','approved'),
    ($1,'sick','2026-06-10','2026-06-10',1,'Fever','pending')`, [MEMBER]);
  const hr = await login(HR, [["people.view", "company"], ["leave.manage", "company"]]), lead = await login(LEAD, [["people.view", "tree"]]), none = await login(NONE);

  let g = await call(none, "GET", "/api/report-builder");
  ok("no access: someone with no report data sees no datasets", g.status === 200 && g.data.datasets.length === 0, JSON.stringify(g.data));
  ok("no access: running a report is refused", (await call(none, "POST", "/api/report-builder/run", { dataset: "people", columns: ["name"] })).status === 403);
  g = await call(hr, "GET", "/api/report-builder");
  const keys = g.data.datasets.map((d) => d.key);
  ok("HR sees exactly the datasets their access allows", keys.includes("people") && keys.includes("leave") && !keys.includes("expenses") && !keys.includes("assets"), keys.join(","));
  ok("departments are offered from the data", g.data.datasets.find((d) => d.key === "people").filters.find((f) => f.key === "dept").options.some((o) => o.value === "HR"));
  ok("HR cannot run a dataset outside their access", (await call(hr, "POST", "/api/report-builder/run", { dataset: "expenses", columns: ["name"] })).status === 403);

  let r = await call(hr, "POST", "/api/report-builder/run", { dataset: "people", columns: [] });
  ok("no columns: a clear message", r.status === 400 && /at least one column/.test(r.data.errors.columns));
  r = await call(hr, "POST", "/api/report-builder/run", { dataset: "people", columns: ["name", "password_hash"] });
  ok("an unknown column is refused", r.status === 400 && !!r.data.errors.columns);
  r = await call(hr, "POST", "/api/report-builder/run", { dataset: "people", columns: ["name"], filters: { status: "x' OR '1'='1" } });
  ok("a filter value outside the list is refused", r.status === 400 && !!r.data.errors.status);

  r = await call(hr, "POST", "/api/report-builder/run", { dataset: "people", columns: ["name", "email", "dept", "status"], filters: { joined: { from: "2026-01-01", to: "2026-01-31" } } });
  const mine = r.data.rows.filter((x) => String(x[1]).startsWith("test.reports."));
  ok("date filter: only the January 2026 joiner", r.status === 200 && mine.length === 1 && mine[0][1] === MEMBER && mine[0][2] === "Engineering" && mine[0][3] === "Working", JSON.stringify(r.data));
  r = await call(hr, "POST", "/api/report-builder/run", { dataset: "people", columns: ["email"], filters: { dept: "Sales" } });
  ok("department filter (worked out from the job title)", r.data.rows.some((x) => x[0] === OTHER) && !r.data.rows.some((x) => x[0] === MEMBER), JSON.stringify(r.data.rows.slice(0, 5)));
  r = await call(hr, "POST", "/api/report-builder/run", { dataset: "leave", columns: ["email", "type", "days", "status"], filters: { status: "approved", from: { from: "2026-05-01", to: "2026-05-31" } } });
  const lv = r.data.rows.filter((x) => x[0] === MEMBER);
  ok("leave report: filters by status and dates, codes shown as words", lv.length === 1 && lv[0][1] === "Casual" && lv[0][2] === 2 && lv[0][3] === "Approved", JSON.stringify(r.data));

  // The server keeps the reporting tree for 15 seconds (the app clears it on every manager change; this test wrote the managers
  // straight into the database), so wait for it before checking the team limit.
  await new Promise((res) => setTimeout(res, 15500));
  r = await call(lead, "POST", "/api/report-builder/run", { dataset: "people", columns: ["email"] });
  const seen = r.data.rows.map((x) => x[0]);
  ok("team permission: the lead sees only their team", r.status === 200 && seen.includes(MEMBER) && !seen.includes(OTHER) && !seen.includes(HR), JSON.stringify(seen));

  const csv = await call(hr, "POST", "/api/report-builder/csv", { dataset: "people", columns: ["name", "email"], filters: { joined: { from: "2026-01-01", to: "2026-01-31" } } });
  ok("CSV: a download with a dated file name", csv.status === 200 && /text\/csv/.test(csv.type) && /attachment; filename="employees-\d{4}-\d{2}-\d{2}\.csv"/.test(csv.headers.get("content-disposition")), csv.headers.get("content-disposition"));
  ok("CSV: a name that looks like a formula is made harmless", typeof csv.data === "string" && csv.data.includes(`"'=HYPERLINK(""http://bad"")"`), csv.data.slice(0, 200));
  ok("CSV: the download is in the audit log", (await db.query("SELECT 1 FROM audit_log WHERE lower(work_email)=$1 AND action LIKE 'Report downloaded: Employees%'", [HR])).rowCount === 1);
  const bad = await call(hr, "POST", "/api/report-builder/csv", { dataset: "people", columns: [] });
  ok("CSV: a bad request answers with the message, not a file", bad.status === 400 && /json/.test(bad.type));

  let s = await call(hr, "POST", "/api/report-builder/saved", { dataset: "people", columns: ["name"] });
  ok("saved: a name is needed", s.status === 400 && !!s.data.errors.name);
  s = await call(hr, "POST", "/api/report-builder/saved", { name: "January joiners (test)", dataset: "people", columns: ["name", "joined"], filters: { joined: { from: "2026-01-01", to: "2026-01-31" } } });
  ok("saved: saved", s.status === 201);
  ok("saved: cannot save a dataset outside your access", (await call(hr, "POST", "/api/report-builder/saved", { name: "x", dataset: "assets", columns: ["tag"] })).status === 403);
  g = await call(hr, "GET", "/api/report-builder");
  ok("saved: listed for its owner, with its filters", g.data.saved.some((x) => x.name === "January joiners (test)" && x.filters.joined.from === "2026-01-01" && x.available));
  ok("saved: never shown to anyone else", !(await call(lead, "GET", "/api/report-builder")).data.saved.some((x) => x.id === s.data.id));
  ok("saved: someone else cannot remove it", (await call(lead, "DELETE", `/api/report-builder/saved/${s.data.id}`)).status === 404);
  ok("saved: the owner removes it", (await call(hr, "DELETE", `/api/report-builder/saved/${s.data.id}`)).status === 200);
} catch (err) { fail++; console.error("FAIL  the test stopped:", err.message); } finally {
  await clean();
  await db.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
