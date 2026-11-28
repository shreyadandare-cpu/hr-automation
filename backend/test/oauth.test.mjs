import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { cleanName, okRedirect, okResource, pkceMatches, readAuthorize, readRegistration, resourceMetadata, serverMetadata, withParams } from "../src/oauth-rules.js";
import { keyMayReach } from "../src/access-keys-rules.js";

test("an app may return to https, or to http on this computer only", () => {
  for (const u of ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback", "http://localhost:6274/callback", "http://127.0.0.1:33418/cb"]) assert.equal(okRedirect(u), true, u);
  for (const u of ["https://evil.example/cb", "https://claude.ai.evil.example/cb", "https://claude.ai:8443/cb", "http://evil.example/cb", "javascript:alert(1)", "https://claude.ai/cb#x", "https://u:p@claude.ai/cb", "not a url", "ftp://x/y"]) assert.equal(okRedirect(u), false, u);
});

test("registration needs return addresses, takes public clients only, and names the app", () => {
  assert.deepEqual(readRegistration({ client_name: "  Claude  ", redirect_uris: ["https://claude.ai/cb", "https://claude.ai/cb"] }).value, { name: "Claude", redirectUris: ["https://claude.ai/cb"] });
  assert.ok(readRegistration({ client_name: "Claude", redirect_uris: ["https://claude-ai.evil.example/cb"] }).error, "a look-alike host cannot register");
  assert.equal(readRegistration({ redirect_uris: ["https://claude.ai/cb"] }).value.name, "An app");
  assert.ok(readRegistration({}).error);
  assert.ok(readRegistration({ redirect_uris: ["http://evil.example/cb"] }).error);
  assert.ok(!readRegistration({ redirect_uris: ["https://claude.ai/cb"], token_endpoint_auth_method: "client_secret_post", scope: "claudeai" }).error,
    "a client that asks for a secret method is still registered (as a public client)");
});

test("app names lose control, direction and quote characters", () => {
  assert.equal(cleanName('Cl\u202Eaude "x"\n'), "Claude x");
  assert.equal(cleanName(""), "An app");
  assert.equal(cleanName("a".repeat(100)).length, 60);
});

test("extra return hosts can be named in CONNECTOR_REDIRECT_HOSTS", () => {
  process.env.CONNECTOR_REDIRECT_HOSTS = "mcp.example.org";
  assert.equal(okRedirect("https://mcp.example.org/cb"), true);
  delete process.env.CONNECTOR_REDIRECT_HOSTS;
  assert.equal(okRedirect("https://mcp.example.org/cb"), false);
});

test("PKCE: only the verifier that hashes to the challenge passes", () => {
  const v = crypto.randomBytes(40).toString("base64url");
  const c = crypto.createHash("sha256").update(v).digest("base64url");
  assert.equal(pkceMatches(v, c), true);
  assert.equal(pkceMatches(v + "x", c), false);
  assert.equal(pkceMatches("short", c), false);
  assert.equal(pkceMatches(v, ""), false);
});

test("authorize: an unknown app or address stops there; other mistakes go back to the app", () => {
  const base = "https://one.wohlig.com", client = { client_id: "c", redirect_uris: ["https://claude.ai/cb"] };
  const ok = { response_type: "code", redirect_uri: "https://claude.ai/cb", code_challenge_method: "S256", code_challenge: "a".repeat(43), state: "s" };
  assert.equal(readAuthorize(ok, null, base).fatal, true);
  assert.equal(readAuthorize({ ...ok, redirect_uri: "https://claude.ai/other" }, client, base).fatal, true);
  assert.equal(readAuthorize({ ...ok, response_type: "token" }, client, base).error, "unsupported_response_type");
  assert.equal(readAuthorize({ ...ok, code_challenge_method: "plain" }, client, base).error, "invalid_request");
  assert.equal(readAuthorize({ ...ok, resource: "https://other.example/mcp" }, client, base).error, "invalid_target");
  assert.deepEqual(readAuthorize({ ...ok, resource: "https://one.wohlig.com/mcp/" }, client, base).value.state, "s");
  assert.equal(okResource(undefined, base), true);
  assert.equal(readAuthorize({ ...ok, state: "s".repeat(1001) }, client, base).error, "invalid_request", "a state too long is refused, never cut");
  assert.equal(readAuthorize({ ...ok, state: "s".repeat(1000) }, client, base).value.state.length, 1000);
});

test("discovery documents point at this portal, and return addresses keep their own query", () => {
  const m = serverMetadata("https://one.wohlig.com");
  assert.equal(m.token_endpoint, "https://one.wohlig.com/oauth/token");
  assert.deepEqual(m.code_challenge_methods_supported, ["S256"]);
  assert.equal(resourceMetadata("https://one.wohlig.com").resource, "https://one.wohlig.com/mcp");
  assert.equal(withParams("https://claude.ai/cb?a=1", { code: "x", state: null }), "https://claude.ai/cb?a=1&code=x");
});

test("a token reaches /mcp but not the connection pages", () => {
  assert.equal(keyMayReach("/mcp", "POST"), true);
  assert.equal(keyMayReach("/api/oauth/grants"), false);
  assert.equal(keyMayReach("/api/oauth/requests/x/approve", "POST"), false);
  assert.equal(keyMayReach("/oauth/token", "POST"), true, "a stale token sent to the token endpoint is not refused");
  assert.equal(keyMayReach("/oauth/authorize"), false);
});
