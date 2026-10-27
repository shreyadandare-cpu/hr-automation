import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { pool, initDb } from "./db.js";
import { documentsRouter } from "./documents.js";
import { bootstrapAuth, loadSession, requireAuth, requireHr } from "./auth.js";
import { sessionRouter, accountRouter, usersRouter } from "./users.js";
import { profileRouter } from "./profile.js";
import { googleRouter } from "./google-signin.js";
import { inviteRouter, expireInvites } from "./invites.js";
import { leaveRouter } from "./leave.js";
import { attendanceRouter } from "./attendance.js";
import { deviceRouter } from "./device.js";
import { startPortalAttendanceSync } from "./portal-attendance.js";
import { payslipsRouter } from "./payslips.js";
import { claudeMode, grantClaude, removeClaude, recordAccess } from "./anthropic.js";
import { offboardingRouter, runDue } from "./offboarding.js";
import { onboardingErrors, detailsErrors, maskAadhaar, maskPan, maskAcct } from "./validate.js";
import { createGoogleUser, generatePassword, googleMode } from "./google.js";
import { mailConfigured, sendWorkAccountEmail } from "./mail.js";
import { reimbursementsRouter, runReimbursementReminders } from "./reimbursements.js";
import { budgetsRouter, runBudgetReminders } from "./budgets.js";
import { payrollRouter } from "./payroll.js";
import { notificationsRouter, emailMode } from "./notify.js";

const DOMAIN = "wohlig.com";
const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, "../../frontend");

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
  googleStatus: r.google_status, googleError: r.google_error, hasLogin: !!r.has_login,
});

const RECORD_SQL = `SELECT e.*, EXISTS (SELECT 1 FROM users u WHERE lower(u.email)=lower(e.work_email)) AS has_login FROM employees e`;
const loadRecord = async (email) =>
  (await pool.query(`${RECORD_SQL} WHERE lower(e.work_email)=$1`, [email.toLowerCase()])).rows[0];

const app = express();
app.use(loadSession);
app.use("/api/documents", requireAuth, documentsRouter); // raw file bodies, so it goes before the JSON parser
app.use(express.json({ limit: "100kb" }));
app.use("/api", sessionRouter); // login and logout are the only public API routes
app.use(deviceRouter()); // the office device posts punches with its own key (no session); the linking screens check for HR themselves
app.use("/api", accountRouter);
app.use("/api/users", usersRouter);
app.use("/api/profile", profileRouter);
// Onboarding is HR work; employees only reach their own account and documents.
app.use(["/api/onboarding", "/api/work-email"], requireHr);
const draftId = (req) => req.user.email.toLowerCase(); // each HR user has their own draft
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

// People onboarded through this API, including ones whose work email exists but who are not submitted yet.
// The page merges them into its employee list so HR can pick up where they left off.
app.get("/api/onboarding", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `${RECORD_SQL} WHERE e.onboarded_at IS NOT NULL OR e.google_status IS NOT NULL ORDER BY e.created_at`);
  res.json(rows.map(toApi));
}));

// Everyone signed in can see who is at the company. Only non-personal fields are sent, so this is safe for employees.
app.get("/api/directory", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT work_email, name, dept, title, manager, start_date, status, apps FROM employees
     WHERE onboarded_at IS NOT NULL OR google_status IS NOT NULL ORDER BY created_at`);
  res.json(rows.map((r) => ({ email: r.work_email, name: r.name, dept: r.dept, title: r.title, manager: r.manager,
    start: r.start_date, status: r.status, apps: r.apps })));
}));

// The company roster, for everyone signed in. Only non-personal fields are sent, so this is safe for employees too.
app.get("/api/roster", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT e.id, e.emp_no, e.name, e.work_email, e.title, e.sub_title, e.work_location, e.manager, e.start_date, e.last_day, e.status,
       (SELECT COALESCE(json_agg(json_build_object('project', p.name, 'lead', a.project_lead, 'location', a.location,
                                                   'status', a.status, 'start', a.start_date, 'end', a.end_date)
                                 ORDER BY (a.status = 'Active') DESC, p.name), '[]'::json)
        FROM employee_project_allocations a JOIN projects p ON p.id = a.project_id WHERE a.employee_id = e.id) AS projects,
       (SELECT extract(epoch FROM ph.updated_at)::bigint FROM profile_photos ph WHERE lower(ph.email) = lower(e.work_email)) AS photo_v
     FROM employees e ORDER BY e.id`);
  res.json(rows.map((r) => ({ id: r.id, no: r.emp_no, name: r.name, email: r.work_email, title: r.title, subTitle: r.sub_title,
    location: r.work_location, manager: r.manager, start: r.start_date, lastDay: r.last_day, status: r.status, projects: r.projects, photoV: r.photo_v })));
}));

