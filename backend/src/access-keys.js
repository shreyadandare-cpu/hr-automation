// Personal access keys for the Wohlig One MCP (mcp/). Rules in access-keys-rules.js; design in mcp/README.md.
//
// - GET/POST/DELETE /api/access-keys: each person lists, makes and revokes their own keys, signed in through the browser only.
// - keyGuard (mounted right after loadSession in index.js): a request made with a key reaches /api only, never the blocked
//   paths, and every change it makes is written to the audit log with the key's name.
import express from "express";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { BLOCKED_MESSAGE, MAX_LIVE_KEYS, keyMayReach, newKey, readKeyForm } from "./access-keys-rules.js";

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const me = (req) => req.user.email.toLowerCase();

export function keyGuard(req, res, next) {
  if (!req.access || !req.access.viaKey) return next();
  if (!keyMayReach(req.originalUrl.split("?")[0], req.method)) {
    // Refused attempts are kept too: a key that keeps knocking on blocked doors is worth a look.
    pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)",
      [`Refused ${req.method} ${req.path.slice(0, 200)} through the access key "${req.accessKey.name}"`, req.user.email]).catch(() => {});
    return res.status(403).json({ error: BLOCKED_MESSAGE });
  }
  // A change made through the connector is recorded by its call into /api; /mcp itself and the sign-in paths are not.
  if (req.method !== "GET" && req.method !== "HEAD" && req.path.startsWith("/api/")) {
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)",
        [`${req.method} ${req.path.slice(0, 200)} through the access key "${req.accessKey.name}"`, req.user.email]).catch(() => {});
    });
  }
  next();
}

export const accessKeysRouter = express.Router();
accessKeysRouter.use(requireAuth);

const toApi = (r) => ({ id: r.id, name: r.name, hint: r.hint, createdAt: r.created_at, expiresAt: r.expires_at, lastUsedAt: r.last_used_at });

accessKeysRouter.get("/", wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, hint, created_at, expires_at, last_used_at FROM access_keys
      WHERE lower(email)=$1 AND kind='key' AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 20`, [me(req)]);
  res.json({ keys: rows.map(toApi), max: MAX_LIVE_KEYS });
}));

export const FRESH_MINUTES = 30;
/** Signed in through the browser within the last FRESH_MINUTES (also used by oauth.js before connecting an app). */
export const freshSignIn = (req) => !!(req.session && req.session.signedInAt && Date.now() - req.session.signedInAt.getTime() < FRESH_MINUTES * 60_000);

accessKeysRouter.post("/", wrap(async (req, res) => {
  // A key lasts for months, so making one needs a recent sign-in: a browser left open, or a stolen cookie, is not enough.
  if (!freshSignIn(req))
    return res.status(403).json({ error: `For your safety, please sign out and sign in again, then make the key within ${FRESH_MINUTES} minutes.`, needsFreshSignIn: true });
  const { value, errors } = readKeyForm(req.body);
  if (errors) return res.status(400).json({ error: Object.values(errors)[0], errors });
  const live = await pool.query("SELECT count(*)::int AS n FROM access_keys WHERE lower(email)=$1 AND kind='key' AND revoked_at IS NULL AND expires_at > now()", [me(req)]);
  if (live.rows[0].n >= MAX_LIVE_KEYS)
    return res.status(400).json({ error: `You already have ${MAX_LIVE_KEYS} access keys. Please revoke one you no longer use first.` });
  const k = newKey();
  const { rows } = await pool.query(
    `INSERT INTO access_keys (email, name, key_hash, hint, expires_at) VALUES ($1,$2,$3,$4, now() + $5 * interval '1 day')
     RETURNING id, name, hint, created_at, expires_at, last_used_at`, [me(req), value.name, k.hash, k.hint, value.days]);
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Access key "${value.name}" made`, me(req)]);
  // The secret is sent this once and never stored; only its hash is kept. Nothing may keep a copy of this answer.
  res.set("Cache-Control", "no-store");
  res.status(201).json({ key: toApi(rows[0]), secret: k.secret });
}));

accessKeysRouter.delete("/:id", wrap(async (req, res) => {
  const { rows } = await pool.query(
    "UPDATE access_keys SET revoked_at=now() WHERE id=$1 AND lower(email)=$2 AND kind='key' AND revoked_at IS NULL RETURNING name", [Number(req.params.id) || 0, me(req)]);
  if (!rows[0]) return res.status(404).json({ error: "That access key was not found, or it was already revoked." });
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Access key "${rows[0].name}" revoked`, me(req)]);
  res.json({ ok: true });
}));
