// The Wohlig One connector's tools (mcp-server.js), one per job on the HR dashboard, grouped as its menu is (Home, To do, Company,
// Manage). Each calls the endpoint the page calls, as the signed-in person, through the same /api with the same token, so the
// server applies the same access rules as in the browser and keyGuard keeps salaries and the rest out. Two general tools reach
// anything else the dashboard does (wohlig_list_endpoints).
import * as z from "zod/v4";
import { catalog } from "./catalog.js";
import { PRODUCT } from "../brand.js";

/** An answer the portal gave with an error status, in words the model can act on. */
export class WohligError extends Error {}
const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

const email = z.email().describe("Work email, for example asha@wohlig.com");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("A date as YYYY-MM-DD");
const month = z.string().regex(/^\d{4}-\d{2}$/).describe("A month as YYYY-MM");
const id = z.number().int().positive();
const note = (what) => z.string().max(500).describe(what);


/** The tools, given the caller for this request. */
export const specs = ({ get, send }) => [
  /* ---------- Home ---------- */
  { name: "wohlig_whoami", title: "Who am I",
    description: "The person this access key belongs to: name, email, super admin or not, and every permission they hold (company-wide or for named teams). Call this first to know what the other tools will allow.",
    run: () => get("/api/me") },
  { name: "wohlig_dashboard", title: "Dashboard today",
    description: `What the ${PRODUCT} dashboard shows today, in one call: who is on leave today and soon, upcoming birthdays, who works from home today, today's attendance (who is in, late or absent, for the people you may see) and your unread notifications.`,
    input: z.strictObject({ date: day.optional().describe("Day to show; today (India time) when left out") }),
    run: async ({ date }) => {
      const [leave, remote, attendance, notifications] = await Promise.allSettled([
        get("/api/leave/today"), get("/api/remote-today"), get("/api/attendance/day", { date: date || todayIst() }), get("/api/notifications")]);
      const v = (r) => (r.status === "fulfilled" ? r.value : { unavailable: r.reason instanceof Error ? r.reason.message : String(r.reason) });
      return { date: date || todayIst(), leave: v(leave), workFromHome: v(remote), attendance: v(attendance), notifications: v(notifications) };
    } },
  { name: "wohlig_notifications", title: "Notifications",
    description: `Your bell notifications in ${PRODUCT} (newest first), with what is still unread.`,
    run: () => get("/api/notifications") },
  { name: "wohlig_mark_notifications_read", title: "Mark notifications read",
    description: `Marks all your ${PRODUCT} notifications as read, as opening the bell does.`, write: "change",
    run: () => send("POST", "/api/notifications/read") },

  /* ---------- To do: what waits for a decision ---------- */
  { name: "wohlig_todo", title: "To do",
    description: "Everything waiting for your decision, as the To do page gathers it: leave requests, attendance corrections, timesheets to approve, interview verdicts and helpdesk tickets you answer. Each part lists items with their ids for the decide tools.",
    run: async () => {
      const parts = { leave: get("/api/leave"), attendanceRequests: get("/api/requests/attendance", { scope: "all" }),
        timesheets: get("/api/timesheets/to-approve"), interviews: get("/api/interviews"), helpdesk: get("/api/tickets", { scope: "all" }) };
      const done = await Promise.allSettled(Object.values(parts));
      const keys = Object.keys(parts);
      const out = {};
      done.forEach((r, i) => { out[keys[i]] = r.status === "fulfilled" ? r.value : { unavailable: r.reason instanceof Error ? r.reason.message : String(r.reason) }; });
      const leave = out.leave;
      if (leave && Array.isArray(leave.requests)) out.leave = { pending: leave.requests.filter((x) => x.status === "pending") };
      const tickets = out.helpdesk;
      if (tickets && !Array.isArray(tickets) && Array.isArray(tickets.tickets)) out.helpdesk = { open: tickets.tickets.filter((x) => x.status !== "closed") };
      return out;
    } },

  /* ---------- Company: people ---------- */
  { name: "wohlig_list_employees", title: "Employees",
    description: "The staff list (Company > Employees): name, email, title, department, manager, status, employee ID. Filter by text (name, email, title or department), by status, or by manager. Use wohlig_get_employee for one person's full record.",
    input: z.strictObject({
      search: z.string().max(100).optional().describe("Text to match in name, email, title or department"),
      status: z.string().max(30).optional().describe("Status to keep, for example active, onboarding, offboarding, offboarded"),
      manager: email.optional().describe("Only the people whose reporting manager is this email"),
      limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) }),
    run: async ({ search, status, manager, limit, offset }) => {
      const data = await get("/api/roster");
      const rows = Array.isArray(data) ? data : [];
      const s = (search || "").toLowerCase();
      const pick = rows.filter((r) => {
        const text = JSON.stringify([r.name, r.email, r.workEmail, r.work_email, r.title, r.dept, r.department]).toLowerCase();
        const st = String(r.status ?? "").toLowerCase();
        const mgr = String(r.managerEmail ?? r.manager_email ?? "").toLowerCase();
        return (!s || text.includes(s)) && (!status || st === status.toLowerCase()) && (!manager || mgr === manager.toLowerCase());
      });
      const page = pick.slice(offset, offset + limit);
      return { total: pick.length, offset, count: page.length, has_more: offset + page.length < pick.length,
        ...(offset + page.length < pick.length ? { next_offset: offset + page.length } : {}), employees: page };
    } },
  { name: "wohlig_get_employee", title: "Employee",
    description: "One person's record from the staff list (title, department, manager, dates, status, contact), and the people who report to them. Salary and documents are never shown here.",
    input: z.strictObject({ email }),
    run: async ({ email: e }) => {
      const data = await get("/api/roster");
      const rows = Array.isArray(data) ? data : [];
      const lc = e.toLowerCase();
      const mail = (r) => String(r.email ?? r.workEmail ?? r.work_email ?? "").toLowerCase();
      const person = rows.find((r) => mail(r) === lc);
      if (!person) throw new WohligError(`Nobody with the email ${e} is on the staff list you can see. Use wohlig_list_employees to search by name.`);
      const reports = rows.filter((r) => String(r.managerEmail ?? r.manager_email ?? "").toLowerCase() === lc).map((r) => ({ name: r.name, email: mail(r), title: r.title }));
      return { person, directReports: reports };
    } },
  { name: "wohlig_managers", title: "Managers",
    description: "Everyone who can be chosen as a reporting manager.",
    run: () => get("/api/managers") },
  { name: "wohlig_set_manager", title: "Change reporting manager",
    description: "Sets a person's reporting manager (Employees > change manager). Leave approval and the org chart follow it. Needs people.edit for that person.",
    write: "change", input: z.strictObject({ email, managerEmail: email.describe("The new manager's work email") }),
    run: ({ email: e, managerEmail }) => send("PUT", "/api/employees/manager", { email: e, managerEmail }) },
  { name: "wohlig_allocations", title: "Projects and allocations",
    description: "Projects and who is allocated to each (Company > Allocations). HR sees every project; others see their own.",
    run: () => get("/api/allocations") },

  /* ---------- Leave ---------- */
  { name: "wohlig_leave", title: "Leave",
    description: "Everything the Leave pages show for the people you may see: leave requests (with ids and status), comp offs, balances inputs, holidays and the policy. Use wohlig_decide_leave on a pending request's id.",
    run: () => get("/api/leave") },
  { name: "wohlig_leave_today", title: "On leave today",
    description: "Who is on leave today and in the coming days, and upcoming birthdays.",
    run: () => get("/api/leave/today") },
  { name: "wohlig_apply_leave", title: "Apply for leave",
    description: "Applies for leave, for yourself or (with leave.approve for them) for someone in your team, as Leave > Apply does. Types: casual, sick, compoff, unpaid. For a half day give half (first or second) and only from.",
    write: "create",
    input: z.strictObject({
      type: z.enum(["casual", "sick", "compoff", "unpaid"]), from: day, to: day.optional().describe("Last day; leave out for one day or a half day"),
      half: z.enum(["first", "second"]).optional(), reason: z.string().min(1).max(500),
      email: email.optional().describe("Who the leave is for; yourself when left out"),
      split: z.boolean().default(false).describe("Put days over the paid balance in a second, unpaid request") }),
    run: (a) => send("POST", "/api/leave/requests", { ...a, to: a.to || a.from }) },
  { name: "wohlig_decide_leave", title: "Approve or decline leave",
    description: "Approves or declines a pending leave request (Leave > Review). A decline needs a note saying why. You cannot decide your own request.",
    write: "change", input: z.strictObject({ requestId: id, decision: z.enum(["approved", "declined"]), note: note("A comment; required when declining").optional() }),
    run: ({ requestId, decision, note: n }) => send("POST", `/api/leave/requests/${requestId}/decision`, { decision, note: n }) },
  { name: "wohlig_cancel_leave", title: "Cancel leave",
    description: "Cancels a leave request.", write: "remove", input: z.strictObject({ requestId: id }),
    run: ({ requestId }) => send("POST", `/api/leave/requests/${requestId}/cancel`) },
  { name: "wohlig_leave_policy", title: "Leave policy", description: "The leave policy numbers HR has saved.",
    run: () => get("/api/leave/policy") },

  /* ---------- Attendance ---------- */
  { name: "wohlig_attendance_day", title: "Attendance for a day",
    description: "Attendance for one day (Manage > Attendance): each person's first and last punch, hours, late or absent, for the people you may see.",
    input: z.strictObject({ date: day.optional() }), run: ({ date }) => get("/api/attendance/day", { date: date || todayIst() }) },
  { name: "wohlig_attendance_month", title: "Attendance month",
    description: "One person's attendance for a month, day by day; yourself when email is left out.",
    input: z.strictObject({ email: email.optional(), month: month.optional() }), run: (a) => get("/api/attendance/month", a) },
  { name: "wohlig_attendance_report", title: "Attendance report",
    description: "The month's attendance report for everyone you may see: days present, absent, late, missing punch-outs.",
    input: z.strictObject({ month: month.optional() }), run: (a) => get("/api/attendance/report", a) },
  { name: "wohlig_add_punch", title: "Add a punch",
    description: "Adds a missed punch for someone else (attendance.edit), as HR does on the attendance page. A reason is required. Your own attendance is corrected by someone else.",
    write: "create",
    input: z.strictObject({ email, date: day, time: z.string().regex(/^\d{2}:\d{2}$/).describe("HH:MM, 24-hour, India time"), direction: z.enum(["IN", "OUT"]), note: note("Why the punch is added") }),
    run: (a) => send("POST", "/api/attendance/punches", a) },

  /* ---------- Requests (attendance corrections, work from home, on duty) ---------- */
  { name: "wohlig_attendance_requests", title: "Attendance requests",
    description: "Attendance correction, work-from-home and on-duty requests. scope=all lists everyone you may decide for; mine lists your own.",
    input: z.strictObject({ scope: z.enum(["all", "mine"]).default("all") }),
    run: ({ scope }) => get("/api/requests/attendance", scope === "all" ? { scope: "all" } : {}) },
  { name: "wohlig_decide_attendance_request", title: "Decide an attendance request",
    description: "Approves or declines an attendance request; a decline needs a note.", write: "change",
    input: z.strictObject({ requestId: id, decision: z.enum(["approve", "decline"]), note: note("Required when declining").optional() }),
    run: ({ requestId, decision, note: n }) => send("POST", `/api/requests/attendance/${requestId}/decide`, { decision, note: n }) },

  /* ---------- Timesheets ---------- */
  { name: "wohlig_timesheets_to_approve", title: "Timesheets to approve", description: "Weekly timesheets waiting for your approval.",
    run: () => get("/api/timesheets/to-approve") },
  { name: "wohlig_decide_timesheet", title: "Decide a timesheet", description: "Approves a submitted weekly timesheet, or sends it back (returned) with a note saying what to fix.", write: "change",
    input: z.strictObject({ timesheetId: id, decision: z.enum(["approved", "returned"]), note: note("What should change; required when returning it").optional() }),
    run: ({ timesheetId, decision, note: n }) => send("POST", `/api/timesheets/${timesheetId}/decision`, { decision, note: n }) },

  /* ---------- Onboarding, offboarding, notice periods ---------- */
  { name: "wohlig_onboarding", title: "Onboarding", description: "New joiners and how far each is through onboarding (Manage > Onboarding).",
    run: () => get("/api/onboarding") },
  { name: "wohlig_offboarding", title: "Offboarding", description: "Leavers and their offboarding steps (Manage > Offboarding). Final settlement and clearance figures are left out by the server for access keys.",
    run: () => get("/api/offboarding") },
  { name: "wohlig_notice_periods", title: "Notice periods", description: "Resignations and notice periods (Manage > Notice periods).",
    run: () => get("/api/hr/resignations") },

  /* ---------- Hiring ---------- */
  { name: "wohlig_openings", title: "Openings", description: "Open roles in hiring (Manage > Hiring), with their status and ids.",
    run: () => get("/api/hr/openings") },
  { name: "wohlig_candidates", title: "Candidates", description: "Candidates for one opening, with their stage. Offers and pay are not shown here.",
    input: z.strictObject({ openingId: id }), run: ({ openingId }) => get(`/api/hr/openings/${openingId}/candidates`) },
  { name: "wohlig_interviews", title: "Interviews", description: "Interviews you take part in, with ids for giving a verdict.",
    run: () => get("/api/interviews") },

  /* ---------- Probation, reviews, exit interviews ---------- */
  { name: "wohlig_probations", title: "Probation", description: "People on probation and when it ends (Manage > Probation).",
    run: () => get("/api/hr/probations") },
  { name: "wohlig_decide_probation", title: "Confirm or extend probation",
    description: "Confirms a person after probation, or extends it to a new end date.", write: "change",
    input: z.strictObject({ email, action: z.enum(["confirm", "extend"]), endsOn: day.optional().describe("New end date, when extending"), note: note("A note for the record").optional() }),
    run: (a) => send("POST", "/api/hr/probations", a) },
  { name: "wohlig_review_cycles", title: "Review cycles", description: "Performance review cycles (Manage > Reviews).",
    run: () => get("/api/review-cycles") },
  { name: "wohlig_reviews", title: "Reviews", description: "Performance reviews you can see, with their stage.",
    run: () => get("/api/reviews") },
  { name: "wohlig_exit_interviews", title: "Exit interviews", description: "Exit interviews recorded for leavers.",
    run: () => get("/api/hr/exit-interviews") },

  /* ---------- Helpdesk ---------- */
  { name: "wohlig_tickets", title: "Helpdesk tickets",
    description: "Helpdesk tickets. scope=all lists every ticket (for people who answer the helpdesk); mine lists your own.",
    input: z.strictObject({ scope: z.enum(["all", "mine"]).default("all") }),
    run: ({ scope }) => get("/api/tickets", scope === "all" ? { scope: "all" } : {}) },
  { name: "wohlig_ticket", title: "Helpdesk ticket", description: "One ticket with its conversation.",
    input: z.strictObject({ ticketId: id }), run: ({ ticketId }) => get(`/api/tickets/${ticketId}`) },
  { name: "wohlig_reply_ticket", title: "Reply to a ticket", description: "Adds a reply to a helpdesk ticket; the person is notified.", write: "create",
    input: z.strictObject({ ticketId: id, body: z.string().min(1).max(4000) }),
    run: ({ ticketId, body }) => send("POST", `/api/tickets/${ticketId}/reply`, { body }) },
  { name: "wohlig_close_ticket", title: "Close a ticket", description: "Closes a helpdesk ticket.", write: "change",
    input: z.strictObject({ ticketId: id }), run: ({ ticketId }) => send("POST", `/api/tickets/${ticketId}/close`) },

  /* ---------- Community ---------- */
  { name: "wohlig_announcements", title: "Announcements", description: "The company feed (Community > Announcements), newest first.",
    input: z.strictObject({ before: id.optional().describe("Show posts older than this post id, for the next page") }),
    run: (a) => get("/api/posts", a) },
  { name: "wohlig_post_announcement", title: "Post an announcement",
    description: "Posts an announcement to the whole company feed. Everyone sees it; write it in professional, warm Wohlig wording.", write: "create",
    input: z.strictObject({ title: z.string().max(140).optional(), body: z.string().min(1).max(5000) }),
    run: (a) => send("POST", "/api/posts", a) },

  /* ---------- Manage: assets, shifts, reports, users, audit ---------- */
  { name: "wohlig_assets", title: "Assets", description: "Company assets and who holds each (Manage > Assets).", run: () => get("/api/assets") },
  { name: "wohlig_shifts", title: "Shifts", description: "Shifts and who is on each (Manage > Shifts and overtime).", run: () => get("/api/shifts") },
  { name: "wohlig_overtime", title: "Overtime", description: "Overtime waiting for approval and approved.", input: z.strictObject({ month: month.optional() }),
    run: (a) => get("/api/overtime", a) },
  { name: "wohlig_report_builder", title: "Report builder: datasets",
    description: "The datasets you may report on (people, leave, assets, reviews, punches), their columns and filters, and your saved reports. Then use wohlig_run_report.",
    run: () => get("/api/report-builder") },
  { name: "wohlig_run_report", title: "Run a report",
    description: "Runs a report from the report builder and returns its first rows. Take the dataset, column and filter keys from wohlig_report_builder.",
    input: z.strictObject({ dataset: z.string().min(1), columns: z.array(z.string()).min(1).max(25), filters: z.record(z.string(), z.unknown()).optional() }),
    run: (a) => send("POST", "/api/report-builder/run", a) },
  { name: "wohlig_users", title: "Users", description: `Logins in ${PRODUCT} and their roles (Manage > Users). Read only: logins, passwords and roles are changed in the browser.`, run: () => get("/api/users") },
  { name: "wohlig_audit_log", title: "Audit log", description: "The audit log (Manage > Audit log), newest first; filter by person.",
    input: z.strictObject({ email: email.optional(), limit: z.number().int().min(1).max(1000).default(200) }), run: (a) => get("/api/audit", a) },

  /* ---------- Everything else the dashboard does ---------- */
  { name: "wohlig_list_endpoints", title: `${PRODUCT} endpoints`,
    description: `Every ${PRODUCT} endpoint an access key may use, by area (leave, attendance, hr-tools, workforce, engage, posts, celebrations, festivals, shifts, performance and more). Use it to find what wohlig_api_get and wohlig_api_call can reach when no dedicated tool fits.`,
    input: z.strictObject({ area: z.string().max(40).optional().describe("Only this area, for example hr-tools or leave"), method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional() }),
    run: async ({ area, method }) => {
      const all = catalog();
      const list = all.filter((e) => (!area || e.area === area) && (!method || e.method === method));
      return { count: list.length, areas: [...new Set(all.map((e) => e.area))].sort(), endpoints: list.map((e) => `${e.method} ${e.path}  (${e.area})`) };
    } },
  { name: "wohlig_api_get", title: `Read any ${PRODUCT} page data`,
    description: `Reads any ${PRODUCT} endpoint the dashboard uses (GET), for what no dedicated tool covers, for example /api/celebrations/overview or /api/okrs. Fill :params in the path. Salaries, payments, tax, bank details, documents and access rights are refused by the server.`,
    input: z.strictObject({ path: z.string().regex(/^\/api\//).max(300).describe("Path starting with /api/, for example /api/hr/openings/3/candidates"),
      query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional() }),
    run: ({ path, query }) => get(path, query) },
  { name: "wohlig_api_call", title: `Do any ${PRODUCT} action`,
    description: `Sends a change to any ${PRODUCT} endpoint the dashboard uses (POST, PUT, PATCH or DELETE) with a JSON body, for actions no dedicated tool covers. It changes real data and may notify or email people: say exactly what it will do and get the user's go-ahead first. Check the endpoint with wohlig_list_endpoints.`,
    write: "remove",
    input: z.strictObject({ method: z.enum(["POST", "PUT", "PATCH", "DELETE"]), path: z.string().regex(/^\/api\//).max(300), body: z.record(z.string(), z.unknown()).optional() }),
    run: ({ method, path, body }) => send(method, path, body) },
];

