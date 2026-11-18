// The same-origin check on changes (security.js): pages on other websites are refused, the portal's own pages,
// the office device and scripts are let through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sameOriginWrites, securityHeaders } from "../src/security.js";

function run(method, headers, env = {}) {
  const saved = { PUBLIC_URL: process.env.PUBLIC_URL, FRONTEND_URL: process.env.FRONTEND_URL };
  Object.assign(process.env, { PUBLIC_URL: "", FRONTEND_URL: "", ...env });
  const h = Object.fromEntries(Object.entries({ host: "hr.wohlig.com", ...headers }).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { method, protocol: "http", get: (k) => h[k.toLowerCase()] };
  let status = 0, passed = false;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  sameOriginWrites(req, res, () => { passed = true; });
  Object.assign(process.env, saved);
  return passed ? "pass" : status;
}

test("reading is never blocked", () => {
  assert.equal(run("GET", { origin: "https://evil.example" }), "pass");
});
test("a change from another website is refused", () => {
  assert.equal(run("POST", { origin: "https://evil.example" }), 403);
  assert.equal(run("PUT", { referer: "https://evil.example/page" }), 403);
  assert.equal(run("DELETE", { origin: "null" }), 403);
});
test("a change from the portal's own page passes, also behind an HTTPS proxy", () => {
  assert.equal(run("POST", { origin: "http://hr.wohlig.com" }), "pass");
  assert.equal(run("POST", { origin: "https://hr.wohlig.com" }), "pass");
  assert.equal(run("POST", { referer: "https://hr.wohlig.com/app/leave" }), "pass");
});
test("PUBLIC_URL is accepted when the request arrives on another host name", () => {
  assert.equal(run("POST", { host: "backend:3000", origin: "https://hr.wohlig.com" }, { PUBLIC_URL: "https://hr.wohlig.com" }), "pass");
  assert.equal(run("POST", { host: "backend:3000", origin: "https://hr.wohlig.com" }), 403);
});
test("the office device and scripts (no browser headers) pass", () => {
  assert.equal(run("POST", {}), "pass");
});
test("every answer carries the security headers", () => {
  const set = {};
  securityHeaders({}, { set: (o) => Object.assign(set, o) }, () => {});
  assert.equal(set["X-Content-Type-Options"], "nosniff");
  assert.equal(set["X-Frame-Options"], "SAMEORIGIN");
});
