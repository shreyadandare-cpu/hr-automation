// Every /api endpoint an access key may use, read once from the server's own route files, for the connector's
// wohlig_list_endpoints tool (tools.js). It only tells the model what exists: the server stays the judge (keyGuard, access.js).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keyMayReach } from "../access-keys-rules.js";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Routers mounted under a prefix in index.js; every other router writes its full path itself.
const PREFIX = {
  "documents.js": "/api/documents", "digital-kit.js": "/api/digital-kit", "doc-password.js": "/api/document-password",
  "users.js:usersRouter": "/api/users", "users.js:sessionRouter": "/api", "users.js:accountRouter": "/api", "profile.js": "/api/profile",
  "notify.js": "/api/notifications", "celebrations.js": "/api/celebrations", "festivals.js:festivalsRouter": "/api/festivals",
  "festivals.js:festivalLookRouter": "/api", "claude-requests.js": "/api/claude-requests", "reimbursements.js": "/api/reimbursements",
  "loans.js": "/api/loans", "budgets.js": "/api/budget-requests", "payroll.js": "/api/payroll", "payslip-auto.js": "/api/payroll",
  "payroll/routes.js": "/api/payroll", "payroll/master.js": "/api/payroll/master", "access-keys.js": "/api/access-keys",
  "oauth.js:oauthAccountRouter": "/api/oauth",
};
const SKIP = new Set(["pages.js", "invites.js", "email-links.js", "google-signin.js"]);
const ROUTE = /\b([A-Za-z_]\w*)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;

let cached = null;
export function catalog() {
  if (cached) return cached;
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
      if (!keyMayReach(full.replace(/:[A-Za-z]+/g, "x"), method)) continue;
      out.set(`${method} ${full}`, { method, path: full, area: rel.replace(/\.js$/, "").replace(/-routes$/, "") });
    }
  }
  cached = [...out.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return cached;
}
