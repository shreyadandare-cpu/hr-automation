/* Tax declarations as Keka handles them: HR approves an amount, proofs decide what counts, deadlines, HRA, Form 124 details. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readTaxDeclaration, readTaxDates, readUnlock, windowOpen } from "../src/engage-rules.js";
import { readProof } from "../src/finance-rules.js";
import { payrollFieldsFrom, hraExemption } from "../src/payroll/tax.js";

test("HR may approve a line for less, with a reason, but never for more", () => {
  const ok = readProof({ index: 0, status: "verified", approved: "1,00,000", note: "Only one receipt" }, 1, [15000000]);
  assert.deepEqual(ok.errors, {}); assert.equal(ok.approvedMinor, 10000000);
  assert.ok(readProof({ index: 0, status: "verified", approved: "200000" }, 1, [15000000]).errors.approved);
  assert.ok(readProof({ index: 0, status: "verified", approved: "100000" }, 1, [15000000]).errors.note, "a lower amount needs a reason");
  assert.equal(readProof({ index: 0, status: "verified" }, 1, [15000000]).approvedMinor, null, "empty means the full amount");
  assert.equal(readProof({ index: 0, status: "verified", approved: "150000" }, 1, [15000000]).approvedMinor, null);
});

test("proofs decide what counts: rejected nothing, approved the lower amount, and after the proof date only verified lines", () => {
  const items = [{ section: "80C", amountMinor: 15000000 }, { section: "80D", amountMinor: 2500000 }, { section: "NPS", amountMinor: 5000000 },
    { section: "Previous employer salary", amountMinor: 60000000 }, { section: "Previous employer TDS", amountMinor: 4000000 }];
  const proofs = { 0: { status: "verified", approvedMinor: 10000000 }, 1: { status: "rejected" } };
  assert.deepEqual(payrollFieldsFrom(items, "old", { proofs }).fields, { section80C: 100000, nps80CCD1B: 50000, previousEmployerIncome: 600000, previousEmployerTds: 40000 });
  assert.deepEqual(payrollFieldsFrom(items, "old", { proofs, proofsFinal: true }).fields, { section80C: 100000, previousEmployerIncome: 600000 },
    "after the proof date, unproven claims and unproven previous TDS drop out; income never does");
});

test("HRA exemption is the least of HRA, rent less 10% of basic, and 50% (8 metros) or 40% of basic", () => {
  assert.equal(hraExemption({ rent: 600000, basic: 1000000, hra: 500000, metro: true }), 500000);
  assert.equal(hraExemption({ rent: 600000, basic: 1000000, hra: 500000, metro: false }), 400000);
  assert.equal(hraExemption({ rent: 120000, basic: 1000000, hra: 500000 }), 20000);
  assert.equal(hraExemption({ rent: 50000, basic: 1000000, hra: 500000 }), 0, "rent below 10% of basic gives nothing");
  const f = payrollFieldsFrom([{ section: "HRA", amountMinor: 30000000, party: { metro: true } }], "old");
  assert.equal(f.rentDeclared, 300000); assert.equal(f.metro, true);
});

test("Form 124: rent above ₹1 lakh needs the landlord's PAN; HRA and home loan need a name and address on submit", () => {
  const hra = (amount, party) => readTaxDeclaration({ regime: "old", submit: true, items: [{ section: "HRA", amount, party }] });
  assert.ok(hra("150000", { name: "A Landlord", address: "Pune" }).errors.party0, "PAN needed above ₹1,00,000");
  assert.deepEqual(hra("90000", { name: "A Landlord", address: "Pune" }).errors, {});
  assert.deepEqual(hra("150000", { name: "A Landlord", address: "Pune", pan: "abcde1234f", relationship: "None", metro: true }).errors, {});
  assert.equal(hra("150000", { name: "A", address: "B", pan: "abcde1234f" }).items[0].party.pan, "ABCDE1234F");
  assert.ok(hra("150000", { name: "A", address: "B", pan: "12345" }).errors.party0, "a PAN in the wrong shape");
  assert.ok(hra("90000", {}).errors.party0, "the landlord's name and address on submit");
  assert.deepEqual(readTaxDeclaration({ regime: "old", submit: false, items: [{ section: "HRA", amount: "150000" }] }).errors, {}, "a draft can be incomplete");
  assert.ok(readTaxDeclaration({ regime: "old", submit: true, items: [{ section: "Home loan interest", amount: "200000", party: { name: "Bank" } }] }).errors.party0);
  assert.equal(readTaxDeclaration({ regime: "old", items: [{ section: "80C", amount: "100", party: { name: "x" } }] }).items[0].party, undefined, "only HRA and home loan lines carry a party");
});

test("declaration and proof windows: due dates in the year, proof not before declaration, and a per-person reopening", () => {
  assert.equal(windowOpen({ today: "2026-12-10", due: null }), true);
  assert.equal(windowOpen({ today: "2026-12-10", due: "2026-12-31" }), true);
  assert.equal(windowOpen({ today: "2027-01-05", due: "2026-12-31" }), false);
  assert.equal(windowOpen({ today: "2027-01-05", due: "2026-12-31", unlockedUntil: "2027-01-10" }), true);
  assert.equal(windowOpen({ today: "2027-01-11", due: "2026-12-31", unlockedUntil: "2027-01-10" }), false);
  assert.deepEqual(readTaxDates({ declarationDue: "2026-12-31", proofDue: "2027-02-15" }, 2026).errors, {});
  assert.ok(readTaxDates({ declarationDue: "2026-12-31", proofDue: "2026-12-01" }, 2026).errors.proofDue);
  assert.ok(readTaxDates({ declarationDue: "2027-05-01" }, 2026).errors.declarationDue);
  assert.equal(readTaxDates({ declarationDue: "" }, 2026).declarationDue, null, "empty clears the date");
  assert.deepEqual(readUnlock({ email: "A@wohlig.com", kind: "proof", until: "2027-01-10" }, "2027-01-05"), { email: "a@wohlig.com", kind: "proof", until: "2027-01-10", errors: {} });
  assert.ok(readUnlock({ email: "a@wohlig.com", kind: "proof", until: "2027-01-01" }, "2027-01-05").errors.until);
});

test("an employee's submitted declaration becomes payroll's tax details, with the HRA exemption from the salary", async () => {
  const { fromEmployee, monthsEmployed } = await import("../src/payroll/declared.js");
  assert.equal(monthsEmployed("2026-27", "2026-10-15", null), 6, "October to March");
  assert.equal(monthsEmployed("2026-27", "2020-01-01", "2026-06-30"), 3, "April to June");
  const structure = { earnings: [{ name: "Basic", amount: 50000 }, { name: "HRA", amount: 25000 }, { name: "Special allowance", amount: 25000 }] };
  const d = fromEmployee({ fy: "2026-27", start: "2020-01-01", structure, request: { regime: "old", proofs: { 1: { status: "rejected" } }, items: [
    { section: "HRA", amountMinor: 36000000, party: { metro: true } }, { section: "80C", amountMinor: 15000000 }, { section: "Previous employer TDS", amountMinor: 100000 }] } });
  // Basic ₹6,00,000, HRA ₹3,00,000, rent ₹3,60,000: least of 3,00,000, 3,00,000 and 3,00,000.
  assert.deepEqual(d.declaration, { hraExemption: 300000, previousEmployerTds: 1000 });
  assert.equal(d.regime, "old");
  assert.deepEqual(fromEmployee({ fy: "2026-27", structure, request: { regime: "new", items: [{ section: "HRA", amountMinor: 36000000 }] } }).declaration, {});
});

test("a payroll line says when the tax details came from the employee's declaration", async () => {
  const { computeLine } = await import("../src/payroll/engine.js");
  const { DEFAULT_TAX_RULES } = await import("../src/payroll/tax-defaults.js");
  const rules = DEFAULT_TAX_RULES.find((r) => r.fy === "2026-27" && r.regime === "old").rules;
  const line = computeLine({ period: "2026-11", employee: { start: "2020-01-01" }, structure: { earnings: [{ name: "Basic", amount: 100000 }, { name: "HRA", amount: 50000 }], pfApplicable: false, ptApplicable: false },
    tax: { rules, regime: "old", source: "employee", declaration: { hraExemption: 300000 }, hra: { rent: 600000, basic: 1200000, received: 600000, metro: true, exemption: 300000 }, paidSoFar: { taxable: 0, tds: 0, pt: 0 } } });
  assert.ok(line.calc.some((c) => /own declaration/.test(c)));
  assert.ok(line.calc.some((c) => /HRA exemption ₹3,00,000/.test(c)), line.calc.join(" | "));
  assert.ok(line.tds.breakdown.deductions.some((x) => /HRA/.test(x.name) && x.amount === 300000));
});

test("the employee's estimate compares both regimes and picks the lower tax", async () => {
  const { compareRegimes } = await import("../src/tax-estimate.js");
  const { DEFAULT_TAX_RULES } = await import("../src/payroll/tax-defaults.js");
  const rulesOf = Object.fromEntries(DEFAULT_TAX_RULES.filter((r) => r.fy === "2026-27").map((r) => [r.regime, r.rules]));
  const structure = { earnings: [{ name: "Basic", amount: 100000 }, { name: "HRA", amount: 50000 }, { name: "Special allowance", amount: 50000 }], ptApplicable: true, professionalTax: 200 };
  const plain = compareRegimes({ period: "2026-04", structure, rulesOf, items: [] });
  assert.equal(plain.available, true); assert.equal(plain.better, "new", "with nothing to claim the new regime costs less");
  assert.ok(plain.regimes.old.annualTax > plain.regimes.new.annualTax);
  assert.equal(plain.regimes.new.months, 12);
  const claims = [{ section: "HRA", amountMinor: 60000000, party: { metro: true } }, { section: "80C", amountMinor: 15000000 }, { section: "80D", amountMinor: 2500000 },
    { section: "Home loan interest", amountMinor: 20000000 }, { section: "NPS", amountMinor: 5000000 }];
  const big = compareRegimes({ period: "2026-04", structure, rulesOf, items: claims });
  assert.ok(big.regimes.old.annualTax < plain.regimes.old.annualTax, "claims lower the old regime's tax");
  assert.equal(big.regimes.new.annualTax, plain.regimes.new.annualTax, "and change nothing under the new regime");
  assert.ok(big.regimes.old.hra.exemption > 0);
  assert.equal(compareRegimes({ period: "2026-04", structure: { earnings: [{ name: "Basic", amount: 50000 }] }, rulesOf, items: [] }).regimes.new.monthly, 0, "₹6 lakh a year: no TDS");
  assert.equal(compareRegimes({ period: "2026-04", structure, rulesOf: {}, items: [] }).available, false);
});

test("Form 124 is a PDF for 2026-27 onwards (Form 12BB before), with the landlord's details", async () => {
  const { form124Pdf } = await import("../src/tax-forms.js");
  const declaration = { regime: "old", status: "submitted", submitted_at: "2026-11-20T10:00:00Z", items: [
    { section: "HRA", description: "Flat", amountMinor: 24000000, party: { name: "R Landlord", address: "Pune", pan: "ABCDE1234F", relationship: "None", metro: true } },
    { section: "80C", description: "PPF", amountMinor: 15000000 }, { section: "Previous employer salary", description: "Acme", amountMinor: 60000000 }] };
  const pdf = await form124Pdf({ fy: 2026, email: "a@wohlig.com", person: { name: "A Person" }, declaration });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 2000);
  const old = await form124Pdf({ fy: 2025, email: "a@wohlig.com", person: {}, declaration: { regime: "new", items: [] } });
  assert.equal(old.subarray(0, 5).toString(), "%PDF-");
});
