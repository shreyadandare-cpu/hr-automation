import { test } from "node:test";
import assert from "node:assert/strict";
import { FIRST_SUPER_ADMINS, PERM, PERMISSIONS, PRESETS, SALARY_PERMS, decide, salaryOwners, grantsFromRoles, liveGrants, mayDecideOn, readGrant, scopeFor, subtree, summary } from "../src/access-rules.js";

// Chintan > Jagruti > Pratik > Asha ; Jagruti > Osama ; Chirag > Raj
const people = [
  { email: "jagruti@wohlig.com", managerEmail: "chintan@wohlig.com" },
  { email: "pratik.sawant@wohlig.com", managerEmail: "jagruti@wohlig.com" },
  { email: "asha@wohlig.com", managerEmail: "pratik.sawant@wohlig.com" },
  { email: "osama@wohlig.com", managerEmail: "jagruti@wohlig.com" },
  { email: "raj@wohlig.com", managerEmail: "chirag@wohlig.com" },
];
const treeOf = (root) => subtree(people, root);

test("the reporting tree reaches every level below a person, never the person, and survives a loop", () => {
  assert.deepEqual([...treeOf("chintan@wohlig.com")].sort(), ["asha@wohlig.com", "jagruti@wohlig.com", "osama@wohlig.com", "pratik.sawant@wohlig.com"]);
  assert.deepEqual([...treeOf("JAGRUTI@wohlig.com")].sort(), ["asha@wohlig.com", "osama@wohlig.com", "pratik.sawant@wohlig.com"]);
  assert.equal(treeOf("asha@wohlig.com").size, 0);
  const loop = subtree([{ email: "a@x.com", managerEmail: "b@x.com" }, { email: "b@x.com", managerEmail: "a@x.com" }], "a@x.com");
  assert.deepEqual([...loop], ["b@x.com"]);
});

test("super admins can do everything; a company grant covers anyone; a team grant covers only that tree", () => {
  const superA = { email: "chirag@wohlig.com", superAdmin: true, grants: [] };
  assert.equal(decide(superA, "assets.manage", "raj@wohlig.com", treeOf), true);
  const hr = { email: "priyal@wohlig.com", grants: [{ permission: "leave.approve", scope: "company" }] };
  assert.equal(decide(hr, "leave.approve", "raj@wohlig.com", treeOf), true);
  assert.equal(decide(hr, "payroll.view", "raj@wohlig.com", treeOf), false);
  const head = { email: "jagruti@wohlig.com", grants: [{ permission: "leave.approve", scope: "tree", scope_root_email: null }] };
  assert.equal(decide(head, "leave.approve", "asha@wohlig.com", treeOf), true, "any depth below");
  assert.equal(decide(head, "leave.approve", "raj@wohlig.com", treeOf), false, "another team");
  assert.equal(decide(head, "leave.approve", null, treeOf), true, "holds it for a team, for menus");
  const other = { email: "priyal@wohlig.com", grants: [{ permission: "attendance.view", scope: "tree", scope_root_email: "chirag@wohlig.com" }] };
  assert.equal(decide(other, "attendance.view", "raj@wohlig.com", treeOf), true, "a chosen person's team");
  assert.equal(decide(other, "attendance.view", "asha@wohlig.com", treeOf), false);
  assert.equal(decide(null, "leave.approve", "asha@wohlig.com", treeOf), false);
});

test("scope lists who a permission covers", () => {
  assert.equal(scopeFor({ superAdmin: true }, "leave.approve", treeOf), null);
  assert.equal(scopeFor({ email: "x@wohlig.com", grants: [{ permission: "leave.approve", scope: "company" }] }, "leave.approve", treeOf), null);
  const s = scopeFor({ email: "pratik.sawant@wohlig.com", grants: [{ permission: "attendance.view", scope: "tree" }] }, "attendance.view", treeOf);
  assert.deepEqual([...s], ["asha@wohlig.com"]);
  assert.equal(scopeFor({ email: "x@wohlig.com", grants: [] }, "attendance.view", treeOf).size, 0);
});

test("nobody decides their own request, not even a super admin", () => {
  assert.equal(mayDecideOn({ email: "chirag@wohlig.com", superAdmin: true }, "expenses.approve", "CHIRAG@wohlig.com", treeOf), false);
  assert.equal(mayDecideOn({ email: "priyal@wohlig.com", grants: [{ permission: "expenses.approve", scope: "company" }] }, "expenses.approve", "priyal@wohlig.com", treeOf), false);
  assert.equal(mayDecideOn({ email: "priyal@wohlig.com", grants: [{ permission: "expenses.approve", scope: "company" }] }, "expenses.approve", "raj@wohlig.com", treeOf), true);
});

test("a grant from the Access page is checked", () => {
  const today = "2026-11-19";
  assert.deepEqual(readGrant({ email: "Raj@Wohlig.com", permission: "leave.approve", scope: "tree" }, today).value,
    { email: "raj@wohlig.com", permission: "leave.approve", scope: "tree", scopeRootEmail: null, expiresAt: null, note: "" });
  assert.match(readGrant({ email: "raj@wohlig.com", permission: "payroll.bank", scope: "tree" }, today).errors.scope, /whole company/);
  assert.ok(readGrant({ email: "nope", permission: "x", scope: "" }, today).errors.email);
  assert.ok(readGrant({ email: "raj@wohlig.com", permission: "x", scope: "company" }, today).errors.permission);
  assert.ok(readGrant({ email: "raj@wohlig.com", permission: "leave.approve", scope: "company", expiresAt: "2026-01-01" }, today).errors.expiresAt);
  assert.equal(readGrant({ email: "raj@wohlig.com", permission: "leave.approve", scope: "company", scopeRootEmail: "a@b.com" }, today).value.scopeRootEmail, null);
});

