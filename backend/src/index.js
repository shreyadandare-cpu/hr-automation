import "dotenv/config";
import express from "express";
import { pool, payPool, PAY_SCHEMA, initDb } from "./db.js";
import { digitalKitRouter, initDigitalKits, removeDuplicateStarters, seedDigitalKit, seedOfficialFiles, repairOfficialFiles, seedDesignationTexts, seedOfficialTexts, updateOfficialLabels } from "./digital-kit.js";
import { documentsRouter } from "./documents.js";
import { bootstrapAuth, loadSession, requireAuth } from "./auth.js";
import { bootstrapAccess } from "./access.js";
import { accessRouter } from "./access-routes.js";
import { timing } from "./timing.js";
import { toolsRouter } from "./tools.js";
import { sessionRouter, accountRouter, usersRouter } from "./users.js";
import { profileRouter } from "./profile.js";
import { idCardRouter } from "./id-card.js";
import { leaveRouter } from "./leave.js";
import { postsRouter } from "./posts.js";
import { engageRouter } from "./engage.js";
import { hrToolsRouter } from "./hr-tools.js";
import { financeRouter } from "./finance-reports.js";
import { workforceRouter } from "./workforce.js";
import { celebrationsRouter } from "./celebrations.js";
import { festivalLookRouter, festivalsRouter } from "./festivals.js";
import { leaveDigestRouter } from "./leave-digest.js";
import { attendanceRouter } from "./attendance.js";
import { assetsRouter } from "./assets.js";
import { deviceRouter } from "./device.js";
import { gmailIntelRouter, projectReportRouter } from "./gmail-intel-routes.js";
import { payslipsRouter } from "./payslips.js";
import { claudeRequestsRouter } from "./claude-requests.js";
import { offboardingRouter } from "./offboarding.js";
import { clearanceRouter } from "./clearance.js";
import { reimbursementsRouter } from "./reimbursements.js";
import { budgetsRouter } from "./budgets.js";
import { payrollRouter } from "./payroll.js";
import { payslipAutoRouter } from "./payslip-auto.js";
import { payrollWorkflowRouter, initPayroll, warmPayrollPreview } from "./payroll/routes.js";
import { requirePayrollAccess, hrOnly } from "./payroll/access.js";
import { notificationsRouter, emailMode } from "./notify.js";
import { securityHeaders, sameOriginWrites } from "./security.js";
import { onboardingRouter } from "./onboarding-routes.js";
import { peopleRouter } from "./people.js";
import { projectsRouter } from "./projects.js";
import { toolAccessRouter } from "./tool-access.js";
import { pagesRouter } from "./pages.js";
import { startBackgroundJobs } from "./jobs.js";
import { PRODUCT } from "./brand.js";

// This file only wires the server together: middleware, every router in order, start-up and the background jobs.
// The routes live in their own files (see ARCHITECTURE.md, section 6). Order matters: accountRouter makes every later /api
// route require sign-in, and the JSON parser comes after the two routers that read raw uploads.
const app = express();
// Behind nginx (Docker) or Cloud Run, req.ip is the caller's address, not the proxy's, so per-address limits work.
// TRUST_PROXY sets how many proxies to trust (default 1: the one in front of this server). Use 0 when nothing is in front.
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1));
app.disable("x-powered-by");
app.use(timing);   // Server-Timing on every response, and a log line for slow /api requests (timing.js)
app.use(securityHeaders);
app.use(sameOriginWrites);   // a form on another website cannot change anything here
app.use(loadSession);
app.use("/api/documents", requireAuth, documentsRouter); // raw file bodies, so it goes before the JSON parser
app.use("/api/digital-kit", requireAuth, digitalKitRouter); // employees: only their own kit; HR: the /admin part (it reads raw uploads itself, so it also goes before the JSON parser)
app.use(express.json({ limit: "100kb" }));
app.use("/api", sessionRouter); // login and logout are public
app.use("/api", festivalLookRouter);   // public: which festival is near, for the sign-in page's festival look
app.use(deviceRouter()); // the office device posts punches with its own key (no session); the linking screens check for HR themselves
app.use(gmailIntelRouter());   // Gmail Intelligence Engine: each HR route checks for HR itself; Google's Pub/Sub push has no session and proves itself with a token, so this sits before the login-guarded routers (off until GMAIL_INTEL_ENABLED=true)
app.use("/api", accountRouter);
app.use("/api/users", usersRouter);
app.use("/api/profile", profileRouter);
app.use(projectReportRouter());   // weekly project reports built from the collected emails: HR sees all projects, others only their own
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});
app.use(onboardingRouter(wrap));   // HR: new joiners
app.use(peopleRouter(wrap));       // directory, roster, reporting lines, employee IDs
app.use(projectsRouter(wrap));     // projects and allocations
app.use(leaveRouter(wrap));
app.use(postsRouter(wrap));
app.use(engageRouter(wrap));
app.use(hrToolsRouter(wrap));   // probation, helpdesk, exit interviews, hiring, performance reviews   // polls, praise, articles, app links, advance and attendance requests
app.use(workforceRouter(wrap));   // timesheets, surveys, training, notice periods, approval stand-ins
app.use(accessRouter(wrap));
app.use(toolsRouter(wrap));   // every paid tool (AI and others): seats and monthly cost (Manage > Tools)   // super admins: who may do what, for the company or a team (Company > Access)
app.use(financeRouter(wrap));   // statutory dues, payroll journal, cost, gratuity, annual tax statements (read only)
app.use(leaveDigestRouter(wrap));   // HR: preview or test the daily leave digest email
app.use(attendanceRouter(wrap));
app.use(idCardRouter(wrap));   // staff ID cards as CR80 PDFs: own for everyone, anyone's for people.view
app.use(assetsRouter(wrap));   // IT admins only
app.use(payslipsRouter(wrap));
app.use(toolAccessRouter(wrap));   // the audit log and Claude access
app.use("/api/claude-requests", claudeRequestsRouter);   // HR and IT admins: who is waiting to be invited to Claude
app.use("/api/reimbursements", requireAuth, reimbursementsRouter);   // own claims for everyone; review actions are HR-only inside
app.use("/api/budget-requests", requireAuth, budgetsRouter);   // own requests for everyone; decisions are HR-only inside
// Payroll: payroll.prepare holders prepare it and payroll.approve holders approve it; everything after the workflow router needs payroll.prepare.
app.use("/api/payroll", requirePayrollAccess, payrollWorkflowRouter, hrOnly, payslipAutoRouter, payrollRouter);
app.use("/api/notifications", requireAuth, notificationsRouter);
app.use("/api/celebrations", requireAuth, celebrationsRouter);   // HR: birthday and welcome posters, emailed to everyone
app.use("/api/festivals", requireAuth, festivalsRouter);   // everyone: festivals and their dates for the Festival Wishes page
app.use(clearanceRouter(wrap));   // offboarding financial clearance and employee advances (HR only)
app.use(offboardingRouter(wrap));
app.use(pagesRouter());            // the pages, logos and the links in emails

