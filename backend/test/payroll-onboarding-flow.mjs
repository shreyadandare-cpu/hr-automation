/*
 * Onboarding -> payroll, against a LOCAL server and a LOCAL database (never the shared one): a joiner finished in onboarding is on the payroll list, shows an
 * incomplete payroll profile until a salary structure and a bank account exist, HR is told, and salary set ahead of the joining month is seen.
 *
 *   DATABASE_URL=postgresql://postgres:x@localhost:55434/postgres BASE=http://localhost:3190 node test/payroll-onboarding-flow.mjs
 *
 * The server needs PAYROLL_ENCRYPTION_KEY (for the bank account). Not part of `npm test`. It removes its test rows afterwards.
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3190";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB) || !/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: a local database and a local server only."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB }), sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const HR = "po.hr@wohlig.com", EMP = "po.emp@wohlig.com", NEW1 = "pnow.joiner@wohlig.com", NEW2 = "pnext.joiner@wohlig.com";
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
const month = (add = 0) => { const d = new Date(Date.now() + 330 * 60000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + add); return d.toISOString().slice(0, 7); };
const day = (add = 0) => `${month(add)}-05`;
const ids = { dob: "2000-01-01", aadhaar: "234567890123", pan: "ABCDE1234F", acct: "123456789012", ifsc: "HDFC0001234" };
const finish = (hr, email, first, last, start) => call(hr, "POST", "/api/onboarding", { existingEmail: email, ids, apps: [],
  d: { first, last, pemail: `${first.toLowerCase()}@example.com`, phone: "9876543210", address: "12 Test Road, Mumbai", dept: "Engineering", title: "Software Developer Engineer", mgr: "", start, kind: "Employee" } });

try {
  for (const e of [NEW1, NEW2, HR, EMP]) await db.query("DELETE FROM employees WHERE work_email=$1", [e]);
  const hr = await login(HR, true), emp = await login(EMP, false);
  await db.query("INSERT INTO employees (name, work_email, status, start_date, onboarded_at) VALUES ('Po Emp',$1,'active','2022-01-01',now())", [EMP]);

  // two joiners, created the way onboarding creates them (work email, login), then finished
  for (const [email, first, start] of [[NEW1, "Pnow", day(0)], [NEW2, "Pnext", day(1)]]) {
    const r = await call(hr, "POST", "/api/onboarding/work-email", { d: { first, last: "Joiner", pemail: `${first.toLowerCase()}@example.com`, phone: "9876543210", address: "12 Test Road, Mumbai", dept: "Engineering", title: "Software Developer Engineer", mgr: "", start, kind: "Employee" } });
    if (r.s !== 201) throw new Error(`work email for ${first}: ${r.s} ${JSON.stringify(r.d)}`);
    await db.query("UPDATE employees SET work_email=$2 WHERE lower(work_email)=$1", [r.d.email, email]);
    await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x','employee') ON CONFLICT DO NOTHING", [email]);
    await db.query("UPDATE employees SET google_status='active' WHERE lower(work_email)=$1", [email]);
  }
  await db.query("DELETE FROM notifications WHERE title LIKE 'New joiner Pn%'");
  let r = await finish(hr, NEW1, "Pnow", "Joiner", day(0));
  ok("onboarding is completed for a joiner who starts this month", r.s === 201, JSON.stringify(r.d));
  r = await finish(hr, NEW2, "Pnext", "Joiner", day(1));
  ok("and for one who starts next month", r.s === 201, JSON.stringify(r.d));

  const notes = (await db.query("SELECT title, link, recipient FROM notifications WHERE title LIKE 'New joiner Pn%' ORDER BY id")).rows;
  const mine = notes.filter((n) => /Pnow Joiner/.test(n.title));
  ok("the people who prepare payroll are told about each joiner, with a link to their profile", mine.length >= 1 && notes.length >= 2 * mine.length && mine.every((n) => n.link === `/app/employees/${encodeURIComponent(NEW1)}`) && /set up their payroll profile/.test(mine[0].title), JSON.stringify(notes));

  // the payroll list
  let list = (await call(hr, "GET", `/api/payroll/employees?period=${month(0)}`)).d.employees;
  let a = list.find((x) => x.email === NEW1), b = list.find((x) => x.email === NEW2);
  ok("the joiner who starts this month is on the payroll list", !!a && a.joinsLater === false && a.employmentType === "Employee", JSON.stringify(a));
  ok("the one who starts next month is on it too, marked as joining later", !!b && b.joinsLater === true);
  ok("with nothing set up, both show an incomplete payroll profile naming what is missing", a.profile.complete === false && a.profile.missing.join() === "Salary structure,Bank account" && b.profile.complete === false, JSON.stringify(a.profile));
  ok("a PAN given in onboarding means no PAN warning", a.profile.advisory.length === 0);
  ok("the employee record is shared: one row per person, no copy", (await db.query("SELECT count(*)::int n FROM employees WHERE work_email IN ($1,$2)", [NEW1, NEW2])).rows[0].n === 2);
  ok("salary is not invented: no structure, no gross", a.salary === null && b.salary === null);

  // the one-person profile
  let p = (await call(hr, "GET", `/api/payroll/profile/${encodeURIComponent(NEW1)}`)).d;
  ok("the profile says when they are paid from and that it is incomplete", p.paidFrom === month(0) && p.joinsLater === false && p.profile.complete === false && p.salary === null && p.bank === null, JSON.stringify(p));
  ok("the profile shows only a masked PAN and no bank or tax figures", /^[A-Z•*X]+/.test(p.pan || "") && !JSON.stringify(p).includes("ABCDE1234F") && !JSON.stringify(p).includes("123456789012"), JSON.stringify(p.pan));
  ok("an employee cannot open anyone's payroll profile (403)", (await call(emp, "GET", `/api/payroll/profile/${encodeURIComponent(NEW1)}`)).s === 403);
  ok("an employee cannot see the payroll list (403)", (await call(emp, "GET", "/api/payroll/employees")).s === 403);
  ok("an unknown person is a 404", (await call(hr, "GET", "/api/payroll/profile/nobody%40wohlig.com")).s === 404);

  // HR sets salary ahead of the joining month for the one who joins later; it is theirs from that month
  const structure = (from) => ({ effectiveFrom: from, earnings: [{ name: "Basic", amount: 30000 }, { name: "HRA", amount: 15000 }, { name: "Special allowance", amount: 5000 }], pfEmployee: 1800, professionalTax: 200, otherDeductions: [], tdsMode: "auto", reason: "Offer letter", annualCtc: 600000, pfApplicable: true, ptApplicable: true, tdsApplicable: true });
  r = await call(hr, "PUT", `/api/payroll/structures/${encodeURIComponent(NEW2)}`, structure(month(1)));
  ok("HR sets the salary structure for the one who joins next month, from that month", r.s === 200, JSON.stringify(r.d));
  list = (await call(hr, "GET", `/api/payroll/employees?period=${month(0)}`)).d.employees; b = list.find((x) => x.email === NEW2);
  ok("it shows against them now (not 'Not set'), with the month it applies from", !!b.salary && b.salary.effectiveFrom === month(1) && b.salary.monthlyGross === 50000, JSON.stringify(b.salary));
  ok("the profile still needs a bank account, and no longer a salary", b.profile.missing.join() === "Bank account");
  r = await call(hr, "PUT", `/api/payroll/bank/${encodeURIComponent(NEW2)}`, { holder: "Pnext Joiner", bankName: "HDFC Bank", ifsc: "HDFC0001234", account: "123456789012", accountConfirm: "123456789012" });
  ok("HR adds the bank account", r.s === 200, JSON.stringify(r.d));
  list = (await call(hr, "GET", `/api/payroll/employees?period=${month(0)}`)).d.employees; b = list.find((x) => x.email === NEW2);
  ok("the payroll profile is now ready", b.profile.complete === true && b.profile.missing.length === 0, JSON.stringify(b.profile));
  p = (await call(hr, "GET", `/api/payroll/profile/${encodeURIComponent(NEW2)}`)).d;
  ok("the profile shows the salary, its start month, the bank last four and no full number", p.profile.complete && p.salary.monthlyGross === 50000 && p.salary.annualCtc === 600000 && p.bank.last4 === "9012" && !JSON.stringify(p).includes("123456789012"), JSON.stringify(p));

  // a revision: a record of what changed, who and when; the old row stays
  r = await call(hr, "PUT", `/api/payroll/structures/${encodeURIComponent(NEW2)}`, { ...structure(month(3)), earnings: [{ name: "Basic", amount: 36000 }, { name: "HRA", amount: 18000 }, { name: "Special allowance", amount: 6000 }], reason: "Appraisal" });
  ok("a revision from a later month is saved", r.s === 200);
  const hist = (await call(hr, "GET", `/api/payroll/structures/${encodeURIComponent(NEW2)}`)).d.structures;
  ok("both salary rows are kept, newest first, with the reason and who saved them", hist.length === 2 && hist[0].effectiveFrom === month(3) && hist[0].reason === "Appraisal" && hist[0].updatedBy === HR && hist[1].effectiveFrom === month(1), JSON.stringify(hist.map((h) => [h.effectiveFrom, h.reason, h.updatedBy])));
  const aud = (await call(hr, "GET", `/api/payroll/audit?email=${encodeURIComponent(NEW2)}`)).d;
  const rows = Array.isArray(aud) ? aud : aud.rows || aud.entries || [];
  ok("the payroll audit has the revision with the before and after figures", JSON.stringify(rows).includes("Salary revised") && JSON.stringify(rows).includes("before") && JSON.stringify(rows).includes("after"), JSON.stringify(aud).slice(0, 300));
  p = (await call(hr, "GET", `/api/payroll/profile/${encodeURIComponent(NEW2)}`)).d;
  ok("the profile counts the revisions", p.salary.revisions === 2);

  // someone who leaves drops off the payroll after their last day
  await db.query("UPDATE employees SET status='offboarded', last_day=$2 WHERE work_email=$1", [NEW1, `${month(-1)}-10`]);
  list = (await call(hr, "GET", `/api/payroll/employees?period=${month(0)}`)).d.employees;
  ok("someone who left last month is no longer on this month's payroll", !list.find((x) => x.email === NEW1));
} catch (e) { fail++; console.log("ERROR  " + e.stack); }
finally {
  await db.query("DELETE FROM salary_structures WHERE lower(work_email) IN ($1,$2)", [NEW1, NEW2]);
  await db.query("DELETE FROM payroll_bank_accounts WHERE lower(work_email) IN ($1,$2)", [NEW1, NEW2]);
  await db.query("DELETE FROM notifications WHERE title LIKE 'New joiner Pn%'");
  await db.query("DELETE FROM onboarding_drafts WHERE id=$1", [HR]);
  await db.query("DELETE FROM digital_kits WHERE employee_id IN (SELECT id FROM employees WHERE work_email IN ($1,$2))", [NEW1, NEW2]).catch(() => {});
  await db.query("DELETE FROM audit_log WHERE work_email IN ($1,$2,$3,$4)", [NEW1, NEW2, HR, EMP]);
  await db.query("DELETE FROM payroll_audit WHERE work_email IN ($1,$2)", [NEW1, NEW2]).catch(() => {});
  await db.query("DELETE FROM sessions WHERE lower(email) IN ($1,$2)", [HR, EMP]);
  await db.query("DELETE FROM employees WHERE work_email IN ($1,$2,$3,$4)", [NEW1, NEW2, HR, EMP]).catch((e) => console.log("cleanup:", e.message));
  await db.query("DELETE FROM users WHERE email IN ($1,$2,$3,$4)", [NEW1, NEW2, HR, EMP]);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
