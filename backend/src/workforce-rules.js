import { COMPANY_LEGAL, MAROON, PRODUCT, SIGN_OFF } from "./brand.js";
/*
 * The checking rules for timesheets, surveys, training, notice periods, approval stand-ins, review cycles and interviews,
 * kept apart from the routes so they can be tested without a database. Each `read…` returns the cleaned values plus
 * `errors` (field to sentence). See docs/HR_GAPS_DESIGN.md.
 */
const text = (v) => String(v == null ? "" : v).replace(/\r\n/g, "\n").trim();
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(v + "T00:00:00Z")) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const addDays = (day, n) => { const d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
export { addDays, daysBetween, isDay };

/* ---------- Timesheets ---------- */
export const DAY_MINUTES = 24 * 60;
/** The Monday of the week a day falls in. */
export function weekStart(day) {
  if (!isDay(day)) return null;
  const dow = new Date(day + "T00:00:00Z").getUTCDay();   // 0 Sunday
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}
/** Hours as typed ("7.5", "7:30", "7h 30m", "") to minutes; NaN when it cannot be read. */
export function toMinutes(v) {
  const s = text(v).toLowerCase();
  if (!s) return 0;
  let m = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(\d{1,2})\s*h(?:\s*(\d{1,2})\s*m)?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2] || 0);
  if (/^\d{1,2}(\.\d{1,2})?$/.test(s)) return Math.round(Number(s) * 60);
  return NaN;
}
/**
 * A week of hours. body.rows: [{ projectId (number, or null for internal work), hours: [7 values, Monday first], note }].
 * projectIds: the projects this person may book to. Returns entries [{ projectId, day, minutes }] for days with time.
 */
export function readTimesheet(body = {}, week, projectIds = []) {
  const errors = {};
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 20) : [];
  if (!isDay(week) || weekStart(week) !== week) errors.week = "Please choose a week.";
  const entries = [], perDay = Array(7).fill(0), seen = new Set();
  rows.forEach((r, i) => {
    const projectId = r && r.projectId != null && r.projectId !== "" ? Number(r.projectId) : null;
    if (projectId != null && !projectIds.includes(projectId)) { errors[`row${i}`] = "You are not on this project. Please choose another."; return; }
    if (seen.has(projectId)) { errors[`row${i}`] = "This project is listed twice. Please keep one line for it."; return; }
    seen.add(projectId);
    const hours = Array.isArray(r && r.hours) ? r.hours : [];
    for (let d = 0; d < 7; d++) {
      const minutes = toMinutes(hours[d]);
      if (Number.isNaN(minutes) || minutes > DAY_MINUTES) { errors[`row${i}`] = "Please type hours as a number, such as 7.5 or 7:30."; continue; }
      if (minutes > 0) { perDay[d] += minutes; if (isDay(week)) entries.push({ projectId, day: addDays(week, d), minutes }); }
    }
  });
  perDay.forEach((m, d) => { if (m > DAY_MINUTES) errors[`day${d}`] = "A day cannot hold more than 24 hours."; });
  return { entries, total: perDay.reduce((n, m) => n + m, 0), submit: body.submit === true, errors };
}
/** Minutes per person per project from timesheet entries: { email: { project: minutes } }. entries: [{ email, project, minutes }] */
export function minutesByProject(entries) {
  const out = {};
  for (const e of entries) { const k = String(e.email).toLowerCase(); out[k] = out[k] || {}; out[k][e.project] = (out[k][e.project] || 0) + Number(e.minutes); }
  return out;
}
/** Timesheet minutes as allocations for the cost report: [{ email, project, percent }] whose percentages add up to 100. */
export function timesheetShares(byProject) {
  const out = [];
  for (const [email, projects] of Object.entries(byProject)) {
    const total = Object.values(projects).reduce((n, m) => n + m, 0);
    if (total > 0) for (const [project, m] of Object.entries(projects)) out.push({ email, project, percent: (m / total) * 100 });
  }
  return out;
}

