/*
 * Shifts, the roster and what a day's punches mean against the shift, as Keka does it. Pure, so it is tested without a database
 * (test/shifts.test.mjs); the routes are in shifts.js and attendance.js uses `dayMarks` for every day it shows.
 *
 * A shift has a start and an end on the same day, a grace period for arriving late, its weekly days off, the hours that make a
 * Present day and a Half day, and the minimum extra time that counts as overtime. The roster says who is on which shift from a
 * date (until a date, or open). With no roster entry a person is on the default shift.
 *
 * Company decisions (2026-11-24): late arrival and early leaving are marked only, nothing is deducted. Overtime is the time worked
 * beyond the shift's length on a working day; it is worked out for everyone but only staff HR marks as eligible have it approved,
 * and payroll never pays it by itself: HR types the amount on the payslip. Weekend and holiday work stays a comp-off.
 */

/** The office shift before shifts existed: 9:30 am to 6:30 pm, late after 9:45, Saturday and Sunday off. */
export const DEFAULT_SHIFT = { id: null, name: "General shift", start: "09:30", end: "18:30", graceMinutes: 15, weeklyOffs: [0, 6],
  presentMinutes: 360, halfDayMinutes: 180, overtimeAfterMinutes: 30, isDefault: true };
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const minutesOf = (t) => { const [h, m] = String(t).slice(0, 5).split(":").map(Number); return h * 60 + m; };
const text = (v) => String(v == null ? "" : v).trim();
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** A row from the shifts table as the shift object used everywhere. */
export const shiftFromRow = (r) => ({ id: r.id, name: r.name, start: String(r.start_time).slice(0, 5), end: String(r.end_time).slice(0, 5),
  graceMinutes: r.grace_minutes, weeklyOffs: (r.weekly_offs || []).map(Number), presentMinutes: r.present_minutes, halfDayMinutes: r.half_day_minutes,
  overtimeAfterMinutes: r.overtime_after_minutes, isDefault: !!r.is_default });

/** Is this date one of the shift's weekly days off? */
export const isWeeklyOff = (shift, date) => (shift.weeklyOffs || []).includes(weekday(date));

/** The shift a person works on a date: the roster entry covering it (the latest start wins when two overlap), else the default. */
export function shiftOn(assignments = [], fallback = DEFAULT_SHIFT, date) {
  let best = null;
  for (const a of assignments) if (a.from <= date && (!a.to || a.to >= date) && (!best || a.from > best.from)) best = a;
  return best ? best.shift : fallback;
}

/**
 * What a day's punches mean against the shift. Only on a working day with punches; a day off or a day without punches has no marks.
 *   late       first punch after start + grace (lateBy: minutes after the start)
 *   early      last punch before the end, on a finished day (earlyBy: minutes before the end)
 *   overtime   time worked beyond the shift's length, when it is at least `overtimeAfterMinutes`
 */
export function dayMarks(shift, { firstIn = null, lastOut = null, minutes = 0, workingDay = true, finished = true } = {}) {
  const none = { late: false, lateBy: 0, early: false, earlyBy: 0, overtimeMinutes: 0 };
  if (!workingDay || !firstIn) return none;
  const start = minutesOf(shift.start), end = minutesOf(shift.end), length = Math.max(0, end - start);
  const inAt = minutesOf(firstIn);
  const late = inAt > start + (Number(shift.graceMinutes) || 0);
  const outAt = lastOut ? minutesOf(lastOut) : null;
  const early = finished && outAt !== null && outAt < end;
  const extra = Math.max(0, (Number(minutes) || 0) - length);
  return { late, lateBy: late ? inAt - start : 0, early, earlyBy: early ? end - outAt : 0,
    overtimeMinutes: finished && extra >= (Number(shift.overtimeAfterMinutes) || 0) && extra > 0 ? extra : 0 };
}

/** The day's status from its minutes against the shift (Present, Half day or Short hours), as attendance shows it. */
export const statusFromMinutes = (shift, minutes) => (minutes >= shift.presentMinutes ? "Present" : minutes >= shift.halfDayMinutes ? "Half day" : "Short hours");

