// Onboarding (HR only): the work email, the Google account, the first login and the joiner's record.
// Mounted by index.js. The helpers at the top are shared with nothing else.
import express from "express";
import { pool } from "./db.js";
import { createGoogleUser as createLogin } from "./auth.js";
import { invalidateTree, mayActOnLogin, needAll, canAll } from "./access.js";
import { saveOnboardingSalary } from "./payroll.js";
import { payrollChanged } from "./payroll/preview-cache.js";
import { syncEmployees } from "./payroll/employee-sync.js";
import { checkManager } from "./people.js";
import { createInvite, INVITE_MINUTES } from "./invites.js";
import { linkDeviceUserByEmployeeNo } from "./device.js";
import { ensureKit } from "./digital-kit.js";
import { onboardingErrors, detailsErrors, maskAadhaar, maskPan, maskAcct } from "./validate.js";
import { createGoogleUser, generatePassword, googleMode, assignLicense } from "./google.js";
import { mailPlanOf } from "./mail-plan.js";
import { employeeNoOwner, nextEmployeeNoFrom } from "./employee-no.js";
import { mailConfigured, sendWorkAccountEmail } from "./mail.js";
import { notify } from "./notify.js";
import { registerDetailsSheet } from "./details-sheet.js";
import { saveBankAccount } from "./payroll/routes.js";

const DOMAIN = "wohlig.com";
const clean = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function nextWorkEmail(client, first, last) {
  const a = clean(first), b = clean(last);
  if (!a || !b) return "";
  const base = `${a}.${b}`;
  for (let n = 1; ; n++) {
    const email = `${base}${n > 1 ? n : ""}@${DOMAIN}`;
    const { rowCount } = await client.query("SELECT 1 FROM employees WHERE lower(work_email)=$1", [email]);
    if (!rowCount) return email;
  }
}

/** Returns the name of someone else who already uses this personal email, or null. exceptWorkEmail is the person being saved. */
async function personalEmailOwner(db, personalEmail, exceptWorkEmail) {
  const { rows } = await db.query(
    "SELECT name FROM employees WHERE lower(personal_email)=$1 AND lower(work_email)<>$2 LIMIT 1",
    [String(personalEmail).trim().toLowerCase(), String(exceptWorkEmail || "").toLowerCase()]);
  return rows[0]?.name || null;
}
const dupEmailError = (email, owner) => ({ pemail: `${email} already belongs to ${owner}. Use a different personal email.` });

const toApi = (r) => ({
  email: r.work_email, name: r.name, personalEmail: r.personal_email, phone: r.phone, address: r.address,
  dept: r.dept, title: r.title, manager: r.manager,
  start: r.start_date, status: r.status,
  ids: { dob: r.dob || "", aadhaar: r.aadhaar_masked || "", pan: r.pan_masked || "",
         acct: r.acct_masked || "", ifsc: r.ifsc || "" },
  apps: r.apps,
  googleStatus: r.google_status, googleError: r.google_error, hasLogin: !!r.has_login, workEmailManual: !!r.work_email_manual,
});

const RECORD_SQL = `SELECT e.*, EXISTS (SELECT 1 FROM users u WHERE lower(u.email)=lower(e.work_email)) AS has_login FROM employees e`;
const loadRecord = async (email) =>
  (await pool.query(`${RECORD_SQL} WHERE lower(e.work_email)=$1`, [email.toLowerCase()])).rows[0];
const draftId = (req) => req.user.email.toLowerCase(); // each HR user has their own draft
// Intern when HR chose it, or when the job title says so (for example "GenAI Interns"): an intern is paid a stipend with nothing deducted.
const kindOf = (d) => (d && (d.kind === "Intern" || /\bintern/i.test(String(d.title || ""))) ? "Intern" : "Employee");


/*
 * Two guards for updating an existing person through onboarding:
 * - a manager change goes through the same checks as the Employees page (people.js checkManager): one real person, no loop,
 *   the top of the company stays at the top;
 * - their personal email (where sign-in links go before a first sign-in) can only be changed by someone with at least their access.
 * Returns an { errors } body for a 400/403, or null when all is well.
 */
async function guardExisting(req, row, d) {
  const was = String(row.manager || "").trim().toLowerCase(), now = String(d.mgr || "").trim().toLowerCase();
  if (was !== now) {
    const c = await checkManager(row.work_email, d.mgr || "");
    if (c.error) return { status: 400, body: { errors: { mgr: c.error } } };
  }
  if (String(row.personal_email || "").trim().toLowerCase() !== String(d.pemail || "").trim().toLowerCase() && !(await mayActOnLogin(req, row.work_email))) {
    return { status: 403, body: { errors: { pemail: "This person has more access than you, so only a super admin can change their personal email." } } };
  }
  return null;
}