/* ---------- Surveys ---------- */
export const QUESTION_TYPES = ["scale", "enps", "choice", "text"];
export const MIN_ANSWERS = 3;   // an anonymous survey shows nothing until this many people answer
export function readSurvey(b = {}, today = new Date().toISOString().slice(0, 10)) {
  const errors = {};
  const title = text(b.title).slice(0, 140), intro = text(b.intro).slice(0, 1000), closesOn = text(b.closesOn);
  const anonymous = b.anonymous !== false;
  const raw = Array.isArray(b.questions) ? b.questions : [];
  if (!title) errors.title = "Please give the survey a title.";
  if (!isDay(closesOn)) errors.closesOn = "Please choose the closing date.";
  else if (closesOn < today) errors.closesOn = "The closing date cannot be in the past.";
  if (!raw.length) errors.questions = "Please add at least one question.";
  if (raw.length > 20) errors.questions = "Please keep the survey to 20 questions or fewer.";
  const questions = [];
  raw.slice(0, 20).forEach((q, i) => {
    const type = QUESTION_TYPES.includes(q && q.type) ? q.type : null, label = text(q && q.text).slice(0, 300);
    const options = type === "choice" ? [...new Set((Array.isArray(q.options) ? q.options : []).map((o) => text(o).slice(0, 80)).filter(Boolean))].slice(0, 10) : [];
    if (!type) errors[`q${i}`] = "Please choose the kind of question.";
    else if (!label) errors[`q${i}`] = "Please write the question.";
    else if (type === "choice" && options.length < 2) errors[`q${i}`] = "Please give at least two choices.";
    else questions.push({ type, text: label, ...(type === "choice" ? { options } : {}) });
  });
  return { title, intro, closesOn, anonymous, questions, errors };
}
/** One person's answers, checked against the questions. Every question needs an answer except written ones. */
export function readAnswers(questions, raw = []) {
  const errors = {}, answers = [];
  questions.forEach((q, i) => {
    const v = Array.isArray(raw) ? raw[i] : undefined;
    if (q.type === "text") { answers.push(text(v).slice(0, 2000)); return; }
    const n = Number(v);
    const ok = q.type === "scale" ? Number.isInteger(n) && n >= 1 && n <= 5 : q.type === "enps" ? Number.isInteger(n) && n >= 0 && n <= 10 : Number.isInteger(n) && n >= 0 && n < q.options.length;
    if (v === "" || v == null || !ok) errors[`q${i}`] = "Please answer this question.";
    answers.push(ok ? n : null);
  });
  return { answers, errors };
}
/** Employee Net Promoter Score: % who gave 9 or 10, less % who gave 0 to 6. */
export function enps(scores) {
  const list = scores.filter((s) => Number.isInteger(s));
  if (!list.length) return null;
  return Math.round((list.filter((s) => s >= 9).length - list.filter((s) => s <= 6).length) / list.length * 100);
}
/** Results per question. For an anonymous survey, nothing is shown below MIN_ANSWERS and written answers are sorted. */
export function surveyResults(questions, responses, anonymous = true) {
  const n = responses.length;
  if (anonymous && n < MIN_ANSWERS) return { responses: n, hidden: true, questions: [] };
  return {
    responses: n, hidden: false,
    questions: questions.map((q, i) => {
      const vals = responses.map((r) => r.answers[i]);
      if (q.type === "text") { const list = vals.map(text).filter(Boolean); return { ...q, answers: anonymous ? list.sort((a, b) => a.localeCompare(b)) : list }; }
      const nums = vals.filter((v) => Number.isInteger(v));
      const size = q.type === "scale" ? 5 : q.type === "enps" ? 11 : q.options.length, base = q.type === "scale" ? 1 : 0;
      const counts = Array.from({ length: size }, (_, k) => nums.filter((v) => v === k + base).length);
      const average = nums.length && q.type !== "choice" ? Math.round(nums.reduce((s, v) => s + v, 0) / nums.length * 10) / 10 : null;
      return { ...q, counts, average, ...(q.type === "enps" ? { score: enps(nums) } : {}) };
    }),
  };
}

/* ---------- Training ---------- */
export function readTraining(b = {}) {
  const errors = {};
  const title = text(b.title).slice(0, 140), detail = text(b.detail).slice(0, 2000), link = text(b.link).slice(0, 500), dueOn = text(b.dueOn);
  if (!title) errors.title = "Please give the training a title.";
  if (link && !/^https:\/\/[^\s]+$/i.test(link)) errors.link = "Please give a link that starts with https://.";
  if (dueOn && !isDay(dueOn)) errors.dueOn = "Please choose a valid due date, or leave it empty.";
  return { title, detail, link, dueOn: dueOn || null, errors };
}
/** Who to assign: everyone, a department, or listed people. */
export function readAssignees(b = {}) {
  const errors = {};
  const to = ["everyone", "department", "people"].includes(b.to) ? b.to : null;
  const dept = text(b.dept).slice(0, 80);
  const emails = [...new Set((Array.isArray(b.emails) ? b.emails : []).map((e) => text(e).toLowerCase()).filter(isEmail))].slice(0, 500);
  if (!to) errors.to = "Please choose who should do the training.";
  else if (to === "department" && !dept) errors.dept = "Please choose the department.";
  else if (to === "people" && !emails.length) errors.emails = "Please choose at least one person.";
  return { to, dept, emails, errors };
}
export function readCompletion(b = {}, today) {
  const errors = {};
  const done = b.done !== false, completedOn = text(b.completedOn) || today, note = text(b.note).slice(0, 500);
  if (done && (!isDay(completedOn) || completedOn > today)) errors.completedOn = "Please choose the day you finished. It cannot be in the future.";
  return { done, completedOn: done ? completedOn : null, note, errors };
}

