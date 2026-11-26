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

export function readAttendanceRequest(b = {}, today = new Date().toISOString().slice(0, 10), nowTime = null) {
  const errors = {};
  const date = text(b.date), kind = text(b.kind), note = text(b.note);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + "T00:00:00Z"))) errors.date = "Please choose the date.";
  else {
    const days = Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
    if (days < -60) errors.date = "That date is more than 60 days ago. Please speak to HR."; else if (days > 30) errors.date = "Please choose a date within the next 30 days.";
    else if (kind === "missed-punch" && days > 0) errors.date = "A missed punch can only be reported for today or an earlier day.";
  }
  if (!ATTENDANCE_KINDS.includes(kind)) errors.kind = "Please choose what the request is about.";
  if (!note) errors.note = "Please add a short note."; else if (note.length > LIMITS.reason) errors.note = `Please keep the note under ${LIMITS.reason} characters.`;
  // A missed punch says which punch and the real time (as Keka's attendance regularisation): approving it adds that punch.
  let time = null, direction = null;
  if (kind === "missed-punch") {
    direction = b.direction === "IN" ? "IN" : "OUT";
    time = text(b.time).slice(0, 5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.time = direction === "OUT" ? "Please enter the time you left, like 18:45." : "Please enter the time you arrived, like 09:40.";
    else if (!errors.date && date === today && nowTime && time > nowTime) errors.time = "That time has not come yet. Please check it.";
  }
  return { date, kind, note, time, direction, errors };
}

export function readDecision(b = {}) {
  const decision = b.decision === "approve" ? "approved" : b.decision === "decline" ? "declined" : null;
  const note = text(b.note).slice(0, LIMITS.reason);
  const errors = {};
  if (!decision) errors.decision = "Please choose to approve or decline.";
  if (decision === "declined" && !note) errors.note = "Please say why, so the person knows what to do next.";
  return { decision, note, errors };
}

export const TAX_SECTIONS = ["80C", "80D", "80D parents", "HRA", "80GG", "Leave travel", "Home loan interest", "Let-out property", "NPS", "80E", "80EEA", "80G", "80TTA",
  "80DD", "80DDB", "80U", "Other", "Previous employer salary", "Previous employer TDS", "Income from other sources"];
/** Lines kept under either regime: salary and TDS from a previous employer this year, and income from other sources, count towards the year's tax in both. */
export const BOTH_REGIMES = ["Previous employer salary", "Previous employer TDS", "Income from other sources", "Let-out property"];
/** The Indian financial year a date falls in (April to March): 2026 means April 2026 to March 2027. */
export const financialYear = (isoDay) => { const [y, m] = String(isoDay).split("-").map(Number); return m >= 4 ? y : y - 1; };

/* Form 124 (Rule 205, Income-tax Rules 2026) asks for the landlord's name, address and PAN when the year's rent is above
   ₹1,00,000, and the relationship with the landlord; and for the lender's name, address and PAN for home loan interest. */
function isDay(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(v + "T00:00:00Z")); }
export const RENT_PAN_ABOVE_MINOR = 10000000;   // ₹1,00,000 a year
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PARTY_OF = { HRA: "landlord", "Home loan interest": "lender", "Leave travel": "journey", "Let-out property": "property", "80GG": "landlord",
  "80D": "flags", "80D parents": "flags", "80DD": "flags", "80DDB": "flags", "80U": "flags" };
const rupeesMinor = (v) => { const n = Number(String(v == null ? "" : v).replace(/[₹,\s]/g, "")); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };

/* Leave travel (Schedule III, Sl. No. 8 of the Income-tax Act 2025 with Rule 278; earlier section 10(5) and Rule 2B): the fare for
   journeys in India while on leave, for the person and their family, under the old regime only. Two journeys in each block of four
   calendar years (2022-25, 2026-29, …), plus one journey carried over from the block before if it is made in the first calendar year
   of the new block. Only the fare by the shortest route counts: economy air, AC first class rail, or first class or deluxe bus. */
