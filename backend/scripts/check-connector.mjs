// Checks that the Wohlig One connector for Claude (backend/src/mcp/) still matches the portal. Run it with `npm run check:docs`
// (from backend/); it also runs inside `npm test`, and as a Claude Code Stop hook (--hook) that sends a session back once when
// the connector is out of step. It reads files only; it never touches the database or the network.
//
// What it checks:
//   1. Every /api endpoint an access key may reach is either called by a connector tool (mcp/tools.js) or listed in
//      mcp/coverage.js (reached through wohlig_api_get / wohlig_api_call, or left to the browser), with no stale entries.
//      Endpoints a key may not reach (access-keys-rules.js) are left out on purpose and need nothing.
//   2. A reachable endpoint whose path names pay, tax, a bank, a loan, an offer or a document is refused: block it in
//      access-keys-rules.js instead (CLAUDE.md, "Salaries: the salary owners only").
//   3. Every tool calls an endpoint that exists and that a key may reach.
//   4. Every page of the interface is in coverage.js PAGES, with real tool names or the reason it is left out.
//   5. Every router mounted under a prefix in index.js is known to mcp/catalog.js (PREFIX), so no endpoint is invisible.
//   6. docs/MCP_CONNECTOR.md names every tool and no tool that is gone; ARCHITECTURE.md gives the right number of tools.
//   7. No route is written in a way the reader cannot follow (a path from a variable it cannot find, .route() or .all()).
//   8. Every sealed pay field (secret-box.js SEALED) is removed from answers to a key (KEY_HIDDEN_FIELDS), or is in
//      coverage.js SEALED_SHOWN with the reason it is kept.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanRoutes, PREFIX } from "../src/mcp/catalog.js";
import { PAGES as COVERAGE_PAGES, GENERAL as COVERAGE_GENERAL, SEALED_SHOWN } from "../src/mcp/coverage.js";
import { KEY_HIDDEN_FIELDS } from "../src/access-keys-rules.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// Words in an endpoint's path that mean pay, tax, banks, loans, offers or documents. Such an endpoint belongs in the blocked list.
const SENSITIVE = new Set(["pay", "payroll", "payslip", "payslips", "salary", "salaries", "ctc", "bonus", "bonuses", "tax", "taxes",
  "bank", "banks", "loan", "loans", "advance", "advances", "reimbursement", "reimbursements", "claim", "claims", "budget", "budgets",
  "finance", "offer", "offers", "document", "documents", "settlement", "clearance", "pan", "aadhaar", "ids"]);
const sensitive = (p) => p.split("/").filter((s) => s && !s.startsWith(":")).some((s) => s.split(/[-_.]/).some((w) => SENSITIVE.has(w.toLowerCase())));

