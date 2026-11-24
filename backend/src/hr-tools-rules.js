/*
 * The checking rules for the HR tools (probation, helpdesk, exit interviews, hiring, reviews), kept apart from the routes
 * so they can be tested without a database. Each `read…` returns the cleaned values plus `errors` (field to sentence).
 */
export const TICKET_CATEGORIES = ["payroll", "leave", "attendance", "it", "documents", "other"];
export const EXIT_REASONS = ["better-opportunity", "compensation", "career-growth", "relocation", "personal", "higher-studies", "work-environment", "end-of-contract", "other"];
export const STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected"];
export const PROBATION_MONTHS = 6;
const text = (v) => String(v == null ? "" : v).replace(/\r\n/g, "\n").trim();
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

/** The day probation ends when HR has decided nothing: the joining date plus six months (the same day of the month, or the month's last day). */
export function probationEnd(startDay, months = PROBATION_MONTHS) {
  if (!isDay(String(startDay || "").slice(0, 10))) return null;
  const [y, m, d] = String(startDay).slice(0, 10).split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}

export function readProbation(b = {}, today = new Date().toISOString().slice(0, 10)) {
  const errors = {};
  const email = text(b.email).toLowerCase(), action = b.action === "confirm" ? "confirmed" : b.action === "extend" ? "extended" : null;
  const endsOn = text(b.endsOn), note = text(b.note).slice(0, 500);
  if (!isEmail(email)) errors.email = "Please choose the person.";
  if (!action) errors.action = "Please choose to confirm or extend.";
  if (action === "extended") {
    if (!isDay(endsOn)) errors.endsOn = "Please choose the new end date.";
    else if (endsOn <= today) errors.endsOn = "The new end date must be in the future.";
    if (!note) errors.note = "Please say why probation is extended.";
  }
  return { email, action, endsOn: action === "extended" ? endsOn : null, note, errors };
}

export function readTicket(b = {}) {
  const errors = {};
  const category = TICKET_CATEGORIES.includes(b.category) ? b.category : null, subject = text(b.subject), body = text(b.body);
  if (!category) errors.category = "Please choose what it is about.";
  if (!subject) errors.subject = "Please add a short subject."; else if (subject.length > 140) errors.subject = "Please keep the subject under 140 characters.";
  if (!body) errors.body = "Please describe what you need."; else if (body.length > 4000) errors.body = "Please keep it under 4,000 characters.";
  return { category, subject, body, errors };
}
export function readReply(b = {}) {
  const body = text(b.body), errors = {};
  if (!body) errors.body = "Please write your reply."; else if (body.length > 4000) errors.body = "Please keep it under 4,000 characters.";
  return { body, errors };
}

export function readExit(b = {}) {
  const errors = {};
  const email = text(b.email).toLowerCase(), reason = EXIT_REASONS.includes(b.reason) ? b.reason : null, notes = text(b.notes).slice(0, 4000);
  const wouldRehire = b.wouldRehire === true ? true : b.wouldRehire === false ? false : null;
  if (!isEmail(email)) errors.email = "Please choose the person.";
  if (!reason) errors.reason = "Please choose the main reason for leaving.";
  return { email, reason, notes, wouldRehire, errors };
}

export function readOpening(b = {}) {
  const errors = {};
  const title = text(b.title), dept = text(b.dept).slice(0, 80), description = text(b.description).slice(0, 4000);
  if (!title) errors.title = "Please name the role."; else if (title.length > 120) errors.title = "Please keep the role name under 120 characters.";
  return { title, dept, description, errors };
}
export function readCandidate(b = {}) {
  const errors = {};
  const name = text(b.name), email = text(b.email).toLowerCase(), phone = text(b.phone).slice(0, 30), notes = text(b.notes).slice(0, 4000);
  const stage = STAGES.includes(b.stage) ? b.stage : "applied";
  if (!name) errors.name = "Please enter the candidate's name."; else if (name.length > 120) errors.name = "Please keep the name under 120 characters.";
  if (email && !isEmail(email)) errors.email = "Please enter a valid email address, or leave it empty.";
  return { name, email, phone, notes, stage, errors };
}

export function readReviewStart(b = {}) {
  const errors = {};
  const email = text(b.email).toLowerCase(), period = text(b.period);
  if (!isEmail(email)) errors.email = "Please choose the person.";
  if (!period) errors.period = "Please name the period, for example 2026 or H1 2026."; else if (period.length > 40) errors.period = "Please keep the period under 40 characters.";
  return { email, period, errors };
}
export function readReviewText(b = {}, withRating = false) {
  const errors = {};
  const body = text(b.text);
  if (!body) errors.text = "Please write the review."; else if (body.length > 8000) errors.text = "Please keep it under 8,000 characters.";
  let rating = null;
  if (withRating) { rating = Math.round(Number(b.rating)); if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = "Please choose a rating from 1 to 5."; }
  return { text: body, rating, errors };
}

/* Calibration (as Keka's): HR lines up a cycle's ratings, moves a rating with a reason, and places each person on the 9-box
   by performance (the rating) and potential (low, medium, high), which HR judges. */
export const POTENTIAL = { 1: "Low", 2: "Medium", 3: "High" };
export function readCalibration(b = {}, managerRating = null) {
  const errors = {};
  const rating = Math.round(Number(b.rating));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = "Please choose a rating from 1 to 5.";
  let potential = null;
  if (b.potential !== undefined && b.potential !== null && b.potential !== "") {
    potential = Math.round(Number(b.potential));
    if (!POTENTIAL[potential]) errors.potential = "Please choose low, medium or high potential.";
  }
  const note = text(b.note);
  if (note.length > 1000) errors.note = "Please keep the reason under 1,000 characters.";
  else if (!errors.rating && managerRating && rating !== managerRating && !note) errors.note = "Please give the reason for changing the manager's rating.";
  return { rating, potential, note, errors };
}
/** The 9-box cell for a rating (1-2 low, 3 medium, 4-5 high performance) and a potential; null until both are known. */
const BOXES = { "3-1": "Rough diamond", "3-2": "High potential", "3-3": "Star", "2-1": "Inconsistent performer", "2-2": "Core player",
  "2-3": "High performer", "1-1": "Needs attention", "1-2": "Effective", "1-3": "Trusted professional" };
export function nineBox(rating, potential) {
  if (!rating || !potential) return null;
  const perf = rating <= 2 ? 1 : rating === 3 ? 2 : 3;
  return { perf, potential, label: BOXES[`${potential}-${perf}`] };
}
/** How many people have each rating 1 to 5 (empty ratings are left out). */
export const spread = (ratings) => [1, 2, 3, 4, 5].map((n) => ratings.filter((r) => r === n).length);
