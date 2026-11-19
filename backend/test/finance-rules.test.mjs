import test from "node:test";
import assert from "node:assert/strict";
import { annualStatement, contractorQuarters, costByDept, costByProject, dueDates, ecr, esicSheet, fyOf, fyPeriods, gratuity, isFy, journal, lwf, quarterOf, readContractorPayment, readProof, readShare, sharesOf, statutory, tallyXml } from "../src/finance-rules.js";

// Two payslip summaries shaped like payroll/engine.js writes them.
const A = { basic: 30000, hra: 12000, allowances: 18000, reimbursements: 1500, gross: 61500, pf: 1800, esic: 0, pt: 200, tds: 2500, lop: 2000, otherDeductions: 300, totalDeductions: 6800, net: 54700, employerPf: 1800, taxable: 58000 };
const B = { basic: 9000, hra: 3600, allowances: 5400, reimbursements: 0, gross: 18000, pf: 1080, esic: 135, pt: 200, tds: 0, lop: 0, otherDeductions: 0, totalDeductions: 1415, net: 16585, employerPf: 1080, taxable: 18000 };
const lines = [
  { email: "a@wohlig.com", name: "A", dept: "Engineering", s: A },
  { email: "b@wohlig.com", name: "B", dept: "", s: B },
];

test("financial year, its months and the TDS quarter", () => {
  assert.equal(fyOf("2026-11"), "2026-27");
  assert.equal(fyOf("2027-03"), "2026-27");
  assert.equal(fyOf("2027-04"), "2027-28");
  assert.equal(fyOf("1999-12"), "1999-00");
  assert.deepEqual(fyPeriods("2026-27").slice(0, 2), ["2026-04", "2026-05"]);
  assert.equal(fyPeriods("2026-27")[11], "2027-03");
  assert.equal(fyPeriods("2026-27").length, 12);
  assert.deepEqual(["2026-04", "2026-09", "2026-12", "2027-01"].map(quarterOf), ["Q1", "Q2", "Q3", "Q4"]);
  assert.ok(isFy("2026-27")); assert.ok(isFy("1999-00")); assert.ok(!isFy("2026-28")); assert.ok(!isFy("2026"));
});

test("statutory dues add up per head and count who is covered", () => {
  const { rows, totals } = statutory(lines);
  assert.equal(rows[0].salary, 58000);            // 61,500 less 1,500 reimbursement less 2,000 loss of pay
  assert.equal(totals.pf, 2880); assert.equal(totals.employerPf, 2880); assert.equal(totals.pfDeposit, 5760);
  assert.equal(totals.esic, 135); assert.equal(totals.employerEsic, 585); assert.equal(totals.esicDeposit, 720); assert.equal(totals.pt, 400); assert.equal(totals.tds, 2500);
  assert.equal(totals.pfPeople, 2); assert.equal(totals.esicPeople, 1); assert.equal(totals.tdsPeople, 1);
});

test("due dates: PF and ESIC on the 15th, TDS on the 7th, March TDS on 30 April", () => {
  assert.deepEqual(dueDates("2026-10"), { pf: "2026-11-15", esic: "2026-11-15", tds: "2026-11-07" });
  assert.deepEqual(dueDates("2026-12"), { pf: "2027-01-15", esic: "2027-01-15", tds: "2027-01-07" });
  assert.equal(dueDates("2027-03").tds, "2027-04-30");
  assert.equal(dueDates("2027-03").pf, "2027-04-15");
});

test("the journal balances and net pay is what staff are owed", () => {
  const j = journal([A, B]);
  assert.ok(j.balanced);
  assert.equal(j.debit, j.credit);
  const of = (name) => j.lines.find((l) => l.ledger === name);
  assert.equal(of("Salaries and wages").debit, 76000);         // 58,000 + 18,000
  assert.equal(of("Staff reimbursements").debit, 1500);
  assert.equal(of("Provident fund payable").credit, 5760);
  assert.equal(of("Other recoveries from staff").credit, 300);
  assert.equal(of("Salaries payable").credit, 71285);
  assert.equal(of("ESIC payable").credit, 720);
  assert.equal(j.debit, 76000 + 1500 + 2880 + 585);
});

test("the journal leaves out ledgers with nothing in them", () => {
  const j = journal([B]);
  assert.ok(j.balanced);
  assert.ok(!j.lines.some((l) => l.ledger === "TDS on salaries payable"));
  assert.ok(!j.lines.some((l) => l.ledger === "Staff reimbursements"));
});

test("paise do not drift over many payslips", () => {
  const odd = { ...B, gross: 18000.1, net: 16585.1, taxable: 18000.1 };
  const j = journal(Array.from({ length: 300 }, () => odd));
  assert.ok(j.balanced);
  assert.equal(j.lines.find((l) => l.ledger === "Salaries and wages").debit, 5400030);
});

