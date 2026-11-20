import { test } from "node:test";
import assert from "node:assert/strict";
import { probationEnd, readCandidate, readExit, readOpening, readProbation, readReply, readReviewStart, readReviewText, readTicket } from "../src/hr-tools-rules.js";
import { readArticle } from "../src/engage-rules.js";

test("probation ends six months after joining, on the month's last day when the date does not exist", () => {
  assert.equal(probationEnd("2026-01-15"), "2026-07-15");
  assert.equal(probationEnd("2025-08-31"), "2026-02-28");
  assert.equal(probationEnd("2026-11-19T00:00:00Z"), "2027-05-19");
  assert.equal(probationEnd(""), null);
});
test("confirming probation needs nothing more; extending needs a future date and a reason", () => {
  const today = "2026-11-19";
  assert.deepEqual(readProbation({ email: "a@wohlig.com", action: "confirm" }, today).errors, {});
  const e = readProbation({ email: "a@wohlig.com", action: "extend", endsOn: "2026-11-01" }, today).errors;
  assert.ok(e.endsOn && e.note);
  assert.deepEqual(readProbation({ email: "a@wohlig.com", action: "extend", endsOn: "2027-01-31", note: "Needs more time on the project" }, today).errors, {});
  assert.ok(readProbation({ email: "a@wohlig.com", action: "fire" }, today).errors.action);
});
test("a helpdesk request needs a known category, a subject and a description", () => {
  assert.deepEqual(Object.keys(readTicket({}).errors).sort(), ["body", "category", "subject"]);
  assert.deepEqual(readTicket({ category: "payroll", subject: "Payslip", body: "My October payslip is missing." }).errors, {});
  assert.ok(readReply({ body: "  " }).errors.body);
});
test("an exit interview needs a person and a listed reason; would-rehire may be left open", () => {
  assert.ok(readExit({ email: "a@wohlig.com", reason: "bored" }).errors.reason);
  const ok = readExit({ email: "A@Wohlig.com", reason: "relocation" });
  assert.deepEqual(ok.errors, {}); assert.equal(ok.email, "a@wohlig.com"); assert.equal(ok.wouldRehire, null);
  assert.equal(readExit({ email: "a@wohlig.com", reason: "personal", wouldRehire: false }).wouldRehire, false);
});
test("a role needs a title; a candidate needs a name and starts at applied", () => {
  assert.ok(readOpening({ title: "" }).errors.title);
  assert.ok(readCandidate({ name: "" }).errors.name);
  assert.ok(readCandidate({ name: "Asha", email: "not-an-email" }).errors.email);
  assert.equal(readCandidate({ name: "Asha", stage: "made-up" }).stage, "applied");
  assert.equal(readCandidate({ name: "Asha", stage: "offer" }).stage, "offer");
});
test("a review needs a person and a period; HR's review needs a rating from 1 to 5", () => {
  assert.ok(readReviewStart({ email: "a@wohlig.com" }).errors.period);
  assert.deepEqual(readReviewText({ text: "Good year" }).errors, {});
  assert.ok(readReviewText({ text: "Good year", rating: 9 }, true).errors.rating);
  assert.equal(readReviewText({ text: "Good year", rating: "4" }, true).rating, 4);
});
test("an article asks for sign-off only when that is switched on", () => {
  assert.equal(readArticle({ title: "T", body: "B" }).requiresAck, false);
  assert.equal(readArticle({ title: "T", body: "B", requiresAck: true }).requiresAck, true);
});
