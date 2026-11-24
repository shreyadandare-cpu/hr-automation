import test from "node:test";
import assert from "node:assert/strict";
import { computeLine } from "../src/payroll/engine.js";
import { stipendBody, cleanStructure } from "../src/payroll-calc.js";
import { DEFAULT_TAX_RULES } from "../src/payroll/tax-defaults.js";

const rules = DEFAULT_TAX_RULES.find((r) => r.fy === "2026-27" && r.regime === "new").rules;
const run = (employmentType, structure) => computeLine({ period: "2026-10", employee: { start: "2026-01-01", employmentType, pan: "ABCDE1234F" }, structure,
  tax: { rules, regime: "new", declaration: {}, paidSoFar: { taxable: 0, tds: 0, pt: 0 } } });

test("an intern is paid the stipend with nothing deducted, even if the structure carries PF, tax and professional tax", () => {
  const heavy = { earnings: [{ name: "Basic", amount: 150000 }], pfApplicable: true, pfEmployee: 3000, ptApplicable: true, professionalTax: 200, tdsApplicable: true, esicEmployee: 500 };
  const intern = run("Intern", heavy), employee = run("Employee", heavy);
  assert.equal(intern.summary.pf + intern.summary.pt + intern.summary.tds + intern.summary.esic, 0);
  assert.equal(intern.totals.net, 150000);
  assert.ok(employee.summary.pf > 0 && employee.summary.pt > 0 && employee.summary.tds > 0, "the same structure for an employee deducts as usual");
});

test("the stipend structure is one line and switches every deduction off", () => {
  const { value } = cleanStructure({ effectiveFrom: "2026-10", ...stipendBody(15000) });
  assert.deepEqual(value.earnings, [{ name: "Stipend", amount: 15000 }]);
  assert.equal(value.pfApplicable, false); assert.equal(value.ptApplicable, false); assert.equal(value.tdsApplicable, false);
  const slip = run("Intern", { ...value, earnings: value.earnings });
  assert.equal(slip.totals.net, 15000);
});
