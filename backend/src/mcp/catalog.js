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

let scanned = null;
/** Every /api endpoint: { method, path, area, file, reachable } (reachable: an access key may use it), sorted by path. */
export function scanRoutes() {
  if (scanned) return scanned;
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p); else if (f.name.endsWith(".js")) files.push(p);
  } };
  walk(src);
  const out = new Map();
  for (const file of files) {
    const rel = path.relative(src, file).split(path.sep).join("/");
    if (SKIP.has(rel) || rel.startsWith("mcp/")) continue;
    for (const [, v, verb, p] of fs.readFileSync(file, "utf8").matchAll(ROUTE)) {
      if (!p.startsWith("/")) continue;
      const prefix = PREFIX[`${rel}:${v}`] ?? PREFIX[rel] ?? "";
      const full = p.startsWith("/api") ? p : prefix ? prefix + (p === "/" ? "" : p) : null;
      if (!full || !full.startsWith("/api")) continue;
      const method = verb.toUpperCase();
      out.set(`${method} ${full}`, { method, path: full, area: rel.replace(/\.js$/, "").replace(/-routes$/, ""), file: rel,
        reachable: keyMayReach(full.replace(/:[A-Za-z]+/g, "x"), method) });
    }
  }
  scanned = [...out.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return scanned;
}

/** Every /api endpoint an access key may use: { method, path, area }. */
export function catalog() {
  return scanRoutes().filter((e) => e.reachable).map(({ method, path: p, area }) => ({ method, path: p, area }));
}
