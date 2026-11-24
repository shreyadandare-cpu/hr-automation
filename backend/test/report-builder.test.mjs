import test from "node:test";
import assert from "node:assert/strict";
import { DATASETS, readReport, readSaved, reportSql, shapeRows, toCsv } from "../src/report-builder-rules.js";
import { deptOf } from "../src/payroll/store.js";

test("report: a dataset and at least one known column are needed", () => {
  assert.ok(readReport({}).errors.dataset);
  assert.ok(readReport({ dataset: "people" }).errors.columns);
  assert.ok(readReport({ dataset: "people", columns: ["name", "salary"] }).errors.columns, "an unknown column is refused");
  assert.ok(readReport({ dataset: "people; DROP TABLE employees", columns: ["name"] }).errors.dataset);
  assert.deepEqual(readReport({ dataset: "people", columns: ["name", "email"] }).errors, {});
});
test("report: filter values go in as parameters, never into the SQL", () => {
  const q = readReport({ dataset: "leave", columns: ["name"], filters: { status: "approved", from: { from: "2026-04-01", to: "2026-06-30" } } });
  assert.deepEqual(q.errors, {});
  assert.deepEqual(q.params, ["approved", "2026-04-01", "2026-06-30"]);
  const sql = reportSql(q.ds, q.columns, q.where, null, 101);
  assert.ok(!sql.includes("approved") && !sql.includes("2026-04-01"), sql);
  assert.match(sql, /LIMIT 102$/);
});
test("report: select values must come from the list", () => {
  assert.ok(readReport({ dataset: "leave", columns: ["name"], filters: { status: "x' OR 1=1 --" } }).errors.status);
  assert.ok(readReport({ dataset: "people", columns: ["name"], filters: { dept: "Nowhere" } }, { depts: ["HR"] }).errors.dept);
  assert.deepEqual(readReport({ dataset: "people", columns: ["name"], filters: { dept: "HR" } }, { depts: ["HR"] }).after, [{ column: "dept", value: "HR" }]);
  assert.ok(readReport({ dataset: "people", columns: ["name"], filters: { nosuch: "1" } }).errors.nosuch);
});
test("report: dates are checked, and punches need a range of at most 400 days", () => {
  assert.ok(readReport({ dataset: "leave", columns: ["name"], filters: { from: { from: "2026-02-30" } } }).errors.from);
  assert.ok(readReport({ dataset: "leave", columns: ["name"], filters: { from: { from: "2026-05-01", to: "2026-04-01" } } }).errors.from);
  assert.ok(readReport({ dataset: "punches", columns: ["name"] }).errors.date);
  assert.ok(readReport({ dataset: "punches", columns: ["name"], filters: { date: { from: "2024-01-01", to: "2026-01-01" } } }).errors.date);
  assert.deepEqual(readReport({ dataset: "punches", columns: ["name"], filters: { date: { from: "2026-11-01", to: "2026-11-30" } } }).errors, {});
});
test("report: a team limit adds a parameter for the team", () => {
  const q = readReport({ dataset: "people", columns: ["name"] });
  assert.match(reportSql(q.ds, q.columns, q.where, 1), /lower\(e\.work_email\) = ANY\(\$1\)/);
});
test("rows: labels for codes, the department worked out, and the department filter", () => {
  const ds = DATASETS.people;
  const rows = [{ name: "A", status: "active", dept: null, _title: "HR Executive" }, { name: "B", status: "offboarded", dept: "Sales", _title: "x" }];
  assert.deepEqual(shapeRows(ds, ["name", "status", "dept"], rows.map((r) => ({ ...r })), [], deptOf), [["A", "Working", "HR"], ["B", "Left", "Sales"]]);
  assert.deepEqual(shapeRows(ds, ["name"], rows.map((r) => ({ ...r })), [{ column: "dept", value: "HR" }], deptOf), [["A"]]);
});
test("csv: quotes, a byte-order mark, and formulas made harmless", () => {
  const csv = toCsv(["Name", "Note"], [["Asha, Rao", '=HYPERLINK("x")'], ["B", "-5"], ["C", "+91 98"]]);
  assert.ok(csv.startsWith("﻿Name,Note\r\n"));
  assert.ok(csv.includes('"Asha, Rao","\'=HYPERLINK(""x"")"'), csv);
  assert.ok(csv.includes("B,-5\r\n"), "a negative number stays a number");
  assert.ok(csv.includes("C,'+91 98"), csv);
});
test("saved: a name is needed", () => {
  assert.ok(readSaved({ dataset: "people", columns: ["name"] }).errors.name);
  assert.deepEqual(readSaved({ name: "Joiners", dataset: "people", columns: ["name"] }).errors, {});
});
