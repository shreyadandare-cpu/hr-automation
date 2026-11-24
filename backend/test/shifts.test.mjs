/* Shifts, the roster and overtime (shift-rules.js), and how payroll shows approved overtime without paying it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SHIFT, dayMarks, isWeeklyOff, readAssignment, readOvertimeDecision, readShift, shiftOn, statusFromMinutes } from "../src/shift-rules.js";
import { computeLine } from "../src/payroll/engine.js";
import { PERM, PRESETS } from "../src/access-rules.js";

const NIGHT = { ...DEFAULT_SHIFT, id: 2, name: "Early shift", start: "07:00", end: "16:00", weeklyOffs: [0], isDefault: false };

test("the default shift is 9:30 to 6:30, late after 9:45, Saturday and Sunday off", () => {
  assert.equal(DEFAULT_SHIFT.start, "09:30"); assert.equal(DEFAULT_SHIFT.end, "18:30"); assert.equal(DEFAULT_SHIFT.graceMinutes, 15);
  assert.equal(isWeeklyOff(DEFAULT_SHIFT, "2026-11-21"), true, "a Saturday");
  assert.equal(isWeeklyOff(DEFAULT_SHIFT, "2026-11-23"), false, "a Monday");
  assert.equal(isWeeklyOff(NIGHT, "2026-11-21"), false, "this shift works Saturdays");
});

test("the roster: the entry covering the day wins, the latest start first; otherwise the default", () => {
  const roster = [{ from: "2026-11-01", to: null, shift: NIGHT }, { from: "2026-11-10", to: "2026-11-15", shift: { ...DEFAULT_SHIFT, name: "Cover" } }];
  assert.equal(shiftOn(roster, DEFAULT_SHIFT, "2026-10-31").name, "General shift");
  assert.equal(shiftOn(roster, DEFAULT_SHIFT, "2026-11-05").name, "Early shift");
  assert.equal(shiftOn(roster, DEFAULT_SHIFT, "2026-11-12").name, "Cover");
  assert.equal(shiftOn(roster, DEFAULT_SHIFT, "2026-11-16").name, "Early shift", "back to the earlier shift after the end date");
});

test("late after the grace, early before the end, overtime beyond the shift's length from 30 minutes", () => {
  assert.deepEqual(dayMarks(DEFAULT_SHIFT, { firstIn: "09:45", lastOut: "18:30", minutes: 525 }), { late: false, lateBy: 0, early: false, earlyBy: 0, overtimeMinutes: 0 });
  const late = dayMarks(DEFAULT_SHIFT, { firstIn: "09:46", lastOut: "18:00", minutes: 494 });
  assert.equal(late.late, true); assert.equal(late.lateBy, 16); assert.equal(late.early, true); assert.equal(late.earlyBy, 30);
  assert.equal(dayMarks(DEFAULT_SHIFT, { firstIn: "09:30", lastOut: "19:00", minutes: 570 }).overtimeMinutes, 30, "9 h 30 min against a 9-hour shift");
  assert.equal(dayMarks(DEFAULT_SHIFT, { firstIn: "09:30", lastOut: "18:50", minutes: 560 }).overtimeMinutes, 0, "20 minutes extra is under the minimum");
  assert.equal(dayMarks(DEFAULT_SHIFT, { firstIn: "08:00", lastOut: "21:00", minutes: 780, workingDay: false }).overtimeMinutes, 0, "a day off earns a comp-off, not overtime");
  assert.equal(dayMarks(DEFAULT_SHIFT, { firstIn: "09:30", lastOut: "17:00", minutes: 450, finished: false }).early, false, "today is not over yet");
  assert.equal(statusFromMinutes(DEFAULT_SHIFT, 360), "Present"); assert.equal(statusFromMinutes(DEFAULT_SHIFT, 200), "Half day"); assert.equal(statusFromMinutes(DEFAULT_SHIFT, 100), "Short hours");
});

test("a shift HR saves is checked: times, end after start, grace, days off, half below full day", () => {
  assert.deepEqual(readShift({ name: "Early", start: "07:00", end: "16:00", weeklyOffs: [0, "6", 6, 9] }).errors, {});
  assert.deepEqual(readShift({ name: "Early", start: "07:00", end: "16:00", weeklyOffs: [6, 0] }).value.weeklyOffs, [0, 6]);
  assert.ok(readShift({ name: "", start: "07:00", end: "16:00" }).errors.name);
  assert.ok(readShift({ name: "X", start: "22:00", end: "06:00" }).errors.end, "a shift ends after it starts on the same day");
  assert.ok(readShift({ name: "X", start: "7", end: "16:00" }).errors.start);
  assert.ok(readShift({ name: "X", start: "07:00", end: "16:00", graceMinutes: 500 }).errors.graceMinutes);
  assert.ok(readShift({ name: "X", start: "07:00", end: "16:00", presentMinutes: 300, halfDayMinutes: 300 }).errors.halfDayMinutes);
  assert.ok(readShift({ name: "X", start: "07:00", end: "16:00", weeklyOffs: [0, 1, 2, 3, 4, 5, 6] }).errors.weeklyOffs);
});

test("the roster entry and the overtime decision are checked", () => {
  assert.deepEqual(readAssignment({ emails: ["A@x.com", "a@x.com"], shiftId: 2, from: "2026-11-01" }).value.emails, ["a@x.com"]);
  assert.ok(readAssignment({ emails: [], shiftId: 2, from: "2026-11-01" }).errors.emails);
  assert.ok(readAssignment({ emails: ["a@x.com"], shiftId: 2, from: "2026-11-10", to: "2026-11-01" }).errors.to);
  assert.equal(readOvertimeDecision({ decision: "approved" }, 390).value.minutes, 390, "empty hours approves what was worked out");
  assert.equal(readOvertimeDecision({ decision: "approved", hours: "6.5" }, 390).value.minutes, 390);
  assert.ok(readOvertimeDecision({ decision: "approved", hours: "4" }, 390).errors.note, "fewer hours need a reason");
  assert.deepEqual(readOvertimeDecision({ decision: "approved", hours: "4", note: "Only the Tuesday was asked for" }, 390).errors, {});
  assert.ok(readOvertimeDecision({ decision: "rejected" }, 390).errors.note);
  assert.equal(readOvertimeDecision({ decision: "rejected", note: "Not agreed in advance" }, 390).value.minutes, 0);
});

test("payroll shows approved overtime but pays only the amount HR enters", () => {
  const structure = { earnings: [{ name: "Basic", amount: 30000 }], professionalTax: 0, tdsMode: "auto" };
  const run = (inputs) => computeLine({ period: "2026-11", employee: { start: "2020-01-01" }, structure, inputs, overtimeApprovedMinutes: 390, tax: {} });
  const none = run({});
  assert.equal(none.summary.gross, 30000, "nothing paid by itself");
  assert.ok(none.warnings.some((w) => /6 h 30 min of overtime was approved/.test(w)));
  assert.deepEqual(none.overtime, { approvedMinutes: 390 });
  const paid = run({ overtime: 4000 });
  assert.equal(paid.summary.gross, 34000);
  assert.ok(!paid.warnings.some((w) => /overtime was approved/.test(w)));
  assert.equal(computeLine({ period: "2026-11", employee: { start: "2020-01-01" }, structure, tax: {} }).overtime, null);
});

test("two new permissions: shifts are company-wide, overtime can be approved for a team", () => {
  assert.equal(PERM["shifts.manage"].team, false);
  assert.equal(PERM["overtime.approve"].team, true);
  assert.ok(PRESETS.teamHead.perms.includes("overtime.approve"));
});
