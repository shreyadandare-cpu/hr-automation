/*
 * Reporting managers, end to end, against a LOCAL server and database (never the shared one), as Keka handles them:
 *   - the manager is required: clearing it is refused for everyone but the top of the company;
 *   - a joiner needs a manager before their work email is made;
 *   - an exit asks who the leaver's team reports to, refuses someone further down that team, and moves the team when
 *     access is removed (a team member who steps up reports to the leaver's own manager).
 * It makes its own test people (test-mgr-*@wohlig.com), signs in as a super admin, and removes everything it made.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/manager-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server), like access-flow.mjs.
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
const ok = (cond, name, extra = "") => { if (cond) pass += 1; else { fail += 1; console.log(`FAIL ${name}${extra ? `: ${extra}` : ""}`); } };

const TAG = `test-mgr-${Date.now().toString(36)}`;
const mail = (k) => `${TAG}-${k}@wohlig.com`;
const P = {
  dir: { name: `${TAG} Director`, title: "Director" },
  boss: { name: `${TAG} Boss`, title: "Tech Lead", mgr: "dir" },
  lead: { name: `${TAG} Lead`, title: "Tech Lead", mgr: "boss" },
  m1: { name: `${TAG} Member One`, title: "Software Development Engineer", mgr: "lead" },
  m2: { name: `${TAG} Member Two`, title: "Software Development Engineer", mgr: "lead" },
  deep: { name: `${TAG} Deep`, title: "Software Development Engineer", mgr: "m1" },
};
const made = { sessions: [] };

async function api(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", Cookie: `sid=${token}` }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}
const managerOf = async (k) => (await one("SELECT lower(manager_email) AS m FROM employees WHERE lower(work_email)=$1", [mail(k)]))?.m || null;

async function cleanup() {
  const emails = Object.keys(P).map(mail);
  await db.query("DELETE FROM offboarding_steps WHERE offboarding_id IN (SELECT id FROM offboardings WHERE lower(work_email) = ANY($1))", [emails]);
  await db.query("DELETE FROM offboarding_clearances WHERE offboarding_id IN (SELECT id FROM offboardings WHERE lower(work_email) = ANY($1))", [emails]).catch(() => {});
  await db.query("DELETE FROM offboardings WHERE lower(work_email) = ANY($1)", [emails]);
  await db.query("DELETE FROM audit_log WHERE lower(work_email) = ANY($1)", [emails]);
  await db.query("DELETE FROM users WHERE lower(email) = ANY($1)", [emails]);
  await db.query("DELETE FROM employees WHERE lower(work_email) = ANY($1)", [emails]);
  if (made.sessions.length) await db.query("DELETE FROM sessions WHERE token_hash = ANY($1)", [made.sessions]);
}

try {
  const admin = (await one("SELECT lower(email) AS e FROM users WHERE is_super_admin AND NOT login_blocked LIMIT 1"))?.e;
  if (!admin) throw new Error("No super admin in the local database.");
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '15 minutes')", [sha(token), admin]);
  made.sessions.push(sha(token));

  for (const [k, p] of Object.entries(P)) {
    await db.query("INSERT INTO employees (name, title, work_email, status, start_date, manager, manager_email) VALUES ($1,$2,$3,'active','2024-01-01',$4,$5)",
      [p.name, p.title, mail(k), p.mgr ? P[p.mgr].name : null, p.mgr ? mail(p.mgr) : null]);
  }
  await new Promise((r) => setTimeout(r, 15500));   // the reporting tree is cached for 15 seconds

  // 1. The manager is required, except at the top of the company.
  let r = await api("PUT", "/api/employees/manager", { email: mail("m2"), manager: "" }, token);
  ok(r.status === 400 && /needs a reporting manager/.test(r.data?.error || ""), "clearing a member's manager is refused", JSON.stringify(r));
  ok((await managerOf("m2")) === mail("lead"), "the member keeps their manager");
  r = await api("PUT", "/api/employees/manager", { email: mail("boss"), managerEmail: mail("m1") }, token);
  ok(r.status === 400 && /loop/.test(r.data?.error || ""), "a loop is still refused", JSON.stringify(r));
  r = await api("PUT", "/api/employees/manager", { email: mail("m2"), managerEmail: mail("boss") }, token);
  ok(r.status === 200 && (await managerOf("m2")) === mail("boss"), "a manager can be changed by email", JSON.stringify(r));
  r = await api("PUT", "/api/employees/manager", { email: mail("m2"), managerEmail: mail("lead") }, token);
  ok(r.status === 200, "and changed back");
  await db.query("UPDATE employees SET manager='Someone', manager_email=NULL WHERE lower(work_email)=$1", [mail("dir")]);
  r = await api("PUT", "/api/employees/manager", { email: mail("dir"), manager: "" }, token);
  ok(r.status === 200 && (await managerOf("dir")) === null, "a director may have no manager", JSON.stringify(r));

  // 2. A joiner needs a manager before the work email is made (nothing is created: the details are refused first).
  const joiner = { first: "Test", last: "Joiner", pemail: "someone@example.com", phone: "9876543210", address: "Mumbai", title: "Software Development Engineer", start: "2026-12-01", mgr: "" };
  r = await api("POST", "/api/onboarding/work-email", { d: joiner }, token);
  ok(r.status === 400 && /reporting manager/.test(r.data?.errors?.mgr || ""), "a joiner with no manager is refused", JSON.stringify(r));
  r = await api("POST", "/api/onboarding/work-email", { d: { ...joiner, mgr: "Nobody At All" } }, token);
  ok(r.status === 400 && /not a current employee/.test(r.data?.errors?.mgr || ""), "a joiner's manager must be a current employee", JSON.stringify(r));
  r = await api("POST", "/api/onboarding/work-email", { d: { ...joiner, title: "Director", first: "", mgr: "" } }, token);
  ok(r.status === 400 && !r.data?.errors?.mgr, "a director may join with no manager (only the missing first name is refused)", JSON.stringify(r));

  // 3. The exit asks who the team reports to.
  const exit = { email: mail("lead"), lastDay: new Date().toISOString().slice(0, 10), when: "now", tools: [], checklist: { laptop: { status: "none" } }, clearanceReviewed: true };
  r = await api("POST", "/api/offboarding", exit, token);
  ok(r.status === 400 && /2 people report/.test(r.data?.errors?.teamTo || ""), "an exit with a team needs their new manager", JSON.stringify(r));
  r = await api("POST", "/api/offboarding", { ...exit, teamTo: mail("deep") }, token);
  ok(r.status === 400 && /works under/.test(r.data?.errors?.teamTo || ""), "someone further down the team is refused", JSON.stringify(r));
  r = await api("POST", "/api/offboarding", { ...exit, teamTo: mail("lead") }, token);
  ok(r.status === 400 && /other than the person leaving/.test(r.data?.errors?.teamTo || ""), "the leaver cannot take their own team", JSON.stringify(r));
  r = await api("POST", "/api/offboarding", { ...exit, teamTo: mail("m1") }, token);
  ok(r.status === 201 && r.data?.teamTo === mail("m1"), "the exit starts with a team member stepping up", JSON.stringify(r).slice(0, 300));
  ok((await managerOf("m1")) === mail("boss"), "the member who steps up reports to the leaver's own manager");
  ok((await managerOf("m2")) === mail("m1"), "the rest of the team reports to them");
  ok((await managerOf("deep")) === mail("m1"), "people further down keep their manager");
  const moved = await one("SELECT count(*)::int AS n FROM audit_log WHERE lower(work_email) = ANY($1) AND action LIKE 'Reporting manager moved from%'", [[mail("m1"), mail("m2")]]);
  ok(moved.n === 2, "each move is in the audit log", JSON.stringify(moved));
  const orphans = await one(`SELECT count(*)::int AS n FROM employees e WHERE lower(e.work_email) = ANY($1) AND e.status <> 'offboarded'
    AND NOT EXISTS (SELECT 1 FROM employees m WHERE lower(m.work_email)=lower(e.manager_email) AND m.status NOT IN ('offboarding','offboarded')) AND e.title NOT ILIKE '%director%'`,
  [Object.keys(P).filter((k) => k !== "lead").map(mail)]);
  ok(orphans.n === 0, "nobody is left without a current manager", JSON.stringify(orphans));
} catch (err) {
  fail += 1;
  console.log("FAIL the test stopped:", err.message);
} finally {
  await cleanup().catch((e) => console.log("Clean-up problem:", e.message));
  await db.end();
}
console.log(`manager-flow: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
