// The Wohlig One connector's sign-in for Claude: OAuth 2.1 with PKCE and dynamic client registration, as the MCP specification
// asks. Rules in oauth-rules.js; how it fits together in docs/MCP_CONNECTOR.md.
//
//   Public (oauthPublicRouter, before the sign-in guard): the discovery documents, POST /oauth/register, GET /oauth/authorize
//   (keeps the request and opens the Allow page at /app/connect/<id>), POST /oauth/token and POST /oauth/revoke.
//   Signed in through the browser (oauthAccountRouter, /api/oauth): the Allow page's request, allow or cancel, and the
//   connected apps on Account with Disconnect. An access key cannot reach these (access-keys-rules.js).
//
// An access token is an access key of kind 'oauth' that lasts an hour, so every rule a key follows applies to Claude as well:
// it acts as the person through access.js, never holds a salary permission and never reaches the blocked paths (keyGuard).
import express from "express";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { publicUrl } from "./mail.js";
import { tooMany } from "./limits.js";
import { PRODUCT } from "./brand.js";
import { freshSignIn, FRESH_MINUTES } from "./access-keys.js";
import { newKey } from "./access-keys-rules.js";
import {
  ACCESS_TOKEN_MINUTES, CODE_SECONDS, MAX_GRANT_DAYS, MAX_PENDING_PER_CLIENT, REFRESH_DAYS, REQUEST_MINUTES, SCOPE, okResource, pkceMatches, randomId, readAuthorize, readRegistration,
  resourceMetadata, serverMetadata, sha, withParams,
} from "./oauth-rules.js";

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const me = (req) => req.user.email.toLowerCase();
const audit = (action, email) => pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]).catch(() => {});

/** The connector's public paths answer any website (no cookies are used on them, only tokens), as MCP clients need. */
export function oauthCors(req, res, next) {
  if (!/^\/(mcp|oauth\/(register|token|revoke)|\.well-known\/oauth-)/.test(req.path)) return next();
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
    "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
    "Access-Control-Max-Age": "600",
  });
  return req.method === "OPTIONS" ? res.status(204).end() : next();
}

const tokenError = (res, error, description, status = 400) =>
  res.status(status).set("Cache-Control", "no-store").json({ error, ...(description ? { error_description: description } : {}) });

/** A short-lived access token (an access key of kind 'oauth') for a connection. */
async function accessTokenFor(db, grant) {
  const k = newKey();
  await db.query(
    `INSERT INTO access_keys (email, name, key_hash, hint, expires_at, kind, grant_id)
     VALUES ($1,$2,$3,$4, now() + $5 * interval '1 minute', 'oauth', $6)`,
    [grant.email, `${grant.client_name} (connector)`, k.hash, k.hint, ACCESS_TOKEN_MINUTES, grant.id]);
  return k.secret;
}

/** Ends a connection and every access token made for it. */
async function endGrant(db, grantId) {
  await db.query("UPDATE oauth_grants SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL", [grantId]);
  await db.query("UPDATE access_keys SET revoked_at=now() WHERE grant_id=$1 AND revoked_at IS NULL", [grantId]);
}

/** Hourly (jobs.js): clears spent tokens, old sign-ins, ended connections and apps that never connected anyone. */
export async function sweepConnector() {
  await pool.query("DELETE FROM access_keys WHERE kind='oauth' AND expires_at < now() - interval '1 day'");
  await pool.query("DELETE FROM oauth_requests WHERE expires_at < now() - interval '1 day'");
  await pool.query("DELETE FROM oauth_grants WHERE COALESCE(revoked_at, expires_at) < now() - interval '30 days'");
  await pool.query(`DELETE FROM oauth_clients c WHERE created_at < now() - interval '1 day'
    AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id=c.client_id) AND NOT EXISTS (SELECT 1 FROM oauth_requests r WHERE r.client_id=c.client_id)`);
}

const tokenAnswer = (access, refresh) => ({
  access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_MINUTES * 60, refresh_token: refresh, scope: SCOPE,
});