test("cost by department and by project add up to the same total", () => {
  const dept = costByDept(lines);
  assert.equal(dept[0].name, "Engineering"); assert.equal(dept[0].total, 58000 + 1500 + 1800);
  assert.equal(dept[1].name, "Not set"); assert.equal(dept[1].total, 19665);
  const proj = costByProject(lines, [{ email: "A@wohlig.com", project: "Apollo" }, { email: "a@wohlig.com", project: "Zeus" }, { email: "a@wohlig.com", project: "Apollo" }]);
  const total = (list) => Math.round(list.reduce((n, g) => n + g.total * 100, 0));
  assert.equal(total(proj), total(dept));
  assert.equal(proj.find((p) => p.name === "Apollo").total, 30650);
  assert.equal(proj.find((p) => p.name === "Apollo").people, 0.5);
  assert.equal(proj.find((p) => p.name === "Not allocated").total, 19665);
});

test("an odd paisa goes to the last project so nothing is lost", () => {
  const one = [{ email: "c@wohlig.com", s: { ...B, gross: 100.01, reimbursements: 0, lop: 0, employerPf: 0, esic: 0 } }];
  const proj = costByProject(one, [{ email: "c@wohlig.com", project: "X" }, { email: "c@wohlig.com", project: "Y" }, { email: "c@wohlig.com", project: "Z" }]);
  assert.equal(Math.round(proj.reduce((n, g) => n + g.total * 100, 0)), 10001);
});

test("gratuity: 15 ÷ 26 × basic × years, payable after five years", () => {
  const g = gratuity({ start: "2020-01-10", basic: 26000, asOf: "2026-11-19" });   // 6 years 10 months → 7 years
  assert.equal(g.completedYears, 6); assert.equal(g.months, 10); assert.equal(g.serviceYears, 7);
  assert.ok(g.eligible); assert.equal(g.amount, 105000);
  const young = gratuity({ start: "2023-06-01", basic: 26000, asOf: "2026-11-19" });   // 3 years 5 months
  assert.ok(!young.eligible); assert.equal(young.serviceYears, 3); assert.equal(young.amount, 45000);
});

test("gratuity: exactly six months does not round up, a day more does", () => {
  assert.equal(gratuity({ start: "2020-05-19", basic: 26000, asOf: "2026-11-19" }).serviceYears, 6);
  assert.equal(gratuity({ start: "2020-05-18", basic: 26000, asOf: "2026-11-19" }).serviceYears, 7);
  assert.equal(gratuity({ start: "2021-11-20", basic: 26000, asOf: "2026-11-19" }).completedYears, 4);
  assert.ok(!gratuity({ start: "2021-11-20", basic: 26000, asOf: "2026-11-19" }).eligible);
  assert.ok(gratuity({ start: "2021-11-19", basic: 26000, asOf: "2026-11-19" }).eligible);
});

test("gratuity: capped at the legal ceiling, and nothing without dates", () => {
  const g = gratuity({ start: "1996-01-01", basic: 300000, asOf: "2026-11-19" });
  assert.equal(g.amount, 2000000); assert.ok(g.capped);
  assert.equal(gratuity({ start: null, basic: 26000, asOf: "2026-11-19" }).amount, 0);
  assert.equal(gratuity({ start: "2027-01-01", basic: 26000, asOf: "2026-11-19" }).amount, 0);
});

test("the annual statement totals the year and splits TDS by quarter", () => {
  const y = annualStatement([{ period: "2026-07", status: "draft", s: A }, { period: "2026-04", status: "paid", s: A }, { period: "2027-01", status: "paid", s: B }]);
  assert.deepEqual(y.rows.map((r) => r.period), ["2026-04", "2026-07", "2027-01"]);
  assert.equal(y.totals.months, 3); assert.equal(y.totals.draftMonths, 1);
  assert.equal(y.totals.taxable, 134000); assert.equal(y.totals.tds, 5000); assert.equal(y.totals.pf, 4680);
  assert.deepEqual(y.quarters.map((q) => q.tds), [2500, 2500, 0, 0]);
  assert.equal(y.quarters[3].months, 1);
});

test("a proof note needs a real line, a known state, and a reason when it is rejected", () => {
  assert.deepEqual(readProof({ index: 1, status: "verified" }, 3).errors, {});
  assert.ok(readProof({ index: 3, status: "verified" }, 3).errors.index);
  assert.ok(readProof({ index: 0, status: "lost" }, 3).errors.status);
  assert.ok(readProof({ index: 0, status: "rejected" }, 3).errors.note);
  assert.deepEqual(readProof({ index: 0, status: "rejected", note: " The receipt is for last year. " }, 3).note, "The receipt is for last year.");
  assert.equal(readProof({ index: 0, status: "waiting" }, 1).status, "waiting");
});

test("employer ESIC is 3.25% rounded up, only for people who are covered", () => {
  const { rows } = statutory([{ email: "x", name: "X", s: { ...B, gross: 18001 } }, { email: "y", name: "Y", s: A }]);
  assert.equal(rows[0].employerEsic, 586);        // 585.03 rounds up to the next rupee
  assert.equal(rows[1].employerEsic, 0);
});

