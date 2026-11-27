/*
 * Office internet and fingerprint or face confirmation for web punches, end to end, against a LOCAL server and database (never
 * the shared one). The phone's passkey is made here with Node's crypto and answers exactly as a browser would, so the server's
 * checks run in full. Covers: both are off by default and change nothing; a punch from a listed office internet needs no
 * location; "optional" asks only people who set up a passkey; "required" asks everyone to set one up; a replayed or forged
 * answer is refused; people see and remove only their own passkeys.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/punch-confirm-flow.mjs
 *
 * Not part of `npm test`. HR's clock-in settings are put back as they were; the test people and office are clearly named and
 * removed afterwards.
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest();
const hex = (s) => sha(s).toString("hex");
const u = (b) => Buffer.from(b).toString("base64url");
const HR = "test.confirm.hr@wohlig.com", EMP = "test.confirm.employee@wohlig.com", OTHER = "test.confirm.other@wohlig.com";
const ALL = [HR, EMP, OTHER], OFFICE = "Confirm test office (Mumbai)";
const NEAR = { lat: 19.0765, lng: 72.8777, accuracy: 15 };
const RP = new URL(BASE).hostname;
let pass = 0, fail = 0, saved = null, empId = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
async function login(email, perms = []) {
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x','employee') ON CONFLICT DO NOTHING", [email]);
  for (const p of perms) await db.query("INSERT INTO access_grants (email, permission, scope, granted_by, note) VALUES ($1,$2,'company','test','flow-test')", [email, p]);
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [hex(token), email]);
  return token;
}
const call = async (token, method, path, body) => {
  const headers = { cookie: `sid=${token}`, origin: BASE };
  if (body) headers["content-type"] = "application/json";
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const rewind = () => db.query("UPDATE attendance_punches SET punch_time = punch_time - interval '3 minutes' WHERE employee_id=$1", [empId]);

/** A phone: one passkey, made with Node's crypto, answering as a browser would. */
function phone() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const id = crypto.randomBytes(32), spki = publicKey.export({ format: "der", type: "spki" });
  const client = (type, challenge) => u(JSON.stringify({ type, challenge, origin: BASE }));
  const auth = (attested) => {
    const head = Buffer.alloc(37); sha(RP).copy(head, 0); head[32] = 0x05 | (attested ? 0x40 : 0);
    if (!attested) return head;
    const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
    return Buffer.concat([head, Buffer.alloc(16), len, id]);
  };
  return {
    register: (o) => ({ id: u(id), clientDataJSON: client("webauthn.create", o.challenge), authenticatorData: u(auth(true)), publicKey: u(spki), alg: -7, label: "Test phone" }),
    answer: (challenge, key = privateKey) => {
      const ad = auth(false), cd = client("webauthn.get", challenge);
      return { id: u(id), clientDataJSON: cd, authenticatorData: u(ad), signature: u(crypto.sign("sha256", Buffer.concat([ad, sha(Buffer.from(cd, "base64url"))]), key)) };
    },
  };
}
const clean = async () => {
  await db.query("DELETE FROM attendance_punches WHERE employee_id IN (SELECT id FROM employees WHERE lower(work_email)=ANY($1))", [ALL]);
  await db.query("DELETE FROM clock_in_sites WHERE name LIKE 'Confirm test office%'");
  await db.query("DELETE FROM passkeys WHERE lower(email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM passkey_challenges WHERE lower(email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM employees WHERE lower(work_email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM access_grants WHERE lower(email)=ANY($1) AND note='flow-test'", [ALL]);
  await db.query("DELETE FROM audit_log WHERE lower(work_email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM sessions WHERE lower(email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM users WHERE lower(email)=ANY($1)", [ALL]);
};
try {
  await clean();
  saved = (await db.query("SELECT * FROM clock_in_policy WHERE id=1")).rows[0] || null;
  empId = (await db.query("INSERT INTO employees (work_email, name, start_date, status) VALUES ($1,'Test Confirm Employee','2020-01-01','active') RETURNING id", [EMP])).rows[0].id;
  await db.query("INSERT INTO employees (work_email, name, start_date, status) VALUES ($1,'Test Confirm Other','2020-01-01','active')", [OTHER]);
  const hr = await login(HR, ["shifts.manage"]), emp = await login(EMP), other = await login(OTHER);
  const policy = (p) => call(hr, "PUT", "/api/attendance/clock-in", { enabled: true, needLocation: true, allowOutside: false, confirm: "off", ...p });

  // Off by default: nothing changes
  await policy({});
  let s = await call(hr, "GET", "/api/attendance/clock-in");
  ok("settings: fingerprint or face is off by default", s.data.confirm === "off", JSON.stringify(s.data));
  let t = await call(emp, "GET", "/api/attendance/today");
  ok("today: nothing to confirm and location asked, as before", t.data.confirm === "no" && t.data.needLocation === true && !t.data.officeNetwork && !t.data.canConfirm, JSON.stringify(t.data));
  ok("settings: refused without shift management", (await call(emp, "GET", "/api/attendance/clock-in/my-network")).status === 403);

  // Office internet
  const net = (await call(hr, "GET", "/api/attendance/clock-in/my-network")).data.network;
  ok("office internet: HR is told the address they are on", typeof net === "string" && net.length > 0, String(net));
  ok("office: bad internet addresses are refused with a reason", !!(await call(hr, "POST", "/api/attendance/clock-in/sites", { name: OFFICE, lat: 19.076, lng: 72.8777, radius: 150, networks: "office wifi" })).data.errors.networks);
  s = await call(hr, "POST", "/api/attendance/clock-in/sites", { name: OFFICE, lat: 19.076, lng: 72.8777, radius: 150, networks: [net] });
  ok("office: saved with its internet address", s.status === 201, JSON.stringify(s.data));
  t = await call(emp, "GET", "/api/attendance/today");
  ok("today: on the office internet, no location is asked", t.data.needLocation === false && t.data.officeNetwork === OFFICE, JSON.stringify(t.data));
  let p = await call(emp, "POST", "/api/attendance/punch", {});
  ok("punch: on the office internet, with no location, is matched to the office", p.status === 200 && p.data.place && p.data.place.site === OFFICE, JSON.stringify(p.data));
  let row = (await db.query("SELECT checked_by, confirmed, lat FROM attendance_punches WHERE employee_id=$1 ORDER BY id DESC LIMIT 1", [empId])).rows[0];
  ok("log: recorded as checked by the office internet, no location kept", row.checked_by === "network" && row.lat === null && row.confirmed === false, JSON.stringify(row));
  await db.query("UPDATE clock_in_sites SET networks='{}' WHERE name=$1", [OFFICE]);
  await rewind();
  ok("punch: with the office internet removed, location is needed again", /location/.test((await call(emp, "POST", "/api/attendance/punch", {})).data.error || ""));
  p = await call(emp, "POST", "/api/attendance/punch", NEAR);
  ok("punch: by location still works", p.status === 200, JSON.stringify(p.data));

  // Optional: only people who set it up are asked
  await policy({ confirm: "optional" });
  t = await call(emp, "GET", "/api/attendance/today");
  ok("optional: not set up, not asked, but may set it up", t.data.confirm === "no" && t.data.canConfirm === true, JSON.stringify(t.data));
  await rewind();
  ok("optional: not set up, a plain punch works", (await call(emp, "POST", "/api/attendance/punch", NEAR)).status === 200);
  const ph = phone();
  let start = await call(emp, "POST", "/api/passkeys/register/start");
  ok("set up: options for this site and person", start.status === 200 && start.data.rp.id === RP && start.data.user.name === EMP && !start.data.user.id.includes("wohlig"), JSON.stringify(start.data));
  let fin = await call(emp, "POST", "/api/passkeys/register/finish", ph.register(start.data));
  ok("set up: the phone's passkey is saved", fin.status === 201, JSON.stringify(fin.data));
  ok("set up: the same challenge cannot be used twice", (await call(emp, "POST", "/api/passkeys/register/finish", ph.register(start.data))).status === 400);
  t = await call(emp, "GET", "/api/attendance/today");
  ok("optional: once set up, the person is asked", t.data.confirm === "yes" && t.data.passkeys === 1, JSON.stringify(t.data));
  await rewind();
  ok("punch: without the answer is refused", (await call(emp, "POST", "/api/attendance/punch", NEAR)).status === 400);
  let ch = await call(emp, "POST", "/api/attendance/punch/challenge");
  ok("punch: a challenge naming this person's passkey", ch.status === 200 && ch.data.allow.length === 1 && ch.data.rpId === RP, JSON.stringify(ch.data));
  const forged = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
  ok("punch: an answer signed by another key is refused", (await call(emp, "POST", "/api/attendance/punch", { ...NEAR, confirm: ph.answer(ch.data.challenge, forged) })).status === 400);
  ch = await call(emp, "POST", "/api/attendance/punch/challenge");
  const good = ph.answer(ch.data.challenge);
  p = await call(emp, "POST", "/api/attendance/punch", { ...NEAR, confirm: good });
  ok("punch: confirmed with the fingerprint or face is saved", p.status === 200, JSON.stringify(p.data));
  row = (await db.query("SELECT confirmed, checked_by FROM attendance_punches WHERE employee_id=$1 ORDER BY id DESC LIMIT 1", [empId])).rows[0];
  ok("log: marked as confirmed", row.confirmed === true && row.checked_by === "location", JSON.stringify(row));
  await rewind();
  ok("punch: the same answer cannot be replayed", (await call(emp, "POST", "/api/attendance/punch", { ...NEAR, confirm: good })).status === 400);
  ch = await call(emp, "POST", "/api/attendance/punch/challenge");
  p = await call(other, "POST", "/api/attendance/punch", { ...NEAR, confirm: ph.answer(ch.data.challenge) });
  const otherRow = (await db.query("SELECT p.confirmed FROM attendance_punches p JOIN employees e ON e.id=p.employee_id WHERE lower(e.work_email)=$1 ORDER BY p.id DESC LIMIT 1", [OTHER])).rows[0];
  ok("punch: another person's answer never marks someone else's punch as confirmed", p.status === 200 && otherRow && otherRow.confirmed === false, JSON.stringify([p.data, otherRow]));

  // Required: everyone sets it up first
  await policy({ confirm: "required" });
  t = await call(other, "GET", "/api/attendance/today");
  ok("required: someone without a passkey is asked to set one up", t.data.confirm === "setup", JSON.stringify(t.data));
  p = await call(other, "POST", "/api/attendance/punch", NEAR);
  ok("required: a punch without setting up is refused with a reason", p.status === 400 && p.data.code === "passkey_setup", JSON.stringify(p.data));

  // Own passkeys only
  const mine = (await call(emp, "GET", "/api/passkeys")).data.passkeys;
  ok("passkeys: a person sees their own", mine.length === 1 && mine[0].label === "Test phone" && mine[0].lastUsed, JSON.stringify(mine));
  ok("passkeys: another person sees none of them", (await call(other, "GET", "/api/passkeys")).data.passkeys.length === 0);
  ok("passkeys: another person cannot remove them", (await call(other, "DELETE", `/api/passkeys/${mine[0].id}`)).status === 404);
  ok("passkeys: the owner can remove theirs", (await call(emp, "DELETE", `/api/passkeys/${mine[0].id}`)).status === 200);
  t = await call(emp, "GET", "/api/attendance/today");
  ok("required: after removing it, the person is asked to set up again", t.data.confirm === "setup", JSON.stringify(t.data));
} catch (err) { fail++; console.error("FAIL  the test stopped:", err.message); } finally {
  if (saved) await db.query("UPDATE clock_in_policy SET enabled=$1, need_location=$2, allow_outside=$3, confirm_mode=$4, updated_by=$5, updated_at=$6 WHERE id=1",
    [saved.enabled, saved.need_location, saved.allow_outside, saved.confirm_mode, saved.updated_by, saved.updated_at]);
  else await db.query("DELETE FROM clock_in_policy WHERE id=1");
  await clean();
  await db.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
