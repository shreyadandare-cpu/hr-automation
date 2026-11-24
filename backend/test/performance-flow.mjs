/*
 * OKRs and 1:1 meetings, end to end, against a LOCAL server and database (never the shared one): who may set company and team
 * objectives, key results and progress, linking a goal, and 1:1s that only the manager and the report can see, with private notes
 * the other never sees.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/performance-flow.mjs
 *
 * Not part of `npm test`. The test people are clearly named and removed afterwards; a local server sends no email.
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const MGR = "test.okr.manager@wohlig.com", REP = "test.okr.report@wohlig.com", OUT = "test.okr.outsider@wohlig.com", ADM = "test.okr.admin@wohlig.com", ALL = [MGR, REP, OUT, ADM];
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
  return { status: r.status, data: await r.json().catch(() => null) };
};
const clean = async () => {
  await db.query("DELETE FROM one_on_ones WHERE lower(manager_email)=ANY($1) OR lower(report_email)=ANY($1)", [ALL]);
  await db.query("UPDATE goals SET objective_id=NULL WHERE objective_id IN (SELECT id FROM okr_objectives WHERE lower(owner_email)=ANY($1))", [ALL]);
  await db.query("DELETE FROM goals WHERE lower(email)=ANY($1)", [ALL]);
  await db.query("UPDATE okr_objectives SET parent_id=NULL WHERE lower(owner_email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM okr_objectives WHERE lower(owner_email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM employees WHERE lower(work_email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM access_grants WHERE lower(email)=ANY($1) AND note='flow-test'", [ALL]);
  await db.query("DELETE FROM notifications WHERE lower(recipient)=ANY($1)", [ALL]);
  await db.query("DELETE FROM audit_log WHERE lower(work_email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM sessions WHERE lower(email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM users WHERE lower(email)=ANY($1)", [ALL]);
};
try {
  await clean();
  await db.query(`INSERT INTO employees (work_email, name, start_date, status, manager_email) VALUES ($1,'Test OKR Manager','2020-01-01','active',NULL),
    ($2,'Test OKR Report','2021-01-01','active',$1),($3,'Test OKR Outsider','2021-01-01','active',NULL),($4,'Test OKR Admin','2020-01-01','active',NULL)`, [MGR, REP, OUT, ADM]);
  const mgr = await login(MGR), rep = await login(REP), out = await login(OUT), adm = await login(ADM, ["okrs.manage"]);
  const Q = "2026-Q3";

  // --- OKRs
  let r = await call(mgr, "POST", "/api/okrs", { title: "Grow client revenue", level: "company", quarter: Q });
  ok("a manager cannot add a company objective", r.status === 403, String(r.status));
  r = await call(adm, "POST", "/api/okrs", { title: "Grow client revenue", level: "company", quarter: Q });
  ok("the OKR admin adds a company objective", r.status === 201, JSON.stringify(r.data));
  const companyId = r.data.id;
  r = await call(out, "POST", "/api/okrs", { title: "My team goal", level: "team", quarter: Q });
  ok("someone with no team cannot add a team objective", r.status === 403, String(r.status));
  r = await call(mgr, "POST", "/api/okrs", { title: "Ship launches faster", level: "team", quarter: Q, parentId: companyId });
  ok("a manager adds a team objective supporting it", r.status === 201);
  const teamId = r.data.id;
  r = await call(mgr, "POST", `/api/okrs/${teamId}/key-results`, { title: "Launches a month", start: "2", target: "6", unit: "launches" });
  ok("and a key result", r.status === 201, JSON.stringify(r.data));
  const krId = r.data.id;
  r = await call(out, "PUT", `/api/okrs/key-results/${krId}`, { current: "6" });
  ok("someone else cannot update it", r.status === 403);
  r = await call(mgr, "PUT", `/api/okrs/key-results/${krId}`, { current: "4" });
  ok("the owner updates it to 4 of 6 from 2: 50%", r.status === 200 && r.data.progress === 50, JSON.stringify(r.data));
  await db.query("INSERT INTO goals (email, title, progress) VALUES ($1,'Automate release notes',40)", [REP]);
  const { rows: [goal] } = await db.query("SELECT id FROM goals WHERE lower(email)=$1", [REP]);
  r = await call(rep, "PUT", `/api/okrs/goals/${goal.id}`, { objectiveId: companyId });
  ok("the report links their goal to the company objective", r.status === 200);
  r = await call(out, "PUT", `/api/okrs/goals/${goal.id}`, { objectiveId: null });
  ok("nobody else can unlink someone's goal", r.status === 404);
  r = await call(out, "GET", `/api/okrs?quarter=${Q}`);
  const co = r.data.objectives.find((o) => o.id === companyId), te = r.data.objectives.find((o) => o.id === teamId);
  ok("everyone reads the quarter's OKRs", r.status === 200 && co && te && r.data.canCompany === false && r.data.canTeam === false);
  ok("the company objective shows its linked goal at 40%", co.progress === 40 && co.goals.length === 1 && !co.canEdit, JSON.stringify(co));
  ok("the team objective is 50% and supports the company one", te.progress === 50 && te.parentId === companyId);
  r = await call(adm, "PUT", `/api/okrs/${teamId}`, { title: "Ship launches much faster", quarter: Q, parentId: companyId });
  ok("the OKR admin can change any team's objective", r.status === 200);

  // --- 1:1 meetings
  r = await call(mgr, "POST", "/api/one-on-ones", { with: OUT, on: "2099-01-05" });
  ok("a manager cannot schedule a 1:1 with someone outside their team", r.status === 400 && r.data.errors.with);
  r = await call(mgr, "POST", "/api/one-on-ones", { with: REP, on: "2020-01-05" });
  ok("nor in the past", r.status === 400 && r.data.errors.on);
  r = await call(mgr, "POST", "/api/one-on-ones", { with: REP, on: "2099-01-05" });
  ok("the manager schedules a 1:1 with their report", r.status === 201);
  const mid = r.data.id;
  let told = [];   // the notice is sent just after the reply, so wait a moment for it
  for (let i = 0; i < 20 && !told.length; i++) { await new Promise((w) => setTimeout(w, 100)); told = (await db.query("SELECT title FROM notifications WHERE lower(recipient)=$1", [REP])).rows; }
  ok("and the report is told", told.some((t) => /scheduled a 1:1 with you/.test(t.title)));
  r = await call(rep, "GET", "/api/one-on-ones");
  ok("the report sees it, with their manager to meet", r.data.meetings.some((m) => m.id === mid && m.role === "report") && r.data.canMeet.some((p) => p.email === MGR && p.relation === "manager"));
  r = await call(out, "GET", `/api/one-on-ones/${mid}`);
  ok("nobody else can open it", r.status === 404);
  r = await call(rep, "POST", `/api/one-on-ones/${mid}/items`, { kind: "talking_point", text: "Feedback on the client demo" });
  ok("the report adds a talking point", r.status === 201);
  r = await call(mgr, "POST", `/api/one-on-ones/${mid}/items`, { kind: "action", text: "Share the release plan", owner: REP });
  ok("the manager adds an action for the report", r.status === 201);
  const actionId = r.data.id;
  r = await call(rep, "DELETE", `/api/one-on-ones/items/${actionId}`);
  ok("only whoever added an item can remove it", r.status === 403);
  await call(mgr, "PUT", `/api/one-on-ones/${mid}/private`, { notes: "Ready for a lead role soon" });
  await call(mgr, "PUT", `/api/one-on-ones/${mid}`, { sharedNotes: "Agreed the release plan." });
  r = await call(rep, "GET", `/api/one-on-ones/${mid}`);
  ok("the report sees the shared notes but not the manager's private notes", r.data.sharedNotes === "Agreed the release plan." && r.data.privateNotes === "" && r.data.items.length === 2, JSON.stringify(r.data));
  r = await call(mgr, "PUT", `/api/one-on-ones/${mid}`, { status: "done" });
  ok("the manager marks it done", r.status === 200);
  r = await call(rep, "POST", "/api/one-on-ones", { with: MGR, on: "2099-02-05" });
  ok("the report schedules the next one with their manager", r.status === 201);
  r = await call(mgr, "GET", `/api/one-on-ones/${r.data.id}`);
  ok("the open action carries into the next 1:1", r.data.openFromEarlier.some((i) => i.id === actionId), JSON.stringify(r.data.openFromEarlier));
  r = await call(rep, "PUT", `/api/one-on-ones/items/${actionId}`, { done: true });
  ok("and the report ticks it off", r.status === 200);
} catch (err) { fail++; console.log("ERROR  " + err.stack); }
finally { await clean(); await db.end(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
