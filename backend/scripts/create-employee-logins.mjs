// Makes a login for every current employee who does not have one, so they can sign in with Google the first time.
//   node scripts/create-employee-logins.mjs           shows who would get one (nothing is written)
//   node scripts/create-employee-logins.mjs --apply   creates them, as employees, in one transaction
// The accounts have a random password nobody knows, so they sign in with Google. People who already have a login are left alone.
// (The app also does this at a person's first Google sign-in, so this is for doing it all at once.)
import "dotenv/config";
import { pool } from "../src/db.js";
import { createGoogleUser } from "../src/auth.js";
import { isCompanyEmail } from "../src/validate.js";

const apply = process.argv.includes("--apply");
const client = await pool.connect();
try {
  const { rows } = await client.query(
    `SELECT e.name, e.work_email, e.emp_no FROM employees e WHERE e.status <> 'offboarded'
     AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(e.work_email)) ORDER BY e.id`);
  const ok = rows.filter((r) => isCompanyEmail(r.work_email)), skipped = rows.filter((r) => !isCompanyEmail(r.work_email));
  console.log(`${ok.length} current employees have no login${skipped.length ? `; ${skipped.length} skipped (not a company address): ${skipped.map((s) => s.work_email).join(", ")}` : ""}.`);
  ok.forEach((r) => console.log(`   ${String(r.emp_no || "").padEnd(9)} ${r.name.padEnd(22)} ${r.work_email}`));
  if (!apply) { console.log("\nDry run: nothing was written. Run again with --apply."); }
  else {
    await client.query("BEGIN");
    let made = 0;
    for (const r of ok) if (await createGoogleUser(client, r.work_email, "employee")) {
      made++;
      await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", ["Login created for Google sign-in (employee role), from the staff list", r.work_email]);
    }
    await client.query("COMMIT");
    console.log(`\nDone: ${made} logins created.`);
  }
} catch (e) { await client.query("ROLLBACK").catch(() => {}); console.error("Failed, nothing was written:", e.message); process.exitCode = 1; }
finally { client.release(); await pool.end(); }
