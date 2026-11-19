import { test } from "node:test";
import assert from "node:assert/strict";
import { readAdvance, readAppLink, readArticle, readAttendanceRequest, readDecision, readGoal, readPoll, readPraise, readTaxDeclaration, financialYear, tally } from "../src/engage-rules.js";

test("a poll needs a question and two different options", () => {
  assert.deepEqual(Object.keys(readPoll({ question: "", options: ["A"] }).errors).sort(), ["options", "question"]);
  assert.ok(readPoll({ question: "Lunch?", options: ["Yes", "yes ", "Yes"] }).errors.options, "the same option three times is one option");
  const ok = readPoll({ question: " Lunch? ", options: [" Pizza ", "Dosa", ""] });
  assert.deepEqual(ok.errors, {}); assert.equal(ok.question, "Lunch?"); assert.deepEqual(ok.options, ["Pizza", "Dosa"]);
});
test("a poll cannot close in the past and takes at most six options", () => {
  assert.ok(readPoll({ question: "Q", options: ["a", "b"], closesAt: "2001-01-01" }).errors.closesAt);
  assert.ok(readPoll({ question: "Q", options: ["a", "b", "c", "d", "e", "f", "g"] }).errors.options);
});
test("poll totals count per option and ignore votes for options that do not exist", () => {
  assert.deepEqual(tally(3, [{ option_index: 0, n: 2 }, { option_index: 2, n: 5 }, { option_index: 9, n: 4 }]), { totals: [2, 0, 5], votes: 7 });
});
test("praise needs a colleague and a message, and nobody praises themselves", () => {
  assert.ok(readPraise({ to: "a@wohlig.com", message: "Thanks" }, "A@wohlig.com").errors.to);
  assert.ok(readPraise({ to: "nobody", message: "x" }, "a@wohlig.com").errors.to);
  assert.ok(readPraise({ to: "b@wohlig.com", message: " " }, "a@wohlig.com").errors.message);
  const ok = readPraise({ to: "B@Wohlig.com", message: "Great release", badge: "made-up" }, "a@wohlig.com");
  assert.deepEqual(ok.errors, {}); assert.equal(ok.to, "b@wohlig.com"); assert.equal(ok.badge, "thanks");
});
test("an article is a draft unless it is published", () => {
  assert.equal(readArticle({ title: "T", body: "B" }).status, "draft");
  assert.equal(readArticle({ title: "T", body: "B", status: "live" }).status, "live");
  assert.ok(readArticle({ title: "", body: "" }).errors.title);
});
test("an app link must be a full https address", () => {
  assert.ok(readAppLink({ title: "Mail", url: "javascript:alert(1)" }).errors.url);
  assert.ok(readAppLink({ title: "Mail", url: "http://mail.example.com" }).errors.url);
  assert.deepEqual(readAppLink({ title: "Mail", url: "https://mail.example.com" }).errors, {});
});
test("advance amounts typed the way people type them become whole paise", () => {
  assert.equal(readAdvance({ amount: "₹12,500.50", reason: "Rent" }).amountMinor, 1250050);
  assert.ok(readAdvance({ amount: "-5", reason: "x" }).errors.amount);
  assert.ok(readAdvance({ amount: "abc", reason: "x" }).errors.amount);
  assert.ok(readAdvance({ amount: "100", reason: "" }).errors.reason);
});
test("attendance requests: a missed punch cannot be for a future day", () => {
  const today = "2026-11-19";
  assert.ok(readAttendanceRequest({ date: "2026-11-20", kind: "missed-punch", note: "n" }, today).errors.date);
  assert.deepEqual(readAttendanceRequest({ date: "2026-11-20", kind: "work-from-home", note: "n" }, today).errors, {});
  assert.ok(readAttendanceRequest({ date: "2026-11-19", kind: "holiday", note: "n" }, today).errors.kind);
  assert.ok(readAttendanceRequest({ date: "2026-01-01", kind: "on-duty", note: "n" }, today).errors.date);
});
test("declining a request needs a reason; approving does not", () => {
  assert.ok(readDecision({ decision: "decline" }).errors.note);
  assert.deepEqual(readDecision({ decision: "approve" }), { decision: "approved", note: "", errors: {} });
  assert.ok(readDecision({ decision: "maybe" }).errors.decision);
});

test("the financial year runs April to March", () => {
  assert.equal(financialYear("2026-03-31"), 2025);
  assert.equal(financialYear("2026-04-01"), 2026);
  assert.equal(financialYear("2026-11-19"), 2026);
});
test("a tax declaration keeps deduction lines only under the old regime, as whole paise", () => {
  const old = readTaxDeclaration({ regime: "old", items: [{ section: "80C", description: "PPF", amount: "1,50,000" }] });
  assert.deepEqual(old.errors, {}); assert.deepEqual(old.items, [{ section: "80C", description: "PPF", amountMinor: 15000000 }]);
  assert.deepEqual(readTaxDeclaration({ regime: "new", items: [{ section: "80C", amount: "100" }] }).items, []);
  assert.ok(readTaxDeclaration({ regime: "old", items: [{ section: "made up", amount: "100" }] }).errors.item0);
  assert.ok(readTaxDeclaration({ regime: "old", items: [{ section: "80D", amount: "-1" }] }).errors.item0);
  assert.equal(readTaxDeclaration({ regime: "anything" }).regime, "new");
});
test("a goal needs a title and progress between 0 and 100", () => {
  assert.ok(readGoal({ title: "", progress: 0 }).errors.title);
  assert.ok(readGoal({ title: "Ship v2", progress: 140 }).errors.progress);
  assert.ok(readGoal({ title: "Ship v2", progress: 10, dueOn: "next week" }).errors.dueOn);
  assert.deepEqual(readGoal({ title: " Ship v2 ", progress: "40", dueOn: "2026-12-31" }), { title: "Ship v2", detail: "", dueOn: "2026-12-31", progress: 40, errors: {} });
});