export function onboardingRouter(wrap) {
  const r = express.Router();
  // Onboarding takes "Run onboarding" (company-wide); employees only reach their own account and documents.
  r.use(["/api/onboarding", "/api/work-email"], needAll("onboarding.manage"));

  // People onboarded through this API, including ones whose work email exists but who are not submitted yet.
  // The page merges them into its employee list so HR can pick up where they left off.
  r.get("/api/onboarding", wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `${RECORD_SQL} WHERE e.onboarded_at IS NOT NULL OR e.google_status IS NOT NULL OR e.dob IS NOT NULL OR e.aadhaar_masked IS NOT NULL OR e.pan_masked IS NOT NULL OR e.acct_masked IS NOT NULL
        ORDER BY e.created_at`);   // the last four: details filled in from the employee details sheet for people who were never onboarded here
    res.json(rows.map(toApi));
  }));

  // The employee details sheet: download it, fill it in, upload it, and the details go into each person's profile (details-sheet.js).
  registerDetailsSheet(r, { wrap, base: "/api/onboarding/import", mode: "full", saveBankAccount });

  // Preview of the work email that would be issued, with the uniqueness check done against the database.
  r.get("/api/work-email", wrap(async (req, res) => {
    res.json({ email: await nextWorkEmail(pool, req.query.first, req.query.last) });
  }));

  r.get("/api/onboarding/draft", wrap(async (req, res) => {
    const { rows } = await pool.query("SELECT data FROM onboarding_drafts WHERE id=$1", [draftId(req)]);
    res.json(rows[0] ? rows[0].data : null);
  }));


  // Drafts hold name, contact and job details only. ID numbers are never saved.
  r.put("/api/onboarding/draft", wrap(async (req, res) => {
    const d = req.body && typeof req.body === "object" ? req.body : {};
    const keep = ["first", "last", "pemail", "phone", "address", "dept", "title", "mgr", "start", "kind"];
    const data = Object.fromEntries(keep.map((k) => [k, String(d[k] ?? "")]));
    await pool.query(
      `INSERT INTO onboarding_drafts (id,data) VALUES ($1,$2)
       ON CONFLICT (id) DO UPDATE SET data=$2, updated_at=now()`, [draftId(req), data]);
    res.json({ ok: true });
  }));

  r.delete("/api/onboarding/draft", wrap(async (req, res) => {
    await pool.query("DELETE FROM onboarding_drafts WHERE id=$1", [draftId(req)]);
    res.json({ ok: true });
  }));

  // Step 1: save the personal and job details, issue the work email and activate it in Google straight away.
  // Send existingEmail to retry a failed Google call, or to use a person who is already in the employee list.
  // The employee ID the next joiner gets by default: one more than the latest in the series.
  r.get("/api/onboarding/next-employee-no", wrap(async (_req, res) => res.json({ empNo: await nextEmployeeNoFrom(pool) })));

  r.post("/api/onboarding/work-email", wrap(async (req, res) => {
    const { d = {}, existingEmail } = req.body || {};
    // HR may type the work email instead of having Google create one (for example while the Google credentials are not set up).
    const typed = String(req.body?.typedEmail || "").trim().toLowerCase();
    const errors = detailsErrors(d);
    if (typed && !(/^[^\s@]+@wohlig\.com$/.test(typed))) errors.typedEmail = `Please enter a work email that ends in @${DOMAIN}.`;
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    const full = `${d.first} ${d.last}`.trim();
    const fields = [full, d.dept || null, d.title.trim(), d.mgr || null, d.start, d.pemail.trim(), d.phone.trim(), d.address.trim()];
    let email, status;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (existingEmail) {
        const r = await client.query("SELECT * FROM employees WHERE lower(work_email)=$1 FOR UPDATE", [String(existingEmail).toLowerCase()]);
        if (!r.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Employee not found" }); }
        email = r.rows[0].work_email;
        const owner = await personalEmailOwner(client, d.pemail, email);
        if (owner) { await client.query("ROLLBACK"); return res.status(400).json({ errors: dupEmailError(d.pemail.trim(), owner) }); }
        const stop = await guardExisting(req, r.rows[0], d);
        if (stop) { await client.query("ROLLBACK"); return res.status(stop.status).json(stop.body); }
        // Someone from the HR sheet already has a work email, so nothing is created for them in Google.
        status = r.rows[0].google_status || "existing";
        let no = String(d.empNo || "").trim() || r.rows[0].emp_no || null;
        if (!no) { await client.query("LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE"); no = await nextEmployeeNoFrom(client); }
        const taken = no && no !== r.rows[0].emp_no ? await employeeNoOwner(client, no, email) : null;
        if (taken) { await client.query("ROLLBACK"); return res.status(400).json({ errors: { empNo: `${no} already belongs to ${taken}.` } }); }
        await client.query(
          `UPDATE employees SET name=$1, dept=$2, title=$3, manager=$4, start_date=$5, personal_email=$6, phone=$7,
           address=$8, google_status=$9, emp_no=COALESCE($11, emp_no) WHERE lower(work_email)=$10`, [...fields, status, email.toLowerCase(), no]);
      } else {
        await client.query("LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE");
        email = typed || await nextWorkEmail(client, d.first, d.last);
        if (typed && (await client.query("SELECT 1 FROM employees WHERE lower(work_email)=$1", [typed])).rows[0]) { await client.query("ROLLBACK"); return res.status(400).json({ errors: { typedEmail: `${typed} already belongs to someone in the employee list.` } }); }
        if (!email) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Add a first name and surname first." }); }
        const owner = await personalEmailOwner(client, d.pemail, "");
        if (owner) { await client.query("ROLLBACK"); return res.status(400).json({ errors: dupEmailError(d.pemail.trim(), owner) }); }
        status = typed ? "existing" : "pending";   // a typed address is used as it is: nothing is created in Google
        const no = String(d.empNo || "").trim() || await nextEmployeeNoFrom(client);   // the table is locked above, so two joiners never get the same number
        const taken = no ? await employeeNoOwner(client, no) : null;
        if (taken) { await client.query("ROLLBACK"); return res.status(400).json({ errors: { empNo: `${no} already belongs to ${taken}.` } }); }
        await client.query(
          `INSERT INTO employees (name, dept, title, manager, start_date, personal_email, phone, address, work_email, status, google_status, emp_no)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'onboarding',$11,$10)`, [...fields, email, no, status]);
        await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [typed ? "Work email entered by HR" : "Work email reserved", email]);
      }
      await client.query("UPDATE employees SET employment_type=$1 WHERE lower(work_email)=$2", [kindOf(d), email.toLowerCase()]);
      if (typed && !existingEmail) await client.query("UPDATE employees SET work_email_manual=true WHERE lower(work_email)=$1", [email.toLowerCase()]);   // typed by HR: no email about it goes to the personal address
      await client.query("COMMIT");
      invalidateTree();   // a manager or new joiner may have changed the reporting tree
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    let workPassword = null, emailed = false;
    if (status === "pending" || status === "failed") {
      workPassword = generatePassword();   // different for every person
      try {
        status = (await createGoogleUser({
          email, first: d.first.trim(), last: d.last.trim(), password: workPassword, personalEmail: d.pemail.trim(),
        })).status;
        await pool.query("UPDATE employees SET google_status=$1, google_error=NULL WHERE lower(work_email)=$2", [status, email.toLowerCase()]);
        await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)",
          [status === "simulated" ? "Google account created (simulated)" : "Google account created and active", email]);
        // The mail plan follows the job title. If a licence cannot be assigned the account still works; the audit log says what to do.
        const plan = mailPlanOf(d.title);
        try {
          const lic = await assignLicense(email, plan);
          await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [lic === "assigned" ? `Mail plan ${plan}: licence assigned` : `Mail plan ${plan} (assign the licence in the Google Admin console)`, email]);
        } catch (err) {
          await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Mail plan ${plan}: licence could not be assigned (${err.message})`, email]);
        }
      } catch (err) {
        await pool.query("UPDATE employees SET google_status='failed', google_error=$1 WHERE lower(work_email)=$2", [err.message, email.toLowerCase()]);
        await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Google account failed: ${err.message}`, email]);
        return res.status(502).json({ error: `Google could not create the account: ${err.message}`, email });
      }
    }
    if (workPassword && mailConfigured()) {
      try {
        // Their Wohlig One login, and a one-time 30-minute link (invites.js) where they choose its password.
        await createLogin(pool, email, "employee");
        const link = await createInvite(email, req.user.email);
        await sendWorkAccountEmail({ to: d.pemail.trim(), name: full, workEmail: email, password: workPassword, link, minutes: INVITE_MINUTES });
        emailed = true;
      }
      catch (err) { await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Could not email the work account details: ${err.message}`, email]); }
    }
    if (workPassword) await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)",
      [emailed ? "Work account password emailed to the personal email" : "Work account password generated (not emailed)", email]);
    res.status(201).json({ ...toApi(await loadRecord(email)), googleMode, mailPlan: mailPlanOf(d.title), workAccount: workPassword ? { emailed, password: emailed ? null : workPassword } : null });
  }));

  // Last step: save the tool access and mark the person as onboarded. The work email and the login must exist by now.
  r.post("/api/onboarding", wrap(async (req, res) => {
    const { d = {}, ids = {}, apps, existingEmail } = req.body || {};
    if (!existingEmail) return res.status(400).json({ error: "Create the work email first." });
    const errors = onboardingErrors({ d, ids, apps });
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    const full = `${d.first} ${d.last}`.trim();
    const fields = [d.dept, d.title.trim(), d.mgr || null, d.start, d.pemail.trim(), d.phone.trim(), d.address.trim(),
      ids.dob || null, maskAadhaar(ids.aadhaar), maskPan(ids.pan), maskAcct(ids.acct),
      String(ids.ifsc || "").trim().toUpperCase() || null, JSON.stringify(apps)];

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(`${RECORD_SQL} WHERE lower(e.work_email)=$1 FOR UPDATE OF e`, [String(existingEmail).toLowerCase()]);
      const row = r.rows[0];
      if (!row) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Employee not found" }); }
      if (row.google_status === "pending" || row.google_status === "failed") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "The work email is not active in Google yet." });
      }
      if (!row.has_login) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Create the login first." }); }
      const owner = await personalEmailOwner(client, d.pemail, row.work_email);
      if (owner) { await client.query("ROLLBACK"); return res.status(400).json({ errors: dupEmailError(d.pemail.trim(), owner) }); }
      const stop = await guardExisting(req, { ...row, personal_email: row.personal_email ?? row.personalEmail }, d);
      if (stop) { await client.query("ROLLBACK"); return res.status(stop.status).json(stop.body); }
      await client.query(
        `UPDATE employees SET name=$1, dept=$2, title=$3, manager=$4, start_date=$5, personal_email=$6, phone=$7,
         address=$8, dob=COALESCE($9, dob), aadhaar_masked=COALESCE($10, aadhaar_masked), pan_masked=COALESCE($11, pan_masked), acct_masked=COALESCE($12, acct_masked), ifsc=COALESCE($13, ifsc), apps=$14, onboarded_at=now()
         WHERE lower(work_email)=$15`, [full, ...fields, row.work_email.toLowerCase()]);
      await client.query("UPDATE employees SET employment_type=$1 WHERE lower(work_email)=$2", [kindOf(d), row.work_email.toLowerCase()]);
      await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Onboarding completed${kindOf(d) === "Intern" ? " (intern)" : ""}`, row.work_email]);
      // Attendance: the person's name is linked to the office device straight away, so their punches count from day one.
      const idNow = (await client.query("SELECT id, name, work_email, emp_no FROM employees WHERE lower(work_email)=$1", [row.work_email.toLowerCase()])).rows[0];
      const device = idNow ? await linkDeviceUserByEmployeeNo(client, { id: idNow.id, name: idNow.name, email: idNow.work_email, empNo: idNow.emp_no }, req.user.email) : null;
      await client.query("DELETE FROM onboarding_drafts WHERE id=$1", [draftId(req)]);
      if (idNow) await ensureKit(client, idNow.id, "onboarding");   // the Digital Kit is ready when they first sign in
      await client.query("COMMIT");
      invalidateTree();   // a manager or new joiner may have changed the reporting tree
      // Payroll: a salary entered here becomes the person's first salary structure on this same employee record (payroll.js). Only someone who
      // prepares payroll may do this; the rest of onboarding is saved either way, and the answer says what happened to the salary.
      await syncEmployees({ force: true });   // payroll holds its own copy of the staff list: the new joiner must be in it before a salary is saved
      let salary = null;
      const sal = req.body.salary;
      if (sal && String(sal.monthlyGross || "").trim() !== "") {
        if (!canAll(req, "payroll.prepare")) salary = { saved: false, error: "Only someone who prepares payroll can enter a salary. HR can add it in Payroll." };
        else {
          try { salary = await saveOnboardingSalary(row.work_email, { annualCtc: sal.annualCtc, monthlyGross: sal.monthlyGross, startDate: d.start }, req.user.email); }
          catch (err) { salary = { saved: false, error: "The salary could not be saved. HR can add it in Payroll." }; console.error("Onboarding salary:", err.message); }
        }
      }
      payrollChanged();   // the new person is on the Payroll list from this moment, with or without a salary
      // The employee record is the payroll record (one employees table), so they are already on the payroll list from their joining month. Tell the people who prepare payroll
      // what is still needed (the salary structure unless one was just entered, and the bank account), so they are paid correctly from the first month.
      const joins = new Date(`${d.start}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      const needs = salary && salary.saved ? "their bank account" : "their salary structure and bank account";
      await notify("perm:payroll.prepare", { title: `New joiner ${full}: set up their payroll profile`, body: `Joins ${joins}. Add ${needs} so they are paid correctly from the first month.`, link: `/app/employees/${encodeURIComponent(row.work_email)}` });
      res.status(201).json({ ...toApi(await loadRecord(row.work_email)), deviceLink: device, salary });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }));
  return r;
}
