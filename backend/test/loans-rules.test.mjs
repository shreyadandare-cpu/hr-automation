/* Company loans: the instalment arithmetic and the payslip line. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, schedule, progress, addMonths, money } from "../src/loans-rules.js";
import { computeLine } from "../src/payroll/engine.js";

test("the instalment is the approved amount over the months", () => {
  assert.deepEqual(plan(20000, 2), { monthly: 10000, count: 2, last: 10000 });
  assert.deepEqual(plan(60000, 6), { monthly: 10000, count: 6, last: 10000 });
  assert.deepEqual(plan(30000, 3), { monthly: 10000, count: 3, last: 10000 });
  assert.deepEqual(plan(0, 3), { monthly: 0, count: 0, last: 0 });
});

test("an amount that does not divide evenly is rounded up and the last instalment clears the exact balance", () => {
  const p = plan(10000, 3), rows = schedule(10000, 3, "2026-11");
  assert.deepEqual(p, { monthly: 3333.34, count: 3, last: 3333.32 });
  assert.equal(money(rows.reduce((n, r) => n + r.amount, 0)), 10000);
  assert.deepEqual(rows.map((r) => r.month), ["2026-11", "2026-12", "2027-01"]);
  for (const [amount, months] of [[1000, 7], [12345.67, 5], [999.99, 11], [50001, 36], [1, 3]]) {
    const s = schedule(amount, months, "2026-01");
    assert.equal(money(s.reduce((n, r) => n + r.amount, 0)), money(amount), `${amount} over ${months}`);
    assert.ok(s.every((r) => r.amount > 0 && r.amount <= s[0].amount), `no instalment above the first: ${amount} over ${months}`);
  }
});

test("months roll over the year", () => {
  assert.equal(addMonths("2026-11", 1), "2026-12");
  assert.equal(addMonths("2026-11", 2), "2027-01");
  assert.equal(addMonths("2026-01", 24), "2028-01");
});

test("progress marks paid, due and pending months and the balance never goes below zero", () => {
  const p = progress({ amount: 20000, months: 2, firstMonth: "2026-11", recovered: new Map([["2026-11", 10000]]), thisMonth: "2026-12" });
  assert.deepEqual(p.rows.map((r) => r.status), ["paid", "due"]);
  assert.equal(p.repaid, 10000); assert.equal(p.outstanding, 10000); assert.equal(p.percent, 50); assert.equal(p.paidCount, 1);
  const done = progress({ amount: 20000, months: 2, firstMonth: "2026-11", recovered: new Map([["2026-11", 10000], ["2026-12", 10000]]), thisMonth: "2027-01" });
  assert.equal(done.outstanding, 0); assert.equal(done.percent, 100);
  assert.equal(progress({ amount: 100, months: 1, firstMonth: "2026-11", recovered: new Map(), total: 150, thisMonth: "2026-11" }).outstanding, 0);
});

test("payroll shows a loan instalment as its own line, Company Loan Repayment, and takes it off the net salary", () => {
  const structure = { earnings: [{ name: "Basic", amount: 50000 }], professionalTax: 0, tdsMode: "manual", tdsMonthly: 0, otherDeductions: [{ name: "Other", amount: 2000 }] };
  const line = computeLine({ period: "2026-11", employee: { start: "2020-01-01" }, structure, tax: {}, advanceRecoveries: [{ id: 9, reason: "Company loan LN-2026-0001", amount: 10000, loan: true }] });
  const loan = line.deductions.filter((d) => d.code === "advance");
  assert.deepEqual(loan.map((d) => [d.name, d.amount, d.advanceId]), [["Company Loan Repayment", 10000, 9]]);
  assert.equal(line.summary.net, 50000 - 2000 - 10000);
});
