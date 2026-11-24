/*
 * Offer letters and e-signature, end to end, against a LOCAL server and database (never the shared one): HR prepares an offer,
 * the preparer cannot approve it, a second person approves, it is sent, the candidate signs it through the public link, and the
 * signed PDF carries the record. Also: a wrong name, a used link, declining, withdrawing.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/offers-flow.mjs
 *
 * Not part of `npm test`. Test people are clearly named and removed afterwards; a local server sends no email.
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const MAKER = "test.offer.preparer@wohlig.com", CHECKER = "test.offer.approver@wohlig.com", CAND = "test.offer.candidate@example.com", CAND2 = "test.offer.candidate2@example.com";
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
  const r = await fetch(BASE + path, { method, headers: { origin: BASE, ...(token ? { cookie: `sid=${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = r.headers.get("content-type") || "";
  return { status: r.status, type, data: type.includes("json") ? await r.json().catch(() => null) : Buffer.from(await r.arrayBuffer()) };
};
const clean = async () => {
  await db.query("DELETE FROM offer_letters WHERE candidate_id IN (SELECT id FROM candidates WHERE lower(email)=ANY($1))", [[CAND, CAND2]]);
  await db.query("DELETE FROM candidates WHERE lower(email)=ANY($1)", [[CAND, CAND2]]);
  await db.query("DELETE FROM job_openings WHERE title='Test Offer Role'");
  await db.query("DELETE FROM rate_limits WHERE key LIKE 'sign:%'");
  await db.query("DELETE FROM access_grants WHERE lower(email)=ANY($1) AND note='flow-test'", [[MAKER, CHECKER]]);
  await db.query("DELETE FROM notifications WHERE lower(recipient)=ANY($1) OR title LIKE '%Test Offer%'", [[MAKER, CHECKER]]);
  await db.query("DELETE FROM audit_log WHERE lower(work_email)=ANY($1)", [[MAKER, CHECKER]]);
  await db.query("DELETE FROM sessions WHERE lower(email)=ANY($1)", [[MAKER, CHECKER]]);
  await db.query("DELETE FROM users WHERE lower(email)=ANY($1)", [[MAKER, CHECKER]]);
};
try {
  await clean();
  const maker = await login(MAKER, ["hiring.manage", "offers.approve"]), checker = await login(CHECKER, ["hiring.manage", "offers.approve"]);
  const { rows: [o] } = await db.query("INSERT INTO job_openings (title, dept, created_by) VALUES ('Test Offer Role','Engineering',$1) RETURNING id", [MAKER]);
  const { rows: [c] } = await db.query("INSERT INTO candidates (opening_id, name, email, stage) VALUES ($1,'Test Offer Candidate',$2,'interview') RETURNING id", [o.id, CAND]);
  const { rows: [c2] } = await db.query("INSERT INTO candidates (opening_id, name, email, stage) VALUES ($1,'Test Second Candidate',$2,'interview') RETURNING id", [o.id, CAND2]);

  let r = await call(maker, "POST", `/api/hr/candidates/${c.id}/offers`, { title: "Test Offer Role", ctc: "12,00,000", joiningDate: "2099-01-04", location: "Mumbai", terms: "Probation is six months." });
  ok("HR prepares an offer, and the candidate moves to Offer", r.status === 201 && (await db.query("SELECT stage FROM candidates WHERE id=$1", [c.id])).rows[0].stage === "offer", JSON.stringify(r.data));
  const id = r.data.id;
  r = await call(maker, "POST", `/api/hr/candidates/${c.id}/offers`, { title: "x", ctc: "1", joiningDate: "2099-01-04" });
  ok("only one offer at a time", r.status === 409);
  r = await call(maker, "POST", `/api/hr/offers/${id}/send`);
  ok("an offer cannot be sent before approval", r.status === 409);
  r = await call(maker, "POST", `/api/hr/offers/${id}/approve`);
  ok("whoever prepared it cannot approve it", r.status === 403);
  r = await call(checker, "POST", `/api/hr/offers/${id}/return`, {});
  ok("sending it back needs a note", r.status === 400);
  r = await call(checker, "POST", `/api/hr/offers/${id}/approve`);
  ok("someone else approves it", r.status === 200 && r.data.status === "approved");
  r = await call(maker, "POST", `/api/hr/offers/${id}/send`);
  ok("HR sends it and gets the signing link (no email from a local server)", r.status === 200 && /\/sign\/[\w-]{30,}$/.test(r.data.link) && r.data.emailed === false && r.data.fingerprint, JSON.stringify(r.data));
  const key = r.data.link.split("/sign/")[1];
  const { rows: [stored] } = await db.query("SELECT sign_key_hash FROM offer_letters WHERE id=$1", [id]);
  ok("the database keeps only the key's fingerprint", stored.sign_key_hash !== key && stored.sign_key_hash === sha(key));

  r = await call(null, "GET", `/api/sign/${key}`);
  ok("the candidate opens the letter without signing in", r.status === 200 && /Dear Test Offer Candidate/.test(r.data.text) && /Rs\. 12,00,000/.test(r.data.text) && r.data.status === "sent");
  r = await call(null, "GET", "/api/sign/not-a-real-key-at-all-just-guessing");
  ok("a guessed link opens nothing", r.status === 404);
  r = await call(null, "POST", `/api/sign/${key}`, { name: "Someone Else", accept: true });
  ok("signing with a different name is refused", r.status === 400 && r.data.errors.name);
  r = await call(null, "POST", `/api/sign/${key}`, { name: "test offer candidate", accept: true });
  ok("the candidate signs by typing their name", r.status === 200);
  r = await call(null, "POST", `/api/sign/${key}`, { name: "Test Offer Candidate", accept: true });
  ok("it cannot be signed twice", r.status === 409);
  const { rows: [signed] } = await db.query("SELECT status, signed_name, signed_ip, signed_at, letter_sha256, letter_text FROM offer_letters WHERE id=$1", [id]);
  ok("the signature keeps the name, time, address and the letter's fingerprint", signed.status === "signed" && signed.signed_name === "test offer candidate" && signed.signed_ip && signed.signed_at && signed.letter_sha256 === sha(signed.letter_text));
  r = await call(maker, "GET", `/api/hr/offers/${id}/pdf`);
  ok("HR downloads the signed letter as a PDF", r.status === 200 && r.type.includes("pdf") && r.data.subarray(0, 5).toString() === "%PDF-");
  r = await call(null, "GET", `/api/sign/${key}/pdf`);
  ok("so does the candidate, with the link", r.status === 200 && r.type.includes("pdf"));
  r = await call(maker, "POST", `/api/hr/offers/${id}/withdraw`);
  ok("a signed offer cannot be withdrawn", r.status === 409);

  // A second candidate declines; a withdrawn offer's link stops working.
  r = await call(maker, "POST", `/api/hr/candidates/${c2.id}/offers`, { title: "Test Offer Role", ctc: "900000", joiningDate: "2099-01-04" });
  const id2 = r.data.id;
  await call(checker, "POST", `/api/hr/offers/${id2}/approve`);
  r = await call(maker, "POST", `/api/hr/offers/${id2}/send`);
  const key2 = r.data.link.split("/sign/")[1];
  r = await call(null, "POST", `/api/sign/${key2}/decline`, { reason: "I accepted another offer." });
  ok("a candidate can decline with a reason", r.status === 200 && (await db.query("SELECT status, declined_reason FROM offer_letters WHERE id=$1", [id2])).rows[0].declined_reason === "I accepted another offer.");
  r = await call(maker, "POST", `/api/hr/candidates/${c2.id}/offers`, { title: "Test Offer Role", ctc: "1000000", joiningDate: "2099-01-04" });
  const id3 = r.data.id;
  await call(checker, "POST", `/api/hr/offers/${id3}/approve`);
  r = await call(maker, "POST", `/api/hr/offers/${id3}/send`);
  const key3 = r.data.link.split("/sign/")[1];
  await call(maker, "POST", `/api/hr/offers/${id3}/withdraw`);
  r = await call(null, "GET", `/api/sign/${key3}`);
  ok("a withdrawn offer's link no longer opens it", r.status === 404);
} catch (err) { fail++; console.log("ERROR  " + err.stack); }
finally { await clean(); await db.end(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
