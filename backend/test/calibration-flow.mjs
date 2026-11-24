/*
 * Review calibration, end to end, against a LOCAL server and database (never the shared one): the calibration page for a
 * cycle, moving a rating with a reason, potential and the 9-box, locked finished reviews, never your own review, and that
 * the person reviewed and their manager never see the calibrated rating.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/calibration-flow.mjs
 *
 * Not part of `npm test`. The test people and the test cycle are clearly named and removed afterwards; a local server sends no email.
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const ADM = "test.calibration.hr@wohlig.com", MGR = "test.calibration.manager@wohlig.com", REP = "test.calibration.report@wohlig.com",
  NEW = "test.calibration.newjoiner@wohlig.com", DONE = "test.calibration.finished@wohlig.com", OUT = "test.calibration.outsider@wohlig.com";
const ALL = [ADM, MGR, REP, NEW, DONE, OUT], CYCLE = "Calibration flow test cycle";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
async function login(email, perms = []) {
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x','employee') ON CONFLICT DO NOTHING", [email]);
  for (const p of perms) await db.query("INSERT INTO access_grants (email, permission, scope, granted_by, note) VALUES ($1,$2,'company','test','flow-test')", [email, p]);
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(token), email]);
  return token;
}
const call = async (token, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${token}`, origin: BASE, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const clean = async () => {
  await db.query("DELETE FROM reviews WHERE cycle_id IN (SELECT id FROM review_cycles WHERE name=$1)", [CYCLE]);
  await db.query("DELETE FROM review_cycles WHERE name=$1", [CYCLE]);
  await db.query("DELETE FROM access_grants WHERE lower(email)=ANY($1) AND note='flow-test'", [ALL]);
  await db.query("DELETE FROM notifications WHERE lower(recipient)=ANY($1)", [ALL]);
  await db.query("DELETE FROM audit_log WHERE lower(work_email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM sessions WHERE lower(email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM users WHERE lower(email)=ANY($1)", [ALL]);
};
try {
  await clean();
  const adm = await login(ADM, ["reviews.manage"]), mgr = await login(MGR), rep = await login(REP), out = await login(OUT);
  const { rows: [c] } = await db.query("INSERT INTO review_cycles (name, self_due, manager_due, created_by) VALUES ($1, current_date + 7, current_date + 14, $2) RETURNING id", [CYCLE, ADM]);
  const add = async (email, status, managerRating, rating = null) => (await db.query(
    `INSERT INTO reviews (email, period, created_by, cycle_id, manager_email, status, self_text, self_at, manager_text, manager_rating, manager_at, rating, hr_text)
     VALUES ($1,$2,$3,$4,$5,$6,'Self review text',now(),$7,$8,$9,$10,$11) RETURNING id`,
    [email, CYCLE, ADM, c.id, MGR, status, managerRating ? "Manager review text" : null, managerRating, managerRating ? new Date() : null, rating, rating ? "Final" : null])).rows[0].id;
  const repId = await add(REP, "hr-pending", 3), newId = await add(NEW, "manager-pending", null), doneId = await add(DONE, "done", 4, 4), ownId = await add(ADM, "hr-pending", 3);

  ok("no access: someone without reviews.manage cannot open calibration", (await call(out, "GET", `/api/review-cycles/${c.id}/calibration`)).status === 403);
  ok("no access: a manager without reviews.manage cannot calibrate", (await call(mgr, "PUT", `/api/reviews/${repId}/calibrate`, { rating: 5, note: "x" })).status === 403);
  ok("unknown cycle gives a clear 404", (await call(adm, "GET", "/api/review-cycles/999999/calibration")).status === 404);
  let g = await call(adm, "GET", `/api/review-cycles/${c.id}/calibration`);
  ok("calibration lists every review in the cycle", g.status === 200 && g.data.reviews.length === 4, JSON.stringify(g.data));
  ok("spread before: managers gave two 3s and one 4", g.status === 200 && JSON.stringify(g.data.spread.manager) === "[0,0,2,1,0]", JSON.stringify(g.data && g.data.spread));
  ok("a review waiting for the manager has no rating yet", g.data.reviews.find((x) => x.id === newId).rating === null);

  let p = await call(adm, "PUT", `/api/reviews/${repId}/calibrate`, { rating: 4 });
  ok("moving the manager's rating without a reason is refused", p.status === 400 && !!p.data.errors.note, JSON.stringify(p));
  p = await call(adm, "PUT", `/api/reviews/${repId}/calibrate`, {});
  ok("an empty calibration asks for a rating", p.status === 400 && !!p.data.errors.rating, JSON.stringify(p));
  p = await call(adm, "PUT", `/api/reviews/${repId}/calibrate`, { rating: 4, potential: 9, note: "Led the release" });
  ok("a potential outside low, medium, high is refused", p.status === 400 && !!p.data.errors.potential, JSON.stringify(p));
  p = await call(adm, "PUT", `/api/reviews/${repId}/calibrate`, { rating: 4, potential: 3, note: "Led the payroll release on time" });
  ok("a moved rating with a reason and high potential is saved as a Star", p.status === 200 && p.data.box && p.data.box.label === "Star", JSON.stringify(p));
  p = await call(adm, "PUT", `/api/reviews/${newId}/calibrate`, { rating: 3, potential: 2 });
  ok("a review with no manager rating yet can be calibrated without a reason", p.status === 200 && p.data.box.label === "Core player", JSON.stringify(p));
  ok("a finished review is locked", (await call(adm, "PUT", `/api/reviews/${doneId}/calibrate`, { rating: 5, note: "late" })).status === 409);
  ok("never your own review", (await call(adm, "PUT", `/api/reviews/${ownId}/calibrate`, { rating: 5, note: "me" })).status === 403);
  ok("an unknown review gives 404", (await call(adm, "PUT", "/api/reviews/999999/calibrate", { rating: 3 })).status === 404);

  g = await call(adm, "GET", `/api/review-cycles/${c.id}/calibration`);
  ok("spread after: the moved rating counts as a 4", JSON.stringify(g.data.spread.now) === "[0,0,2,2,0]", JSON.stringify(g.data.spread));
  const r1 = g.data.reviews.find((x) => x.id === repId);
  ok("the reason and the box are kept", r1.note === "Led the payroll release on time" && r1.box.label === "Star" && r1.calibratedRating === 4 && r1.managerRating === 3, JSON.stringify(r1));
  ok("filter by an unknown department shows nobody", (await call(adm, "GET", `/api/review-cycles/${c.id}/calibration?dept=No%20such%20team`)).data.reviews.length === 0);

  const hrList = await call(adm, "GET", "/api/reviews?scope=all");
  const hrRow = hrList.data.reviews.find((x) => x.id === repId);
  ok("HR's list carries the calibrated rating for the final review", hrRow && hrRow.calibratedRating === 4 && hrRow.calibrationNote.startsWith("Led"), JSON.stringify(hrRow));
  const own = (await call(rep, "GET", "/api/reviews")).data.reviews.find((x) => x.id === repId);
  ok("the person never sees the calibrated rating or the reason", own && !("calibratedRating" in own) && !("calibrationNote" in own), JSON.stringify(own));
  const team = (await call(mgr, "GET", "/api/reviews?scope=team")).data.reviews.find((x) => x.id === repId);
  ok("the manager never sees the calibrated rating or the reason", team && !("calibratedRating" in team) && !("calibrationNote" in team), JSON.stringify(team));

  const fin = await call(adm, "PUT", `/api/reviews/${repId}/hr`, { text: "A strong half year.", rating: 4 });
  ok("HR finishes the review with the calibrated rating", fin.status === 200);
  ok("after finishing, calibration is locked", (await call(adm, "PUT", `/api/reviews/${repId}/calibrate`, { rating: 5, note: "again" })).status === 409);
} catch (err) { fail++; console.error("FAIL  the test stopped:", err.message); } finally {
  await clean();
  await db.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