/* ---------- Notice period ---------- */
export const noticeDefault = () => { const n = Number(process.env.NOTICE_PERIOD_DAYS); return Number.isInteger(n) && n > 0 && n <= 365 ? n : 30; };
export function readResignation(b = {}, today) {
  const errors = {};
  const email = text(b.email).toLowerCase(), resignedOn = text(b.resignedOn), note = text(b.note).slice(0, 1000);
  const raw = b.noticeDays === "" || b.noticeDays == null ? noticeDefault() : Number(b.noticeDays);
  const agreedLastDay = text(b.agreedLastDay);
  if (!isEmail(email)) errors.email = "Please choose the person.";
  if (!isDay(resignedOn)) errors.resignedOn = "Please choose the date they resigned.";
  else if (resignedOn > today) errors.resignedOn = "The resignation date cannot be in the future.";
  if (!Number.isInteger(raw) || raw < 0 || raw > 365) errors.noticeDays = "Please enter the notice period in days, from 0 to 365.";
  if (agreedLastDay && !isDay(agreedLastDay)) errors.agreedLastDay = "Please choose a valid last day, or leave it empty.";
  else if (agreedLastDay && isDay(resignedOn) && agreedLastDay < resignedOn) errors.agreedLastDay = "The last day cannot be before the resignation date.";
  return { email, resignedOn, noticeDays: Number.isInteger(raw) ? raw : 0, agreedLastDay: agreedLastDay || null, note, errors };
}
/** Where a notice period stands: the expected last day, the last day in use, and how many days short it is. */
export function noticeInfo({ resignedOn, noticeDays, agreedLastDay, lastDay }, today) {
  const expected = addDays(resignedOn, noticeDays);
  const actual = agreedLastDay || lastDay || null;
  const shortBy = actual && actual < expected ? daysBetween(actual, expected) : 0;
  const end = actual || expected;
  return { expected, actual, shortBy, served: Math.max(0, Math.min(daysBetween(resignedOn, today), daysBetween(resignedOn, end))), left: Math.max(0, daysBetween(today, end)), over: today > end };
}

/* ---------- Approval stand-ins ---------- */
export const STAND_IN_MAX_DAYS = 90;
export function readStandIn(b = {}, me, today) {
  const errors = {};
  const standIn = text(b.standIn).toLowerCase(), from = text(b.from), to = text(b.to), forEmail = text(b.for).toLowerCase() || me;
  if (!isEmail(standIn)) errors.standIn = "Please choose who covers your approvals.";
  else if (standIn === forEmail) errors.standIn = "Please choose someone else; a person cannot cover their own approvals.";
  if (!isDay(from)) errors.from = "Please choose the first day.";
  if (!isDay(to)) errors.to = "Please choose the last day.";
  if (isDay(from) && isDay(to)) {
    if (to < from) errors.to = "The last day cannot be before the first day.";
    else if (to < today) errors.to = "The last day is already past.";
    else if (daysBetween(from, to) >= STAND_IN_MAX_DAYS) errors.to = `A stand-in can cover at most ${STAND_IN_MAX_DAYS} days.`;
  }
  return { standIn, forEmail, from, to, errors };
}

