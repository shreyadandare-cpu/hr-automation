/*
 * Personal access keys (the Wohlig One MCP), end to end, against a LOCAL server and database (never the shared one):
 * makes a key through the browser session, uses it on dashboard endpoints, checks that salaries, payments, documents,
 * access rights and key management are refused even for a salary owner, that a write is audited with the key's name,
 * and that a revoked key stops working. It cleans up its own sessions, keys and audit lines.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/access-keys-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server), like access-flow.mjs.
 */
import crypto from "node:crypto";
import pg from "pg";
import { salaryOwners } from "../src/access-rules.js";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: BASE must be a local server."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];

// A salary owner who is a super admin when there is one locally (the strongest case), otherwise any super admin.
const owners = salaryOwners();
const person = (await one("SELECT lower(email) AS e FROM users WHERE is_super_admin AND NOT login_blocked AND lower(email) = ANY($1) LIMIT 1", [owners]))?.e
  || (await one("SELECT lower(email) AS e FROM users WHERE is_super_admin AND NOT login_blocked LIMIT 1"))?.e;
if (!person) { console.error("No super admin login in the local database."); process.exit(2); }
const isOwner = owners.includes(person);

const token = crypto.randomBytes(32).toString("hex");
await db.query("INSERT INTO sessions (token_hash, email, expires_at, created_at) VALUES ($1,$2, now() + interval '1 hour', now())", [sha(token), person]);
const started = new Date();
const cookie = { Cookie: `sid=${token}` };
const bearer = (k) => ({ Authorization: `Bearer ${k}` });
const req = async (method, path, headers, body) => {
  const r = await fetch(BASE + path, { method, headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, data };
};

let failed = 0, keyId = null;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };
try {
  // Make a key in the browser session; the secret comes back once.
  const made = await req("POST", "/api/access-keys", cookie, { name: "Flow test key", days: 1 });
  check(made.status === 201 && /^wo1_/.test(made.data?.secret || ""), "a signed-in person makes a key and sees it once");
  const secret = made.data.secret; keyId = made.data.key.id;
  const stored = await one("SELECT key_hash, hint FROM access_keys WHERE id=$1", [keyId]);
  check(stored.key_hash === sha(secret) && !JSON.stringify(stored).includes(secret), "only the key's hash is stored");
  const list = await req("GET", "/api/access-keys", cookie);
  check(list.status === 200 && list.data.keys.some((k) => k.id === keyId) && !JSON.stringify(list.data).includes(secret), "the list shows the key without its secret");
  check((await req("POST", "/api/access-keys", cookie, { name: "" })).status === 400, "a key needs a name");
  const oldToken = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at, created_at) VALUES ($1,$2, now() + interval '1 hour', now() - interval '2 hours')", [sha(oldToken), person]);
  const stale = await req("POST", "/api/access-keys", { Cookie: `sid=${oldToken}` }, { name: "Flow test key" });
  await db.query("DELETE FROM sessions WHERE token_hash=$1", [sha(oldToken)]);
  check(stale.status === 403 && stale.data?.needsFreshSignIn, "a sign-in older than 30 minutes cannot make a key");

  // The key works on the dashboard's endpoints, as that person.
  const me = await req("GET", "/api/me", bearer(secret));
  check(me.status === 200 && me.data.email.toLowerCase() === person, "the key acts as the person who made it");
  check(!Object.keys(me.data.access || {}).some((k) => k.startsWith("payroll.") || k === "finance.view" || k === "expenses.approve"), `no salary permission through the key${isOwner ? " (even for a salary owner)" : ""}`);
  for (const p of ["/api/roster", "/api/leave", "/api/leave/today", "/api/attendance/day", "/api/hr/probations", "/api/tickets?scope=all", "/api/notifications", "/api/report-builder", "/api/audit?limit=5"]) {
    const r = await req("GET", p, bearer(secret));
    check(r.status === 200, `GET ${p} works with the key (${r.status})`);
  }
  const rb = await req("GET", "/api/report-builder", bearer(secret));
  check(!JSON.stringify(rb.data || {}).includes('"expenses"'), "the report builder offers no expenses dataset through the key");

  // Pay never travels through a key, even where the page shows it in the browser.
  const leave = await req("GET", "/api/leave", bearer(secret));
  check(Array.isArray(leave.data?.pay) && leave.data.pay.every((p) => p.monthlyGross == null), "leave data carries no salary, not even your own");
  const off = await req("GET", "/api/offboarding", bearer(secret));
  check(off.status === 200 && (off.data || []).every((o) => o.settlement === null && o.clearance === null), "offboarding carries no settlement or clearance figures");
  // Leave for someone else is refused unless you may approve their leave; it is never filed for you instead.
  const other = (await one("SELECT lower(work_email) AS e FROM employees WHERE status='active' AND lower(work_email)<>$1 LIMIT 1", [person]))?.e;
  const empKeyOwner = (await one(`SELECT lower(u.email) AS e FROM users u JOIN employees e ON lower(e.work_email)=lower(u.email) WHERE e.status='active' AND NOT u.is_super_admin
    AND NOT u.login_blocked AND NOT EXISTS (SELECT 1 FROM access_grants g WHERE lower(g.email)=lower(u.email) AND g.revoked_at IS NULL) LIMIT 1`))?.e;
  if (empKeyOwner && other) {
    const k2 = crypto.randomBytes(32).toString("base64url"), s2 = "wo1_" + k2.slice(0, 43);
    await db.query("INSERT INTO access_keys (email, name, key_hash, hint, expires_at) VALUES ($1,'Flow test key',$2,$3, now() + interval '1 hour')", [empKeyOwner, sha(s2), s2.slice(0, 10)]);
    const before = (await one("SELECT count(*)::int AS n FROM leave_requests WHERE lower(work_email)=$1", [empKeyOwner])).n;
    const forOther = await req("POST", "/api/leave/requests", bearer(s2), { type: "casual", from: "2027-02-01", to: "2027-02-01", reason: "Flow test", email: other === empKeyOwner ? person : other });
    const after = (await one("SELECT count(*)::int AS n FROM leave_requests WHERE lower(work_email)=$1", [empKeyOwner])).n;
    check(forOther.status === 403 && after === before, "leave asked for someone else, without approving their leave, is refused and not filed for you");
  }

  // ID numbers and bank details never travel through a key either, on any page.
  const onb = await req("GET", "/api/onboarding", bearer(secret));
  check(onb.status === 200 && !/"(pan|aadhaar|acct|ifsc)"\s*:/.test(JSON.stringify(onb.data)), "the joiners list carries no PAN, Aadhaar, bank account or IFSC");
  const prof = await req("GET", "/api/profile", bearer(secret));
  check(prof.status === 200 && !/"(pan|aadhaar|acct|ifsc|pfNumber|uan)"\s*:/.test(JSON.stringify(prof.data)), "your own profile carries no PAN, Aadhaar or bank details");
  check((await req("GET", "/api/onboarding/import/template", bearer(secret))).status === 403, "the employee details sheet is refused");
  const users = await req("GET", "/api/users", bearer(secret));
  check(users.status === 200 && !users.data?.defaultPassword, "the logins list shows no default password");

  // Out of reach for every key.
  for (const [m, p] of [["GET", "/api/payroll"], ["GET", "/api/payslips"], ["GET", "/api/finance/journal"], ["GET", "/api/reimbursements"], ["GET", "/api/loans"],
    ["GET", "/api/advances"], ["GET", "/api/tax-declarations"], ["GET", "/api/documents"], ["GET", "/api/employees/export"], ["GET", "/api/access/people"],
    ["GET", "/api/access-keys"], ["POST", "/api/access-keys"], ["GET", "/api/requests/advance"], ["GET", "/api/PAYROLL"], ["GET", "/app/dashboard"],
    ["POST", "/api/users"], ["POST", `/api/users/${encodeURIComponent(person)}/reset`], ["PUT", "/api/users/default-password"],
    ["POST", "/api/onboarding/work-email"], ["POST", "/api/requests/attendance"], ["GET", "/api/employees/a%2fb/pay"]]) {
    const r = await req(m, p, bearer(secret), m === "POST" ? { name: "x" } : undefined);
    check(r.status === 403, `${m} ${p} is refused with the key (${r.status})`);
  }

  // A write through the key is audited with its name.
  const w = await req("POST", "/api/notifications/read", bearer(secret), {});
  check(w.status < 400, "a harmless write works with the key");
  await new Promise((r) => setTimeout(r, 300));
  check(!!(await one("SELECT 1 FROM audit_log WHERE work_email=$1 AND action LIKE 'POST%through the access key \"Flow test key\"' AND ts >= $2", [person, started])), "the write is in the audit log with the key's name");
  check(!!(await one("SELECT 1 FROM audit_log WHERE work_email=$1 AND action LIKE 'Refused GET /api/payroll%Flow test key%' AND ts >= $2", [person, started])), "a refused attempt is in the audit log too");

  // A key sent with a stale cookie is still a key: the guard applies.
  check((await req("GET", "/api/payroll", { ...cookie, ...bearer(secret) })).status === 403, "a key wins over a cookie sent with it");

  // Wrong or missing keys get nothing.
  check((await req("GET", "/api/me", bearer("wo1_" + "A".repeat(43)))).status === 401, "an unknown key is not signed in");
  check((await req("GET", "/api/me", {})).status === 401, "no key, no session");

  // Revoked: the key stops working at once.
  check((await req("DELETE", `/api/access-keys/${keyId}`, cookie)).status === 200, "the person revokes the key");
  check((await req("GET", "/api/me", bearer(secret))).status === 401, "a revoked key no longer works");
  check((await req("DELETE", `/api/access-keys/${keyId}`, cookie)).status === 404, "revoking twice says it is already gone");
} finally {
  await db.query("DELETE FROM access_keys WHERE name='Flow test key'");
  await db.query("DELETE FROM sessions WHERE token_hash=$1", [sha(token)]);
  await db.query("DELETE FROM audit_log WHERE work_email=$1 AND ts >= $2 AND (action LIKE '%Flow test key%')", [person, started]);
  await db.end();
}
console.log(failed ? `\n${failed} check(s) failed` : "\nAll access key checks passed");
process.exit(failed ? 1 : 0);
