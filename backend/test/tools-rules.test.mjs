import { test } from "node:test";
import assert from "node:assert/strict";
import { costSummary, readBill, readTool, slugOf, toMinor } from "../src/tools-rules.js";

test("money is read the way people type it", () => {
  assert.equal(toMinor("1,650"), 165000);
  assert.equal(toMinor("$20.00"), 2000);
  assert.equal(toMinor(""), null);
  assert.ok(Number.isNaN(toMinor("twenty")));
  assert.ok(Number.isNaN(toMinor("1.234")));
});

test("a tool needs a name and a currency; prices and addresses are checked", () => {
  const ok = readTool({ name: "ChatGPT Team", currency: "USD", seatCost: "30", billing: "seat", category: "ai" }, { isNew: true });
  assert.deepEqual([ok.value.slug, ok.value.seatCostMinor, ok.value.currency], ["chatgpt-team", 3000, "USD"]);
  assert.ok(readTool({ currency: "USD" }).errors.name);
  assert.ok(readTool({ name: "X" }).errors.currency);
  assert.ok(readTool({ name: "X", currency: "INR", seatCost: "abc" }).errors.seatCost);
  assert.ok(readTool({ name: "X", currency: "INR", url: "http://plain" }).errors.url);
  assert.equal(readTool({ name: "X", currency: "INR", billing: "free", seatCost: "99" }).value.seatCostMinor, 0);
  assert.equal(slugOf("Notion AI"), "notion-ai");
});

test("a bill needs a past or current month, an amount and a currency", () => {
  const today = "2026-11-19";
  assert.deepEqual(readBill({ month: "2026-11", amount: "4,200", currency: "INR" }, today).value, { month: "2026-11", amountMinor: 420000, currency: "INR", note: "" });
  assert.ok(readBill({ month: "2026-12", amount: "1", currency: "INR" }, today).errors.month);
  assert.ok(readBill({ month: "2026-11", amount: "0", currency: "INR" }, today).errors.amount);
  assert.ok(readBill({ month: "2026-11", amount: "5" }, today).errors.currency);
});

test("cost: paid seats at the tool's price or the person's own, bills added, rupees and dollars never mixed", () => {
  const tools = [{ slug: "claude", name: "Claude", seatCostMinor: 3000, currency: "USD", billing: "seat" },
    { slug: "zoho", name: "Zoho", seatCostMinor: 50000, currency: "INR", billing: "seat" },
    { slug: "api", name: "OpenAI API", seatCostMinor: null, currency: "USD", billing: "usage" },
    { slug: "new", name: "New tool", seatCostMinor: null, currency: "USD", billing: "seat" }];
  const seats = [
    { tool: "claude", email: "a", status: "active", dept: "Engineering" },
    { tool: "claude", email: "b", status: "member", seatCostMinor: 2500, dept: "Engineering" },
    { tool: "claude", email: "c", status: "invited", dept: "Data" },
    { tool: "claude", email: "d", status: "removed", dept: "Data" },
    { tool: "zoho", email: "a", status: "active", dept: "Engineering" },
    { tool: "new", email: "a", status: "active", dept: "Engineering" },
  ];
  const s = costSummary(tools, seats, [{ tool: "api", amountMinor: 12050, currency: "USD" }, { tool: "zoho", amountMinor: 10000, currency: "INR" }]);
  const claude = s.tools.find((t) => t.slug === "claude");
  assert.deepEqual([claude.paidSeats, claude.waitingSeats, claude.seatTotalMinor], [2, 1, 5500]);
  assert.deepEqual(s.totals, { USD: 5500 + 12050, INR: 50000 + 10000 });
  assert.deepEqual(s.byDept.Engineering, { USD: 5500, INR: 50000 });
  assert.equal(s.tools.find((t) => t.slug === "new").priceMissing, true);
  assert.equal(s.tools.find((t) => t.slug === "api").priceMissing, false);
});
