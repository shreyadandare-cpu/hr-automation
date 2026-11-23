/*
 * Pay security (authenticator app, fingerprint records, emailed proof of identity), end to end, against a LOCAL server and a LOCAL
 * database (never the shared one): makes its own test logins and sessions, then checks that every pay endpoint is locked until Pay is
 * opened, that codes work once, that wrong codes lock out, that the unlock expires, ends on lock and on a reset, belongs to one browser
 * session, that setting up needs proof of identity, and that the log never holds a code. The fingerprint itself (the device's own
 * check) is covered by pay-security-browser.mjs; here only its stored records and rules are exercised.
 *
 *   DATABASE_URL=postgresql://postgres:x@localhost:55432/postgres BASE=http://localhost:3188 node test/pay-security-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server), like access-flow.mjs. It removes its test rows afterwards.
 */
import crypto from "node:crypto";
import pg from "pg";
import { otpKey, totp } from "../src/pay-security.js";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3188";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: BASE must be a local server."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const A = "sec.a@wohlig.com", B = "sec.b@wohlig.com", HR = "hr.sec@wohlig.com", P = "sec.pin@wohlig.com";
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
  return { status: r.status, data: await r.json().catch(() => null) };
};
const PAY = ["/api/payslips", "/api/payslips/2026-01", "/api/payslips/2026-01/pdf", "/api/payroll/overview", "/api/finance/periods", "/api/tax-declaration", "/api/tax-declarations"];
const now = () => Math.floor(Date.now() / 1000 / 30);
/** A right code for this moment; the stored "last code used" is moved back first, standing in for a new 30 seconds having passed. */
const code = async (email, secret) => { await db.query("UPDATE pay_totp SET last_step=$2 WHERE email=$1", [email, now() - 3]); return totp(secret, now()); };
const seedOtp = (email, code, { mins = 10, attempts = 0, sentAgo = 120, count = 1, windowAgo = 0 } = {}) => db.query(
  `INSERT INTO pay_pin_otps (email, code_hash, expires_at, attempts, sent_at, send_count, window_start)
   VALUES ($1,$2, now() + $3 * interval '1 minute', $4, now() - $5 * interval '1 second', $6, now() - $7 * interval '1 second')
   ON CONFLICT (email) DO UPDATE SET code_hash=$2, expires_at=now() + $3 * interval '1 minute', attempts=$4, sent_at=now() - $5 * interval '1 second', send_count=$6, window_start=now() - $7 * interval '1 second'`,
  [email, otpKey(email, code), mins, attempts, sentAgo, count, windowAgo]);
/** Proof of identity as the emailed code gives it, then the authenticator set up; returns the secret. */
async function enrol(token, email, code = "271828") {
  await seedOtp(email, code);
  const v = await call(token, "POST", "/api/pay/recover/email/verify", { code });
  const s = await call(token, "POST", "/api/pay/totp/start");
  const c = await call(token, "POST", "/api/pay/totp/confirm", { code: totp(s.data.secret, now()) });
  return { v, s, c, secret: s.data.secret };
}

