/*
 * The Claude connector, end to end, against a LOCAL server and database (never the shared one): makes an access key through a
 * browser session, then speaks MCP to /mcp as Claude does and checks that
 *   - tools/list gives exactly the tools in src/mcp/tools.js;
 *   - every read tool answers (a refusal for lack of permission is fine; a crash or "Something went wrong" is not);
 *   - every decide tool reaches its endpoint (called on an id that does not exist, so nothing changes);
 *   - no answer carries a field from KEY_HIDDEN_FIELDS (ID numbers, bank details, pay), at any depth;
 *   - salaries, payments, tax, offers (also the signing link), CVs, documents and access are refused through the general tools;
 *   - wohlig_list_endpoints lists only endpoints a key may reach.
 * It changes no data apart from its own session, key and audit lines, which it removes. The person is a salary owner who is a
 * super admin when there is one locally (the strongest case), otherwise any super admin.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/connector-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server), like access-keys-flow.mjs.
 */
import crypto from "node:crypto";
import pg from "pg";
import { salaryOwners } from "../src/access-rules.js";
import { KEY_HIDDEN_FIELDS, keyMayReach } from "../src/access-keys-rules.js";
import { specs } from "../src/mcp/tools.js";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: BASE must be a local server."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const KEY_NAME = "Connector flow key";

const owners = salaryOwners();
const person = (await one("SELECT lower(email) AS e FROM users WHERE is_super_admin AND NOT login_blocked AND lower(email) = ANY($1) LIMIT 1", [owners]))?.e
  || (await one("SELECT lower(email) AS e FROM users WHERE is_super_admin AND NOT login_blocked LIMIT 1"))?.e;
if (!person) { console.error("No super admin login in the local database."); process.exit(2); }