/* ---------- Review cycles and colleague feedback ---------- */
export function readCycle(b = {}, today) {
  const errors = {};
  const name = text(b.name).slice(0, 60), selfDue = text(b.selfDue), managerDue = text(b.managerDue), dept = text(b.dept).slice(0, 80);
  if (!name) errors.name = "Please name the cycle, for example 2026 H2.";
  if (!isDay(selfDue)) errors.selfDue = "Please choose when self-reviews are due.";
  else if (selfDue < today) errors.selfDue = "The date cannot be in the past.";
  if (!isDay(managerDue)) errors.managerDue = "Please choose when manager reviews are due.";
  else if (isDay(selfDue) && managerDue < selfDue) errors.managerDue = "Manager reviews are due after self-reviews.";
  return { name, selfDue, managerDue, dept, errors };
}
export function readFeedbackAsk(b = {}, reviewee) {
  const errors = {};
  const emails = [...new Set((Array.isArray(b.emails) ? b.emails : []).map((e) => text(e).toLowerCase()).filter(isEmail))].filter((e) => e !== String(reviewee).toLowerCase());
  if (!emails.length) errors.emails = "Please choose at least one colleague.";
  if (emails.length > 8) errors.emails = "Please ask at most eight colleagues.";
  return { emails: emails.slice(0, 8), errors };
}
/** What happens after a self-review: the manager reviews next when there is one, otherwise HR. */
export const afterSelf = (managerEmail) => (managerEmail ? "manager-pending" : "hr-pending");

/* ---------- Interviews ---------- */
export const MODES = ["video", "in-person", "phone"];
export const VERDICTS = ["strong-yes", "yes", "no", "strong-no"];
/** India time, as typed in a date-and-time box ("2026-11-20T15:30"), to an ISO instant. */
export const istToIso = (v) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + ":00+05:30")) ? new Date(v + ":00+05:30").toISOString() : null);
export function readInterview(b = {}, now = new Date()) {
  const errors = {};
  const at = istToIso(text(b.at)), minutes = Number(b.minutes || 45), mode = MODES.includes(b.mode) ? b.mode : null;
  const place = text(b.place).slice(0, 300), note = text(b.note).slice(0, 500);
  const interviewers = [...new Set((Array.isArray(b.interviewers) ? b.interviewers : []).map((e) => text(e).toLowerCase()).filter(isEmail))].slice(0, 5);
  if (!at) errors.at = "Please choose the date and time.";
  else if (Date.parse(at) < now.getTime() - 3600000) errors.at = "The interview time is in the past.";
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 240) errors.minutes = "Please choose a length from 15 minutes to 4 hours.";
  if (!mode) errors.mode = "Please choose how the interview happens.";
  if (!interviewers.length) errors.interviewers = "Please choose at least one interviewer.";
  if (mode === "video" && place && !/^https:\/\/\S+$/i.test(place)) errors.place = "Please give the meeting link, starting with https://.";
  return { at, minutes, mode, place, note, interviewers, errors };
}
export function readVerdict(b = {}) {
  const errors = {};
  const verdict = VERDICTS.includes(b.verdict) ? b.verdict : null, notes = text(b.notes).slice(0, 3000);
  if (!verdict) errors.verdict = "Please choose your recommendation.";
  if (!notes) errors.notes = "Please write a few lines on why.";
  return { verdict, notes, errors };
}
const icsText = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsTime = (iso) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** A calendar file for one interview, in UTC. Lines are folded at 75 characters as the format asks. */
export function interviewIcs({ id, at, minutes, title, place, description }, stamp = new Date().toISOString()) {
  const end = new Date(Date.parse(at) + minutes * 60000).toISOString();
  const fold = (line) => { const out = []; let s = line; while (s.length > 75) { out.push(s.slice(0, 75)); s = " " + s.slice(75); } out.push(s); return out.join("\r\n"); };
  return ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${PRODUCT}//Interviews//EN`, "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:interview-${id}@wohlig-one`, `DTSTAMP:${icsTime(stamp)}`, `DTSTART:${icsTime(at)}`, `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsText(title)}`, place ? `LOCATION:${icsText(place)}` : null, description ? `DESCRIPTION:${icsText(description)}` : null,
    "END:VEVENT", "END:VCALENDAR"].filter(Boolean).map(fold).join("\r\n") + "\r\n";
}
/** A hired candidate as an onboarding draft: first and last name split at the last space. */
export function candidateDraft(c, opening = {}) {
  const parts = text(c.name).split(/\s+/).filter(Boolean);
  const last = parts.length > 1 ? parts.pop() : "", first = parts.join(" ");
  const pemail = /@wohlig\.com$/i.test(c.email || "") ? "" : text(c.email);
  const phone = String(c.phone || "").replace(/\D/g, "").slice(-10);
  return { first, last, pemail, phone, address: "", dept: text(opening.dept), title: text(opening.title), mgr: "", start: "", kind: "" };
}
