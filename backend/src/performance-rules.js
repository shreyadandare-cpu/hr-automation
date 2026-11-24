/*
 * OKRs and 1:1 meetings (Performance), as Keka has them. Pure, tested without a database (test/performance.test.mjs); the routes
 * are in performance.js.
 *
 * OKRs: company and team objectives for a quarter, each with key results that are measured from a start value to a target.
 * An objective's progress is the average of its key results; with none, the average of the personal goals linked to it.
 * 1:1 meetings: a manager and a direct report meet on a date, with shared talking points, action items and notes, and private notes
 * each of them keeps for themselves.
 */
const text = (v) => String(v == null ? "" : v).trim();
const QUARTER = /^\d{4}-Q[1-4]$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => { const s = text(v).replace(/,/g, ""); return s === "" ? NaN : Number(s); };

/** The quarter of a date in the Indian financial year: April to June is Q1 of the year it starts in. "2026-11-24" → "2026-Q3". */
export const quarterOf = (day) => { const [y, m] = String(day).split("-").map(Number); return m >= 4 ? `${y}-Q${Math.floor((m - 4) / 3) + 1}` : `${y - 1}-Q4`; };

/** How far a key result is, 0 to 100: from its start to its target (a target below the start counts down). */
export function krProgress({ start = 0, target, current }) {
  const s = Number(start) || 0, t = Number(target), c = Number(current);
  if (!Number.isFinite(t) || t === s) return Number.isFinite(c) && c >= t ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(((c - s) / (t - s)) * 100)));
}
/** An objective's progress: the average of its key results, else of the goals linked to it, else 0. */
export function objectiveProgress(keyResults = [], goals = []) {
  const list = keyResults.length ? keyResults.map(krProgress) : goals.map((g) => Math.max(0, Math.min(100, Number(g.progress) || 0)));
  return list.length ? Math.round(list.reduce((n, x) => n + x, 0) / list.length) : 0;
}
/** On track, at risk or behind, against how much of the quarter has passed (`elapsed`, 0 to 1). */
export const health = (progress, elapsed) => (progress >= 100 ? "done" : progress >= elapsed * 100 - 10 ? "on track" : progress >= elapsed * 100 - 30 ? "at risk" : "behind");

export function readObjective(b = {}) {
  const errors = {};
  const title = text(b.title).slice(0, 200), detail = text(b.detail).slice(0, 1000), quarter = text(b.quarter);
  const level = b.level === "company" ? "company" : b.level === "team" ? "team" : null;
  const parentId = b.parentId === "" || b.parentId == null ? null : Number(b.parentId);
  if (!title) errors.title = "Please write the objective.";
  if (!level) errors.level = "Please choose a company or a team objective.";
  if (!QUARTER.test(quarter)) errors.quarter = "Please choose the quarter.";
  if (parentId !== null && !(Number.isInteger(parentId) && parentId > 0)) errors.parentId = "Please choose the objective it supports.";
  return { value: { title, detail, quarter, level, parentId }, errors };
}
export function readKeyResult(b = {}) {
  const errors = {};
  const title = text(b.title).slice(0, 200), unit = text(b.unit).slice(0, 20);
  const start = text(b.start) === "" ? 0 : num(b.start), target = num(b.target), current = text(b.current) === "" ? start : num(b.current);
  if (!title) errors.title = "Please write the key result.";
  if (!Number.isFinite(start)) errors.start = "Please enter the starting value as a number.";
  if (!Number.isFinite(target)) errors.target = "Please enter the target as a number.";
  else if (Number.isFinite(start) && target === start) errors.target = "The target must differ from the starting value.";
  if (!Number.isFinite(current)) errors.current = "Please enter the current value as a number.";
  return { value: { title, unit, start, target, current }, errors };
}
export function readMeeting(b = {}, today) {
  const errors = {};
  const withEmail = text(b.with).toLowerCase(), on = text(b.on);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(withEmail)) errors.with = "Please choose who you are meeting.";
  if (!DAY.test(on)) errors.on = "Please choose the date.";
  else if (today && on < today) errors.on = "Please choose today or a later date.";
  return { value: { withEmail, on }, errors };
}
export const ITEM_KINDS = ["talking_point", "action"];
export function readItem(b = {}) {
  const errors = {};
  const kind = ITEM_KINDS.includes(b.kind) ? b.kind : null, body = text(b.text).slice(0, 500);
  if (!kind) errors.kind = "Please choose a talking point or an action.";
  if (!body) errors.text = "Please write it.";
  return { value: { kind, text: body, owner: text(b.owner).toLowerCase() || null }, errors };
}
