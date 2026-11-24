/*
 * Tax declarations end to end, against a LOCAL server and database (never the shared one): the previous employer's salary and
 * TDS ("prior tax") reach payroll; due dates close the declaration and the proofs, payroll reopens them for one person; payroll
 * approves a claim for less; Form 124 downloads; the estimate compares both regimes from the salary in payroll; a late change is
 * asked for and approved; leave travel keeps to two journeys a block and is exempt up to the allowance; the year's figures for
 * the return come from approved payslips.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/prior-tax-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server). It removes its own test rows afterwards.
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: BASE must be a local server."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const EMP = "test.tax.employee@wohlig.com", HR = "test.payroll.admin@wohlig.com";   // clearly named test people, removed afterwards; a local server sends no email (live-services.js)
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
async function login(email) {
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x','employee') ON CONFLICT DO NOTHING", [email]);
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(token), email]);
  return token;
}
const call = async (token, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${token}`, origin: BASE, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const raw = async (token, method, path, body) => { const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${token}`, origin: BASE, ...(body ? { "content-type": "application/octet-stream" } : {}) }, body }); return { status: r.status, type: r.headers.get("content-type") || "", buf: Buffer.from(await r.arrayBuffer()) }; };
let savedPolicy = null;
let runId = null;
const clean = async () => {
  if (runId) { await db.query("DELETE FROM payroll_items WHERE run_id=$1", [runId]); await db.query("DELETE FROM payroll_runs WHERE id=$1", [runId]); runId = null; }
  await db.query("DELETE FROM tax_late_requests WHERE lower(email)=ANY($1)", [[EMP, HR]]);
  await db.query("DELETE FROM tax_proof_files WHERE request_id IN (SELECT id FROM tax_declaration_requests WHERE lower(email)=ANY($1))", [[EMP, HR]]);
  await db.query("DELETE FROM tax_declaration_unlocks WHERE lower(email)=ANY($1)", [[EMP, HR]]);
  await db.query("DELETE FROM salary_structures WHERE lower(work_email)=$1", [EMP]);
  await db.query("DELETE FROM employees WHERE lower(work_email)=$1", [EMP]);
  await db.query("DELETE FROM tax_declaration_requests WHERE lower(email)=ANY($1)", [[EMP, HR]]);
  await db.query("DELETE FROM access_grants WHERE lower(email)=$1", [HR]);
  await db.query("DELETE FROM sessions WHERE lower(email)=ANY($1)", [[EMP, HR]]);
  await db.query("DELETE FROM users WHERE lower(email)=ANY($1)", [[EMP, HR]]);
};
try {
  await clean();
  const e = await login(EMP), hr = await login(HR);
  for (const p of ["payroll.prepare", "payroll.view"]) await db.query("INSERT INTO access_grants (email, permission, scope, granted_by, note) VALUES ($1,$2,'company','test','prior-tax-flow')", [HR, p]);

  let r = await call(e, "PUT", "/api/tax-declaration", { regime: "new", submit: true, items: [
    { section: "Previous employer salary", description: "Acme", amount: "6,00,000" }, { section: "Previous employer TDS", description: "Acme", amount: "40000" },
    { section: "80C", description: "PPF", amount: "150000" }, { section: "Income from other sources", description: "Savings interest", amount: "12000" }] });
  ok("an employee saves the previous employer's salary and TDS under the new regime", r.status === 200 && r.data.items.length === 3, JSON.stringify(r.data));
  ok("the 80C line is dropped under the new regime", r.status === 200 && !r.data.items.some((i) => i.section === "80C"));

  const fy = `${r.data.financialYear}-${String((r.data.financialYear + 1) % 100).padStart(2, "0")}`;
  r = await call(hr, "GET", `/api/payroll/declarations/${encodeURIComponent(EMP)}?fy=${fy}`);
  ok("payroll sees the employee's submission", r.status === 200 && r.data.submitted && r.data.submitted.regime === "new", `${r.status} ${JSON.stringify(r.data)}`);
  ok("in payroll's fields, in rupees", r.data && r.data.submitted && r.data.submitted.fields.previousEmployerIncome === 600000 && r.data.submitted.fields.previousEmployerTds === 40000 && r.data.submitted.fields.otherIncome === 12000, JSON.stringify(r.data && r.data.submitted));

  r = await call(e, "GET", `/api/payroll/declarations/${encodeURIComponent(EMP)}?fy=${fy}`);
  ok("an employee cannot read payroll's declarations", r.status === 403, String(r.status));

  r = await call(hr, "GET", "/api/tax-declarations");
  const mine = r.data && r.data.declarations.find((x) => x.person.email === EMP);
  ok("HR's list total leaves out salary and TDS lines", mine && mine.total === 0, JSON.stringify(mine && mine.total));

  // --- Old regime with claims; HR approves one for less.
  r = await call(e, "PUT", "/api/tax-declaration", { regime: "old", submit: true, items: [
    { section: "HRA", description: "Flat", amount: "240000", party: { name: "R Landlord", address: "Pune", pan: "ABCDE1234F", relationship: "None", metro: true } },
    { section: "80C", description: "PPF", amount: "150000" }] });
  ok("an old-regime declaration with the landlord's details is saved", r.status === 200 && r.data.items[0].party && r.data.items[0].party.pan === "ABCDE1234F", JSON.stringify(r.data));
  r = await call(e, "PUT", "/api/tax-declaration", { regime: "old", submit: true, items: [{ section: "HRA", amount: "240000", party: { name: "R", address: "Pune" } }] });
  ok("rent above ₹1 lakh without the landlord's PAN is refused on submit", r.status === 400 && r.data.errors.party0, JSON.stringify(r.data));
  await call(e, "PUT", "/api/tax-declaration", { regime: "old", submit: true, items: [
    { section: "HRA", description: "Flat", amount: "240000", party: { name: "R Landlord", address: "Pune", pan: "ABCDE1234F", metro: true } }, { section: "80C", description: "PPF", amount: "150000" }] });
  r = await call(hr, "PUT", `/api/tax-declarations/${encodeURIComponent(EMP)}/proofs`, { index: 1, status: "verified", approved: "100000", note: "One receipt is for last year." });
  ok("HR approves the 80C line for ₹1,00,000 of ₹1,50,000", r.status === 200 && r.data.items[1].proof.approved === 100000, JSON.stringify(r.data && r.data.items[1]));
  r = await call(hr, "PUT", `/api/tax-declarations/${encodeURIComponent(EMP)}/proofs`, { index: 1, status: "verified", approved: "200000", note: "x" });
  ok("never for more than declared", r.status === 400 && r.data.errors.approved);
  r = await call(hr, "GET", `/api/payroll/declarations/${encodeURIComponent(EMP)}?fy=${fy}`);
  ok("payroll's fields use the approved amount", r.data.submitted && r.data.submitted.fields.section80C === 100000, JSON.stringify(r.data.submitted));

  // --- Form 124.
  let f = await raw(e, "GET", "/api/tax-declaration/form-124");
  ok("Form 124 downloads as a PDF", f.status === 200 && f.type.includes("pdf") && f.buf.subarray(0, 5).toString() === "%PDF-", `${f.status} ${f.type}`);
  f = await raw(hr, "GET", `/api/tax-declaration/form-124?email=${encodeURIComponent(EMP)}`);
  ok("payroll can download it too", f.status === 200);
  f = await raw(e, "GET", `/api/tax-declaration/form-124?email=${encodeURIComponent(HR)}`);
  ok("an employee cannot download someone else's", f.status === 404, String(f.status));

  // --- Estimate: none without a salary, both regimes with one.
  r = await call(e, "POST", "/api/tax-declaration/estimate", { items: [] });
  ok("no salary in payroll: the estimate says so", r.status === 200 && r.data.available === false && /salary/.test(r.data.message), JSON.stringify(r.data));
  await db.query("INSERT INTO employees (work_email, name, start_date) VALUES ($1,'Test Employee (tax)','2020-01-01')", [EMP]);
  await db.query("INSERT INTO salary_structures (work_email, effective_from, earnings, professional_tax, updated_by) VALUES ($1,'2020-01',$2,200,'test')",
    [EMP, JSON.stringify([{ name: "Basic", amount: 100000 }, { name: "HRA", amount: 50000 }, { name: "Special allowance", amount: 50000 }])]);
  const t0 = Date.now();
  r = await call(e, "POST", "/api/tax-declaration/estimate", { items: [{ section: "HRA", amount: "600000", party: { metro: true } }, { section: "80C", amount: "150000" }] });
  ok("the estimate compares both regimes", r.status === 200 && r.data.available && r.data.regimes.new && r.data.regimes.old && ["new", "old"].includes(r.data.better), JSON.stringify(r.data).slice(0, 300));
  ok("with the HRA exemption from the rent", r.data.regimes && r.data.regimes.old.hra && r.data.regimes.old.hra.exemption > 0);
  console.log(`      estimate took ${Date.now() - t0} ms`);

  // --- Due dates close the declaration and the proofs; payroll reopens them for one person.
  savedPolicy = (await db.query("SELECT * FROM tax_regime_policies WHERE financial_year=$1", [r.data.financialYear ? Number(r.data.financialYear.slice(0, 4)) : 0])).rows[0] || null;
  const yesterday = (await db.query("SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date - 1, 'YYYY-MM-DD') AS d")).rows[0].d;
  const today = (await db.query("SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS d")).rows[0].d;
  r = await call(e, "PUT", "/api/tax-declaration/policy/dates", { declarationDue: yesterday, proofDue: yesterday });
  ok("an employee cannot set the due dates", r.status === 403, String(r.status));
  r = await call(hr, "PUT", "/api/tax-declaration/policy/dates", { declarationDue: yesterday, proofDue: yesterday });
  ok("payroll sets the due dates", r.status === 200 && r.data.declarationDue === yesterday, JSON.stringify(r.data));
  r = await call(e, "GET", "/api/tax-declaration");
  ok("the page says both are closed", r.data.window && !r.data.window.declaration.open && !r.data.window.proof.open, JSON.stringify(r.data.window));
  r = await call(e, "PUT", "/api/tax-declaration", { regime: "new", items: [] });
  ok("after the declaration date, the declaration cannot change", r.status === 409, String(r.status));
  f = await raw(e, "PUT", "/api/tax-declaration/proofs/0/file?name=rent.pdf", PDF);
  ok("after the proof date, no proof can be added", f.status === 409, String(f.status));
  r = await call(hr, "GET", `/api/payroll/declarations/${encodeURIComponent(EMP)}?fy=${fy}`);
  ok("payroll still sees the approved 80C line", r.data.submitted && r.data.submitted.fields.section80C === 100000);
  r = await call(hr, "POST", "/api/tax-declaration/unlocks", { email: EMP, kind: "proof", until: today });
  ok("payroll reopens the proofs for this person", r.status === 201, JSON.stringify(r.data));
  f = await raw(e, "PUT", "/api/tax-declaration/proofs/0/file?name=rent.pdf", PDF);
  ok("and the proof can be added again", f.status === 200, String(f.status));
  r = await call(hr, "GET", "/api/tax-declaration/unlocks");
  ok("the reopening is listed", r.data.unlocks.some((u) => u.person.email.toLowerCase() === EMP && u.kind === "proof"));
  r = await call(hr, "DELETE", `/api/tax-declaration/unlocks/${encodeURIComponent(EMP)}/proof`);
  ok("and can be closed again", r.status === 200);

  // --- A late change: asked for with a reason, approved until a date.
  r = await call(e, "POST", "/api/tax-declaration/late-requests", { kind: "declaration", reason: "" });
  ok("a late request needs a reason", r.status === 400 && r.data.errors.reason);
  r = await call(e, "POST", "/api/tax-declaration/late-requests", { kind: "declaration", reason: "My rent went up from January." });
  ok("after the due date, the person asks for a late change", r.status === 201 && r.data.status === "pending", JSON.stringify(r.data));
  const lateId = r.data && r.data.id;
  r = await call(e, "POST", "/api/tax-declaration/late-requests", { kind: "declaration", reason: "Again" });
  ok("only one request waits at a time", r.status === 409, String(r.status));
  r = await call(e, "GET", "/api/tax-declaration");
  ok("their page shows the request waiting", (r.data.lateRequests || []).some((x) => x.kind === "declaration" && x.status === "pending"));
  r = await call(e, "PUT", `/api/tax-declaration/late-requests/${lateId}`, { decision: "approved", until: today });
  ok("the person cannot approve their own request", r.status === 403, String(r.status));
  r = await call(hr, "GET", "/api/tax-declaration/late-requests");
  ok("payroll sees it", r.status === 200 && r.data.requests.some((x) => x.id === lateId && x.person.email.toLowerCase() === EMP));
  r = await call(hr, "PUT", `/api/tax-declaration/late-requests/${lateId}`, { decision: "declined" });
  ok("declining needs a note", r.status === 400 && r.data.errors.note);
  r = await call(hr, "PUT", `/api/tax-declaration/late-requests/${lateId}`, { decision: "approved", until: today });
  ok("payroll approves it until today", r.status === 200 && r.data.status === "approved" && r.data.until === today, JSON.stringify(r.data));
  r = await call(e, "PUT", "/api/tax-declaration", { regime: "old", items: [{ section: "80C", description: "PPF", amount: "150000" }] });
  ok("and the declaration can change again", r.status === 200, String(r.status));
  r = await call(hr, "PUT", `/api/tax-declaration/late-requests/${lateId}`, { decision: "declined", note: "x" });
  ok("an answered request cannot be answered again", r.status === 409, String(r.status));
  r = await call(e, "POST", "/api/tax-declaration/late-requests", { kind: "declaration", reason: "More" });
  ok("no request while it is open", r.status === 409, String(r.status));
  r = await call(hr, "PUT", "/api/tax-declaration/policy/dates", { declarationDue: "", proofDue: "" });
  ok("empty dates clear them", r.status === 200 && r.data.declarationDue === null && r.data.proofDue === null);

  // --- Leave travel: two journeys a block, the exemption up to the allowance paid.
  const fyNum = Number(fy.slice(0, 4));
  const trip = (startOn) => ({ section: "Leave travel", description: "Family trip", amount: "40000", party: { from: "Mumbai", to: "Jaipur", startOn, endOn: startOn, mode: "rail", travellers: "Self and spouse" } });
  await db.query("INSERT INTO tax_declaration_requests (email, financial_year, regime, items, status, submitted_at) VALUES ($1,$2,'old',$3,'submitted',now())",
    [EMP, fyNum - 1, JSON.stringify([{ ...trip(`${fyNum}-01-10`), amountMinor: 3000000 }, { ...trip(`${fyNum}-02-10`), amountMinor: 3000000 }])]);
  r = await call(e, "PUT", "/api/tax-declaration", { regime: "old", submit: true, items: [trip(`${fyNum}-10-02`)] });
  ok("a third journey in the same block is refused", r.status === 400 && /two journeys/.test(r.data.errors.journeys || ""), JSON.stringify(r.data));
  await db.query("DELETE FROM tax_declaration_requests WHERE lower(email)=$1 AND financial_year=$2", [EMP, fyNum - 1]);
  r = await call(e, "PUT", "/api/tax-declaration", { regime: "old", submit: true, items: [trip(`${fyNum}-10-02`)] });
  ok("a leave travel journey is saved with its details", r.status === 200 && r.data.items[0].party.to === "Jaipur", JSON.stringify(r.data));
  r = await call(hr, "GET", `/api/payroll/declarations/${encodeURIComponent(EMP)}?fy=${fy}`);
  ok("no leave travel allowance in the salary: no exemption", r.data.submitted && r.data.submitted.lta && r.data.submitted.lta.exemption === 0 && !r.data.submitted.fields.ltaExemption, JSON.stringify(r.data.submitted));
  await db.query("UPDATE salary_structures SET earnings = earnings || $2::jsonb WHERE lower(work_email)=$1", [EMP, JSON.stringify([{ name: "LTA", amount: 2000 }])]);
  r = await call(hr, "GET", `/api/payroll/declarations/${encodeURIComponent(EMP)}?fy=${fy}`);
  ok("with ₹2,000 a month, the ₹40,000 fare is exempt up to ₹24,000", r.data.submitted && r.data.submitted.fields.ltaExemption === 24000, JSON.stringify(r.data.submitted && r.data.submitted.lta));
  f = await raw(e, "GET", "/api/tax-declaration/form-124");
  ok("Form 124 still downloads with a journey on it", f.status === 200 && f.buf.subarray(0, 5).toString() === "%PDF-");

  // --- The year's figures for the return, from approved payslips only.
  r = await call(e, "GET", "/api/tax-declaration/year-summary");
  ok("no approved payslips yet: the summary says so", r.status === 200 && r.data.available === false, JSON.stringify(r.data).slice(0, 200));
  const period = `${fyNum}-09`;
  if (!(await db.query("SELECT 1 FROM payroll_runs WHERE period=$1", [period])).rowCount) {
    runId = (await db.query("INSERT INTO payroll_runs (period, status, processed_by) VALUES ($1,'approved','prior-tax-flow') RETURNING id", [period])).rows[0].id;
    const summary = { gross: 202000, basic: 100000, hra: 50000, reimbursements: 0, lop: 0, taxable: 202000, pf: 0, pt: 200, tds: 20000, net: 181800 };
    await db.query("INSERT INTO payroll_items (run_id, work_email, base_salary, payable, slip) VALUES ($1,$2,202000,181800,$3)", [runId, EMP, JSON.stringify({ v: 2, period, summary })]);
    const t1 = Date.now();
    r = await call(e, "GET", "/api/tax-declaration/year-summary");
    console.log(`      year summary took ${Date.now() - t1} ms`);
    ok("the summary has the approved month and its TDS", r.data.available && r.data.months.length === 1 && r.data.tdsHere === 20000 && r.data.monthsLeft > 0, JSON.stringify(r.data).slice(0, 400));
    ok("with the old regime and the leave travel exemption", r.data.regime === "old" && r.data.deductions.some((l) => /Leave travel/.test(l.name)), JSON.stringify(r.data.deductions));
    r = await call(e, "GET", `/api/tax-declaration/year-summary?fy=${fyNum - 9}`);
    ok("only the last four years can be asked for", r.status === 400, String(r.status));
  } else console.log("SKIP  year summary with a payslip: the local database already has a run for " + period);
} finally {
  if (savedPolicy) await db.query("UPDATE tax_regime_policies SET declaration_due=$2, proof_due=$3 WHERE financial_year=$1", [savedPolicy.financial_year, savedPolicy.declaration_due, savedPolicy.proof_due]);
  await clean();
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
