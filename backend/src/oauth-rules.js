// The Wohlig One connector's sign-in for Claude (OAuth 2.1 with PKCE), the rules without the database (test/oauth.test.mjs).
// Routes in oauth.js; the design is in docs/MCP_CONNECTOR.md.
import crypto from "node:crypto";
import { PRODUCT } from "./brand.js";

export const ACCESS_TOKEN_MINUTES = 60;        // an access token is a short-lived access key (access_keys, kind 'oauth')
export const REFRESH_DAYS = 30;                // a connection stays signed in while used at least once a month
export const REQUEST_MINUTES = 10;             // time to sign in and allow
export const CODE_SECONDS = 60;                // a one-time code, once allowed, must be swapped within a minute
export const MAX_GRANT_DAYS = 90;              // every connection ends after 90 days at most; the person then allows it again
export const MAX_PENDING_PER_CLIENT = 50;      // sign-ins in progress per app
export const REFRESH_GRACE_SECONDS = 60;       // two refreshes at once with the same token both succeed (a benign race)
export const SCOPE = "wohlig";

/**
 * The hosts an app may send people back to over https: Claude's own (claude.ai and claude.com, as used by Claude on the web and
 * Claude Desktop), plus any named in CONNECTOR_REDIRECT_HOSTS (comma separated). Anything else could catch the one-time code on a
 * look-alike page, so it cannot register at all. http is allowed only to this computer (Claude Code listens on localhost).
 */
export function redirectHosts() {
  const extra = String(process.env.CONNECTOR_REDIRECT_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return ["claude.ai", "claude.com", ...extra];
}

export const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
export const randomId = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

/** A redirect address a client may register: https to a host in redirectHosts(), or http to this computer. No fragment or credentials. */
export function okRedirect(uri) {
  let u;
  try { u = new URL(String(uri)); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return redirectHosts().includes(u.hostname.toLowerCase()) && !u.port;
  return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}

/** Checks a dynamic client registration (RFC 7591). Returns { value: { name, redirectUris } } or { error }. */
export function readRegistration(body) {
  const b = body || {};
  const uris = Array.isArray(b.redirect_uris) ? [...new Set(b.redirect_uris.map(String))] : [];
  if (!uris.length) return { error: "redirect_uris is required." };
  if (uris.length > 10) return { error: "At most 10 redirect_uris." };
  if (!uris.every(okRedirect)) return { error: `Each redirect_uri must be https on ${redirectHosts().join(", ")}, or http on localhost.` };
  if (uris.some((u) => u.length > 500)) return { error: "A redirect_uri is too long." };
  // Whatever method the client asks for (claude.ai may ask for client_secret_post), it is registered as a public client with PKCE:
  // the answer says token_endpoint_auth_method "none" and gives no secret (RFC 7591 3.2.1 lets the server choose).
  const name = cleanName(b.client_name);
  return { value: { name, redirectUris: uris } };
}

/** An app's name as people see it (Allow page, Account, audit log): no control or direction characters, no quotes, 60 characters. */
export function cleanName(raw) {
  return String(raw || "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069"`<>]/g, "")
    .trim().replace(/\s+/g, " ").slice(0, 60) || "An app";
}

/** The PKCE check (S256 only): the verifier the client sends back must hash to the challenge it sent first. */
export function pkceMatches(verifier, challenge) {
  const v = String(verifier || "");
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(v)) return false;
  const want = crypto.createHash("sha256").update(v).digest("base64url");
  const a = Buffer.from(want), b = Buffer.from(String(challenge || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The resource a token is for, when the client names one (RFC 8707): this portal's /mcp, with or without a trailing slash. */
export function okResource(resource, base) {
  if (resource === undefined || resource === null || resource === "") return true;
  const clean = (s) => String(s).replace(/\/+$/, "");
  return clean(resource) === clean(`${base}/mcp`) || clean(resource) === clean(base);
}

/** Checks the parts of an authorization request that come from the client. Returns { value } or { error, fatal }. */
export function readAuthorize(q, client, base) {
  const redirect = String(q.redirect_uri || "");
  // Without a known client and one of its own redirect addresses, nothing is sent anywhere (fatal: shown on the page).
  if (!client) return { error: `This app is not registered with ${PRODUCT}.`, fatal: true };
  if (!client.redirect_uris.includes(redirect)) return { error: "This app asked to return to an address it did not register.", fatal: true };
  if (q.response_type !== "code") return { error: "unsupported_response_type" };
  if (q.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(String(q.code_challenge || ""))) return { error: "invalid_request" };
  if (!okResource(q.resource, base)) return { error: "invalid_target" };
  if (q.state !== undefined && String(q.state).length > 1000) return { error: "invalid_request" };
  const state = q.state === undefined ? null : String(q.state);
  return { value: { redirect, state, challenge: String(q.code_challenge), resource: q.resource ? String(q.resource) : null } };
}

/** Adds query parameters to a redirect address, keeping those it already has. */
export function withParams(uri, params) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/** The discovery documents (RFC 8414 and RFC 9728). */
export function serverMetadata(base) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  };
}
export function resourceMetadata(base) {
  return { resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ["header"], scopes_supported: [SCOPE],
    resource_name: PRODUCT };
}
