// Sets an account password from the Terminal. The password is typed hidden and never shown or logged.
// Usage: node src/set-password.js <email>
import { createInterface } from "node:readline";
import { setPassword } from "./auth.js";
import { pool } from "./db.js";
import { roleOf } from "./ops.js";

const email = process.argv[2];
if (!email) { console.error("usage: node src/set-password.js <email>"); process.exit(1); }

function hidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); }; // do not echo typed characters
    rl.question(question, (ans) => { rl.close(); process.stdout.write("\n"); resolve(ans); });
  });
}

// First-admin setup for a new database: only when no HR admin exists yet, and only if BOOTSTRAP_ADMIN=yes.
if (process.env.BOOTSTRAP_ADMIN === "yes") {
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM hr_users WHERE role = 'admin'");
  if (n === 0) {
    const { withTx } = await import("./db.js");
    const { writeAudit } = await import("./audit.js");
    await withTx(async (c) => {
      await c.query("INSERT INTO hr_users (email, role) VALUES ($1,'admin') ON CONFLICT (email) DO UPDATE SET role='admin'", [email]);
      await writeAudit(c, { actor: email, action: "First HR admin set up", result: "info" });
    });
    console.log("First HR admin added:", email);
  } else {
    console.log("An HR admin already exists; BOOTSTRAP_ADMIN ignored.");
  }
}

const role = await roleOf(email);
if (role === null) { console.error("Only @wohlig.com accounts can have a password."); process.exit(1); }
const first = await hidden("New password (min 10 characters): ");
const second = await hidden("Type it again: ");
if (first !== second) { console.error("The two passwords do not match. Nothing changed."); process.exit(1); }
// The person setting it must be an HR or IT admin, so this script runs as the signed-in admin.
const actor = process.env.HR_USER_EMAIL || email;
if (!actor) { console.error("Set HR_USER_EMAIL to your admin email first."); process.exit(1); }
await setPassword({ actor, email, password: first });
console.log(`Password saved for ${email}.`);
await pool.end();