app.use((err, _req, res, _next) => {
  console.error(err);
  // An error the app raised on purpose (err.status, e.g. payroll encryption not set up) keeps its status and message.
  res.status(err.status && err.status < 600 ? err.status : 500).json({ error: err.status ? err.message : "Server error" });
});

await initDb();
if (payPool !== pool) { await initDb(payPool, PAY_SCHEMA); console.log("Payroll and payslips use their own database (PAYROLL_DATABASE_URL)"); }
await initPayroll(payPool);   // payroll workflow tables and starting tax rules (payroll/schema.sql)
warmPayrollPreview();   // the month's payroll preview, worked out in the background so the first visit is quick
await bootstrapAuth();
await bootstrapAccess();   // the first super admins, and grants that match each login's access from before (src/access.js)
// Digital Kit: starter text once, and a kit for every employee who does not have one yet (safe to repeat; nobody is duplicated or changed).
try {
  await seedDigitalKit();
  await seedOfficialFiles();
  await seedOfficialTexts();
  await seedDesignationTexts();
  await updateOfficialLabels();
  const fixed = await repairOfficialFiles();
  if (fixed) console.log(`Digital Kit: ${fixed} official file${fixed === 1 ? "" : "s"} now read from the app's own folder`);
  const dup = await removeDuplicateStarters();
  if (dup) console.log(`Digital Kit: removed ${dup} duplicate starter item${dup === 1 ? "" : "s"}`);
  const made = await initDigitalKits();
  if (made) console.log(`Digital Kit: created for ${made} employee${made === 1 ? "" : "s"}`);
} catch (err) { console.error("Digital Kit setup failed:", err.message); }
// BACKGROUND_JOBS=off: serve pages only. For a local copy pointed at the shared database, so the deployed server alone
// runs the scheduled work (a local copy would simulate offboarding steps and skip emails, using them up for real).
if (process.env.BACKGROUND_JOBS === "off") console.log("Background jobs are off (BACKGROUND_JOBS=off)");
else startBackgroundJobs();
console.log(`Email: ${emailMode() === "sendgrid" ? "sending through SendGrid" : "SendGrid not configured, emails are logged and skipped"}`);
const port = process.env.PORT || 3000;
const server = app.listen(port, () => console.log(`${PRODUCT} on http://localhost:${port}`));
// Another program on the same port (a second copy of this app, another project's dev server) is the usual reason it won't start locally.
server.on("error", (err) => {
  if (err.code !== "EADDRINUSE") throw err;
  console.error(`\nCannot start: port ${port} is already in use by another program on this computer.\n`
    + `  See which one:  lsof -nP -iTCP:${port} -sTCP:LISTEN\n`
    + `  Then stop it, or run this app on another port:  PORT=3001 npm start\n`
    + `  (If you change the port, set PUBLIC_URL and FRONTEND_URL in backend/.env to match, and Google sign-in needs that address added as a redirect.)\n`);
  process.exit(1);
});