/** A plain page for a request that cannot be sent back to the app (unknown app or address): nothing is redirected. */
const stopPage = (res, message) => res.status(400).type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${PRODUCT}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:0 16px;line-height:1.5;font-size:16px">
<h1 style="font-size:22px">The connection could not be started</h1><p>${message.replace(/[<>&"]/g, "")} Please remove the connector in Claude and add it again.</p></body></html>`);

export const oauthPublicRouter = express.Router();
const form = express.urlencoded({ extended: false, limit: "20kb" });

oauthPublicRouter.get("/.well-known/oauth-authorization-server", (_req, res) => res.json(serverMetadata(publicUrl())));
oauthPublicRouter.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"],
  (_req, res) => res.json(resourceMetadata(publicUrl())));

oauthPublicRouter.post("/oauth/register", wrap(async (req, res) => {
  if (await tooMany(`oauth-register:${req.ip}`, 30, 60 * 60 * 1000)) return tokenError(res, "slow_down", "Too many registrations. Please try again later.", 429);
  const { value, error } = readRegistration(req.body);
  if (error) return tokenError(res, "invalid_client_metadata", error);
  const clientId = randomId(24);
  await pool.query("INSERT INTO oauth_clients (client_id, name, redirect_uris) VALUES ($1,$2,$3)", [clientId, value.name, value.redirectUris]);
  res.status(201).set("Cache-Control", "no-store").json({
    client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: value.name, redirect_uris: value.redirectUris,
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
  });
}));

oauthPublicRouter.get("/oauth/authorize", wrap(async (req, res) => {
  const q = req.query || {};
  if (await tooMany(`oauth-authorize:${req.ip}`, 60, 10 * 60 * 1000)) return res.status(429).type("text").send("Too many sign-in attempts. Please wait a few minutes and try again.");
  const client = (await pool.query("SELECT client_id, name, redirect_uris FROM oauth_clients WHERE client_id=$1", [String(q.client_id || "")])).rows[0];
  const { value, error, fatal } = readAuthorize(q, client, publicUrl());
  if (fatal) return stopPage(res, error);
  if (error) return res.redirect(withParams(String(q.redirect_uri), { error, state: q.state, iss: publicUrl() }));
  const waiting = await pool.query("SELECT count(*)::int AS n FROM oauth_requests WHERE client_id=$1 AND email IS NULL AND expires_at > now()", [client.client_id]);
  if (waiting.rows[0].n >= MAX_PENDING_PER_CLIENT) return res.redirect(withParams(value.redirect, { error: "temporarily_unavailable", state: value.state, iss: publicUrl() }));
  const id = randomId(24);
  await pool.query(
    `INSERT INTO oauth_requests (id, client_id, redirect_uri, state, code_challenge, resource, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6, now() + $7 * interval '1 minute')`,
    [id, client.client_id, value.redirect, value.state, value.challenge, value.resource, REQUEST_MINUTES]);
  // The Allow page is a normal signed-in page: someone signed out signs in first and comes back to it (pages.js).
  res.redirect(`/app/connect/${id}`);
}));

oauthPublicRouter.post("/oauth/token", form, wrap(async (req, res) => {
  const b = req.body || {};
  if (await tooMany(`oauth-token:${req.ip}`, 120, 60 * 1000)) return tokenError(res, "slow_down", "Too many requests.", 429);
  if (b.grant_type === "authorization_code") {
    const used = await pool.query(
      `UPDATE oauth_requests SET used_at=now() WHERE code_hash=$1 AND used_at IS NULL AND expires_at > now() AND email IS NOT NULL
       RETURNING id, client_id, redirect_uri, code_challenge, resource, email`, [sha(b.code || "")]);
    const r = used.rows[0];
    if (!r) {
      // A code used a second time may have been stolen: the connection the first use made is ended (RFC 6749 4.1.2).
      const replay = (await pool.query("SELECT grant_id FROM oauth_requests WHERE code_hash=$1 AND used_at IS NOT NULL", [sha(b.code || "")])).rows[0];
      if (replay && replay.grant_id) await endGrant(pool, replay.grant_id);
      return tokenError(res, "invalid_grant", "The code is not valid, or was already used.");
    }
    if (r.client_id !== String(b.client_id || "") || r.redirect_uri !== String(b.redirect_uri || ""))
      return tokenError(res, "invalid_grant", "The code is not valid, or was already used.");
    if (!pkceMatches(b.code_verifier, r.code_challenge)) return tokenError(res, "invalid_grant", "The code verifier does not match.");
    if (!okResource(b.resource, publicUrl())) return tokenError(res, "invalid_target");
    const client = (await pool.query("SELECT name FROM oauth_clients WHERE client_id=$1", [r.client_id])).rows[0];
    const refresh = randomId();
    const { rows: [grant] } = await pool.query(
      `INSERT INTO oauth_grants (email, client_id, client_name, refresh_hash, expires_at, absolute_expires_at, last_used_at)
       VALUES ($1,$2,$3,$4, now() + $5 * interval '1 day', now() + $6 * interval '1 day', now()) RETURNING id, email, client_name`,
      [r.email, r.client_id, client ? client.name : "An app", sha(refresh), REFRESH_DAYS, MAX_GRANT_DAYS]);
    await pool.query("UPDATE oauth_requests SET grant_id=$2 WHERE id=$1", [r.id, grant.id]);
    return res.set("Cache-Control", "no-store").json(tokenAnswer(await accessTokenFor(pool, grant), refresh));
  }
  if (b.grant_type === "refresh_token") {
    // The refresh token is swapped for a new one each time (rotation); the old one stops working at once, and if it is ever
    // shown again (a stolen copy) the whole connection ends. A connection never outlives MAX_GRANT_DAYS.
    const next = randomId(), old = sha(b.refresh_token || "");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [grant] } = await client.query(
        `UPDATE oauth_grants g SET prev_refresh_hash=refresh_hash, refresh_hash=$2, last_used_at=now(),
                expires_at=LEAST(now() + $3 * interval '1 day', COALESCE(absolute_expires_at, now() + $3 * interval '1 day'))
          WHERE refresh_hash=$1 AND client_id=$4 AND revoked_at IS NULL AND expires_at > now()
            AND EXISTS (SELECT 1 FROM users u WHERE lower(u.email)=lower(g.email) AND NOT u.login_blocked)
          RETURNING id, email, client_name`, [old, sha(next), REFRESH_DAYS, String(b.client_id || "")]);
      if (!grant) {
        const reused = (await client.query("SELECT id FROM oauth_grants WHERE prev_refresh_hash=$1 AND revoked_at IS NULL", [old])).rows[0];
        if (reused) await endGrant(client, reused.id);
        await client.query("COMMIT");
        return tokenError(res, "invalid_grant", "Please connect again.");
      }
      const access = await accessTokenFor(client, grant);
      await client.query("COMMIT");
      return res.set("Cache-Control", "no-store").json(tokenAnswer(access, next));
    } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
  }
  return tokenError(res, "unsupported_grant_type");
}));

