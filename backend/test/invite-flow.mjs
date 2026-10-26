// Checks the invitation rules against the real database and a throwaway server: npm run test:invites
// It makes a temporary account, tries valid, reused, expired, replaced and made-up links, then removes everything it made.
import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { pool } from "../src/db.js";
import { createUser } from "../src/auth.js";
import { createInvite } from "../src/invites.js";
import { COMPANY_DOMAIN } from "../src/validate.js";

const PORT = 3100, base = `http://localhost:${PORT}`;
const email = `invite.test.${crypto.randomBytes(3).toString("hex")}@${COMPANY_DOMAIN}`;
const tokenOf = (link) => link.split("/invite/")[1];
const accept = (token, password) => fetch(`${base}/api/auth/accept-invitation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));
const login = (password) => fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }).then((r) => r.status);
const setExpiry = (token, sql) => pool.query(`UPDATE invites SET expires_at = ${sql} WHERE token_hash = $1`, [crypto.createHash("sha256").update(token).digest("hex")]);

const server = spawn("node", ["src/index.js"], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
let n = 0;
const ok = (name) => console.log(`  ✓ ${++n}. ${name}`);
try {
  for (let i = 0; i < 40; i++) { try { await fetch(base + "/login"); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  await createUser(pool, email, "employee");
  console.log(`Testing with ${email}`);

  const stored = tokenOf(await createInvite(email, "test"));
  const row = (await pool.query("SELECT token_hash FROM invites WHERE email=$1 AND status='pending'", [email])).rows[0];
  assert.notEqual(row.token_hash, stored); ok("only a hash of the token is stored");

  assert.equal((await accept(stored, "short")).status, 400); ok("a password under 8 characters is refused, link still usable");
  await setExpiry(stored, "now() + interval '29 minutes'");
  assert.equal((await accept(stored, "My-new-pass-1")).status, 200); ok("accepted before 30 minutes: 200");
  assert.equal(await login("My-new-pass-1"), 200); ok("the new password signs in");

  const again = await accept(stored, "Another-pass-2");
  assert.equal(again.status, 400); assert.match(again.body.error, /already been used/); ok("same link a second time is refused (single use)");

  const old = tokenOf(await createInvite(email, "test"));
  await setExpiry(old, "now() - interval '1 second'");
  const late = await accept(old, "Late-pass-123");
  assert.equal(late.status, 400); assert.match(late.body.error, /expired/); ok("a link past its 30 minutes is refused (expired)");
  assert.equal(await login("Late-pass-123"), 401); ok("an expired link did not change the password");

  const first = tokenOf(await createInvite(email, "test")), second = tokenOf(await createInvite(email, "test"));
  const replaced = await accept(first, "Replaced-pass-1");
  assert.equal(replaced.status, 400); assert.match(replaced.body.error, /newer invitation/); ok("an older link stops working once a new one is sent");
  assert.equal((await accept(second, "Newest-pass-12")).status, 200); ok("the newest link works");

  const fake = await accept(crypto.randomBytes(32).toString("base64url"), "Whatever-pass-1");
  assert.equal(fake.status, 400); assert.match(fake.body.error, /not valid/); ok("a made-up token is refused");
  assert.equal((await accept("nonsense", "Whatever-pass-1")).status, 400); ok("a malformed token is refused");

  const life = (await pool.query("SELECT extract(epoch FROM (expires_at - created_at))/60 AS m FROM invites WHERE token_hash=$1", [crypto.createHash("sha256").update(first).digest("hex")])).rows[0].m;
  assert.equal(Math.round(life), 30); ok("a new invitation lasts exactly 30 minutes");
  console.log("\nAll invitation checks passed.");
} finally {
  server.kill();
  await pool.query("DELETE FROM sessions WHERE lower(email)=$1", [email]);
  await pool.query("DELETE FROM invites WHERE email=$1", [email]);
  await pool.query("DELETE FROM users WHERE lower(email)=$1", [email]);
  await pool.query("DELETE FROM audit_log WHERE work_email=$1", [email]);
  await pool.end();
}
