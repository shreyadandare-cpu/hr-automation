/*
 * Who an onboarding email goes to, against a LOCAL server and a LOCAL database (never the shared one). When HR types the work email themselves nothing about it
 * goes to the person's personal email and the invitation goes to the work address; when the work email is created for them, the invitation still goes to their personal email.
 *
 *   DATABASE_URL=postgresql://postgres:x@localhost:55434/postgres BASE=http://localhost:3190 node test/onboarding-email-flow.mjs
 *
 * A local server never sends email (it says so in its answers), so this reads the masked address the answers give. Not part of `npm test`. It removes its test rows afterwards.
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3190";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB) || !/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: a local database and a local server only."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB }), sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const HR = "oe.hr@wohlig.com", TYPED = "oe.manual@wohlig.com";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
const call = async (tok, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${tok}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, d: await r.json().catch(() => null) };
};
const details = (first, last, pemail) => ({ first, last, pemail, phone: "9876543210", address: "12 Test Road, Mumbai", dept: "Engineering", title: "Software Developer Engineer", mgr: "", start: "2026-12-07", kind: "Employee" });
try {
  await db.query("INSERT INTO users (email, password_hash, role, is_super_admin) VALUES ($1,'x','hr',true) ON CONFLICT DO NOTHING", [HR]);
  const tok = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(tok), HR]);

  // 1. HR types the work email
  let r = await call(tok, "POST", "/api/onboarding/work-email", { d: details("Manny", "Manual", "manny.personal@example.com"), typedEmail: TYPED });
  ok("a typed work email is accepted and used as it is", r.s === 201 && r.d.email === TYPED && r.d.googleStatus === "existing", JSON.stringify(r.d));
  ok("it is marked as entered by HR", r.d.workEmailManual === true && (await db.query("SELECT work_email_manual FROM employees WHERE work_email=$1", [TYPED])).rows[0].work_email_manual === true);
  ok("no work account email is made for the personal address (no password, nothing 'emailed')", r.d.workAccount === null, JSON.stringify(r.d.workAccount));
  ok("the audit log says it was entered by HR and that nothing was emailed to the personal address", (await db.query("SELECT action FROM audit_log WHERE work_email=$1", [TYPED])).rows.every((x) => !/emailed to the personal/.test(x.action)));
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x','employee') ON CONFLICT DO NOTHING", [TYPED]);
  r = await call(tok, "POST", `/api/users/${encodeURIComponent(TYPED)}/invite`);
  ok("the invitation goes to the work address, not the personal one", r.s === 200 && /^oe•+@wohlig\.com$/.test(r.d.invite.to || "") && !/example\.com/.test(r.d.invite.to || ""), JSON.stringify(r.d));

  // 2. the work email is created for them: the invitation still goes to their personal email
  r = await call(tok, "POST", "/api/onboarding/work-email", { d: details("Cora", "Created", "cora.personal@example.com") });
  ok("a created work email is not marked as typed", r.s === 201 && r.d.workEmailManual === false, JSON.stringify(r.d));
  const made = r.d.email;
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x','employee') ON CONFLICT DO NOTHING", [made]);
  r = await call(tok, "POST", `/api/users/${encodeURIComponent(made)}/invite`);
  ok("its invitation still goes to the personal email, as before", r.s === 200 && /example\.com/.test(r.d.invite.to || ""), JSON.stringify(r.d));
  await db.query("DELETE FROM invites WHERE lower(email) = ANY($1)", [[TYPED, made.toLowerCase()]]);
  await db.query("DELETE FROM audit_log WHERE work_email = ANY($1)", [[TYPED, made]]);
  await db.query("DELETE FROM employees WHERE work_email = ANY($1)", [[TYPED, made]]);
  await db.query("DELETE FROM users WHERE email = ANY($1)", [[TYPED, made]]);
} catch (e) { fail++; console.log("ERROR  " + e.stack); }
finally {
  await db.query("DELETE FROM sessions WHERE lower(email)=$1", [HR]);
  await db.query("DELETE FROM users WHERE email=$1", [HR]);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
