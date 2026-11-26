/*
 * The attendance day starts at 5:00 am (Indian time), not at midnight, as in Keka's day boundary. Someone still punched in after
 * midnight can punch out until 5 am and it counts for the day they started; from 5 am a new day starts with a fresh punch in, and
 * a day still without a punch-out is only then "Punch-out missing".
 *
 * Punches keep the clock time (01:30) on the working day they belong to (the day before), so times between midnight and 5 am are
 * ordered after the evening: `ord` gives minutes from midnight of the working day (01:30 is 25 h 30 m = 1530).
 * Used by attendance.js, device.js, attendance-reminders.js and engage.js; the interface has the same rule (components/attendance.jsx).
 */
export const DAY_START = "05:00";
export const DAY_START_MIN = 5 * 60;

const mins = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
/** Minutes from midnight of the working day: before 5 am counts as the next calendar day (01:30 is 1530). */
export const ord = (t) => { const m = mins(t); return m < DAY_START_MIN ? m + 1440 : m; };
/** The working day a punch at `time` on calendar `date` belongs to: the day before, between midnight and 5 am. */
export const workDayOf = (date, time) => (mins(time) < DAY_START_MIN ? new Date(Date.parse(date + "T00:00:00Z") - 86400000).toISOString().slice(0, 10) : date);
/** Punches of one working day in time order (the evening before the small hours). */
export const byOrd = (a, b) => ord(a.time) - ord(b.time) || (a.id || 0) - (b.id || 0);
/** "25:30" for 01:30 on the working day, so time comparisons and shift marks treat it as after the evening. */
export const late = (t) => (t && mins(t) < DAY_START_MIN ? `${Math.floor(ord(t) / 60)}:${String(ord(t) % 60).padStart(2, "0")}` : t);

/** SQL: the working day and the clock time now, in Indian time. */
export const NOW_SQL = `SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata') - interval '5 hours','YYYY-MM-DD') AS day,
  to_char(now() AT TIME ZONE 'Asia/Kolkata','HH24:MI:SS') AS time`;
/** SQL: a punch_time column's seconds from midnight of its working day, for ordering (`col` is trusted, never user input). */
export const ordSql = (col) => `(extract(epoch FROM ${col}) + CASE WHEN ${col} < time '05:00' THEN 86400 ELSE 0 END)`;
