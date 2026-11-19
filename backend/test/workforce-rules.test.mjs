import test from "node:test";
import assert from "node:assert/strict";
import {
  afterSelf, candidateDraft, enps, interviewIcs, istToIso, minutesByProject, noticeDefault, noticeInfo, readAnswers, readAssignees, readCompletion,
  readCycle, readFeedbackAsk, readInterview, readResignation, readStandIn, readSurvey, readTimesheet, readTraining, readVerdict, surveyResults,
  timesheetShares, toMinutes, weekStart,
} from "../src/workforce-rules.js";

const today = "2026-11-19";

test("weeks start on Monday", () => {
  assert.equal(weekStart("2026-11-19"), "2026-11-16");   // Thursday
  assert.equal(weekStart("2026-11-16"), "2026-11-16");
  assert.equal(weekStart("2026-11-22"), "2026-11-16");   // Sunday
  assert.equal(weekStart("2026-02-30"), null);
});

test("hours can be typed several ways", () => {
  assert.equal(toMinutes("7.5"), 450); assert.equal(toMinutes("7:30"), 450); assert.equal(toMinutes("7h 30m"), 450); assert.equal(toMinutes("8h"), 480);
  assert.equal(toMinutes(""), 0); assert.ok(Number.isNaN(toMinutes("seven"))); assert.ok(Number.isNaN(toMinutes("7:75")));
});

test("a timesheet keeps the days with time, and refuses projects you are not on and days over 24 hours", () => {
  const ok = readTimesheet({ rows: [{ projectId: 4, hours: ["8", "8", "", "4", "", "", ""] }, { projectId: null, hours: ["", "", "8", "4"] }] }, "2026-11-16", [4]);
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.entries.length, 5); assert.equal(ok.total, 32 * 60);
  assert.deepEqual(ok.entries[2], { projectId: 4, day: "2026-11-19", minutes: 240 });
  assert.ok(readTimesheet({ rows: [{ projectId: 9, hours: ["1"] }] }, "2026-11-16", [4]).errors.row0);
  assert.ok(readTimesheet({ rows: [{ projectId: 4, hours: ["20"] }, { projectId: null, hours: ["6"] }] }, "2026-11-16", [4]).errors.day0);
  assert.ok(readTimesheet({ rows: [{ projectId: 4, hours: ["x"] }] }, "2026-11-16", [4]).errors.row0);
  assert.ok(readTimesheet({ rows: [{ projectId: 4 }, { projectId: 4 }] }, "2026-11-16", [4]).errors.row1);
  assert.ok(readTimesheet({ rows: [] }, "2026-11-17", []).errors.week);
});

test("timesheet hours become cost shares that add up to 100", () => {
  const by = minutesByProject([{ email: "A@w.com", project: "Apollo", minutes: 1800 }, { email: "a@w.com", project: "Internal work", minutes: 600 }, { email: "a@w.com", project: "Apollo", minutes: 0 }]);
  assert.deepEqual(by, { "a@w.com": { Apollo: 1800, "Internal work": 600 } });
  const s = timesheetShares(by);
  assert.equal(s.find((x) => x.project === "Apollo").percent, 75);
  assert.equal(s.reduce((n, x) => n + x.percent, 0), 100);
});

test("a survey needs a title, a future closing date and real questions", () => {
  const ok = readSurvey({ title: "Pulse", closesOn: "2026-11-30", questions: [{ type: "enps", text: "Would you recommend Wohlig?" }, { type: "choice", text: "Office days", options: ["1", "2", "2", ""] }] }, today);
  assert.deepEqual(ok.errors, {}); assert.equal(ok.anonymous, true); assert.deepEqual(ok.questions[1].options, ["1", "2"]);
  assert.equal(readSurvey({ title: "x", closesOn: "2026-11-30", questions: [{ type: "text", text: "Anything else?" }], anonymous: false }, today).anonymous, false);
  const bad = readSurvey({ closesOn: "2026-11-01", questions: [{ type: "choice", text: "Pick", options: ["only"] }, { type: "rank", text: "?" }] }, today);
  for (const k of ["title", "closesOn", "q0", "q1"]) assert.ok(bad.errors[k], k);
  assert.ok(readSurvey({ title: "x", closesOn: "2026-11-30" }, today).errors.questions);
});

