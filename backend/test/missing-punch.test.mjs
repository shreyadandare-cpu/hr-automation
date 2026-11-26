// A forgotten punch-out, as Keka handles it: no hours are made up, the person asks for a correction with the real time,
// and reminders go out once (attendance-reminders.js, engage-rules.js readAttendanceRequest).
import test from "node:test";
import assert from "node:assert/strict";
import { dueReminders, missingOutOn } from "../src/attendance-reminders.js";
import { readAttendanceRequest } from "../src/engage-rules.js";

const P = (date, time, direction, source = "web") => ({ date, time, direction, source });
const base = { today: "2026-11-27", shiftEndOf: () => "18:30", sent: new Set(), corrected: new Set() };

test("a day is missing its punch-out when the app's last punch is an IN, or the office machine has one punch", () => {
  assert.equal(missingOutOn([]), false);
  assert.equal(missingOutOn([P("d", "09:30", "IN")]), true);
  assert.equal(missingOutOn([P("d", "09:30", "IN"), P("d", "18:40", "OUT")]), false);
  assert.equal(missingOutOn([P("d", "09:30", "IN"), P("d", "13:00", "OUT"), P("d", "14:00", "IN")]), true);
  assert.equal(missingOutOn([P("d", "09:30", "IN", "device")]), true);
  assert.equal(missingOutOn([P("d", "09:30", "IN", "device"), P("d", "18:00", "IN", "device")]), false);
});

test("still punched in: reminded 30 minutes after the shift ends, once", () => {
  const people = [{ email: "a@wohlig.com", punches: [P("2026-11-27", "09:30", "IN")] }];
  assert.deepEqual(dueReminders({ ...base, people, nowTime: "18:59" }), []);
  assert.deepEqual(dueReminders({ ...base, people, nowTime: "19:00" }).map((r) => r.kind), ["still-in"]);
  assert.deepEqual(dueReminders({ ...base, people, nowTime: "19:00", sent: new Set(["a@wohlig.com|2026-11-27|still-in"]) }), []);
  // punched out: nothing to remind
  const out = [{ email: "a@wohlig.com", punches: [P("2026-11-27", "09:30", "IN"), P("2026-11-27", "18:31", "OUT")] }];
  assert.deepEqual(dueReminders({ ...base, people: out, nowTime: "21:00" }), []);
  // a later shift is respected
  assert.deepEqual(dueReminders({ ...base, people, nowTime: "19:30", shiftEndOf: () => "20:00" }), []);
});

test("missing punch-out: reminded from 10 am for the last 3 days, unless a correction is asked for", () => {
  const people = [{ email: "a@wohlig.com", punches: [P("2026-11-26", "09:30", "IN"), P("2026-11-20", "09:30", "IN")] }];
  assert.deepEqual(dueReminders({ ...base, people, nowTime: "09:59" }), []);
  assert.deepEqual(dueReminders({ ...base, people, nowTime: "10:00" }).map((r) => [r.kind, r.date]), [["missing-out", "2026-11-26"]]);   // 20 Nov is too old
  assert.deepEqual(dueReminders({ ...base, people, nowTime: "10:00", corrected: new Set(["a@wohlig.com|2026-11-26"]) }), []);
  assert.deepEqual(dueReminders({ ...base, people, nowTime: "10:00", sent: new Set(["a@wohlig.com|2026-11-26|missing-out"]) }), []);
});

test("a missed punch names the punch and the real time; other requests do not need one", () => {
  const today = "2026-11-27";
  const ok = readAttendanceRequest({ date: "2026-11-26", kind: "missed-punch", note: "Forgot", time: "18:45" }, today, "10:00");
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.direction, "OUT");
  assert.equal(ok.time, "18:45");
  assert.equal(readAttendanceRequest({ date: "2026-11-26", kind: "missed-punch", note: "Forgot", time: "18:45", direction: "IN" }, today).direction, "IN");
  assert.ok(readAttendanceRequest({ date: "2026-11-26", kind: "missed-punch", note: "Forgot" }, today).errors.time);
  assert.ok(readAttendanceRequest({ date: "2026-11-26", kind: "missed-punch", note: "Forgot", time: "25:00" }, today).errors.time);
  assert.ok(readAttendanceRequest({ date: today, kind: "missed-punch", note: "Forgot", time: "18:00" }, today, "11:00").errors.time, "a time still to come today is refused");
  const wfh = readAttendanceRequest({ date: "2026-11-26", kind: "work-from-home", note: "Home" }, today);
  assert.deepEqual(wfh.errors, {});
  assert.equal(wfh.time, null);
});

