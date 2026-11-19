/*
 * The checking rules for polls, praise, articles, app links and requests, kept apart from the routes so they can be
 * tested without a database. Each `read…` takes what the page sent and returns the cleaned values plus `errors`
 * (field name to a sentence a person can act on).
 */
export const LIMITS = { question: 200, option: 80, minOptions: 2, maxOptions: 6, praise: 500, title: 140, article: 20000, appTitle: 60, appText: 200, reason: 500, maxAdvanceMinor: 100000000 };
export const BADGES = ["thanks", "team-player", "problem-solver", "above-and-beyond", "mentor"];
export const ATTENDANCE_KINDS = ["missed-punch", "work-from-home", "on-duty"];
const text = (v) => String(v == null ? "" : v).replace(/\r\n/g, "\n").trim();
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

export function readPoll(b = {}) {
  const errors = {};
  const question = text(b.question);
  // The same option typed twice, or in different capitals, counts once.
  const seen = new Set();
  const options = (Array.isArray(b.options) ? b.options : []).map(text).filter((o) => o && !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase()));
  if (!question) errors.question = "Please enter the question.";
  else if (question.length > LIMITS.question) errors.question = `Please keep the question under ${LIMITS.question} characters.`;
  if (options.length < LIMITS.minOptions) errors.options = "Please give at least two different options.";
  else if (options.length > LIMITS.maxOptions) errors.options = `A poll can have up to ${LIMITS.maxOptions} options.`;
  else if (options.some((o) => o.length > LIMITS.option)) errors.options = `Please keep each option under ${LIMITS.option} characters.`;
  let closesAt = null;
  if (b.closesAt) { const d = new Date(b.closesAt); if (Number.isNaN(d.getTime())) errors.closesAt = "Please choose a valid closing date."; else if (d <= new Date()) errors.closesAt = "The closing date must be in the future."; else closesAt = d.toISOString(); }
  return { question, options, closesAt, errors };
}

/** Totals per option for a poll with `count` options, from rows of { option_index, n }. Never names. */
export function tally(count, rows) {
  const totals = Array.from({ length: count }, () => 0);
  for (const r of rows) { const i = Number(r.option_index); if (Number.isInteger(i) && i >= 0 && i < count) totals[i] += Number(r.n) || 0; }
  return { totals, votes: totals.reduce((a, b) => a + b, 0) };
}

export function readPraise(b = {}, from = "") {
  const errors = {};
  const to = text(b.to).toLowerCase(), message = text(b.message), badge = BADGES.includes(b.badge) ? b.badge : "thanks";
  if (!isEmail(to)) errors.to = "Please choose who you are praising.";
  else if (to === String(from).toLowerCase()) errors.to = "Please choose a colleague. You cannot praise yourself.";
  if (!message) errors.message = "Please say what they did.";
  else if (message.length > LIMITS.praise) errors.message = `Please keep it under ${LIMITS.praise} characters.`;
  return { to, message, badge, errors };
}

export function readArticle(b = {}) {
  const errors = {};
  const title = text(b.title), body = text(b.body), status = b.status === "live" ? "live" : "draft";
  const requiresAck = b.requiresAck === true;
  if (!title) errors.title = "Please give the article a title."; else if (title.length > LIMITS.title) errors.title = `Please keep the title under ${LIMITS.title} characters.`;
  if (!body) errors.body = "Please write the article."; else if (body.length > LIMITS.article) errors.body = "This article is too long. Please shorten it or split it in two.";
  return { title, body, status, requiresAck, errors };
}

export function readAppLink(b = {}) {
  const errors = {};
  const title = text(b.title), description = text(b.description);
  let url = text(b.url);
  if (!title) errors.title = "Please name the app."; else if (title.length > LIMITS.appTitle) errors.title = `Please keep the name under ${LIMITS.appTitle} characters.`;
  if (description.length > LIMITS.appText) errors.description = `Please keep the description under ${LIMITS.appText} characters.`;
  try { const u = new URL(url); if (u.protocol !== "https:") throw new Error("not https"); url = u.toString(); }
  catch { errors.url = "Please enter the full web address, starting with https://"; }
  return { title, url, description, errors };
}

