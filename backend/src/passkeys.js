/*
 * Passkeys for confirming a punch with the phone's fingerprint, face or screen lock (HR's choice on Shifts > Clock-in; off by
 * default). The checks are in passkey-rules.js. A person sets up a passkey on each phone they punch from and can remove their own.
 *
 *   GET    /api/passkeys                  my passkeys (name, added, last used)
 *   POST   /api/passkeys/register/start   the options for navigator.credentials.create
 *   POST   /api/passkeys/register/finish  saves the new passkey
 *   DELETE /api/passkeys/:id              removes one of mine
 *
 * The punch itself asks for a challenge with `challengeFor(email, "punch")` and checks the answer with `confirmPunch`.
 */
import express from "express";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { PRODUCT } from "./brand.js";
import { ALGS, CHALLENGE_MS, checkAssertion, checkRegistration, newChallenge, siteOf, userHandle } from "./passkey-rules.js";

const me = (req) => req.user.email.toLowerCase();
const audit = (db, action, email) => db.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]);
export const MAX_PASSKEYS = 10;

/** A one-time challenge for this person and purpose, kept five minutes. Old ones are swept as new ones are made. */
export async function challengeFor(email, kind) {
  const challenge = newChallenge();
  await pool.query("DELETE FROM passkey_challenges WHERE expires_at < now()");
  await pool.query("INSERT INTO passkey_challenges (challenge, email, kind, expires_at) VALUES ($1,$2,$3, now() + $4 * interval '1 millisecond')",
    [challenge, email, kind, CHALLENGE_MS]);
  return challenge;
}
/** Uses up a challenge: true only once, for the same person and purpose, before it expires. */
async function takeChallenge(db, challenge, email, kind) {
  if (typeof challenge !== "string" || !challenge) return false;
  const { rowCount } = await db.query("DELETE FROM passkey_challenges WHERE challenge=$1 AND email=$2 AND kind=$3 AND expires_at > now()", [challenge, email, kind]);
  return rowCount === 1;
}
/** The challenge a browser answered, read from its clientDataJSON (checked properly afterwards). */
function challengeIn(clientDataJSON) {
  try { return JSON.parse(Buffer.from(String(clientDataJSON || ""), "base64url").toString("utf8")).challenge || ""; } catch { return ""; }
}

/** How many passkeys this person has. */
export async function passkeyCount(email, db = pool) {
  const { rows: [x] } = await db.query("SELECT count(*)::int AS n FROM passkeys WHERE lower(email)=$1 AND deleted_at IS NULL", [email]);
  return x.n;
}
/** The options for navigator.credentials.get before a punch: a fresh challenge and this person's passkeys. */
export async function punchOptions(req) {
  const site = siteOf(req);
  const { rows } = await pool.query("SELECT credential_id FROM passkeys WHERE lower(email)=$1 AND deleted_at IS NULL ORDER BY id LIMIT $2", [me(req), MAX_PASSKEYS]);
  return { challenge: await challengeFor(me(req), "punch"), rpId: site && site.rpId, allow: rows.map((r) => r.credential_id) };
}
/** Checks the fingerprint or face answer sent with a punch. Returns { ok, error }. */
export async function confirmPunch(req, answer) {
  const site = siteOf(req), email = me(req), a = answer || {};
  if (!site) return { ok: false, error: "Please punch from the Wohlig One page." };
  const challenge = challengeIn(a.clientDataJSON);
  if (!(await takeChallenge(pool, challenge, email, "punch"))) return { ok: false, error: "The check took too long. Please punch again." };
  const { rows: [k] } = await pool.query(
    "SELECT id, credential_id, public_key, sign_count FROM passkeys WHERE credential_id=$1 AND lower(email)=$2 AND deleted_at IS NULL", [String(a.id || ""), email]);
  if (!k) return { ok: false, error: "This phone's passkey is not set up for you. Please set it up again." };
  const r = checkAssertion(a, { credentialId: k.credential_id, publicKey: k.public_key, signCount: Number(k.sign_count) }, { challenge, ...site });
  if (!r.ok) return r;
  await pool.query("UPDATE passkeys SET sign_count=$2, last_used_at=now() WHERE id=$1", [k.id, r.signCount]);
  return { ok: true };
}

export function passkeysRouter(wrap) {
  const r = express.Router();
  r.use("/api/passkeys", requireAuth);

  r.get("/api/passkeys", wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, label, created_at, last_used_at FROM passkeys WHERE lower(email)=$1 AND deleted_at IS NULL ORDER BY id DESC LIMIT $2`, [me(req), MAX_PASSKEYS]);
    res.json({ passkeys: rows.map((x) => ({ id: x.id, label: x.label, added: x.created_at, lastUsed: x.last_used_at })) });
  }));

  r.post("/api/passkeys/register/start", wrap(async (req, res) => {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: "Please set this up from the Wohlig One page." });
    const { rows } = await pool.query("SELECT credential_id FROM passkeys WHERE lower(email)=$1 AND deleted_at IS NULL LIMIT $2", [me(req), MAX_PASSKEYS + 1]);
    if (rows.length >= MAX_PASSKEYS) return res.status(400).json({ error: `You have ${MAX_PASSKEYS} passkeys already. Please remove one you no longer use first.` });
    res.json({
      challenge: await challengeFor(me(req), "register"),
      rp: { id: site.rpId, name: PRODUCT },
      user: { id: userHandle(me(req)), name: me(req), displayName: req.user.name || me(req) },
      algs: [ALGS.ES256, ALGS.RS256],
      exclude: rows.map((x) => x.credential_id),
    });
  }));

  r.post("/api/passkeys/register/finish", wrap(async (req, res) => {
    const site = siteOf(req), email = me(req), b = req.body || {};
    if (!site) return res.status(400).json({ error: "Please set this up from the Wohlig One page." });
    const challenge = challengeIn(b.clientDataJSON);
    if (!(await takeChallenge(pool, challenge, email, "register"))) return res.status(400).json({ error: "The setup took too long. Please try again." });
    const v = checkRegistration(b, { challenge, ...site });
    if (!v.ok) return res.status(400).json({ error: v.error });
    const label = (typeof b.label === "string" ? b.label.trim() : "").slice(0, 60) || "My phone";
    const { rowCount } = await pool.query(
      `INSERT INTO passkeys (email, credential_id, public_key, alg, sign_count, label) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (credential_id) DO NOTHING`,
      [email, v.value.credentialId, v.value.publicKey, v.value.alg, v.value.signCount, label]);
    if (!rowCount) return res.status(409).json({ error: "This passkey is already set up." });
    await audit(pool, `Passkey added for punching (${label})`, email);
    res.status(201).json({ ok: true });
  }));

  r.delete("/api/passkeys/:id", wrap(async (req, res) => {
    const { rows: [x] } = await pool.query("UPDATE passkeys SET deleted_at=now() WHERE id=$1 AND lower(email)=$2 AND deleted_at IS NULL RETURNING label",
      [Number(req.params.id) || 0, me(req)]);
    if (!x) return res.status(404).json({ error: "This passkey was not found." });
    await audit(pool, `Passkey removed (${x.label})`, me(req));
    res.json({ ok: true });
  }));
  return r;
}
