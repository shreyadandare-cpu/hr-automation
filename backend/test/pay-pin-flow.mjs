/*
 * Pay PIN, end to end, against a LOCAL server and a LOCAL database (never the shared one): makes its own test logins and sessions,
 * then checks that every pay endpoint is locked until the PIN is entered, that wrong PINs lock out, that the unlock expires,
 * ends on lock and on a reset, belongs to one browser session, and that the log never holds a PIN.
 *
 *   DATABASE_URL=postgresql://postgres:x@localhost:55432/postgres BASE=http://localhost:3188 node test/pay-pin-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server), like access-flow.mjs. It removes its test rows afterwards.
 */
import crypto from "node:crypto";
import pg from "pg";
import { otpKey } from "../src/pay-pin.js";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3188";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: BASE must be a local server."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const A = "pin.a@wohlig.com", B = "pin.b@wohlig.com", HR = "hr.test@wohlig.com";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };

async function login(email, role = "employee") {
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x',$2) ON CONFLICT DO NOTHING", [email, role]);
  if (role === "hr") await db.query("UPDATE users SET is_super_admin=true WHERE email=$1", [email]);   // access is by grants now; a super admin may open payroll, finance and tax pages
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(token), email]);
  return token;
}
const call = async (token, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null), text: "" };
};
const PAY = ["/api/payslips", "/api/payslips/2026-01", "/api/payslips/2026-01/pdf", "/api/payroll/overview", "/api/finance/periods", "/api/tax-declaration", "/api/tax-declarations"];

