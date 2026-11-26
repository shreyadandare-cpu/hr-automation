/*
 * Salary lock, end to end, against a LOCAL server and database (never the shared one): tries every way someone other than the
 * salary owner could reach salaries (super admin, HR role, IT admin, salary grants written straight into the database, a super
 * admin who is also HR, the Access page, taking over the owner's login) and fails on any answer that shows them. Then checks the
 * owner (kailash@wohlig.com, with no role or grant) gets in. Everything it changes is undone at the end.
 *
 *   Start the server with SALARY_OWNERS unset (so the owner is kailash@wohlig.com), then:
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/salary-lock-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server), like access-flow.mjs.
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", B = process.env.BASE || "http://localhost:3100";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(B)) { console.error("Refusing: BASE must be a local server."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const PE = "salarytest.emp@wohlig.com", K = "kailash@wohlig.com", SA = "chirag@wohlig.com", HR = "salarytest.hr@wohlig.com", EMP = "pratik.sawant@wohlig.com";
const SAL = ["payroll.view", "payroll.prepare", "payroll.approve", "payroll.bank", "finance.view"];
const made = { sessions: [], grants: [], users: [] }; const before = (await db.query("SELECT role, is_super_admin FROM users WHERE email=$1", [SA])).rows[0];
const login = async (e) => { const t = crypto.randomBytes(32).toString("hex"); await db.query("INSERT INTO sessions (token_hash,email,expires_at) VALUES ($1,$2,now()+interval '30 minutes')", [sha(t), e]); made.sessions.push(sha(t)); return t; };
const call = async (t, p, m = "GET", b) => (await fetch(B + p, { method: m, headers: { cookie: "sid=" + t, "content-type": "application/json", origin: B }, body: b ? JSON.stringify(b) : undefined })).status;
const P = ["/api/payroll/runs", "/api/payroll/master", `/api/payroll/structures/${encodeURIComponent(EMP)}`, `/api/payroll/bank/${encodeURIComponent(EMP)}`,
  "/api/finance/periods", "/api/tax-declarations", "/api/leave/salary-cuts?month=2026-10", `/api/payslips?email=${encodeURIComponent(EMP)}`,
  `/api/payslips/2026-10?email=${encodeURIComponent(EMP)}`, `/api/tax-declaration/form-124?email=${encodeURIComponent(EMP)}`];
let bad = 0, finished = false;
const expectNone = async (who, t) => { const r = []; for (const p of P) { const s = await call(t, p); if (s < 400 || s === 422) { bad++; r.push(`LEAK ${s} ${p}`); } }
  const me = await (await fetch(B + "/api/me", { headers: { cookie: "sid=" + t } })).json(); const held = SAL.filter((k) => k in (me.access || {}));
  if (held.length) { bad++; r.push("me holds " + held); } console.log((r.length ? "FAIL " : "ok   ") + who, r.join("; ")); };
try {
  if (!(await db.query("SELECT 1 FROM users WHERE email=$1", [K])).rowCount) { await db.query("INSERT INTO users (email, role, password_hash) VALUES ($1,'employee','!no-password-login')", [K]); made.users.push(K); }
  await db.query("INSERT INTO users (email, role, password_hash) VALUES ($1,'hr','!no-password-login'), ($2,'employee','!no-password-login')", [HR, PE]); made.users.push(HR, PE);
  const tK = await login(K), tSA = await login(SA), tHR = await login(HR), tE = await login(PE);
  await expectNone("super admin (as is)", tSA);
  await expectNone("HR role login", tHR);
  await db.query("UPDATE users SET role='hr', it_admin=true WHERE email=$1", [SA]);
  await expectNone("super admin + HR role + IT admin", tSA);
  for (const e of [SA, HR]) for (const p of SAL) { const r = await db.query("INSERT INTO access_grants (email, permission, scope, granted_by, note) VALUES ($1,$2,'company','proof','written straight into the database') ON CONFLICT DO NOTHING RETURNING id", [e, p]); made.grants.push(...r.rows.map((x) => x.id)); }
  await expectNone("super admin + salary grants written into the database", tSA);
  await expectNone("HR + salary grants written into the database", tHR);
  await db.query("UPDATE users SET is_super_admin=true WHERE email=$1", [HR]);
  await expectNone("HR made super admin as well", tHR);
  await expectNone("plain employee, someone else's pay", tE);
  const g = await call(tSA, "/api/access/grants", "POST", { email: HR, grants: [{ permission: "payroll.prepare", scope: "company" }] });
  console.log(g === 400 ? "ok  " : "FAIL", " super admin gives salary access on the Access page ->", g); if (g !== 400) bad++;
  for (const [what, p, m, b] of [["reset Kailash's login", `/api/users/${K}/reset`, "POST"], ["disable Kailash's login", `/api/users/${K}/disabled`, "PUT", { value: true }], ["send Kailash a sign-in link", `/api/users/${K}/invite`, "POST"], ["remove Kailash's login", `/api/users/${K}`, "DELETE"]]) {
    const s = await call(tSA, p, m, b); console.log(s === 403 ? "ok  " : "FAIL", ` super admin tries to ${what} ->`, s); if (s !== 403) bad++; }
  const kOk = []; for (const p of P.slice(0, 7)) kOk.push(await call(tK, p));
  console.log(kOk.every((s) => s === 200) ? "ok  " : "FAIL", " Kailash, plain employee role, no grants ->", kOk.join(",")); if (!kOk.every((s) => s === 200)) bad++;
  await db.query("UPDATE users SET role='employee' WHERE email=$1", [K]); finished = true;
} finally {
  await db.query("DELETE FROM access_grants WHERE id = ANY($1)", [made.grants]);
  await db.query("DELETE FROM sessions WHERE token_hash = ANY($1)", [made.sessions]);
  await db.query("UPDATE users SET role=$2, is_super_admin=$3, it_admin=false WHERE email=$1", [SA, before.role, before.is_super_admin]);
  await db.query("DELETE FROM audit_log WHERE work_email = ANY($1) AND created_at > now() - interval '10 minutes'", [[HR, PE]]).catch(() => {});
  await db.query("DELETE FROM users WHERE email = ANY($1)", [made.users]);
  await db.end();
  console.log(!finished ? "\nStopped early: not a result." : bad ? `\n${bad} PROBLEM(S)` : "\nNo leaks. Everything undone.");
  process.exitCode = !finished || bad ? 1 : 0;
}