test("removed and ended grants stop counting", () => {
  const rows = [{ permission: "a", revoked_at: null, expires_at: null }, { permission: "b", revoked_at: "2026-01-01", expires_at: null },
    { permission: "c", revoked_at: null, expires_at: "2026-11-18" }, { permission: "d", revoked_at: null, expires_at: "2026-11-19" }];
  assert.deepEqual(liveGrants(rows, "2026-11-19").map((g) => g.permission), ["a", "d"]);
});

test("today's roles become grants that give the same access", () => {
  const hr = grantsFromRoles({ email: "priyal@wohlig.com", role: "hr", it_admin: false }).map((g) => g.permission);
  assert.ok(hr.includes("leave.approve") && hr.includes("users.manage") && hr.includes("assets.manage"));
  assert.ok(hr.every((k) => !SALARY_PERMS.has(k)), "HR gets no salary permission: salaries are the salary owner's");
  assert.deepEqual(grantsFromRoles({ email: "it@wohlig.com", role: "employee", it_admin: true }).map((g) => g.permission), ["assets.manage", "tools.manage"]);
  assert.deepEqual(grantsFromRoles({ email: "chirag@wohlig.com", role: "employee" }, { reviewers: ["Chirag@wohlig.com"] }), [], "payroll reviewers no longer get salaries");
  assert.deepEqual(grantsFromRoles({ email: "acc@wohlig.com", role: "employee" }, { financeViewers: ["acc@wohlig.com"] }), []);
  assert.deepEqual(grantsFromRoles({ email: "e@wohlig.com", role: "employee" }), []);
  assert.ok(grantsFromRoles({ email: "x@wohlig.com", role: "hr" }).every((g) => g.scope === "company"));
});

test("the catalogue is consistent", () => {
  assert.equal(new Set(PERMISSIONS.map((p) => p.key)).size, PERMISSIONS.length);
  for (const p of Object.values(PRESETS)) for (const k of p.perms) assert.ok(PERM[k], k);
  for (const k of PRESETS.teamHead.perms) assert.ok(PERM[k].team, `${k} must be givable for a team`);
  assert.ok(FIRST_SUPER_ADMINS.includes("pratik.sawant@wohlig.com") && FIRST_SUPER_ADMINS.length === 4);
  assert.equal(summary({ email: "chirag@wohlig.com", superAdmin: true })["assets.manage"], "company");
  assert.equal(summary({ email: "jagruti@wohlig.com", superAdmin: true })["payroll.bank"], undefined);
  assert.deepEqual(summary({ email: "j@wohlig.com", grants: [{ permission: "leave.approve", scope: "tree" }, { permission: "leave.approve", scope: "tree", scope_root_email: "Raj@wohlig.com" }] }),
    { "leave.approve": ["j@wohlig.com", "raj@wohlig.com"] });
});

test("salaries are the salary owners' alone: not super admins, not grants", () => {
  const before = process.env.SALARY_OWNERS;
  try {
    delete process.env.SALARY_OWNERS;
    assert.deepEqual(salaryOwners(), ["chintan@wohlig.com", "chirag@wohlig.com", "kailash@wohlig.com"], "the three owners when nothing is set");
    const kailash = { email: "Kailash@wohlig.com", grants: [] };
    const superA = { email: "jagruti@wohlig.com", superAdmin: true, grants: [] };
    const granted = { email: "priyal@wohlig.com", grants: [...SALARY_PERMS].map((permission) => ({ permission, scope: "company" })) };
    for (const perm of SALARY_PERMS) {
      assert.equal(decide(kailash, perm, "raj@wohlig.com", treeOf), true, `owner holds ${perm}`);
      assert.equal(decide(superA, perm, "raj@wohlig.com", treeOf), false, `super admin lacks ${perm}`);
      assert.equal(decide(granted, perm, "raj@wohlig.com", treeOf), false, `a grant gives no ${perm}`);
      assert.equal(scopeFor(superA, perm, treeOf).size, 0);
      assert.equal(scopeFor(kailash, perm, treeOf), null);
    }
    assert.equal(summary(kailash)["payroll.prepare"], "company");
    assert.equal(summary(granted)["payroll.prepare"], undefined);
    assert.equal(decide(superA, "leave.approve", "raj@wohlig.com", treeOf), true, "everything else is unchanged");
    process.env.SALARY_OWNERS = "a@wohlig.com, B@wohlig.com, not-an-email";
    assert.deepEqual(salaryOwners(), ["a@wohlig.com", "b@wohlig.com"]);
    assert.equal(decide(kailash, "payroll.view", null, treeOf), false, "the list comes from the server's settings");
  } finally {
    if (before === undefined) delete process.env.SALARY_OWNERS; else process.env.SALARY_OWNERS = before;
  }
});
