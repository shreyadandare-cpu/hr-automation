// LOCAL TESTING ONLY. Makes the given people super admins in a local database and sets their password to the local default
// password (settings.default_password, from DEFAULT_PASSWORD), so they can sign in with email and password when the local
// server runs with ALLOW_PASSWORD_LOGIN=true (the wohlig-one-local launch configuration does). Refuses any non-local database.
//
//   DATABASE_URL=postgresql://localhost:5432/hrhub_local node scripts/local-super-admins.mjs [email ...]
//
// With no emails it uses the people below. Run it again any time; it only sets what is missing.
import { pool } from "../src/db.js";
import { hashPassword } from "../src/auth.js";

const DEFAULT = ["priyal.makwana@wohlig.com", "shreya.dandare@wohlig.com", "pratik.sawant@wohlig.com"];
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || "")) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
const emails = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT).map((e) => e.trim().toLowerCase());
const pw = (await pool.query("SELECT value FROM settings WHERE key='default_password'")).rows[0]?.value;
if (!pw) { console.error("No default password in this database yet: start the local server once first."); process.exit(2); }
const hash = await hashPassword(pw);
for (const e of emails) {
  await pool.query(
    `INSERT INTO users (email, password_hash, role, is_super_admin) VALUES ($1,$2,'employee',true)
     ON CONFLICT (email) DO UPDATE SET is_super_admin=true, login_blocked=false, password_hash=$2`, [e, hash]);
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", ["Made a super admin for local testing (scripts/local-super-admins.mjs)", e]);
  console.log(`${e}: super admin, signs in with the local default password`);
}
await pool.end();
