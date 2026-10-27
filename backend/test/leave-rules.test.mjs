// Leave balance rules from the shared frontend/leave-rules.cjs: npm test
// A paid leave type can't be booked for more days than are left; the rest can go as unpaid leave in the same request.
import { test } from "node:test";
import assert from "node:assert/strict";
import L from "../../frontend/leave-rules.cjs";

// Joined before tracking started, so the full 14 casual and 6 sick days are there in 2026.
const emp = { name: "Test Person", status: "active", start: "2024-01-01", casualOpening: 0 };
const taken = (type, from, to, days, status = "approved") => ({ type, from, to, half: null, days, paidDays: days, lopDays: 0, status });
// 11 casual days already approved, so 3 are left.
const history = [taken("casual", "2026-02-02", "2026-02-16", 11)];
const bal = L.balances(2026, emp, history, []);
const base = { emp, reason: "Trip", holidays: [], existing: history, bal };

test("3 casual days left after 11 of 14 are used", () => {
  assert.equal(bal.casual.left, 3);
  assert.equal(L.available("casual", bal, history, 2026), 3);
});

test("casual leave within the balance is fine", () => {
  // 2026-11-02 (Mon) to 2026-11-04 (Wed): 3 working days
  assert.deepEqual(L.requestProblems({ ...base, type: "casual", from: "2026-11-02", to: "2026-11-04" }), {});
});

test("casual leave over the balance is refused", () => {
  // 2026-11-02 to 2026-11-30: 21 working days
  const e = L.requestProblems({ ...base, type: "casual", from: "2026-11-02", to: "2026-11-30" });
  assert.match(e.type, /Only 3 days of casual leave left/);
});

test("over the balance with split: 3 casual days, then 18 unpaid", () => {
  assert.deepEqual(L.requestProblems({ ...base, type: "casual", from: "2026-11-02", to: "2026-11-30", split: true }), {});
  const parts = L.planRequest({ ...base, type: "casual", from: "2026-11-02", to: "2026-11-30" });
  assert.deepEqual(parts, [
    { type: "casual", from: "2026-11-02", to: "2026-11-04", half: null, days: 3 },
    { type: "unpaid", from: "2026-11-05", to: "2026-11-30", half: null, days: 18 },
  ]);
});

test("the split skips weekends and holidays at the boundary", () => {
  // Wed 4 Nov to Tue 10 Nov with Fri 6 Nov a holiday: working days 4, 5, 9, 10. 3 casual = 4, 5, 9; unpaid = 10.
  const parts = L.planRequest({ ...base, holidays: ["2026-11-06"], type: "casual", from: "2026-11-04", to: "2026-11-10" });
  assert.deepEqual(parts.map((p) => [p.type, p.from, p.to, p.days]), [["casual", "2026-11-04", "2026-11-09", 3], ["unpaid", "2026-11-10", "2026-11-10", 1]]);
});

test("no casual leave left: casual is refused even with split, unpaid is fine", () => {
  const used = [taken("casual", "2026-02-02", "2026-02-19", 14)];
  const b = L.balances(2026, emp, used, []);
  const args = { ...base, existing: used, bal: b, from: "2026-11-02", to: "2026-11-30" };
  assert.match(L.requestProblems({ ...args, type: "casual", split: true }).type, /No casual leave left/);
  assert.equal(L.planRequest({ ...args, type: "casual" }), null);
  assert.deepEqual(L.requestProblems({ ...args, type: "unpaid" }), {});
});

test("days waiting for approval count against the balance", () => {
  const waiting = [...history, taken("casual", "2026-10-05", "2026-10-06", 2, "pending")];
  assert.equal(L.available("casual", bal, waiting, 2026), 1);
  const e = L.requestProblems({ ...base, existing: waiting, type: "casual", from: "2026-11-02", to: "2026-11-03" });
  assert.match(e.type, /Only 1 day of casual leave left/);
});

test("sick leave follows the same rule", () => {
  const e = L.requestProblems({ ...base, type: "sick", from: "2026-11-02", to: "2026-11-10" });   // 7 days, 6 sick left
  assert.match(e.type, /Only 6 days of sick leave left/);
  const parts = L.planRequest({ ...base, type: "sick", from: "2026-11-02", to: "2026-11-10" });
  assert.deepEqual(parts.map((p) => [p.type, p.days]), [["sick", 6], ["unpaid", 1]]);
});

