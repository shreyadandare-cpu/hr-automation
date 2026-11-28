import { test } from "node:test";
import assert from "node:assert/strict";
import { KEY_PATTERN, hashKey, keyFromHeader, keyMayReach, newKey, readKeyForm, scrubForKey } from "../src/access-keys-rules.js";
import { decide, salaryOwners, scopeFor, summary } from "../src/access-rules.js";

test("a new key has the wo1_ form, a stable hash and a short hint, and is different every time", () => {
  const a = newKey(), b = newKey();
  assert.match(a.secret, KEY_PATTERN);
  assert.notEqual(a.secret, b.secret);
  assert.equal(a.hash, hashKey(a.secret));
  assert.equal(a.hash.length, 64);
  assert.equal(a.hint, a.secret.slice(0, 10));
  assert.ok(!a.hint.includes(a.secret.slice(10)), "the hint never holds the whole key");
});

test("only a well-formed Bearer key is read from the header", () => {
  const { secret } = newKey();
  assert.equal(keyFromHeader(`Bearer ${secret}`), secret);
  assert.equal(keyFromHeader(`bearer ${secret}  `), secret);
  assert.equal(keyFromHeader(secret), null);
  assert.equal(keyFromHeader("Bearer abc"), null);
  assert.equal(keyFromHeader(`Basic ${secret}`), null);
  assert.equal(keyFromHeader(undefined), null);
});

test("the key form needs a name and allows 1 to 365 days, 90 by default", () => {
  assert.deepEqual(readKeyForm({ name: "  My  laptop " }).value, { name: "My laptop", days: 90 });
  assert.equal(readKeyForm({ name: "x", days: 365 }).value.days, 365);
  assert.ok(readKeyForm({}).errors.name);
  assert.ok(readKeyForm({ name: "x".repeat(61) }).errors.name);
  assert.ok(readKeyForm({ name: "x", days: 0 }).errors.days);
  assert.ok(readKeyForm({ name: "x", days: 366 }).errors.days);
  assert.ok(readKeyForm({ name: "x", days: 1.5 }).errors.days);
});

test("a key reaches the HR dashboard's endpoints", () => {
  for (const p of ["/api/me", "/api/roster", "/api/leave", "/api/leave/today", "/api/leave/requests/12/decision", "/api/attendance/report",
    "/api/attendance/day", "/api/hr/probations", "/api/hr/openings/3/candidates", "/api/tickets/9/reply", "/api/onboarding", "/api/offboarding",
    "/api/posts", "/api/notifications", "/api/audit", "/api/users", "/api/report-builder/run", "/api/requests/attendance", "/api/employees/manager",
    "/api/leave/policy", "/api/hr/candidates/4/interviews"]) assert.equal(keyMayReach(p), true, p);
});

test("a key never reaches salaries, payments, tax, documents, access rights or sign-in", () => {
  for (const p of ["/api/payroll", "/api/payroll/runs", "/api/payslips", "/api/payslips/2026-10/pdf", "/api/finance/journal", "/api/reimbursements",
    "/api/loans/3", "/api/budget-requests", "/api/advances", "/api/advances/mine", "/api/tax-declaration", "/api/tax-declarations/a@wohlig.com/proofs/0/file",
    "/api/requests/advance", "/api/requests/advance/4/decide", "/api/leave/salary-cuts", "/api/tools/costs", "/api/hr/offers/2/pdf",
    "/api/hr/candidates/7/offers", "/api/documents", "/api/document-password/unlock", "/api/employees/ids/reveal", "/api/employees/export",
    "/api/employees/a@wohlig.com/pay", "/api/offboarding/5/clearance", "/api/offboarding/5/clearance/advances", "/api/offboarding/clearance/preview",
    "/api/access/grants", "/api/access-keys", "/api/passkeys", "/api/password", "/api/logout", "/api/attendance/punch",
    "/api/attendance/punch/challenge"]) assert.equal(keyMayReach(p), false, p);
});