/** A shift HR creates or changes. Returns { value, errors }. */
export function readShift(b = {}) {
  const errors = {};
  const name = text(b.name).slice(0, 60), start = text(b.start), end = text(b.end);
  const num = (v, fallback) => (v === "" || v == null ? fallback : Number(v));
  const graceMinutes = num(b.graceMinutes, 15), presentMinutes = num(b.presentMinutes, 360), halfDayMinutes = num(b.halfDayMinutes, 180), overtimeAfterMinutes = num(b.overtimeAfterMinutes, 30);
  const weeklyOffs = Array.isArray(b.weeklyOffs) ? [...new Set(b.weeklyOffs.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort() : [];
  if (!name) errors.name = "Please name the shift.";
  if (!TIME.test(start)) errors.start = "Please enter the start time, like 09:30.";
  if (!TIME.test(end)) errors.end = "Please enter the end time, like 18:30.";
  else if (TIME.test(start) && minutesOf(end) <= minutesOf(start)) errors.end = "The shift must end after it starts on the same day.";
  if (!(Number.isInteger(graceMinutes) && graceMinutes >= 0 && graceMinutes <= 120)) errors.graceMinutes = "Please enter the grace period in minutes, from 0 to 120.";
  if (!(Number.isInteger(presentMinutes) && presentMinutes >= 30 && presentMinutes <= 1440)) errors.presentMinutes = "Please enter the minutes for a full day.";
  if (!(Number.isInteger(halfDayMinutes) && halfDayMinutes >= 0 && halfDayMinutes < presentMinutes)) errors.halfDayMinutes = "A half day must be fewer minutes than a full day.";
  if (!(Number.isInteger(overtimeAfterMinutes) && overtimeAfterMinutes >= 0 && overtimeAfterMinutes <= 600)) errors.overtimeAfterMinutes = "Please enter the minimum overtime in minutes.";
  if (weeklyOffs.length > 6) errors.weeklyOffs = "A shift needs at least one working day.";
  return { value: { name, start, end, graceMinutes, presentMinutes, halfDayMinutes, overtimeAfterMinutes, weeklyOffs }, errors };
}

/** Putting people on a shift from a date (until a date, or open). Returns { value, errors }. */
export function readAssignment(b = {}) {
  const errors = {};
  const emails = [...new Set((Array.isArray(b.emails) ? b.emails : [b.email]).map((e) => text(e).toLowerCase()).filter(Boolean))].slice(0, 500);
  const shiftId = Number(b.shiftId), from = text(b.from), to = text(b.to) || null;
  if (!emails.length || emails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) errors.emails = "Please choose the people.";
  if (!Number.isInteger(shiftId) || shiftId <= 0) errors.shiftId = "Please choose the shift.";
  if (!DAY.test(from)) errors.from = "Please choose the first day.";
  if (to && !DAY.test(to)) errors.to = "Please choose a valid last day, or leave it empty.";
  else if (to && DAY.test(from) && to < from) errors.to = "The last day cannot be before the first day.";
  return { value: { emails, shiftId, from, to }, errors };
}

/** HR's or a manager's decision on a month's overtime. Returns { value, errors }. */
export function readOvertimeDecision(b = {}, computedMinutes = 0) {
  const errors = {};
  const decision = b.decision === "approved" || b.decision === "rejected" ? b.decision : null;
  const note = text(b.note).slice(0, 300);
  const raw = b.hours === "" || b.hours == null ? null : Number(String(b.hours).replace(/,/g, ""));
  let minutes = decision === "approved" ? (raw == null ? computedMinutes : Math.round(raw * 60)) : 0;
  if (!decision) errors.decision = "Please choose to approve or reject.";
  if (decision === "approved" && (!Number.isFinite(minutes) || minutes < 0 || minutes > 400 * 60)) { errors.hours = "Please enter the hours to approve."; minutes = 0; }
  if (decision === "approved" && minutes !== computedMinutes && !note) errors.note = "Please say why the approved hours differ from the hours worked out.";
  if (decision === "rejected" && !note) errors.note = "Please say why, so the person knows.";
  return { value: { decision, minutes, note }, errors };
}

/** "6 h 30 min" for minutes. */
export const hoursText = (m) => { const h = Math.floor(m / 60), r = m % 60; return h && r ? `${h} h ${r} min` : h ? `${h} h` : `${r} min`; };
