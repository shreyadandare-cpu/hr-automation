/*
 * Tools and their cost: the checks and sums, kept free of the database (test/tools-rules.test.mjs).
 * A seat costs the tool's price per month (or the person's own price when one is set). Bills are what a tool actually cost in a
 * month (usage, or the vendor's invoice). Rupees and dollars are never added together: every total is per currency.
 */
export const CATEGORIES = { ai: "AI assistant", coding: "Coding", design: "Design", productivity: "Productivity", other: "Other" };
export const BILLING = { seat: "Per seat, monthly", usage: "By usage (monthly bill)", seat_and_usage: "Per seat, plus usage", free: "Free" };
export const CURRENCIES = { INR: "₹", USD: "$" };
/** A seat that is paid for: the person has the tool now. Invited or asked-for seats are counted apart, as not yet paid. */
export const PAID = new Set(["active", "member"]);
export const WAITING = new Set(["invited", "pending", "requested"]);

const text = (v, max) => String(v ?? "").trim().slice(0, max);
/** Money typed the way people type it ("1,650", "20.00", "$20") into whole paise or cents. Empty is null. */
export function toMinor(v) {
  const s = String(v ?? "").replace(/[₹$,\s]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}
export const slugOf = (name) => String(name || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** Checks a tool from the Tools page. Returns { value } or { errors }. */
export function readTool(b = {}, { isNew = false } = {}) {
  const errors = {};
  const name = text(b.name, 60), vendor = text(b.vendor, 60), url = text(b.url, 300), notes = text(b.notes, 500);
  const category = CATEGORIES[b.category] ? b.category : "other", billing = BILLING[b.billing] ? b.billing : "seat";
  const currency = CURRENCIES[b.currency] ? b.currency : "";
  const seat = toMinor(b.seatCost);
  if (!name) errors.name = "Please give the tool a name.";
  if (!currency) errors.currency = "Please choose rupees or dollars.";
  if (Number.isNaN(seat)) errors.seatCost = "Please enter the price per seat as a number, like 1650 or 20.00.";
  else if (seat != null && seat > 100_000_000) errors.seatCost = "That price looks too large. Please check it.";
  if (url && !/^https:\/\/[^\s]+$/.test(url)) errors.url = "Please enter the full address, starting with https://.";
  const slug = isNew ? slugOf(b.slug || name) : null;
  if (isNew && !slug) errors.name = "Please give the tool a name with letters or digits.";
  if (Object.keys(errors).length) return { errors };
  return { value: { slug, name, vendor, category, billing, currency, seatCostMinor: billing === "free" ? 0 : seat, url, notes, active: b.active !== false } };
}

/** Checks a monthly bill. `today` is YYYY-MM-DD; a bill may not be for a month after this one. */
export function readBill(b = {}, today) {
  const errors = {};
  const month = String(b.month || ""), amount = toMinor(b.amount), currency = CURRENCIES[b.currency] ? b.currency : "", note = text(b.note, 300);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) errors.month = "Please choose the month.";
  else if (month > String(today).slice(0, 7)) errors.month = "A bill can't be for a month that has not started.";
  if (amount == null || Number.isNaN(amount) || amount <= 0) errors.amount = "Please enter the amount, like 4200 or 120.50.";
  if (!currency) errors.currency = "Please choose rupees or dollars.";
  if (Object.keys(errors).length) return { errors };
  return { value: { month, amountMinor: amount, currency, note } };
}

/**
 * The month's cost. `tools` [{ slug, name, seatCostMinor, currency, billing }], `seats` [{ tool, email, status, seatCostMinor, dept }],
 * `bills` [{ tool, amountMinor, currency }]. Returns per tool, per department and per currency totals, all in minor units.
 */
export function costSummary(tools, seats, bills) {
  const byTool = new Map(tools.map((t) => [t.slug, { slug: t.slug, name: t.name, currency: t.currency, seatCostMinor: t.seatCostMinor, billing: t.billing,
    paidSeats: 0, waitingSeats: 0, seatTotalMinor: 0, billsMinor: {}, priceMissing: false }]));
  const totals = {}, byDept = {};
  const add = (bag, cur, n) => { bag[cur] = (bag[cur] || 0) + n; };
  for (const s of seats) {
    const t = byTool.get(s.tool);
    if (!t) continue;
    const st = String(s.status || "").toLowerCase();
    if (WAITING.has(st)) { t.waitingSeats++; continue; }
    if (!PAID.has(st)) continue;
    t.paidSeats++;
    const price = s.seatCostMinor != null ? s.seatCostMinor : t.seatCostMinor;
    if (price == null) { if (t.billing !== "usage" && t.billing !== "free") t.priceMissing = true; continue; }
    t.seatTotalMinor += price;
    add(totals, t.currency, price);
    add((byDept[s.dept || "Other"] ||= {}), t.currency, price);
  }
  for (const b of bills) {
    const t = byTool.get(b.tool);
    if (t) add(t.billsMinor, b.currency, b.amountMinor);
    add(totals, b.currency, b.amountMinor);
  }
  return { tools: [...byTool.values()], totals, byDept };
}
