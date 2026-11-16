/* Gives every current employee a Digital Kit and loads the starter text once.
   Safe to run again at any time: employees, logins and existing kits are never changed or duplicated.
   Run:  node --env-file=.env scripts/init-digital-kits.mjs   (from the backend folder) */
import { pool, initDb } from "../src/db.js";
import { initDigitalKits, removeDuplicateStarters, seedDigitalKit, seedOfficialFiles, repairOfficialFiles, seedOfficialTexts, updateOfficialLabels } from "../src/digital-kit.js";

await initDb();
const seeded = await seedDigitalKit();
const files = await seedOfficialFiles();
await seedOfficialTexts();
await updateOfficialLabels();
await repairOfficialFiles();
const dups = await removeDuplicateStarters();
const created = await initDigitalKits();
const { rows } = await pool.query(
  `SELECT (SELECT count(*) FROM employees WHERE status <> 'offboarded')::int AS employees,
          (SELECT count(*) FROM digital_kits)::int AS kits,
          (SELECT count(*) FROM employees e WHERE e.status <> 'offboarded' AND NOT EXISTS (SELECT 1 FROM digital_kits k WHERE k.employee_id = e.id))::int AS without_kit`);
console.log(`Starter text ${seeded ? "loaded" : "was already there"}. Official files added now: ${files}. Duplicate starters removed: ${dups}. Kits created now: ${created}. Employees: ${rows[0].employees}, kits: ${rows[0].kits}, employees still without a kit: ${rows[0].without_kit}.`);
await pool.end();