// RFC 7009: revoking a refresh token ends the connection; revoking an access token ends that token. Always answers 200.
oauthPublicRouter.post("/oauth/revoke", form, wrap(async (req, res) => {
  const t = String((req.body || {}).token || "");
  if (t) {
    const g = await pool.query("SELECT id FROM oauth_grants WHERE refresh_hash=$1 AND revoked_at IS NULL", [sha(t)]);
    if (g.rows[0]) await endGrant(pool, g.rows[0].id);
    else await pool.query("UPDATE access_keys SET revoked_at=now() WHERE key_hash=$1 AND kind='oauth' AND revoked_at IS NULL", [sha(t)]);
  }
  res.set("Cache-Control", "no-store").json({});
}));

/* ---------- signed in through the browser: the Allow page and the connected apps ---------- */
export const oauthAccountRouter = express.Router();
oauthAccountRouter.use(requireAuth);

const pending = async (id) => (await pool.query(
  `SELECT r.id, r.client_id, r.redirect_uri, r.state, c.name AS client_name FROM oauth_requests r JOIN oauth_clients c ON c.client_id=r.client_id
    WHERE r.id=$1 AND r.email IS NULL AND r.expires_at > now()`, [String(id)])).rows[0];
const gone = (res) => res.status(404).json({ error: "This connection request has ended. Please start connecting again from Claude." });

oauthAccountRouter.get("/requests/:id", wrap(async (req, res) => {
  const r = await pending(req.params.id);
  if (!r) return gone(res);
  let host = "";
  try { host = new URL(r.redirect_uri).host; } catch { /* registered addresses are valid URLs */ }
  res.json({ clientName: r.client_name, returnsTo: host, freshSignIn: freshSignIn(req), freshMinutes: FRESH_MINUTES, email: me(req) });
}));

oauthAccountRouter.post("/requests/:id/approve", wrap(async (req, res) => {
  // Connecting gives an app months of access, so it needs a recent sign-in, as making an access key does.
  if (!freshSignIn(req)) return res.status(403).json({ error: `Please sign in again to connect, within ${FRESH_MINUTES} minutes.`, needsFreshSignIn: true });
  const code = randomId();
  const { rows: [r] } = await pool.query(
    `UPDATE oauth_requests r SET email=$2, code_hash=$3, expires_at=now() + $4 * interval '1 second'
      FROM oauth_clients c WHERE c.client_id=r.client_id AND r.id=$1 AND r.email IS NULL AND r.expires_at > now()
      RETURNING r.redirect_uri, r.state, c.name AS client_name`, [String(req.params.id), me(req), sha(code), CODE_SECONDS]);
  if (!r) return gone(res);
  await audit(`Connected "${r.client_name}" to ${PRODUCT} through the connector`, me(req));
  res.json({ redirect: withParams(r.redirect_uri, { code, state: r.state, iss: publicUrl() }) });
}));

oauthAccountRouter.post("/requests/:id/deny", wrap(async (req, res) => {
  const { rows: [r] } = await pool.query("DELETE FROM oauth_requests WHERE id=$1 AND email IS NULL RETURNING redirect_uri, state", [String(req.params.id)]);
  if (!r) return gone(res);
  res.json({ redirect: withParams(r.redirect_uri, { error: "access_denied", state: r.state, iss: publicUrl() }) });
}));

oauthAccountRouter.get("/grants", wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, client_name, created_at, last_used_at FROM oauth_grants
      WHERE lower(email)=$1 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 20`, [me(req)]);
  res.json({ grants: rows.map((g) => ({ id: g.id, name: g.client_name, createdAt: g.created_at, lastUsedAt: g.last_used_at })) });
}));

oauthAccountRouter.delete("/grants/:id", wrap(async (req, res) => {
  const { rows: [g] } = await pool.query(
    "SELECT id, client_name FROM oauth_grants WHERE id=$1 AND lower(email)=$2 AND revoked_at IS NULL", [Number(req.params.id) || 0, me(req)]);
  if (!g) return res.status(404).json({ error: "That connection was not found, or it was already ended." });
  await endGrant(pool, g.id);
  await audit(`Disconnected "${g.client_name}" from ${PRODUCT}`, me(req));
  res.json({ ok: true });
}));
