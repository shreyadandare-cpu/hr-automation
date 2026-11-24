/*
 * The careers page, applications and referrals, end to end, against a LOCAL server and database (never the shared one): a role is
 * published, the public lists it without signing in, someone applies with a CV, a bot and a repeat application are turned away, a
 * colleague refers someone and follows them, and HR sees the source and opens the CV.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/careers-flow.mjs
 *
 * Not part of `npm test`. Test people are clearly named and removed afterwards; a local server sends no email.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const HR = "test.hiring.admin@wohlig.com", EMP = "test.hiring.referrer@wohlig.com", APPLICANT = "test.applicant@example.com", FRIEND = "test.referred.friend@example.com";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
let pass = 0, fail = 0, openingId = null;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
async function login(email, perms = []) {
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x','employee') ON CONFLICT DO NOTHING", [email]);
  for (const p of perms) await db.query("INSERT INTO access_grants (email, permission, scope, granted_by, note) VALUES ($1,$2,'company','test','flow-test')", [email, p]);
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(token), email]);
  return token;
}
const call = async (token, method, path, body, raw) => {
  const headers = { origin: BASE, ...(token ? { cookie: `sid=${token}` } : {}), ...(raw ? { "content-type": "application/octet-stream" } : body ? { "content-type": "application/json" } : {}) };
  const r = await fetch(BASE + path, { method, headers, body: raw || (body ? JSON.stringify(body) : undefined) });
  const type = r.headers.get("content-type") || "";
  return { status: r.status, type, data: type.includes("json") ? await r.json().catch(() => null) : await r.text() };
};
const clean = async () => {
  const { rows } = await db.query("SELECT resume_stored FROM candidates WHERE lower(email)=ANY($1) AND resume_stored IS NOT NULL", [[APPLICANT, FRIEND]]);
  const { UPLOAD_DIR } = await import("../src/documents.js");
  for (const r of rows) await fs.rm(`${UPLOAD_DIR}/${r.resume_stored}`, { force: true }).catch(() => {});
  await db.query("DELETE FROM candidates WHERE lower(email)=ANY($1)", [[APPLICANT, FRIEND]]);
  await db.query("DELETE FROM job_openings WHERE title='Test Frontend Developer'");
  await db.query("DELETE FROM rate_limits WHERE key LIKE 'apply:%'");
  await db.query("DELETE FROM employees WHERE lower(work_email)=ANY($1)", [[HR, EMP]]);
  await db.query("DELETE FROM access_grants WHERE lower(email)=ANY($1) AND note='flow-test'", [[HR, EMP]]);
  await db.query("DELETE FROM notifications WHERE title LIKE '%Test Frontend Developer%' OR lower(recipient)=ANY($1)", [[HR, EMP]]);
  await db.query("DELETE FROM sessions WHERE lower(email)=ANY($1)", [[HR, EMP]]);
  await db.query("DELETE FROM users WHERE lower(email)=ANY($1)", [[HR, EMP]]);
};
try {
  await clean();
  await db.query("INSERT INTO employees (work_email, name, start_date, status) VALUES ($1,'Test Hiring Admin','2020-01-01','active'),($2,'Test Hiring Referrer','2020-01-01','active')", [HR, EMP]);
  const hr = await login(HR, ["hiring.manage"]), emp = await login(EMP);

  let r = await call(hr, "POST", "/api/hr/openings", { title: "Test Frontend Developer", dept: "Engineering", description: "Build things.\nWith React.", location: "Mumbai", kind: "Full time", experience: "2 to 4 years", isPublic: false });
  ok("HR opens a role, not yet published", r.status === 201); openingId = r.data.id;
  r = await call(null, "GET", "/api/careers");
  ok("an unpublished role is not on the careers page", r.status === 200 && !r.data.jobs.some((j) => j.id === openingId));
  r = await call(null, "GET", `/api/careers/${openingId}`);
  ok("nor can it be opened directly", r.status === 404);
  r = await call(hr, "PUT", `/api/hr/openings/${openingId}`, { title: "Test Frontend Developer", dept: "Engineering", description: "Build things.\nWith React.", location: "Mumbai", kind: "Full time", experience: "2 to 4 years", isPublic: true });
  ok("HR publishes it", r.status === 200);
  r = await call(null, "GET", "/api/careers");
  ok("anyone sees it without signing in, with its details", r.data.jobs.some((j) => j.id === openingId && j.location === "Mumbai" && j.experience === "2 to 4 years"));
  const page = await fetch(`${BASE}/careers/${openingId}`);
  ok("the careers page itself opens without signing in", page.status === 200 && /<div id="root">/.test(await page.text()));

  r = await call(null, "POST", `/api/careers/${openingId}/apply`, { name: "Test Applicant", email: APPLICANT });
  ok("applying without consent is refused", r.status === 400 && r.data.errors.consent);
  r = await call(null, "POST", `/api/careers/${openingId}/apply`, { name: "Bot", email: "bot@example.com", consent: true, website: "spam.example" });
  const { rowCount: bots } = await db.query("SELECT 1 FROM candidates WHERE lower(email)='bot@example.com'");
  ok("a bot that fills the hidden field is thanked and nothing is kept", r.status === 201 && bots === 0);
  r = await call(null, "POST", `/api/careers/${openingId}/apply`, { name: "Test Applicant", email: APPLICANT, phone: "+91 98765 43210", link: "https://example.com/asha", note: "I love React.", consent: true });
  ok("someone applies", r.status === 201 && r.data.uploadKey, JSON.stringify(r.data));
  const key = r.data.uploadKey;
  r = await call(null, "PUT", `/api/careers/applications/${key}/resume?name=cv.exe`, null, Buffer.from("MZ not a cv"));
  ok("a file that is not a PDF or Word file is refused", r.status === 400);
  r = await call(null, "PUT", `/api/careers/applications/${key}/resume?name=Asha-CV.pdf`, null, PDF);
  ok("their CV is accepted", r.status === 200);
  r = await call(null, "PUT", `/api/careers/applications/${key}/resume?name=again.pdf`, null, PDF);
  ok("the upload link works only once", r.status === 404);
  r = await call(null, "POST", `/api/careers/${openingId}/apply`, { name: "Test Applicant", email: APPLICANT, consent: true });
  ok("applying twice for the same role is refused politely", r.status === 409);

  r = await call(emp, "GET", "/api/jobs");
  ok("staff see the open role on the job board", r.data.jobs.some((j) => j.id === openingId));
  r = await call(emp, "POST", `/api/jobs/${openingId}/refer`, { name: "Test Referred Friend", email: EMP });
  ok("nobody can refer themselves", r.status === 400);
  r = await call(emp, "POST", `/api/jobs/${openingId}/refer`, { name: "Test Referred Friend", email: FRIEND, note: "Worked with her for two years." });
  ok("a colleague refers a friend", r.status === 201);
  r = await call(hr, "PUT", `/api/jobs/referrals/${r.data.uploadKey}/resume`, null, PDF);
  ok("only the referrer can add the CV to their referral", r.status === 404);
  r = await call(emp, "GET", "/api/jobs/my-referrals");
  ok("the referrer follows it, without the hiring notes", r.data.referrals.some((x) => x.name === "Test Referred Friend" && x.status === "Received" && !("notes" in x)));

  r = await call(hr, "GET", `/api/hr/openings/${openingId}/candidates`);
  const a = r.data.candidates.find((c) => c.email === APPLICANT), f = r.data.candidates.find((c) => c.email === FRIEND);
  ok("HR sees where each came from", a.source === "careers" && f.source === "referral" && f.referredBy.name === "Test Hiring Referrer", JSON.stringify(r.data.candidates));
  ok("with the applicant's note, link and CV", a.coverNote === "I love React." && a.link === "https://example.com/asha" && a.resume && a.resume.name === "Asha-CV.pdf");
  const cv = await fetch(`${BASE}/api/hr/candidates/${a.id}/resume`, { headers: { cookie: `sid=${hr}` } });
  ok("HR opens the CV", cv.status === 200 && cv.headers.get("content-type") === "application/pdf" && cv.headers.get("x-content-type-options") === "nosniff");
  const no = await fetch(`${BASE}/api/hr/candidates/${a.id}/resume`, { headers: { cookie: `sid=${emp}` } });
  ok("a colleague cannot open it", no.status === 403);
  await call(hr, "POST", `/api/hr/openings/${openingId}/status`, { status: "closed" });
  r = await call(null, "GET", "/api/careers");
  ok("a closed role leaves the careers page", !r.data.jobs.some((j) => j.id === openingId));
} catch (err) { fail++; console.log("ERROR  " + err.stack); }
finally { await clean(); await db.end(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
