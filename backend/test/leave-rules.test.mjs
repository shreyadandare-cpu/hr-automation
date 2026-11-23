// Leave balance rules from the shared frontend/leave-rules.cjs: npm test
// A paid leave type can't be booked for more days than are left; the rest can go as unpaid leave in the same request.
import { test } from "node:test";
import assert from "node:assert/strict";
import L from "../../frontend/leave-rules.cjs";

// Joined before tracking started, so the full 12 casual and 6 sick days are there in 2026.
const emp = { name: "Test Person", status: "active", start: "2024-01-01", casualOpening: 0 };
const taken = (type, from, to, days, status = "approved") => ({ type, from, to, half: null, days, paidDays: days, lopDays: 0, status });
// 9 casual days already approved, so 3 are left.
const history = [taken("casual", "2026-02-02", "2026-02-16", 9)];
const bal = L.balances(2026, emp, history, []);
const base = { emp, reason: "Trip", holidays: [], existing: history, bal };

test("3 casual days left after 9 of 12 are used", () => {
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

// ---- balances brought over from a previous leave system (employees.leave_opening) ----
const brought = { ...emp, start: "2022-01-01", openings: { asOf: "2026-11-23", casual: 4, sick: 1.5, compoff: 2.5 } };
test("brought-over balances replace the policy figures for that year", () => {
  const b = L.balances(2026, brought, [taken("casual", "2026-03-02", "2026-03-10", 7)], []);   // taken before the date: already inside the figures
  assert.equal(b.casual.left, 4);
  assert.equal(b.sick.left, 1.5);
  assert.equal(b.compoff.left, 2.5);
  assert.deepEqual(b.casual.opening, { asOf: "2026-11-23", balance: 4 });
});

test("only leave after the date comes off a brought-over balance", () => {
  const later = [taken("casual", "2026-11-23", "2026-11-23", 1), taken("casual", "2026-12-01", "2026-12-02", 2), taken("sick", "2026-12-03", "2026-12-03", 1), taken("compoff", "2026-12-04", "2026-12-04", 1)];
  const b = L.balances(2026, brought, later, []);
  assert.equal(b.casual.left, 2);     // 4 less the 2 days after 23 Nov (the 23rd is inside the figure)
  assert.equal(b.sick.left, 0.5);
  assert.equal(b.compoff.left, 1.5);
});

test("comp offs earned after the date are added to a brought-over balance", () => {
  const b = L.balances(2026, brought, [], [{ workedOn: "2026-11-29", days: 1, status: "approved" }, { workedOn: "2026-11-01", days: 1, status: "approved" }]);
  assert.equal(b.compoff.left, 3.5);   // 2.5 + the one after 23 Nov; the one before is already inside it
});

test("a brought-over casual balance carries into the next year; sick and comp off start again", () => {
  const b = L.balances(2027, brought, [taken("casual", "2026-12-01", "2026-12-01", 1)], []);
  assert.equal(b.casual.carried, 3);
  assert.equal(b.casual.left, 3 + 12);
  assert.equal(b.sick.quota, 6);
  assert.equal(b.compoff.left, 0);
});

test("a type with no brought-over figure keeps the policy figures", () => {
  const b = L.balances(2026, { ...emp, openings: { asOf: "2026-11-23", casual: 4 } }, [], []);
  assert.equal(b.casual.left, 4);
  assert.equal(b.sick.left, 6);
  assert.equal(b.sick.opening, undefined);
});

test("a casual balance of zero is still a brought-over figure", () => {
  const b = L.balances(2026, { ...emp, openings: { asOf: "2026-11-23", casual: 0 } }, [], []);
  assert.equal(b.casual.left, 0);
  assert.equal(L.available("casual", b, [], 2026), 0);
});

test("leaving: a brought-over casual balance is paid out as it stands", () => {
  const s = L.exitSettlement({ emp: brought, lastDay: "2026-12-15", requests: [], compOffs: [], monthlyGross: 30000, holidays: [] });
  assert.equal(s.casualLeft, 4);
  assert.equal(s.quota, 0);
  assert.equal(s.encashment, 4000);
});

test("with the old system's quota and days used, the pages can show them as it did", () => {
  const rich = { ...emp, start: "2022-01-01", openings: { asOf: "2026-11-23", casual: 0, casualQuota: 12, casualUsed: 16, sick: 1.5, sickQuota: 6, sickUsed: 4.5, compoff: 1.5, compoffUsed: 8.5 } };
  const b = L.balances(2026, rich, [taken("casual", "2026-12-01", "2026-12-01", 0)], []);
  assert.deepEqual([b.casual.left, b.casual.quota, b.casual.carried, b.casual.used], [0, 12, 4, 16]);   // 4 carried + 12 quota - 16 used = 0
  assert.deepEqual([b.sick.left, b.sick.quota, b.sick.used], [1.5, 6, 4.5]);
  assert.deepEqual([b.compoff.left, b.compoff.earned, b.compoff.used], [1.5, 10, 8.5]);
  assert.equal(b.consumed.casual, 16);
  assert.equal(b.consumed.sick, 4.5);
  const later = L.balances(2026, rich, [taken("sick", "2026-12-03", "2026-12-03", 1)], []);
  assert.deepEqual([later.sick.left, later.sick.used, later.consumed.sick], [0.5, 5.5, 5.5]);
  assert.equal(L.balances(2027, rich, [], []).casual.carried, 0);
});

test("loss-of-pay days brought over show as taken, and only later ones are added (display only)", () => {
  const rich = { ...emp, start: "2022-01-01", openings: { asOf: "2026-11-23", unpaidUsed: 3 } };
  const base = L.balances(2026, rich, [], []);
  assert.deepEqual([base.lopDays, base.consumed.unpaid], [3, 3]);
  const lopLater = { type: "unpaid", from: "2026-12-02", to: "2026-12-02", half: null, days: 1, paidDays: 0, lopDays: 1, status: "approved" };
  const lopEarlier = { ...lopLater, from: "2026-11-02", to: "2026-11-02" };
  const b = L.balances(2026, rich, [lopLater, lopEarlier], []);
  assert.deepEqual([b.lopDays, b.consumed.unpaid], [4, 4]);   // the 2 Nov day is already inside the 3
  assert.equal(L.balances(2027, rich, [], []).lopDays, 0);
  assert.equal(L.balances(2026, { ...emp, openings: { asOf: "2026-11-23", casual: 1 } }, [lopEarlier], []).lopDays, 1);   // nothing brought over for it: counted as before
});
