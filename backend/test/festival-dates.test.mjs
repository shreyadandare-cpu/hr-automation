import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFestivalDay } from "../src/festivals.js";

test("a festival date must be a real day within a year back and five years ahead", () => {
  const today = "2026-11-19";
  assert.equal(checkFestivalDay("2027-10-29", today), null);
  assert.equal(checkFestivalDay("2026-11-08", today), null);
  assert.match(checkFestivalDay("2027-02-30", today), /choose a date/);
  assert.match(checkFestivalDay("29/10/2027", today), /choose a date/);
  assert.match(checkFestivalDay(undefined, today), /choose a date/);
  assert.match(checkFestivalDay("2024-01-01", today), /last year/);
  assert.match(checkFestivalDay("2033-01-01", today), /five years/);
});