// Who reports to whom, for everyone. Only the manager's name is sent, so this is safe for employees too.
app.get("/api/managers", wrap(async (_req, res) => {
  const { rows } = await pool.query("SELECT work_email, manager FROM employees WHERE manager IS NOT NULL AND manager <> ''");
  res.json(rows.map((r) => ({ email: r.work_email, manager: r.manager })));
}));

// HR changes someone's reporting manager (or clears it with an empty name).
/** Checks and saves one reporting-manager change (an empty manager clears it). Returns { ok: true } or { status, error }. */
async function applyManager(email, manager, actor) {
  const emp = (await pool.query("SELECT name, title FROM employees WHERE lower(work_email)=$1", [email])).rows[0];
  if (!emp) return { status: 404, error: "Employee not found." };
  // Directors and the Vice President are at the top of the company, so nobody is above them.
  if (manager && /\b(director|vice president)\b/i.test(emp.title || "")) {
    return { status: 400, error: `${emp.name} is at the top of the company and has no reporting manager.` };
  }
  if (manager) {
    const boss = (await pool.query("SELECT name, status FROM employees WHERE lower(name)=lower($1) LIMIT 1", [manager])).rows[0];
    if (!boss) return { status: 400, error: `${manager} is not in the employee list.` };
    if (boss.status === "offboarded") return { status: 400, error: `${boss.name} has left, so cannot be a manager.` };
    // Walk up from the new manager: reaching this person again would make a loop.
    let cur = boss.name;
    for (let i = 0; cur && i < 50; i++) {
      if (cur.toLowerCase() === emp.name.toLowerCase()) {
        return { status: 400, error: cur === boss.name && boss.name.toLowerCase() === emp.name.toLowerCase()
          ? "Nobody can be their own reporting manager."
          : `${boss.name} already reports up to ${emp.name}, so that would make a loop.` };
      }
      cur = (await pool.query("SELECT manager FROM employees WHERE lower(name)=lower($1) LIMIT 1", [cur])).rows[0]?.manager || "";
    }
  }
  await pool.query("UPDATE employees SET manager=$1 WHERE lower(work_email)=$2", [manager || null, email]);
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)",
    [manager ? `Reporting manager set to ${manager} (by ${actor})` : `Reporting manager cleared (by ${actor})`, email]);
  return { ok: true };
}

// HR changes anyone's reporting manager (or clears it with an empty name).
app.put("/api/employees/manager", requireHr, wrap(async (req, res) => {
  const email = String(req.body?.email || "").toLowerCase();
  const manager = String(req.body?.manager || "").trim();
  const r = await applyManager(email, manager, req.user.email);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json({ email, manager });
}));

// A manager adds someone to their OWN team. Allowed for anyone who already has people reporting to them (and for HR). The person
// must have no manager yet: taking someone out of another manager's team is HR's call. The same checks apply (no loops, no top of the company).
app.post("/api/team/members", requireAuth, wrap(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const me = (await pool.query("SELECT name, status FROM employees WHERE lower(work_email)=$1", [req.user.email.toLowerCase()])).rows[0];
  if (!me || me.status === "offboarded") return res.status(403).json({ error: "Your employee record was not found." });
  const isHr = req.user.role === "hr";
  const hasTeam = (await pool.query("SELECT 1 FROM employees WHERE lower(manager)=lower($1) AND status <> 'offboarded' LIMIT 1", [me.name])).rowCount > 0;
  if (!isHr && !hasTeam) return res.status(403).json({ error: "Only managers and HR can add team members." });
  const emp = (await pool.query("SELECT name, manager, status FROM employees WHERE lower(work_email)=$1", [email])).rows[0];
  if (!emp) return res.status(404).json({ error: "Employee not found." });
  if (emp.status === "offboarded") return res.status(400).json({ error: `${emp.name} has left, so cannot join a team.` });
  if (!isHr && emp.manager) return res.status(403).json({ error: `${emp.name} already reports to ${emp.manager}. Ask HR to move them.` });
  const r = await applyManager(email, me.name, req.user.email);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json({ email, manager: me.name });
}));

// Preview of the work email that would be issued, with the uniqueness check done against the database.
app.get("/api/work-email", wrap(async (req, res) => {
  res.json({ email: await nextWorkEmail(pool, req.query.first, req.query.last) });
}));

app.get("/api/onboarding/draft", wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM onboarding_drafts WHERE id=$1", [draftId(req)]);
  res.json(rows[0] ? rows[0].data : null);
}));

// Drafts hold name, contact and job details only. ID numbers are never saved.
app.put("/api/onboarding/draft", wrap(async (req, res) => {
  const d = req.body && typeof req.body === "object" ? req.body : {};
  const keep = ["first", "last", "pemail", "phone", "address", "dept", "title", "mgr", "start"];
  const data = Object.fromEntries(keep.map((k) => [k, String(d[k] ?? "")]));
  await pool.query(
    `INSERT INTO onboarding_drafts (id,data) VALUES ($1,$2)
     ON CONFLICT (id) DO UPDATE SET data=$2, updated_at=now()`, [draftId(req), data]);
  res.json({ ok: true });
}));

