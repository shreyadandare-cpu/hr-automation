import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { DEFAULT_TAX_RULES } from "../src/payroll/tax-defaults.js";
import { annualTax } from "../src/payroll/tax.js";
import { buildSets, previewFromFile, templateCsv, templateXlsx } from "../src/payroll/tax-import.js";

const saved = DEFAULT_TAX_RULES.map(({ fy, regime, rules }) => ({ fy, regime, rules }));

test("a template filled back in gives the same rules (CSV)", async () => {
  const out = await previewFromFile(Buffer.from(templateCsv(saved)), saved);
  assert.deepEqual(out.errors, []);
  assert.equal(out.sets.length, saved.length);
  for (const s of out.sets) { assert.deepEqual(s.problems, []); assert.deepEqual(s.changes, [], `${s.fy} ${s.regime} should be unchanged`); }
});

test("a template filled back in gives the same rules (Excel)", async () => {
  const out = await previewFromFile(await templateXlsx(saved), saved);
  assert.deepEqual(out.errors, []);
  for (const s of out.sets) assert.deepEqual(s.changes, [], `${s.fy} ${s.regime} should be unchanged`);
});

test("changes are described, and the uploaded rules are the ones used", async () => {
  const csv = templateCsv(saved).replace("2026-27,New,Standard deduction,,,75000", "2026-27,New,Standard deduction,,,80000").replace("2026-27,New,Cess,,4,", "2026-27,New,Cess,,5,");
  const out = await previewFromFile(Buffer.from(csv), saved);
  const s = out.sets.find((x) => x.fy === "2026-27" && x.regime === "new");
  assert.deepEqual(s.changes, ["Standard deduction ₹75,000 → ₹80,000", "Cess 4% → 5%"]);
  assert.equal(s.rules.standardDeduction, 80000);
  assert.equal(s.rules.cessRate, 5);
  assert.ok(annualTax(s.rules, 1500000).total > 0);
});

test("a new financial year starts from last year's rules for what the sheet leaves out", () => {
  const rows = [["Financial year", "Regime", "Item", "Limit (₹)", "Rate (%)", "Amount (₹)", "Note"], ["2027-28", "Old", "Standard deduction", "", "", "55000", ""]];
  const { sets, errors } = buildSets(rows, saved);
  assert.deepEqual(errors, []);
  assert.equal(sets[0].isNew, true);
  assert.equal(sets[0].copiedFrom, "2026-27");
  assert.equal(sets[0].rules.standardDeduction, 55000);
  assert.deepEqual(sets[0].rules.slabs, saved.find((x) => x.fy === "2026-27" && x.regime === "old").rules.slabs);
  assert.equal(sets[0].rules.caps.section80C, 150000);
});

test("bad rows are reported with their row number and nothing is guessed", () => {
  const rows = [["Financial year", "Regime", "Item", "Limit (₹)", "Rate (%)", "Amount (₹)", "Note"],
    ["2026-27", "New", "Slab", "abc", "5", "", ""],
    ["2026/27", "New", "Cess", "", "4", "", ""],
    ["2026-27", "Middle", "Cess", "", "4", "", ""],
    ["2026-27", "New", "Bonus", "", "", "1", ""],
    ["2026-27", "Old", "Cap 99Z", "", "", "1", ""],
    ["2026-27", "New", "Surcharge", "", "10", "", ""]];
  const { errors } = buildSets(rows, saved);
  assert.ok(errors.some((e) => e.startsWith("Row 2") && /Limit must be a number/.test(e)));
  assert.ok(errors.some((e) => e.startsWith("Row 4") && /regime/.test(e)));
  assert.ok(errors.some((e) => e.startsWith("Row 5") && /not an item/.test(e)));
  assert.ok(errors.some((e) => e.startsWith("Row 6") && /not a cap/.test(e)));
  assert.ok(errors.some((e) => e.startsWith("Row 7") && /Limit \(income above\)/.test(e)));
});

test("slabs that don't end with an open top slab are flagged as a problem", () => {
  const rows = [["Financial year", "Regime", "Item", "Limit (₹)", "Rate (%)", "Amount (₹)", "Note"],
    ["2026-27", "New", "Slab", "400000", "0", "", ""], ["2026-27", "New", "Slab", "800000", "5", "", ""]];
  const { sets } = buildSets(rows, saved);
  assert.ok(sets[0].problems.some((p) => /last slab/i.test(p)));
});

test("a file with no header, or no rules, is refused with a clear message", async () => {
  assert.match((await previewFromFile(Buffer.from("hello,world\n1,2\n"), saved)).errors[0], /header row/);
  const wb = new ExcelJS.Workbook(); wb.addWorksheet("x").addRow(["Financial year", "Regime", "Item"]);
  assert.match((await previewFromFile(Buffer.from(await wb.xlsx.writeBuffer()), saved)).errors[0], /no rules/);
});

test("amounts typed the way people type them still read: commas, rupee signs, lakh-free", () => {
  const rows = [["Financial year", "Regime", "Item", "Limit (₹)", "Rate (%)", "Amount (₹)", "Note"], ["FY 2026-27", "new regime", "Standard deduction", "", "", "₹ 75,000", ""]];
  const { sets, errors } = buildSets(rows, saved);
  assert.deepEqual(errors, []);
  assert.equal(sets[0].rules.standardDeduction, 75000);
});

test("rules read back from the database (keys in another order) are not reported as changed", async () => {
  const reorder = (v) => (Array.isArray(v) ? v.map(reorder) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => b.length - a.length || (a < b ? 1 : -1)).map(([k, x]) => [k, reorder(x)])) : v);
  const fromDb = saved.map((x) => ({ ...x, rules: reorder(x.rules) }));
  const out = await previewFromFile(Buffer.from(templateCsv(fromDb)), fromDb);
  for (const s of out.sets) assert.deepEqual(s.changes, [], `${s.fy} ${s.regime}`);
});
