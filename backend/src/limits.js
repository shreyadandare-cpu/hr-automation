// Attempt limits, kept in the rate_limits table so they survive a restart and every server instance shares them.
//   tooMany(key, max, windowMs)  records one attempt and says whether there were more than `max` in the window.
//   lockedFor / noteFailure / clearFailures  the sign-in lockout: 5 wrong passwords lock that email for 15 minutes.
// If the database cannot be reached the request is let through (and logged), so a database hiccup never locks everyone out.
import { pool } from "./db.js";

const LIMIT = 5, LOCK_MS = 15 * 60 * 1000;
const fail = (err) => { console.error("Rate limit check failed:", err.message); };
let lastSweep = 0;
async function sweep() {   // remove rows older than a day, at most every 10 minutes
  if (Date.now() - lastSweep < 10 * 60 * 1000) return;
  lastSweep = Date.now();
  await pool.query("DELETE FROM rate_limits WHERE hit_at < now() - interval '1 day'").catch(fail);
}

export async function tooMany(key, max, windowMs) {
  try {
    await pool.query("INSERT INTO rate_limits (key) VALUES ($1)", [key]);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM rate_limits WHERE key=$1 AND hit_at > now() - make_interval(secs => $2)", [key, windowMs / 1000]);
    sweep();
    return rows[0].n > max;
  } catch (err) { fail(err); return false; }
}

/* The sign-in lockout works as before: wrong passwords count up while each comes within 15 minutes of the last one;
   at 5 the email is locked until 15 minutes after the latest. A quiet 15 minutes starts the count again. */
async function failureRun(key) {
  const { rows } = await pool.query("SELECT hit_at FROM rate_limits WHERE key=$1 ORDER BY hit_at DESC LIMIT $2", [`login:${key}`, LIMIT]);
  let n = 0, prev = Date.now();
  for (const r of rows) { const t = new Date(r.hit_at).getTime(); if (prev - t > LOCK_MS) break; n++; prev = t; }
  return { n, last: rows[0] ? new Date(rows[0].hit_at).getTime() : 0 };
}
/** Minutes left on a sign-in lock for this key, or 0. */
export async function lockedFor(key) {
  try {
    const { n, last } = await failureRun(key);
    return n >= LIMIT && last + LOCK_MS > Date.now() ? Math.ceil((last + LOCK_MS - Date.now()) / 60000) : 0;
  } catch (err) { fail(err); return 0; }
}
export async function noteFailure(key) {
  await pool.query("INSERT INTO rate_limits (key) VALUES ($1)", [`login:${key}`]).catch(fail);
  sweep();
}
export async function clearFailures(key) {
  await pool.query("DELETE FROM rate_limits WHERE key=$1", [`login:${key}`]).catch(fail);
}