app.delete("/api/onboarding/draft", wrap(async (req, res) => {
  await pool.query("DELETE FROM onboarding_drafts WHERE id=$1", [draftId(req)]);
  res.json({ ok: true });
}));

// Step 1: save the personal and job details, issue the work email and activate it in Google straight away.
// Send existingEmail to retry a failed Google call, or to use a person who is already in the employee list.
app.post("/api/onboarding/work-email", wrap(async (req, res) => {
  const { d = {}, existingEmail } = req.body || {};
  const errors = detailsErrors(d);
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
      // Someone from the HR sheet already has a work email, so nothing is created for them in Google.
      status = r.rows[0].google_status || "existing";
      await client.query(
        `UPDATE employees SET name=$1, dept=$2, title=$3, manager=$4, start_date=$5, personal_email=$6, phone=$7,
         address=$8, google_status=$9 WHERE lower(work_email)=$10`, [...fields, status, email.toLowerCase()]);
    } else {
      await client.query("LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE");
      email = await nextWorkEmail(client, d.first, d.last);
      if (!email) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Add a first name and surname first." }); }
      const owner = await personalEmailOwner(client, d.pemail, "");
      if (owner) { await client.query("ROLLBACK"); return res.status(400).json({ errors: dupEmailError(d.pemail.trim(), owner) }); }
      status = "pending";
      await client.query(
        `INSERT INTO employees (name, dept, title, manager, start_date, personal_email, phone, address, work_email, status, google_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'onboarding','pending')`, [...fields, email]);
      await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", ["Work email reserved", email]);
    }
    await client.query("COMMIT");
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
    } catch (err) {
      await pool.query("UPDATE employees SET google_status='failed', google_error=$1 WHERE lower(work_email)=$2", [err.message, email.toLowerCase()]);
      await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Google account failed: ${err.message}`, email]);
      return res.status(502).json({ error: `Google could not create the account: ${err.message}`, email });
    }
  }
  if (workPassword && mailConfigured()) {
    try { await sendWorkAccountEmail({ to: d.pemail.trim(), name: full, workEmail: email, password: workPassword }); emailed = true; }
    catch (err) { await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Could not email the work account details: ${err.message}`, email]); }
  }
  if (workPassword) await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)",
    [emailed ? "Work account password emailed to the personal email" : "Work account password generated (not emailed)", email]);
  res.status(201).json({ ...toApi(await loadRecord(email)), googleMode, workAccount: workPassword ? { emailed, password: emailed ? null : workPassword } : null });
}));