try {
  await db.query("DELETE FROM pay_pins WHERE email IN ($1,$2,$3)", [A, B, HR]);
  const a1 = await login(A), a2 = await login(A), b1 = await login(B), hr1 = await login(HR, "hr");

  // 1. Nothing opens without the PIN, even for HR, and a person with no PIN is told to create one.
  for (const p of PAY) { const r = await call(a1, "GET", p); ok(`no PIN yet: ${p} is refused (423; payroll answers 403 first to someone without payroll access)`, (r.status === 423 && r.data.code === "PAY_SETUP") || (p === "/api/payroll/overview" && r.status === 403), `${r.status} ${JSON.stringify(r.data)}`); }
  for (const p of ["/api/payroll/overview", "/api/finance/periods"]) { const r = await call(hr1, "GET", p); ok(`HR before unlocking: ${p} is refused (423)`, r.status === 423, String(r.status)); }
  ok("no cookie at all: 401, not 423", (await fetch(BASE + "/api/payslips")).status === 401);
  ok("status: not set, not unlocked", JSON.stringify((await call(a1, "GET", "/api/pay/status")).data) === JSON.stringify({ pinSet: false, unlocked: false, idleSeconds: 120, recoverOk: false, lockedOutMinutes: 0 }));

  // 2. Setting the PIN: it must be six digits, not guessable, and typed twice.
  for (const [pin, confirm, label] of [["12345", "12345", "5 digits"], ["12345a", "12345a", "letters"], ["123456", "123456", "123456"], ["000000", "000000", "000000"], ["483920", "483921", "mismatch"]]) {
    const r = await call(a1, "POST", "/api/pay/pin", { pin, confirm }); ok(`setup refuses ${label}`, r.status === 400 && r.data.error, String(r.status));
  }
  ok("a PIN still not set after refusals", (await call(a1, "GET", "/api/pay/status")).data.pinSet === false);
  const set = await call(a1, "POST", "/api/pay/pin", { pin: "483920", confirm: "483920" });
  ok("setup accepts a good PIN and unlocks this browser", set.status === 201 && set.data.pinSet && set.data.unlocked);
  const row = (await db.query("SELECT pin_hash FROM pay_pins WHERE email=$1", [A])).rows[0];
  ok("only a salted hash is stored", /^pin1\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(row.pin_hash) && !row.pin_hash.includes("483920"));
  ok("the hash is never sent to the browser", !JSON.stringify(set.data).includes(row.pin_hash.slice(8, 30)) && !("pin_hash" in set.data));
  ok("a second setup is refused", (await call(a1, "POST", "/api/pay/pin", { pin: "902716", confirm: "902716" })).status === 409);

  // 3. Unlocked: this session opens pay. Another browser session of the same person, and other people, do not.
  const mine = await call(a1, "GET", "/api/payslips");
  ok("unlocked: own payslips list opens", mine.status === 200, String(mine.status));
  ok("another session of the same person is still locked", (await call(a2, "GET", "/api/payslips")).status === 423);
  ok("another person is still locked", (await call(b1, "GET", "/api/payslips")).status === 423);
  ok("unlocked: someone else's payslip is still refused by role (403)", (await call(a1, "GET", `/api/payslips?email=${B}`)).status === 403);
  ok("unlocked: payroll is still refused to an employee by role (403)", (await call(a1, "GET", "/api/payroll/overview")).status === 403);

  // 4. Wrong PINs: counted, then a lockout that even the right PIN cannot beat; the lockout ends.
  let r;
  for (let i = 1; i <= 4; i++) { r = await call(a2, "POST", "/api/pay/unlock", { pin: "111222" }); ok(`wrong PIN ${i} answers 403 with tries left`, r.status === 403 && r.data.triesLeft === 5 - i, JSON.stringify(r.data)); }
  r = await call(a2, "POST", "/api/pay/unlock", { pin: "111222" });
  ok("the 5th wrong PIN starts a lockout (429)", r.status === 429 && r.data.lockedOutMinutes === 15, JSON.stringify(r.data));
  r = await call(a2, "POST", "/api/pay/unlock", { pin: "483920" });
  ok("during the lockout even the right PIN is refused (429)", r.status === 429);
  ok("and pay stays locked", (await call(a2, "GET", "/api/payslips")).status === 423);
  await db.query("UPDATE pay_pins SET locked_until = now() - interval '1 minute' WHERE email=$1", [A]);
  r = await call(a2, "POST", "/api/pay/unlock", { pin: "483920" });
  ok("after the lockout the right PIN works (second browser)", r.status === 200 && r.data.unlocked, JSON.stringify(r.data));
  ok("a PIN that is not six digits is just wrong, never an error", (await call(a2, "POST", "/api/pay/unlock", { pin: "abc" })).status === 403);

  // 5. Locking: manual, and after two idle minutes on the server (no heartbeat).
  ok("heartbeat keeps it open", (await call(a1, "POST", "/api/pay/touch")).status === 200);
  ok("Lock Pay locks it", (await call(a1, "POST", "/api/pay/lock", { reason: "manual" })).status === 200 && (await call(a1, "GET", "/api/payslips")).status === 423);
  ok("a heartbeat after locking does not reopen it", (await call(a1, "POST", "/api/pay/touch")).status === 423);
  ok("the same PIN opens it again", (await call(a1, "POST", "/api/pay/unlock", { pin: "483920" })).status === 200);
  await db.query("UPDATE sessions SET pay_unlocked_until = now() - interval '1 second' WHERE token_hash=$1", [sha(a1)]);
  ok("two idle minutes (simulated on the server) lock it", (await call(a1, "GET", "/api/payslips")).status === 423);
  await call(a1, "POST", "/api/pay/unlock", { pin: "483920" });
  await db.query("UPDATE sessions SET pay_unlocked_at = now() - interval '61 minutes' WHERE token_hash=$1", [sha(a1)]);
  ok("one hour in a row is the longest unlock, even with activity", (await call(a1, "POST", "/api/pay/touch")).status === 423);
  await call(a1, "POST", "/api/pay/unlock", { pin: "483920" });
  await db.query("DELETE FROM sessions WHERE token_hash=$1", [sha(a1)]);
  ok("signing out ends everything (session gone: 401)", (await call(a1, "GET", "/api/payslips")).status === 401);

  // 6. Forgot PIN: not without a fresh Google confirmation, and then only for oneself; all other unlocks end.
  const a3 = await login(A);
  await call(a3, "POST", "/api/pay/unlock", { pin: "483920" });
  r = await call(a3, "POST", "/api/pay/recover/reset", { pin: "902716", confirm: "902716" });
  ok("reset without confirming with Google is refused (403)", r.status === 403 && r.data.code === "PAY_RECOVER_NEEDED");
  ok("the old PIN still works afterwards", (await call(a3, "POST", "/api/pay/unlock", { pin: "483920" })).status === 200);
  ok("the Google confirmation needs a signed-in session", (await fetch(BASE + "/auth/google/pay-recover", { redirect: "manual" })).headers.get("location")?.includes("paypin=google_off"));
  const go = (await fetch(BASE + "/auth/google/pay-recover", { redirect: "manual", headers: { cookie: `sid=${a3}` } })).headers.get("location") || "";
  ok("Forgot PIN sends a signed-in person to Google, asking for a fresh sign-in (or says Google is off)", /accounts\.google\.com.*prompt=login.*max_age=0/.test(go) || go.includes("paypin=google_off"), go);
  await db.query("UPDATE sessions SET pay_recover_until = now() + interval '5 minutes' WHERE token_hash=$1", [sha(a3)]);   // what a fresh Google sign-in as this person does
  ok("after confirmation a weak new PIN is still refused", (await call(a3, "POST", "/api/pay/recover/reset", { pin: "123456", confirm: "123456" })).status === 400);
  r = await call(a3, "POST", "/api/pay/recover/reset", { pin: "902716", confirm: "902716" });
  ok("after confirmation a new PIN can be set and this browser is unlocked", r.status === 200 && r.data.unlocked);
  ok("the old PIN no longer works", (await call(a2, "POST", "/api/pay/unlock", { pin: "483920" })).status === 403);
  ok("the other browser's earlier unlock ended with the reset", (await call(a2, "GET", "/api/payslips")).status === 423);
  ok("the new PIN works", (await call(a2, "POST", "/api/pay/unlock", { pin: "902716" })).status === 200);
  ok("another person's PIN is untouched", (await call(b1, "GET", "/api/pay/status")).data.pinSet === false);
  ok("the confirmation is single use", (await call(a3, "POST", "/api/pay/recover/reset", { pin: "573920", confirm: "573920" })).status === 403);


  // 6b. Forgot PIN by email: a 6-digit code for the signed-in person only; 5 tries, 10 minutes, once, one resend a minute, 5 an hour.
  const seed = (email, code, { mins = 10, attempts = 0, sentAgo = 120, count = 1, windowAgo = 0 } = {}) => db.query(
    `INSERT INTO pay_pin_otps (email, code_hash, expires_at, attempts, sent_at, send_count, window_start)
     VALUES ($1,$2, now() + $3 * interval '1 minute', $4, now() - $5 * interval '1 second', $6, now() - $7 * interval '1 second')
     ON CONFLICT (email) DO UPDATE SET code_hash=$2, expires_at=now() + $3 * interval '1 minute', attempts=$4, sent_at=now() - $5 * interval '1 second', send_count=$6, window_start=now() - $7 * interval '1 second'`,
    [email, otpKey(email, code), mins, attempts, sentAgo, count, windowAgo]);
  const e1 = await login(A), e2 = await login(A);
  ok("without email set up, the code cannot be sent and Google is offered (409)", (r = await call(e1, "POST", "/api/pay/recover/email/send")).status === 409 && r.data.code === "PAY_NO_EMAIL", JSON.stringify(r.data));
  ok("no code has been asked for: verify is refused (400)", (r = await call(e1, "POST", "/api/pay/recover/email/verify", { code: "123456" })).status === 400 && r.data.code === "PAY_OTP_EXPIRED");
  await seed(A, "271828");
  r = await call(e1, "POST", "/api/pay/recover/email/verify", { code: "314159" });
  ok("a wrong code is refused with the tries left (403, not 401)", r.status === 403 && /4 tries left/.test(r.data.error), JSON.stringify(r.data));
  ok("a wrong code does not open the reset step", (await call(e1, "POST", "/api/pay/recover/reset", { pin: "902716", confirm: "902716" })).status === 403);
  ok("a code that is not six digits is just a wrong code", (await call(e1, "POST", "/api/pay/recover/email/verify", { code: "27" })).status === 403);
  r = await call(e2, "POST", "/api/pay/recover/email/verify", { code: "271828" });
  ok("the right code opens the reset step", r.status === 200 && r.data.recoverOk === true, JSON.stringify(r.data));
  ok("the other browser session of that person did not get the reset step", (await call(e1, "GET", "/api/pay/status")).data.recoverOk === false);
  ok("a code works once", (await call(e1, "POST", "/api/pay/recover/email/verify", { code: "271828" })).status === 400);
  await db.query("UPDATE sessions SET pay_recover_until=NULL WHERE token_hash=$1", [sha(e2)]);
  await seed(A, "271828", { mins: -1 });
  ok("an expired code is refused even when right (400)", (await call(e1, "POST", "/api/pay/recover/email/verify", { code: "271828" })).status === 400);
  await seed(A, "271828");
  for (let i = 0; i < 5; i++) r = await call(e1, "POST", "/api/pay/recover/email/verify", { code: "000001" });
  ok("the fifth wrong code kills the code (400)", r.status === 400 && r.data.code === "PAY_OTP_EXPIRED", JSON.stringify(r.data));
  ok("then even the right code is refused", (await call(e1, "POST", "/api/pay/recover/email/verify", { code: "271828" })).status === 400);
  ok("a person with no PIN yet cannot ask (409)", (r = await call(b1, "POST", "/api/pay/recover/email/send")).status === 409);
  await db.query("DELETE FROM pay_pin_otps WHERE email IN ($1,$2)", [A, B]);

  // 7. HR / payroll features still work once HR has unlocked.
  await call(hr1, "POST", "/api/pay/pin", { pin: "358024", confirm: "358024" });
  for (const p of ["/api/payroll/overview", "/api/finance/periods", "/api/tax-declarations"]) { const x = await call(hr1, "GET", p); ok(`HR after unlocking: ${p} opens`, x.status === 200, String(x.status)); }

  // 8. The log tells the story and never holds a PIN.
  const log = (await db.query("SELECT action FROM audit_log WHERE work_email IN ($1,$2,$3) AND action ILIKE '%pay%' ORDER BY id", [A, B, HR])).rows.map((x) => x.action).join("\n");
  for (const want of ["Pay PIN created", "Pay PIN verified", "Wrong Pay PIN entered (attempt 1 of 5)", "PIN checks locked for 15 minutes", "Pay locked manually", "Pay locked automatically after inactivity", "Pay PIN reset after confirming identity", "Pay PIN reset code confirmed", "Wrong Pay PIN reset code entered (attempt 1 of 5)"]) ok(`audit log has: ${want}`, log.includes(want));
  ok("the log never holds a PIN", !/483920|902716|358024|111222/.test(log));
} catch (e) { fail++; console.log("ERROR  " + e.stack); }
finally {
  await db.query("DELETE FROM sessions WHERE lower(email) IN ($1,$2,$3)", [A, B, HR]);
  await db.query("DELETE FROM pay_pins WHERE email IN ($1,$2,$3)", [A, B, HR]);
  await db.query("DELETE FROM pay_pin_otps WHERE email IN ($1,$2,$3)", [A, B, HR]);
  await db.query("DELETE FROM users WHERE email IN ($1,$2)", [A, B]);
  await db.query("DELETE FROM audit_log WHERE work_email IN ($1,$2,$3) AND action ILIKE '%pay%'", [A, B, HR]);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