export const LTA_MODES = ["air", "rail", "road"];
/** The four-calendar-year block a year falls in: 2027 → 2026 (the 2026-29 block). */
export const ltaBlockOf = (year) => 2022 + 4 * Math.floor((Number(year) - 2022) / 4);
/** Problems with a list of journeys [{ startOn, carryForward }] in the same person's claims: more than two in a block, or a carried-over
    journey that is not in the block's first calendar year, or more than one carried over. Returns a sentence or "". */
export function journeyProblem(journeys = []) {
  const byBlock = new Map();
  for (const j of journeys) {
    const y = Number(String(j.startOn || "").slice(0, 4));
    if (!y) continue;
    const b = ltaBlockOf(y), k = byBlock.get(b) || { regular: 0, carried: 0 };
    if (j.carryForward) {
      if (y !== b) return `A journey carried over from the ${b - 4}-${String(b - 1).slice(2)} block must be made in ${b}, the first year of the new block.`;
      k.carried += 1;
    } else k.regular += 1;
    byBlock.set(b, k);
  }
  for (const [b, k] of byBlock) {
    const range = `${b}-${String(b + 3).slice(2)}`;
    if (k.regular > 2) return `Leave travel is exempt for two journeys in each block of four years, and the ${range} block already has ${k.regular}. Please remove one.`;
    if (k.carried > 1) return `Only one journey can be carried over into the ${range} block.`;
  }
  return "";
}

function readParty(raw, section) {
  if (!PARTY_OF[section]) return null;
  const r = raw && typeof raw === "object" ? raw : {};
  // Ticks that change the limit: someone insured or treated is 60 or older (80D, 80DDB), or the disability is severe (80DD, 80U).
  if (PARTY_OF[section] === "flags") return section === "80DD" || section === "80U" ? { severe: r.severe === true } : { senior: r.senior === true };
  // A let-out house: the rent is the line's amount; the municipal tax paid and the home loan interest reduce it, and the lender is named.
  if (section === "Let-out property") return { address: text(r.address).slice(0, 300), municipalTaxMinor: Math.min(rupeesMinor(r.municipalTax ?? (r.municipalTaxMinor != null ? r.municipalTaxMinor / 100 : "")), 1000000000),
    interestMinor: Math.min(rupeesMinor(r.interest ?? (r.interestMinor != null ? r.interestMinor / 100 : "")), 1000000000),
    lender: text(r.lender).slice(0, 120), lenderAddress: text(r.lenderAddress).slice(0, 300), lenderPan: text(r.lenderPan).toUpperCase().replace(/\s/g, "").slice(0, 10) };
  if (section === "Leave travel") {
    const day = (v) => (isDay(text(v)) ? text(v) : "");
    return { from: text(r.from).slice(0, 80), to: text(r.to).slice(0, 80), startOn: day(r.startOn), endOn: day(r.endOn),
      mode: LTA_MODES.includes(r.mode) ? r.mode : "", travellers: text(r.travellers).slice(0, 160), carryForward: r.carryForward === true };
  }
  const party = { name: text(r.name).slice(0, 120), address: text(r.address).slice(0, 300), pan: text(r.pan).toUpperCase().replace(/\s/g, "").slice(0, 10) };
  if (section === "HRA") { party.relationship = text(r.relationship).slice(0, 60); party.metro = r.metro === true; }
  return party;
}

