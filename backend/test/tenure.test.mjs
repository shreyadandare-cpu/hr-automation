import test from "node:test";
import assert from "node:assert/strict";
import { tenureText } from "../../frontend/src/lib/tenure.js";

test("time with the company, in whole years and months", () => {
  assert.equal(tenureText("2022-07-11", "2026-11-24"), "4 years, 4 months");
  assert.equal(tenureText("2022-07-11", "2026-11-10"), "4 years, 3 months", "the last month is not complete until the day of joining comes round");
  assert.equal(tenureText("2022-07-11", "2023-07-11"), "1 year");
  assert.equal(tenureText("2026-04-01", "2026-11-24"), "7 months");
  assert.equal(tenureText("2026-11-10", "2026-11-24"), "Less than a month");
  assert.equal(tenureText("2026-12-01", "2026-11-24"), "Not started yet");
  assert.equal(tenureText("", "2026-11-24"), "");
  assert.equal(tenureText("2026-05-31", "2026-06-30"), "Less than a month");
});
