// Test helper: a signed-in session for an account, made directly in the database (there is no password sign-in route any more).
import crypto from "node:crypto";
import { pool } from "../src/db.js";

/** Returns the cookie header value for a session of this email that lasts an hour. */
export async function sessionCookie(email) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
    [crypto.createHash("sha256").update(token).digest("hex"), email]);
  return `sid=${token}`;
}