/** `fy`: the financial year (2026 for 2026-27), so a journey is claimed in its own year. `earlierJourneys`: leave travel journeys the person claimed in other financial years ([{ startOn, carryForward }]), for the block limit. */
export function readTaxDeclaration(b = {}, { earlierJourneys = [], fy = null } = {}) {
  const errors = {};
  const regime = b.regime === "old" ? "old" : "new";
  const submit = b.submit === true;
  const raw = Array.isArray(b.items) ? b.items : [];
  if (raw.length > 30) errors.items = "Please keep the declaration to 30 lines or fewer.";
  const lines = [];   // [index sent, item]
  raw.slice(0, 30).forEach((it, i) => {
    const section = TAX_SECTIONS.includes(it && it.section) ? it.section : null;
    const description = text(it && it.description).slice(0, 120);
    const n = Number(String(it && it.amount == null ? "" : it.amount).replace(/[₹,\s]/g, ""));
    const amountMinor = Number.isFinite(n) ? Math.round(n * 100) : NaN;
    if (!section) errors[`item${i}`] = "Please choose the section for this line.";
    else if (!Number.isFinite(amountMinor) || amountMinor <= 0) errors[`item${i}`] = "Please enter the amount in rupees for this line.";
    else if (amountMinor > 1000000000) errors[`item${i}`] = "That amount is too large. Please check it.";
    else {
      const party = readParty(it && it.party, section);
      if (party && ((party.pan && !PAN.test(party.pan)) || (party.lenderPan && !PAN.test(party.lenderPan)))) errors[`party${i}`] = "Please enter the PAN as 10 characters, like ABCDE1234F.";
      lines.push([i, { section, description, amountMinor, ...(party ? { party } : {}) }]);
    }
  });
  // The new regime takes no deductions, so under it only income lines (previous employer, other sources) are kept and checked.
  const kept = regime === "old" ? lines : lines.filter(([, it]) => BOTH_REGIMES.includes(it.section));
  const keptAt = new Set(kept.map(([i]) => i));
  const errs = regime === "old" ? errors : Object.fromEntries(Object.entries(errors).filter(([k]) => k === "items" || keptAt.has(Number(k.replace(/\D/g, "")))));
  if (submit && regime === "old") {
    const rent = kept.filter(([, it]) => it.section === "HRA").reduce((n, [, it]) => n + it.amountMinor, 0);
    for (const [i, it] of kept) {
      const p = it.party;
      if (!p || errs[`party${i}`]) continue;
      if (it.section === "HRA" && (!p.name || !p.address)) errs[`party${i}`] = "Please enter the landlord's name and address.";
      else if (it.section === "HRA" && rent > RENT_PAN_ABOVE_MINOR && !p.pan) errs[`party${i}`] = "Your rent for the year is above ₹1,00,000, so the landlord's PAN is needed.";
      else if (it.section === "Home loan interest" && (!p.name || !p.address)) errs[`party${i}`] = "Please enter the lender's name and address.";
      else if (it.section === "80GG" && (!p.name || !p.address)) errs[`party${i}`] = "Please enter the landlord's name and address.";
      else if (it.section === "Leave travel") {
        if (!p.from || !p.to) errs[`party${i}`] = "Please enter where the journey started and where it went to.";
        else if (!p.startOn || !p.endOn) errs[`party${i}`] = "Please enter the dates of the journey.";
        else if (p.endOn < p.startOn) errs[`party${i}`] = "The journey cannot end before it starts.";
        else if (fy && (p.startOn < `${fy}-04-01` || p.startOn > `${fy + 1}-03-31`)) errs[`party${i}`] = "Please claim a journey in the financial year it was made.";
        else if (!p.mode) errs[`party${i}`] = "Please choose how you travelled.";
      }
    }
    const journeys = kept.filter(([, it]) => it.section === "Leave travel" && it.party).map(([, it]) => it.party);
    const problem = journeys.length ? journeyProblem([...earlierJourneys, ...journeys]) : "";
    if (problem) errs.journeys = problem;
  }
  // A let-out house counts under either regime, so it is checked under either.
  if (submit) for (const [i, it] of kept) {
    const p = it.party;
    if (it.section !== "Let-out property" || !p || errs[`party${i}`]) continue;
    if (!p.address) errs[`party${i}`] = "Please enter the address of the house you let out.";
    else if (p.interestMinor && (!p.lender || !p.lenderAddress)) errs[`party${i}`] = "Please enter the lender's name and address for the home loan interest.";
  }
  return { regime, items: kept.map(([, it]) => it), submit, errors: errs };
}

