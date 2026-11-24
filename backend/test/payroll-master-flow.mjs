/*
 * The payroll master end to end, against a LOCAL server and a LOCAL database (never the shared one): upload a 50-person sheet, edit in place, the form, a second upload,
 * a new joiner, access, and the download. The server needs PAYROLL_ENCRYPTION_KEY.
 *
 *   DATABASE_URL=postgresql://postgres:x@localhost:55434/postgres BASE=http://localhost:3190 node test/payroll-master-flow.mjs
 *
 * Not part of `npm test`. It removes its test rows afterwards (the append-only payroll audit rows stay, so use a throwaway database).
 */
import crypto from "node:crypto";
import ExcelJS from "exceljs";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3190";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB) || !/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: a local database and a local server only."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB }), sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const HR = "pm.hr@wohlig.com", EMP = "pm.emp@wohlig.com", NEW = "pm.new@wohlig.com";
const mail = (i) => `pm.p${i}@wohlig.com`, no = (i) => `PM/${String(i).padStart(3, "0")}`;
const letters = (i) => String.fromCharCode(65 + (i % 26)) + String.fromCharCode(97 + ((i * 7) % 26)) + "ana " + String.fromCharCode(65 + ((i * 3) % 26)) + "umar";
const pan = (i) => `ABCD${String.fromCharCode(65 + (i % 26))}${String(1000 + i)}${String.fromCharCode(65 + ((i * 5) % 26))}`;
const aad = (i) => String(300000000000 + i * 1111111);
const acct = (i) => String(5000000000 + i * 13);
const N = 50;
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
const login = async (email, superAdmin) => {
  await db.query("INSERT INTO users (email, password_hash, role, is_super_admin) VALUES ($1,'x',$2,$3) ON CONFLICT DO NOTHING", [email, superAdmin ? "hr" : "employee", superAdmin]);
  const t = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(t), email]);
  return t;
};
const call = async (tok, method, path, body, raw) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${tok}`, ...(raw ? { "content-type": "application/octet-stream" } : body ? { "content-type": "application/json" } : {}) }, body: raw || (body ? JSON.stringify(body) : undefined) });
  return { s: r.status, d: await r.json().catch(() => null) };
};
const download = async (tok, path) => { const r = await fetch(BASE + path, { headers: { cookie: `sid=${tok}` } }); return { s: r.status, buf: Buffer.from(await r.arrayBuffer()) }; };
const HEAD = ["No.", "Account Holder Name", "Bank Name", "Account Number", "IFSC Code", "Branch Name"];
const sheet = async (rows) => { const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Payroll master"); ws.addRow(HEAD); rows.forEach((r) => ws.addRow(r)); return Buffer.from(await wb.xlsx.writeBuffer()); };
const fullRow = (i, over = {}) => [no(i), letters(i), over.bank || "HDFC Bank", acct(i), over.ifsc || "HDFC0001234", "Andheri"];
const cells = async (buf) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); const out = []; wb.worksheets[0].eachRow((r) => out.push(r.values.slice(1).map((c) => (c && c.text !== undefined ? c.text : c)))); return out; };

try {
  const wipe = async () => {
    const em = [...Array.from({ length: N }, (_, i) => mail(i + 1)), HR, EMP, NEW];
    await db.query("DELETE FROM payroll_bank_accounts WHERE lower(work_email) = ANY($1)", [em]);
    await db.query("DELETE FROM payroll_master WHERE lower(work_email) = ANY($1)", [em]);
    await db.query("DELETE FROM audit_log WHERE work_email = ANY($1)", [em]);
    await db.query("DELETE FROM employees WHERE work_email = ANY($1)", [em]);
  };
  await wipe();
  const hr = await login(HR, true), emp = await login(EMP, false);
  for (let i = 1; i <= N; i++) await db.query("INSERT INTO employees (emp_no, name, work_email, title, dept, start_date, status, onboarded_at) VALUES ($1,$2,$3,'Developer','Engineering','2025-01-01','active',now())", [no(i), letters(i), mail(i)]);

  // Test 7 first: a regular employee is refused by the server
  const forbid = [await call(emp, "GET", "/api/payroll/master"), await call(emp, "PATCH", `/api/payroll/master/${mail(1)}`, { ifsc: "HDFC0001234" }), await call(emp, "POST", `/api/payroll/master/${mail(1)}/reveal`, { field: "pan" }),
    await download(emp, "/api/payroll/master/export"), await call(emp, "POST", "/api/payroll/master/import", null, Buffer.from("x"))];
  ok("Test 7: a regular employee is denied every master route (403)", forbid.every((x) => x.s === 403), JSON.stringify(forbid.map((x) => x.s)));

  // Test 1: 50 people in one sheet
  const big = await sheet(Array.from({ length: N }, (_, i) => fullRow(i + 1)));
  let r = await call(hr, "POST", "/api/payroll/master/import", null, big);
  ok("Test 1: the preview shows 50 changes, nothing failed, nothing saved yet", r.s === 200 && r.d.counts.change === N && r.d.counts.failed === 0 && (await db.query("SELECT 1 FROM payroll_bank_accounts WHERE work_email LIKE 'pm.p%'")).rowCount === 0, JSON.stringify(r.d && r.d.counts));
  ok("the preview shows masked numbers only", !JSON.stringify(r.d).includes(acct(1)) && !JSON.stringify(r.d).includes(aad(1)) && !JSON.stringify(r.d).includes(pan(1)));
  r = await call(hr, "POST", "/api/payroll/master/import/apply", null, big);
  ok("Test 1: all 50 are saved", r.s === 200 && r.d.saved.length === N && r.d.failed.length === 0, JSON.stringify(r.d && { s: r.d.saved.length, f: r.d.failed.slice(0, 2) }));
  for (let i = 1; i <= N; i++) await call(hr, "PATCH", `/api/payroll/master/${mail(i)}`, { aadhaar: aad(i), pan: pan(i) });   // Aadhaar and PAN go in through the form
  const nb = (await db.query("SELECT count(*)::int AS n FROM payroll_bank_accounts WHERE work_email LIKE 'pm.p%'")).rows[0].n, nm = (await db.query("SELECT count(*)::int AS n FROM payroll_master WHERE work_email LIKE 'pm.p%' AND aadhaar_enc IS NOT NULL AND pan_enc IS NOT NULL")).rows[0].n;
  ok("in the database: 50 bank accounts, 50 encrypted Aadhaar and PAN", nb === N && nm === N, `${nb} ${nm}`);
  const raw = (await db.query("SELECT aadhaar_enc, pan_enc FROM payroll_master WHERE work_email=$1", [mail(1)])).rows[0];
  ok("Aadhaar and PAN are not stored in the clear", !raw.aadhaar_enc.includes(aad(1)) && !raw.pan_enc.includes(pan(1)) && raw.aadhaar_enc.startsWith("v1:"));

  // Test 2: the form shows what was uploaded
  r = await call(hr, "GET", `/api/payroll/master/${mail(7)}`);
  const p7 = r.d && r.d.person;
  ok("Test 2: the form for one person has bank, branch, Aadhaar and PAN filled in (masked)", r.s === 200 && p7.bankName === "HDFC Bank" && p7.holder === letters(7) && p7.branch === "Andheri" && p7.account === `•••• ${acct(7).slice(-4)}` && p7.aadhaar.endsWith(aad(7).slice(-4)) && p7.pan.startsWith("AB") && !JSON.stringify(r.d).includes(aad(7)), JSON.stringify(p7));
  const prof = (await db.query("SELECT acct_masked, ifsc, pan_masked, aadhaar_masked FROM employees WHERE work_email=$1", [mail(7)])).rows[0];
  ok("and the employee profile has the masked numbers too", prof.acct_masked.endsWith(acct(7).slice(-4)) && prof.ifsc === "HDFC0001234" && prof.pan_masked && prof.aadhaar_masked, JSON.stringify(prof));

  // Test 3: change IFSC in the form → the table shows it
  r = await call(hr, "PATCH", `/api/payroll/master/${mail(7)}`, { ifsc: "ICIC0004321" });
  ok("Test 3: changing the IFSC in the form saves", r.s === 200 && r.d.person.ifsc === "ICIC0004321", JSON.stringify(r.d));
  r = await call(hr, "GET", `/api/payroll/master?q=${no(7)}`);
  ok("the master table shows the new IFSC and the account is untouched", r.d.people.length === 1 && r.d.people[0].ifsc === "ICIC0004321" && r.d.people[0].account === `•••• ${acct(7).slice(-4)}`, JSON.stringify(r.d.people));
  ok("the bank record used for transfers has it", (await db.query("SELECT ifsc FROM payroll_bank_accounts WHERE work_email=$1", [mail(7)])).rows[0].ifsc === "ICIC0004321");

  // Test 4: edit the account number in the table → the form shows it
  const NEWACC = "9988776655443";
  r = await call(hr, "PATCH", `/api/payroll/master/${mail(8)}`, { account: NEWACC });
  r = await call(hr, "GET", `/api/payroll/master/${mail(8)}`);
  ok("Test 4: the form shows the edited account number (masked)", r.d.person.account === "•••• 5443", JSON.stringify(r.d.person));
  r = await call(hr, "POST", `/api/payroll/master/${mail(8)}/reveal`, { field: "account" });
  ok("an authorised reveal returns the full number", r.s === 200 && r.d.value === NEWACC, JSON.stringify(r.d));
  ok("the reveal is in the audit trail without the number", (await db.query("SELECT detail::text AS d FROM payroll_audit WHERE work_email=$1 AND action='Full number viewed'", [mail(8)])).rows.every((x) => !x.d.includes(NEWACC)) && (await db.query("SELECT 1 FROM payroll_audit WHERE work_email=$1 AND action='Full number viewed'", [mail(8)])).rowCount === 1);
  ok("no audit line holds a full number", (await db.query("SELECT 1 FROM payroll_audit WHERE detail::text LIKE ANY($1)", [[`%${NEWACC}%`, `%${aad(8)}%`, `%${pan(8)}%`]])).rowCount === 0);
  r = await call(hr, "PATCH", `/api/payroll/master/${mail(8)}`, { pan: "bad", ifsc: "nope" });
  ok("wrong formats are refused with plain messages (422)", r.s === 422 && r.d.errors.pan && r.d.errors.ifsc, JSON.stringify(r.d));
  r = await call(hr, "POST", `/api/payroll/master/${mail(9)}/reveal`, { field: "pan" });
  ok("a reveal works for a PAN too", r.s === 200 && r.d.value === pan(9), JSON.stringify(r.d));

  // a bank account typed in pieces waits, then completes
  await db.query("INSERT INTO employees (emp_no, name, work_email, title, dept, start_date, status, onboarded_at) VALUES ('PM/900','Part Time',$1,'Dev','Eng','2025-01-01','active',now())", [NEW.replace("new", "part")]);
  const PART = NEW.replace("new", "part");
  await call(hr, "PATCH", `/api/payroll/master/${PART}`, { bankName: "Axis Bank" });
  r = await call(hr, "PATCH", `/api/payroll/master/${PART}`, { holder: "Part Time", ifsc: "UTIB0000123" });
  ok("a bank account typed in parts waits and is not yet in payroll", r.s === 200 && r.d.person.partial && !r.d.person.inPayroll && (await db.query("SELECT 1 FROM payroll_bank_accounts WHERE work_email=$1", [PART])).rowCount === 0, JSON.stringify(r.d));
  r = await call(hr, "PATCH", `/api/payroll/master/${PART}`, { account: "1234567890123" });
  ok("when the last part arrives it moves to payroll", r.s === 200 && r.d.person.inPayroll && !r.d.person.partial && (await db.query("SELECT bank_name FROM payroll_bank_accounts WHERE work_email=$1", [PART])).rows[0].bank_name === "Axis Bank", JSON.stringify(r.d));
  await db.query("DELETE FROM payroll_bank_accounts WHERE work_email=$1", [PART]); await db.query("DELETE FROM payroll_master WHERE work_email=$1", [PART]); await db.query("DELETE FROM employees WHERE work_email=$1", [PART]);

  // Test 5: an updated sheet updates, adds nobody twice, skips what is unchanged
  const rows2 = Array.from({ length: N }, (_, i) => fullRow(i + 1, i < 5 ? { bank: "Kotak Bank" } : {}));
  rows2[10] = fullRow(11, { ifsc: "HDFC00" });       // bad IFSC
  rows2.push(["PM/777", "Nobody Here", "SBI", "123456789012", "SBIN0001234", ""]);   // unknown number
  rows2.splice(20, 10);                                // ten people missing from the sheet
  const sheet2 = await sheet(rows2);
  r = await call(hr, "POST", "/api/payroll/master/import", null, sheet2);
  ok("Test 5: the preview says 5 change, 1 fails on the IFSC, 1 unknown number fails, the rest are unchanged", r.s === 200 && r.d.counts.change >= 5 && r.d.counts.failed === 2 && r.d.rows.find((x) => x.empNo === "PM/777").problems[0].includes("Onboarding"), JSON.stringify(r.d && r.d.counts));
  r = await call(hr, "POST", "/api/payroll/master/import/apply", null, sheet2);
  const after = (await db.query("SELECT count(*)::int AS n FROM employees WHERE work_email LIKE 'pm.p%'")).rows[0].n, banks = (await db.query("SELECT count(*)::int AS n FROM payroll_bank_accounts WHERE work_email LIKE 'pm.p%'")).rows[0].n;
  ok("the report lists saved, failed and skipped; no employee was added or removed and the people left out of the sheet still have their bank account", r.s === 200 && r.d.failed.length === 2 && r.d.saved.length >= 5 && r.d.skipped.length > 0 && after === N && banks === N, JSON.stringify(r.d && { s: r.d.saved.length, f: r.d.failed.length, k: r.d.skipped.length, after, banks }));
  ok("existing people were updated (bank name)", (await db.query("SELECT bank_name FROM payroll_bank_accounts WHERE work_email=$1", [mail(2)])).rows[0].bank_name === "Kotak Bank");

  // a row with no number is matched by the account holder name when it is exactly one employee's name
  await db.query("INSERT INTO employees (emp_no, name, work_email, title, dept, start_date, status, onboarded_at) VALUES ('PM/910','Zed Uniqueperson',$1,'Dev','Eng','2025-01-01','active',now()), ('PM/911','Twin Person',$2,'Dev','Eng','2025-01-01','active',now()), ('PM/912','Twin Person',$3,'Dev','Eng','2025-01-01','active',now())", ["pm.zed@wohlig.com", "pm.twin1@wohlig.com", "pm.twin2@wohlig.com"]);
  r = await call(hr, "POST", "/api/payroll/master/import/apply", null, await sheet([["", "Zed Uniqueperson", "Axis Bank", "7777788888999", "UTIB0000123", "Fort"], ["", "Twin Person", "Axis Bank", "7777788888000", "UTIB0000123", "Fort"], ["", "Somebody Else", "Axis Bank", "7777788888111", "UTIB0000123", "Fort"]]));
  ok("with no number, the account holder name finds the one employee; a shared or unknown name is refused with a clear reason", r.s === 200 && r.d.saved.length === 1 && r.d.saved[0].empNo === "PM/910" && r.d.failed.length === 2 && /Two employees/.test(r.d.failed[0].reason) && /not known/.test(r.d.failed[1].reason), JSON.stringify(r.d));
  await db.query("DELETE FROM payroll_bank_accounts WHERE work_email LIKE 'pm.zed%'"); await db.query("DELETE FROM payroll_master WHERE work_email LIKE 'pm.zed%'"); await db.query("DELETE FROM audit_log WHERE work_email LIKE 'pm.zed%' OR work_email LIKE 'pm.twin%'"); await db.query("DELETE FROM employees WHERE work_email LIKE 'pm.zed%' OR work_email LIKE 'pm.twin%'");

  // Test 6: someone new from onboarding is in the master without any step
  await db.query("INSERT INTO employees (emp_no, name, work_email, title, dept, start_date, status) VALUES ('PM/901','Nita Joiner',$1,'Designer','Design','2026-12-01','onboarding')", [NEW]);
  r = await call(hr, "GET", "/api/payroll/master?q=Nita");
  ok("Test 6: a new joiner appears in the master with their number, name, department and designation, details blank", r.d.people.length === 1 && r.d.people[0].empNo === "PM/901" && r.d.people[0].department === "Design" && r.d.people[0].designation === "Designer" && r.d.people[0].status === "Onboarding" && !r.d.people[0].account, JSON.stringify(r.d.people));
  r = await call(hr, "PATCH", `/api/payroll/master/${NEW}`, { pan: "BCDEF2345G" });
  ok("and their details can be added later, still one record", r.s === 200 && (await db.query("SELECT count(*)::int AS n FROM employees WHERE work_email=$1", [NEW])).rows[0].n === 1);

  // Search, sort and paging
  r = await call(hr, "GET", "/api/payroll/master?size=10&page=2&sort=empNo&dir=desc");
  ok("paging and sorting work (10 per page, page 2, by number descending)", r.d.people.length === 10 && r.d.page === 2 && r.d.total >= N && r.d.people[0].empNo > r.d.people[9].empNo, JSON.stringify(r.d.people.map((x) => x.empNo)));

  // Test 8: the download has the latest data, masked
  await call(hr, "PATCH", `/api/payroll/master/${mail(7)}`, { ifsc: "ICIC0004321" });
  const ex = await download(hr, "/api/payroll/master/export");
  const grid = await cells(ex.buf), row7 = grid.find((x) => x[0] === no(7));
  ok("Test 8: the download is a real .xlsx in the Bank Details Format", ex.s === 200 && ex.buf.subarray(0, 2).toString() === "PK" && HEAD.every((h) => grid[0].includes(h)));
  ok("it has the latest saved data (the new IFSC, bank, branch and holder, with the account masked)", row7 && row7[4] === "ICIC0004321" && row7[2] === "HDFC Bank" && String(row7[3]).startsWith("••••") && row7[5] === "Andheri" && row7[1] === letters(7), JSON.stringify(row7));
  ok("and no full account, Aadhaar or PAN number anywhere in the file", !grid.flat().some((c) => [acct(7), aad(7), pan(7), NEWACC].includes(String(c))));
  const wbOne = new ExcelJS.Workbook(); await wbOne.xlsx.load(ex.buf);
  ok("the download is one sheet only", wbOne.worksheets.length === 1, String(wbOne.worksheets.length));
  r = await call(hr, "POST", "/api/payroll/master/import", null, await sheet([["PM/901", "Nita Joiner", "", "", "", ""]]));
  ok("a row where only the person's own name is filled in saves nothing (skipped)", r.s === 200 && r.d.counts.change === 0 && r.d.counts.skipped === 1 && r.d.counts.failed === 0, JSON.stringify(r.d && r.d.counts));
  r = await call(hr, "POST", "/api/payroll/master/import", null, ex.buf);
  ok("uploading the download back changes nothing (masked cells mean unchanged) and fails nothing", r.s === 200 && r.d.counts.change === 0 && r.d.counts.failed === 0, JSON.stringify(r.d && r.d.counts));
  const tpl = ex, tg = grid;
  ok("the one sheet lists everyone with their number and name filled in", tpl.s === 200 && HEAD.every((h) => tg[0].includes(h)) && tg.length > N && tg.slice(1).every((x) => x[0] && x[1]));
} finally {
  try {
    const em = [...Array.from({ length: N }, (_, i) => mail(i + 1)), HR, EMP, NEW];
    await db.query("DELETE FROM payroll_bank_accounts WHERE lower(work_email) = ANY($1)", [em]); await db.query("DELETE FROM payroll_master WHERE lower(work_email) = ANY($1)", [em]);
    await db.query("DELETE FROM audit_log WHERE work_email = ANY($1)", [em]); await db.query("DELETE FROM employees WHERE work_email = ANY($1)", [em]);
  } catch {}
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
