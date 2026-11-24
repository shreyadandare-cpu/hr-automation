/* Tax paid at a previous employer earlier in the year ("prior tax"): it must reach the TDS calculation, and payroll must be
   told when it cannot. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLine } from "../src/payroll/engine.js";
import { payrollFieldsFrom } from "../src/payroll/tax.js";
import { readTaxDeclaration } from "../src/engage-rules.js";
import { DEFAULT_TAX_RULES } from "../src/payroll/tax-defaults.js";

const rules = DEFAULT_TAX_RULES.find((r) => r.fy === "2026-27" && r.regime === "new").rules;
const structure = (extra = {}) => ({ earnings: [{ name: "Basic", amount: 60000 }, { name: "HRA", amount: 30000 }, { name: "Special allowance", amount: 30000 }], pfApplicable: false, ptApplicable: false, ...extra });
const line = (s, declaration) => computeLine({ period: "2026-11", employee: { start: "2026-10-01" }, structure: s,
  tax: { rules, regime: "new", declaration, paidSoFar: { taxable: 120000, tds: 5000, pt: 0 } } });

test("calculated TDS counts the previous employer's salary and TDS", () => {
  const none = line(structure(), {}), prior = line(structure(), { previousEmployerIncome: 600000, previousEmployerTds: 40000 });
  assert.equal(prior.tds.breakdown.previousEmployerIncome, 600000);
  assert.equal(prior.tds.breakdown.previousEmployerTds, 40000);
  assert.notEqual(prior.tds.amount, none.tds.amount, "the previous employer's figures change this month's TDS");
});

test("fixed monthly TDS warns that the previous employer's salary and TDS are not used", () => {
  const s = structure({ tdsMode: "manual", tdsMonthly: 9000 });
  const prior = line(s, { previousEmployerIncome: 600000, previousEmployerTds: 40000 });
  assert.ok(prior.warnings.some((w) => /previous employer/i.test(w)), prior.warnings.join(" | "));
  assert.ok(!line(s, {}).warnings.some((w) => /previous employer/i.test(w)), "no warning when nothing was declared");
});

test("an employee can declare the previous employer's salary and TDS under either regime", () => {
  const items = [{ section: "Previous employer salary", amount: "6,00,000" }, { section: "Previous employer TDS", amount: "40000" }, { section: "80C", amount: "150000" }];
  const n = readTaxDeclaration({ regime: "new", items });
  assert.deepEqual(n.errors, {});
  assert.deepEqual(n.items.map((i) => i.section), ["Previous employer salary", "Previous employer TDS"], "the new regime keeps only the previous employer lines");
  assert.equal(readTaxDeclaration({ regime: "old", items }).items.length, 3);
});

test("an employee's submission becomes payroll's declaration fields, in rupees", () => {
  const items = [{ section: "80C", amountMinor: 10000000 }, { section: "80C", amountMinor: 5000000 }, { section: "Previous employer salary", amountMinor: 60000000 },
    { section: "Previous employer TDS", amountMinor: 4000000 }, { section: "HRA", amountMinor: 24000000 }, { section: "NPS", amountMinor: 5000000 },
    { section: "Income from other sources", amountMinor: 2500000 }];
  const old = payrollFieldsFrom(items, "old");
  assert.deepEqual(old.fields, { section80C: 150000, previousEmployerIncome: 600000, previousEmployerTds: 40000, nps80CCD1B: 50000, otherIncome: 25000 });
  assert.equal(old.rentDeclared, 240000, "rent is shown to payroll, not copied as the HRA exemption");
  assert.deepEqual(payrollFieldsFrom(items, "new").fields, { previousEmployerIncome: 600000, previousEmployerTds: 40000, otherIncome: 25000 });
});

test("the ₹12 lakh no-TDS rule counts the previous employer's salary for the year", () => {
  // ₹80,000 a month here is ₹9,60,000 a year, but with ₹10,00,000 from the previous employer the year is well above ₹12 lakh.
  const s = structure({ earnings: [{ name: "Basic", amount: 40000 }, { name: "HRA", amount: 20000 }, { name: "Special allowance", amount: 20000 }] });
  assert.equal(line(s, {}).tds.amount, 0, "on this salary alone there is no TDS");
  const prior = line(s, { previousEmployerIncome: 1000000, previousEmployerTds: 20000 });
  assert.ok(prior.tds.amount > 0, "with the previous employer's salary, TDS is due");
  assert.equal(prior.tds.breakdown.previousEmployerIncome, 1000000);
});
