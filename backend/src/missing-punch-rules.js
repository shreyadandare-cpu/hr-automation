/*
 * Missing punch-out rules, as Keka's attendance policies, without the database:
 *   - HR's settings (attendance_policy): free missing punch-outs a month, the penalty after them, how many corrections a person
 *     may add themselves without approval, how many corrections a month in all, how far back, and when to remind;
 *   - which missing punch-outs of a month are penalised: the first `freePerMonth` are free, each one after deducts `penaltyDays`
 *     (casual leave first, loss of pay when none is left; leave.js addPenaltyLeave).
 * Used by attendance.js (the settings), engage.js (corrections) and attendance-reminders.js (reminders and penalties).
 */
import { byOrd, ord } from "./work-day.js";

export const MISSING_POLICY_DEFAULTS = {
  penaltyOn: false,          // HR switches the penalty on; it changes salaries, so it is never on by itself
  freePerMonth: 2,           // missing punch-outs a month with no penalty
  penaltyDays: 0.5,          // leave deducted for each one after the free ones: half a day or a full day
  selfFixPerMonth: 2,        // corrections a person adds without approval each month (Keka's adjustment)
  requestsPerMonth: 5,       // corrections a month in all; after that, HR adds the punch
  daysBack: 7,               // how many days back a correction can be sent; after this the day is closed
  remindBeforeMin: 10,       // minutes before the shift ends: "remember to punch out"
  penaltyFrom: null,         // the day the penalty was switched on; days before it are never penalised
};
const LIMITS = { freePerMonth: [0, 31], selfFixPerMonth: [0, 31], requestsPerMonth: [0, 62], daysBack: [1, 60], remindBeforeMin: [0, 120] };

/** HR's settings from a request body. Returns { value, errors }. */
export function readMissingPolicy(b = {}) {
  const errors = {}, value = { penaltyOn: b.penaltyOn === true };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const n = Number(b[k]);
    if (b[k] === "" || b[k] === null || b[k] === undefined || !Number.isInteger(n) || n < lo || n > hi) errors[k] = `Please enter a whole number from ${lo} to ${hi}.`;
    else value[k] = n;
  }
  const p = Number(b.penaltyDays);
  if (![0.5, 1].includes(p)) errors.penaltyDays = "Please choose half a day or a full day.";
  else value.penaltyDays = p;
  return { value, errors };
}

// A DATE column arrives as midnight on the server's clock; read its calendar day there (toISOString would shift it to UTC).
const dayOf = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : String(d).slice(0, 10));
/** The saved row (attendance_policy) as settings, with the defaults for anything not set. */
export const policyOf = (row) => (!row ? { ...MISSING_POLICY_DEFAULTS } : {
  penaltyOn: !!row.penalty_on, freePerMonth: row.free_per_month, penaltyDays: Number(row.penalty_days), selfFixPerMonth: row.self_fix_per_month,
  requestsPerMonth: row.requests_per_month, daysBack: row.days_back, remindBeforeMin: row.remind_before_min,
  penaltyFrom: row.penalty_from ? dayOf(row.penalty_from) : null,
});

/**
 * Which of one person's missing punch-out days in one month are penalised. days: the month's missing days (YYYY-MM-DD, any order)
 * that are closed (no correction can be sent any more) and still missing. Returns the days past the free ones, oldest first.
 */
export function penalisedDays(days, policy) {
  if (!policy.penaltyOn) return [];
  // Only days from the day the penalty was switched on count, towards the free ones too.
  return [...new Set(days)].filter((d) => !policy.penaltyFrom || d >= policy.penaltyFrom).sort().slice(policy.freePerMonth);
}

/**
 * What happens to a correction a person sends for `date`: refused (with the reason), added straight away (a self-fix within the
 * month's allowance), or sent for approval. used: { requests, selfFixes } already this month (declined ones do not count).
 */
export function correctionRoute({ date, today, policy, used }) {
  const back = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(date + "T00:00:00Z")) / 86400000);
  if (back > policy.daysBack) return { refuse: `A correction can be sent up to ${policy.daysBack} day${policy.daysBack === 1 ? "" : "s"} back. For an older day, please ask the HR team to add the punch.` };
  if (used.requests >= policy.requestsPerMonth) return { refuse: `You have sent ${policy.requestsPerMonth} correction${policy.requestsPerMonth === 1 ? "" : "s"} this month, the most allowed. Please ask the HR team to add the punch.` };
  return used.selfFixes < policy.selfFixPerMonth ? { selfFix: true } : { approval: true };
}

/**
 * Whether a correction only fills the punch a day is missing (Keka's adjustment), so it may be added without approval.
 * punches: the day's punches [{ time: "HH:MM", direction, source }]. Office-machine days are read as first in, last out
 * (attendance.js), so only a day with one punch is missing one; app punches carry their direction.
 * Returns { fits: true }, { fits: false } when the day is not missing that punch (it may still be sent, for approval; otherwise a
 * self-fix could stretch a complete day's hours), or { refuse } when the time cannot fix the day at all.
 */
export function correctionFits({ punches, time, direction }) {
  if (direction === "SHIFT" || !punches.length) return { fits: false };
  const ps = [...punches].sort(byOrd), first = ps[0], last = ps[ps.length - 1], t = ord(time);
  const device = ps.some((p) => p.source === "device");
  if (direction === "OUT") {
    if (!(device ? ps.length === 1 : last.direction === "IN")) return { fits: false };
    if (t <= ord(last.time)) return { refuse: `The time you left must be after your last punch that day, ${last.time}. Please check it.` };
    return { fits: true };
  }
  if (!(device ? ps.length === 1 : first.direction === "OUT")) return { fits: false };
  if (t >= ord(first.time)) return { refuse: `The time you arrived must be before your first punch that day, ${first.time}. Please check it.` };
  return { fits: true };
}
