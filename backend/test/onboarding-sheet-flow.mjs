/*
 * The employee details sheet end to end, against a LOCAL server and a LOCAL database (never the shared one): download the template, upload a filled sheet, check the preview,
 * add the details to the profiles, and what is and is not saved or shown. The server needs PAYROLL_ENCRYPTION_KEY.
 *
 *   DATABASE_URL=postgresql://postgres:x@localhost:55434/postgres BASE=http://localhost:3190 node test/onboarding-sheet-flow.mjs
 *
 * Not part of `npm test`. It removes its test rows afterwards.
 */
import crypto from "node:crypto";
import ExcelJS from "exceljs";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3190";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB) || !/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: a local database and a local server only."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB }), sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
// Every joiner needs a reporting manager: any current employee whose name is unique (the top of the company has no manager).
const MGR = (await db.query(`SELECT name FROM employees WHERE status='active' GROUP BY name HAVING count(*)=1 ORDER BY name LIMIT 1`)).rows[0]?.name || "";
const HR = "os.hr@wohlig.com", NOBANK = "os.nobank@wohlig.com", EMP = "os.emp@wohlig.com";
const P = ["os.one@wohlig.com", "os.two@wohlig.com", "os.gone@wohlig.com", "os.four@wohlig.com", "os.five@wohlig.com"], MANUAL = "os.manual@wohlig.com";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
const login = async (email, superAdmin) => {
  await db.query("INSERT INTO users (email, password_hash, role, is_super_admin) VALUES ($1,'x',$2,$3) ON CONFLICT DO NOTHING", [email, superAdmin ? "hr" : "employee", superAdmin]);
  const t = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(t), email]);
  return t;
};
const call = async (tok, method, path, body, raw) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${tok}`, ...(body && !raw ? { "content-type": "application/json" } : {}), ...(raw ? { "content-type": "application/octet-stream" } : {}) }, body: raw ? raw : body ? JSON.stringify(body) : undefined });
  return { s: r.status, d: await r.json().catch(() => null) };
};
const download = async (tok, path) => { const r = await fetch(BASE + path, { headers: { cookie: `sid=${tok}` } }); return { s: r.status, buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") }; };
const HEAD = ["Work email", "Employee ID", "Name (for your reference)", "Date of birth", "Aadhaar number", "PAN number", "Bank account holder name", "Bank name", "Bank account number", "IFSC code", "PF / UAN number", "Mobile number", "Current address"];
const sheet = async (rows) => { const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Employee details"); ws.addRow(HEAD); rows.forEach((r) => ws.addRow(r)); return Buffer.from(await wb.xlsx.writeBuffer()); };
const FULL = ["234567890123", "BCDEF2345G", "123456789012", "987654321098"];

try {
  const wipe = async () => {
    await db.query("DELETE FROM payroll_bank_accounts WHERE lower(work_email) = ANY($1)", [[...P, MANUAL]]);
    await db.query("DELETE FROM audit_log WHERE work_email = ANY($1) OR work_email = ANY($2)", [[...P, MANUAL], [HR, NOBANK, EMP]]);
    await db.query("DELETE FROM employees WHERE work_email = ANY($1)", [[...P, MANUAL, HR, NOBANK, EMP]]);
    await db.query("DELETE FROM access_grants WHERE email=$1 AND note='onboarding-sheet-flow'", [NOBANK]);
  };
  await wipe();
  const hr = await login(HR, true), nobank = await login(NOBANK, false), emp = await login(EMP, false);
  await db.query("INSERT INTO access_grants (email, permission, scope, scope_root_email, granted_by, note) VALUES ($1,'onboarding.manage','company',NULL,'onboarding-sheet-flow','onboarding-sheet-flow')", [NOBANK]);
  const mk = (i, name, no, extra = "") => db.query(`INSERT INTO employees (emp_no, name, work_email, title, start_date, status, onboarded_at ${extra ? "," + extra.split("=")[0] : ""}) VALUES ($1,$2,$3,'Engineer','2025-01-01',$4,now() ${extra ? ",$5" : ""})`,
    extra ? [no, name, P[i], i === 2 ? "offboarded" : "active", extra.split("=")[1]] : [no, name, P[i], i === 2 ? "offboarded" : "active"]);
  await mk(0, "Asha One", "S/1"); await mk(1, "Bina Two", "S/2"); await mk(2, "Gone Three", "S/3"); await mk(3, "Dev Four", "S/4", "pan_masked=AB••••••4F"); await mk(4, "Esha Five", "S/5");

  // ---- the template ----
  let t = await download(hr, "/api/onboarding/import/template");
  ok("HR downloads the empty template as a real .xlsx", t.s === 200 && /spreadsheetml/.test(t.type) && t.buf.subarray(0, 2).toString() === "PK");
  let wb = new ExcelJS.Workbook(); await wb.xlsx.load(t.buf);
  ok("it has the predefined headings: work email, Aadhaar, PAN, bank account, IFSC and more", HEAD.every((h) => wb.getWorksheet("Employee details").getRow(1).values.includes(h)));
  const listed = []; wb.getWorksheet("Employee details").eachRow((r, n) => { if (n > 1) listed.push(r.getCell(1).value); });
  ok("it already lists everyone who still works here (and not someone who has left)", listed.includes(P[0]) && listed.includes(P[1]) && listed.includes(P[3]) && !listed.includes(P[2]), JSON.stringify(listed));
  ok("an employee cannot download it (403)", (await download(emp, "/api/onboarding/import/template")).s === 403);

  // ---- the preview ----
  const body = await sheet([
    [P[0], "", "Asha One", "14-Mar-1998", FULL[0], FULL[1], "Asha One", "HDFC Bank", FULL[2], "HDFC0001234", "MH/BAN/1/1", "9876543210", "12 Test Road, Mumbai"],
    [P[1], "", "", "", "", "FGHIJ5678K", "", "", "", "ICIC0004321", "", "", ""],
    [P[3], "", "", "02-Nov-1990", "", "", "", "", "", "", "", "", ""],
    ["nobody@wohlig.com", "", "", "", "", "BCDEF2345G", "", "", "", "", "", "", ""],
    [P[2], "", "", "", "", "BCDEF2345G", "", "", "", "", "", "", ""],
    [P[4], "", "", "01-01-2020", "1234", "abc", "", "", "", "", "", "", ""],
    [P[1], "", "", "", "", "FGHIJ5678K", "", "", "", "", "", "", ""],
    [`  `, "S/5", "", "", "", "", "", "", "", "", "", "", ""],
  ]);
  ok("a file that is not a sheet is refused (422)", (await call(hr, "POST", "/api/onboarding/import", null, Buffer.from("PK nope"))).s === 422);
  let r = await call(hr, "POST", "/api/onboarding/import", null, body);
  ok("the preview reads the sheet (8 rows: the last has only an Employee ID)", r.s === 200 && r.d.rows.length === 8, JSON.stringify(r.d && r.d.rows.map((x) => [x.row, x.status])));
  const by = Object.fromEntries(r.d.rows.map((x) => [x.row, x]));
  ok("a full row is ready, with its details shown masked", by[2].status === "ok" && by[2].name === "Asha One" && by[2].adds.some((a) => a.key === "aadhaar" && a.value === "•••• •••• 0123") && by[2].adds.some((a) => a.key === "account" && a.value === "•••• 9012"), JSON.stringify(by[2]));
  ok("it says the bank account goes to payroll for someone who can add it", by[2].bank === "payroll" && r.d.bankPayroll === true);
  ok("a partial row is ready too (PAN and IFSC only)", by[3].status === "ok" && by[3].adds.length === 2);
  ok("a row with only a date of birth is ready and leaves the saved PAN alone", by[4].status === "ok" && by[4].adds.length === 1 && by[4].adds[0].key === "dob");
  ok("someone not in the list is a problem, named", by[5].status === "error" && /No one in the employee list/.test(by[5].problems.join(" ")));
  ok("someone who has left is a problem", by[6].status === "error" && /has left/.test(by[6].problems.join(" ")));
  ok("bad values are named (date, Aadhaar, PAN)", by[7].status === "error" && by[7].problems.length >= 3, JSON.stringify(by[7].problems));
  ok("a person listed twice is a problem on the second row", by[8].status === "error" && /listed twice/.test(by[8].problems.join(" ")));
  ok("a row found by Employee ID alone with nothing to add says so", by[9].status === "nothing" && by[9].name === "Esha Five" && by[9].adds.length === 0);
  ok("no full Aadhaar, PAN or account number is in the preview answer", ![...FULL, "FGHIJ5678K"].some((n) => JSON.stringify(r.d).includes(n)), [...FULL, "FGHIJ5678K"].filter((n) => JSON.stringify(r.d).includes(n)).join() + " " + JSON.stringify(r.d.rows.map((x) => x.problems)));
  ok("an employee cannot preview (403)", (await call(emp, "POST", "/api/onboarding/import", null, body)).s === 403);
  ok("the preview saved nothing", (await db.query("SELECT pan_masked, dob FROM employees WHERE work_email=$1", [P[0]])).rows[0].pan_masked === null);

  // ---- save ----
  r = await call(hr, "POST", "/api/onboarding/import/apply", null, body);
  ok("the details are saved for the ready rows, the others skipped with their problems", r.s === 200 && r.d.saved === 3 && r.d.skipped.length === 4 && r.d.bankAdded === 1, JSON.stringify(r.d));
  let e1 = (await db.query("SELECT dob::text, aadhaar_masked, pan_masked, acct_masked, ifsc, pf_number, phone, address FROM employees WHERE work_email=$1", [P[0]])).rows[0];
  ok("the profile has the date of birth, masked Aadhaar, PAN and account, IFSC, PF number, phone and address", e1.dob === "1998-03-14" && e1.aadhaar_masked === "•••• •••• 0123" && e1.pan_masked === "BC••••••5G" && e1.acct_masked === "•••• 9012" && e1.ifsc === "HDFC0001234" && e1.pf_number === "MH/BAN/1/1" && e1.phone === "9876543210" && /Test Road/.test(e1.address), JSON.stringify(e1));
  ok("no full number is stored on the profile", !FULL.some((n) => JSON.stringify(e1).includes(n)));
  const e2 = (await db.query("SELECT pan_masked, ifsc, dob, aadhaar_masked FROM employees WHERE work_email=$1", [P[1]])).rows[0];
  ok("a partial row saves only what it had (PAN and IFSC), the rest stays empty", e2.pan_masked === "FG••••••8K" && e2.ifsc === "ICIC0004321" && e2.dob === null && e2.aadhaar_masked === null, JSON.stringify(e2));
  const e4 = (await db.query("SELECT pan_masked, dob::text FROM employees WHERE work_email=$1", [P[3]])).rows[0];
  ok("a blank cell never wipes what was saved (the PAN stays, the date of birth is added)", e4.pan_masked === "AB••••••4F" && e4.dob === "1990-11-02", JSON.stringify(e4));
  ok("the rows with problems saved nothing", (await db.query("SELECT pan_masked FROM employees WHERE work_email IN ($1,$2)", [P[2], P[4]])).rows.every((x) => x.pan_masked === null));
  const bank = (await db.query("SELECT holder_name, bank_name, ifsc, acct_last4, acct_enc FROM payroll_bank_accounts WHERE lower(work_email)=$1", [P[0]])).rows[0];
  ok("the bank account went to payroll, encrypted, with the last four digits", !!bank && bank.acct_last4 === "9012" && bank.holder_name === "Asha One" && bank.bank_name === "HDFC Bank" && !String(bank.acct_enc).includes(FULL[2]), JSON.stringify(bank && [bank.acct_last4, bank.holder_name]));
  const log = (await db.query("SELECT action FROM audit_log WHERE work_email = ANY($1) ORDER BY id", [P])).rows.map((x) => x.action).join("\n");
  ok("the audit log says who added what, with no number in it", /Profile details added from the uploaded sheet by os\.hr@wohlig\.com: .*bank account \(•••• 9012\)/.test(log) && !FULL.some((n) => log.includes(n)) && !log.includes("FGHIJ5678K"), log);
  const list = (await call(hr, "GET", "/api/onboarding")).d;
  ok("the profile's onboarding record now has the details, even for someone who was never onboarded here", (list.find((x) => x.email === P[1]) || {}).ids && list.find((x) => x.email === P[1]).ids.pan === "FG••••••8K" && !!list.find((x) => x.email === P[3]), JSON.stringify(list.find((x) => x.email === P[1])));
  r = await call(hr, "POST", "/api/onboarding/import", null, body);
  ok("uploading the same sheet again shows what is already saved", r.s === 200 && r.d.rows.find((x) => x.row === 2).adds.every((a) => a.status === "same" || a.status === "new"), JSON.stringify(r.d.rows.find((x) => x.row === 2).adds.map((a) => [a.key, a.status])));

  // ---- someone who may onboard but not manage bank accounts ----
  const nb = await sheet([[P[4], "", "", "20-Jun-1995", "", "KLMNO1234P", "Esha Five", "SBI", FULL[3], "SBIN0001234", "", "", ""]]);
  r = await call(nobank, "POST", "/api/onboarding/import", null, nb);
  ok("without the bank permission the preview says only the profile gets the bank account", r.s === 200 && r.d.rows[0].bank === "profile" && r.d.bankPayroll === false, JSON.stringify(r.d));
  r = await call(nobank, "POST", "/api/onboarding/import/apply", null, nb);
  ok("the profile details are saved and payroll gets no bank account, with a note saying why", r.s === 200 && r.d.saved === 1 && r.d.bankAdded === 0 && r.d.notes.length === 1, JSON.stringify(r.d));
  ok("the profile has the masked account; payroll has none", (await db.query("SELECT acct_masked FROM employees WHERE work_email=$1", [P[4]])).rows[0].acct_masked === "•••• 1098" && (await db.query("SELECT 1 FROM payroll_bank_accounts WHERE lower(work_email)=$1", [P[4]])).rowCount === 0);

  // ---- an account whose bank details are incomplete, and the last onboarding step ----
  const inc = await sheet([[P[1], "", "", "", "", "", "", "", "555566667777", "", "", "", ""]]);
  r = await call(hr, "POST", "/api/onboarding/import/apply", null, inc);
  ok("an account number without the holder and bank name is kept masked and flagged for payroll", r.s === 200 && r.d.bankAdded === 0 && /holder name, the bank name/.test(r.d.notes[0].message), JSON.stringify(r.d));
  let w = await call(hr, "POST", "/api/onboarding/work-email", { d: { first: "Manny", last: "Manual", pemail: "manny.p@example.com", phone: "9876543210", address: "12 Test Road, Mumbai", dept: "Engineering", title: "Developer", mgr: MGR, em1n: "Test Contact", em1r: "Parent", em1p: "9123456780", start: "2026-12-07", kind: "Employee" }, typedEmail: MANUAL });
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x','employee') ON CONFLICT DO NOTHING", [MANUAL]);
  await call(hr, "POST", "/api/onboarding/import/apply", null, await sheet([[MANUAL, "", "", "05-May-1996", "", "PQRST1234U", "", "", "", "", "", "", ""]]));
  w = await call(hr, "POST", "/api/onboarding", { existingEmail: MANUAL, ids: {}, apps: [], d: { first: "Manny", last: "Manual", pemail: "manny.p@example.com", phone: "9876543210", address: "12 Test Road, Mumbai", dept: "Engineering", title: "Developer", mgr: MGR, em1n: "Test Contact", em1r: "Parent", em1p: "9123456780", start: "2026-12-07", kind: "Employee" } });
  const fin = (await db.query("SELECT dob::text, pan_masked FROM employees WHERE work_email=$1", [MANUAL])).rows[0];
  ok("finishing onboarding with the ID boxes empty does not wipe what the sheet filled in", w.s === 201 && fin.dob === "1996-05-05" && fin.pan_masked === "PQ••••••4U", JSON.stringify([w.s, fin]));
} catch (e) { fail++; console.log("ERROR  " + e.stack); }
finally {
  await db.query("DELETE FROM payroll_bank_accounts WHERE lower(work_email) = ANY($1)", [[...P, MANUAL]]);
  await db.query("DELETE FROM audit_log WHERE work_email = ANY($1) OR work_email = ANY($2)", [[...P, MANUAL], [HR, NOBANK, EMP]]);
  await db.query("DELETE FROM invites WHERE lower(email) = $1", [MANUAL]).catch(() => {});
  await db.query("DELETE FROM digital_kits WHERE employee_id IN (SELECT id FROM employees WHERE work_email = $1)", [MANUAL]).catch(() => {});
  await db.query("DELETE FROM onboarding_drafts WHERE id = ANY($1)", [[HR, NOBANK]]).catch(() => {});
  await db.query("DELETE FROM employees WHERE work_email = ANY($1)", [[...P, MANUAL, HR, NOBANK, EMP]]).catch((e) => console.log("cleanup:", e.message));
  await db.query("DELETE FROM access_grants WHERE email=$1 AND note='onboarding-sheet-flow'", [NOBANK]);
  await db.query("DELETE FROM sessions WHERE lower(email) = ANY($1)", [[HR, NOBANK, EMP]]);
  await db.query("DELETE FROM users WHERE email = ANY($1)", [[HR, NOBANK, EMP, MANUAL]]);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
