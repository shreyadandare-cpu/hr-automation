// Copies people, logins, projects, allocations, attendance and holidays from the Employee Portal tables (schema "public") into this
// app's own schema (DB_SCHEMA, e.g. hrhub). It only READS public.* and only WRITES to the app schema.
//   node scripts/import-portal-data.mjs           shows what would be copied (nothing is written)
//   node scripts/import-portal-data.mjs --apply   copies it, in one transaction
// Safe to run again: rows already copied are skipped.
import "dotenv/config";
import { pool, initDb, SCHEMA } from "../src/db.js";
import { COMPANY_DOMAIN } from "../src/validate.js";

const apply = process.argv.includes("--apply");
if (!SCHEMA || SCHEMA === "public") { console.error("Set DB_SCHEMA (for example hrhub) in .env first. This script must not write into public."); process.exit(1); }

await initDb(); // makes sure the app's tables exist in its own schema
const client = await pool.connect();
const S = SCHEMA, P = "public", DOMAIN = COMPANY_DOMAIN;
const q = async (sql) => (await client.query(sql)).rowCount;
const one = async (sql) => (await client.query(sql)).rows[0];

try {
  await client.query("BEGIN");
  const report = {};

  report.employees = await q(`
    INSERT INTO ${S}.employees (id, emp_no, name, work_email, title, sub_title, work_location, manager, start_date, last_day, status, created_at)
    SELECT e.id, e.employee_code, e.name, lower(btrim(e.email)), e.designation, e.sub_designation, e.work_location, m.name,
           e.date_of_joining, e.last_working_day,
           CASE e.status WHEN 'Inactive' THEN 'offboarded' ELSE 'active' END,   -- Active and Notice Period are both still working
           e.created_at
    FROM ${P}.employees e LEFT JOIN ${P}.employees m ON m.id = e.reporting_manager_id
    WHERE e.email IS NOT NULL AND btrim(e.email) <> ''
    ON CONFLICT DO NOTHING`);

  // People with no email in the portal still need a work email here: build first.last@domain, the way the app does for new joiners.
  const clean = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const generated = [];
  const noEmail = (await client.query(`
    SELECT e.*, m.name AS manager_name FROM ${P}.employees e LEFT JOIN ${P}.employees m ON m.id = e.reporting_manager_id
    WHERE (e.email IS NULL OR btrim(e.email) = '') AND NOT EXISTS (SELECT 1 FROM ${S}.employees x WHERE x.id = e.id) ORDER BY e.id`)).rows;
  for (const e of noEmail) {
    const parts = String(e.name).trim().split(/\s+/).map(clean).filter(Boolean);
    const base = parts.length > 1 ? `${parts[0]}.${parts[parts.length - 1]}` : parts[0] || `employee${e.id}`;
    let email;
    for (let n = 1; ; n++) {
      email = `${base}${n > 1 ? n : ""}@${DOMAIN}`;
      if (!(await client.query(`SELECT 1 FROM ${S}.employees WHERE lower(work_email) = $1`, [email])).rowCount) break;
    }
    await client.query(`
      INSERT INTO ${S}.employees (id, emp_no, name, work_email, title, sub_title, work_location, manager, start_date, last_day, status, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [e.id, e.employee_code, e.name, email, e.designation, e.sub_designation, e.work_location, e.manager_name, e.date_of_joining,
       e.last_working_day, e.status === "Inactive" ? "offboarded" : "active", e.created_at]);
    generated.push({ code: e.employee_code, name: e.name, email, status: e.status });
  }
  report.employeesWithGeneratedEmail = generated.length;

  report.projects = await q(`
    INSERT INTO ${S}.projects (id, name, project_lead, start_date, end_date, status, description)
    SELECT id, name, project_lead, start_date, end_date, status, description FROM ${P}.projects
    ON CONFLICT DO NOTHING`);

  report.allocations = await q(`
    INSERT INTO ${S}.employee_project_allocations (id, employee_id, project_id, start_date, end_date, project_lead, location, status, end_reason, handover_to, handover_notes, transferred_to)
    SELECT a.id, a.employee_id, a.project_id, a.start_date, a.end_date, a.project_lead, a.location, a.status, a.end_reason, a.handover_to, a.handover_notes, a.transferred_to
    FROM ${P}.employee_project_allocations a
    WHERE EXISTS (SELECT 1 FROM ${S}.employees e WHERE e.id = a.employee_id) AND EXISTS (SELECT 1 FROM ${S}.projects p WHERE p.id = a.project_id)
    ON CONFLICT DO NOTHING`);

  report.punches = await q(`
    INSERT INTO ${S}.attendance_punches (id, employee_id, work_date, punch_time, direction, source, note, created_by)
    SELECT p.id, p.employee_id, p.work_date, p.punch_time::time, p.direction, p.source, p.note, u.email
    FROM ${P}.attendance_punches p LEFT JOIN ${P}.users u ON u.id = p.created_by_user_id
    WHERE EXISTS (SELECT 1 FROM ${S}.employees e WHERE e.id = p.employee_id)
    ON CONFLICT DO NOTHING`);

  report.holidays = await q(`
    INSERT INTO ${S}.holidays (day, name) SELECT holiday_date, name FROM ${P}.holidays WHERE NOT is_cancelled
    ON CONFLICT DO NOTHING`);

  // Logins keep their portal password (the app reads the portal's hash format). Everyone starts as an employee: the portal's
  // ADMINs are listed below so HR can promote them on the Users page. An account that already exists here is left alone.
  report.logins = await q(`
    INSERT INTO ${S}.users (email, password_hash, role, created_at, last_login)
    SELECT lower(btrim(email)), password_hash, 'employee', created_at, last_login_at FROM ${P}.users WHERE is_active
    ON CONFLICT DO NOTHING`);
  const admins = (await client.query(`SELECT lower(email) AS email FROM ${P}.users WHERE role = 'ADMIN' AND is_active ORDER BY email`)).rows;

  // New records in the app continue after the copied ids.
  for (const t of ["employees", "projects", "employee_project_allocations", "attendance_punches"]) {
    await client.query(`SELECT setval(pg_get_serial_sequence('${S}.${t}', 'id'), GREATEST((SELECT COALESCE(max(id), 0) FROM ${S}.${t}), 1))`);
  }

  console.log(apply ? "Copied into" : "Would copy into", `${S}:`, report);
  console.log("\nWork emails generated for people who had none in the portal (check these):");
  for (const g of generated) console.log(`   ${g.code}  ${g.name.padEnd(18)} ${g.email}  (${g.status})`);
  console.log("\nPortal ADMINs, imported as employees (promote to HR on the Users page if they should have full rights):");
  for (const a of admins) console.log(`   ${a.email}`);
  console.log("\nNot copied: the one expense claim (a cancelled test claim; the app has no 'cancelled' status).");

  if (apply) { await client.query("COMMIT"); console.log("\nDone: committed."); }
  else { await client.query("ROLLBACK"); console.log("\nDry run: nothing was written. Run again with --apply to copy."); }
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Failed, nothing was written:", e.message);
  process.exitCode = 1;
} finally { client.release(); await pool.end(); }