test("answers are checked against each question; written answers may be left empty", () => {
  const qs = [{ type: "scale" }, { type: "enps" }, { type: "choice", options: ["a", "b"] }, { type: "text" }];
  assert.deepEqual(readAnswers(qs, [5, 0, 1, ""]), { answers: [5, 0, 1, ""], errors: {} });
  const bad = readAnswers(qs, [6, 11, 2]);
  assert.ok(bad.errors.q0 && bad.errors.q1 && bad.errors.q2); assert.ok(!bad.errors.q3);
});

test("eNPS is promoters less detractors", () => {
  assert.equal(enps([10, 9, 8, 7, 6, 0]), 0);
  assert.equal(enps([10, 10, 9, 5]), 50);
  assert.equal(enps([]), null);
});

test("anonymous results stay hidden below three answers and written answers lose their order", () => {
  const qs = [{ type: "scale", text: "Happy?" }, { type: "enps", text: "Recommend?" }, { type: "text", text: "Why?" }];
  assert.deepEqual(surveyResults(qs, [{ answers: [5, 10, "x"] }, { answers: [4, 9, "y"] }]), { responses: 2, hidden: true, questions: [] });
  const r = surveyResults(qs, [{ answers: [5, 10, "zebra"] }, { answers: [4, 9, ""] }, { answers: [3, 2, "apple"] }]);
  assert.equal(r.hidden, false); assert.equal(r.questions[0].average, 4); assert.deepEqual(r.questions[0].counts, [0, 0, 1, 1, 1]);
  assert.equal(r.questions[1].score, 33); assert.deepEqual(r.questions[2].answers, ["apple", "zebra"]);
  assert.equal(surveyResults(qs, [{ answers: [5, 10, "x"] }], false).hidden, false);
});

test("training and who must do it", () => {
  assert.deepEqual(readTraining({ title: "POSH", link: "https://lms.example.com/posh", dueOn: "2026-12-31" }).errors, {});
  assert.ok(readTraining({ title: "x", link: "http://insecure" }).errors.link);
  assert.ok(readTraining({}).errors.title);
  assert.deepEqual(readAssignees({ to: "people", emails: ["A@wohlig.com", "a@wohlig.com", "nope"] }).emails, ["a@wohlig.com"]);
  assert.ok(readAssignees({ to: "department" }).errors.dept); assert.ok(readAssignees({ to: "x" }).errors.to);
  assert.equal(readCompletion({}, today).completedOn, today);
  assert.ok(readCompletion({ completedOn: "2026-12-01" }, today).errors.completedOn);
  assert.equal(readCompletion({ done: false }, today).completedOn, null);
});

test("notice period: default 30 days, short notice is flagged", () => {
  assert.equal(noticeDefault(), 30);
  const r = readResignation({ email: "a@wohlig.com", resignedOn: "2026-11-01" }, today);
  assert.deepEqual(r.errors, {}); assert.equal(r.noticeDays, 30);
  assert.ok(readResignation({ email: "a@wohlig.com", resignedOn: "2026-11-20" }, today).errors.resignedOn);
  assert.ok(readResignation({ email: "a@wohlig.com", resignedOn: "2026-11-01", agreedLastDay: "2026-10-01" }, today).errors.agreedLastDay);
  const full = noticeInfo({ resignedOn: "2026-11-01", noticeDays: 30 }, today);
  assert.deepEqual([full.expected, full.shortBy, full.served, full.left, full.over], ["2026-12-01", 0, 18, 12, false]);
  const short = noticeInfo({ resignedOn: "2026-11-01", noticeDays: 30, lastDay: "2026-11-21" }, today);
  assert.equal(short.shortBy, 10); assert.equal(short.left, 2);
  assert.equal(noticeInfo({ resignedOn: "2026-11-01", noticeDays: 30, agreedLastDay: "2026-11-10", lastDay: "2026-12-05" }, today).actual, "2026-11-10");
});

