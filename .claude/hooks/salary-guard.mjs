#!/usr/bin/env node
/*
 * Salary guard: a PreToolUse hook (committed in .claude/settings.json, so it reaches everyone who runs Claude Code in this repo).
 * Salaries are visible only to the salary owner (SALARY_OWNERS: chintan@wohlig.com, chirag@wohlig.com and kailash@wohlig.com; backend/src/access-rules.js). This stops
 * Claude Code from reading them by another road: the server's secrets (.env files, the encryption keys), the uploaded documents,
 * database dumps, and any database command that names a salary table or column.
 *
 * It is a guard rail for Claude, not a wall: a person with the server and the key can still read the database, which is why
 * the keys must live only on the server and in the company's secret store, never in the repo or on a laptop.
 *
 * Reads the tool call as JSON on stdin; exit code 2 with a reason on stderr blocks it.
 */
import { readFileSync } from "node:fs";

let call;
try { call = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const tool = call.tool_name || "", input = call.tool_input || {};

// Names that hold salaries, payslips, bank or tax figures, or the keys that unlock them.
const SALARY_NAMES = [
  "payroll_runs", "payroll_items", "salary_structures", "payroll_bank_accounts", "payroll_master", "payroll_adjustments",
  "payroll_files", "payroll_audit", "tax_rules", "tax_declarations", "tax_declaration_requests", "advance_recoveries",
  "advance_requests", "monthly_gross", "document_passwords",
  // Personal details (stored encrypted since 2026-11-27): the sealed columns, the masked numbers and the profile record.
  "person_sealed", "profile_sealed", "personal_email", "pan_masked", "aadhaar_masked", "acct_masked", "employee_ids", "profiles",
  "PAYROLL_ENCRYPTION_KEY", "DOCUMENTS_ENCRYPTION_KEY", "PAYROLL_DATABASE_URL",
];
// A database client run from the shell, or a one-off script (node -e / --eval / a heredoc) that opens a connection.
const DB_TOOLS = /\b(psql|pgcli|sqlite3|mysql)\b|\bnode\b[^|;&]*(-e|--eval|-p|<<)[\s\S]*\b(pg|Pool|Client|payPool|pool\.query)\b/;
// Whole-database copies, the environment and the cloud secret stores, whatever the command names: they hold every salary and every key.
const ALWAYS = /\b(pg_dump|pg_dumpall|pg_basebackup)\b|(^|[\s;&|(])(printenv|env|export\s+-p|declare\s+-x|set)(\s*$|\s*[|;&>)])|\/proc\/[^\s]*\/environ|docker\s+(compose\s+)?(exec|inspect)\b[\s\S]*\b(env|printenv|psql|pg_dump)\b|docker\s+inspect\b|\bgcloud\b[\s\S]*\bsecrets\b[\s\S]*\b(access|versions)\b|\bgcloud\s+run\s+(services|revisions)\s+describe\b|\bkubectl\b[\s\S]*\b(get|describe)\s+secrets?\b|\baws\s+secretsmanager\b|\b(heroku|fly|railway|render)\b[\s\S]*\b(config|secrets|env)\b|\bvault\s+(kv\s+)?(read|get)\b/;
const ENV_FILE = /(^|[\/\s"'=<])\.env(?!\.example)\b/;   // .env, .env.local, backend/.env; never .env.example
// The uploads folder as a path (backend/uploads, /srv/uploads/…, cd uploads), not the word in a code search.
const UPLOADS = /\/uploads(\/|\b(?![.\w]))|(^|[\s"'=])uploads\/|\bcd\s+uploads\b|hrhub-uploads/;
const DUMP = /\.(dump|sql\.gz|backup)\b/i;
const block = (why) => {
  process.stderr.write(`Blocked by the salary guard (.claude/hooks/salary-guard.mjs): ${why} Salaries, payslips, bank details, staff documents, personal details and the keys that unlock them are not for Claude to read. Work on the code instead, or ask the salary owner.`);
  process.exit(2);
};
const namesSalary = (s) => SALARY_NAMES.some((n) => new RegExp(`\\b${n}\\b`, "i").test(s));

if (tool === "Bash" || tool === "mcp__terminal__run_in_terminal") {
  const cmd = String(input.command || "");
  if (ENV_FILE.test(cmd) || UPLOADS.test(cmd) || DUMP.test(cmd)) {
    // Reading a secret file, the uploads folder or a dump in any way (cat, grep, cp, node -e, …).
    block("this command touches the server's secrets, the uploaded documents or a database dump.");
  }
  if (ALWAYS.test(cmd)) block("this command copies the whole database or prints the server's environment, which hold every salary and key.");
  if (/process\.env\b/.test(cmd) && namesSalary(cmd)) block("this command reads a salary key from the environment.");
  if (DB_TOOLS.test(cmd) && namesSalary(cmd)) block("this database command names a salary table or column.");
} else if (["Read", "Edit", "Write", "NotebookEdit", "Grep", "Glob"].includes(tool)) {
  const p = String(input.file_path || input.path || input.notebook_path || "");
  if (/(^|\/)\.env(\.(?!example$)[\w.-]+)?$/.test(p) || /(^|\/)(uploads|srv\/uploads)(\/|$)/.test(p) || /\.(dump|sql\.gz|backup)$/.test(p)) {
    block("this file holds the server's secrets, uploaded documents or a database dump.");
  }
} else if (/^mcp__.*(postgres|sql|query|database|db)/i.test(tool) && namesSalary(JSON.stringify(input))) {
  block("this database query names a salary table or column.");
}
process.exit(0);
