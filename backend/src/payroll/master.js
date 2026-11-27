import express from "express";
import ExcelJS from "exceljs";
import { payPool } from "../db.js";
import { updatePerson } from "../sealed-rows.js";
const pool = payPool;   // everything here is on the payroll database (the same one as the rest of the app unless PAYROLL_DATABASE_URL gives payroll its own, which then holds its own employee copy)
import { invalidateTree } from "../access.js";
import { V, maskAadhaar, maskAcct, maskPan } from "../validate.js";
import { readTable, cellValue } from "../holiday-import.js";
import { digits, text } from "../onboarding-import.js";
import { seal, open, encryptionReady } from "./access.js";
import { payrollChanged } from "./preview-cache.js";
import { structuresFor } from "./store.js";

/*
 * The payroll master: one table of every employee's bank and identity details, to view, edit in place (each change saves by itself), download and upload in bulk.
 * The employee list is the master of who exists (the Onboarding module creates people; they show here at once, nothing to copy). What this adds:
 *   payroll_bank_accounts  the salary bank account (account number encrypted), used by the bank file and payslips
 *   payroll_master         the full Aadhaar and PAN (encrypted), the bank branch, and a bank account typed in part
 *   employees (masked)     the masked Aadhaar, PAN and account number and the IFSC the profile shows (kept in step on every save)
 * Screens and files only ever carry the masked numbers. A full number leaves the server only through POST /master/:email/reveal (audited), and the audit trail
 * records which fields changed, never their values. Every route needs `payroll.bank`. `saveBankAccount` is passed in (payroll/routes.js would otherwise import this file in a circle).
 */
const MAX_ROWS = 1000, SHEET_LIMIT = 4 * 1024 * 1024, SORTS = { name: "e.name", empNo: "e.emp_no", department: "e.dept", status: "e.status" };
const KEYS = ["bankName", "holder", "account", "ifsc", "branch", "aadhaar", "pan"];
const LABEL = { bankName: "Bank name", holder: "Account holder name", account: "Account number", ifsc: "IFSC code", branch: "Branch name", aadhaar: "Aadhaar number", pan: "PAN number" };
/** The sheet is HR's "Bank Details Format": No. (the employee number), account holder name, bank name, account number, IFSC code and branch name. */
const SHEET = [
  { h: "No.", k: "no", w: 14, m: /^(no\.?|sr\.?\s*no\.?|emp(loyee)?\s*(no|number|id)\.?)$/i },
  { h: "Account Holder Name", k: "holder", w: 28, m: /holder/i, edit: true },
  { h: "Bank Name", k: "bankName", w: 22, m: /^bank(\s*name)?$/i, edit: true },
  { h: "Account Number", k: "account", w: 24, m: /account\s*(no|number|num)/i, edit: true, text: true },
  { h: "IFSC Code", k: "ifsc", w: 16, m: /ifsc/i, edit: true, text: true },
  { h: "Branch Name", k: "branch", w: 24, m: /branch/i, edit: true },
];
const SHEET_KEYS = ["holder", "bankName", "account", "ifsc", "branch"];

const statusOf = (e) => (e.status === "offboarded" ? "Inactive" : e.status === "onboarding" && !e.onboarded_at ? "Onboarding" : "Active");