/** Rupees typed by a person ("12,500" or "12500.50") to whole paise. */
export function readAdvance(b = {}) {
  const errors = {};
  const reason = text(b.reason);
  const n = Number(String(b.amount == null ? "" : b.amount).replace(/[₹,\s]/g, ""));
  const amountMinor = Number.isFinite(n) ? Math.round(n * 100) : NaN;
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) errors.amount = "Please enter the amount in rupees.";
  else if (amountMinor > LIMITS.maxAdvanceMinor) errors.amount = "That amount is too large. Please check it or speak to HR.";
  if (!reason) errors.reason = "Please say what the advance is for."; else if (reason.length > LIMITS.reason) errors.reason = `Please keep the reason under ${LIMITS.reason} characters.`;
  return { amountMinor, reason, errors };
}

export function readAttendanceRequest(b = {}, today = new Date().toISOString().slice(0, 10)) {
  const errors = {};
  const date = text(b.date), kind = text(b.kind), note = text(b.note);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + "T00:00:00Z"))) errors.date = "Please choose the date.";
  else {
    const days = Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
    if (days < -60) errors.date = "That date is more than 60 days ago. Please speak to HR."; else if (days > 30) errors.date = "Please choose a date within the next 30 days.";
    else if (kind === "missed-punch" && days > 0) errors.date = "A missed punch can only be reported for today or an earlier day.";
  }
  if (!ATTENDANCE_KINDS.includes(kind)) errors.kind = "Please choose what the request is about.";
  if (!note) errors.note = "Please add a short note for HR."; else if (note.length > LIMITS.reason) errors.note = `Please keep the note under ${LIMITS.reason} characters.`;
  return { date, kind, note, errors };
}

export function readDecision(b = {}) {
  const decision = b.decision === "approve" ? "approved" : b.decision === "decline" ? "declined" : null;
  const note = text(b.note).slice(0, LIMITS.reason);
  const errors = {};
  if (!decision) errors.decision = "Please choose to approve or decline.";
  if (decision === "declined" && !note) errors.note = "Please say why, so the person knows what to do next.";
  return { decision, note, errors };
}

export const TAX_SECTIONS = ["80C", "80D", "HRA", "Home loan interest", "NPS", "Other"];
/** The Indian financial year a date falls in (April to March): 2026 means April 2026 to March 2027. */
export const financialYear = (isoDay) => { const [y, m] = String(isoDay).split("-").map(Number); return m >= 4 ? y : y - 1; };

export function readTaxDeclaration(b = {}) {
  const errors = {};
  const regime = b.regime === "old" ? "old" : "new";
  const raw = Array.isArray(b.items) ? b.items : [];
  if (raw.length > 30) errors.items = "Please keep the declaration to 30 lines or fewer.";
  const items = [];
  raw.slice(0, 30).forEach((it, i) => {
    const section = TAX_SECTIONS.includes(it && it.section) ? it.section : null;
    const description = text(it && it.description).slice(0, 120);
    const n = Number(String(it && it.amount == null ? "" : it.amount).replace(/[₹,\s]/g, ""));
    const amountMinor = Number.isFinite(n) ? Math.round(n * 100) : NaN;
    if (!section) errors[`item${i}`] = "Please choose the section for this line.";
    else if (!Number.isFinite(amountMinor) || amountMinor <= 0) errors[`item${i}`] = "Please enter the amount in rupees for this line.";
    else if (amountMinor > 1000000000) errors[`item${i}`] = "That amount is too large. Please check it.";
    else items.push({ section, description, amountMinor });
  });
  // The new regime takes no such deductions, so lines are kept only for the old one.
  return { regime, items: regime === "old" ? items : [], submit: b.submit === true, errors: regime === "old" ? errors : {} };
}

export function readGoal(b = {}) {
  const errors = {};
  const title = text(b.title), detail = text(b.detail);
  const progress = Math.round(Number(b.progress));
  const dueOn = text(b.dueOn) || null;
  if (!title) errors.title = "Please name the goal."; else if (title.length > 140) errors.title = "Please keep the goal under 140 characters.";
  if (detail.length > 1000) errors.detail = "Please keep the details under 1,000 characters.";
  if (dueOn && (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn) || Number.isNaN(Date.parse(dueOn + "T00:00:00Z")))) errors.dueOn = "Please choose a valid date.";
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) errors.progress = "Progress is a number from 0 to 100.";
  return { title, detail, dueOn, progress: Number.isFinite(progress) ? progress : 0, errors };
}
