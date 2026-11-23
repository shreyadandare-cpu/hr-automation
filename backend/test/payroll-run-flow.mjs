/*
 * The monthly payroll end to end, against a LOCAL server and a LOCAL database (never the shared one): start the month, choose who is processed (hold, release,
 * process only the selected), calculate, generate the Excel report, send for review, review by someone else, the bank files (CSV and Excel), and what is locked once approved.
 *
 *   DATABASE_URL=postgresql://postgres:x@localhost:55434/postgres BASE=http://localhost:3190 node test/payroll-run-flow.mjs
 *
 * The server needs PAYROLL_ENCRYPTION_KEY. Not part of `npm test`. It removes its test rows afterwards (approved payroll cannot be deleted normally, so the
 * cleanup switches the triggers off for its own session: use a throwaway database).
 */
import crypto from "node:crypto";
import ExcelJS from "exceljs";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3190";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB) || !/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: a local database and a local server only."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB }), sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const HR = "pr.hr@wohlig.com", REV = "pr.reviewer@wohlig.com", EMP = "pr.emp@wohlig.com", E = ["pr.one@wohlig.com", "pr.two@wohlig.com", "pr.three@wohlig.com"];
const NAMES = ["Asha One", "Bina Two", "Chetan Three"], ACCT = ["111122223333", "222233334444", "333344445555"];
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
const login = async (email, superAdmin) => {
  await db.query("INSERT INTO users (email, password_hash, role, is_super_admin) VALUES ($1,'x',$2,$3) ON CONFLICT DO NOTHING", [email, superAdmin ? "hr" : "employee", superAdmin]);
  const t = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(t), email]);
  return t;
};
const call = async (tok, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${tok}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, d: await r.json().catch(() => null) };
};
const file = async (tok, path) => { const r = await fetch(BASE + path, { headers: { cookie: `sid=${tok}` } }); return { s: r.status, buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") }; };
const month = (add = 0) => { const d = new Date(Date.now() + 330 * 60000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + add); return d.toISOString().slice(0, 7); };
const PERIOD = month(-1);
const rowsOf = (ws) => { const out = []; ws.eachRow((row) => out.push(row.values.slice(1).map((v) => (v && typeof v === "object" && "result" in v ? v.result : v)))); return out; };
const structure = (gross) => ({ effectiveFrom: month(-3), earnings: [{ name: "Basic", amount: gross * 0.5 }, { name: "HRA", amount: gross * 0.3 }, { name: "Special allowance", amount: gross * 0.2 }], pfEmployee: 1800, professionalTax: 200, otherDeductions: [], tdsMode: "manual", tdsMonthly: 0, reason: "Offer", annualCtc: gross * 12, pfApplicable: true, ptApplicable: true, tdsApplicable: false });

// Approved payroll is protected by triggers, so the test's own cleanup switches them off for its session, on this throwaway database only.
const wipe = async () => {
  const c = await db.connect();
  try {
    await c.query("SET session_replication_role = replica");
    const runs = "(SELECT id FROM payroll_runs WHERE processed_by=$1)";
    for (const t of ["payroll_files", "payroll_items"]) await c.query(`DELETE FROM ${t} WHERE run_id IN ${runs}`, [HR]).catch(() => {});
    await c.query("DELETE FROM payroll_audit WHERE actor = ANY($1) OR work_email = ANY($2)", [[HR, REV], E]).catch(() => {});
    await c.query("DELETE FROM payroll_runs WHERE processed_by=$1", [HR]).catch((e) => console.log("cleanup runs:", e.message));
    await c.query("DELETE FROM salary_structures WHERE lower(work_email) = ANY($1)", [E]);
    await c.query("DELETE FROM payroll_bank_accounts WHERE lower(work_email) = ANY($1)", [E]);
    await c.query("DELETE FROM access_grants WHERE email=$1 AND note='payroll-run-flow'", [REV]);
  } finally { await c.query("RESET session_replication_role").catch(() => {}); c.release(); }
};

try {
  await wipe();
  for (const e of [...E, HR, REV, EMP]) await db.query("DELETE FROM employees WHERE work_email=$1", [e]);
  const hr = await login(HR, true), rev = await login(REV, false), emp = await login(EMP, false);
  await db.query("INSERT INTO access_grants (email, permission, scope, scope_root_email, granted_by, note) VALUES ($1,'payroll.approve','company',NULL,'payroll-run-flow','payroll-run-flow')", [REV]);
  for (const [i, e] of E.entries()) await db.query("INSERT INTO employees (emp_no, name, work_email, title, dept, start_date, status, onboarded_at, pan_masked) VALUES ($1,$2,$3,'Engineer','Engineering',$4,'active',now(),'XXXXX1234X')", [`R/${i + 1}`, NAMES[i], e, `${month(-6)}-01`]);
  for (const [i, e] of E.entries()) {
    let r = await call(hr, "PUT", `/api/payroll/structures/${encodeURIComponent(e)}`, structure(50000 + i * 10000));
    if (r.s !== 200) throw new Error(`salary ${e}: ${r.s} ${JSON.stringify(r.d)}`);
    r = await call(hr, "PUT", `/api/payroll/bank/${encodeURIComponent(e)}`, { holder: NAMES[i], bankName: "HDFC Bank", ifsc: "HDFC0001234", account: ACCT[i], accountConfirm: ACCT[i] });
    if (r.s !== 200) throw new Error(`bank ${e}: ${r.s} ${JSON.stringify(r.d)}`);
  }

  // ---- start the month ----
  let r = await call(hr, "POST", "/api/payroll/runs", { period: PERIOD });
  ok("HR starts payroll for last month", r.s === 201, JSON.stringify(r.d));
  const id = r.d.id;
  const run = async () => (await call(hr, "GET", `/api/payroll/runs/${id}`)).d;
  let d = await run();
  const mine = (x) => x.lines.filter((l) => E.includes(l.email));
  ok("the three employees are on it, calculated from their salary (gross 50,000 / 60,000 / 70,000)", mine(d).length === 3 && mine(d).map((l) => l.summary.gross).sort().join() === "50000,60000,70000", JSON.stringify(mine(d).map((l) => l.summary.gross)));
  ok("net is worked out by the server: gross - PF - PT = 50,000 - 1,800 - 200 for the first", mine(d).find((l) => l.email === E[0]).summary.net === 48000);

  // ---- who is processed ----
  ok("an employee cannot change who is processed (403)", (await call(emp, "POST", `/api/payroll/runs/${id}/hold`, { action: "hold", emails: [E[2]], reason: "No reason" })).s === 403);
  ok("a hold needs a reason (400)", (await call(hr, "POST", `/api/payroll/runs/${id}/hold`, { action: "hold", emails: [E[2]] })).s === 400);
  ok("nobody selected is refused (400)", (await call(hr, "POST", `/api/payroll/runs/${id}/hold`, { action: "hold", emails: [], reason: "Because" })).s === 400);
  r = await call(hr, "POST", `/api/payroll/runs/${id}/hold`, { action: "hold", emails: [E[2]], reason: "Joining in the last week" });
  ok("HR puts one person on hold", r.s === 200 && r.d.held === 1, JSON.stringify(r.d));
  d = await run();
  const h3 = mine(d).find((l) => l.email === E[2]);
  ok("they are on hold with the reason and out of the paid total", h3.status === "hold" && h3.inputs.holdReason === "Joining in the last week" && d.totals.net === d.lines.filter((l) => l.status === "ready").reduce((n, l) => n + l.summary.net, 0), JSON.stringify([h3.status, d.totals.net]));
  ok("holding someone already on hold changes nothing (409)", (await call(hr, "POST", `/api/payroll/runs/${id}/hold`, { action: "hold", emails: [E[2]], reason: "Again please" })).s === 409);
  r = await call(hr, "POST", `/api/payroll/runs/${id}/hold`, { action: "only", emails: [E[0]], reason: "Only the first this time" });
  d = await run();
  ok("'process only the selected' holds everyone else and keeps the selected", r.s === 200 && mine(d).find((l) => l.email === E[0]).status === "ready" && mine(d).find((l) => l.email === E[1]).status === "hold" && mine(d).find((l) => l.email === E[2]).status === "hold", JSON.stringify(mine(d).map((l) => l.status)));
  r = await call(hr, "POST", `/api/payroll/runs/${id}/hold`, { action: "release", emails: [E[1]] });
  d = await run();
  ok("a hold can be released, with no reason needed", r.s === 200 && r.d.released === 1 && mine(d).find((l) => l.email === E[1]).status === "ready");
  ok("a released person's inputs no longer carry the hold", mine(d).find((l) => l.email === E[1]).inputs.hold === undefined && mine(d).find((l) => l.email === E[1]).inputs.holdReason === undefined);
  await call(hr, "POST", `/api/payroll/runs/${id}/hold`, { action: "release", emails: [E[2]] });
  d = await run();
  ok("everyone is processed again", mine(d).every((l) => l.status === "ready"));
  const net = d.totals.net;

  // ---- calculate, generate, review ----
  r = await call(hr, "POST", `/api/payroll/runs/${id}/actions/calculate`);
  ok("marked as calculated", r.s === 200, JSON.stringify(r.d));
  r = await call(hr, "POST", `/api/payroll/runs/${id}/actions/generate`);
  ok("the Excel report is generated", r.s === 200 && !!r.d.file, JSON.stringify(r.d));
  d = await run();
  const wbMeta = d.files.find((f) => f.kind === "workbook" && !f.superseded);
  const wbFile = await file(hr, `/api/payroll/runs/${id}/files/${wbMeta.id}`);
  ok("it downloads as a real .xlsx (a zip with the spreadsheet type)", wbFile.s === 200 && /spreadsheetml/.test(wbFile.type) && wbFile.buf.subarray(0, 2).toString() === "PK");
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(wbFile.buf);
  const s1 = rowsOf(wb.getWorksheet("Employee Payroll Summary")), head = s1.find((x) => x[0] === "Name");
  const need = ["Name", "Employee ID", "Department", "Designation", "Monthly salary (full month)", "Basic", "HRA", "Other allowances", "Gross", "PF", "PT", "TDS", "Reimbur", "Net Payable", "Bank", "Account (last 4)", "IFSC"];
  ok("sheet 1 has the employee, salary, deduction, net and bank columns", need.every((h) => head.includes(h)), JSON.stringify(head));
  const idx = (h) => head.indexOf(h), one = s1.find((x) => x[0] === NAMES[0]);
  ok("a row carries the person's details, components and bank (name, last four, IFSC)", !!one && one[idx("Employee ID")] === "R/1" && one[idx("Department")] === "Engineering" && one[idx("Designation")] === "Engineer" && one[idx("Monthly salary (full month)")] === 50000 && one[idx("Basic")] === 25000 && one[idx("HRA")] === 15000 && one[idx("Other allowances")] === 10000 && one[idx("Gross")] === 50000 && one[idx("Net Payable")] === 48000 && one[idx("Bank")] === "HDFC Bank" && one[idx("Account (last 4)")] === "••3333" && one[idx("IFSC")] === "HDFC0001234", JSON.stringify(one));
  const everyCell = JSON.stringify(wb.worksheets.map((w) => rowsOf(w)));
  ok("no full account number is anywhere in the stored report", !ACCT.some((a) => everyCell.includes(a)));
  const totalRow = s1.find((x) => String(x[0]).startsWith("Grand total"));
  ok("the grand total row carries the net total of the month", !!totalRow && Math.abs(totalRow[idx("Net Payable")] - net) < 0.005, JSON.stringify([totalRow && totalRow[idx("Net Payable")], net]));
  ok("the summary sheet compares the totals with the database and says they match", rowsOf(wb.getWorksheet("Payroll Summary")).some((x) => x.includes("Matches")));
  ok("an employee cannot download the report (403 or 404)", [403, 404].includes((await file(emp, `/api/payroll/runs/${id}/files/${wbMeta.id}`)).s));

  r = await call(hr, "POST", `/api/payroll/runs/${id}/actions/submit`, { note: "Please review" });
  ok("HR sends it for review", r.s === 200, JSON.stringify(r.d));
  ok("the person who sent it cannot approve it (maker-checker)", (await call(hr, "POST", `/api/payroll/runs/${id}/actions/approve`, {})).s >= 400);
  ok("the reviewer can see it now that it is sent", (await call(rev, "GET", `/api/payroll/runs/${id}`)).s === 200);
  r = await call(rev, "POST", `/api/payroll/runs/${id}/actions/reject`, { note: "Check the third salary" });
  ok("the reviewer rejects with a comment", r.s === 200, JSON.stringify(r.d));
  d = await run();
  ok("the rejection, who and why are on the run", d.run.status === "rejected" && d.run.reviewedBy === REV && /third salary/.test(d.run.reviewNote || ""), JSON.stringify([d.run.status, d.run.reviewedBy, d.run.reviewNote]));
  ok("HR can correct it after a rejection (hold one, release again)", (await call(hr, "POST", `/api/payroll/runs/${id}/hold`, { action: "hold", emails: [E[2]], reason: "Check the third salary" })).s === 200 && (await call(hr, "POST", `/api/payroll/runs/${id}/hold`, { action: "release", emails: [E[2]] })).s === 200);
  for (const a of ["calculate", "generate", "submit"]) r = await call(hr, "POST", `/api/payroll/runs/${id}/actions/${a}`);
  ok("and resubmit", r.s === 200, JSON.stringify(r.d));
  d = await run();
  ok("a new Excel version was made and the old one kept as superseded", d.files.filter((f) => f.kind === "workbook").length === 2 && d.files.filter((f) => f.kind === "workbook" && !f.superseded).length === 1);
  r = await call(rev, "POST", `/api/payroll/runs/${id}/actions/approve`, { note: "Looks right" });
  ok("the reviewer approves", r.s === 200, JSON.stringify(r.d));

  // ---- locked once approved ----
  d = await run();
  const line1 = d.lines.find((l) => l.email === E[0]);
  ok("an approved payroll cannot be edited (409)", (await call(hr, "PUT", `/api/payroll/runs/${id}/lines/${line1.id}`, { incentives: 500 })).s === 409);
  ok("nor can who is processed be changed (409)", (await call(hr, "POST", `/api/payroll/runs/${id}/hold`, { action: "hold", emails: [E[0]], reason: "Changed my mind" })).s === 409);
  ok("no bank file exists before it is made", !d.files.some((f) => f.kind === "bank" || f.kind === "bank_xlsx"));

  // ---- the bank files ----
  r = await call(hr, "POST", `/api/payroll/runs/${id}/actions/bank_file`);
  ok("HR generates the bank transfer file", r.s === 200, JSON.stringify(r.d));
  d = await run();
  const csv = d.files.find((f) => f.kind === "bank" && !f.superseded), xl = d.files.find((f) => f.kind === "bank_xlsx" && !f.superseded);
  ok("both a CSV and an Excel sheet are made, with the same version", !!csv && !!xl && csv.version === xl.version, JSON.stringify(d.files.map((f) => [f.kind, f.version])));
  const csvFile = await file(hr, `/api/payroll/runs/${id}/files/${csv.id}`), xlFile = await file(hr, `/api/payroll/runs/${id}/files/${xl.id}`);
  ok("both download for someone with the bank permission", csvFile.s === 200 && xlFile.s === 200 && /spreadsheetml/.test(xlFile.type) && xlFile.buf.subarray(0, 2).toString() === "PK");
  ok("the reviewer (no bank permission) cannot download either (403 or 404)", [403, 404].includes((await file(rev, `/api/payroll/runs/${id}/files/${xl.id}`)).s) && [403, 404].includes((await file(rev, `/api/payroll/runs/${id}/files/${csv.id}`)).s));
  const bx = new ExcelJS.Workbook(); await bx.xlsx.load(xlFile.buf);
  const brows = rowsOf(bx.getWorksheet("Salary transfer")), bh = brows.find((x) => x[0] === "Payment Reference");
  const amountCol = bh.indexOf("Amount"), acctCol = bh.indexOf("Beneficiary Account Number"), ifscCol = bh.indexOf("IFSC"), pay = brows.filter((x) => ACCT.includes(String(x[acctCol])));
  ok("the Excel bank sheet has one row per person with name, account, IFSC and net amount", pay.length === 3 && pay.every((x) => x[ifscCol] === "HDFC0001234" && typeof x[amountCol] === "number"), JSON.stringify(brows.slice(2, 8)));
  const total = pay.reduce((n, x) => n + x[amountCol], 0), csvRows = csvFile.buf.toString("utf8").trim().split(/\r?\n/).slice(1), csvTotal = csvRows.reduce((n, l) => n + Number(l.split(",")[5]), 0);
  ok("its total equals the CSV's total and the approved net payable", Math.abs(total - net) < 0.005 && Math.abs(csvTotal - net) < 0.005, JSON.stringify([total, csvTotal, net]));
  ok("the sheet says its total matches the approved net", brows.some((x) => x.includes("Matches")));
  ok("account numbers are kept as text, not numbers", pay.every((x) => typeof x[acctCol] === "string"));
  ok("the stored copies are encrypted (the database holds no account number in clear)", (await db.query("SELECT count(*)::int AS n FROM payroll_files WHERE run_id=$1 AND kind IN ('bank','bank_xlsx') AND position(convert_to($2,'UTF8') in content) > 0", [id, ACCT[0]])).rows[0].n === 0);

  // ---- processed, history, audit ----
  ok("marking it processed needs the bank's reference (400)", (await call(hr, "POST", `/api/payroll/runs/${id}/actions/mark_paid`, {})).s === 400);
  r = await call(hr, "POST", `/api/payroll/runs/${id}/actions/mark_paid`, { bankReference: "UTR123456" });
  ok("HR marks it processed with the reference", r.s === 200, JSON.stringify(r.d));
  const hist = (await call(hr, "GET", "/api/payroll/runs")).d, mineRun = hist.find((x) => x.id === id);
  ok("history lists the month, its status, who approved it and all its files (2 reports, CSV, Excel)", !!mineRun && mineRun.status === "paid" && mineRun.reviewedBy === REV && mineRun.files.length === 4, JSON.stringify(mineRun && [mineRun.status, mineRun.reviewedBy, mineRun.files.length]));
  const audit = JSON.stringify((await call(hr, "GET", "/api/payroll/audit")).d);
  ok("the audit log has the hold, the review, the files and the downloads", ["Salary put on hold", "Salary hold released", "Bank transfer file generated", "Bank transfer file downloaded", "Payroll report downloaded"].every((a) => audit.includes(a)), audit.slice(0, 200));
} catch (e) { fail++; console.log("ERROR  " + e.stack); }
finally {
  await wipe().catch((e) => console.log("cleanup:", e.message));
  await db.query("DELETE FROM sessions WHERE lower(email) IN ($1,$2,$3)", [HR, REV, EMP]);
  await db.query("DELETE FROM employees WHERE work_email = ANY($1)", [[...E, HR, REV, EMP]]);
  await db.query("DELETE FROM users WHERE email = ANY($1)", [[HR, REV, EMP]]);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