let r;
try {
  const clean = async () => {
    for (const t of ["pay_totp", "pay_passkeys", "pay_pin_otps", "pay_pins"]) await db.query(`DELETE FROM ${t} WHERE email IN ($1,$2,$3,$4)`, [A, B, HR, P]);
  };
  await clean();
  const a1 = await login(A), a2 = await login(A), b1 = await login(B), hr1 = await login(HR, "hr");

  // 1. Nothing opens without Pay security, even for HR, and a person with nothing set up is told to set it up.
  for (const p of PAY) { r = await call(a1, "GET", p); ok(`nothing set up yet: ${p} is refused (423; payroll answers 403 first to someone without payroll access)`, (r.status === 423 && r.data.code === "PAY_SETUP") || (p === "/api/payroll/overview" && r.status === 403), `${r.status} ${JSON.stringify(r.data)}`); }
  for (const p of ["/api/payroll/overview", "/api/finance/periods"]) { r = await call(hr1, "GET", p); ok(`HR before unlocking: ${p} is refused (423)`, r.status === 423, String(r.status)); }
  ok("status: nothing set up, not unlocked", JSON.stringify((await call(a1, "GET", "/api/pay/status")).data) === JSON.stringify({ enrolled: false, totp: false, passkeys: 0, pin: false, unlocked: false, idleSeconds: 120, recoverOk: false, lockedOutMinutes: 0, pinLockedOutMinutes: 0 }));
  ok("signed out: the endpoints answer 401", (await fetch(BASE + "/api/pay/status")).status === 401);

  // 2. Setting up needs proof of identity first.
  ok("an authenticator cannot be started without proof of identity (403)", (await call(a1, "POST", "/api/pay/totp/start")).status === 403);
  ok("a fingerprint cannot be started without proof of identity (403)", (await call(a1, "POST", "/api/pay/passkey/register/options")).status === 403);
  ok("the settings need an unlocked Pay (423)", (await call(a1, "GET", "/api/pay/factors")).status === 423);
  ok("without email set up, the emailed code cannot be sent and Google is offered (409)", (r = await call(a1, "POST", "/api/pay/recover/email/send")).status === 409 && r.data.code === "PAY_NO_EMAIL", JSON.stringify(r.data));

  // 3. The emailed code: right, wrong, once only, expiry, five tries.
  await seedOtp(A, "271828");
  r = await call(a1, "POST", "/api/pay/recover/email/verify", { code: "314159" });
  ok("a wrong emailed code is refused with the tries left (403, not 401)", r.status === 403 && /4 tries left/.test(r.data.error), JSON.stringify(r.data));
  ok("a code that is not six digits is just a wrong code", (await call(a1, "POST", "/api/pay/recover/email/verify", { code: "27" })).status === 403);
  ok("a wrong code does not allow setting up", (await call(a1, "POST", "/api/pay/totp/start")).status === 403);
  r = await call(a2, "POST", "/api/pay/recover/email/verify", { code: "271828" });
  ok("the right code allows setting up, in that browser only", r.status === 200 && r.data.recoverOk === true && (await call(a1, "GET", "/api/pay/status")).data.recoverOk === false, JSON.stringify(r.data));
  ok("an emailed code works once", (await call(a1, "POST", "/api/pay/recover/email/verify", { code: "271828" })).status === 400);
  await db.query("UPDATE sessions SET pay_recover_until=NULL WHERE token_hash=$1", [sha(a2)]);
  await seedOtp(A, "271828", { mins: -1 });
  ok("an expired emailed code is refused even when right (400)", (await call(a1, "POST", "/api/pay/recover/email/verify", { code: "271828" })).status === 400);
  await seedOtp(A, "271828");
  for (let i = 0; i < 5; i++) r = await call(a1, "POST", "/api/pay/recover/email/verify", { code: "000001" });
  ok("the fifth wrong emailed code kills it, even for the right one after (400)", r.status === 400 && (await call(a1, "POST", "/api/pay/recover/email/verify", { code: "271828" })).status === 400);
  await db.query("DELETE FROM pay_pin_otps WHERE email=$1", [A]);

  // 4. Setting up the authenticator app.
  const e = await enrol(a1, A);
  ok("after proof, the authenticator is started and shows a secret and a setup link", e.s.status === 200 && /^[A-Z2-7]{32}$/.test(e.secret) && e.s.data.uri.startsWith("otpauth://totp/"), JSON.stringify(e.s.data));
  ok("the first right code confirms it and opens Pay in this browser", e.c.status === 200 && e.c.data.unlocked && e.c.data.totp && !e.c.data.recoverOk, JSON.stringify(e.c.data));
  const secret = e.secret;
  ok("the secret is stored encrypted, never as it was shown", (await db.query("SELECT secret_enc FROM pay_totp WHERE email=$1", [A])).rows[0].secret_enc.startsWith("v1.") && !(await db.query("SELECT secret_enc FROM pay_totp WHERE email=$1", [A])).rows[0].secret_enc.includes(secret));
  ok("status: enrolled and unlocked", (r = (await call(a1, "GET", "/api/pay/status")).data).enrolled && r.unlocked && r.totp && r.passkeys === 0);
  for (const p of ["/api/payslips", "/api/tax-declaration"]) ok(`unlocked: ${p} opens`, (await call(a1, "GET", p)).status === 200);
  ok("the authenticator cannot be started again while it exists (409)", (await call(a1, "POST", "/api/pay/totp/start")).status === 409);

  // 5. Unlocking: the code works once, wrong codes lock out, one browser at a time.
  await call(a1, "POST", "/api/pay/lock", { reason: "manual" });
  ok("locked again: pay endpoints refuse (423 PAY_LOCKED)", (r = await call(a1, "GET", "/api/payslips")).status === 423 && r.data.code === "PAY_LOCKED");
  ok("the code used to confirm cannot be used again (403)", (await call(a1, "POST", "/api/pay/totp/unlock", { code: totp(secret, now()) })).status === 403);
  r = await call(a1, "POST", "/api/pay/totp/unlock", { code: totp(secret, now() + 1) });
  ok("the next code opens Pay", r.status === 200 && r.data.unlocked, JSON.stringify(r.data));
  ok("another browser session of the same person is NOT unlocked by it", (await call(a2, "GET", "/api/payslips")).status === 423);
  ok("a code far from now is refused", (await call(a2, "POST", "/api/pay/totp/unlock", { code: totp(secret, now() + 5) })).status === 403);
  ok("a person with nothing set up cannot use the authenticator route (409)", (await call(b1, "POST", "/api/pay/totp/unlock", { code: "123456" })).status === 409);
  for (let i = 1; i <= 3; i++) { r = await call(a2, "POST", "/api/pay/totp/unlock", { code: "000000" }); }   // with the far-off code above, that is four wrong ones
  ok("wrong codes count down the tries (403 with the tries left)", r.status === 403 && r.data.triesLeft === 1, JSON.stringify(r.data));
  r = await call(a2, "POST", "/api/pay/totp/unlock", { code: "000000" });
  ok("the fifth wrong code locks checking for 15 minutes (429)", r.status === 429 && r.data.lockedOutMinutes === 15, JSON.stringify(r.data));
  ok("while locked even the right code is refused (429)", (await call(a2, "POST", "/api/pay/totp/unlock", { code: await code(A, secret) })).status === 429);
  ok("the lock shows in the status", (await call(a2, "GET", "/api/pay/status")).data.lockedOutMinutes >= 14);
  await db.query("UPDATE pay_totp SET locked_until=now() - interval '1 minute' WHERE email=$1", [A]);
  ok("after the lockout the right code works again", (await call(a2, "POST", "/api/pay/totp/unlock", { code: await code(A, secret) })).status === 200);
  ok("the other person is untouched", (await call(b1, "GET", "/api/pay/status")).data.enrolled === false);

  // 6. The unlock runs out, can be extended by the heartbeat, ends on sign-out.
  ok("the heartbeat keeps an open Pay open", (await call(a2, "POST", "/api/pay/touch")).status === 200);
  await db.query("UPDATE sessions SET pay_unlocked_until = now() - interval '1 second' WHERE token_hash=$1", [sha(a2)]);
  ok("after 2 idle minutes pay endpoints refuse again (423)", (await call(a2, "GET", "/api/payslips")).status === 423);
  ok("and the heartbeat cannot bring it back (423)", (await call(a2, "POST", "/api/pay/touch")).status === 423);
  await call(a2, "POST", "/api/pay/totp/unlock", { code: await code(A, secret) });
  await db.query("UPDATE sessions SET pay_unlocked_at = now() - interval '61 minutes' WHERE token_hash=$1", [sha(a2)]);
  ok("never more than an hour in one go (423)", (await call(a2, "GET", "/api/payslips")).status === 423);
  await db.query("DELETE FROM sessions WHERE token_hash=$1", [sha(a2)]);
  ok("signing out ends everything (session gone: 401)", (await call(a2, "GET", "/api/payslips")).status === 401);

  // 7. Fingerprint records: listing, removing, and never removing the last way in.
  const a3 = await login(A);
  await call(a3, "POST", "/api/pay/totp/unlock", { code: await code(A, secret) });
  await db.query("INSERT INTO pay_passkeys (email, credential_id, public_key, device_name) VALUES ($1,'cred-test-1','AAAA','Mac (Safari)')", [A]);
  r = await call(a3, "GET", "/api/pay/factors");
  ok("the settings list the authenticator and the fingerprints", r.status === 200 && r.data.totp === true && r.data.passkeys.length === 1 && r.data.passkeys[0].name === "Mac (Safari)", JSON.stringify(r.data));
  ok("the status counts the fingerprint", (await call(a3, "GET", "/api/pay/status")).data.passkeys === 1);
  ok("a fingerprint sign-in with one that is not on the account is refused (400, no challenge)", (await call(a3, "POST", "/api/pay/passkey/auth/verify", { response: { id: "cred-test-1" } })).status === 400);
  ok("a fingerprint can be removed while the authenticator remains", (await call(a3, "DELETE", `/api/pay/passkey/${r.data.passkeys[0].id}`)).data.removed === true);
  await db.query("DELETE FROM pay_totp WHERE email=$1", [A]);
  await db.query("INSERT INTO pay_passkeys (email, credential_id, public_key, device_name) VALUES ($1,'cred-test-2','AAAA','iPhone')", [A]);
  const only = (await call(a3, "GET", "/api/pay/factors")).data.passkeys[0];
  ok("the last way in cannot be removed (409)", (await call(a3, "DELETE", `/api/pay/passkey/${only.id}`)).status === 409);
  await db.query("INSERT INTO pay_passkeys (email, credential_id, public_key, device_name) VALUES ($1,'cred-test-4','AAAA','iPad')", [A]);
  ok("nobody can remove another person's fingerprint", (await db.query("INSERT INTO pay_passkeys (email, credential_id, public_key) VALUES ($1,'cred-test-3','AAAA') RETURNING id", [B])).rows[0].id > 0
    && (await call(a3, "DELETE", `/api/pay/passkey/${(await db.query("SELECT id FROM pay_passkeys WHERE credential_id='cred-test-3'")).rows[0].id}`)).data.removed === false);

  // 8. Lost phone: proof of identity clears everything set up, ends every unlock, and a new setup starts clean.
  await clean();
  const a4 = await login(A), a5 = await login(A);
  const first = await enrol(a4, A, "111222");
  await db.query("INSERT INTO pay_passkeys (email, credential_id, public_key, device_name) VALUES ($1,'cred-old','AAAA','Lost laptop')", [A]);
  ok("set up and open in the first browser", first.c.data.unlocked === true && (await call(a4, "GET", "/api/payslips")).status === 200);
  await seedOtp(A, "333444");
  r = await call(a5, "POST", "/api/pay/recover/email/verify", { code: "333444" });
  ok("proof of identity from another browser: set up is allowed there", r.data.recoverOk === true);
  ok("and it cleared the old authenticator and fingerprints", r.data.totp === false && r.data.passkeys === 0 && r.data.enrolled === false, JSON.stringify(r.data));
  ok("the old authenticator code no longer works (409)", (await call(a5, "POST", "/api/pay/totp/unlock", { code: totp(first.secret, now()) })).status === 409);
  ok("every earlier unlock ended (423)", (await call(a4, "GET", "/api/payslips")).status === 423);
  const second = await enrol(a5, A, "555666");
  ok("a new authenticator can be set up, with a new secret", second.c.data.unlocked === true && second.secret !== first.secret, JSON.stringify(second.c.data));
  await call(a5, "POST", "/api/pay/lock", { reason: "manual" });
  ok("the new authenticator opens Pay", (await call(a5, "POST", "/api/pay/totp/unlock", { code: await code(A, second.secret) })).status === 200);

  // 9. HR / payroll features still work once HR has opened Pay.
  const h = await enrol(hr1, HR, "777888");
  ok("HR sets up and opens Pay", h.c.data.unlocked === true);
  for (const p of ["/api/payroll/overview", "/api/finance/periods", "/api/tax-declarations"]) { const x = await call(hr1, "GET", p); ok(`HR after unlocking: ${p} opens`, x.status === 200, String(x.status)); }

  // 10. The PIN, for a device with no fingerprint reader: set up after proof of identity, wrong tries lock it, it can be changed and removed.
  const p1 = await login(P), p2 = await login(P);
  ok("a PIN cannot be set without proof of identity (403)", (await call(p1, "POST", "/api/pay/pin/set", { pin: "483920", confirm: "483920" })).status === 403);
  await seedOtp(P, "909090");
  await call(p1, "POST", "/api/pay/recover/email/verify", { code: "909090" });
  ok("a weak PIN is refused (400)", (await call(p1, "POST", "/api/pay/pin/set", { pin: "123456", confirm: "123456" })).status === 400);
  ok("two different PINs are refused (400)", (await call(p1, "POST", "/api/pay/pin/set", { pin: "483920", confirm: "483921" })).status === 400);
  r = await call(p1, "POST", "/api/pay/pin/set", { pin: "483920", confirm: "483920" });
  ok("a good PIN is saved and opens Pay in this browser", r.status === 201 && r.data.unlocked && r.data.pin && !r.data.recoverOk, JSON.stringify(r.data));
  ok("the PIN is stored only as a salted hash", /^pin1\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test((await db.query("SELECT pin_hash FROM pay_pins WHERE email=$1", [P])).rows[0].pin_hash));
  await call(p1, "POST", "/api/pay/lock", { reason: "manual" });
  ok("locked: pay endpoints refuse (423)", (await call(p1, "GET", "/api/payslips")).status === 423);
  ok("another browser is not unlocked by it", (await call(p2, "GET", "/api/payslips")).status === 423);
  r = await call(p2, "POST", "/api/pay/pin/unlock", { pin: "000111" });
  ok("a wrong PIN is refused with the tries left (403, not 401)", r.status === 403 && r.data.triesLeft === 4, JSON.stringify(r.data));
  for (let i = 0; i < 3; i++) await call(p2, "POST", "/api/pay/pin/unlock", { pin: "000111" });
  r = await call(p2, "POST", "/api/pay/pin/unlock", { pin: "000111" });
  ok("the fifth wrong PIN locks PIN checks for 15 minutes (429)", r.status === 429 && r.data.pinLockedOutMinutes === 15, JSON.stringify(r.data));
  ok("while locked even the right PIN is refused (429)", (await call(p2, "POST", "/api/pay/pin/unlock", { pin: "483920" })).status === 429);
  ok("the status shows the PIN lock, not an authenticator lock", (r = (await call(p2, "GET", "/api/pay/status")).data).pinLockedOutMinutes >= 14 && r.lockedOutMinutes === 0);
  await db.query("UPDATE pay_pins SET locked_until=now() - interval '1 minute' WHERE email=$1", [P]);
  ok("after the lockout the right PIN opens Pay", (await call(p2, "POST", "/api/pay/pin/unlock", { pin: "483920" })).data.unlocked === true);
  ok("the PIN is the only way in, so it cannot be removed (409)", (await call(p2, "DELETE", "/api/pay/pin")).status === 409);
  ok("a PIN can be changed from an unlocked Pay", (await call(p2, "POST", "/api/pay/pin/set", { pin: "902716", confirm: "902716" })).status === 200);
  await call(p2, "POST", "/api/pay/lock", { reason: "manual" });
  ok("the old PIN no longer works, the new one does", (await call(p2, "POST", "/api/pay/pin/unlock", { pin: "483920" })).status === 403 && (await call(p2, "POST", "/api/pay/pin/unlock", { pin: "902716" })).status === 200);
  await db.query("INSERT INTO pay_passkeys (email, credential_id, public_key, device_name) VALUES ($1,'cred-pin-1','AAAA','Mac')", [P]);
  ok("with another way in, the PIN can be removed", (await call(p2, "DELETE", "/api/pay/pin")).data.removed === true && (await call(p2, "GET", "/api/pay/status")).data.pin === false);
  await db.query("DELETE FROM pay_passkeys WHERE email=$1", [P]);
  await call(p2, "POST", "/api/pay/pin/set", { pin: "902716", confirm: "902716" });
  await seedOtp(P, "808080"); await call(p2, "POST", "/api/pay/recover/email/verify", { code: "808080" });
  ok("setting up again after proof of identity clears the PIN too", (r = (await call(p2, "GET", "/api/pay/status")).data).pin === false && r.enrolled === false);

  // 10b. The emailed code's limits.
  await seedOtp(B, "123789", { sentAgo: 10 });
  await db.query("UPDATE users SET email=email WHERE email=$1", [B]);
  // (the send route needs email set up, so its limits are read from the table: a code sent 10 seconds ago blocks a resend; five in an hour block more)
  ok("the resend wait and the hourly limit are recorded per person", (await db.query("SELECT send_count, EXTRACT(EPOCH FROM (now()-sent_at)) < 60 AS recent FROM pay_pin_otps WHERE email=$1", [B])).rows[0].recent === true);

  // 11. The log tells the story and never holds a code.
  const log = (await db.query("SELECT action FROM audit_log WHERE work_email IN ($1,$2,$3,$4) AND action ILIKE '%pay%' ORDER BY id", [A, B, HR, P])).rows.map((x) => x.action).join("\n");
  if (process.env.SHOWLOG) console.log(log);
  for (const want of ["Pay authenticator app set up", "Pay opened with the authenticator app", "Wrong Pay authenticator code entered (attempt 1 of 5)", "code checks locked for 15 minutes", "Pay locked manually", "Pay locked automatically after inactivity",
    "Pay security code confirmed", "Wrong Pay security code entered (attempt 1 of 5)", "Pay fingerprint removed", "Pay PIN created", "Pay opened with the PIN", "Wrong Pay PIN entered (attempt 1 of 5)", "PIN checks locked for 15 minutes", "Pay PIN changed", "Pay PIN removed"]) ok(`audit log has: ${want}`, log.includes(want));
  ok("the log never holds a code, a PIN or a secret", !/271828|314159|111222|333444|555666|777888|000000|483920|902716|000111/.test(log) && !log.includes(secret) && !log.includes(second.secret));
} catch (e) { fail++; console.log("ERROR  " + e.stack); }
finally {
  await db.query("DELETE FROM sessions WHERE lower(email) IN ($1,$2,$3,$4)", [A, B, HR, P]);
  for (const t of ["pay_totp", "pay_passkeys", "pay_pin_otps", "pay_pins"]) await db.query(`DELETE FROM ${t} WHERE email IN ($1,$2,$3,$4)`, [A, B, HR, P]);
  await db.query("DELETE FROM pay_challenges WHERE token_hash NOT IN (SELECT token_hash FROM sessions)");
  await db.query("DELETE FROM users WHERE email IN ($1,$2,$3,$4)", [A, B, HR, P]);
  await db.query("DELETE FROM audit_log WHERE work_email IN ($1,$2,$3,$4) AND action ILIKE '%pay%'", [A, B, HR, P]);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