test("a half day can't be split", () => {
  const used = [taken("casual", "2026-02-02", "2026-02-19", 14)];
  const b = L.balances(2026, emp, used, []);
  const e = L.requestProblems({ ...base, existing: used, bal: b, type: "casual", from: "2026-11-02", to: "2026-11-02", half: "first", split: true });
  assert.match(e.type, /No casual leave left/);
});

test("half a day left can't cover a full day, so no split", () => {
  const b = { ...bal, casual: { ...bal.casual, left: 0.5 } };
  assert.equal(L.planRequest({ ...base, bal: b, type: "casual", from: "2026-11-02", to: "2026-11-03" }), null);
  assert.match(L.requestProblems({ ...base, bal: b, type: "casual", from: "2026-11-02", to: "2026-11-03", split: true }).type, /half day/);
});

test("comp off without credits is refused", () => {
  assert.match(L.requestProblems({ ...base, type: "compoff", from: "2026-11-02", to: "2026-11-02" }).type, /No comp off days available/);
});

test("unpaid leave has no limit", () => {
  assert.deepEqual(L.requestProblems({ ...base, type: "unpaid", from: "2026-11-02", to: "2026-11-30" }), {});
  assert.deepEqual(L.planRequest({ ...base, type: "unpaid", from: "2026-11-02", to: "2026-11-30" }).map((p) => p.days), [21]);
});

// Past dates: sick leave can be applied up to 2 days after; every other type must start today or later.
const today = "2026-11-12";   // a Thursday
const at = (type, from, to = from, extra = {}) => L.requestProblems({ ...base, type, from, to, today, ...extra });

test("today or later is fine for every type", () => {
  for (const t of ["casual", "sick", "unpaid"]) assert.deepEqual(at(t, today), {}, t);
  assert.deepEqual(at("casual", "2026-11-13"), {});
});

test("sick leave can start up to 2 days back", () => {
  assert.deepEqual(at("sick", "2026-11-11"), {});
  assert.deepEqual(at("sick", "2026-11-10", "2026-11-12"), {});
  assert.deepEqual(at("sick", "2026-11-10", "2026-11-10", { half: "first" }), {});
});

test("sick leave more than 2 days back is refused", () => {
  assert.match(at("sick", "2026-11-09").from, /up to 2 days back.*10 Nov 2026/);
});

test("casual or unpaid leave for a past date is refused, and points to sick leave", () => {
  assert.match(at("casual", "2026-11-11").type, /Only sick leave can be for a past date/);
  assert.match(at("unpaid", "2026-11-10").type, /Only sick leave can be for a past date/);
});

test("any type more than 2 days back is refused on the dates", () => {
  for (const t of ["casual", "unpaid", "compoff"]) assert.match(at(t, "2026-11-02").from, /has passed/, t);
});

test("a sick request 2 days back that runs over the balance still splits", () => {
  const parts = L.planRequest({ ...base, type: "sick", from: "2026-11-10", to: "2026-11-20", holidays: [] });   // 9 days, 6 sick left
  assert.deepEqual(parts.map((p) => [p.type, p.days]), [["sick", 6], ["unpaid", 3]]);
  assert.deepEqual(at("sick", "2026-11-10", "2026-11-20", { split: true }), {});
});

test("ill in the last 2 days with no sick leave left: saved as unpaid leave", () => {
  const used = [taken("sick", "2026-03-02", "2026-03-09", 6)];
  const b = L.balances(2026, emp, used, []);
  const args = { ...base, existing: used, bal: b, type: "sick", from: "2026-11-10", to: "2026-11-11", today };
  assert.equal(b.sick.left, 0);
  assert.deepEqual(L.requestProblems({ ...args, split: true }), {});
  assert.match(L.requestProblems(args).type, /No sick leave left/);   // the page always asks for the split; without it, refused
  assert.deepEqual(L.planRequest(args), [{ type: "unpaid", from: "2026-11-10", to: "2026-11-11", half: null, days: 2 }]);
  // a half day too
  assert.deepEqual(L.planRequest({ ...args, to: "2026-11-10", half: "first" }).map((p) => [p.type, p.days]), [["unpaid", 0.5]]);
});

test("no sick leave left for a future date: still refused (choose unpaid leave instead)", () => {
  const used = [taken("sick", "2026-03-02", "2026-03-09", 6)];
  const b = L.balances(2026, emp, used, []);
  const args = { ...base, existing: used, bal: b, type: "sick", from: "2026-11-16", to: "2026-11-16", today };
  assert.match(L.requestProblems({ ...args, split: true }).type, /No sick leave left/);
  assert.equal(L.planRequest(args), null);
});