const token = crypto.randomBytes(32).toString("hex");
await db.query("INSERT INTO sessions (token_hash, email, expires_at, created_at) VALUES ($1,$2, now() + interval '1 hour', now())", [sha(token), person]);
const started = new Date();
let failed = 0;
const check = (ok, what) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${what}`); };

// MCP over Streamable HTTP, as Claude speaks it. An answer may come as JSON or as one server-sent event.
let key = null, protocol = null, nextId = 1;
async function rpc(method, params) {
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json",
    Accept: "application/json, text/event-stream", ...(protocol ? { "mcp-protocol-version": protocol } : {}) },
  body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }) });
  const text = await r.text();
  const body = (r.headers.get("content-type") || "").includes("text/event-stream")
    ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean).pop() : text;
  const msg = JSON.parse(body || "{}");
  if (msg.error) throw new Error(`${method}: ${JSON.stringify(msg.error)}`);
  return msg.result;
}
const callTool = async (name, args = {}) => {
  const res = await rpc("tools/call", { name, arguments: args });
  return { isError: !!res.isError, text: (res.content || []).map((c) => c.text || "").join("\n") };
};
// Every key at any depth of an answer (the text is JSON, sometimes followed by a note when a long list was shortened).
const hiddenIn = (text) => {
  let data; try { data = JSON.parse(text.replace(/\n\n(Showing|…).*$/s, "")); } catch { data = null; }
  const found = new Set();
  const walk = (x, d = 0) => { if (d > 40 || !x || typeof x !== "object") return;
    if (Array.isArray(x)) x.forEach((y) => walk(y, d + 1)); else for (const [k, v] of Object.entries(x)) { if (KEY_HIDDEN_FIELDS.has(k)) found.add(k); walk(v, d + 1); } };
  if (data) walk(data); else for (const m of text.matchAll(/"(\w+)":/g)) if (KEY_HIDDEN_FIELDS.has(m[1])) found.add(m[1]);
  return [...found];
};
const crashed = (t) => /Something went wrong|did not answer in time/.test(t.text);

try {
  const made = await fetch(`${BASE}/api/access-keys`, { method: "POST", headers: { Cookie: `sid=${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: KEY_NAME, days: 1 }) });
  key = (await made.json().catch(() => ({}))).secret;
  check(made.status === 201 && !!key, `an access key is made for ${person}${owners.includes(person) ? " (a salary owner)" : ""}`);
  if (!key) throw new Error("No key, nothing more to check.");

  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "connector-flow", version: "1.0.0" } });
  protocol = init.protocolVersion;
  check(!!init.serverInfo, `MCP initialize answers (protocol ${protocol})`);

  const listed = (await rpc("tools/list", {})).tools.map((t) => t.name).sort();
  const all = specs({ get: () => {}, send: () => {} });
  const expected = all.map((s) => s.name).sort();
  check(JSON.stringify(listed) === JSON.stringify(expected), `tools/list gives the ${expected.length} tools in tools.js`);

  // Ids for the tools that need one, from tables that hold no pay.
  const opening = (await one("SELECT id FROM job_openings WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1"))?.id;
  const ticket = (await one("SELECT id FROM tickets ORDER BY id DESC LIMIT 1"))?.id;
  const NONE = 2147483000;   // an id no row has: the decide tools reach their endpoint and change nothing
  const args = {
    wohlig_get_employee: { email: person }, wohlig_candidates: opening ? { openingId: opening } : null, wohlig_ticket: ticket ? { ticketId: ticket } : null,
    wohlig_api_get: { path: "/api/okrs" }, wohlig_run_report: { dataset: "no-such-dataset", columns: ["x"] },
  };
  const decide = {
    wohlig_decide_leave: { requestId: NONE, decision: "approved" }, wohlig_decide_comp_off: { compOffId: NONE, decision: "approved" },
    wohlig_cancel_leave: { requestId: NONE }, wohlig_decide_attendance_request: { requestId: NONE, decision: "approve" },
    wohlig_decide_timesheet: { timesheetId: NONE, decision: "approved" }, wohlig_close_ticket: { ticketId: NONE },
    wohlig_reply_ticket: { ticketId: NONE, body: "Connector flow test" },
  };
  // Changes that would touch real data even when they work as meant: not called here.
  const skip = new Set(["wohlig_mark_notifications_read", "wohlig_apply_leave", "wohlig_add_punch", "wohlig_set_manager", "wohlig_decide_probation",
    "wohlig_post_announcement", "wohlig_api_call"]);

  for (const s of all) {
    if (skip.has(s.name)) continue;
    let a = decide[s.name] ?? (s.name in args ? args[s.name] : {});
    if (a === null) { console.log(`skip ${s.name} (nothing locally to call it on)`); continue; }
    if (s.input) { const p = s.input.safeParse(a); if (!p.success) { check(false, `${s.name}: no valid arguments in this test`); continue; } a = p.data; }
    const t = await callTool(s.name, a);
    if (decide[s.name]) {
      check(t.isError && !crashed(t) && /said:/.test(t.text), `${s.name} reaches its endpoint (${t.text.slice(0, 90).replace(/\s+/g, " ")})`);
    } else if (s.name === "wohlig_run_report") {
      check(t.isError && /said:/.test(t.text) && !crashed(t), `${s.name} reaches its endpoint and the server checks the dataset`);
    } else {
      check(!crashed(t), `${s.name} answers${t.isError ? ` (refused: ${t.text.slice(0, 80).replace(/\s+/g, " ")})` : ""}`);
    }
    const hidden = hiddenIn(t.text);
    check(!hidden.length, `${s.name}: no ID numbers, bank details or pay in the answer${hidden.length ? ` (found ${hidden.join(", ")})` : ""}`);
  }

  // Never through the connector, whoever the person is.
  for (const p of ["/api/payroll", "/api/payslips", "/api/finance/statutory", "/api/reimbursements", "/api/loans", "/api/budget-requests",
    "/api/requests/advance", "/api/tax-declaration", "/api/hr/offers", "/api/sign/abc", "/api/sign/abc/pdf", "/api/hr/candidates/1/resume",
    "/api/documents", "/api/document-password", "/api/employees/ids", "/api/access", "/api/access-keys", "/api/tools", "/api/onboarding/import/template"]) {
    const t = await callTool("wohlig_api_get", { path: p });
    check(t.isError && /cannot be used with an access key|never available through the connector/.test(t.text), `refused: GET ${p}`);
  }
  for (const [m, p] of [["POST", "/api/sign/abc"], ["PUT", "/api/users/default-password"], ["POST", "/api/payroll/runs"]]) {
    const t = await callTool("wohlig_api_call", { method: m, path: p, body: {} });
    check(t.isError && /cannot be used with an access key|never available through the connector/.test(t.text), `refused: ${m} ${p}`);
  }

  const eps = JSON.parse((await callTool("wohlig_list_endpoints", {})).text);
  const bad = eps.endpoints.filter((e) => { const [m, p] = e.split(/\s+/); return !keyMayReach(p.replace(/:[A-Za-z]+/g, "x"), m); });
  check(eps.count > 0 && !bad.length, `wohlig_list_endpoints lists ${eps.count} endpoints, all within reach of a key${bad.length ? ` (not: ${bad.slice(0, 3).join("; ")})` : ""}`);
} catch (err) {
  failed++; console.error("FAIL", err.message);
} finally {
  await db.query("DELETE FROM access_keys WHERE name=$1 AND lower(email)=$2", [KEY_NAME, person]);
  await db.query("DELETE FROM sessions WHERE token_hash=$1", [sha(token)]);
  await db.query("DELETE FROM audit_log WHERE ts >= $1 AND action LIKE $2", [started, `%${KEY_NAME}%`]);
  await db.end();
}
console.log(failed ? `\n${failed} check(s) failed.` : "\nEvery check passed.");
process.exit(failed ? 1 : 0);
