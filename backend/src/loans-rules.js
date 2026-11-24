/*
 * Company loans: the arithmetic, kept pure so the browser and the tests can use it. A loan is an amount repaid in equal monthly installments from a first month.
 * The installment is rounded UP to the paisa, so the last one is the exact remainder (never more than the others, never a leftover paisa).
 */
export const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const ceil2 = (n) => Math.ceil(Math.round(n * 1e6) / 1e4) / 100;
export const MAX_AMOUNT = 10_000_000, MAX_MONTHS = 60;

/** The installment and how many are needed: { monthly, count, last }. */
export function plan(amount, months) {
  const a = money(amount), m = Math.floor(Number(months));
  if (!(a > 0) || !(m >= 1)) return { monthly: 0, count: 0, last: 0 };
  const monthly = ceil2(a / m), count = Math.min(m, Math.ceil(money(a / monthly) - 1e-9));
  return { monthly, count, last: money(a - monthly * (count - 1)) };
}
/** "2026-11" plus n months. */
export function addMonths(period, n) {
  const [y, m] = String(period).split("-").map(Number), t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
/** The schedule: [{ n, month, amount }] from the first month. */
export function schedule(amount, months, firstMonth) {
  const p = plan(amount, months);
  return Array.from({ length: p.count }, (_, i) => ({ n: i + 1, month: addMonths(firstMonth, i), amount: i === p.count - 1 ? p.last : p.monthly }));
}
/**
 * What has been repaid, month by month. `recovered`: Map(period → amount deducted in payroll). Returns the schedule rows with their status (paid, due, pending) and the totals.
 * Anything recovered outside the schedule (a final settlement) still reduces the balance.
 */
export function progress({ amount, months, firstMonth, recovered, total, thisMonth }) {
  const rows = schedule(amount, months, firstMonth).map((r) => {
    const paid = recovered.get(r.month);
    return { ...r, paid: paid == null ? null : money(paid), status: paid != null ? "paid" : r.month <= thisMonth ? "due" : "pending" };
  });
  const repaid = money(total ?? [...recovered.values()].reduce((n, x) => n + x, 0)), outstanding = Math.max(0, money(money(amount) - repaid));
  return { rows, repaid, outstanding, paidCount: rows.filter((r) => r.status === "paid").length, percent: money(amount) ? Math.min(100, Math.round((repaid / money(amount)) * 100)) : 0 };
}