test("project shares: percentages first, the rest split equally, never more than the whole", () => {
  const w = (list) => sharesOf(list).map((x) => Math.round(x.weight * 1000) / 1000);
  assert.deepEqual(w([{ project: "A" }, { project: "B" }]), [0.5, 0.5]);
  assert.deepEqual(w([{ project: "A", percent: 70 }, { project: "B" }, { project: "C" }]), [0.7, 0.15, 0.15]);
  assert.deepEqual(w([{ project: "A", percent: 80 }, { project: "B", percent: 80 }]), [0.5, 0.5]);
  assert.deepEqual(w([{ project: "A", percent: 60 }]), [0.6]);
  const proj = costByProject([{ email: "a@wohlig.com", s: A }], [{ email: "a@wohlig.com", project: "Apollo", percent: 60 }]);
  assert.equal(proj.find((p) => p.name === "Apollo").total, 36780);          // 60% of 61,300
  assert.equal(proj.find((p) => p.name === "Not allocated").total, 24520);
  assert.deepEqual(readShare({ percent: "40" }), { percent: 40, errors: {} });
  assert.equal(readShare({ percent: "" }).percent, null);
  assert.ok(readShare({ percent: 0 }).errors.percent); assert.ok(readShare({ percent: 12.5 }).errors.percent);
});

test("labour welfare fund applies only with the June and December salaries", () => {
  assert.equal(lwf("2026-10", lines).applies, false); assert.equal(lwf("2026-10", lines).total, 0);
  const june = lwf("2026-06", lines);
  assert.ok(june.applies); assert.equal(june.people, 2); assert.equal(june.employee, 50); assert.equal(june.employer, 150); assert.equal(june.due, "2026-07-15");
  assert.equal(lwf("2026-12", lines).due, "2027-01-15");
});

test("the PF return file has one line per member and agrees with the deduction", () => {
  const e = ecr([{ name: "A#~#One", pfNumber: "100200300400", lopDays: 2, s: A }, { name: "B Two", pfNumber: "MH/1234", lopDays: 0, s: B }, { name: "No PF", s: { ...B, pf: 0 } }]);
  assert.equal(e.rows.length, 2);
  assert.equal(e.text.split("\n")[0], "100200300400#~#A   One#~#58000#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#2#~#0");
  assert.equal(e.text.split("\n")[1], "#~#B Two#~#18000#~#9000#~#9000#~#9000#~#1080#~#750#~#330#~#0#~#0");
  assert.deepEqual(e.missing, ["B Two"]);
});

test("the ESIC sheet lists only covered people", () => {
  assert.deepEqual(esicSheet([{ name: "A", paidDays: 29, s: A }, { name: "B", paidDays: 31, s: B }]), [["", "B", 31, 18000, "", ""]]);
});

test("the Tally file carries debits as negative amounts and escapes names", () => {
  const x = tallyXml({ lines: [{ ledger: "Salaries & wages", debit: 100.5, credit: 0 }, { ledger: "Salaries payable", debit: 0, credit: 100.5 }] }, "2026-10-31", "Salaries <Oct>");
  assert.ok(x.includes("<DATE>20261031</DATE>"));
  assert.ok(x.includes("<LEDGERNAME>Salaries &amp; wages</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-100.50</AMOUNT>"));
  assert.ok(x.includes("<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>100.50</AMOUNT>"));
  assert.ok(x.includes("Salaries &lt;Oct&gt;"));
});

test("a contractor payment: the section's rate, 20% without a PAN, and only a masked PAN is kept", () => {
  const ok = readContractorPayment({ name: " Asha  Rao ", pan: "abcde1234f", section: "194J", paidOn: "2026-10-05", amount: "50,000" });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.name, "Asha Rao"); assert.equal(ok.panMasked, "XXXXXX234F"); assert.equal(ok.rate, 10); assert.equal(ok.tdsMinor, 500000);
  const noPan = readContractorPayment({ name: "Ravi", section: "194C", paidOn: "2026-10-05", amount: 10000, rate: 1 });
  assert.equal(noPan.rate, 20); assert.equal(noPan.tdsMinor, 200000); assert.equal(noPan.hasPan, false);
  const custom = readContractorPayment({ name: "Ravi", pan: "ABCDE1234F", section: "194C", paidOn: "2026-10-05", amount: 10050, rate: 1 });
  assert.equal(custom.tdsMinor, 10100);           // 100.50 rounds to the rupee
  const bad = readContractorPayment({ pan: "123", section: "194Z", paidOn: "2026-02-31", amount: 0, rate: 50 });
  for (const k of ["name", "pan", "section", "amount", "rate"]) assert.ok(bad.errors[k], k);
});

test("contractor payments total by quarter and section", () => {
  const q = contractorQuarters([{ paidOn: "2026-10-05", section: "194J", amountMinor: 5000000, tdsMinor: 500000 }, { paidOn: "2026-12-20", section: "194J", amountMinor: 1000000, tdsMinor: 100000 }, { paidOn: "2026-05-01", section: "194C", amountMinor: 100000, tdsMinor: 2000 }]);
  assert.deepEqual(q.map((x) => [x.quarter, x.section, x.payments, x.amount, x.tds]), [["Q1", "194C", 1, 1000, 20], ["Q3", "194J", 2, 60000, 6000]]);
});
