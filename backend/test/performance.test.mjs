/* OKRs and 1:1 meetings (performance-rules.js). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { health, krProgress, objectiveProgress, quarterOf, readItem, readKeyResult, readMeeting, readObjective } from "../src/performance-rules.js";
import { PERM } from "../src/access-rules.js";

test("quarters follow the Indian financial year", () => {
  assert.equal(quarterOf("2026-04-01"), "2026-Q1"); assert.equal(quarterOf("2026-11-24"), "2026-Q3"); assert.equal(quarterOf("2027-02-10"), "2026-Q4");
});
test("a key result's progress runs from its start to its target, either way, within 0 to 100", () => {
  assert.equal(krProgress({ start: 20, target: 50, current: 35 }), 50);
  assert.equal(krProgress({ start: 20, target: 50, current: 80 }), 100);
  assert.equal(krProgress({ start: 20, target: 50, current: 10 }), 0);
  assert.equal(krProgress({ start: 10, target: 2, current: 6 }), 50, "a target below the start counts down, like days to close a ticket");
});
test("an objective is the average of its key results, else of its linked goals; health compares with the quarter gone", () => {
  assert.equal(objectiveProgress([{ start: 0, target: 10, current: 5 }, { start: 0, target: 4, current: 4 }]), 75);
  assert.equal(objectiveProgress([], [{ progress: 40 }, { progress: 60 }]), 50);
  assert.equal(objectiveProgress([], []), 0);
  assert.equal(health(100, 0.2), "done"); assert.equal(health(45, 0.5), "on track"); assert.equal(health(30, 0.5), "at risk"); assert.equal(health(5, 0.5), "behind");
});
test("objectives, key results, meetings and items are checked before saving", () => {
  assert.deepEqual(readObjective({ title: "Faster launches", level: "company", quarter: "2026-Q3" }).errors, {});
  assert.ok(readObjective({ title: "", level: "team", quarter: "2026-Q3" }).errors.title);
  assert.ok(readObjective({ title: "x", level: "everyone", quarter: "2026-Q3" }).errors.level);
  assert.ok(readObjective({ title: "x", level: "team", quarter: "2026" }).errors.quarter);
  assert.deepEqual(readKeyResult({ title: "Clients", start: "20", target: "50" }).value, { title: "Clients", unit: "", start: 20, target: 50, current: 20 });
  assert.ok(readKeyResult({ title: "Clients", start: "20", target: "20" }).errors.target);
  assert.ok(readKeyResult({ title: "Clients", target: "lots" }).errors.target);
  assert.ok(readMeeting({ with: "a@wohlig.com", on: "2026-11-01" }, "2026-11-24").errors.on, "not in the past");
  assert.deepEqual(readMeeting({ with: "A@wohlig.com", on: "2026-12-01" }, "2026-11-24").value, { withEmail: "a@wohlig.com", on: "2026-12-01" });
  assert.ok(readItem({ kind: "action", text: "" }).errors.text);
  assert.ok(readItem({ kind: "note", text: "x" }).errors.kind);
  assert.equal(PERM["okrs.manage"].team, false);
});
