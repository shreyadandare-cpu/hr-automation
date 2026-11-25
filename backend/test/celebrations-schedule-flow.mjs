/*
 * Scheduled celebration posters against a LOCAL server and a LOCAL database (never the shared one): scheduling a birthday poster for a date and time, the
 * weekend and holiday days still sending, rescheduling, cancelling, who may do it, the background check sending only what is due (and never twice), and a wish
 * that is far too late being held back. Every test person's email is on MAIL_SKIP_RECIPIENTS, so nobody is emailed. The server needs LIVE_SERVICES_LOCAL=true,
 * SENDGRID_API_KEY, MAIL_FROM, a https PUBLIC_URL and MAIL_SKIP_RECIPIENTS=cs.hr@wohlig.com,cs.a@wohlig.com,cs.b@wohlig.com,cs.c@wohlig.com.
 *
 *   DATABASE_URL=postgresql://postgres:x@localhost:55434/postgres LIVE_SERVICES_LOCAL=true BASE=http://localhost:3190 node test/celebrations-schedule-flow.mjs
 *
 * Not part of `npm test`.
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3190";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB) || !/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: a local database and a local server only."); process.exit(2); }
const { runScheduledCelebrations } = await import("../src/celebrations.js");
const db = new pg.Pool({ connectionString: DB }), sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const HR = "cs.hr@wohlig.com", A = "cs.a@wohlig.com", B = "cs.b@wohlig.com", C = "cs.c@wohlig.com", ALL = [HR, A, B, C];
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
const login = async (email, superAdmin) => {
  await db.query("INSERT INTO users (email, password_hash, role, is_super_admin) VALUES ($1,'x',$2,$3) ON CONFLICT DO NOTHING", [email, superAdmin ? "hr" : "employee", !!superAdmin]);
  const t = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(t), email]);
  return t;
};
const call = async (tok, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${tok}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, d: await r.json().catch(() => null) };
};
const ist = () => new Date(Date.now() + 330 * 60000);
const dayPlus = (n) => { const d = ist(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2000, 1)]);
const wipe = async () => {
  await db.query("DELETE FROM celebrations WHERE lower(employee_email) = ANY($1)", [ALL]);
  await db.query("DELETE FROM sessions WHERE lower(email) = ANY($1)", [ALL]);
  await db.query("DELETE FROM notifications WHERE lower(recipient) = ANY($1)", [ALL]);
  await db.query("DELETE FROM employees WHERE lower(work_email) = ANY($1)", [ALL]);
  await db.query("DELETE FROM users WHERE lower(email) = ANY($1)", [ALL]);
  await db.query("DELETE FROM holidays WHERE name = 'Schedule test holiday'");
};
const draft = async (tok, email, name) => {
  const m = await call(tok, "POST", "/api/celebrations", { occasion: "birthday", email, theme: "polaroid", heading: "Happy", emphasis: "birthday.", name, message: "Best wishes." });
  await fetch(`${BASE}/api/celebrations/${m.d.id}/poster`, { method: "PUT", headers: { cookie: `sid=${tok}`, "content-type": "image/png" }, body: PNG });
  return m.d.id;
};
const row = async (id) => (await db.query("SELECT status, scheduled_for, audience_to, occasion_key FROM celebrations WHERE id=$1", [id])).rows[0];

await wipe();
try {
  const mk = (n, e, no) => db.query("INSERT INTO employees (emp_no, name, work_email, title, dept, start_date, status, onboarded_at) VALUES ($1,$2,$3,'Engineer','Engineering','2024-01-01','active',now())", [no, n, e]);
  await mk("HR Sched", HR, "S/1"); await mk("Asha Sched", A, "S/2"); await mk("Bina Sched", B, "S/3"); await mk("Chetan Sched", C, "S/4");
  const hr = await login(HR, true), emp = await login(A, false);

  const id1 = await draft(hr, A, "Asha Sched"), id2 = await draft(hr, A, "Asha Sched"), saturday = (() => { for (let i = 2; i < 12; i++) { const d = new Date(`${dayPlus(i)}T00:00:00Z`); if (d.getUTCDay() === 6) return dayPlus(i); } })();
  let r = await call(emp, "POST", `/api/celebrations/${id1}/schedule`, { date: dayPlus(3), time: "09:00" });
  ok("an employee cannot schedule", r.s === 403, JSON.stringify(r));
  r = await call(hr, "POST", `/api/celebrations/${id1}/schedule`, { date: dayPlus(-1), time: "09:00" });
  ok("a past time is refused", r.s === 400 && /passed/.test(r.d.error), JSON.stringify(r));
  r = await call(hr, "POST", `/api/celebrations/${id1}/schedule`, { date: "2026-13-40", time: "9am" });
  ok("a bad date or time is refused", r.s === 400, JSON.stringify(r));
  r = await call(hr, "POST", `/api/celebrations/${id1}/schedule`, { date: saturday, time: "09:00" });
  ok("a Saturday can be scheduled", r.s === 200, JSON.stringify(r));
  let x = await row(id1);
  ok("status is scheduled for 9:00 India time", x.status === "scheduled" && new Date(x.scheduled_for).toISOString() === `${saturday}T03:30:00.000Z`, JSON.stringify(x));
  ok("the poster key follows the date it is sent", x.occasion_key === `birthday:${saturday.slice(0, 4)}`, x.occasion_key);

  await db.query("INSERT INTO holidays (day, name) VALUES ($1, 'Schedule test holiday') ON CONFLICT DO NOTHING", [dayPlus(5)]);
  const ov = await call(hr, "GET", "/api/celebrations/overview");
  ok("the overview lists holidays ahead", ov.d && ov.d.holidays && ov.d.holidays[dayPlus(5)] === "Schedule test holiday", JSON.stringify(ov.d && ov.d.holidays));
  const hist = await call(hr, "GET", "/api/celebrations");
  const h = hist.d.items.find((i) => i.id === id1);
  ok("the history shows it as scheduled with its time", h && h.status === "scheduled" && h.scheduledFor, JSON.stringify(h));

  r = await call(hr, "POST", `/api/celebrations/${id1}/send`, { audience: "all" });
  ok("a scheduled poster cannot also be sent now", r.s === 409, JSON.stringify(r));
  r = await call(hr, "PUT", `/api/celebrations/${id1}`, { heading: "Hi", name: "Asha Sched" });
  ok("a scheduled poster cannot be edited until cancelled", r.s === 409, JSON.stringify(r));

  r = await call(hr, "POST", `/api/celebrations/${id1}/schedule`, { date: dayPlus(5), time: "08:30", audience: "selected", to: [B, "nobody@wohlig.com"] });
  ok("a person who is not an employee is refused", r.s === 400, JSON.stringify(r));
  r = await call(hr, "POST", `/api/celebrations/${id1}/schedule`, { date: dayPlus(5), time: "08:30", audience: "selected", to: [B, C] });
  x = await row(id1);
  ok("it can be rescheduled to chosen people on a holiday", r.s === 200 && x.audience_to.length === 2 && new Date(x.scheduled_for).toISOString() === `${dayPlus(5)}T03:00:00.000Z`, JSON.stringify(x));

  r = await call(hr, "POST", `/api/celebrations/${id2}/schedule`, { date: dayPlus(6), time: "09:00" });
  ok("the same person cannot have two scheduled birthday posters", r.s === 409, JSON.stringify(r));

  r = await call(hr, "DELETE", `/api/celebrations/${id1}/schedule`);
  x = await row(id1);
  ok("cancelling returns it to a draft", r.s === 200 && x.status === "draft" && !x.scheduled_for, JSON.stringify(x));
  r = await call(hr, "DELETE", `/api/celebrations/${id1}/schedule`);
  ok("cancelling twice is refused", r.s === 409, JSON.stringify(r));
  r = await call(hr, "POST", `/api/celebrations/${id2}/schedule`, { date: dayPlus(6), time: "09:00" });
  ok("after cancelling, the other poster can take the slot", r.s === 200, JSON.stringify(r));
  await call(hr, "DELETE", `/api/celebrations/${id2}/schedule`);

  // the background check: only what is due, once
  const due = await draft(hr, B, "Bina Sched"), later = await draft(hr, C, "Chetan Sched");
  await call(hr, "POST", `/api/celebrations/${due}/schedule`, { date: dayPlus(0), time: "23:59" });
  await call(hr, "POST", `/api/celebrations/${later}/schedule`, { date: dayPlus(4), time: "09:00" });
  await db.query("UPDATE celebrations SET scheduled_for = now() - interval '2 minutes' WHERE id=$1", [due]);
  let run = await runScheduledCelebrations();
  ok("the check sends the due poster only", run.sent === 1 && run.missed === 0, JSON.stringify(run));
  await new Promise((s) => setTimeout(s, 1500));
  ok("the due poster is sent and the later one still waits", (await row(due)).status === "sent" && (await row(later)).status === "scheduled", JSON.stringify([await row(due), await row(later)]));
  run = await runScheduledCelebrations();
  ok("running again sends nothing twice", run.sent === 0 && run.missed === 0, JSON.stringify(run));
  const dup = await call(hr, "POST", "/api/celebrations", { occasion: "birthday", email: B, theme: "polaroid", heading: "Happy", name: "Bina Sched" });
  ok("a second poster for the same person is refused at creation", dup.s === 409 && /sent or scheduled/.test(dup.d.error), JSON.stringify(dup));

  // far too late: held back and HR is told
  await db.query("UPDATE celebrations SET scheduled_for = now() - interval '3 days' WHERE id=$1", [later]);
  run = await runScheduledCelebrations();
  x = await row(later);
  const bell = await db.query("SELECT title FROM notifications WHERE lower(recipient) = $1 AND title LIKE '%scheduled poster was not sent%'", [HR]);
  ok("a wish days late is not sent on its own", run.missed === 1 && x.status === "failed", JSON.stringify([run, x]));
  ok("HR is told about the missed one", bell.rows.length >= 1, JSON.stringify(bell.rows));
} finally { await wipe(); await db.end(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