/** Checks and cleans the values to save. Empty means "leave as it is". Returns { v, errors }. */
export function cleanPatch(body, problems = {}) {
  const v = {}, get = (k) => String(body[k] == null ? "" : body[k]).trim();
  const h = get("holder").replace(/\s+/g, " "); if (h) { if (!/^[A-Za-z .'&-]{2,80}$/.test(h)) problems.holder = "Enter the name as on the bank account (letters only)."; else v.holder = h; }
  const b = get("bankName"); if (b) { if (b.length < 2 || b.length > 80) problems.bankName = "Enter the bank's name."; else v.bankName = b; }
  const a = get("account"); if (a) { if (!V.acct(a)) problems.account = "Bank account number must be 9 to 18 digits."; else v.account = digits(a); }
  const i = get("ifsc").toUpperCase().replace(/\s/g, ""); if (i) { if (!V.ifsc(i)) problems.ifsc = "IFSC must look like HDFC0001234."; else v.ifsc = i; }
  const br = get("branch").replace(/\s+/g, " "); if (br) { if (!/^[A-Za-z0-9 .,&/()'-]{2,80}$/.test(br)) problems.branch = "Enter the branch name (letters and digits)."; else v.branch = br; }
  const aa = get("aadhaar"); if (aa) { if (!V.aadhaar(aa)) problems.aadhaar = "Aadhaar must be 12 digits."; else v.aadhaar = digits(aa); }
  const pn = get("pan").toUpperCase().replace(/\s/g, ""); if (pn) { if (!V.pan(pn)) problems.pan = "PAN must look like ABCDE1234F."; else v.pan = pn; }
  return { v, errors: problems };
}

export function registerMaster(R, { wrap, bankOnly, saveBankAccount, audit }) {
  R.use("/master", bankOnly);
  const lc = (s) => String(s || "").toLowerCase();
  const EMP_COLS = "e.work_email, e.name, e.emp_no, e.dept, e.title, e.status, e.onboarded_at, e.pan_masked, e.aadhaar_masked, e.acct_masked, e.ifsc, e.person_sealed";

  /** One person as the screens show them: masked numbers only. `e` is an employees row; `m` the payroll_master row; `b` the bank account row; `gross` the monthly salary. */
  const view = (e, m, b, gross) => ({
    email: e.work_email, empNo: e.emp_no || "", name: e.name, department: e.dept || "", designation: e.title || "", status: statusOf(e),
    bankName: b ? b.bank_name : (m && m.draft_bank) || "", holder: b ? b.holder_name : (m && m.draft_holder) || "",
    account: b ? `•••• ${b.acct_last4}` : m && m.draft_acct_last4 ? `•••• ${m.draft_acct_last4}` : e.acct_masked || "",
    ifsc: (b && b.ifsc) || (m && m.draft_ifsc) || e.ifsc || "", branch: (m && m.branch) || "", aadhaar: e.aadhaar_masked || "", pan: e.pan_masked || "",
    salary: gross == null ? null : gross, inPayroll: !!b, partial: !b && !!(m && (m.draft_holder || m.draft_bank || m.draft_ifsc || m.draft_acct_enc)),
    updatedAt: [b && b.updated_at, m && m.updated_at].filter(Boolean).sort().pop() || null,
  });
  const period = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
  /** Views for employee rows: the payroll side is read in three queries for the whole page, not one per person. */
  async function viewsOf(emps) {
    if (!emps.length) return [];
    const emails = emps.map((e) => lc(e.work_email));
    const [ms, bs, ss] = await Promise.all([
      payPool.query("SELECT * FROM payroll_master WHERE lower(work_email) = ANY($1)", [emails]),
      payPool.query("SELECT lower(work_email) AS k, holder_name, bank_name, ifsc, acct_last4, updated_at FROM payroll_bank_accounts WHERE lower(work_email) = ANY($1)", [emails]),
      structuresFor(payPool, period()),
    ]);
    const M = new Map(ms.rows.map((x) => [lc(x.work_email), x])), B = new Map(bs.rows.map((x) => [x.k, x])), S = new Map(ss.map((x) => [lc(x.work_email), x]));
    return emps.map((e) => { const s = S.get(lc(e.work_email)); return view(e, M.get(lc(e.work_email)), B.get(lc(e.work_email)), s ? (s.earnings || []).reduce((n, x) => n + Number(x.amount || 0), 0) : null); });
  }

  /**
   * Saves the cleaned values `v` for one person inside the caller's payroll transaction. Bank fields are merged with what is saved: once holder, bank, IFSC and account
   * number are all known the account goes to payroll_bank_accounts (the one the bank file reads); until then the part that is typed waits as a draft. Returns {} or a failure.
   */
  async function saveMaster(client, email, v, actor) {
    seal("x");   // 503 when PAYROLL_ENCRYPTION_KEY is missing
    const { rows: [e] } = await pool.query("SELECT ifsc, person_sealed FROM employees WHERE lower(work_email)=$1", [email]);
    if (!e) return { rollback: true, status: 404, error: "Employee not found." };
    await client.query("INSERT INTO payroll_master (work_email, updated_by) VALUES ($1,$2) ON CONFLICT DO NOTHING", [email, actor]);
    const { rows: [m] } = await client.query("SELECT * FROM payroll_master WHERE lower(work_email)=$1 FOR UPDATE", [email]);
    const { rows: [b] } = await client.query("SELECT holder_name, bank_name, ifsc, acct_enc FROM payroll_bank_accounts WHERE lower(work_email)=$1", [email]);
    const set = [], args = [email], put = (col, val) => { args.push(val); set.push(`${col}=$${args.length}`); }, changed = [];
    if (v.branch && v.branch !== m.branch) { put("branch", v.branch); changed.push("branch"); }
    if (v.aadhaar) { put("aadhaar_enc", seal(v.aadhaar)); changed.push("aadhaar"); }
    if (v.pan) { put("pan_enc", seal(v.pan)); changed.push("pan"); }
    if (v.holder || v.bankName || v.ifsc || v.account) {
      const cur = { holder: v.holder || m.draft_holder || (b && b.holder_name) || "", bankName: v.bankName || m.draft_bank || (b && b.bank_name) || "",
        ifsc: v.ifsc || m.draft_ifsc || (b && b.ifsc) || e.ifsc || "", account: v.account || "" };
      if (!cur.account) { const enc = m.draft_acct_enc || (b && b.acct_enc); if (enc && cur.holder && cur.bankName && cur.ifsc) cur.account = open(enc).toString(); }
      if (cur.holder && cur.bankName && cur.ifsc && cur.account) {
        const same = b && b.holder_name === cur.holder && b.bank_name === cur.bankName && b.ifsc === cur.ifsc && open(b.acct_enc).toString() === cur.account;
        if (!same) {
          const out = await saveBankAccount(client, email, cur, actor);
          if (out.error) return out;
          changed.push(...["holder", "bankName", "ifsc", "account"].filter((k) => v[k]));
        }
        for (const c of ["draft_holder", "draft_bank", "draft_ifsc", "draft_acct_enc", "draft_acct_last4"]) if (m[c] !== null) put(c, null);
      } else {
        put("draft_holder", cur.holder || null); put("draft_bank", cur.bankName || null); put("draft_ifsc", cur.ifsc || null);
        put("draft_acct_enc", cur.account ? seal(cur.account) : m.draft_acct_enc); put("draft_acct_last4", cur.account ? cur.account.slice(-4) : m.draft_acct_last4);
        changed.push(...["holder", "bankName", "ifsc", "account"].filter((k) => v[k]));
      }
    }
    if (set.length || changed.length) { put("updated_by", actor); await client.query(`UPDATE payroll_master SET ${set.join(", ")}, updated_at=now() WHERE lower(work_email)=$1`, args); }
    if (changed.length) await audit(client, actor, "Payroll master updated", { work_email: email, detail: { fields: changed.map((k) => LABEL[k]) } });
    return { changed };
  }

  /** Keeps the profile in step: masked Aadhaar, PAN and account number, and the IFSC. */
  async function syncProfile(email, v, actor, changed) {
    const person = {};   // stored encrypted (secret-box.js)
    if (v.aadhaar) person.aadhaar_masked = maskAadhaar(v.aadhaar);
    if (v.pan) person.pan_masked = maskPan(v.pan);
    if (v.account) person.acct_masked = maskAcct(v.account);
    if (v.ifsc) person.ifsc = v.ifsc;
    if (Object.keys(person).length) await updatePerson(pool, email, person);
    if (changed.length) await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Payroll master updated by ${actor}: ${changed.map((k) => LABEL[k].toLowerCase()).join(", ")}`, email]);
    invalidateTree(); payrollChanged();
  }
  async function saveOne(email, v, actor) {
    const client = await payPool.connect();
    try {
      await client.query("BEGIN");
      const out = await saveMaster(client, email, v, actor);
      if (out.error) { await client.query("ROLLBACK"); return out; }
      await client.query("COMMIT");
      await syncProfile(email, v, actor, out.changed);
      return out;
    } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
  }
  const one = async (email) => { const { rows: [e] } = await pool.query(`SELECT ${EMP_COLS} FROM employees e WHERE lower(e.work_email)=$1`, [email]); return e ? (await viewsOf([e]))[0] : null; };
  const reply = (res, out) => res.status(out.status || 400).json({ error: out.error });

  // ---- the table: paged, sorted, searched ----
  R.get("/master", wrap(async (req, res) => {
    const q = String(req.query.q || "").trim().slice(0, 80), st = ["active", "inactive", "all"].includes(req.query.status) ? req.query.status : "active";
    const sort = SORTS[req.query.sort] || "e.name", dir = req.query.dir === "desc" ? "DESC" : "ASC";
    const size = Math.min(100, Math.max(5, parseInt(req.query.size, 10) || 25)), page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const where = [], args = [];
    if (st === "active") where.push("e.status <> 'offboarded'"); else if (st === "inactive") where.push("e.status = 'offboarded'");
    if (q) { args.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`); where.push(`(e.name ILIKE $${args.length} OR e.emp_no ILIKE $${args.length} OR e.work_email ILIKE $${args.length})`); }
    const W = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [{ rows: [{ n }] }, { rows }] = await Promise.all([
      pool.query(`SELECT count(*)::int AS n FROM employees e ${W}`, args),
      pool.query(`SELECT ${EMP_COLS} FROM employees e ${W} ORDER BY ${sort} ${dir} NULLS LAST, e.name LIMIT ${size} OFFSET ${(page - 1) * size}`, args),
    ]);
    const [people, last] = await Promise.all([viewsOf(rows),
      payPool.query("SELECT max(t) AS t FROM (SELECT max(updated_at) AS t FROM payroll_master UNION ALL SELECT max(updated_at) FROM payroll_bank_accounts) x")]);
    res.set("Cache-Control", "no-store");
    res.json({ people, total: n, page, size, lastUpdated: last.rows[0].t, encryptionReady: encryptionReady() });
  }));

  // ---- files ----
  /** The one sheet, in HR's format: everyone's number and name (the name sits in Account Holder Name until a holder is saved) and what is saved so far, the account number masked. One worksheet only. */
  const sheetFile = async (people) => {
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Bank details");
    ws.addRow(SHEET.map((c) => c.h));
    SHEET.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = c.w; if (c.text || c.k === "no") col.numFmt = "@"; });
    ws.getRow(1).font = { bold: true }; ws.getRow(1).alignment = { vertical: "middle", wrapText: true }; ws.getRow(1).height = 30;
    ws.getRow(1).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } }; c.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } }; });
    for (const p of people) ws.addRow(SHEET.map((c) => (c.k === "no" ? p.empNo : c.k === "holder" ? p.holder || p.name : p[c.k] || "")));
    ws.views = [{ state: "frozen", ySplit: 1 }];
    return Buffer.from(await wb.xlsx.writeBuffer());
  };
  const allPeople = async () => { const { rows } = await pool.query(`SELECT ${EMP_COLS} FROM employees e WHERE e.status <> 'offboarded' ORDER BY e.name LIMIT ${MAX_ROWS}`); return viewsOf(rows); };
  R.get("/master/export", wrap(async (_req, res) => {
    res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="bank-details.xlsx"', "Cache-Control": "no-store" }).send(await sheetFile(await allPeople()));
  }));

  // ---- bulk upload: preview, then save ----
  async function planSheet(buf) {
    const rows = await readTable(buf, SHEET.length + 2);
    const head = rows.findIndex((r, i) => i < 12 && (r || []).some((c) => SHEET[0].m.test(String(cellValue(c)).trim())) && (r || []).some((c) => /ifsc|bank/i.test(String(cellValue(c)))));
    if (head < 0) throw new Error("The first row must have the headings from the template (No., Account Holder Name, Bank Name, Account Number, IFSC Code, Branch Name). Please use the template.");
    const heads = (rows[head] || []).map((c) => String(cellValue(c)).trim()), col = {};
    for (const c of SHEET) { const i = heads.findIndex((h, n) => c.m.test(h) && !Object.values(col).includes(n)); if (i >= 0) col[c.k] = i; }
    const lines = [];
    for (let i = head + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      if (!r.some((c) => String(cellValue(c)).trim() !== "")) continue;
      if (lines.length >= MAX_ROWS) throw new Error(`Only ${MAX_ROWS} rows can be uploaded at a time.`);
      const problems = {}, body = {};
      for (const c of SHEET.filter((x) => x.edit)) {
        if (col[c.k] === undefined) continue;
        const t = text(r[col[c.k]], c.k, problems);
        if (t && !t.includes("•")) body[c.k] = t;   // a masked cell from a download means "unchanged"
      }
      const no = col.no === undefined ? "" : text(r[col.no], "no", problems).toUpperCase();
      const { v } = cleanPatch(body, problems);
      lines.push({ row: i + 1, no, holder: col.holder === undefined ? "" : String(cellValue(r[col.holder]) || "").trim().replace(/\s+/g, " "), v, problems });
    }
    if (!lines.length) throw new Error("No people were found under the headings.");
    // Who each row is: the employee number in "No."; when that is blank, the account holder name if it is exactly one employee's name.
    const nos = lines.map((l) => l.no).filter(Boolean), names = lines.filter((l) => !l.no && l.holder).map((l) => l.holder.toLowerCase());
    const { rows: emps } = nos.length || names.length ? await pool.query(`SELECT ${EMP_COLS} FROM employees e WHERE upper(e.emp_no) = ANY($1) OR lower(e.name) = ANY($2)`, [nos, names]) : { rows: [] };
    const views = await viewsOf(emps), byNo = new Map(), byName = new Map();
    emps.forEach((e, i) => { if (e.emp_no) byNo.set(String(e.emp_no).toUpperCase(), views[i]); const k = e.name.toLowerCase(); byName.set(k, byName.has(k) ? null : views[i]); });
    const seen = new Map();
    return { lines: lines.map((l) => {
      const cur = l.no ? byNo.get(l.no) : l.holder ? byName.get(l.holder.toLowerCase()) : null, problems = { ...l.problems };
      if (!cur) problems.no = l.no ? `No employee has the number ${l.no}. New employees are added through Onboarding, then they appear here.`
        : l.holder && byName.get(l.holder.toLowerCase()) === null ? "Two employees have this name. Please put the employee number in the No. column."
        : "This row has no employee number, and the account holder name is not an employee's name, so it is not known who it is for.";
      else if (seen.has(cur.email)) problems.no = `${cur.name} is listed twice (row ${seen.get(cur.email)} and row ${l.row}). Keep one row for each person.`;
      if (cur && !seen.has(cur.email)) seen.set(cur.email, l.row);
      if (cur && l.v.holder && l.v.holder.toLowerCase() === cur.name.toLowerCase() && !cur.holder && !["account", "bankName", "ifsc", "branch"].some((k) => l.v[k])) delete l.v.holder;   // the sheet fills the name in; on its own it is not a bank detail
      const changes = cur ? SHEET_KEYS.filter((k) => l.v[k]).map((k) => {
        const shown = k === "account" ? maskAcct(l.v.account) : l.v[k], saved = cur[k] || "";
        return { key: k, label: LABEL[k], value: shown, state: !saved ? "new" : String(saved).toLowerCase() === String(shown).toLowerCase() ? "same" : "replaces" };
      }) : [];
      const status = Object.keys(problems).length ? "failed" : changes.some((c) => c.state !== "same") ? "change" : "skipped";
      return { row: l.row, empNo: cur ? cur.empNo : l.no, name: cur ? cur.name : "", email: cur ? cur.email : "", v: l.v, problems: Object.values(problems), changes, status,
        why: status === "skipped" ? (changes.length ? "Everything in this row is already saved." : "No details to save in this row.") : "" };
    }), ignored: [] };
  }
  const SHEET_ERR = (res, err) => res.status(422).json({ error: err.message });
  R.post("/master/import", express.raw({ type: () => true, limit: SHEET_LIMIT }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Choose the Excel or CSV file." });
    let plan; try { plan = await planSheet(req.body); } catch (err) { return SHEET_ERR(res, err); }
    const rows = plan.lines.map(({ v, ...x }) => x), n = (s) => rows.filter((x) => x.status === s).length;
    res.json({ rows, ignored: plan.ignored, counts: { change: n("change"), skipped: n("skipped"), failed: n("failed") }, encryptionReady: encryptionReady() });
  }));
  R.post("/master/import/apply", express.raw({ type: () => true, limit: SHEET_LIMIT }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Choose the Excel or CSV file." });
    let plan; try { plan = await planSheet(req.body); } catch (err) { return SHEET_ERR(res, err); }
    const actor = req.user.email, saved = [], failed = [], skipped = [];
    for (const l of plan.lines) {
      if (l.status === "failed") { failed.push({ row: l.row, empNo: l.empNo, name: l.name, reason: l.problems.join(" ") }); continue; }
      if (l.status === "skipped") { skipped.push({ row: l.row, empNo: l.empNo, name: l.name, reason: l.why }); continue; }
      try {
        const out = await saveOne(lc(l.email), l.v, actor);
        if (out.error) failed.push({ row: l.row, empNo: l.empNo, name: l.name, reason: out.error }); else saved.push({ row: l.row, empNo: l.empNo, name: l.name });
      } catch (err) { failed.push({ row: l.row, empNo: l.empNo, name: l.name, reason: err.status === 503 ? "The server's encryption key is not set, so nothing could be saved." : "This row could not be saved." }); }
    }
    res.json({ saved, failed, skipped });
  }));

  // ---- one person: the form and the table cells ----
  R.get("/master/:email", wrap(async (req, res) => {
    const p = await one(lc(req.params.email));
    if (!p) return res.status(404).json({ error: "Employee not found." });
    res.set("Cache-Control", "no-store").json({ person: p, encryptionReady: encryptionReady() });
  }));
  R.patch("/master/:email", wrap(async (req, res) => {
    const email = lc(req.params.email), { v, errors } = cleanPatch(req.body || {});
    if (Object.keys(errors).length) return res.status(422).json({ error: "Please check the highlighted fields.", errors });
    if (!Object.keys(v).length) return res.status(400).json({ error: "There is nothing to save." });
    const out = await saveOne(email, v, req.user.email);
    if (out.error) return reply(res, out);
    res.set("Cache-Control", "no-store").json({ person: await one(email), changed: out.changed.map((k) => LABEL[k]) });
  }));
  // The one place a full number leaves the server: HR asks for it, it is written to the audit trail, and the answer is never cached.
  R.post("/master/:email/reveal", wrap(async (req, res) => {
    const email = lc(req.params.email), field = req.body && req.body.field;
    if (!["account", "aadhaar", "pan"].includes(field)) return res.status(400).json({ error: "Choose account, aadhaar or pan." });
    if (!encryptionReady()) return res.status(503).json({ error: "The server's encryption key is not set." });
    const [{ rows: [m] }, { rows: [b] }] = await Promise.all([
      payPool.query("SELECT aadhaar_enc, pan_enc, draft_acct_enc FROM payroll_master WHERE lower(work_email)=$1", [email]),
      payPool.query("SELECT acct_enc FROM payroll_bank_accounts WHERE lower(work_email)=$1", [email])]);
    const enc = field === "account" ? (b && b.acct_enc) || (m && m.draft_acct_enc) : m && m[`${field}_enc`];
    if (!enc) return res.status(404).json({ error: "The full number is not saved. Only the masked number is on file, so please enter it again." });
    const client = await payPool.connect();
    try { await audit(client, req.user.email, "Full number viewed", { work_email: email, detail: { field: LABEL[field] } }); } finally { client.release(); }
    res.set("Cache-Control", "no-store").json({ value: open(enc).toString() });
  }));
}
