// Scheduled work: offboarding steps, invite clean-up, reminders, payslips, the leave digest and alerts.
// index.js starts it unless BACKGROUND_JOBS=off.
import { expireInvites } from "./invites.js";
import { runDue } from "./offboarding.js";
import { runReimbursementReminders } from "./reimbursements.js";
import { runBudgetReminders } from "./budgets.js";
import { runPayslips } from "./payslip-auto.js";
import { runLeaveDigest } from "./leave-digest.js";
import { runClaudeReminders } from "./claude-requests.js";
import { runCelebrationAlerts, runScheduledCelebrations } from "./celebrations.js";
import { runTaxReminders } from "./tax-reminders.js";
import { runAttendanceReminders } from "./attendance-reminders.js";
import { startPortalAttendanceSync } from "./portal-attendance.js";
import { startGmailIntel } from "./gmail-intel-routes.js";

export function startBackgroundJobs() {
  // Scheduled offboardings run at 6 pm India time on the last working day; check every minute.
  const checkDue = () => runDue().catch((err) => console.error("Scheduled offboarding check failed:", err));
  checkDue();
  setInterval(checkDue, 60_000);
  // Attendance reminders (attendance-reminders.js): still punched in after the shift, and a missing punch-out the next morning; every 10 minutes.
  const checkAttendance = () => runAttendanceReminders().catch((err) => console.error("Attendance reminder check failed:", err));
  checkAttendance();
  setInterval(checkAttendance, 10 * 60_000);
  // Invites nobody accepted within 30 minutes are cancelled.
  const sweepInvites = () => expireInvites().catch((err) => console.error("Invite cleanup failed:", err));
  sweepInvites();
  setInterval(sweepInvites, 60_000);

  // Reimbursements waiting for review too long remind HR (automation 7); checked hourly.
  const checkReminders = () => Promise.all([runReimbursementReminders(), runBudgetReminders()]).catch((err) => console.error("Reimbursement reminder check failed:", err));
  checkReminders();
  setInterval(checkReminders, 60 * 60_000);
  // Last month's payroll: started as a draft from the 1st for HR to check and send for review (payslip-auto.js); checked hourly.
  const checkPayslips = () => runPayslips().then((r) => { if (r.created) console.log("Payroll:", JSON.stringify(r)); })
    .catch((err) => console.error("Automatic payslips failed:", err));
  checkPayslips();
  setInterval(checkPayslips, 60 * 60_000);
  // One email to HR each working morning listing everyone on leave today (leave-digest.js); checked every 10 minutes, sent once a day.
  const checkDigest = () => runLeaveDigest().then((r) => { if (r.sentTo !== undefined) console.log("Leave digest:", JSON.stringify(r)); })
    .catch((err) => console.error("Leave digest failed:", err));
  checkDigest();
  setInterval(checkDigest, 10 * 60_000);
  // Claude access requests nobody has dealt with for a couple of days remind the Claude admin; checked hourly.
  const checkClaude = () => runClaudeReminders().catch((err) => console.error("Claude request reminder failed:", err));
  checkClaude();
  setInterval(checkClaude, 60 * 60_000);
  // Birthdays today and new joiners without a poster: HR is told once through the bell (celebrations.js); checked hourly. Nothing is emailed.
  const checkCelebrations = () => runCelebrationAlerts().then((r) => { if (r.told.length) console.log("Celebrations:", r.told.join(", ")); })
    .catch((err) => console.error("Celebration check failed:", err));
  checkCelebrations();
  setInterval(checkCelebrations, 60 * 60_000);
  // Posters HR scheduled are emailed when their time comes, any day of the week, holidays included; checked every 5 minutes.
  const checkScheduled = () => runScheduledCelebrations().then((r) => { if (r.sent || r.missed) console.log("Scheduled celebrations:", JSON.stringify(r)); })
    .catch((err) => console.error("Scheduled celebration check failed:", err));
  checkScheduled();
  setInterval(checkScheduled, 5 * 60_000);
  // Tax declaration and proof due dates: everyone who has not finished is reminded 7 days and 1 day before (tax-reminders.js); hourly.
  const checkTax = () => runTaxReminders().then((r) => { if (r.sent) console.log("Tax reminders sent:", r.sent); })
    .catch((err) => console.error("Tax reminder check failed:", err));
  checkTax();
  setInterval(checkTax, 60 * 60_000);
  startGmailIntel();   // reads project emails from the mailboxes HR switched on (only when GMAIL_INTEL_ENABLED=true)
  startPortalAttendanceSync();   // copies the office device punches the Employee Portal received (only when PORTAL_ATTENDANCE_SYNC=true)
}
