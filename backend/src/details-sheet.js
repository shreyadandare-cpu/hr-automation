import express from "express";
import { pool, payPool } from "./db.js";
import { canAll, invalidateTree } from "./access.js";
import { encryptionReady } from "./payroll/access.js";
import { payrollChanged } from "./payroll/preview-cache.js";
import { maskAadhaar, maskAcct, maskPan } from "./validate.js";
import { readTable } from "./holiday-import.js";
import { COLUMNS, FIELD_LABEL, describe, parseProfiles, templateXlsx } from "./onboarding-import.js";

/*
 * The employee details sheet routes (Onboarding, `onboarding.manage`): download the template, upload a filled sheet (preview, saves nothing), and save it. Date of birth, Aadhaar, PAN,
 * bank account, IFSC, PF/UAN number, phone and address go on the employee's profile (masked) and the bank account goes to Payroll, encrypted. The payroll side has its own
 * table, with editing in place, in payroll/master.js. The same file is read again to save, so no number travels
 * back to the page. `saveBankAccount` is passed in by the caller (it lives in payroll/routes.js, which would otherwise import this file in a circle).
 */
const MODES = {
  full: { allowed: null, file: "employee-details", people: "(dob IS NULL OR aadhaar_masked IS NULL OR pan_masked IS NULL OR acct_masked IS NULL OR ifsc IS NULL)" },
};
const BANK_KEYS = ["holder", "bankName", "account", "ifsc"];

