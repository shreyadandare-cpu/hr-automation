// Brings leave balances over from another leave system (for example a Keka "Employees Leave Balance" report) so that people start
// from the casual, sick and comp-off days they have left today. The balance of each type on the report's date replaces the policy
// figures for that year, and only leave taken after that date comes off it (frontend/leave-rules.cjs, employees.leave_opening).
//   node scripts/import-leave-balances.mjs <file.json>           shows what would be saved (nothing is written)
//   node scripts/import-leave-balances.mjs <file.json> --apply   saves it, in one transaction, and writes one audit line per person
// The file: { "asOf": "2026-11-23", "source": "Keka report", "people": [{ "no": "WT/61", "name": "Abdul Majid", "casual": 0, "sick": 1.5, "compoff": 0 }, ...] }
// People are matched by employee number, then by first and last name; anyone not matched exactly once is listed and left alone.
// Safe to run again: the same file just saves the same figures. The file holds people's leave, so keep it out of git.
import "dotenv/config";
import fs from "node:fs";
import { pool, SCHEMA } from "../src/db.js";
import L from "../../frontend/leave-rules.cjs";

const file = process.argv.slice(2).find((a) => !a.startsWith("--")), apply = process.argv.includes("--apply");
if (!file) { console.error("Usage: node scripts/import-leave-balances.mjs <file.json> [--apply]"); process.exit(1); }
const data = JSON.parse(fs.readFileSync(file, "utf8"));
if (!L.validDate(data.asOf)) { console.error("The file needs asOf as a date like 2026-11-23."); process.exit(1); }
const TYPES = ["casual", "sick", "compoff"];

const noKey = (s) => { const m = String(s || "").trim().toUpperCase().replace(/\s+/g, "").match(/^([A-Z]+)\/?0*(\d+)$/); return m ? `${m[1]}/${Number(m[2])}` : String(s || "").trim().toUpperCase(); };
const words = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const nameKey = (s) => { const w = words(s); return w.length ? `${w[0]} ${w[w.length - 1]}` : ""; };

// The column is added by the app when it starts with the new code; if the server has not done that yet, --apply adds it (only adds, never changes anything).
const { rowCount: haveColumn } = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name='employees' AND column_name='leave_opening'");
const { rows: employees } = await pool.query(`SELECT id, emp_no, name, work_email, status, ${haveColumn ? "leave_opening" : "NULL::jsonb AS leave_opening"} FROM employees`);
const byNo = new Map(), byName = new Map();
for (const e of employees) {
  if (e.emp_no) byNo.set(noKey(e.emp_no), [...(byNo.get(noKey(e.emp_no)) || []), e]);
  byName.set(nameKey(e.name), [...(byName.get(nameKey(e.name)) || []), e]);
}

const plan = [], skipped = [];
for (const p of data.people || []) {
  const bad = TYPES.filter((t) => p[t] !== undefined && p[t] !== null && !(Number(p[t]) >= 0 && Number(p[t]) <= 1000));
  if (bad.length) { skipped.push([p.name, `a figure is not a number from 0 to 1000 (${bad.join(", ")})`]); continue; }
  let hit = byNo.get(noKey(p.no)) || [], how = "employee number";
  if (hit.length !== 1) { hit = byName.get(nameKey(p.name)) || []; how = "name"; }
  if (hit.length === 0) { skipped.push([`${p.name} (${p.no})`, "no one with this employee number or name"]); continue; }
  if (hit.length > 1) { skipped.push([`${p.name} (${p.no})`, `matches ${hit.length} people (${hit.map((h) => h.name).join(", ")})`]); continue; }
  const e = hit[0];
  if (e.status === "offboarded") { skipped.push([`${p.name} (${p.no})`, `${e.name} has left`]); continue; }
  const opening = { asOf: data.asOf, ...Object.fromEntries(TYPES.filter((t) => p[t] !== undefined && p[t] !== null).map((t) => [t, Number(p[t])])) };
  plan.push({ e, p, how, opening });
}

const target = (() => { try { const u = new URL(process.env.DATABASE_URL); return `${u.hostname}${u.pathname}${SCHEMA ? ` (schema ${SCHEMA})` : ""}`; } catch { return "the configured database"; } })();
console.log(`${apply ? "SAVING" : "Dry run, nothing saved"}  ·  database: ${target}  ·  balances as of ${data.asOf}  ·  ${data.source || ""}\n`);
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(`${pad("Employee", 30)} ${pad("Matched by", 16)} ${pad("Casual", 7)} ${pad("Sick", 6)} ${pad("Comp off", 9)} Replaces`);
for (const { e, how, opening } of plan) console.log(`${pad(e.name, 30)} ${pad(how, 16)} ${pad(opening.casual ?? "-", 7)} ${pad(opening.sick ?? "-", 6)} ${pad(opening.compoff ?? "-", 9)} ${e.leave_opening ? "earlier figures" : ""}`);
if (skipped.length) { console.log(`\nNot saved (${skipped.length}):`); for (const [who, why] of skipped) console.log(`  ${who}: ${why}`); }
console.log(`\n${plan.length} of ${(data.people || []).length} people ${apply ? "saved" : "would be saved"}.`);

if (apply && plan.length) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!haveColumn) await client.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_opening JSONB");
    for (const { e, opening } of plan) {
      await client.query("UPDATE employees SET leave_opening=$2 WHERE id=$1", [e.id, JSON.stringify(opening)]);
      await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)",
        [`Leave balances brought over as of ${data.asOf} (${data.source || "previous leave system"}): casual ${opening.casual ?? "-"}, sick ${opening.sick ?? "-"}, comp off ${opening.compoff ?? "-"}`, e.work_email]);
    }
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
} else if (!apply) console.log("Run again with --apply to save these.");
await pool.end();
