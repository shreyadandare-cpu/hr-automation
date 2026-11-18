// Checks that ARCHITECTURE.md still matches the code. Run it with `npm run check:docs` (from backend/).
// It also runs inside `npm test`, and as a Claude Code hook (--hook) that will not let a session finish
// while the map is out of date. It reads files only; it never touches the database.
//
// What it checks:
//   1. Every server file, route mount, table, env var name, page and module is named in ARCHITECTURE.md.
//   2. Every file ARCHITECTURE.md and CLAUDE.md link to still exists.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const list = (dir, test) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).filter(test).map((e) => e.name);
const isFile = (ext) => (e) => e.isFile() && e.name.endsWith(ext);

export function checkArchitecture() {
  const doc = read("ARCHITECTURE.md");
  const missing = [];
  const need = (kind, name, token = name) => { if (!doc.includes(token)) missing.push(`${kind}: ${name}`); };

  for (const f of list("backend/src", isFile(".js"))) need("Server file backend/src", f);
  for (const f of list("backend/src/payroll", isFile(".js"))) need("Payroll file backend/src/payroll", f, `\`${f}\``.replace("`routes.js`", "payroll/routes.js"));

  const index = read("backend/src/index.js");
  for (const m of index.matchAll(/app\.use\(\s*["'`](\/[^"'`]*)["'`]/g)) need("Route mount in index.js", m[1]);

  for (const file of ["backend/src/schema.sql", "backend/src/payroll/schema.sql"]) {
    const tables = new Set([...read(file).matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]));
    for (const t of tables) need(`Table in ${file}`, t, `\`${t}\``);
  }

  for (const m of read("backend/.env.example").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)) need("Env var in backend/.env.example", m[1], `\`${m[1]}\``);

  for (const f of list("frontend/src/pages", isFile(".jsx"))) need("Page frontend/src/pages", f);
  for (const d of list("frontend/src/modules", (e) => e.isDirectory())) need("Module frontend/src/modules", d, `\`${d}\``);
  for (const f of list("frontend/src/components", isFile(".jsx"))) need("Component frontend/src/components", f, f.replace(/\.jsx$/, ""));

  const dead = [];
  for (const [name, base] of [["ARCHITECTURE.md", "."], ["CLAUDE.md", "."], ["docs/BRAND_GUIDELINES.md", "docs"]]) {
    for (const m of read(name).matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)) {
      if (!fs.existsSync(path.join(root, base, m[1]))) dead.push(`${name} links to a missing file: ${m[1]}`);
    }
  }
  return { missing, dead };
}

function report({ missing, dead }) {
  const lines = [];
  if (missing.length) lines.push("ARCHITECTURE.md does not mention:", ...missing.map((m) => `  - ${m}`));
  if (dead.length) lines.push("Links that point to nothing:", ...dead.map((d) => `  - ${d}`));
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hook = process.argv.includes("--hook");
  // As a hook: if this stop was already held once, let it through, so a session can never loop.
  if (hook) {
    try { if (JSON.parse(fs.readFileSync(0, "utf8") || "{}").stop_hook_active) process.exit(0); } catch { /* no input: carry on */ }
  }
  const result = checkArchitecture();
  if (!result.missing.length && !result.dead.length) {
    if (!hook) console.log("ARCHITECTURE.md matches the code.");
    process.exit(0);
  }
  console.error(`${report(result)}\n\nUpdate ARCHITECTURE.md in this same change (and set its "updated" date), then run: cd backend && npm run check:docs`);
  process.exit(hook ? 2 : 1);
}
