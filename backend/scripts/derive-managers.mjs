// Fills in missing reporting managers from project leads: the person who leads most of someone's active projects.
//   node scripts/derive-managers.mjs           shows the proposal (nothing is written)
//   node scripts/derive-managers.mjs --apply   saves it
// Never changes a manager that is already set, never guesses on a tie, skips Directors / the Vice President and anything
// that would make a reporting loop. Only touches this app's own schema (DB_SCHEMA).
import "dotenv/config";
import { pool, SCHEMA } from "../src/db.js";

const apply = process.argv.includes("--apply");
const TOP = /\b(director|vice president)\b/i;
const key = (s) => String(s || "").trim().toLowerCase();

const { rows: emps } = await pool.query("SELECT id, name, work_email, title, status, manager FROM employees ORDER BY id");
const { rows: allocs } = await pool.query(
  `SELECT a.employee_id, COALESCE(NULLIF(btrim(a.project_lead), ''), p.project_lead) AS lead
   FROM employee_project_allocations a JOIN projects p ON p.id = a.project_id WHERE a.status = 'Active'`);
const byName = new Map(emps.map((e) => [key(e.name), e]));
const boss = new Map(emps.filter((e) => e.manager).map((e) => [key(e.name), key(e.manager)])); // who reports to whom, kept up to date

const proposals = [], skipped = [];
for (const e of emps.filter((x) => !x.manager && x.status !== "offboarded")) {
  if (TOP.test(e.title || "")) { skipped.push([e.name, "top of the company, no manager by design"]); continue; }
  const counts = new Map();
  for (const a of allocs.filter((a) => a.employee_id === e.id)) {
    const l = key(a.lead), m = byName.get(l);
    if (l && l !== key(e.name) && m && m.status !== "offboarded") counts.set(l, (counts.get(l) || 0) + 1);
  }
  if (!counts.size) { skipped.push([e.name, "no project lead other than themselves"]); continue; }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  if (ranked[1] && ranked[1][1] === ranked[0][1]) { skipped.push([e.name, `tie between ${ranked.filter((r) => r[1] === ranked[0][1]).map((r) => byName.get(r[0]).name).join(" and ")}`]); continue; }
  const m = byName.get(ranked[0][0]);
  // a loop would form if the new manager already reports (directly or not) up to this person
  let cur = key(m.name), loop = false;
  for (let i = 0; cur && i < 50; i++) { if (cur === key(e.name)) { loop = true; break; } cur = boss.get(cur); }
  if (loop) { skipped.push([e.name, `would make a loop with ${m.name}`]); continue; }
  boss.set(key(e.name), key(m.name));
  proposals.push({ e, manager: m.name, n: ranked[0][1], of: [...counts.values()].reduce((s, n) => s + n, 0) });
}

console.log(apply ? "Setting" : "Would set", `${proposals.length} reporting managers in ${SCHEMA || "the default schema"}:\n`);
console.table(proposals.map((p) => ({ employee: p.e.name, title: p.e.title, manager: p.manager, basis: `leads ${p.n} of their ${p.of} projects` })));
console.log("Left without a manager:");
console.table(skipped.map(([name, why]) => ({ employee: name, why })));

if (apply) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const p of proposals) {
      await client.query("UPDATE employees SET manager = $1 WHERE id = $2 AND (manager IS NULL OR manager = '')", [p.manager, p.e.id]);
      await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1, $2)", [`Reporting manager set to ${p.manager} (from project lead data)`, p.e.work_email]);
    }
    await client.query("COMMIT");
    console.log(`\nDone: ${proposals.length} saved.`);
  } catch (e) { await client.query("ROLLBACK"); console.error("Failed, nothing saved:", e.message); process.exitCode = 1; }
  finally { client.release(); }
} else console.log("\nDry run: nothing was saved. Run again with --apply.");
await pool.end();
