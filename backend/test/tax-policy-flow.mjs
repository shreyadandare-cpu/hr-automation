/*
 * Tax regime policy, end to end, against a LOCAL server and database (never the shared one): the default regime, the policy
 * document, who may change them, and that a declaration starts on the default but keeps whatever someone saved.
 *
 *   DATABASE_URL=postgresql://postgres:x@localhost:55432/postgres BASE=http://localhost:3189 node test/tax-policy-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server). It removes its own test rows and files afterwards.
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3189";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: BASE must be a local server."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const EMP = "tax.emp@wohlig.com", EMP2 = "tax.emp2@wohlig.com", HR = "hr.test@wohlig.com";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

async function login(email, role = "employee", pin = "483920") {
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x',$2) ON CONFLICT DO NOTHING", [email, role]);
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(token), email]);
  return token;
}
const call = async (token, method, path, body, raw) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${token}`, ...(raw ? { "content-type": "application/octet-stream" } : body ? { "content-type": "application/json" } : {}) }, body: raw || (body ? JSON.stringify(body) : undefined) });
  const type = r.headers.get("content-type") || "";
  return { status: r.status, type, data: type.includes("json") ? await r.json().catch(() => null) : Buffer.from(await r.arrayBuffer()) };
};
const FY = Number((await db.query("SELECT extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata')::date - interval '3 months')::int AS y")).rows[0].y);

try {
  await db.query("DELETE FROM tax_regime_policies");
  const e = await login(EMP), e2 = await login(EMP2), hr = await login(HR, "hr");

  let r = await call(e, "GET", "/api/tax-declaration");
  ok("no policy yet: a declaration starts on the New regime", r.status === 200 && r.data.regime === "new" && r.data.policy.set === false && r.data.policy.document === null, JSON.stringify(r.data && r.data.policy));
  ok("an employee cannot set the default", (await call(e, "PUT", "/api/tax-declaration/policy", { defaultRegime: "old" })).status === 403);
  ok("an employee cannot upload the policy document", (await call(e, "PUT", "/api/tax-declaration/policy/document?name=p.pdf", null, PDF)).status === 403);
  ok("an employee cannot remove it", (await call(e, "DELETE", "/api/tax-declaration/policy/document")).status === 403);
  ok("the policy shows an employee that they cannot manage it", (await call(e, "GET", "/api/tax-declaration/policy")).data.canManage === false);
  ok("HR is told they can manage it", (await call(hr, "GET", "/api/tax-declaration/policy")).data.canManage === true);

  ok("a regime other than new or old is refused", (await call(hr, "PUT", "/api/tax-declaration/policy", { defaultRegime: "other" })).status === 400);
  r = await call(hr, "PUT", "/api/tax-declaration/policy", { defaultRegime: "old" });
  ok("HR sets the Old regime as the default", r.status === 200 && r.data.defaultRegime === "old" && r.data.set === true, JSON.stringify(r.data));
  r = await call(e, "GET", "/api/tax-declaration");
  ok("a declaration not yet saved now starts on Old", r.data.regime === "old" && r.data.policy.defaultRegime === "old");

  ok("a file that is not a PDF or image is refused", (await call(hr, "PUT", "/api/tax-declaration/policy/document?name=x.pdf", null, Buffer.from("just some text"))).status === 400);
  r = await call(hr, "PUT", "/api/tax-declaration/policy/document?name=Tax%20policy%202026.pdf", null, PDF);
  ok("HR uploads the policy document", r.status === 200 && r.data.document && r.data.document.name === "Tax policy 2026.pdf", JSON.stringify(r.data));
  ok("the default regime is unchanged by the upload", r.data.defaultRegime === "old");
  r = await call(e, "GET", "/api/tax-declaration/policy/document");
  ok("an employee can read the policy document", r.status === 200 && r.type.includes("application/pdf") && r.data.length === PDF.length, `${r.status} ${r.type}`);
  ok("the employee's declaration page tells them a document exists", (await call(e, "GET", "/api/tax-declaration")).data.policy.document.name === "Tax policy 2026.pdf");

  // A saved declaration keeps its own choice.
  r = await call(e2, "PUT", "/api/tax-declaration", { regime: "new", items: [], submit: false });
  ok("someone saves the New regime", r.status === 200 && r.data.regime === "new", JSON.stringify(r.data));
  ok("their saved choice stays New although the default is Old", (await call(e2, "GET", "/api/tax-declaration")).data.regime === "new");
  ok("someone who has not saved still starts on Old", (await call(e, "GET", "/api/tax-declaration")).data.regime === "old");

  // The policy changes: a new default and a new document.
  r = await call(hr, "PUT", "/api/tax-declaration/policy", { defaultRegime: "new" });
  ok("the policy changes back to New", r.data.defaultRegime === "new");
  ok("so a declaration not saved yet starts on New again", (await call(e, "GET", "/api/tax-declaration")).data.regime === "new");
  const before = (await db.query("SELECT doc_stored FROM tax_regime_policies WHERE financial_year=$1", [FY])).rows[0].doc_stored;
  r = await call(hr, "PUT", "/api/tax-declaration/policy/document?name=Updated%20policy.pdf", null, PDF);
  const after = (await db.query("SELECT doc_stored FROM tax_regime_policies WHERE financial_year=$1", [FY])).rows[0].doc_stored;
  ok("a new document replaces the old one", r.data.document.name === "Updated policy.pdf" && before !== after);
  r = await call(hr, "DELETE", "/api/tax-declaration/policy/document");
  ok("HR removes the document", r.status === 200 && r.data.document === null);
  ok("then it can no longer be opened (404)", (await call(e, "GET", "/api/tax-declaration/policy/document")).status === 404);

  // It carries over to the next financial year until changed.
  await db.query("UPDATE tax_regime_policies SET financial_year = financial_year - 1");
  ok("last year's policy still applies this year", (await call(e, "GET", "/api/tax-declaration/policy")).data.defaultRegime === "new");
  await db.query("UPDATE tax_regime_policies SET default_regime='old'");
  r = await call(hr, "PUT", "/api/tax-declaration/policy", { defaultRegime: "new" });
  const rows = (await db.query("SELECT financial_year, default_regime FROM tax_regime_policies ORDER BY financial_year")).rows;
  ok("changing it this year adds this year's row and keeps last year's", rows.length === 2 && rows[0].default_regime === "old" && rows[1].default_regime === "new", JSON.stringify(rows));

  const log = (await db.query("SELECT action FROM audit_log WHERE work_email=$1 AND action ILIKE 'Tax regime policy%' ORDER BY id", [HR])).rows.map((x) => x.action).join("\n");
  ok("the changes are in the audit log", /Old regime is the default/.test(log) && /document uploaded/.test(log) && /document removed/.test(log), log);
} catch (err) { fail++; console.log("ERROR  " + err.stack); }
finally {
  await db.query("DELETE FROM tax_declaration_requests WHERE lower(email) IN ($1,$2)", [EMP, EMP2]);
  await db.query("DELETE FROM tax_regime_policies");
  await db.query("DELETE FROM sessions WHERE lower(email) IN ($1,$2,$3)", [EMP, EMP2, HR]);
  await db.query("DELETE FROM users WHERE email IN ($1,$2)", [EMP, EMP2]);
  await db.query("DELETE FROM audit_log WHERE work_email IN ($1,$2,$3) AND (action ILIKE 'Tax regime policy%' OR action ILIKE '%pay%')", [EMP, EMP2, HR]);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
