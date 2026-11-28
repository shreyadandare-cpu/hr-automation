// What the Wohlig One connector for Claude does for every page and every /api endpoint of the portal. Pure data, read by the
// coverage check (backend/scripts/check-connector.mjs, run by `npm run check:docs`, `npm test` and the Claude Code Stop hook):
// a new page or endpoint fails the check until it is named here or given a tool in tools.js (CLAUDE.md, "Claude connector:
// keep it in step"). Endpoints an access key may not reach (access-keys-rules.js: salaries, payments, tax, documents, access,
// sign-in) are left out on purpose and are not listed here.

/*
 * Every page under /app, with one of:
 *   tools:   the connector tools that do the page's job (tools.js);
 *   general: the page has no tool of its own; its endpoints are reached through wohlig_api_get / wohlig_api_call (why);
 *   out:     the page is left out on purpose (why).
 */
const SALARY = "Salaries and every other payment stay with the salary owners in the browser; a key never reaches them (access-keys-rules.js).";
export const PAGES = {
  // Home
  "/app/dashboard": { tools: ["wohlig_dashboard", "wohlig_leave_today", "wohlig_notifications"] },
  "/app/inbox": { tools: ["wohlig_todo", "wohlig_notifications", "wohlig_mark_notifications_read"] },
  "/app/account": { out: "Access keys, connected apps, passwords and the document password are managed by the person in the browser." },
  "/app/connect/:id": { out: "The Allow page for the connector itself: a person decides there, in the browser." },
  "/app/profile": { general: "My profile (GET/PUT /api/profile): personal details the person edits on the page; ID numbers and bank details are removed from every answer to a key." },
  "/app/id-card": { general: "The ID card details (/api/id-card.json); the card itself is a PDF, made in the browser." },
  // Leave
  "/app/leave": { tools: ["wohlig_leave", "wohlig_leave_policy", "wohlig_decide_leave"] },
  "/app/leave/apply": { tools: ["wohlig_apply_leave"] },
  "/app/my-leave": { tools: ["wohlig_leave", "wohlig_cancel_leave"] },
  "/app/team-leave": { tools: ["wohlig_leave", "wohlig_leave_today", "wohlig_decide_leave", "wohlig_decide_comp_off"] },
  "/app/leave/review/:id": { tools: ["wohlig_leave", "wohlig_decide_leave", "wohlig_decide_comp_off"] },
  // Attendance and requests
  "/app/attendance": { tools: ["wohlig_attendance_day", "wohlig_attendance_month", "wohlig_attendance_report", "wohlig_add_punch"] },
  "/app/my-attendance": { tools: ["wohlig_attendance_month"] },
  "/app/requests": { tools: ["wohlig_attendance_requests"] },
  "/app/team-requests": { tools: ["wohlig_attendance_requests", "wohlig_decide_attendance_request"] },
  "/app/hr-requests": { tools: ["wohlig_attendance_requests", "wohlig_decide_attendance_request"] },
  "/app/shifts": { tools: ["wohlig_shifts", "wohlig_overtime"] },
  "/app/timesheet": { tools: ["wohlig_timesheet", "wohlig_timesheets_to_approve", "wohlig_decide_timesheet"] },
  "/app/stand-ins": { tools: ["wohlig_stand_ins"] },
  // People
  "/app/employees": { tools: ["wohlig_list_employees", "wohlig_get_employee", "wohlig_set_manager"] },
  "/app/employees/:email": { tools: ["wohlig_get_employee", "wohlig_attendance_month"] },
  "/app/my-team": { tools: ["wohlig_list_employees", "wohlig_managers"] },
  "/app/allocations": { tools: ["wohlig_allocations"] },
  "/app/onboarding": { tools: ["wohlig_onboarding"] },
  "/app/onboarding/progress": { tools: ["wohlig_onboarding"] },
  "/app/offboarding": { tools: ["wohlig_offboarding"] },
  "/app/offboarding/leavers": { tools: ["wohlig_offboarding"] },
  "/app/notice-periods": { tools: ["wohlig_notice_periods"] },
  "/app/probation": { tools: ["wohlig_probations", "wohlig_decide_probation"] },
  "/app/exit-interviews": { tools: ["wohlig_exit_interviews"] },
  "/app/letters": { out: "Letters are put together in the browser from the staff list, read by the HR team and signed by hand; there is no endpoint to call." },
  "/app/hr-reports": { tools: ["wohlig_list_employees", "wohlig_leave", "wohlig_report_builder"] },
  "/app/claude-requests": { general: "Who is waiting to be invited to Claude (/api/claude-requests), for the HR team and IT admins." },
  // Hiring and growth
  "/app/hiring": { tools: ["wohlig_openings", "wohlig_candidates"] },
  "/app/hiring/:id": { tools: ["wohlig_candidates"] },
  "/app/interviews": { tools: ["wohlig_interviews"] },
  "/app/jobs": { tools: ["wohlig_jobs"] },
  "/app/reviews": { tools: ["wohlig_reviews", "wohlig_review_cycles"] },
  "/app/hr-reviews": { tools: ["wohlig_reviews", "wohlig_review_cycles"] },
  "/app/performance": { tools: ["wohlig_okrs", "wohlig_one_on_ones"] },
  "/app/goals": { tools: ["wohlig_goals"] },
  "/app/training": { tools: ["wohlig_training"] },
  "/app/training/:id": { general: "One training and who it is assigned to (/api/trainings/:id), for the people who manage training." },
  // Community
  "/app/posts": { tools: ["wohlig_announcements", "wohlig_post_announcement"] },
  "/app/posts/:id": { tools: ["wohlig_announcements"] },
  "/app/polls": { tools: ["wohlig_polls"] },
  "/app/praise": { tools: ["wohlig_praise"] },
  "/app/rewards": { general: "Rewards given and received (/api/rewards)." },
  "/app/articles": { tools: ["wohlig_articles"] },
  "/app/articles/:id": { tools: ["wohlig_articles"] },
  "/app/surveys": { tools: ["wohlig_surveys"] },
  "/app/surveys/:id": { tools: ["wohlig_surveys"] },
  "/app/surveys/:id/results": { general: "A survey's results (/api/surveys/:id/results), shown once enough people have answered." },
  "/app/celebrations": { general: "Birthday and welcome posters for the HR team (/api/celebrations); the posters themselves are pictures made in the browser." },
  "/app/festivals": { general: "Festival wishes and festival dates (/api/festivals)." },
  "/app/digital-kit": { general: "Each person's digital kit (/api/digital-kit): signatures, banners and company files." },
  "/app/org-documents": { general: "Company files everyone may read (/api/digital-kit/resources); the files themselves open in the browser." },
  "/app/apps": { general: "Links to the apps the company uses (/api/apps)." },
  "/app/project-reports": { tools: ["wohlig_project_reports"] },
  // Manage
  "/app/helpdesk": { tools: ["wohlig_tickets", "wohlig_ticket"] },
  "/app/helpdesk/:id": { tools: ["wohlig_ticket", "wohlig_reply_ticket", "wohlig_close_ticket"] },
  "/app/hr-helpdesk": { tools: ["wohlig_tickets", "wohlig_ticket"] },
  "/app/hr-helpdesk/:id": { tools: ["wohlig_ticket", "wohlig_reply_ticket", "wohlig_close_ticket"] },
  "/app/assets": { tools: ["wohlig_assets"] },
  "/app/report-builder": { tools: ["wohlig_report_builder", "wohlig_run_report"] },
  "/app/users": { tools: ["wohlig_users"] },
  "/app/audit": { tools: ["wohlig_audit_log"] },
  "/app/chat-channels": { general: "Slack and Teams channels for notices (/api/chat-channels), for the people who manage them." },
  "/app/access": { out: "Who may do what is changed only by a super admin in the browser; a key never reaches /api/access." },
  "/app/tools": { out: "Paid tools carry their monthly cost, a payment figure; a key never reaches /api/tools." },
  // Salaries, payments, tax and documents: never through the connector
  "/app/payroll": { out: SALARY },
  "/app/payslips": { out: SALARY },
  "/app/my-finances": { out: SALARY },
  "/app/finance-reports": { out: SALARY },
  "/app/finance-reports/tax/:email": { out: SALARY },
  "/app/tax": { out: SALARY },
  "/app/reimbursements": { out: SALARY },
  "/app/reimbursements/new": { out: SALARY },
  "/app/reimbursements/:id": { out: SALARY },
  "/app/loans": { out: SALARY },
  "/app/budgets": { out: SALARY },
  "/app/budgets/new": { out: SALARY },
  "/app/budgets/:id": { out: SALARY },
  "/app/documents": { out: "Staff documents open only with the viewer's own document password, in the browser; a key never reaches /api/documents." },
};

