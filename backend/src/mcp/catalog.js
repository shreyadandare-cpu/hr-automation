// Every /api endpoint in the server's route files, read once from the files themselves. catalog() is the list an access key may
// use, for the connector's wohlig_list_endpoints tool (tools.js): it only tells the model what exists, the server stays the judge
// (keyGuard, access.js). scanRoutes() is every endpoint, reachable or not, for the coverage check (scripts/check-connector.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keyMayReach } from "../access-keys-rules.js";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Routers mounted under a prefix in index.js; every other router writes its full path itself. A router mounted under a new prefix
// needs a line here, or its endpoints are invisible to the connector; the coverage check fails until it has one.
export const PREFIX = {
  "documents.js": "/api/documents", "digital-kit.js": "/api/digital-kit", "doc-password.js": "/api/document-password",
  "users.js:usersRouter": "/api/users", "users.js:sessionRouter": "/api", "users.js:accountRouter": "/api", "profile.js": "/api/profile",
  "notify.js": "/api/notifications", "celebrations.js": "/api/celebrations", "festivals.js:festivalsRouter": "/api/festivals",
  "festivals.js:festivalLookRouter": "/api", "claude-requests.js": "/api/claude-requests", "reimbursements.js": "/api/reimbursements",
  "loans.js": "/api/loans", "budgets.js": "/api/budget-requests", "payroll.js": "/api/payroll", "payslip-auto.js": "/api/payroll",
  "payroll/routes.js": "/api/payroll", "payroll/master.js": "/api/payroll/master", "access-keys.js": "/api/access-keys",
  "oauth.js:oauthAccountRouter": "/api/oauth",
};
// Files with no /api endpoint of their own (pages and the links in emails, public sign-in), and the connector itself.
const SKIP = new Set(["pages.js", "invites.js", "email-links.js", "google-signin.js"]);
const ROUTE = /\b([A-Za-z_]\w*)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
// A route on a router whose path is a variable: r.post(base, …) or r.get(`${base}/template`, …). Only names used for routers count.
const ROUTER = /^(r|R|router|app|\w+Router)$/;
const DYNAMIC = /\b([A-Za-z_]\w*)\.(get|post|put|patch|delete)\(\s*(?:`\$\{(\w+)\}([^`]*)`|(\w+)\s*,)/g;
// Ways of adding a route that this reader does not follow; any of them on a router is reported, never skipped in silence.
const OTHER = /\b([A-Za-z_]\w*)\.(route|all)\(\s*["'`]([^"'`]*)/g;

let scanned = null;
/**
 * Every /api endpoint: { method, path, area, file, reachable } (reachable: an access key may use it), sorted by path; and
 * `unresolved`, the route definitions whose path could not be worked out (the coverage check fails on any of them).
 */
export function scanRoutes() {
  if (scanned) return scanned;
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p); else if (f.name.endsWith(".js")) files.push(p);
  } };
  walk(src);
  const text = new Map(files.map((f) => [path.relative(src, f).split(path.sep).join("/"), fs.readFileSync(f, "utf8")]));
  const out = new Map(), unresolved = [];
  const add = (rel, v, verb, p) => {
    const prefix = PREFIX[`${rel}:${v}`] ?? PREFIX[rel] ?? "";
    const full = p.startsWith("/api") ? p : prefix ? prefix + (p === "/" ? "" : p) : null;
    if (!full || !full.startsWith("/api")) return;
    const method = verb.toUpperCase();
    out.set(`${method} ${full}`, { method, path: full, area: rel.replace(/\.js$/, "").replace(/-routes$/, ""), file: rel,
      reachable: keyMayReach(full.replace(/:[A-Za-z]+/g, "x"), method) });
  };
  for (const [rel, body] of text) {
    if (SKIP.has(rel) || rel.startsWith("mcp/")) continue;
    for (const [, v, verb, p] of body.matchAll(ROUTE)) if (p.startsWith("/")) add(rel, v, verb, p);
    // A path from a variable: the value comes from the files that import this one (registerDetailsSheet(r, { base: "/api/…" })).
    for (const [all, v, verb, tplVar, rest = "", plainVar] of body.matchAll(DYNAMIC)) {
      if (!ROUTER.test(v)) continue;
      const name = tplVar || plainVar;
      const base = path.basename(rel);
      const values = [...text].filter(([r2, b2]) => r2 !== rel && b2.includes(`/${base}"`))
        .flatMap(([, b2]) => [...b2.matchAll(new RegExp(`\\b${name}:\\s*["'\`](\\/[^"'\`]+)["'\`]`, "g"))].map((m) => m[1]));
      if (!values.length) unresolved.push(`${rel}: ${all.trim()} (the path is a variable whose value could not be found)`);
      for (const val of values) add(rel, v, verb, val + rest);
    }
    for (const [all, v, , p] of body.matchAll(OTHER)) if (ROUTER.test(v) && (p.startsWith("/api") || v !== "app")) unresolved.push(`${rel}: ${all.trim()} (.route() and .all() are not read; write one route per method)`);
  }
  scanned = [...out.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  scanned.unresolved = unresolved;
  return scanned;
}

/** Every /api endpoint an access key may use: { method, path, area }. */
export function catalog() {
  return scanRoutes().filter((e) => e.reachable).map(({ method, path: p, area }) => ({ method, path: p, area }));
}
