import test from "node:test";
import assert from "node:assert/strict";
import { nineBox, readCalibration, spread } from "../src/hr-tools-rules.js";

test("calibration: a rating from 1 to 5 is needed", () => {
  assert.equal(readCalibration({}).errors.rating, "Please choose a rating from 1 to 5.");
  assert.ok(readCalibration({ rating: 6 }).errors.rating);
  assert.ok(readCalibration({ rating: "x" }).errors.rating);
  assert.deepEqual(readCalibration({ rating: 4 }).errors, {});
});
test("calibration: moving the manager's rating needs a reason; keeping it does not", () => {
  assert.ok(readCalibration({ rating: 4 }, 3).errors.note);
  assert.deepEqual(readCalibration({ rating: 3 }, 3).errors, {});
  assert.deepEqual(readCalibration({ rating: 4, note: "Led the migration" }, 3).errors, {});
  assert.deepEqual(readCalibration({ rating: 4 }, null).errors, {}, "no manager rating to differ from");
  assert.ok(readCalibration({ rating: 4, note: "x".repeat(1001) }, 3).errors.note);
});
test("calibration: potential is optional, and only low, medium or high", () => {
  assert.equal(readCalibration({ rating: 3, potential: "" }).potential, null);
  assert.equal(readCalibration({ rating: 3, potential: 3 }).potential, 3);
  assert.ok(readCalibration({ rating: 3, potential: 4 }).errors.potential);
});
test("9-box: rating bands and labels, empty until both are known", () => {
  assert.equal(nineBox(5, 3).label, "Star");
  assert.equal(nineBox(4, 1).label, "Trusted professional");
  assert.equal(nineBox(3, 2).label, "Core player");
  assert.equal(nineBox(2, 3).label, "Rough diamond");
  assert.equal(nineBox(1, 1).label, "Needs attention");
  assert.equal(nineBox(3, null), null);
  assert.equal(nineBox(null, 2), null);
});
test("spread: counts per rating, empty ratings left out", () => {
  assert.deepEqual(spread([3, 3, 5, null, 1]), [1, 0, 2, 0, 1]);
});
