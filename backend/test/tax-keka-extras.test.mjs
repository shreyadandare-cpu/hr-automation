/* The last Keka gaps: leave travel (two journeys in a block of four years, the exemption up to the allowance paid), asking
   for a late change, and the year's figures for filing the return. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { journeyProblem, ltaBlockOf, readLateDecision, readLateRequest, readTaxDeclaration } from "../src/engage-rules.js";
import { allowedDeductions, ltaExemption, payrollFieldsFrom } from "../src/payroll/tax.js";
import { fromEmployee } from "../src/payroll/declared.js";
import { returnFigures } from "../src/tax-estimate.js";
import { DEFAULT_TAX_RULES } from "../src/payroll/tax-defaults.js";

const OLD = DEFAULT_TAX_RULES.find((r) => r.fy === "2026-27" && r.regime === "old").rules;
const NEW = DEFAULT_TAX_RULES.find((r) => r.fy === "2026-27" && r.regime === "new").rules;
const trip = (startOn, extra = {}) => ({ section: "Leave travel", description: "Family trip", amount: "40000", party: { from: "Mumbai", to: "Jaipur", startOn, endOn: startOn, mode: "rail", travellers: "Self and spouse", ...extra } });

test("leave travel blocks are four calendar years from 2022", () => {
  assert.equal(ltaBlockOf(2022), 2022); assert.equal(ltaBlockOf(2025), 2022); assert.equal(ltaBlockOf(2026), 2026); assert.equal(ltaBlockOf(2029), 2026); assert.equal(ltaBlockOf(2030), 2030);
});

test("two journeys a block, plus one carried over only in the block's first year", () => {
  assert.equal(journeyProblem([{ startOn: "2026-05-01" }, { startOn: "2028-01-10" }]), "");
  assert.match(journeyProblem([{ startOn: "2026-05-01" }, { startOn: "2027-05-01" }, { startOn: "2029-05-01" }]), /two journeys/);
  assert.equal(journeyProblem([{ startOn: "2026-05-01" }, { startOn: "2026-10-01" }, { startOn: "2026-12-01", carryForward: true }]), "", "2026 may hold one carried over from 2022-25");
  assert.match(journeyProblem([{ startOn: "2027-05-01", carryForward: true }]), /must be made in 2026/);
  assert.match(journeyProblem([{ startOn: "2026-05-01", carryForward: true }, { startOn: "2026-06-01", carryForward: true }]), /Only one journey/);
  assert.equal(journeyProblem([{ startOn: "2025-12-20" }, { startOn: "2025-03-01" }, { startOn: "2026-05-01" }]), "", "different blocks count apart");
});

test("a leave travel line needs the journey on submit, in its own year, and within the block limit", () => {
  const ok = readTaxDeclaration({ regime: "old", submit: true, items: [trip("2026-10-02")] }, { fy: 2026 });
  assert.deepEqual(ok.errors, {}); assert.equal(ok.items[0].party.mode, "rail");
  assert.ok(readTaxDeclaration({ regime: "old", submit: true, items: [trip("2026-10-02", { from: "" })] }, { fy: 2026 }).errors.party0);
  assert.ok(readTaxDeclaration({ regime: "old", submit: true, items: [trip("2026-02-02")] }, { fy: 2026 }).errors.party0, "a journey before April is last year's");
  assert.ok(readTaxDeclaration({ regime: "old", submit: true, items: [trip("2026-10-02", { mode: "ship" })] }, { fy: 2026 }).errors.party0);
  assert.ok(readTaxDeclaration({ regime: "old", submit: true, items: [trip("2026-10-02", { endOn: "2026-10-01" })] }, { fy: 2026 }).errors.party0);
  const full = readTaxDeclaration({ regime: "old", submit: true, items: [trip("2026-10-02")] }, { fy: 2026, earlierJourneys: [{ startOn: "2026-01-10" }, { startOn: "2026-02-10" }] });
  assert.match(full.errors.journeys, /two journeys/);
  assert.deepEqual(readTaxDeclaration({ regime: "old", items: [trip("")] }, { fy: 2026 }).errors, {}, "a draft may be incomplete");
  assert.equal(readTaxDeclaration({ regime: "new", items: [trip("2026-10-02")] }, { fy: 2026 }).items.length, 0, "the new regime has no leave travel exemption");
});

test("leave travel exemption is the fares, up to the allowance paid in the year, and only under the old regime", () => {
  assert.equal(ltaExemption({ fares: 50000, received: 120000 }), 50000);
  assert.equal(ltaExemption({ fares: 150000, received: 120000 }), 120000);
  assert.equal(ltaExemption({ fares: 50000, received: 0 }), 0);
  const items = [{ section: "Leave travel", amountMinor: 5000000, party: {} }, { section: "Leave travel", amountMinor: 3000000, party: {} }];
  assert.equal(payrollFieldsFrom(items, "old").faresDeclared, 80000);
  assert.equal(payrollFieldsFrom(items, "old", { proofs: { 1: { status: "rejected" } } }).faresDeclared, 50000);
  assert.equal(payrollFieldsFrom(items, "new").faresDeclared, 0);
  const structure = { earnings: [{ name: "Basic", amount: 50000 }, { name: "HRA", amount: 25000 }, { name: "LTA", amount: 5000 }] };
  const d = fromEmployee({ request: { regime: "old", items }, structure, fy: "2026-27", start: "2026-10-01" });
  assert.deepEqual(d.lta, { fares: 80000, received: 30000, exemption: 30000 }, "six months of ₹5,000 allowance");
  assert.equal(d.declaration.ltaExemption, 30000);
  const none = fromEmployee({ request: { regime: "old", items }, structure: { earnings: [{ name: "Basic", amount: 50000 }] }, fy: "2026-27" });
  assert.equal(none.declaration.ltaExemption, undefined, "no allowance paid, nothing to exempt");
});

test("the old regime allows the leave travel exemption, even in rules saved before it was added; the new does not", () => {
  const line = (rules) => allowedDeductions(rules, { ltaExemption: 30000 }).lines.find((l) => /Leave travel/.test(l.name));
  assert.equal(line(OLD).amount, 30000);
  assert.equal(line({ ...OLD, allowedDeductions: OLD.allowedDeductions.filter((k) => k !== "ltaExemption") }).amount, 30000);
  assert.equal(line(NEW), undefined);
});

test("a late change needs a reason; payroll approves it until a date or declines it with a note", () => {
  assert.ok(readLateRequest({ kind: "declaration" }).errors.reason);
  assert.ok(readLateRequest({ kind: "both", reason: "x" }).errors.kind);
  assert.deepEqual(readLateRequest({ kind: "proof", reason: " Rent receipts arrived late " }), { kind: "proof", reason: "Rent receipts arrived late", errors: {} });
  assert.ok(readLateDecision({ decision: "approved" }, "2026-11-24").errors.until);
  assert.ok(readLateDecision({ decision: "approved", until: "2026-11-01" }, "2026-11-24").errors.until);
  assert.deepEqual(readLateDecision({ decision: "approved", until: "2026-12-01" }, "2026-11-24").errors, {});
  assert.ok(readLateDecision({ decision: "declined" }, "2026-11-24").errors.note);
  assert.equal(readLateDecision({ decision: "declined", note: "Too late for this year", until: "2026-12-01" }, "2026-11-24").until, null);
});

test("the return's figures: salary less deductions, the tax, and what is still to pay or comes back", () => {
  const statement = { totals: { salary: 1500000, taxable: 1500000, pt: 2500, tds: 100000 } };
  const f = returnFigures({ statement, regime: "new", rules: NEW, declaration: { previousEmployerIncome: 0, otherIncome: 25000 } });
  assert.equal(f.grossIncome, 1525000);
  assert.equal(f.totalDeductions, 50000, "the new regime keeps the standard deduction only (₹50,000, as on the company payslip)");
  assert.equal(f.taxableIncome, 1475000);
  assert.equal(f.annualTax, 105300);   // 5% of 4L + 10% of 4L + 15% of 2.75L = 1,01,250, plus 4% cess
  assert.equal(f.balance, f.annualTax - 100000);
  const o = returnFigures({ statement, regime: "old", rules: OLD, declaration: { section80C: 150000, ltaExemption: 30000, previousEmployerTds: 5000 } });
  assert.deepEqual(o.deductions.map((l) => l.name).slice(0, 3), ["Standard deduction", "Professional tax (16(iii))", "Leave travel exemption (10(5))"]);
  assert.equal(o.tdsTotal, 105000);
});

test("employee PF counts under 80C in the old regime, within the ₹1,50,000 limit, and not in the new regime", async () => {
  const { computeLine, monthlyPfOf } = await import("../src/payroll/engine.js");
  assert.equal(monthlyPfOf({ pfApplicable: true, earnings: [{ name: "Basic", amount: 80000 }] }), 1800, "12% of Basic up to the ₹15,000 ceiling");
  assert.equal(monthlyPfOf({ pfEmployee: 3000, earnings: [{ name: "Basic", amount: 80000 }] }), 3000, "the amount set on the structure");
  assert.equal(monthlyPfOf({ pfApplicable: false, earnings: [{ name: "Basic", amount: 80000 }] }), 0);
  const c80 = (rules, decl, pf) => (allowedDeductions(rules, decl, 0, pf).lines.find((l) => /^80C/.test(l.name)) || {}).amount;
  assert.equal(c80(OLD, { section80C: 50000 }, 21600), 71600);
  assert.equal(c80(OLD, { section80C: 150000 }, 21600), 150000, "never above the limit");
  assert.equal(c80(OLD, {}, 21600), 21600, "PF alone, with nothing declared");
  assert.equal(c80(NEW, { section80C: 50000 }, 21600), undefined);
  // Through the payroll engine: ₹1.6L a month, PF ₹1,800 a month, ₹50,000 declared under 80C, April.
  const structure = { earnings: [{ name: "Basic", amount: 80000 }, { name: "HRA", amount: 40000 }, { name: "Special Allowance", amount: 40000 }], pfApplicable: true, professionalTax: 200, ptApplicable: true, tdsMode: "auto" };
  const line = computeLine({ period: "2026-04", employee: { start: "2020-01-01" }, structure, tax: { rules: OLD, regime: "old", declaration: { section80C: 50000 } } });
  const b = line.tds.breakdown;
  assert.equal(b.deductions.find((l) => /^80C/.test(l.name)).amount, 71600, "12 months of ₹1,800 + ₹50,000");
  // 19.2L − (50,000 standard + 2,400 PT + 71,600) = 17,96,000 → 12,500 + 1,00,000 + 2,38,800 = 3,51,300 + 4% = 3,65,352 → 3,65,350
  assert.equal(b.annualTax, 365350);
});

test("new regime: TDS comes from the year's actual figures, so a bonus or an earlier higher salary is taxed (as Keka)", async () => {
  const { computeLine } = await import("../src/payroll/engine.js");
  const st = (g) => ({ earnings: [{ name: "Basic", amount: g / 2 }, { name: "HRA", amount: g / 4 }, { name: "Special Allowance", amount: g / 4 }], professionalTax: 200, ptApplicable: true, tdsMode: "auto" });
  const tds = (o) => computeLine({ employee: { start: "2020-01-01" }, ...o }).summary.tds;
  // ₹95,000 a month (₹11.4L) and a ₹2.5L bonus in March: ₹13.9L − 50,000 = 13,40,000 → 81,000 + 4% = 84,240, all in March.
  assert.equal(tds({ period: "2027-03", structure: st(95000), inputs: { bonus: 250000 }, tax: { rules: NEW, regime: "new", declaration: {}, paidSoFar: { taxable: 1045000, tds: 0, pt: 2200 } } }), 84240);
  // ₹9L paid April to September, then ₹90,000 a month: ₹14.4L − 50,000 = 13,90,000 → 88,500 + 4% = 92,040, less 60,000 deducted, over 6 months.
  assert.equal(tds({ period: "2026-10", structure: st(90000), tax: { rules: NEW, regime: "new", declaration: {}, paidSoFar: { taxable: 900000, tds: 60000, pt: 1200 } } }), 5340);
  assert.equal(tds({ period: "2026-04", structure: st(100000), tax: { rules: NEW, regime: "new", declaration: {} } }), 0, "₹12L a year still owes nothing");
  assert.equal(tds({ period: "2026-04", structure: st(105000), tax: { rules: NEW, regime: "new", declaration: {} } }), 867, "₹12.6L: ₹12.1L taxable (₹50,000 standard deduction), so tax is limited to the ₹10,000 over ₹12L, plus cess, over 12 months");
  assert.equal(tds({ period: "2026-04", structure: st(100000), tax: { rules: null, regime: "new", declaration: {} } }), 0, "no rules set up: ₹12L still needs nothing");
});

test("employer NPS is limited to 14% of Basic under the new regime and 10% under the old", () => {
  const nps = (rules, basic) => allowedDeductions(rules, { employerNps: 300000 }, 0, 0, basic).lines.find((l) => /employer NPS/.test(l.name)).amount;
  assert.equal(nps(NEW, 900000), 126000);
  assert.equal(nps(OLD, 900000), 90000);
  assert.equal(nps({ ...NEW, caps: {} }, 900000), 126000, "rules saved before the limit was added");
  assert.equal(nps(NEW, 0), 300000, "Basic not known: no limit");
});
