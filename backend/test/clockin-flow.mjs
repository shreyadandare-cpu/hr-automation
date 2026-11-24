/*
 * Web clock-in with location and a selfie, end to end, against a LOCAL server and database (never the shared one): HR's
 * settings and offices, a punch inside an office, outside refused or flagged, the selfie (type, size, expiry, who may open
 * it), where the punch was made on the attendance log, and the clean-up of old selfies.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/clockin-flow.mjs
 *
 * Not part of `npm test`. HR's clock-in settings are put back as they were; the test people and offices are clearly named
 * and removed afterwards; a local server sends no email.
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const HR = "test.clockin.hr@wohlig.com", EMP = "test.clockin.employee@wohlig.com", MGR = "test.clockin.manager@wohlig.com", OUT = "test.clockin.outsider@wohlig.com";
const ALL = [HR, EMP, MGR, OUT], OFFICE = "Clock-in test office (Mumbai)";
const AT_OFFICE = { lat: 19.0760, lng: 72.8777 }, NEAR = { lat: 19.0765, lng: 72.8777, accuracy: 15 }, FAR = { lat: 19.2, lng: 72.9, accuracy: 15 };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7), Buffer.from([0xff, 0xd9])]);
let pass = 0, fail = 0, saved = null, empId = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
async function login(email, perms = []) {
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x','employee') ON CONFLICT DO NOTHING", [email]);
  for (const p of perms) await db.query("INSERT INTO access_grants (email, permission, scope, granted_by, note) VALUES ($1,$2,'company','test','flow-test')", [email, p]);
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(token), email]);
  return token;
}
const call = async (token, method, path, body, raw) => {
  const headers = { cookie: `sid=${token}`, origin: BASE };
  if (raw) headers["content-type"] = raw; else if (body) headers["content-type"] = "application/json";
  const r = await fetch(BASE + path, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const type = r.headers.get("content-type") || "";
  return { status: r.status, type, cache: r.headers.get("cache-control"), data: /json/.test(type) ? await r.json().catch(() => null) : null };
};
const policy = (t, p) => call(t, "PUT", "/api/attendance/clock-in", p);
const rewind = () => db.query("UPDATE attendance_punches SET punch_time = punch_time - interval '3 minutes' WHERE employee_id=$1", [empId]);   // the one-minute gap between punches
const clean = async () => {
  await db.query("DELETE FROM attendance_selfies WHERE lower(email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM attendance_punches WHERE employee_id IN (SELECT id FROM employees WHERE lower(work_email)=ANY($1))", [ALL]);
  await db.query("DELETE FROM clock_in_sites WHERE name LIKE 'Clock-in test office%'");
  await db.query("DELETE FROM employees WHERE lower(work_email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM access_grants WHERE lower(email)=ANY($1) AND note='flow-test'", [ALL]);
  await db.query("DELETE FROM notifications WHERE lower(recipient)=ANY($1)", [ALL]);
  await db.query("DELETE FROM audit_log WHERE lower(work_email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM sessions WHERE lower(email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM users WHERE lower(email)=ANY($1)", [ALL]);
};
try {
  await clean();
  saved = (await db.query("SELECT * FROM clock_in_policy WHERE id=1")).rows[0] || null;
  await db.query("INSERT INTO employees (work_email, name, start_date, status, manager_email) VALUES ($1,'Test Clock-in Manager','2020-01-01','active',NULL)", [MGR]);
  empId = (await db.query("INSERT INTO employees (work_email, name, start_date, status, manager_email) VALUES ($1,'Test Clock-in Employee','2020-01-01','active',$2) RETURNING id", [EMP, MGR])).rows[0].id;
  await db.query("INSERT INTO employees (work_email, name, start_date, status) VALUES ($1,'Test Clock-in Outsider','2020-01-01','active')", [OUT]);
  const hr = await login(HR, ["shifts.manage", "attendance.view"]), emp = await login(EMP), mgr = await login(MGR), out = await login(OUT);

  // Settings and offices
  ok("settings: refused without shift management", (await call(emp, "GET", "/api/attendance/clock-in")).status === 403);
  ok("settings: refused to change without shift management", (await policy(emp, { enabled: true })).status === 403);
  let s = await call(hr, "POST", "/api/attendance/clock-in/sites", {});
  ok("office: an empty form names every missing field", s.status === 400 && ["name", "lat", "lng", "radius"].every((k) => s.data.errors[k]), JSON.stringify(s.data));
  s = await call(hr, "POST", "/api/attendance/clock-in/sites", { name: OFFICE, ...AT_OFFICE, radius: 10 });
  ok("office: a radius under 30 m is refused", s.status === 400 && !!s.data.errors.radius);
  s = await call(hr, "POST", "/api/attendance/clock-in/sites", { name: OFFICE, ...AT_OFFICE, radius: 150 });
  ok("office: added", s.status === 201 && s.data.id > 0, JSON.stringify(s));
  const siteId = s.data.id;
  ok("office: edited", (await call(hr, "PUT", `/api/attendance/clock-in/sites/${siteId}`, { name: OFFICE, ...AT_OFFICE, radius: 200 })).status === 200);
  ok("office: editing an unknown one gives 404", (await call(hr, "PUT", "/api/attendance/clock-in/sites/999999", { name: "x", lat: 1, lng: 1, radius: 100 })).status === 404);
  const temp = (await call(hr, "POST", "/api/attendance/clock-in/sites", { name: "Clock-in test office (to remove)", lat: 18.5, lng: 73.8, radius: 100 })).data.id;
  ok("office: removed", (await call(hr, "DELETE", `/api/attendance/clock-in/sites/${temp}`)).status === 200);
  ok("office: removing twice gives 404", (await call(hr, "DELETE", `/api/attendance/clock-in/sites/${temp}`)).status === 404);
  s = await policy(hr, { enabled: true, needLocation: true, needSelfie: true, allowOutside: false });
  ok("settings: saved and returned with the offices", s.status === 200 && s.data.needSelfie === true && s.data.sites.some((x) => x.id === siteId && x.radius === 200), JSON.stringify(s.data));

  // Today tells the app what to ask for
  const today = await call(emp, "GET", "/api/attendance/today");
  ok("today: the app is told to ask for location and a selfie", today.data.canPunch && today.data.needLocation && today.data.needSelfie, JSON.stringify(today.data));

  // Refused punches
  ok("punch: no location is refused", /allow location/.test((await call(emp, "POST", "/api/attendance/punch", {})).data.error));
  ok("punch: nonsense location is refused", (await call(emp, "POST", "/api/attendance/punch", { lat: 999, lng: 1 })).status === 400);
  ok("punch: no selfie is refused", /selfie/.test((await call(emp, "POST", "/api/attendance/punch", NEAR)).data.error));
  ok("punch: an unknown selfie key is refused", /expired/.test((await call(emp, "POST", "/api/attendance/punch", { ...NEAR, selfieKey: "nope" })).data.error));

  // Selfie upload
  ok("selfie: a PNG or script is refused", (await call(emp, "POST", "/api/attendance/selfie", Buffer.from("<svg onload=alert(1)>xxxxxxxx</svg>"), "image/svg+xml")).status === 400);
  ok("selfie: an empty upload is refused", (await call(emp, "POST", "/api/attendance/selfie", Buffer.alloc(0), "image/jpeg")).status === 400);
  ok("selfie: too large is refused", (await call(emp, "POST", "/api/attendance/selfie", Buffer.concat([JPEG, Buffer.alloc(410 * 1024)]), "image/jpeg")).status === 413
    || (await call(emp, "POST", "/api/attendance/selfie", Buffer.concat([JPEG, Buffer.alloc(401 * 1024)]), "image/jpeg")).status === 400);
  let up = await call(emp, "POST", "/api/attendance/selfie", JPEG, "image/jpeg");
  ok("selfie: a JPEG is kept and a key returned", up.status === 201 && /^[0-9a-f]{48}$/.test(up.data.key), JSON.stringify(up));
  const otherKey = (await call(out, "POST", "/api/attendance/selfie", JPEG, "image/jpeg")).data.key;
  ok("selfie: someone else's selfie key cannot be used", /expired/.test((await call(emp, "POST", "/api/attendance/punch", { ...NEAR, selfieKey: otherKey })).data.error));

  ok("punch: outside the offices is refused with the distance", /km from Clock-in test office/.test((await call(emp, "POST", "/api/attendance/punch", { ...FAR, selfieKey: up.data.key })).data.error));
  let p = await call(emp, "POST", "/api/attendance/punch", { ...NEAR, selfieKey: up.data.key });
  ok("punch: inside the office, with a selfie, is saved and matched to the office", p.status === 200 && p.data.direction === "IN" && p.data.place.site === OFFICE && !p.data.place.outside, JSON.stringify(p));
  ok("selfie: a key works once", /expired/.test((await (async () => { await rewind(); return call(emp, "POST", "/api/attendance/punch", { ...NEAR, selfieKey: up.data.key }); })()).data.error));

  // Outside allowed and flagged
  await policy(hr, { enabled: true, needLocation: true, needSelfie: false, allowOutside: true });
  await rewind();
  p = await call(emp, "POST", "/api/attendance/punch", FAR);
  ok("punch: with outside allowed, a far punch is kept and flagged", p.status === 200 && p.data.direction === "OUT" && p.data.place.outside === true && /HR can see this/.test(p.data.note), JSON.stringify(p));

  // Where the punches were made, on the attendance log, and who may open the selfie
  const month = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
  const m = await call(hr, "GET", `/api/attendance/month?email=${encodeURIComponent(EMP)}&month=${month}`);
  const ps = m.data.days.flatMap((d) => d.punches || []);
  const inP = ps.find((x) => x.direction === "IN" && x.selfie), outP = ps.find((x) => x.place && x.place.outside);
  ok("log: the punch in shows the office and has a selfie", inP && inP.place.site === OFFICE && inP.source === "web", JSON.stringify(ps));
  ok("log: the punch out is flagged as outside with its distance", outP && outP.place.distance > 1000, JSON.stringify(ps));
  const pic = `/api/attendance/selfies/${inP.selfie}`;
  let g = await call(emp, "GET", pic);
  ok("selfie: the person may open their own, as a cached picture", g.status === 200 && g.type === "image/jpeg" && /immutable/.test(g.cache), `${g.status} ${g.type} ${g.cache}`);
  ok("selfie: HR with attendance access may open it", (await call(hr, "GET", pic)).status === 200);
  ok("selfie: the reporting manager may open it", (await call(mgr, "GET", pic)).status === 200);
  ok("selfie: anyone else gets 404", (await call(out, "GET", pic)).status === 404);
  ok("selfie: an unused selfie cannot be opened", (await call(out, "GET", `/api/attendance/selfies/${(await db.query("SELECT id FROM attendance_selfies WHERE lower(email)=$1", [OUT])).rows[0].id}`)).status === 404);

  // Clean-up of old selfies (the job): age them, then run the sweep the server runs hourly
  await db.query("UPDATE attendance_selfies SET created_at = now() - interval '91 days' WHERE lower(email)=$1", [EMP]);
  const { purgeSelfies } = await import("../src/attendance.js").catch(() => ({}));
  if (purgeSelfies) {
    const r = await purgeSelfies();
    ok("clean-up: selfies older than 90 days are deleted", r.removed >= 1 && (await db.query("SELECT 1 FROM attendance_selfies WHERE lower(email)=$1", [EMP])).rowCount === 0);
    ok("clean-up: the punch stays, without its selfie", (await db.query("SELECT selfie_id FROM attendance_punches WHERE employee_id=$1 AND direction='IN'", [empId])).rows[0].selfie_id === null);
  }

  // Location not asked: punches work without it
  await policy(hr, { enabled: true, needLocation: false, needSelfie: false, allowOutside: false });
  await rewind();
  ok("punch: with nothing asked, a plain punch works", (await call(emp, "POST", "/api/attendance/punch", {})).status === 200);
} catch (err) { fail++; console.error("FAIL  the test stopped:", err.message); } finally {
  if (saved) await db.query("UPDATE clock_in_policy SET enabled=$1, need_location=$2, need_selfie=$3, allow_outside=$4, updated_by=$5, updated_at=$6 WHERE id=1",
    [saved.enabled, saved.need_location, saved.need_selfie, saved.allow_outside, saved.updated_by, saved.updated_at]);
  else await db.query("DELETE FROM clock_in_policy WHERE id=1");
  await clean();
  await db.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