/*
 * Every /api endpoint an access key may reach that no tool in tools.js calls, grouped, with why it has no tool of its own.
 * They are reached through wohlig_api_get / wohlig_api_call (listed by wohlig_list_endpoints), or are of no use to the
 * connector and stay with the browser. A new endpoint goes into a tool, into a group here, or into the blocked list in
 * access-keys-rules.js; an endpoint that shows pay, tax, bank details, IDs, offers or documents is always blocked.
 */
export const GENERAL = {
  "Files, pictures and uploads": {
    why: "PDFs, Excel and CSV files, pictures, calendar files and raw uploads: the connector reads and sends JSON, so these stay in the browser.",
    routes: [
      "GET /api/id-card.pdf", "GET /api/id-cards.pdf", "GET /api/celebrations/:file", "GET /api/celebrations/:id/poster", "PUT /api/celebrations/:id/poster",
      "GET /api/digital-kit/resources/:id/file", "GET /api/digital-kit/resources/:id/preview", "PUT /api/digital-kit/admin/resources/:id/file",
      "POST /api/posts/images", "GET /api/posts/images/:id", "GET /api/profile/photo", "PUT /api/profile/photo", "DELETE /api/profile/photo",
      "GET /api/profile/photos", "PUT /api/jobs/referrals/:key/resume", "GET /api/leave/holidays/template",
      "POST /api/leave/holidays/import", "POST /api/leave/holidays/import/apply", "GET /api/leave/export", "POST /api/report-builder/csv",
      "GET /api/interviews/:id/calendar",
    ],
  },
  "Machines and public pages": {
    why: "Called by the office attendance device, by Google, by the sign-in page or by the public careers site, not by a person at work.",
    routes: [
      "POST /api/attendance/device/punches", "POST /api/gmail-intel/push", "GET /api/login-options", "GET /api/festival-look",
      "GET /api/careers", "GET /api/careers/:id", "POST /api/careers/:id/apply", "PUT /api/careers/applications/:key/resume",
    ],
  },
  "Attendance settings": {
    why: "Clock-in places, the office device's people, the missing-punch policy and corrections to punches: set up once by HR on the page.",
    routes: [
      "GET /api/attendance/clock-in", "PUT /api/attendance/clock-in", "GET /api/attendance/clock-in/my-network", "POST /api/attendance/clock-in/sites",
      "PUT /api/attendance/clock-in/sites/:id", "DELETE /api/attendance/clock-in/sites/:id", "GET /api/attendance/device/users", "PUT /api/attendance/device/users",
      "DELETE /api/attendance/device/users/:id", "GET /api/attendance/missing-policy", "PUT /api/attendance/missing-policy", "GET /api/attendance/presence",
      "GET /api/attendance/today", "PUT /api/attendance/work-site", "DELETE /api/attendance/punches/:id",
    ],
  },
  "Leave settings and comp offs": {
    why: "Balances, holidays, the policy, comp offs and the daily digest: HR forms with their own checks on the page.",
    routes: [
      "PUT /api/leave/balances/:email", "POST /api/leave/comp-off-requests", "POST /api/leave/comp-offs",
      "POST /api/leave/holidays", "PUT /api/leave/holidays/:day", "DELETE /api/leave/holidays/:day", "PUT /api/leave/policy",
      "GET /api/leave/digest", "GET /api/leave/digest/preview", "POST /api/leave/digest/send-me",
    ],
  },
  "Assets": {
    why: "Adding, editing, assigning and taking back assets: forms on the Assets page; the list is wohlig_assets.",
    routes: ["POST /api/assets", "PUT /api/assets/:id", "POST /api/assets/:id/assign", "POST /api/assets/:id/return", "GET /api/assets/:id/history"],
  },
  "Requests": {
    why: "Cancelling your own attendance request; deciding is wohlig_decide_attendance_request.",
    routes: ["POST /api/requests/:type/:id/cancel"],
  },
  "People and projects": {
    why: "Changes to a person's record, team and projects: forms with their own checks on the page.",
    routes: [
      "GET /api/directory", "PUT /api/employees/details", "PUT /api/employees/number", "PUT /api/employees/status", "PUT /api/employees/type",
      "POST /api/team/members", "POST /api/projects", "PATCH /api/projects/:id", "POST /api/projects/:id/members", "POST /api/allocations/:id/end",
    ],
  },
  "Onboarding and offboarding": {
    why: "Adding joiners and running offboarding steps: HR forms on the page, which create logins and send emails.",
    routes: [
      "POST /api/onboarding", "GET /api/onboarding/draft", "PUT /api/onboarding/draft", "DELETE /api/onboarding/draft", "GET /api/onboarding/next-employee-no",
      "GET /api/work-email", "POST /api/offboarding", "POST /api/offboarding/:id/cancel", "POST /api/offboarding/:id/run",
      "POST /api/offboarding/:id/steps/:key", "POST /api/offboarding/:id/steps/:key/retry", "PUT /api/hr/resignations", "POST /api/hr/resignations/:email/withdraw",
    ],
  },
  "Hiring": {
    why: "Openings, candidates, interviews and verdicts: forms on the Hiring page; reading them is wohlig_openings, wohlig_candidates and wohlig_interviews.",
    routes: [
      "POST /api/hr/openings", "PUT /api/hr/openings/:id", "POST /api/hr/openings/:id/status", "POST /api/hr/openings/:id/candidates",
      "PUT /api/hr/candidates/:id", "DELETE /api/hr/candidates/:id", "GET /api/hr/candidates/:id/interviews", "POST /api/hr/candidates/:id/interviews",
      "POST /api/hr/candidates/:id/onboard", "POST /api/hr/interviews/:id/cancel", "PUT /api/interviews/:id/verdict", "POST /api/jobs/:id/refer",
      "POST /api/hr/exit-interviews",
    ],
  },
  "Reviews and feedback": {
    why: "Writing a review, calibrating and asking for feedback: long forms on the Reviews page; reading them is wohlig_reviews.",
    routes: [
      "POST /api/review-cycles", "GET /api/review-cycles/:id/calibration", "POST /api/review-cycles/:id/close", "POST /api/reviews",
      "PUT /api/reviews/:id/self", "PUT /api/reviews/:id/manager", "PUT /api/reviews/:id/hr", "PUT /api/reviews/:id/calibrate",
      "POST /api/reviews/:id/feedback-requests", "GET /api/feedback-requests", "PUT /api/feedback-requests/:id",
    ],
  },
  "OKRs, goals and 1:1s": {
    why: "Editing objectives, key results, goals and 1:1 notes: on the Performance and Goals pages; reading them is wohlig_okrs, wohlig_goals and wohlig_one_on_ones.",
    routes: [
      "POST /api/okrs", "PUT /api/okrs/:id", "DELETE /api/okrs/:id", "POST /api/okrs/:id/key-results", "PUT /api/okrs/key-results/:id",
      "DELETE /api/okrs/key-results/:id", "PUT /api/okrs/goals/:goalId", "POST /api/goals", "PUT /api/goals/:id", "DELETE /api/goals/:id",
      "POST /api/one-on-ones", "GET /api/one-on-ones/:id", "PUT /api/one-on-ones/:id", "PUT /api/one-on-ones/:id/private",
      "POST /api/one-on-ones/:id/items", "PUT /api/one-on-ones/items/:id", "DELETE /api/one-on-ones/items/:id",
    ],
  },
  "Engage": {
    why: "Apps, articles, polls, praise, rewards and surveys: voting, praising and answering are the person's own act on the page; reading them has a tool each.",
    routes: [
      "GET /api/apps", "POST /api/apps", "DELETE /api/apps/:id", "GET /api/articles/:id", "POST /api/articles", "PUT /api/articles/:id",
      "DELETE /api/articles/:id", "POST /api/articles/:id/ack", "GET /api/articles/:id/acks", "POST /api/polls", "DELETE /api/polls/:id",
      "POST /api/polls/:id/vote", "POST /api/praise", "DELETE /api/praise/:id", "GET /api/rewards", "POST /api/rewards",
      "GET /api/surveys/:id", "POST /api/surveys", "DELETE /api/surveys/:id", "POST /api/surveys/:id/answers", "GET /api/surveys/:id/results",
    ],
  },
  "Timesheets, training and stand-ins": {
    why: "Filling in your timesheet, managing training and naming stand-ins: forms on their pages; reading them has a tool each.",
    routes: [
      "PUT /api/timesheet", "PUT /api/training/:id", "GET /api/trainings", "POST /api/trainings", "GET /api/trainings/:id", "DELETE /api/trainings/:id",
      "POST /api/trainings/:id/assign", "POST /api/stand-ins", "DELETE /api/stand-ins/:id",
    ],
  },
  "Shifts and overtime": {
    why: "Editing shifts, the roster and overtime: on the Shifts page; reading them is wohlig_shifts and wohlig_overtime.",
    routes: [
      "POST /api/shifts", "PUT /api/shifts/:id", "DELETE /api/shifts/:id", "POST /api/shifts/:id/default", "GET /api/shifts/roster",
      "POST /api/shifts/roster", "DELETE /api/shifts/roster/:id", "GET /api/overtime/mine", "GET /api/overtime/staff", "PUT /api/overtime/staff",
      "PUT /api/overtime/:email/:month",
    ],
  },
  "Posts": {
    why: "Comments, likes, shares and edits on the company feed; reading and posting are wohlig_announcements and wohlig_post_announcement.",
    routes: [
      "GET /api/posts/:id", "PATCH /api/posts/:id", "DELETE /api/posts/:id", "GET /api/posts/:id/comments", "POST /api/posts/:id/comments",
      "DELETE /api/posts/:id/comments/:cid", "POST /api/posts/:id/like", "PUT /api/posts/:id/like", "DELETE /api/posts/:id/like", "POST /api/posts/:id/share",
    ],
  },
  "Helpdesk": {
    why: "Raising a new ticket is the person's own act on the Helpdesk page; reading, replying and closing have tools.",
    routes: ["POST /api/tickets"],
  },
  "Profile and ID card": {
    why: "My profile and the ID card details: the person's own page.",
    routes: ["GET /api/profile", "PUT /api/profile", "GET /api/id-card.json"],
  },
  "Celebrations and festivals": {
    why: "Birthday and welcome posters and festival wishes: HR prepares and sends them on their pages.",
    routes: [
      "GET /api/celebrations", "POST /api/celebrations", "GET /api/celebrations/overview", "GET /api/celebrations/recipients", "GET /api/celebrations/:id",
      "PUT /api/celebrations/:id", "POST /api/celebrations/:id/schedule", "DELETE /api/celebrations/:id/schedule", "POST /api/celebrations/:id/send",
      "POST /api/celebrations/:id/retry", "GET /api/festivals", "POST /api/festivals/:slug/dates", "DELETE /api/festivals/:slug/dates/:day",
      "PUT /api/festivals/look", "POST /api/festivals/share",
    ],
  },
  "Digital kit": {
    why: "Each person's digital kit and the company files: set up on their pages.",
    routes: [
      "GET /api/digital-kit", "POST /api/digital-kit/init", "GET /api/digital-kit/employees", "PUT /api/digital-kit/employees/:id",
      "GET /api/digital-kit/resources", "POST /api/digital-kit/resources", "PUT /api/digital-kit/resources/:id", "DELETE /api/digital-kit/resources/:id",
      "POST /api/digital-kit/hashtag-ai", "POST /api/digital-kit/headline-ai",
    ],
  },
  "Project reports and the Gmail engine": {
    why: "One week's project report and emailing it, and the Gmail Intelligence Engine's settings: HR pages; the list of reports is wohlig_project_reports.",
    routes: [
      "GET /api/project-reports/:id", "POST /api/project-reports/:id/email", "GET /api/gmail-intel/status", "GET /api/gmail-intel/usage",
      "GET /api/gmail-intel/extractions", "POST /api/gmail-intel/extractions/:id/review", "POST /api/gmail-intel/mailboxes",
      "DELETE /api/gmail-intel/mailboxes/:email", "POST /api/gmail-intel/sync",
    ],
  },
  "Report builder": {
    why: "Saving and removing a saved report; running one is wohlig_run_report.",
    routes: ["POST /api/report-builder/saved", "DELETE /api/report-builder/saved/:id"],
  },
  "Claude access and chat channels": {
    why: "Inviting people to Claude and the Slack and Teams channels for notices: set up by HR and IT admins on their pages.",
    routes: [
      "GET /api/tool-access", "POST /api/tool-access/claude", "POST /api/tool-access/claude/confirm", "POST /api/tool-access/claude/refresh",
      "GET /api/claude-requests", "POST /api/claude-requests/active", "POST /api/claude-requests/cancel", "POST /api/claude-requests/done",
      "GET /api/chat-channels", "POST /api/chat-channels", "PUT /api/chat-channels/:id", "DELETE /api/chat-channels/:id", "POST /api/chat-channels/:id/test",
    ],
  },
};