test("a stand-in is someone else, for at most 90 days, not already over", () => {
  assert.deepEqual(readStandIn({ standIn: "b@wohlig.com", from: "2026-11-20", to: "2026-11-30" }, "a@wohlig.com", today).errors, {});
  assert.ok(readStandIn({ standIn: "a@wohlig.com", from: "2026-11-20", to: "2026-11-30" }, "a@wohlig.com", today).errors.standIn);
  assert.ok(readStandIn({ standIn: "b@wohlig.com", from: "2026-11-20", to: "2026-11-10" }, "a@wohlig.com", today).errors.to);
  assert.ok(readStandIn({ standIn: "b@wohlig.com", from: "2026-01-01", to: "2026-11-18" }, "a@wohlig.com", today).errors.to);
  assert.ok(readStandIn({ standIn: "b@wohlig.com", from: "2026-11-20", to: "2027-03-01" }, "a@wohlig.com", today).errors.to);
  assert.equal(readStandIn({ standIn: "b@wohlig.com", for: "C@wohlig.com", from: "2026-11-20", to: "2026-11-30" }, "a@wohlig.com", today).forEmail, "c@wohlig.com");
});

test("review cycles, colleague feedback and the step after a self-review", () => {
  assert.deepEqual(readCycle({ name: "2026 H2", selfDue: "2026-12-05", managerDue: "2026-12-15" }, today).errors, {});
  assert.ok(readCycle({ name: "x", selfDue: "2026-12-05", managerDue: "2026-12-01" }, today).errors.managerDue);
  assert.ok(readCycle({}, today).errors.name);
  assert.deepEqual(readFeedbackAsk({ emails: ["a@wohlig.com", "B@wohlig.com"] }, "a@wohlig.com").emails, ["b@wohlig.com"]);
  assert.ok(readFeedbackAsk({ emails: ["a@wohlig.com"] }, "a@wohlig.com").errors.emails);
  assert.equal(afterSelf("m@wohlig.com"), "manager-pending"); assert.equal(afterSelf(null), "hr-pending");
});

test("interviews are typed in India time and checked", () => {
  assert.equal(istToIso("2026-11-20T15:30"), "2026-11-20T10:00:00.000Z");
  assert.equal(istToIso("2026-11-20 15:30"), null);
  const now = new Date("2026-11-19T06:00:00Z");
  const ok = readInterview({ at: "2026-11-20T15:30", mode: "video", place: "https://meet.example.com/abc", interviewers: ["A@wohlig.com"] }, now);
  assert.deepEqual(ok.errors, {}); assert.equal(ok.minutes, 45); assert.deepEqual(ok.interviewers, ["a@wohlig.com"]);
  const bad = readInterview({ at: "2026-11-18T10:00", minutes: 5, mode: "fax", place: "x" }, now);
  for (const k of ["at", "minutes", "mode", "interviewers"]) assert.ok(bad.errors[k], k);
  assert.ok(readInterview({ at: "2026-11-20T15:30", mode: "video", place: "zoom room", interviewers: ["a@wohlig.com"] }, now).errors.place);
  assert.ok(readVerdict({ verdict: "maybe" }).errors.verdict); assert.ok(readVerdict({ verdict: "yes" }).errors.notes);
});

test("the calendar file is valid and escapes text", () => {
  const ics = interviewIcs({ id: 7, at: "2026-11-20T10:00:00.000Z", minutes: 60, title: "Interview: Asha Rao, Engineer", place: "Room 2; Floor 3", description: "Line one\nLine two" }, "2026-11-19T06:00:00.000Z");
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n")); assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(ics.includes("DTSTART:20261120T100000Z")); assert.ok(ics.includes("DTEND:20261120T110000Z"));
  assert.ok(ics.includes("SUMMARY:Interview: Asha Rao\\, Engineer")); assert.ok(ics.includes("LOCATION:Room 2\\; Floor 3"));
  assert.ok(ics.includes("Line one\\nLine two"));
  assert.ok(ics.split("\r\n").every((l) => l.length <= 75));
});

test("a hired candidate becomes an onboarding draft", () => {
  assert.deepEqual(candidateDraft({ name: "Asha Kumari Rao", email: "asha@gmail.com", phone: "+91 98200 12345" }, { title: "Engineer", dept: "Engineering" }),
    { first: "Asha Kumari", last: "Rao", pemail: "asha@gmail.com", phone: "9820012345", address: "", dept: "Engineering", title: "Engineer", mgr: "", start: "", kind: "" });
  assert.equal(candidateDraft({ name: "Madonna", email: "m@wohlig.com" }).last, "");
  assert.equal(candidateDraft({ name: "Madonna", email: "m@wohlig.com" }).pemail, "");
});
