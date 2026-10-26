// Creates every table of the HR Access Hub in the database named by DATABASE_URL, inside the schema named by DB_SCHEMA.
//   npm run migrate              create what is missing (safe to run again: existing tables and data are left alone)
//   npm run migrate -- --dry-run run it all, show what would be created, then undo it
//   npm run migrate:sql          write migrations/hrhub-schema.sql, the same migration as plain SQL for any SQL console
// It reads src/schema.sql, so there is one source of truth. It never drops or empties anything.
import "dotenv/config";
import fs from "node:fs";
import { pool, SCHEMA } from "../src/db.js";

const args = new Set(process.argv.slice(2));
const sqlText = fs.readFileSync(new URL("../src/schema.sql", import.meta.url), "utf8");
const wanted = [...new Set([...sqlText.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]))].sort();

if (args.has("--write-sql")) {
  const schema = SCHEMA || "public";
  const out = new URL("../migrations/hrhub-schema.sql", import.meta.url);
  fs.writeFileSync(out, `-- HR Access Hub: all tables, safe to run more than once (it only creates what is missing).
-- Generated from src/schema.sql by \`npm run migrate:sql\`. Run it as a user that may create tables, for example:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/hrhub-schema.sql
-- The tables go into the schema "${schema}", so they never mix with another app's tables in the same database.
\\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA IF NOT EXISTS ${schema};
SET LOCAL search_path TO ${schema};

${sqlText}
COMMIT;
`);
  console.log(`Wrote migrations/hrhub-schema.sql (${wanted.length} tables, schema "${schema}").`);
  process.exit(0);
}

if (!process.env.DATABASE_URL) { console.error("Set DATABASE_URL in backend/.env first."); process.exit(1); }
const schema = SCHEMA || "public";
const dryRun = args.has("--dry-run");
const tablesNow = async (c) => new Set((await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'", [schema])).rows.map((r) => r.table_name));

const client = await pool.connect();
try {
  const who = (await client.query("SELECT current_user AS u, current_database() AS d")).rows[0];
  console.log(`Database "${who.d}" as ${who.u}, schema "${schema}"${dryRun ? " (dry run: nothing will be kept)" : ""}`);
  await client.query("BEGIN");
  if (SCHEMA) await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  const before = await tablesNow(client);
  await client.query(sqlText);
  const after = await tablesNow(client);
  const created = [...after].filter((t) => !before.has(t)).sort();
  const missing = wanted.filter((t) => !after.has(t));
  if (missing.length) throw new Error(`These tables are still missing after the migration: ${missing.join(", ")}`);
  console.log(`\n${wanted.length} tables defined, ${wanted.length - created.length} already existed, ${created.length} ${dryRun ? "would be " : ""}created.`);
  if (created.length) console.log("  " + created.join(", "));
  const counts = (await client.query(`SELECT (SELECT count(*)::int FROM ${schema}.reimbursement_categories) AS categories, (SELECT count(*)::int FROM ${schema}.holidays) AS holidays`)).rows[0];
  console.log(`Reference data: ${counts.categories} reimbursement categories, ${counts.holidays} holidays.`);
  await client.query(dryRun ? "ROLLBACK" : "COMMIT");
  console.log(dryRun ? "\nDry run finished: everything was undone." : "\nDone: committed. All tables are in place.");
  if (!dryRun) console.log("Next, to copy the Employee Portal's people and projects in: node scripts/import-portal-data.mjs --apply");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("\nMigration failed, nothing was changed:", e.message);
  process.exitCode = 1;
} finally { client.release(); await pool.end(); }
