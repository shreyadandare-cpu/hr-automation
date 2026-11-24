/* How long someone has been with the company, in plain words: "3 years, 4 months", "7 months", "Less than a month". From the date of joining to today (IST), or to the last
   working day for someone who has left. Whole months only; the day of the month decides whether the last month is complete. Returns "" without a joining date. */
export function tenureText(start, end) {
  const s = String(start || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const e = /^\d{4}-\d{2}-\d{2}/.test(String(end || "")) ? String(end).slice(0, 10) : new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  if (e < s) return "Not started yet";
  const [sy, sm, sd] = s.split("-").map(Number), [ey, em, ed] = e.split("-").map(Number);
  let months = (ey - sy) * 12 + (em - sm) - (ed < sd ? 1 : 0);
  if (months < 1) return "Less than a month";
  const y = Math.floor(months / 12), m = months % 12;
  return [y && `${y} year${y === 1 ? "" : "s"}`, m && `${m} month${m === 1 ? "" : "s"}`].filter(Boolean).join(", ");
}
