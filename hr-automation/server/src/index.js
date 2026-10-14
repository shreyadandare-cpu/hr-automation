import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as ops from "./ops.js";
import * as auth from "./auth.js";
import { pool } from "./db.js";

const server = new McpServer({ name: "hr-automation", version: "0.2.0" });

// Read tools are marked so the app does not ask permission for them. Changing tools are not marked.
const READ_ONLY = new Set(["list_employees", "get_roster", "get_employee", "list_audit", "get_automation_state", "check_audit_chain", "whoami"]);
const DESTRUCTIVE = new Set(["offboard_employee"]);
const annotationsFor = (name) =>
  READ_ONLY.has(name) ? { readOnlyHint: true }
  : DESTRUCTIVE.has(name) ? { readOnlyHint: false, destructiveHint: true }
  : { readOnlyHint: false };

// Every tool except sign-in needs a valid session. The caller is taken from the session, never from the input.
const SESSION = { session: z.string().describe("Session token from sign_in") };

// Tools that change something. A view-only session (Employee) is refused these, whatever the account holds.
const CHANGES = new Set(["confirm_onboarding", "tick_checklist", "offboard_employee", "create_employee", "schedule_leaving", "set_password", "set_automation_paused", "check_offboarded_access", "run_scheduled_offboarding"]);

function tool(name, description, schema, fn, { needsSession = true } = {}) {
  server.registerTool(name, { description, inputSchema: needsSession ? { ...SESSION, ...schema } : schema, annotations: annotationsFor(name) }, async (args) => {
    try {
      const sess = needsSession ? await auth.sessionFor(args?.session) : null;
      const actor = sess ? sess.email : null;
      if (sess && CHANGES.has(name) && sess.role === "employee") {
        throw new Error("This sign-in is view only. Sign in as HR admin or IT admin to change anything.");
      }
      const result = await fn(args ?? {}, actor);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  });
}

tool("sign_in", "Sign in with a Wohlig email, password and the role to use. Returns a session token.",
  { email: z.string(), password: z.string(), role: z.enum(["admin", "it", "employee"]).optional() },
  (a) => auth.signIn(a.email, a.password, a.role ?? "employee"),
  { needsSession: false });

tool("sign_up", "Create your account with your work email and a password you choose. Only people in the employee list can do this.",
  { email: z.string(), password: z.string() },
  (a) => auth.signUp({ email: a.email, password: a.password }),
  { needsSession: false });

tool("sign_out", "End the current session.",
  {}, async (a) => auth.signOut(a.session), { needsSession: false });

tool("whoami", "Who is signed in and the role of this sign-in. Reveals no data.",
  {}, async (a) => { const s = await auth.sessionFor(a.session); return { email: s.email, role: s.role }; });

tool("set_password", "Set or reset a person's password. HR or IT admin only. The person must sign in again.",
  { email: z.string(), password: z.string() },
  (a, actor) => auth.setPassword({ actor, email: a.email, password: a.password }));

tool("change_password", "Change your own password.",
  { old_password: z.string(), new_password: z.string() },
  (a) => auth.changeOwnPassword({ session: a.session, oldPassword: a.old_password, newPassword: a.new_password }));

tool("list_employees", "List employees, optionally filtered by status.",
  { status: z.enum(["onboarding", "active", "offboarding", "offboarded"]).optional() },
  async (a, actor) => { await ops.requireStaff(actor); return ops.listEmployees(a); });

tool("get_roster", "All employees with tool access and checklists, for the HR Access Hub page.",
  {}, async (_a, actor) => { await ops.requireStaff(actor); return ops.getRoster(); });

tool("get_employee", "Get one employee with tool access and checklist.",
  { employee_id: z.number().int() },
  async (a, actor) => { await ops.requireStaff(actor); return ops.getEmployee(a.employee_id); });

tool("confirm_onboarding", "Turn on each tool for a joiner. HR or IT admin.",
  { employee_id: z.number().int() },
  (a, actor) => ops.confirmOnboarding({ actor, employeeId: a.employee_id }));

tool("tick_checklist", "Tick or untick a checklist item. HR or IT admin.",
  { item_id: z.number().int(), done: z.boolean() },
  (a, actor) => ops.tickChecklist({ actor, itemId: a.item_id, done: a.done }));

tool("offboard_employee", "Remove all tool access for a leaver, Google account first. HR or IT admin.",
  { employee_id: z.number().int(), last_working_day: z.string().optional(), nominee: z.string().optional() },
  (a, actor) => ops.offboard({ actor, employeeId: a.employee_id, lastDay: a.last_working_day, nominee: a.nominee }));

tool("create_employee", "Add a joiner. Nothing is switched on until onboarding is confirmed. HR or IT admin.",
  { full_name: z.string().min(2), work_email: z.string().email(), department: z.string(), job_title: z.string().optional(), start_date: z.string() },
  (a, actor) => ops.createEmployee({ actor, fullName: a.full_name, workEmail: a.work_email, department: a.department, jobTitle: a.job_title, startDate: a.start_date }));

tool("schedule_leaving", "Record a future last working day. The daily job offboards on that day. HR or IT admin.",
  { employee_id: z.number().int(), last_working_day: z.string() },
  (a, actor) => ops.scheduleLeaving({ actor, employeeId: a.employee_id, lastDay: a.last_working_day }));

tool("list_audit", "Read the audit log, newest first, optionally for one employee.",
  { employee_id: z.number().int().optional(), limit: z.number().int().max(500).optional() },
  async (a, actor) => { await ops.requireStaff(actor); return ops.listAudit({ employeeId: a.employee_id, limit: a.limit }); });

tool("set_automation_paused", "Emergency stop: pause or resume all automatic changes. HR admin only.",
  { paused: z.boolean() },
  (a, actor) => ops.setPaused({ actor, paused: a.paused }));

tool("get_automation_state", "Is automation paused?",
  {}, async (_a, actor) => { await ops.requireStaff(actor); return ops.getPaused(); });

tool("check_offboarded_access", "Re-check every leaver in every tool. HR or IT admin.",
  {}, (_a, actor) => ops.reconcileOffboarded({ actor }));

tool("run_scheduled_offboarding", "Offboard everyone whose last working day has arrived. HR or IT admin.",
  {}, () => ops.runScheduledOffboarding());

tool("check_audit_chain", "Verify the audit log hash chain has not been altered.",
  {}, async (_a, actor) => { await ops.requireStaff(actor); return ops.checkAudit(); });

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("hr-automation MCP server ready (sign-in required for every action)");

process.on("SIGINT", async () => { await pool.end(); process.exit(0); });