import { MISSING_POLICY_DEFAULTS, correctionRoute, penalisedDays, readMissingPolicy } from "../src/missing-punch-rules.js";

test("remember to punch out: HR's minutes before the shift ends, once, only while still in", () => {
  const people = [{ email: "a@wohlig.com", punches: [P("2026-11-27", "09:30", "IN")] }];
  assert.deepEqual(dueReminders({ ...base, people, nowTime: "18:19", remindBeforeMin: 10 }), []);
  assert.deepEqual(dueReminders({ ...base, people, nowTime: "18:20", remindBeforeMin: 10 }).map((r) => r.kind), ["before-end"]);
  assert.deepEqual(dueReminders({ ...base, people, nowTime: "18:25", remindBeforeMin: 10, sent: new Set(["a@wohlig.com|2026-11-27|before-end"]) }), []);
  assert.deepEqual(dueReminders({ ...base, people, nowTime: "18:25", remindBeforeMin: 0 }), [], "0 switches it off");
});

test("HR's missing punch-out settings are checked; the penalty is off unless HR turns it on", () => {
  assert.equal(MISSING_POLICY_DEFAULTS.penaltyOn, false);
  const good = readMissingPolicy({ penaltyOn: true, freePerMonth: 2, penaltyDays: 0.5, selfFixPerMonth: 2, requestsPerMonth: 5, daysBack: 7, remindBeforeMin: 10 });
  assert.deepEqual(good.errors, {});
  assert.equal(good.value.penaltyOn, true);
  const bad = readMissingPolicy({ penaltyOn: "yes", freePerMonth: -1, penaltyDays: 2, selfFixPerMonth: 1.5, requestsPerMonth: "", daysBack: 0, remindBeforeMin: 500 });
  assert.equal(bad.value.penaltyOn, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["daysBack", "freePerMonth", "penaltyDays", "remindBeforeMin", "requestsPerMonth", "selfFixPerMonth"]);
});

test("the penalty: the first free missing days of the month are free, each one after is penalised", () => {
  const on = { ...MISSING_POLICY_DEFAULTS, penaltyOn: true, freePerMonth: 2 };
  assert.deepEqual(penalisedDays(["2026-11-20", "2026-11-03", "2026-11-11", "2026-11-25"], on), ["2026-11-20", "2026-11-25"]);
  assert.deepEqual(penalisedDays(["2026-11-03", "2026-11-11"], on), []);
  assert.deepEqual(penalisedDays(["2026-11-03", "2026-11-11", "2026-11-20"], { ...on, penaltyOn: false }), []);
  assert.deepEqual(penalisedDays(["2026-11-03"], { ...on, freePerMonth: 0 }), ["2026-11-03"]);
});

test("a correction: refused past the window or the month's limit, added straight away within the allowance, else approval", () => {
  const policy = { ...MISSING_POLICY_DEFAULTS, selfFixPerMonth: 2, requestsPerMonth: 5, daysBack: 7 };
  const today = "2026-11-27";
  assert.deepEqual(correctionRoute({ date: "2026-11-26", today, policy, used: { requests: 0, selfFixes: 0 } }), { selfFix: true });
  assert.deepEqual(correctionRoute({ date: "2026-11-26", today, policy, used: { requests: 2, selfFixes: 2 } }), { approval: true });
  assert.ok(correctionRoute({ date: "2026-11-19", today, policy, used: { requests: 0, selfFixes: 0 } }).refuse, "8 days back is past a 7-day window");
  assert.ok(!correctionRoute({ date: "2026-11-20", today, policy, used: { requests: 0, selfFixes: 0 } }).refuse, "7 days back is allowed");
  assert.ok(correctionRoute({ date: "2026-11-26", today, policy, used: { requests: 5, selfFixes: 2 } }).refuse);
});
