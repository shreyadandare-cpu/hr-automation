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

const role = await roleOf(email);
if (role === null) { console.error("Only @wohlig.com accounts can have a password."); process.exit(1); }
const first = await hidden("New password (min 10 characters): ");
const second = await hidden("Type it again: ");
if (first !== second) { console.error("The two passwords do not match. Nothing changed."); process.exit(1); }
// The person setting it must be an HR or IT admin, so this script runs as the signed-in admin.
const actor = process.env.HR_USER_EMAIL;
if (!actor) { console.error("Set HR_USER_EMAIL to your admin email first."); process.exit(1); }
await setPassword({ actor, email, password: first });
console.log(`Password saved for ${email}.`);
await pool.end();