/* ---------- Declaration and proof windows ---------- */

/** Open when there is no due date, the due date has not passed, or payroll reopened it for this person until a date not yet passed. */
export const windowOpen = ({ today, due, unlockedUntil, joinerUntil = null }) => !due || today <= due || (!!unlockedUntil && today <= unlockedUntil) || (!!joinerUntil && today <= joinerUntil);
/** The last day a new joiner may still declare: the joining date plus the days payroll allows. Null when none. */
export const joinerUntil = (start, days) => {
  if (!start || !(days > 0)) return null;
  const d = new Date(`${String(start instanceof Date ? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}` : start).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** The financial year's due dates set by payroll. Empty clears a date. The proof date may not come before the declaration date. */
export function readTaxDates(b = {}, fy) {
  const errors = {};
  const day = (k) => { const v = text(b[k]); if (!v) return null; if (!isDay(v)) { errors[k] = "Please choose a date."; return null; } return v; };
  const declarationDue = day("declarationDue"), proofDue = day("proofDue");
  // New joiners may declare for this many days after joining, even after the dates (empty: no extra time).
  const rawDays = text(b.joinerDays), joinerDays = rawDays === "" ? null : Number(rawDays);
  if (joinerDays !== null && !(Number.isInteger(joinerDays) && joinerDays >= 0 && joinerDays <= 180)) errors.joinerDays = "Please enter a number of days from 0 to 180.";
  const inYear = (d) => d >= `${fy}-04-01` && d <= `${fy + 1}-03-31`;
  if (declarationDue && !inYear(declarationDue)) errors.declarationDue = "Please choose a date in this financial year.";
  if (proofDue && !inYear(proofDue)) errors.proofDue = "Please choose a date in this financial year.";
  if (declarationDue && proofDue && proofDue < declarationDue) errors.proofDue = "The proof date cannot be before the declaration date.";
  return { declarationDue, proofDue, joinerDays: errors.joinerDays ? null : joinerDays, errors };
}
export const UNLOCK_KINDS = ["declaration", "proof"];
/** Payroll reopens the declaration or the proofs for one person until a date. */
export function readUnlock(b = {}, today) {
  const errors = {};
  const email = text(b.email).toLowerCase(), kind = UNLOCK_KINDS.includes(b.kind) ? b.kind : null, until = text(b.until);
  if (!isEmail(email)) errors.email = "Please choose the person.";
  if (!kind) errors.kind = "Please choose what to reopen.";
  if (!isDay(until)) errors.until = "Please choose the date it stays open until.";
  else if (until < today) errors.until = "Please choose today or a later date.";
  return { email, kind, until, errors };
}

/* Asking for a late change: once the declaration or the proofs have closed, a person asks payroll to reopen theirs, with a reason
   (as Keka takes a late declaration for approval). Payroll approves it until a date, or declines it with a note. */
export function readLateRequest(b = {}) {
  const errors = {};
  const kind = UNLOCK_KINDS.includes(b.kind) ? b.kind : null, reason = text(b.reason).slice(0, 500);
  if (!kind) errors.kind = "Please choose what you need to change.";
  if (!reason) errors.reason = "Please say what you need to change and why.";
  return { kind, reason, errors };
}
export function readLateDecision(b = {}, today) {
  const errors = {};
  const decision = b.decision === "approved" || b.decision === "declined" ? b.decision : null;
  const until = text(b.until), note = text(b.note).slice(0, 300);
  if (!decision) errors.decision = "Please choose to approve or decline.";
  if (decision === "approved") { if (!isDay(until)) errors.until = "Please choose the date it stays open until."; else if (until < today) errors.until = "Please choose today or a later date."; }
  if (decision === "declined" && !note) errors.note = "Please say why, so the person knows what to do next.";
  return { decision, until: decision === "approved" ? until : null, note, errors };
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
