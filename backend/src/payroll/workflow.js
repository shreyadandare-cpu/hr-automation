/*
 * The payroll review workflow. Pure: which status a run may move to, and who may move it.
 *
 *   draft ─calculate→ calculated ─generate→ generated ─submit→ pending_review ─approve→ approved ─bank file→ bank_ready ─mark paid→ paid
 *                                                              │
 *                                                              ├─reject→ rejected            HR edits a line or recalculates: back to draft
 *                                                              └─request changes→ changes_requested
 *
 * Any edit in draft … generated (or after a rejection) moves the run back to draft, so a report that no longer matches
 * the numbers can't be sent for review. From approved on, nothing in the run changes (a database trigger enforces it too).
 * 'processed' and 'paid' runs made before this workflow are history and are only read.
 */
export const STATUS = {
  draft: "Draft",
  calculated: "Calculated",
  generated: "Generated",
  pending_review: "Pending review",
  changes_requested: "Changes requested",
  rejected: "Rejected",
  approved: "Approved",
  bank_ready: "Ready for bank processing",
  paid: "Processed",
  processed: "Processed (before review)",
};

/** Statuses where HR can still change inputs and recalculate. */
export const EDITABLE = new Set(["draft", "calculated", "generated", "changes_requested", "rejected"]);
/** Statuses where the run's figures are final. */
export const FINAL = new Set(["approved", "bank_ready", "paid"]);

const T = {
  calculate: { from: ["draft", "calculated", "generated", "changes_requested", "rejected"], to: "calculated", who: "hr" },
  generate: { from: ["calculated", "generated"], to: "generated", who: "hr" },
  submit: { from: ["generated"], to: "pending_review", who: "hr" },
  approve: { from: ["pending_review"], to: "approved", who: "reviewer" },
  reject: { from: ["pending_review"], to: "rejected", who: "reviewer", note: true },
  request_changes: { from: ["pending_review"], to: "changes_requested", who: "reviewer", note: true },
  bank_file: { from: ["approved", "bank_ready"], to: "bank_ready", who: "hr" },
  mark_paid: { from: ["bank_ready"], to: "paid", who: "hr" },
};
export const ACTIONS = Object.keys(T);

/**
 * Can `actor` do `action` on `run`? actor = { email, hr, reviewer }. Returns { ok: true, to } or { ok: false, error }.
 * The person who sent the payroll for review can't approve it themselves (maker-checker).
 */
export function check(run, action, actor, note) {
  const t = T[action];
  if (!t) return { ok: false, error: "Unknown action." };
  if (!run.workflow) return { ok: false, error: "This payroll was processed before the review workflow and can only be viewed." };
  if (t.who === "hr" && !actor.hr) return { ok: false, error: "Only HR can do this." };
  if (t.who === "reviewer" && !actor.reviewer) return { ok: false, error: "Only the payroll reviewer can do this." };
  if (!t.from.includes(run.status)) return { ok: false, error: `Not possible while the payroll is ${STATUS[run.status] ? STATUS[run.status].toLowerCase() : run.status}.` };
  if (t.who === "reviewer" && run.submitted_by && run.submitted_by.toLowerCase() === String(actor.email).toLowerCase())
    return { ok: false, error: "You sent this payroll for review, so someone else has to review it." };
  if (t.note && String(note || "").trim().length < 5) return { ok: false, error: "Give a reason (at least 5 characters)." };
  return { ok: true, to: t.to };
}

/** What the signed-in person can do next on this run, for the buttons on the page. */
export function nextActions(run, actor) {
  return ACTIONS.filter((a) => check(run, a, actor, "xxxxx").ok);
}
