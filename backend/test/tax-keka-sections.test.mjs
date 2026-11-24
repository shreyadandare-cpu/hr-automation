/* Keka's fuller declaration: each Chapter VIII section with its own limit, senior citizens, a let-out house, 80GG, no PAN,
   reminders and the new joiners' period. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ageInYear, annualTax, payrollFieldsFrom, rulesForAge, yearTax } from "../src/payroll/tax.js";
import { joinerUntil, readTaxDates, readTaxDeclaration, windowOpen } from "../src/engage-rules.js";
import { DEFAULT_TAX_RULES } from "../src/payroll/tax-defaults.js";
import { computeLine } from "../src/payroll/engine.js";
import { stillToDo } from "../src/tax-reminders.js";

const OLD = DEFAULT_TAX_RULES.find((r) => r.fy === "2026-27" && r.regime === "old").rules;
const NEW = DEFAULT_TAX_RULES.find((r) => r.fy === "2026-27" && r.regime === "new").rules;
const line = (section, rupees, party) => ({ section, amountMinor: rupees * 100, ...(party ? { party } : {}) });

test("age is counted on 31 March of the year, and senior citizens get the old regime's wider nil band", () => {
  assert.equal(ageInYear("1966-03-31", "2026-27"), 61);
  assert.equal(ageInYear("1967-03-31", "2026-27"), 60, "60 on the last day of the year counts");
  assert.equal(ageInYear("1967-04-01", "2026-27"), 59);
  assert.equal(ageInYear(null, "2026-27"), null);
  // ₹8,00,000 taxable: under 60 12,500 + 60,000 = 72,500 + 4% = 75,400; 60 to 79: 10,000 + 60,000 = 70,000 → 72,800; 80+: 60,000 → 62,400
  assert.equal(annualTax(rulesForAge(OLD, "old", 45), 800000).total, 75400);
  assert.equal(annualTax(rulesForAge(OLD, "old", 65), 800000).total, 72800);
  assert.equal(annualTax(rulesForAge(OLD, "old", 82), 800000).total, 62400);
  assert.equal(annualTax(rulesForAge(NEW, "new", 82), 1500000).total, annualTax(NEW, 1500000).total, "the new regime has no age bands");
});

test("each section keeps to its own limit: 80D for self and for parents, 80DD, 80DDB, 80U, 80EEA", () => {
  const f = (items) => payrollFieldsFrom(items, "old").fields;
  assert.equal(f([line("80D", 40000)]).section80D, 25000);
  assert.equal(f([line("80D", 40000, { senior: true })]).section80D, 40000);
  assert.equal(f([line("80D", 30000), line("80D parents", 60000, { senior: true })]).section80D, 75000, "25,000 for self + 50,000 for senior parents");
  assert.equal(f([line("80DD", 200000)]).disability80DD, 75000);
  assert.equal(f([line("80DD", 200000, { severe: true })]).disability80DD, 125000);
  assert.equal(f([line("80U", 90000)]).disability80U, 75000);
  assert.equal(f([line("80DDB", 70000)]).medical80DDB, 40000);
  assert.equal(f([line("80DDB", 70000, { senior: true })]).medical80DDB, 70000);
  assert.equal(f([line("80EEA", 200000)]).homeLoan80EEA, 150000);
  assert.equal(f([line("80E", 300000)]).educationLoan80E, 300000, "80E has no limit");
  assert.deepEqual(payrollFieldsFrom([line("80D", 20000), line("80E", 50000)], "new").fields, {}, "none of these count under the new regime");
});

test("savings interest: ₹10,000 under 60 (80TTA), up to ₹50,000 from 60 (80TTB)", () => {
  const d = (age) => yearTax({ rules: OLD, regime: "old", salary: 1000000, declaration: { savingsInterest: 30000 }, age }).ded.lines.find((l) => /80TT/.test(l.name));
  assert.equal(d(40).amount, 10000); assert.match(d(40).name, /80TTA/);
  assert.equal(d(65).amount, 30000); assert.match(d(65).name, /80TTB/);
});

test("80GG: rent with no HRA is the least of ₹60,000, 25% of income, and rent less 10% of income", () => {
  // ₹6,00,000 salary − ₹50,000 standard = ₹5,50,000; rent ₹1,20,000 − 55,000 = 65,000; 25% = 1,37,500 → ₹60,000
  const gg = (decl) => (yearTax({ rules: OLD, regime: "old", salary: 600000, declaration: decl }).ded.lines.find((l) => /80GG/.test(l.name)) || {}).amount;
  assert.equal(gg({ rentWithoutHra: 120000 }), 60000);
  assert.equal(gg({ rentWithoutHra: 80000 }), 25000, "80,000 − 55,000");
  assert.equal(gg({ rentWithoutHra: 120000, hraExemption: 10000 }), undefined, "not with HRA");
  assert.equal((yearTax({ rules: NEW, regime: "new", salary: 600000, declaration: { rentWithoutHra: 120000 } }).ded.lines.find((l) => /80GG/.test(l.name))), undefined);
});

test("a let-out house: rent less municipal tax, less 30%, less interest; a loss up to ₹2 lakh under the old regime only", () => {
  const items = [line("Let-out property", 300000, { address: "Pune", municipalTaxMinor: 2000000, interestMinor: 30000000, lender: "Bank", lenderAddress: "Mumbai" })];
  // (3,00,000 − 20,000) × 70% = 1,96,000 − 3,00,000 = −1,04,000
  assert.equal(payrollFieldsFrom(items, "old").fields.housePropertyIncome, -104000);
  assert.equal(payrollFieldsFrom(items, "new").fields.housePropertyIncome, -104000, "kept under both regimes");
  assert.equal(yearTax({ rules: OLD, regime: "old", salary: 1000000, declaration: { housePropertyIncome: -104000 } }).gross, 896000);
  assert.equal(yearTax({ rules: OLD, regime: "old", salary: 1000000, declaration: { housePropertyIncome: -500000 } }).gross, 800000, "loss set off up to 2 lakh");
  assert.equal(yearTax({ rules: NEW, regime: "new", salary: 1000000, declaration: { housePropertyIncome: -104000 } }).gross, 1000000, "the new regime sets off no loss");
  assert.equal(yearTax({ rules: NEW, regime: "new", salary: 1000000, declaration: { housePropertyIncome: 50000 } }).gross, 1050000);
  const r = readTaxDeclaration({ regime: "new", submit: true, items: [{ section: "Let-out property", amount: "300000", party: { address: "", interest: "300000" } }] });
  assert.ok(r.errors.party0, "the address is needed");
  const ok = readTaxDeclaration({ regime: "new", submit: true, items: [{ section: "Let-out property", amount: "300000", party: { address: "Pune", interest: "3,00,000", lender: "Bank", lenderAddress: "Mumbai" } }] });
  assert.deepEqual(ok.errors, {}); assert.equal(ok.items[0].party.interestMinor, 30000000);
  const again = readTaxDeclaration({ regime: "new", items: [{ section: "Let-out property", amount: "300000", party: ok.items[0].party }] });
  assert.equal(again.items[0].party.interestMinor, 30000000, "saving again keeps the figures");
});

test("no PAN on file: TDS is at least 20% of the taxable salary once tax is due; never when the PAN was not looked up", () => {
  const structure = { earnings: [{ name: "Basic", amount: 75000 }, { name: "HRA", amount: 37500 }, { name: "Special Allowance", amount: 37500 }], professionalTax: 0, tdsMode: "auto" };
  const tds = (pan) => computeLine({ period: "2026-04", employee: { start: "2020-01-01", pan }, structure, tax: { rules: NEW, regime: "new", declaration: {} } });
  assert.equal(tds("ABCDE1234F").summary.tds, 13000, "₹18L − 50,000 = 17,50,000 → 1,50,000 + 4% = 1,56,000 / 12");
  const none = tds("");
  assert.equal(none.summary.tds, 30000, "20% of ₹1,50,000");
  assert.ok(none.warnings.some((w) => /No PAN/.test(w)));
  assert.equal(tds(undefined).summary.tds, 13000);
  const low = computeLine({ period: "2026-04", employee: { start: "2020-01-01", pan: "" }, structure: { earnings: [{ name: "Basic", amount: 50000 }], professionalTax: 0, tdsMode: "auto" }, tax: { rules: NEW, regime: "new", declaration: {} } });
  assert.equal(low.summary.tds, 0, "no tax due, so nothing even without a PAN");
});

test("reminders go to those not finished; new joiners get their own period", () => {
  const staff = ["a@x.com", "b@x.com", "c@x.com"];
  const requests = [{ id: 1, email: "b@x.com", status: "submitted", items: [{ section: "80C" }, { section: "Previous employer salary" }], proofs: {} },
    { id: 2, email: "c@x.com", status: "submitted", items: [{ section: "80C" }], proofs: { 0: { status: "verified" } } }];
  assert.deepEqual(stillToDo("declaration", staff, requests, []), ["a@x.com"]);
  assert.deepEqual(stillToDo("proof", staff, requests, []), ["b@x.com"]);
  assert.deepEqual(stillToDo("proof", staff, requests, [{ request_id: 1, line_index: 0 }]), [], "a document is on file");
  assert.equal(joinerUntil("2026-11-10", 30), "2026-12-10");
  assert.equal(joinerUntil("2026-11-10", null), null);
  assert.equal(windowOpen({ today: "2026-11-20", due: "2026-11-01", joinerUntil: "2026-12-10" }), true);
  assert.equal(windowOpen({ today: "2026-12-11", due: "2026-11-01", joinerUntil: "2026-12-10" }), false);
  assert.equal(readTaxDates({ joinerDays: "30" }, 2026).joinerDays, 30);
  assert.ok(readTaxDates({ joinerDays: "500" }, 2026).errors.joinerDays);
  assert.equal(readTaxDates({}, 2026).joinerDays, null);
});

test("why TDS changed: salary, extra pay, deductions, regime, an override, or the months running out", async () => {
  const { tdsChanges } = await import("../src/tax-estimate.js");
  const b = (o) => ({ regime: "new", regularMonthly: 100000, salaryThisMonth: 100000, totalDeductions: 75000, annualTax: 100000, ...o });
  const m = (period, amount, breakdown, extra = {}) => ({ period, tds: { amount, mode: "auto", override: null, breakdown, ...extra } });
  const ch = tdsChanges([m("2026-04", 8000, b()), m("2026-05", 8000, b()), m("2026-06", 9500, b({ regularMonthly: 120000, salaryThisMonth: 120000 })),
    m("2026-07", 15000, b({ regularMonthly: 120000, salaryThisMonth: 170000 })), m("2026-08", 7000, b({ regularMonthly: 120000, salaryThisMonth: 120000, totalDeductions: 200000, regime: "old" })),
    m("2026-09", 5000, b({ regularMonthly: 120000, salaryThisMonth: 120000, totalDeductions: 200000, regime: "old" }), { override: { reason: "Agreed with the accountant" } }),
    m("2026-10", 7100, b({ regularMonthly: 120000, salaryThisMonth: 120000, totalDeductions: 200000, regime: "old" }))]);
  assert.deepEqual(ch.map((c) => c.period), ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"], "no entry when TDS stayed the same");
  assert.match(ch[0].reasons.join(" "), /monthly salary changed from ₹1,00,000 to ₹1,20,000/);
  assert.match(ch[1].reasons.join(" "), /₹50,000 more than the usual salary/);
  assert.match(ch[2].reasons.join(" "), /regime changed from New to Old/); assert.match(ch[2].reasons.join(" "), /deductions and exemptions for the year changed/);
  assert.match(ch[3].reasons.join(" "), /set this month's TDS by hand: Agreed with the accountant/);
  assert.match(ch[4].reasons.join(" "), /Last month's TDS was set by hand/);
  assert.equal(ch[0].from, 8000); assert.equal(ch[0].to, 9500);
  assert.match(tdsChanges([m("2026-04", 8000, b()), m("2026-05", 8010, b())])[0].reasons[0], /spread over the months left/);
});
