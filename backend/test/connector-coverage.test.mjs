// The Claude connector (src/mcp/) follows the portal: every page and every endpoint an access key may reach has a tool or a
// line in mcp/coverage.js, no tool calls an endpoint that is gone or blocked, nothing that names pay, tax, banks, loans, offers
// or documents is reachable, and docs/MCP_CONNECTOR.md lists every tool (scripts/check-connector.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkConnector, readTools, readPages, readSealedPayFields } from "../scripts/check-connector.mjs";
import { scanRoutes } from "../src/mcp/catalog.js";
import { GENERAL } from "../src/mcp/coverage.js";

test("the connector covers every page and every endpoint a key may reach", () => {
  assert.deepEqual(checkConnector().problems, [], "Update src/mcp/tools.js or src/mcp/coverage.js, and docs/MCP_CONNECTOR.md");
});

test("a new endpoint with no tool and no coverage line fails the check", () => {
  const routes = [...scanRoutes(), { method: "GET", path: "/api/brand-new", area: "x", file: "x.js", reachable: true }];
  const { problems } = checkConnector({ routes });
  assert.ok(problems.some((p) => p.startsWith("GET /api/brand-new (x.js) is not in the connector")), problems.join("\n"));
});

test("a blocked endpoint needs nothing", () => {
  const routes = [...scanRoutes(), { method: "GET", path: "/api/payroll/brand-new", area: "x", file: "x.js", reachable: false }];
  assert.deepEqual(checkConnector({ routes }).problems, []);
});

test("a reachable endpoint that names pay is refused even when it is listed", () => {
  const route = { method: "GET", path: "/api/bonus-report/:id", area: "x", file: "x.js", reachable: true };
  const general = { ...GENERAL, Test: { why: "test", routes: ["GET /api/bonus-report/:id"] } };
  const { problems } = checkConnector({ routes: [...scanRoutes(), route], general });
  assert.ok(problems.some((p) => p.includes("GET /api/bonus-report/:id") && p.includes("block it in access-keys-rules.js")), problems.join("\n"));
});

test("a new page with no entry fails, and so does a page entry that is gone", () => {
  const { problems } = checkConnector({ pages: [...readPages().filter((p) => p !== "/app/polls"), "/app/brand-new"] });
  assert.ok(problems.some((p) => p.startsWith("Page /app/brand-new is not in mcp/coverage.js PAGES")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("PAGES has /app/polls, which is no longer a page")), problems.join("\n"));
});

test("a coverage line for an endpoint that no longer exists fails", () => {
  const routes = scanRoutes().filter((r) => !(r.method === "GET" && r.path === "/api/polls") && !(r.method === "POST" && r.path === "/api/polls"));
  const { problems } = checkConnector({ routes });
  assert.ok(problems.some((p) => p.includes("lists POST /api/polls, which no longer exists")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("wohlig_polls calls GET /api/polls, which no route")), problems.join("\n"));
});

test("the tool reader finds each tool and the endpoints it calls", () => {
  const tools = new Map(readTools().map((t) => [t.name, t.calls]));
  assert.deepEqual(tools.get("wohlig_decide_leave"), [{ method: "POST", path: "/api/leave/requests/:p/decision" }]);
  assert.deepEqual(tools.get("wohlig_attendance_day"), [{ method: "GET", path: "/api/attendance/day" }]);
  assert.deepEqual(tools.get("wohlig_api_get"), []);
});

test("a route whose path cannot be read fails the check", () => {
  const routes = Object.assign([...scanRoutes()], { unresolved: ["x.js: r.get(where, (the path is a variable whose value could not be found)"] });
  const { problems } = checkConnector({ routes });
  assert.ok(problems.some((p) => p.startsWith("A route the connector check cannot read: x.js")), problems.join("\n"));
});

test("routes whose path comes from the file that imports them are read (the employee details sheet)", () => {
  const sheet = scanRoutes().filter((r) => r.file === "details-sheet.js").map((r) => `${r.method} ${r.path} ${r.reachable}`).sort();
  assert.deepEqual(sheet, ["GET /api/onboarding/import/template false", "POST /api/onboarding/import false", "POST /api/onboarding/import/apply false"]);
});

test("a new sealed pay field must be hidden from keys", () => {
  assert.ok(readSealedPayFields().includes("ctc_annual"));
  assert.ok(!readSealedPayFields().includes("phone"), "personal details are not pay fields");
  const { problems } = checkConnector({ sealed: [...readSealedPayFields(), "bonus_amount"] });
  assert.ok(problems.some((p) => p.includes('add "bonus_amount" to KEY_HIDDEN_FIELDS')), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes('add "bonusAmount" to KEY_HIDDEN_FIELDS')), problems.join("\n"));
});