/*
 * Sealed pay fields (secret-box.js SEALED, apart from personal details) that are NOT removed from answers to a key, with why. Every
 * other sealed pay field must be in KEY_HIDDEN_FIELDS (access-keys-rules.js), under its column name and in camelCase; the check
 * fails on a new one until it is added there or here. These names are kept because other pages use them for things that are not
 * pay, and the tables that seal them are read only by endpoints a key may not reach.
 */
export const SEALED_SHOWN = {
  totals: "Poll totals (Engage > Polls); payroll run totals are read only under /api/payroll.",
  inputs: "A generic name; payroll item inputs are read only under /api/payroll.",
  detail: "Audit and loan event details are read only under /api/payroll and /api/loans.",
  details: "Clearance details are removed from offboarding answers and read only under the blocked clearance paths.",
  note: "Notes on leave, attendance and tickets; claim and budget event notes are read only under their blocked paths.",
  items: "A generic list name; tax declaration items are read only under the blocked tax paths.",
  proofs: "Tax proofs are read only under the blocked tax paths.",
  declaration: "Tax declarations are read only under the blocked tax paths.",
  validation: "Claim validation is read only under /api/reimbursements.",
  eligibility: "Claim eligibility is read only under /api/reimbursements.",
  duplicates: "Possible duplicate claims are read only under /api/reimbursements.",
  extracted: "Text read from claim receipts is read only under /api/reimbursements.",
};
