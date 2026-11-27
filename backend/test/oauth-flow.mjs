/*
 * The Wohlig One connector for Claude, end to end, against a LOCAL server and database (never the shared one): does what Claude
 * does (discovery, registration, authorize with PKCE, the Allow page, the code swap, MCP calls, refresh, disconnect) and checks
 * every refusal on the way. Read-only MCP calls only. It cleans up its own sessions, clients, requests, grants and tokens.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/oauth-flow.mjs
 *
 * Not part of `npm test` (it needs the database and a running server), like access-keys-flow.mjs.
 */
import crypto from "node:crypto";
import pg from "pg";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: BASE must be a local server."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const person = (await one("SELECT lower(email) AS e FROM users WHERE is_super_admin AND NOT login_blocked LIMIT 1"))?.e;
if (!person) { console.error("No super admin login in the local database."); process.exit(2); }

const session = async (minutesAgo) => {
  const t = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at, created_at) VALUES ($1,$2, now() + interval '1 hour', now() - $3 * interval '1 minute')", [sha(t), person, minutesAgo]);
  return t;
};
const fresh = await session(0), stale = await session(120);
const started = new Date();
const REDIRECT = "http://localhost:9999/callback";
const http = async (method, path, { headers = {}, json, form } = {}) => {
  const r = await fetch(BASE + path, { method, redirect: "manual",
    headers: { ...headers, ...(json ? { "Content-Type": "application/json" } : form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: json ? JSON.stringify(json) : form ? new URLSearchParams(form).toString() : undefined });
  let data = null; try { data = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, data, location: r.headers.get("location"), headers: r.headers };
};
const cookie = (t) => ({ Cookie: `sid=${t}` });
let failed = 0, clientId = null;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };

try {
  // Discovery, as Claude finds it from the 401 on /mcp.
  const unsigned = await http("POST", "/mcp", { json: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  check(unsigned.status === 401 && /resource_metadata=/.test(unsigned.headers.get("www-authenticate") || ""), "/mcp without a token says where to sign in");
  const prm = await http("GET", "/.well-known/oauth-protected-resource/mcp");
  const asm = await http("GET", "/.well-known/oauth-authorization-server");
  check(prm.data?.resource === `${BASE}/mcp` && asm.data?.code_challenge_methods_supported?.includes("S256"), "discovery documents describe the server");

  // Registration: https or localhost only.
  check((await http("POST", "/oauth/register", { json: { redirect_uris: ["http://evil.example/cb"] } })).status === 400, "an http redirect to another host is refused");
  check((await http("POST", "/oauth/register", { json: { client_name: "Claude", redirect_uris: ["https://claude-ai.evil.example/cb"] } })).status === 400, "a look-alike https host cannot register");
  const reg = await http("POST", "/oauth/register", { json: { client_name: "Flow test app", redirect_uris: [REDIRECT] } });
  check(reg.status === 201 && reg.data.client_id, "an app registers itself");
  clientId = reg.data.client_id;

  // Authorize with PKCE.
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const q = (o) => "/oauth/authorize?" + new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge,
    code_challenge_method: "S256", state: "xyz", resource: `${BASE}/mcp`, scope: "wohlig", ...o });
  const badRedirect = await http("GET", q({ redirect_uri: "http://localhost:9999/other" }));
  check(badRedirect.status === 400 && !badRedirect.location, "an unregistered return address is stopped, not redirected");
  const noPkce = await http("GET", q({ code_challenge_method: "plain" }));
  check(noPkce.status === 302 && noPkce.location.startsWith(REDIRECT) && /error=invalid_request/.test(noPkce.location), "a request without S256 goes back with an error");
  const auth = await http("GET", q({}));
  const id = (/\/app\/connect\/([\w-]+)$/.exec(auth.location || "") || [])[1];
  check(auth.status === 302 && !!id, "authorize opens the Allow page");

  // The Allow page.
  const info = await http("GET", `/api/oauth/requests/${id}`, { headers: cookie(fresh) });
  check(info.status === 200 && info.data.clientName === "Flow test app" && info.data.returnsTo === "localhost:9999", "the Allow page shows the app and where it returns");
  const oldSignIn = await http("POST", `/api/oauth/requests/${id}/approve`, { headers: cookie(stale) });
  check(oldSignIn.status === 403 && oldSignIn.data?.needsFreshSignIn, "a sign-in older than 30 minutes cannot allow");
  const allowed = await http("POST", `/api/oauth/requests/${id}/approve`, { headers: cookie(fresh) });
  const back = new URL(allowed.data?.redirect || "http://x");
  const code = back.searchParams.get("code");
  check(allowed.status === 200 && back.origin + back.pathname === REDIRECT && back.searchParams.get("state") === "xyz" && !!code, "allowing returns a code and the state");
  check((await http("POST", `/api/oauth/requests/${id}/approve`, { headers: cookie(fresh) })).status === 404, "a request is allowed once");

  // The code swap.
  const swap = (o) => http("POST", "/oauth/token", { form: { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier, ...o } });
  check((await swap({ code_verifier: crypto.randomBytes(48).toString("base64url") })).data?.error === "invalid_grant", "a wrong code verifier is refused (and spends the code)");
  // A fresh request, since the code above is now spent.
  const auth2 = await http("GET", q({}));
  const id2 = /\/app\/connect\/([\w-]+)$/.exec(auth2.location)[1];
  const code2 = new URL((await http("POST", `/api/oauth/requests/${id2}/approve`, { headers: cookie(fresh) })).data.redirect).searchParams.get("code");
  const tok = await http("POST", "/oauth/token", { form: { grant_type: "authorization_code", code: code2, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier } });
  check(tok.status === 200 && /^wo1_/.test(tok.data.access_token) && tok.data.refresh_token && tok.data.expires_in === 3600 && tok.headers.get("cache-control") === "no-store", "the code swaps for an access token and a refresh token");
  const again = await http("POST", "/oauth/token", { form: { grant_type: "authorization_code", code: code2, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier } });
  check(again.data?.error === "invalid_grant", "a code works once");
  check((await http("POST", "/mcp", { headers: { Authorization: `Bearer ${tok.data.access_token}` }, json: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).status === 401, "a replayed code ends the connection it made");
  const life = await one("SELECT round(extract(epoch FROM absolute_expires_at - created_at) / 86400) AS d FROM oauth_grants WHERE client_id=$1 ORDER BY id DESC LIMIT 1", [clientId]);
  check(Number(life?.d) === 90, "a connection ends after 90 days at most");

  // A clean connection for the rest.
  const connect = async () => {
    const a = await http("GET", q({}));
    const rid = /\/app\/connect\/([\w-]+)$/.exec(a.location)[1];
    const c = new URL((await http("POST", `/api/oauth/requests/${rid}/approve`, { headers: cookie(fresh) })).data.redirect).searchParams.get("code");
    return (await http("POST", "/oauth/token", { form: { grant_type: "authorization_code", code: c, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier } })).data;
  };
  const t3 = await connect();
  const access = t3.access_token, refresh = t3.refresh_token;

  // MCP, as Claude calls it.
  const mcp = new Client({ name: "oauth-flow", version: "1" });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${access}` } } }));
  const { tools } = await mcp.listTools();
  check(tools.length >= 50, `the connector lists ${tools.length} tools`);
  const text = (r) => (r.content || []).map((c) => c.text || "").join("");
  for (const [name, args] of [["wohlig_whoami", {}], ["wohlig_dashboard", {}], ["wohlig_todo", {}], ["wohlig_list_employees", { limit: 3 }], ["wohlig_leave", {}],
    ["wohlig_offboarding", {}], ["wohlig_list_endpoints", { area: "leave" }]]) {
    const r = await mcp.callTool({ name, arguments: args });
    check(!r.isError, `${name} works through the connector`);
  }
  const who = JSON.parse(text(await mcp.callTool({ name: "wohlig_whoami", arguments: {} })));
  check(who.email.toLowerCase() === person && !Object.keys(who.access || {}).some((k) => k.startsWith("payroll.")), "the connector acts as the person, with no salary permission");
  const pay = await mcp.callTool({ name: "wohlig_api_get", arguments: { path: "/api/payroll" } });
  check(pay.isError && /cannot be used/.test(text(pay)), "payroll is refused through the connector");
  const leave = JSON.parse(text(await mcp.callTool({ name: "wohlig_leave", arguments: {} })).split("\n\nShowing")[0]);
  check((leave.pay || []).every((p) => p.monthlyGross === null), "leave data through the connector carries no salary");
  await mcp.close();
  check((await http("GET", "/api/oauth/grants", { headers: { Authorization: `Bearer ${access}` } })).status === 403, "a connector token cannot see or end connections");

  // Refresh rotates.
  const ref = await http("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: refresh, client_id: clientId } });
  check(ref.status === 200 && ref.data.refresh_token !== refresh && /^wo1_/.test(ref.data.access_token), "a refresh gives new tokens");
  check((await http("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: refresh, client_id: clientId } })).data?.error === "invalid_grant", "the old refresh token no longer works");
  check((await http("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: ref.data.refresh_token, client_id: clientId } })).data?.error === "invalid_grant", "and showing the old one again ends the connection, so even the new one stops");

  // A stale token sent along to the token endpoint is not refused; and a fresh connection for Account.
  const t4 = await connect();
  const staleSend = await http("POST", "/oauth/token", { headers: { Authorization: `Bearer ${access}` }, form: { grant_type: "refresh_token", refresh_token: t4.refresh_token, client_id: clientId } });
  check(staleSend.status === 200, "a client that sends its old token to the token endpoint still refreshes");
  const latest = staleSend.data;

  // Account > Connected apps, and Disconnect.
  const grants = await http("GET", "/api/oauth/grants", { headers: cookie(fresh) });
  const g = (grants.data?.grants || []).find((x) => x.name === "Flow test app" && new Date(x.lastUsedAt) > started);
  check(!!g, "the app shows under Connected apps");
  check((await http("DELETE", `/api/oauth/grants/${g.id}`, { headers: cookie(fresh) })).status === 200, "the person disconnects it");
  check((await http("POST", "/mcp", { headers: { Authorization: `Bearer ${latest.access_token}` }, json: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).status === 401, "its access token stops at once");
  check((await http("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: latest.refresh_token, client_id: clientId } })).data?.error === "invalid_grant", "and it cannot refresh");
  check(!!(await one("SELECT 1 FROM audit_log WHERE work_email=$1 AND action LIKE 'Connected \"Flow test app\"%' AND ts >= $2", [person, started])), "connecting is in the audit log");
} finally {
  if (clientId) {
    const grants = (await db.query("SELECT id FROM oauth_grants WHERE client_id=$1", [clientId])).rows.map((r) => r.id);
    if (grants.length) await db.query("DELETE FROM access_keys WHERE grant_id = ANY($1)", [grants]);
    await db.query("DELETE FROM oauth_grants WHERE client_id=$1", [clientId]);
    await db.query("DELETE FROM oauth_requests WHERE client_id=$1", [clientId]);
    await db.query("DELETE FROM oauth_clients WHERE client_id=$1", [clientId]);
  }
  await db.query("DELETE FROM sessions WHERE token_hash = ANY($1)", [[sha(fresh), sha(stale)]]);
  await db.query("DELETE FROM audit_log WHERE work_email=$1 AND ts >= $2 AND action LIKE '%Flow test app%'", [person, started]);
  await db.end();
}
console.log(failed ? `\n${failed} check(s) failed` : "\nAll connector checks passed");
process.exit(failed ? 1 : 0);