/** The tools in mcp/tools.js, read from the file: [{ name, calls: [{ method, path }] }]. */
export function readTools(text = read("backend/src/mcp/tools.js")) {
  const tools = [];
  for (const chunk of text.split(/\{\s*name:\s*"/).slice(1)) {
    const name = /^(\w+)"/.exec(chunk)[1];
    const calls = [];
    const norm = (p) => p.replace(/\$\{[^}]*\}/g, ":p").split("?")[0];
    for (const m of chunk.matchAll(/\bget\(\s*(["'`])(\/api[^"'`]*)\1/g)) calls.push({ method: "GET", path: norm(m[2]) });
    for (const m of chunk.matchAll(/\bsend\(\s*["'](GET|POST|PUT|PATCH|DELETE)["']\s*,\s*(["'`])(\/api[^"'`]*)\2/g)) calls.push({ method: m[1], path: norm(m[3]) });
    tools.push({ name, calls });
  }
  return tools;
}

const segs = (p) => p.replace(/\/+$/, "").split("/");
/** Whether a concrete path a tool calls (":p" for a value it fills in) is answered by a route pattern. */
const answers = (pattern, called) => {
  const a = segs(pattern), b = segs(called);
  return a.length === b.length && a.every((s, i) => s === b[i] || s.startsWith(":") || b[i] === ":p");
};

/** The pages of the interface: every path under /app in App.jsx and in the modules' route lists. */
export function readPages() {
  const pages = new Set();
  for (const m of read("frontend/src/App.jsx").matchAll(/<Route\s+path="(\/app[^"]*)"/g)) pages.add(m[1]);
  const mods = path.join(root, "frontend/src/modules");
  for (const d of fs.readdirSync(mods, { withFileTypes: true })) {
    const f = path.join(mods, d.name, "index.jsx");
    if (d.isDirectory() && fs.existsSync(f)) for (const m of fs.readFileSync(f, "utf8").matchAll(/\bpath:\s*"(\/app[^"]*)"/g)) pages.add(m[1]);
  }
  return [...pages].sort();
}

/** Routers that index.js mounts under a prefix the catalog does not know: any imported router whose file writes paths without /api. */
function unknownMounts() {
  const index = read("backend/src/index.js");
  const from = {};
  for (const m of index.matchAll(/^import\s*\{([^}]*)\}\s*from\s*"\.\/([^"]+)"/gm)) {
    for (const id of m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)) from[id] = m[2];
  }
  for (const m of index.matchAll(/^import\s+(\w+)\s*(?:,\s*\{[^}]*\})?\s*from\s*"\.\/([^"]+)"/gm)) from[m[1]] = m[2];
  const relative = (file) => /\b\w+\.(get|post|put|patch|delete)\(\s*["'`]\/(?!api)/.test(read(`backend/src/${file}`));
  const out = [];
  for (const m of index.matchAll(/app\.use\(\s*"(\/api[^"]*)"\s*,([^;]*?)\);/g)) {
    for (const id of m[2].split(",").map((s) => s.trim().replace(/\(.*$/s, "")).filter((s) => /^\w+$/.test(s))) {
      const file = from[id];
      if (!file || !relative(file)) continue;
      const known = PREFIX[`${file}:${id}`] ?? PREFIX[file];
      if (known !== m[1]) out.push(`${id} from ${file} is mounted at ${m[1]}, but mcp/catalog.js PREFIX ${known ? `says ${known}` : "does not list it"}`);
    }
  }
  return out;
}

/** Runs the checks. opts can replace the routes, pages or coverage lists read from the code (for the tests). */
/** The fields of every sealed column in secret-box.js except personal details: the pay figures. */
export function readSealedPayFields(text = read("backend/src/secret-box.js")) {
  const personal = new Set((/const PERSONAL = new Set\(\[([^\]]*)\]/.exec(text) || ["", ""])[1].match(/\w+/g) || []);
  const fields = new Set();
  for (const m of text.matchAll(/(\w+_sealed):\s*\{\s*table:\s*"\w+",\s*fields:\s*\[([^\]]*)\]/g)) {
    if (!personal.has(m[1])) for (const f of m[2].match(/"(\w+)"/g) || []) fields.add(f.slice(1, -1));
  }
  return [...fields];
}

export function checkConnector(opts = {}) {
  const problems = [];
  const routes = opts.routes ?? scanRoutes();
  const GENERAL = opts.general ?? COVERAGE_GENERAL, PAGES = opts.pagesMap ?? COVERAGE_PAGES;
  const reachable = routes.filter((r) => r.reachable);
  const key = (r) => `${r.method} ${r.path}`;
  const tools = readTools();
  const names = new Set(tools.map((t) => t.name));

  // 3. Every tool calls a real endpoint a key may reach; 1. what the tools cover.
  const covered = new Set();
  for (const t of tools) for (const c of t.calls) {
    const hit = routes.filter((r) => r.method === c.method && answers(r.path, c.path));
    if (!hit.length) problems.push(`Tool ${t.name} calls ${c.method} ${c.path}, which no route in backend/src answers.`);
    else if (!hit.some((r) => r.reachable)) problems.push(`Tool ${t.name} calls ${c.method} ${c.path}, which an access key may not reach (access-keys-rules.js).`);
    for (const r of hit) covered.add(key(r));
  }

  // 1. Every reachable endpoint is covered by a tool or listed once in coverage.js GENERAL; nothing listed is stale.
  const listed = new Map();
  for (const [label, g] of Object.entries(GENERAL)) {
    if (!g.why) problems.push(`coverage.js GENERAL "${label}" needs a reason (why).`);
    for (const r of g.routes) {
      if (listed.has(r)) problems.push(`coverage.js lists ${r} twice ("${listed.get(r)}" and "${label}").`);
      listed.set(r, label);
    }
  }
  const byKey = new Map(routes.map((r) => [key(r), r]));
  for (const [r, label] of listed) {
    const route = byKey.get(r);
    if (!route) problems.push(`coverage.js "${label}" lists ${r}, which no longer exists: remove it.`);
    else if (!route.reachable) problems.push(`coverage.js "${label}" lists ${r}, which an access key may not reach: remove it.`);
    else if (covered.has(r)) problems.push(`coverage.js "${label}" lists ${r}, which a tool already calls: remove it.`);
  }
  for (const r of reachable) {
    const k = key(r);
    if (!covered.has(k) && !listed.has(k)) {
      problems.push(`${k} (${r.file}) is not in the connector: give it a tool in mcp/tools.js, list it in mcp/coverage.js GENERAL, or block it for keys in access-keys-rules.js.`);
    }
    // 2. Pay, tax, banks, loans, offers and documents never reach the connector.
    if (sensitive(r.path)) problems.push(`${k} (${r.file}) looks like pay, tax, bank, loan, offer or document data, and an access key may reach it: block it in access-keys-rules.js (BLOCKED_PREFIXES or BLOCKED_PATTERNS).`);
  }

  // 4. Every page is accounted for, with real tool names, and no stale pages.
  const pages = opts.pages ?? readPages();
  for (const p of pages) if (!PAGES[p]) problems.push(`Page ${p} is not in mcp/coverage.js PAGES: name the tools that do its job, "general" with a reason, or "out" with the reason it is left out.`);
  for (const [p, v] of Object.entries(PAGES)) {
    if (!pages.includes(p)) problems.push(`coverage.js PAGES has ${p}, which is no longer a page: remove it.`);
    const kinds = ["tools", "general", "out"].filter((k) => v[k]);
    if (kinds.length !== 1) problems.push(`coverage.js PAGES ${p} needs exactly one of tools, general or out.`);
    for (const t of v.tools || []) if (!names.has(t)) problems.push(`coverage.js PAGES ${p} names ${t}, which is not a tool.`);
  }

  // 5. Mounts.
  problems.push(...unknownMounts());

  // 7. Routes the reader cannot follow.
  for (const u of routes.unresolved || []) problems.push(`A route the connector check cannot read: ${u}. Write its path as a "/api/…" string, or a variable whose value is set in the file that imports it.`);

  // 8. Sealed pay fields never reach a key.
  const sealed = opts.sealed ?? readSealedPayFields();
  const camel = (f) => f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  for (const f of sealed) {
    if (SEALED_SHOWN[f]) continue;
    for (const n of new Set([f, camel(f)])) if (!KEY_HIDDEN_FIELDS.has(n)) problems.push(`The sealed pay field ${f} is not removed from answers to a key: add "${n}" to KEY_HIDDEN_FIELDS in access-keys-rules.js (or to coverage.js SEALED_SHOWN, with the reason, if the name is used for something else).`);
  }
  for (const f of Object.keys(SEALED_SHOWN)) if (!sealed.includes(f)) problems.push(`coverage.js SEALED_SHOWN has ${f}, which is no longer a sealed pay field: remove it.`);

  // 6. The docs name every tool, and the right number of them.
  const doc = read("docs/MCP_CONNECTOR.md");
  for (const n of names) if (!doc.includes(`\`${n}\``)) problems.push(`docs/MCP_CONNECTOR.md does not list the tool ${n}.`);
  for (const m of new Set([...doc.matchAll(/`(wohlig_\w+)`/g)].map((x) => x[1]))) if (!names.has(m)) problems.push(`docs/MCP_CONNECTOR.md lists ${m}, which is not a tool.`);
  const count = /(\d+) tools that follow/.exec(read("ARCHITECTURE.md"));
  if (!count) problems.push(`ARCHITECTURE.md should say how many tools the connector has ("${names.size} tools that follow …").`);
  else if (Number(count[1]) !== names.size) problems.push(`ARCHITECTURE.md says the connector has ${count[1]} tools; it has ${names.size}.`);

  return { problems, tools: names.size, reachable: reachable.length, covered: covered.size, listed: listed.size, pages: pages.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hook = process.argv.includes("--hook");
  // As a hook: if this stop was already held once, let it through, so a session can never loop.
  if (hook) {
    try { if (JSON.parse(fs.readFileSync(0, "utf8") || "{}").stop_hook_active) process.exit(0); } catch { /* no input: carry on */ }
  }
  const r = checkConnector();
  if (!r.problems.length) {
    if (!hook) console.log(`The Claude connector matches the portal: ${r.tools} tools, ${r.reachable} endpoints a key may reach `
      + `(${r.covered} by a tool, ${r.listed} through the general tools or the browser), ${r.pages} pages.`);
    process.exit(0);
  }
  console.error(`The Claude connector is out of step with the portal:\n${r.problems.map((p) => `  - ${p}`).join("\n")}\n\n`
    + "Update backend/src/mcp/ (tools.js, coverage.js) and docs/MCP_CONNECTOR.md in this same change (CLAUDE.md, \"Claude connector: keep it in step\"), "
    + "then run: cd backend && npm run check:docs");
  process.exit(hook ? 2 : 1);
}
