/* Advance and loan instalments: the plan HR sets, and payroll deducting it as Keka does. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readPlan } from "../src/clearance.js";
import { computeLine } from "../src/payroll/engine.js";

test("an instalment plan needs a monthly amount up to the advance and a first month; both empty means none", () => {
  assert.deepEqual(readPlan({}, 12000), { monthly: null, fromMonth: null, errors: {} });
  assert.deepEqual(readPlan({ monthly: "5,000", fromMonth: "2026-11" }, 12000), { monthly: 5000, fromMonth: "2026-11", errors: {} });
  assert.ok(readPlan({ monthly: "15000", fromMonth: "2026-11" }, 12000).errors.monthly);
  assert.ok(readPlan({ monthly: "5000" }, 12000).errors.fromMonth);
  assert.ok(readPlan({ monthly: "-5", fromMonth: "2026-11" }, 12000).errors.monthly);
});

test("payroll deducts each instalment as its own line, never on a line on hold", () => {
  const structure = { earnings: [{ name: "Basic", amount: 40000 }], professionalTax: 0, tdsMode: "auto" };
  const line = computeLine({ period: "2026-11", employee: { start: "2020-01-01" }, structure, tax: {}, advanceRecoveries: [{ id: 7, reason: "Salary advance", amount: 5000 }, { id: 8, reason: "Laptop loan", amount: 2000 }] });
  const adv = line.deductions.filter((d) => d.code === "advance");
  assert.deepEqual(adv.map((d) => [d.name, d.amount, d.advanceId]), [["Advance recovery: Salary advance", 5000, 7], ["Advance recovery: Laptop loan", 2000, 8]]);
  assert.equal(line.summary.net, 33000);
  assert.equal(computeLine({ period: "2026-11", employee: { start: "2020-01-01" }, structure, tax: {} }).deductions.filter((d) => d.code === "advance").length, 0);
});