test("the block cannot be stepped around with case, slashes, encoding or paths outside /api", () => {
  for (const p of ["/API/Payroll", "//api//payroll", "/api/payroll/", "/api/pay%72oll", "/api/x/../payroll", "/api/payroll?x=1", "/app/dashboard",
    "/", "/login", "/apix/payroll", "/api/employees/a%40wohlig.com/pay"]) assert.equal(keyMayReach(p), false, p);
  assert.equal(keyMayReach("/api/payrollish"), true, "a different word that starts the same is not blocked");
});

test("a key reads logins but never changes them, makes no Google account and adds no punch of its own", () => {
  assert.equal(keyMayReach("/api/users", "GET"), true);
  for (const [m, p] of [["POST", "/api/users"], ["POST", "/api/users/a@wohlig.com/reset"], ["PUT", "/api/users/a@wohlig.com/role"],
    ["PUT", "/api/users/default-password"], ["DELETE", "/api/users/a@wohlig.com"], ["POST", "/api/onboarding/work-email"],
    ["POST", "/api/requests/attendance"], ["post", "/API/Users/x/reset"]]) assert.equal(keyMayReach(p, m), false, `${m} ${p}`);
  assert.equal(keyMayReach("/api/requests/attendance", "GET"), true, "attendance requests can be listed");
  assert.equal(keyMayReach("/api/requests/attendance/4/decide", "POST"), true, "and decided");
  assert.equal(keyMayReach("/api/onboarding", "POST"), true);
});

test("an encoded slash, backslash or NUL is refused outright", () => {
  for (const p of ["/api/employees/a%2fb/pay", "/api/leave%2F..%2Fpayroll", "/api/x%5cpayroll", "/api/leave%00"]) assert.equal(keyMayReach(p), false, p);
});

test("through a key, even a salary owner holds no salary permission", () => {
  const owner = salaryOwners()[0];
  const tree = () => new Set();
  const browser = { email: owner, superAdmin: true, grants: [] };
  const key = { ...browser, viaKey: true };
  assert.equal(decide(browser, "payroll.view", null, tree), true);
  assert.equal(decide(key, "payroll.view", null, tree), false);
  assert.equal(decide(key, "expenses.approve", null, tree), false);
  assert.deepEqual([...scopeFor(key, "payroll.view", tree)], []);
  assert.equal(decide(key, "leave.approve", null, tree), true, "other permissions are unchanged");
  assert.ok(!("payroll.view" in summary(key)));
  assert.ok("payroll.view" in summary(browser));
});

test("every answer to a key loses ID numbers, bank details, the PF number and pay, at any depth", () => {
  const onboarding = [{ email: "a@wohlig.com", name: "Asha", ids: { dob: "1990-01-01", aadhaar: "XXXX XXXX 1234", pan: "XXXXX1234X", acct: "XXXX5678", ifsc: "HDFC0001" } }];
  assert.deepEqual(scrubForKey(onboarding), [{ email: "a@wohlig.com", name: "Asha", ids: { dob: "1990-01-01" } }]);
  assert.deepEqual(scrubForKey({ ids: { pan: "x", aadhaar: "y" }, primary: { name: "A" } }), { ids: {}, primary: { name: "A" } });
  assert.deepEqual(scrubForKey({ pay: [{ email: "a", monthlyGross: 5, casualOpening: 2 }] }), { pay: [{ email: "a", casualOpening: 2 }] });
  assert.deepEqual(scrubForKey({ pfNumber: "MH/1", uan: "1", account: "kept", panel: "kept" }), { account: "kept", panel: "kept" });
  assert.equal(scrubForKey(null), null);
  assert.equal(scrubForKey("text"), "text");
  assert.deepEqual(scrubForKey([1, "a", [{ ifsc: "x" }]]), [1, "a", [{}]]);
});

test("the employee details sheet is out of reach for a key", () => {
  for (const [m, p] of [["GET", "/api/onboarding/import/template"], ["POST", "/api/onboarding/import/preview"], ["POST", "/api/onboarding/import/apply"]])
    assert.equal(keyMayReach(p, m), false, `${m} ${p}`);
  assert.equal(keyMayReach("/api/onboarding", "GET"), true, "the joiners list itself stays (its IDs are removed)");
});