export function registerDetailsSheet(r, { wrap, base, mode = "full", saveBankAccount }) {
  const M = MODES[mode], allowed = M.allowed ? new Set(M.allowed) : null;
  const SHEET_LIMIT = 2 * 1024 * 1024;
  const DETAIL_COLUMNS = "id, work_email, name, emp_no, status, dob, aadhaar_masked, pan_masked, acct_masked, ifsc, pf_number, phone, address";
  const bankComplete = (f) => !!(f.holder && f.bankName && f.ifsc && f.account);
  // Payroll needs the encryption key; the full sheet also needs the person to hold the bank permission (the bank sheet's guard already makes sure of it).
  const bankAllowed = (req) => encryptionReady() && (mode === "bank" || canAll(req, "payroll.bank"));

  // The template always lists everyone who is still here (so a new joiner appears as soon as their profile exists), people still lacking details first. Blank cells change nothing.
  r.get(`${base}/template`, wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT work_email, name, emp_no FROM employees WHERE status <> 'offboarded' ORDER BY ${M.people} DESC, name LIMIT 500`);
    res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${M.file}-sheet.xlsx"` });
    res.send(await templateXlsx(rows.map((p) => ({ email: p.work_email, empNo: p.emp_no, name: p.name })), M.allowed));
  }));

  /** Reads an uploaded sheet and works out, for each row, who it is, what is wrong with it and what it would add. Nothing is saved. Throws an Error with a plain message. */
  const planSheet = async (buf) => planRows(await readTable(buf, 13));
  async function planRows(table) {
    const { people, errors } = parseProfiles(table);
    const emails = people.map((p) => p.email).filter(Boolean), nos = people.map((p) => p.empNo).filter(Boolean);
    const { rows } = people.length ? await pool.query(`SELECT ${DETAIL_COLUMNS} FROM employees WHERE lower(work_email) = ANY($1) OR upper(emp_no) = ANY($2)`, [emails, nos]) : { rows: [] };
    const byEmail = new Map(rows.map((x) => [x.work_email.toLowerCase(), x])), byNo = new Map(rows.filter((x) => x.emp_no).map((x) => [String(x.emp_no).toUpperCase(), x]));
    const list = people.map((p) => {
      const emp = (p.email && byEmail.get(p.email)) || (p.empNo && byNo.get(p.empNo)) || null, problems = { ...p.problems };
      if (!emp) problems.workEmail ||= `No one in the employee list has ${p.email ? "this work email" : "this Employee ID"}.`;
      else if (emp.status === "offboarded") problems.workEmail ||= `${emp.name} has left, so their profile cannot be changed.`;
      else if (p.email && p.empNo && byNo.get(p.empNo) && byNo.get(p.empNo).id !== emp.id) problems.empNo = "This Employee ID belongs to someone other than the work email.";
      // The bank sheet saves only what payroll needs; anything else in the row is left out and said so.
      const fields = allowed ? Object.fromEntries(Object.entries(p.fields).filter(([k]) => allowed.has(k))) : p.fields;
      const ignored = allowed ? Object.keys(p.fields).filter((k) => !allowed.has(k)).map((k) => FIELD_LABEL[k]) : [];
      for (const k of Object.keys(problems)) if (allowed && FIELD_LABEL[k] && !allowed.has(k) && k !== "workEmail") delete problems[k];   // a bad value in a column this sheet ignores is not a problem here
      const has = Object.keys(fields).length > 0;
      return { row: p.row, emp, fields, ignored, problems, status: Object.keys(problems).length ? "error" : has ? "ok" : "nothing", adds: emp ? describe(fields, emp) : [] };
    });
    return { list, errors };
  }

  /** Saves rows already checked: the profile details in one transaction, then each complete bank account to Payroll (encrypted). A payroll failure does not undo the profile details. */
  async function saveReady(req, ready) {
    const actor = req.user.email, client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const x of ready) {
        const f = x.fields, set = [], args = [x.emp.id];
        const put = (col, val) => { args.push(val); set.push(`${col}=$${args.length}`); };
        if (f.dob) put("dob", f.dob);
        if (f.aadhaar) put("aadhaar_masked", maskAadhaar(f.aadhaar));
        if (f.pan) put("pan_masked", maskPan(f.pan));
        if (f.account) put("acct_masked", maskAcct(f.account));
        if (f.ifsc) put("ifsc", f.ifsc);
        if (f.pfNumber) put("pf_number", f.pfNumber);
        if (f.phone) put("phone", f.phone);
        if (f.address) put("address", f.address);
        if (set.length) await client.query(`UPDATE employees SET ${set.join(", ")} WHERE id=$1`, args);
        const what = x.adds.map((a) => (a.key === "account" ? `bank account (${a.value})` : a.label.toLowerCase())).join(", ");
        await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`${mode === "bank" ? "Bank and payroll details" : "Profile details"} added from the uploaded sheet by ${actor}: ${what}`, x.emp.work_email]);
      }
      await client.query("COMMIT");
    } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
    const notes = []; let bankAdded = 0;
    for (const x of ready.filter((y) => y.fields.account)) {
      const f = x.fields, who = x.emp.name;
      if (!bankComplete(f)) { notes.push({ row: x.row, name: who, message: "The profile has the masked bank account. To add it to payroll the sheet also needs the account holder name, the bank name and the IFSC code." }); continue; }
      if (!bankAllowed(req)) { notes.push({ row: x.row, name: who, message: "The profile has the masked bank account. Adding it to payroll needs someone with the bank permission (or the server's encryption key is not set)." }); continue; }
      const c = await payPool.connect();
      try {
        await c.query("BEGIN");
        const out = await saveBankAccount(c, x.emp.work_email.toLowerCase(), { holder: f.holder, bankName: f.bankName, ifsc: f.ifsc, account: f.account }, actor);
        if (out.error) { await c.query("ROLLBACK"); notes.push({ row: x.row, name: who, message: `Not added to payroll: ${out.error}` }); } else { await c.query("COMMIT"); bankAdded++; }
      } catch (err) { await c.query("ROLLBACK").catch(() => {}); notes.push({ row: x.row, name: who, message: "Not added to payroll: the bank account could not be saved." }); } finally { c.release(); }
    }
    invalidateTree();
    payrollChanged();
    return { notes, bankAdded };
  }


  // Preview: what each row would add, shown masked, and the rows that cannot be saved.
  r.post(base, express.raw({ type: () => true, limit: SHEET_LIMIT }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Choose the Excel or CSV file with the details." });
    let plan;
    try { plan = await planSheet(req.body); } catch (err) { return res.status(422).json({ error: err.message }); }
    const rows = plan.list.map((x) => ({
      row: x.row, email: x.emp ? x.emp.work_email : null, name: x.emp ? x.emp.name : null, empNo: x.emp ? x.emp.emp_no : null, status: x.status,
      problems: Object.values(x.problems), adds: x.adds, ignored: x.ignored,
      bank: x.fields.account ? (bankComplete(x.fields) ? (bankAllowed(req) ? "payroll" : "profile") : "incomplete") : null,
    }));
    res.json({ mode, rows, errors: plan.errors, bankPayroll: bankAllowed(req),
      counts: { ready: rows.filter((x) => x.status === "ok").length, problems: rows.filter((x) => x.status === "error").length + plan.errors.length, nothing: rows.filter((x) => x.status === "nothing").length } });
  }));

  // Saves it: the same file is read again and checked again here. Rows with a problem are left out.
  r.post(`${base}/apply`, express.raw({ type: () => true, limit: SHEET_LIMIT }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Choose the Excel or CSV file with the details." });
    let plan;
    try { plan = await planSheet(req.body); } catch (err) { return res.status(422).json({ error: err.message }); }
    const ready = plan.list.filter((x) => x.status === "ok");
    if (!ready.length) return res.status(400).json({ error: "There is nothing to save. Every row has a problem or no details." });
    const { notes, bankAdded } = await saveReady(req, ready);
    res.json({ saved: ready.length, skipped: plan.list.filter((x) => x.status === "error").map((x) => ({ row: x.row, problems: Object.values(x.problems) })).concat(plan.errors.map((e) => ({ row: e.row, problems: [e.message] }))), nothing: plan.list.filter((x) => x.status === "nothing").length, bankAdded, notes });
  }));
}
