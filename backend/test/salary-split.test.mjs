import test from "node:test";
import assert from "node:assert/strict";
import { splitGross } from "../src/payroll-calc.js";
import { splitGross as browserSplit } from "../../frontend/src/lib/salarySplit.js";

const by = (g) => Object.fromEntries(splitGross(g).map((l) => [l.name, l.amount]));
const sum = (g) => splitGross(g).reduce((n, l) => n + l.amount, 0);

test("up to 7 lakh: Basic, HRA, Statutory Bonus and Special Allowance only (HR's 0 to 6.59 LPA sheet)", () => {
  const s = by(41667);
  assert.deepEqual(Object.keys(s), ["Basic", "HRA", "Statutory Bonus", "Special Allowance"]);
  assert.equal(s.Basic, 20834); assert.equal(sum(41667), 41667);
});
test("7.01 to 12 lakh: adds Medical and Conveyance (sheet: 1,00,000 a month, and the Sept sample payslip)", () => {
  assert.deepEqual(by(100000), { Basic: 50000, HRA: 25000, "Medical Allowance": 1250, "Conveyance Allowance": 1600, "Statutory Bonus": 4165, "Special Allowance": 17985 });
  assert.deepEqual(by(76384), { Basic: 38192, HRA: 19096, "Medical Allowance": 1250, "Conveyance Allowance": 1600, "Statutory Bonus": 3182, "Special Allowance": 13064 });
});
test("above 12 lakh: adds fuel, LTA, driver, books and mobile (sample payslip of 1,50,000)", () => {
  assert.deepEqual(by(150000), { Basic: 75000, HRA: 37500, "Medical Allowance": 1250, "Conveyance Allowance": 1600, "Fuel Reimbursement": 1800, LTA: 6248,
    "Driver Salary Reimbursement": 900, "Books & Periodicals": 1200, "Statutory Bonus": 6248, "Mobile/Data Reimbursement": 500, "Special Allowance": 17754 });
  assert.equal(sum(150000), 150000); assert.equal(sum(108333), 108333);
});
test("the browser copy gives the same lines as the server copy", () => {
  for (const g of [20000, 58333, 59000, 76384, 100000, 100001, 108333, 150000]) assert.deepEqual(browserSplit(g), splitGross(g));
});
test("nothing for a missing gross", () => { assert.deepEqual(splitGross(0), []); assert.deepEqual(splitGross(""), []); });

import { computeLine } from "../src/payroll/engine.js";
import { DEFAULT_TAX_RULES } from "../src/payroll/tax-defaults.js";
const rules = (regime) => DEFAULT_TAX_RULES.find((r) => r.fy === "2026-27" && r.regime === regime).rules;
const tdsFor = (gross, regime = "new", period = "2026-04") => computeLine({ period, employee: { start: "2020-01-01" }, structure: { earnings: [{ name: "Basic", amount: gross }], pfEmployee: 0, professionalTax: 0 },
  tax: { rules: rules(regime), regime, declaration: {}, paidSoFar: { taxable: 0, tds: 0, pt: 0 } } }).summary.tds;

test("TDS: a yearly income of 12 lakh or less pays none; above it the regime's tax is worked out", () => {
  assert.equal(tdsFor(100000), 0);          // exactly 12,00,000 a year
  assert.equal(tdsFor(60000), 0);
  assert.ok(tdsFor(150000) > 0);            // 18,00,000 a year, new regime
  assert.ok(tdsFor(150000, "old") > tdsFor(150000, "new") - 1);
});