// Last step: save the tool access and mark the person as onboarded. The work email and the login must exist by now.
app.post("/api/onboarding", wrap(async (req, res) => {
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
    await client.query(
      `UPDATE employees SET name=$1, dept=$2, title=$3, manager=$4, start_date=$5, personal_email=$6, phone=$7,
       address=$8, dob=$9, aadhaar_masked=$10, pan_masked=$11, acct_masked=$12, ifsc=$13, apps=$14, onboarded_at=now()
       WHERE lower(work_email)=$15`, [full, ...fields, row.work_email.toLowerCase()]);
    await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", ["Onboarding completed", row.work_email]);
    await client.query("DELETE FROM onboarding_drafts WHERE id=$1", [draftId(req)]);
    await client.query("COMMIT");
    res.status(201).json(toApi(await loadRecord(row.work_email)));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

app.use(leaveRouter(wrap));
app.use(attendanceRouter(wrap));
app.use(payslipsRouter(wrap));

// The audit log: every recorded action, newest first. HR only.
app.get("/api/audit", requireHr, wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const { rows } = await pool.query(
    `SELECT a.id, a.ts, a.action, a.work_email, e.name FROM audit_log a LEFT JOIN employees e ON lower(e.work_email)=lower(a.work_email) ORDER BY a.ts DESC, a.id DESC LIMIT $1`, [limit]);
  res.json(rows.map((r) => ({ id: r.id, ts: r.ts, action: r.action, email: r.work_email, name: r.name || null })));
}));

// Tool access HR gives from the Employees page. Claude is real when ANTHROPIC_ADMIN_KEY is set.
app.get("/api/tool-access", requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT work_email, tool, status, detail FROM tool_access");
  const hr = req.user.role === "hr";   // everyone sees who has access; only HR sees the tool's own message
  res.json({ claudeMode: claudeMode(), rows: rows.map((r) => ({ email: r.work_email, tool: r.tool, status: r.status, detail: hr ? r.detail : null })) });
}));
app.post("/api/tool-access/claude", requireHr, wrap(async (req, res) => {
  const email = String((req.body && req.body.email) || "").toLowerCase();
  const action = req.body && req.body.action;
  if (!["grant", "remove"].includes(action)) return res.status(400).json({ error: "Action must be grant or remove." });
  const emp = (await pool.query("SELECT name, status FROM employees WHERE lower(work_email)=$1", [email])).rows[0];
  if (!emp) return res.status(404).json({ error: "Employee not found." });
  try {
    if (action === "grant") {
      if (emp.status === "offboarded") return res.status(400).json({ error: `${emp.name} has left, so Claude access cannot be given.` });
      const r = await grantClaude(email);
      await recordAccess(email, "claude", r.status, r.detail);
      await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Claude: ${r.detail} (by ${req.user.email})`, email]);
      return res.json({ ...r, mode: claudeMode() });
    }
    const detail = await removeClaude(email);
    await recordAccess(email, "claude", "revoked", detail);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Claude: ${detail} (by ${req.user.email})`, email]);
    res.json({ status: "revoked", detail, mode: claudeMode() });
  } catch (err) {
    await recordAccess(email, "claude", "failed", err.message);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Claude: ${action} failed. ${err.message}`, email]);
    res.status(502).json({ error: `Claude could not do that: ${err.message}` });
  }
}));
app.use("/api/reimbursements", requireAuth, reimbursementsRouter);   // own claims for everyone; review actions are HR-only inside
app.use("/api/budget-requests", requireAuth, budgetsRouter);   // own requests for everyone; decisions are HR-only inside
app.use("/api/payroll", requireHr, payrollRouter);
app.use("/api/notifications", requireAuth, notificationsRouter);
app.use(offboardingRouter(wrap));

// The page itself, so one command serves everything on the same origin.
app.use("/auth", googleRouter);       // "Continue with Google" (public: it is how people sign in)
app.use("/invite", inviteRouter);     // the link in the invite email
for (const f of ["wohlig-logo.png", "wohlig-logo-dark.png"]) app.get("/" + f, (_req, res) => res.sendFile(path.join(frontendDir, "public", f)));
app.get("/favicon.ico", (_req, res) => res.status(204).end());
// The whole interface is React (frontend/src), built into frontend/dist with `npm run build:ui`.
const distDir = path.join(frontendDir, "dist");
const hasDist = () => fs.existsSync(path.join(distDir, "index.html"));
const notBuilt = (res) => res.status(503).type("text").send("The interface has not been built yet. Run `npm run build:ui` in the backend folder, then reload.");
app.use("/app/assets", express.static(path.join(distDir, "assets"), { immutable: true, maxAge: "1y" }));
app.get("/app/*", (req, res) => (!req.user ? res.redirect("/login") : hasDist() ? res.sendFile(path.join(distDir, "index.html")) : notBuilt(res)));
app.get("/login", (req, res) => (req.user ? res.redirect("/app/dashboard") : hasDist() ? res.sendFile(path.join(distDir, "login.html")) : notBuilt(res)));
app.get("/", (req, res) => res.redirect(req.user ? "/app/dashboard" : "/login"));
// Leave rules shared by the page and the server (no personal data in it).
app.get("/leave-rules.js", (_req, res) => res.type("js").sendFile(path.join(frontendDir, "leave-rules.cjs")));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

await initDb();
await bootstrapAuth();
// BACKGROUND_JOBS=off: serve pages only. For a local copy pointed at the shared database, so the deployed server alone
// runs the scheduled work (a local copy would simulate offboarding steps and skip emails, using them up for real).
if (process.env.BACKGROUND_JOBS === "off") console.log("Background jobs are off (BACKGROUND_JOBS=off)");
else {
  // Scheduled offboardings run at 6 pm India time on the last working day; check every minute.
  const checkDue = () => runDue().catch((err) => console.error("Scheduled offboarding check failed:", err));
  checkDue();
  setInterval(checkDue, 60_000);
  // Invites nobody accepted within 30 minutes are cancelled.
  const sweepInvites = () => expireInvites().catch((err) => console.error("Invite cleanup failed:", err));
  sweepInvites();
  setInterval(sweepInvites, 60_000);

  // Reimbursements waiting for review too long remind HR (automation 7); checked hourly.
  const checkReminders = () => Promise.all([runReimbursementReminders(), runBudgetReminders()]).catch((err) => console.error("Reimbursement reminder check failed:", err));
  checkReminders();
  setInterval(checkReminders, 60 * 60_000);
  startPortalAttendanceSync();   // copies the office device punches the Employee Portal received (only when PORTAL_ATTENDANCE_SYNC=true)
}
console.log(`Email: ${emailMode() === "smtp" ? "sending through SMTP" : "SMTP not configured, emails are logged and skipped"}`);
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`HR Access Hub on http://localhost:${port}`));
