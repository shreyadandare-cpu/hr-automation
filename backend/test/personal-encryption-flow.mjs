/*
 * Personal details stored encrypted, end to end, against a LOCAL server and database (never the shared one): two test people save
 * their profiles, the database holds none of what they typed (no phone, address, date of birth, personal email or emergency
 * contact in a plain column), while the app shows all of it to them and on the employee record; a personal email that is already
 * someone else's is still refused (found by its keyed hash); HR saves a PAN; a phone an older release writes plain after
 * encryption wins over the sealed copy, keeps the rest, and is sealed again by the start-up step. Everything it adds is removed.
 *
 *   PAYROLL_ENCRYPTION_KEY=<the server's> DATABASE_URL=postgresql://localhost:5432/<db> BASE=http://localhost:3100 node test/personal-encryption-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server).
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB) || !/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: a local database and a local server only."); process.exit(2); }
if (!process.env.PAYROLL_ENCRYPTION_KEY) { console.error("Set PAYROLL_ENCRYPTION_KEY to the server's."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB }), sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const A = "test.personal.asha@wohlig.com", B = "test.personal.ravi@wohlig.com", HR = "test.personal.hr@wohlig.com";
const AE = "asha.personal.flow@example.org", BE = "ravi.personal.flow@example.org";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
const tokens = [];
const login = async (email, opts = {}) => {
  await db.query("INSERT INTO users (email, password_hash, role, is_super_admin) VALUES ($1,'!no-password-login','employee',$2) ON CONFLICT DO NOTHING", [email, !!opts.superAdmin]);
  const t = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(t), email]);
  tokens.push(sha(t));
  return t;
};
const call = async (tok, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${tok}`, "content-type": "application/json", origin: BASE }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, d: await r.json().catch(() => null) };
};
const profile = (pe, phone, dob, line, em) => ({
  primary: { dob, gender: "Prefer not to say", marital: "", blood: "O+" },
  contact: { personalEmail: pe, phone, emergencyName: em, emergencyRelation: "Sister", emergencyPhone: "9811122233" },
  addresses: { current: { line, city: "Pune", state: "Maharashtra", pin: "411001", country: "India" }, permanent: {} },
});
const raw = async (email) => (await db.query(
  `SELECT row_to_json(e)::text AS emp, (SELECT row_to_json(p)::text FROM profiles p WHERE lower(p.email)=lower(e.work_email)) AS prof,
          e.phone, e.address, e.dob, e.personal_email, e.pan_masked, e.person_sealed, e.personal_email_hash
     FROM employees e WHERE lower(work_email)=$1`, [email])).rows[0];
const wipe = async () => {
  await db.query("DELETE FROM sessions WHERE email = ANY($1) OR token_hash = ANY($2)", [[A, B, HR], tokens]);
  await db.query("DELETE FROM employee_ids WHERE lower(work_email) = ANY($1)", [[A, B]]).catch(() => {});
  await db.query("DELETE FROM profiles WHERE lower(email) = ANY($1)", [[A, B]]);
  await db.query("DELETE FROM audit_log WHERE lower(work_email) = ANY($1)", [[A, B]]);
  await db.query("DELETE FROM digital_kits WHERE employee_id IN (SELECT id FROM employees WHERE lower(work_email) = ANY($1))", [[A, B]]).catch(() => {});
  await db.query("DELETE FROM employees WHERE lower(work_email) = ANY($1)", [[A, B]]);
  await db.query("DELETE FROM users WHERE email = ANY($1)", [[A, B, HR]]);
};

try {
  await wipe();
  for (const [e, n, no] of [[A, "Asha Personal", "PF/1"], [B, "Ravi Personal", "PF/2"]]) {
    await db.query("INSERT INTO employees (emp_no, name, work_email, title, dept, start_date, status) VALUES ($1,$2,$3,'Engineer','Engineering','2025-04-01','active')", [no, n, e]);
  }
  const ta = await login(A), tb = await login(B), th = await login(HR, { superAdmin: true });

  // 1. A profile saved through the app: the person sees it all, the database holds none of it in the clear.
  let r = await call(ta, "PUT", "/api/profile", profile(AE, "9876511111", "1992-07-08", "5 Flow Lane", "Nisha Flow"));
  ok("Asha saves her profile", r.s === 200, JSON.stringify(r.d));
  r = await call(ta, "GET", "/api/profile");
  ok("she sees it as she typed it", r.s === 200 && r.d.contact.phone === "9876511111" && r.d.contact.personalEmail === AE && r.d.primary.dob === "1992-07-08"
    && r.d.contact.emergencyName === "Nisha Flow" && r.d.addresses.current.line === "5 Flow Lane", JSON.stringify(r.d));
  ok("and her date of birth from the employee record", r.d.employeeDob === "1992-07-08", r.d.employeeDob);
  let x = await raw(A);
  ok("the employee row keeps no phone, address, date of birth or personal email in plain columns", x.phone === null && x.address === null && x.dob === null && x.personal_email === null, JSON.stringify(x));
  ok("they are in the sealed column, with a hash of the personal email", /^s1:/.test(x.person_sealed) && /^[0-9a-f]{64}$/.test(x.personal_email_hash));
  ok("nothing she typed is readable anywhere in her employee row or profile row",
    !["9876511111", AE, "1992-07-08", "5 Flow Lane", "Nisha Flow", "9811122233"].some((s) => x.emp.includes(s) || (x.prof || "").includes(s)));
  r = await call(th, "GET", "/api/roster");
  const rowA = (r.d.people || r.d || []).find((p) => String(p.email || p.work_email).toLowerCase() === A);
  ok("the roster shows her phone from the employee record", rowA && rowA.phone === "9876511111", JSON.stringify(rowA));
  r = await call(ta, "GET", "/api/id-card.json");
  ok("her ID card shows her mobile and emergency contact", r.s === 200 && JSON.stringify(r.d).includes("9876511111") && JSON.stringify(r.d).includes("Nisha Flow"), JSON.stringify(r.d).slice(0, 300));

  // 2. A personal email belongs to one person, though it is stored encrypted.
  r = await call(tb, "PUT", "/api/profile", profile(AE.toUpperCase(), "9876522222", "1990-01-02", "9 Other Road", "Om Flow"));
  ok("Ravi cannot use Asha's personal email (any case)", r.s === 400 && /already belongs/.test(JSON.stringify(r.d)), JSON.stringify(r.d));
  r = await call(tb, "PUT", "/api/profile", profile(BE, "9876522222", "1990-01-02", "9 Other Road", "Om Flow"));
  ok("his own one is saved", r.s === 200, JSON.stringify(r.d));
  r = await call(ta, "PUT", "/api/profile", profile(AE, "9876511111", "1992-07-08", "5 Flow Lane", "Nisha Flow"));
  ok("Asha saving again with her own email is fine", r.s === 200, JSON.stringify(r.d));

  // 3. HR saves a PAN: only the masked form is kept, sealed beside the rest; the other details stay.
  r = await call(th, "PUT", "/api/employees/ids", { email: A, pan: "ABCDE1234F" });
  ok("HR saves Asha's PAN", r.s === 200, `${r.s} ${JSON.stringify(r.d)}`);
  r = await call(th, "GET", `/api/employees/ids?email=${encodeURIComponent(A)}`);
  ok("it shows masked", r.s === 200 && /^AB.*4F$/.test(r.d.pan) && !r.d.pan.includes("CDE123"), JSON.stringify(r.d));
  x = await raw(A);
  ok("the database has no PAN in a plain column, and the phone is still there, sealed", x.pan_masked === null && x.phone === null && !x.emp.includes("4F\""), JSON.stringify({ pan: x.pan_masked }));
  r = await call(ta, "GET", "/api/profile");
  ok("Asha still sees her phone and now her masked PAN", r.d.contact.phone === "9876511111" && /^AB.*4F$/.test(r.d.ids.pan), JSON.stringify(r.d.ids));

  // 4. An older release writes a phone plain after encryption: it wins, the rest still comes from the sealed copy.
  await db.query("UPDATE employees SET phone='9000000009' WHERE lower(work_email)=$1", [A]);
  r = await call(th, "GET", "/api/roster");
  const again = (r.d.people || r.d || []).find((p) => String(p.email || p.work_email).toLowerCase() === A);
  ok("the newer plain phone is shown", again && again.phone === "9000000009", JSON.stringify(again));
  r = await call(ta, "GET", "/api/profile");
  ok("and the date of birth and PAN still come from the sealed copy", r.d.employeeDob === "1992-07-08" && /^AB.*4F$/.test(r.d.ids.pan), JSON.stringify({ dob: r.d.employeeDob, ids: r.d.ids }));
  const { sealStoredSalaries } = await import("../src/payroll/sealing.js");
  const done = await sealStoredSalaries(db);
  x = await raw(A);
  ok("the start-up step seals it again, keeping the other fields", done.employees >= 1 && x.phone === null, JSON.stringify(done));
  r = await call(ta, "GET", "/api/profile");
  ok("after which every field reads back", r.d.employeeDob === "1992-07-08" && /^AB.*4F$/.test(r.d.ids.pan), JSON.stringify(r.d.ids));
  r = await call(th, "GET", "/api/roster");
  ok("including the newer phone", ((r.d.people || r.d || []).find((p) => String(p.email || p.work_email).toLowerCase() === A) || {}).phone === "9000000009");
} catch (e) {
  fail++; console.log("ERROR ", e.stack || e.message);
} finally {
  await wipe().catch((e) => console.log("cleanup:", e.message));
  await db.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
