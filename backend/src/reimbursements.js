import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { pool } from "./db.js";
import { requireHr } from "./auth.js";
import { UPLOAD_DIR } from "./documents.js";
import { MAX_BYTES, checkFile, readInvoice } from "./extract.js";
import { notify } from "./notify.js";
import { readSheet, buildXlsx } from "./sheet.js";

/*
 * Employee reimbursements.
 *
 *   draft -> submitted -> under_review -> approved -> payroll_pending -> in_payroll -> paid
 *                              |  \-> rejected
 *                              \-> changes_requested -> resubmitted -> under_review ...
 *
 * Employees file their own claims (HR can file one for someone). Only HR reviews and decides. Every status change is
 * checked here against the transitions below, written as an event (stepper + timeline) and copied to the audit log.
 * Amounts and statuses sent by the browser are never trusted: the server re-reads the claim and decides.
 *
 * A claim holds one or more expenses (reimbursement_items). Each has its own receipt (reimbursement_documents), or is
 * marked "no receipt" — allowed only for small expenses (auto, bus, parking) up to NO_RECEIPT_MAX each, with the
 * employee's declaration on submit. The claim's own category/amount/date/description are kept in step with its
 * expenses (syncHeader), so lists, monthly totals and payroll keep working on the claim.
 */
const TRANSITIONS = {
  submit: ["draft"],
  open: ["submitted", "resubmitted"],
  decide: ["submitted", "under_review", "resubmitted"],
  resubmit: ["changes_requested"],
  edit: ["draft", "changes_requested"],
};
export const REJECT_REASONS = ["Invalid invoice", "Duplicate claim", "Amount mismatch", "Expense not eligible", "Missing information", "Other"];
const PAYMENT_METHODS = ["UPI", "Cash", "Debit card", "Credit card", "Net banking", "Other"];
const NO_RECEIPT_MAX = Number(process.env.REIMB_NO_RECEIPT_MAX || 2000);
// Travel classes from lowest to highest. A category's allowed_class is the highest it reimburses in full.
export const TRAVEL_CLASSES = ["Economy", "Premium economy", "Business", "First"];
const classRank = (c) => TRAVEL_CLASSES.indexOf(c);
const round2 = (n) => Math.round(Number(n) * 100) / 100;
// A first guess at the category from the words on the invoice; the employee checks it on the review screen.
const CATEGORY_WORDS = [
  ["accommodation", /\b(hotel|resort|lodge|inn|guest\s*house|stay|room\s*(charges|tariff|rent)|oyo|airbnb|check[-\s]?in)\b/i],
  ["travel", /\b(airlines?|flight|boarding|pnr|indigo|vistara|air\s*india|akasa|spicejet|uber|ola|rapido|cab|taxi|train|irctc|railway|bus|redbus|metro|toll|fuel|petrol|diesel)\b/i],
  ["food", /\b(restaurant|caf[eé]|food|dining|swiggy|zomato|meal|kitchen|bistro|bakery|biryani|thali|pizza|coffee)\b/i],
  ["internet", /\b(broadband|internet|fibernet|fiber|wi-?fi)\b/i],
  ["mobile", /\b(mobile|recharge|postpaid|prepaid)\b/i],
  ["training", /\b(course|training|udemy|coursera|certification|workshop|conference)\b/i],
  ["office_supplies", /\b(stationery|printer|toner|office\s*supplies|keyboard|mouse)\b/i],
];
const guessCategory = (text) => (CATEGORY_WORDS.find(([, re]) => re.test(text || "")) || [null])[0];
const guessClass = (text) => (/\bfirst\s+class\b/i.test(text) ? "First" : /\bbusiness\s+(class|cabin)\b/i.test(text) ? "Business"
  : /\bpremium\s+economy\b/i.test(text) ? "Premium economy" : /\beconomy\b/i.test(text) ? "Economy" : null);
// "ABC HOTEL" -> "ABC Hotel": all-caps names read off invoices are tidied; short words (likely initials) stay as they are.
const niceName = (s) => (s && s === s.toUpperCase() && /[A-Z]{4}/.test(s) ? s.split(/(\s+)/).map((w) => (w.length > 3 ? w[0] + w.slice(1).toLowerCase() : w)).join("") : s);
const guessCurrency = (text) => (/\$|\busd\b/i.test(text || "") && !/₹|\binr\b|\brs\.?\s*\d/i.test(text || "") ? "USD" : "INR");
const MAX_ITEMS = 50;
const REMIND_DAYS = Number(process.env.REIMB_REMINDER_DAYS || 3);

const isHr = (req) => req.user && req.user.role === "hr";
const me = (req) => req.user.email.toLowerCase();
const num = (v) => (v === null || v === undefined ? null : Number(v));
const inr = (n) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const istMonth = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 7);
const nextMonth = (p) => { const [y, m] = p.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query(out && out.status >= 400 ? "ROLLBACK" : "COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
const send = (res, out) => res.status(out.status || 200).json(out.body);

/** One step in a claim's history: the timeline/stepper event plus a copy in the audit log. */
export async function event(db, claim, { actor, kind, status = null, note = null }) {
  await db.query("INSERT INTO reimbursement_events (reimbursement_id, actor, kind, status, note) VALUES ($1,$2,$3,$4,$5)",
    [claim.id, actor, kind, status, note]);
  await db.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)",
    [`${claim.claim_no}: ${kind}${note ? ` (${note})` : ""}${actor && actor !== claim.work_email ? ` by ${actor}` : ""}`, claim.work_email]);
}

/* ---------- checks that run on every change: amount vs invoice, policy limit, duplicates ---------- */

const itemsOf = async (db, id) => (await db.query("SELECT * FROM reimbursement_items WHERE reimbursement_id=$1 ORDER BY position, id", [id])).rows;
const docsOf = async (db, id) => (await db.query("SELECT * FROM reimbursement_documents WHERE reimbursement_id=$1 ORDER BY id", [id])).rows;

async function evaluate(db, c) {
  const items = await itemsOf(db, c.id), docs = await docsOf(db, c.id);
  const { rows: cats } = await db.query("SELECT key, name, max_amount, allowed_class FROM reimbursement_categories");
  const cat = new Map(cats.map((x) => [x.key, x]));
  const v = { items: {} };
  let known = 0, unknown = 0, mismatches = 0, invoiceTotal = 0, claimedKnown = 0;
  for (const it of items) {
    const d = docs.find((x) => x.item_id === it.id), fields = d && d.validation.read && d.validation.read.fields;
    const claimed = Number(it.amount);
    let match;
    if (!d) match = { status: it.no_receipt ? "no_receipt" : "missing", claimed };
    else if (fields && fields.total != null) {
      const diff = Math.round((claimed - fields.total) * 100) / 100;
      match = { status: Math.abs(diff) < 0.01 ? "match" : "mismatch", claimed, invoiceTotal: fields.total, diff };
      known++; invoiceTotal += fields.total; claimedKnown += claimed; if (match.status === "mismatch") mismatches++;
    } else { match = { status: "unknown", claimed, invoiceTotal: null }; unknown++; }
    v.items[it.id] = { file: d ? d.validation.file : null, read: d ? d.validation.read : null, match };
  }
  // Overall: only expenses whose receipt total was read are compared (claimed = those expenses, added up).
  v.match = { status: mismatches ? "mismatch" : known && !unknown ? "match" : "unknown", claimed: Math.round(claimedKnown * 100) / 100,
    invoiceTotal: known ? Math.round(invoiceTotal * 100) / 100 : null, mismatches };

  // Category limits apply to what the claim asks for in that category, added up.
  const perCat = new Map();
  for (const it of items) perCat.set(it.category, (perCat.get(it.category) || 0) + Number(it.amount));
  v.policy = { categories: [...perCat].map(([k, total]) => {
    const limit = cat.get(k) && cat.get(k).max_amount != null ? Number(cat.get(k).max_amount) : null;
    return { category: k, name: cat.get(k) ? cat.get(k).name : k, total, limit, over: limit != null && total > limit };
  }) };
  const over = v.policy.categories.find((x) => x.over);
  v.policy.over = !!over;
  v.policy.limit = over ? over.limit : null;
  const nr = items.filter((it) => it.no_receipt && !docs.some((d) => d.item_id === it.id));
  v.noReceipt = { count: nr.length, total: nr.reduce((n, it) => n + Number(it.amount), 0), max: NO_RECEIPT_MAX };

  // Possible duplicates: the same invoice number read from a receipt (anyone's), or the same employee claiming the same
  // amount in the same category on the same date. Flagged for HR; never rejected automatically.
  const invNos = new Set(docs.map((d) => d.validation.read && d.validation.read.fields && d.validation.read.fields.invoiceNo)
    .filter(Boolean).map((x) => String(x).trim().toLowerCase()));
  const { rows: others } = await db.query(
    `SELECT r.id, r.claim_no, r.work_email, r.amount AS claim_amount, r.status, e.name,
       i.category, i.amount, i.expense_date, d.validation AS doc_validation
     FROM reimbursements r JOIN reimbursement_items i ON i.reimbursement_id=r.id
     LEFT JOIN reimbursement_documents d ON d.item_id=i.id
     LEFT JOIN employees e ON lower(e.work_email)=lower(r.work_email)
     WHERE r.id <> $1 AND r.status NOT IN ('draft','rejected')`, [c.id]);
  const dups = new Map();
  for (const o of others) {
    const of = o.doc_validation && o.doc_validation.read && o.doc_validation.read.fields;
    const oInv = of && of.invoiceNo ? String(of.invoiceNo).trim().toLowerCase() : "";
    const same = o.work_email.toLowerCase() === c.work_email.toLowerCase();
    let reason = null;
    if (oInv && invNos.has(oInv)) reason = same ? "Same invoice number" : `Same invoice number, claimed by ${o.name || o.work_email}`;
    else if (same && items.some((it) => it.category === o.category && Math.abs(Number(it.amount) - Number(o.amount)) < 0.01
      && it.expense_date === o.expense_date)) reason = "Same expense (category, amount and date)";
    if (reason && !dups.has(o.id)) dups.set(o.id, { id: o.id, claimNo: o.claim_no, amount: num(o.claim_amount), expenseDate: o.expense_date, status: o.status, reason });
  }
  const duplicates = [...dups.values()];
  const eligibility = await eligibilityOf(db, c, items, cat);
  await db.query("UPDATE reimbursements SET validation=$2, duplicates=$3, eligibility=$4, eligible_amount=$5, non_eligible_amount=$6, updated_at=now() WHERE id=$1",
    [c.id, JSON.stringify(v), JSON.stringify(duplicates), JSON.stringify(eligibility), eligibility.eligible, eligibility.nonEligible]);
  return { validation: v, duplicates, eligibility };
}

/**
 * What the company covers (Automations 3, 4 and 7). Never changes what was requested.
 *   per expense: the amount, or — when a travel class above the category's allowed class was booked — the lower of the
 *                amount and the fare for the allowed class (policy_fare, entered with the claim)
 *   claim:       those added up, then capped at the approved budget when the claim is the final bill for a budget request
 */
async function eligibilityOf(db, c, items, cat) {
  const out = { items: {}, reasons: [], needsFare: [] };
  let requested = 0, eligible = 0;
  for (const it of items) {
    const amt = it.amount == null ? 0 : Number(it.amount);
    requested += amt;
    let el = amt;
    const allowed = cat.get(it.category) && cat.get(it.category).allowed_class;
    const x = { requested: amt, eligible: amt, reasons: [] };
    if (allowed && it.travel_class && classRank(it.travel_class) > classRank(allowed)) {
      x.policy = { allowedClass: allowed, actualClass: it.travel_class, allowedFare: it.policy_fare == null ? null : Number(it.policy_fare) };
      if (it.policy_fare == null) { el = 0; out.needsFare.push(it.position); x.reasons.push(`Travel policy allows ${allowed} only. Enter the ${allowed} fare to work out the eligible amount.`); }
      else {
        el = Math.min(amt, Number(it.policy_fare));
        x.reasons.push(`Travel policy allows ${allowed} class only. ${it.travel_class} booked for ${inr(amt)}; the ${allowed} fare was ${inr(it.policy_fare)}.`);
      }
    }
    x.eligible = round2(el); x.nonEligible = round2(amt - el);
    out.items[it.id] = x;
    eligible += el;
    for (const r of x.reasons) out.reasons.push(`Expense ${it.position}: ${r}`);
  }
  requested = round2(requested); eligible = round2(eligible);
  if (c.budget_request_id) {
    const { rows: [b] } = await db.query("SELECT request_no, approved_budget, status FROM budget_requests WHERE id=$1", [c.budget_request_id]);
    if (b && b.approved_budget != null) {
      const approved = Number(b.approved_budget), covered = Math.min(eligible, approved);
      out.budget = { requestNo: b.request_no, approvedBudget: approved, actual: requested, covered: round2(covered), excess: round2(Math.max(0, requested - approved)) };
      if (eligible > approved) out.reasons.push(`The bill (${inr(requested)}) is above the approved budget of ${inr(approved)}. The company covers ${inr(approved)}; ${inr(requested - approved)} is not reimbursed.`);
      eligible = round2(covered);
    }
  }
  out.requested = requested; out.eligible = eligible; out.nonEligible = round2(requested - eligible);
  return out;
}

/* ---------- reading claims ---------- */

const SELECT = `SELECT r.*, e.name AS emp_name, e.emp_no, e.dept, e.title, p.period AS run_period, p.status AS run_status,
    (SELECT json_agg(json_build_object('category', i.category, 'amount', i.amount, 'noReceipt', i.no_receipt) ORDER BY i.position, i.id)
       FROM reimbursement_items i WHERE i.reimbursement_id=r.id) AS items_brief,
    (SELECT count(*) FROM reimbursement_documents d WHERE d.reimbursement_id=r.id)::int AS doc_count,
    b.request_no AS budget_no, b.purpose AS budget_purpose, b.approved_budget AS budget_approved, b.requested_budget AS budget_requested
  FROM reimbursements r LEFT JOIN employees e ON lower(e.work_email)=lower(r.work_email)
  LEFT JOIN payroll_runs p ON p.id = r.payroll_run_id
  LEFT JOIN budget_requests b ON b.id = r.budget_request_id`;

const toApi = (r) => ({
  id: r.id, claimNo: r.claim_no, email: r.work_email, employee: { name: r.emp_name || r.work_email, empNo: r.emp_no, dept: r.dept, title: r.title },
  category: r.category, amount: num(r.amount), currency: r.currency, expenseDate: r.expense_date, description: r.description,
  paymentMethod: r.payment_method,
  expenses: (r.items_brief || []).map((i) => ({ category: i.category, amount: num(i.amount), noReceipt: i.noReceipt })), documentCount: r.doc_count,
  validation: r.validation, duplicates: r.duplicates, status: r.status,
  rejectionReason: r.rejection_reason, rejectionNote: r.rejection_note, changeComment: r.change_comment,
  submittedAt: r.submitted_at, approvedBy: r.approved_by, approvedAt: r.approved_at,
  payrollPeriod: r.payroll_period, payrollRunId: r.payroll_run_id, payrollRunStatus: r.run_status,
  paidAt: r.paid_at, paidAmount: num(r.paid_amount), createdAt: r.created_at, updatedAt: r.updated_at,
  // Amounts are kept side by side; the requested amount is never overwritten.
  requestedAmount: num(r.requested_amount ?? r.amount), eligibleAmount: num(r.eligible_amount), nonEligibleAmount: num(r.non_eligible_amount),
  approvedAmount: num(r.approved_amount), unapprovedAmount: num(r.unapproved_amount), approvalReason: r.approval_reason,
  partial: r.approved_amount != null && Number(r.approved_amount) < Number(r.requested_amount ?? r.amount),
  eligibility: r.eligibility,
  budget: r.budget_request_id ? { id: r.budget_request_id, requestNo: r.budget_no, purpose: r.budget_purpose,
    approvedBudget: num(r.budget_approved), requestedBudget: num(r.budget_requested) } : null,
});

async function loadClaim(db, id, lock = false) {
  const { rows } = await db.query(`SELECT * FROM reimbursements WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [Number(id) || 0]);
  return rows[0] || null;
}
const docApi = (d) => (d ? { id: d.id, name: d.name, mime: d.mime, size: d.size, uploadedAt: d.uploaded_at } : null);
const itemApi = (it, docs) => ({ id: it.id, position: it.position, category: it.category, expenseDate: it.expense_date, amount: num(it.amount),
  description: it.description, paymentMethod: it.payment_method, noReceipt: it.no_receipt, source: it.source,
  vendor: it.vendor, invoiceNo: it.invoice_no, currency: it.currency, extracted: it.extracted, travelClass: it.travel_class, policyFare: num(it.policy_fare),
  document: docApi(docs.find((d) => d.item_id === it.id)) });
const canSee = (req, c) => c && (isHr(req) || c.work_email.toLowerCase() === me(req));

/* ---------- input checks (the browser's values are re-validated here) ---------- */

const todayIst = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
function itemErrors(it, catKeys) {
  const e = {};
  if (!catKeys.includes(it.category)) e.category = "Pick a category.";
  const amt = Number(it.amount);
  if (!(amt > 0) || amt > 1e7 || Math.round(amt * 100) !== amt * 100) e.amount = "Enter the amount in rupees, up to 2 decimals.";
  else if (it.noReceipt && amt > NO_RECEIPT_MAX) e.amount = `Expenses without a receipt can be up to ${inr(NO_RECEIPT_MAX)}. Add the receipt for this one.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(it.expenseDate || "") || isNaN(new Date(it.expenseDate))) e.expenseDate = "Enter the expense date.";
  else if (it.expenseDate > todayIst()) e.expenseDate = "The expense date can't be in the future.";
  if (!String(it.description || "").trim()) e.description = "Describe what the expense was for.";
  else if (String(it.description).length > 500) e.description = "Keep the description under 500 characters.";
  if (it.paymentMethod && !PAYMENT_METHODS.includes(it.paymentMethod)) e.paymentMethod = "Pick a payment method.";
  if (String(it.vendor || "").length > 120) e.vendor = "Keep the vendor name under 120 characters.";
  if (String(it.invoiceNo || "").length > 60) e.invoiceNo = "Keep the invoice number under 60 characters.";
  if (it.travelClass && !TRAVEL_CLASSES.includes(it.travelClass)) e.travelClass = "Pick the class you travelled in.";
  if (it.policyFare !== null && it.policyFare !== undefined && it.policyFare !== "") {
    const f = Number(it.policyFare);
    if (!(f > 0) || f > 1e7) e.policyFare = "Enter the fare in rupees.";
  }
  return e;
}
/** The expenses from the request (a claim sent in the old single-expense shape counts as one), checked. */
async function readItems(db, b) {
  const list = Array.isArray(b.items) ? b.items : [b];
  if (!list.length) return { errors: { form: "Add at least one expense." } };
  if (list.length > MAX_ITEMS) return { errors: { form: `A claim can have up to ${MAX_ITEMS} expenses. Split the rest into another claim.` } };
  const catKeys = (await db.query("SELECT key FROM reimbursement_categories WHERE active")).rows.map((c) => c.key);
  const errors = {}, items = [];
  list.forEach((raw, i) => {
    const it = { id: Number(raw && raw.id) || null, category: raw && raw.category, amount: raw && raw.amount, expenseDate: raw && raw.expenseDate,
      description: raw && raw.description, paymentMethod: (raw && raw.paymentMethod) || null, noReceipt: !!(raw && raw.noReceipt),
      source: raw && raw.source === "excel" ? "excel" : "form",
      vendor: clip(raw && raw.vendor, 120), invoiceNo: clip(raw && raw.invoiceNo, 60), travelClass: (raw && raw.travelClass) || null,
      policyFare: raw && raw.policyFare !== "" && raw.policyFare != null ? raw.policyFare : null };
    for (const [k, msg] of Object.entries(itemErrors(it, catKeys))) errors[`${i}-${k}`] = msg;
    items.push(it);
  });
  return Object.keys(errors).length ? { errors } : { items };
}

/** Writes the expenses: existing ones (by id) are updated, new ones added, missing ones removed with their receipts. */
async function saveItems(db, claimId, items) {
  const existing = await itemsOf(db, claimId), docs = await docsOf(db, claimId);
  const keep = new Set(), files = [], edited = [];
  for (const [i, it] of items.entries()) {
    const old = it.id && existing.find((x) => x.id === it.id);
    const hasDoc = old && docs.some((d) => d.item_id === old.id);
    const fare = it.policyFare == null ? null : Number(it.policyFare);
    const args = [it.category, it.expenseDate, Number(it.amount), String(it.description).trim().slice(0, 500), it.paymentMethod, it.noReceipt && !hasDoc, i + 1,
      it.vendor, it.invoiceNo, it.travelClass, fare];
    if (old) {
      await db.query(`UPDATE reimbursement_items SET category=$1, expense_date=$2, amount=$3, description=$4, payment_method=$5, no_receipt=$6, position=$7,
        vendor=$8, invoice_no=$9, travel_class=$10, policy_fare=$11 WHERE id=$12`, [...args, old.id]);
      keep.add(old.id);
      // Which values the employee changed from what was read off the invoice (for the audit timeline).
      const x = old.extracted || {};
      const diff = [["amount", "amount", (a, b) => Number(a) !== Number(b)], ["vendor", "vendor"], ["invoiceNo", "invoice number"], ["expenseDate", "date"], ["category", "category"]]
        .filter(([k, , ne = (a, b) => String(a || "") !== String(b || "")]) => x[k] != null && ne(x[k], it[k]))
        .map(([k, label]) => k === "amount" ? `amount ${inr(x.amount)} → ${inr(it.amount)}` : label);
      const prevDiff = old.extracted ? JSON.stringify(old.extracted._edited || []) : "[]";
      if (diff.length && JSON.stringify(diff) !== prevDiff) {
        edited.push(`expense ${i + 1}: ${diff.join(", ")}`);
        await db.query("UPDATE reimbursement_items SET extracted = extracted || jsonb_build_object('_edited', $2::jsonb) WHERE id=$1", [old.id, JSON.stringify(diff)]);
      }
    } else {
      await db.query(`INSERT INTO reimbursement_items (category, expense_date, amount, description, payment_method, no_receipt, position,
        vendor, invoice_no, travel_class, policy_fare, reimbursement_id, source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [...args, claimId, it.source]);
    }
  }
  for (const old of existing.filter((x) => !keep.has(x.id))) {
    for (const d of docs.filter((x) => x.item_id === old.id)) { files.push(d.stored); await db.query("DELETE FROM reimbursement_documents WHERE id=$1", [d.id]); }
    await db.query("DELETE FROM reimbursement_items WHERE id=$1", [old.id]);
  }
  files.edited = edited;
  return files;
}

/** The claim's own fields follow its expenses: total amount, earliest date, the largest expense's category. */
async function syncHeader(db, claimId) {
  const items = await itemsOf(db, claimId);
  if (!items.length) return (await db.query("SELECT * FROM reimbursements WHERE id=$1", [claimId])).rows[0];
  const total = round2(items.reduce((n, it) => n + Number(it.amount || 0), 0));
  const main = items.slice().sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];
  const first = items.map((it) => it.expense_date).filter(Boolean).sort()[0] || null;
  const descs = items.map((it) => it.description || it.vendor).filter(Boolean);
  const desc = items.length === 1 ? descs[0] || null : `${items.length} expenses${descs.length ? ": " + descs.join("; ") : ""}`;
  const methods = [...new Set(items.map((it) => it.payment_method).filter(Boolean))];
  const { rows } = await db.query(
    `UPDATE reimbursements SET amount=$2, category=$3, expense_date=$4, description=$5, payment_method=$6, updated_at=now() WHERE id=$1 RETURNING *`,
    [claimId, total > 0 ? total : null, main.category, first, desc ? desc.slice(0, 500) : null, methods.length === 1 ? methods[0] : methods.length ? "Multiple" : null]);
  return rows[0];
}

/** What still stops a claim from going to HR: an expense with neither a receipt nor the no-receipt mark. */
async function receiptGaps(db, claimId) {
  const items = await itemsOf(db, claimId), docs = await docsOf(db, claimId);
  return items.filter((it) => !it.no_receipt && !docs.some((d) => d.item_id === it.id));
}
const rmFiles = async (files) => { for (const f of files) if (f) await fs.rm(path.join(UPLOAD_DIR, path.basename(f)), { force: true }); };
const clip = (s, n) => (String(s || "").trim().slice(0, n) || null);

/* ---------- automations ---------- */

/** Automation 1 + 3: a new claim is announced to HR and checked against earlier claims. */
async function onSubmitted(db, c, actor, resubmitted) {
  const { duplicates, validation } = await evaluate(db, c);
  const status = resubmitted ? "resubmitted" : "submitted";
  await event(db, c, { actor, kind: resubmitted ? "Resubmitted with changes" : "Claim submitted", status });
  if (duplicates.length) await event(db, c, { actor: "system", kind: "Possible duplicate flagged", note: duplicates.map((d) => d.claimNo).join(", ") });
  if (validation.match.status === "mismatch") await event(db, c, { actor: "system", kind: "Amount mismatch flagged",
    note: `${validation.match.mismatches} expense${validation.match.mismatches === 1 ? "" : "s"}: claimed ${inr(validation.match.claimed)}, receipts show ${inr(validation.match.invoiceTotal)}` });
  if (validation.policy.over) await event(db, c, { actor: "system", kind: "Above category limit", note: `limit ${inr(validation.policy.limit)}` });
  const el = (await evaluate(db, c)).eligibility;
  await event(db, c, { actor: "system", kind: "Eligible amount calculated",
    note: `requested ${inr(el.requested)}, eligible ${inr(el.eligible)}${el.nonEligible ? `, not eligible ${inr(el.nonEligible)}` : ""}` });
  for (const x of Object.values(el.items)) if (x.policy && x.policy.allowedFare != null)
    await event(db, c, { actor: "system", kind: "Travel class above policy", note: `${x.policy.actualClass} booked, ${x.policy.allowedClass} allowed: ${inr(x.nonEligible)} not eligible` });
  if (el.budget && el.budget.excess > 0)
    await event(db, c, { actor: "system", kind: "Bill exceeds approved budget", note: `budget ${inr(el.budget.approvedBudget)}, bill ${inr(el.budget.actual)}, excess ${inr(el.budget.excess)} not reimbursed` });
  return { duplicates, validation, eligibility: el };
}

async function employeeName(db, email) {
  const { rows } = await db.query("SELECT name FROM employees WHERE lower(work_email)=lower($1)", [email]);
  return rows[0] ? rows[0].name : email;
}

/** Automation 7: claims waiting for review longer than REIMB_REMINDER_DAYS remind HR, at most once a day per claim. */
export async function runReimbursementReminders() {
  const { rows } = await pool.query(
    `SELECT * FROM reimbursements WHERE status IN ('submitted','resubmitted','under_review')
     AND coalesce(submitted_at, created_at) < now() - make_interval(days => $1::int)
     AND (last_reminded_at IS NULL OR last_reminded_at < now() - interval '1 day')`, [REMIND_DAYS]);
  for (const c of rows) {
    const days = Math.floor((Date.now() - new Date(c.submitted_at || c.created_at)) / 864e5);
    await pool.query("UPDATE reimbursements SET last_reminded_at=now() WHERE id=$1", [c.id]);
    await event(pool, c, { actor: "system", kind: "Review reminder sent to HR", note: `waiting ${days} days` });
    await notify("hr", {
      title: `Reimbursement ${c.claim_no} has been awaiting review for ${days} days.`,
      body: `${await employeeName(pool, c.work_email)} · ${inr(c.amount)}`, link: `claim:${c.id}`,
      email: { subject: `Reminder: ${c.claim_no} awaiting review`, body: `Reimbursement ${c.claim_no} has been awaiting review for ${days} days.` },
    });
  }
  return rows.length;
}

/* ---------- routes ---------- */

export const reimbursementsRouter = express.Router();

reimbursementsRouter.get("/categories", wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM reimbursement_categories ${isHr(req) ? "" : "WHERE active"} ORDER BY sort, name`);
  res.json({ categories: rows.map((r) => ({ key: r.key, name: r.name, maxAmount: num(r.max_amount), active: r.active, allowedClass: r.allowed_class })),
    rejectReasons: REJECT_REASONS, paymentMethods: PAYMENT_METHODS, noReceiptMax: NO_RECEIPT_MAX, maxItems: MAX_ITEMS, travelClasses: TRAVEL_CLASSES });
}));

// HR sets an optional limit (or none) per category, or turns a category off.
reimbursementsRouter.put("/categories/:key", requireHr, wrap(async (req, res) => {
  const { maxAmount, active, allowedClass } = req.body || {};
  const limit = maxAmount === "" || maxAmount === null || maxAmount === undefined ? null : Number(maxAmount);
  if (limit !== null && !(limit > 0 && limit < 1e7)) return res.status(400).json({ error: "Enter a limit in rupees, or leave it empty for no limit." });
  const cls = allowedClass ? String(allowedClass) : null;
  if (cls && !TRAVEL_CLASSES.includes(cls)) return res.status(400).json({ error: "Pick an allowed travel class, or none." });
  const { rows } = await pool.query("UPDATE reimbursement_categories SET max_amount=$2, active=$3, allowed_class=$4 WHERE key=$1 RETURNING *",
    [req.params.key, limit, active !== false, cls]);
  if (!rows[0]) return res.status(404).json({ error: "Category not found." });
  await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1, NULL)",
    [`Reimbursement category ${rows[0].name}: ${limit === null ? "no limit" : `limit ${inr(limit)}`}${cls ? `, travel up to ${cls} class` : ""}${rows[0].active ? "" : ", turned off"} by ${req.user.email}`]);
  res.json({ ok: true });
}));

// The list. HR sees every claim (with summary cards); everyone else sees their own.
reimbursementsRouter.get("/", wrap(async (req, res) => {
  const q = req.query, where = [], args = [];
  const add = (sql, v) => { args.push(v); where.push(sql.replace("?", `$${args.length}`)); };
  if (!isHr(req)) add("lower(r.work_email)=?", me(req));
  if (isHr(req)) add("(r.status <> 'draft' OR lower(r.created_by)=?)", me(req));   // HR doesn't see other people's unsent drafts
  if (isHr(req) && q.email) add("lower(r.work_email)=?", String(q.email).toLowerCase());
  if (q.status) add("r.status=?", String(q.status));
  if (q.category) add("EXISTS (SELECT 1 FROM reimbursement_items i WHERE i.reimbursement_id=r.id AND i.category=?)", String(q.category));
  if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) add("r.expense_date >= ?", q.from);
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) add("r.expense_date <= ?", q.to);
  if (q.min && Number(q.min) > 0) add("r.amount >= ?", Number(q.min));
  if (q.max && Number(q.max) > 0) add("r.amount <= ?", Number(q.max));
  if (q.q) { args.push(`%${String(q.q).slice(0, 60)}%`); const i = args.length;
    where.push(`(e.name ILIKE $${i} OR r.claim_no ILIKE $${i} OR r.description ILIKE $${i})`); }
  const { rows } = await pool.query(`${SELECT} ${where.length ? "WHERE " + where.map((w) => `(${w})`).join(" AND ") : ""}
    ORDER BY coalesce(r.submitted_at, r.created_at) DESC, r.id DESC LIMIT 500`, args);
  let summary = null;
  if (isHr(req)) {
    const month = istMonth();
    const { rows: s } = await pool.query(
      `SELECT
         count(*) FILTER (WHERE status IN ('submitted','under_review','resubmitted'))::int AS pending_review,
         count(*) FILTER (WHERE status='changes_requested')::int AS needs_changes,
         count(*) FILTER (WHERE status IN ('approved','payroll_pending','in_payroll','paid'))::int AS approved,
         coalesce(sum(coalesce(approved_amount, amount)) FILTER (WHERE status IN ('approved','payroll_pending','in_payroll')),0) AS pending_payroll_amount,
         count(*) FILTER (WHERE status IN ('approved','payroll_pending','in_payroll'))::int AS pending_payroll,
         coalesce(sum(paid_amount) FILTER (WHERE status='paid' AND to_char(paid_at + interval '330 minutes','YYYY-MM')=$1),0) AS paid_this_month,
         coalesce(sum(paid_amount) FILTER (WHERE status='paid'),0) AS total_reimbursed
       FROM reimbursements WHERE status <> 'draft'`, [month]);
    const x = s[0];
    summary = { pendingReview: x.pending_review, needsChanges: x.needs_changes, approved: x.approved,
      pendingPayroll: x.pending_payroll, pendingPayrollAmount: num(x.pending_payroll_amount),
      paidThisMonth: num(x.paid_this_month), totalReimbursed: num(x.total_reimbursed) };
  }
  res.json({ claims: rows.map(toApi), summary });
}));

// Monthly totals per employee, for HR: every approved claim for that payroll month added up (the amount to add to
// that month's salary), plus claims for expenses in that month still waiting for a decision.
reimbursementsRouter.get("/monthly", requireHr, wrap(async (req, res) => {
  const period = String(req.query.period || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return res.status(400).json({ error: "Pick a month." });
  const args = [period];
  let only = "";
  if (req.query.email) { args.push(String(req.query.email).toLowerCase()); only = `AND lower(r.work_email)=$${args.length}`; }
  const { rows } = await pool.query(
    `SELECT r.work_email, e.name, e.emp_no,
       count(*) FILTER (WHERE r.status IN ('payroll_pending','in_payroll','paid') AND r.payroll_period=$1)::int AS approved_n,
       coalesce(sum(coalesce(r.approved_amount, r.amount)) FILTER (WHERE r.status IN ('payroll_pending','in_payroll','paid') AND r.payroll_period=$1),0) AS approved_total,
       coalesce(sum(coalesce(r.paid_amount, r.approved_amount, r.amount)) FILTER (WHERE r.status='paid' AND r.payroll_period=$1),0) AS paid_total,
       count(*) FILTER (WHERE r.status='in_payroll' AND r.payroll_period=$1)::int AS in_payroll_n,
       count(*) FILTER (WHERE r.status IN ('submitted','under_review','resubmitted','changes_requested') AND to_char(r.expense_date,'YYYY-MM')=$1)::int AS waiting_n,
       coalesce(sum(r.amount) FILTER (WHERE r.status IN ('submitted','under_review','resubmitted','changes_requested') AND to_char(r.expense_date,'YYYY-MM')=$1),0) AS waiting_total
     FROM reimbursements r LEFT JOIN employees e ON lower(e.work_email)=lower(r.work_email)
     WHERE r.status <> 'draft' AND (r.payroll_period=$1 OR to_char(r.expense_date,'YYYY-MM')=$1) ${only}
     GROUP BY r.work_email, e.name, e.emp_no ORDER BY approved_total DESC, e.name`, args);
  const people = rows.map((r) => ({ email: r.work_email, name: r.name || r.work_email, empNo: r.emp_no,
    approvedCount: r.approved_n, approvedTotal: num(r.approved_total), paidTotal: num(r.paid_total), inPayrollCount: r.in_payroll_n,
    waitingCount: r.waiting_n, waitingTotal: num(r.waiting_total) })).filter((p) => p.approvedCount || p.waitingCount);
  const { rows: run } = await pool.query("SELECT status FROM payroll_runs WHERE period=$1", [period]);
  res.json({ period, payrollStatus: run[0] ? run[0].status : null, people,
    totals: { approved: people.reduce((n, p) => n + p.approvedTotal, 0), waiting: people.reduce((n, p) => n + p.waitingTotal, 0) } });
}));

// The expense-sheet template: one row per small expense, with dropdowns for category and payment method.
reimbursementsRouter.get("/import/template", wrap(async (_req, res) => {
  const { rows: cats } = await pool.query("SELECT name FROM reimbursement_categories WHERE active ORDER BY sort, name");
  const day = todayIst();
  const file = buildXlsx([
    { name: "Expenses", header: true, widths: [14, 20, 12, 44, 16],
      rows: [["Date", "Category", "Amount", "Description", "Payment method"],
        [day, cats.find((c) => /travel/i.test(c.name))?.name || cats[0].name, 180, "Auto from office to client site", "UPI"],
        [day, cats.find((c) => /food/i.test(c.name))?.name || cats[0].name, 250, "Team lunch during client visit", "Cash"]],
      lists: [{ col: "B", ref: `Lists!$A$2:$A$${cats.length + 1}` }, { col: "E", ref: `Lists!$B$2:$B$${PAYMENT_METHODS.length + 1}` }] },
    { name: "Lists", header: true, widths: [24, 18],
      rows: [["Category", "Payment method"], ...Array.from({ length: Math.max(cats.length, PAYMENT_METHODS.length) }, (_, i) => [cats[i] ? cats[i].name : "", PAYMENT_METHODS[i] || ""])] },
    { name: "How to fill", widths: [100],
      rows: [["One row per expense. Date as YYYY-MM-DD or DD/MM/YYYY. Amount in rupees."],
        [`For small expenses without a bill (auto, bus, parking, tea) up to ${inr(NO_RECEIPT_MAX)} each. Larger expenses need a receipt.`],
        ["Category and payment method must be one of the values on the Lists sheet."],
        ["Delete the two example rows before uploading."]] },
  ]);
  res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="expense-sheet-template.xlsx"', "Cache-Control": "no-store" });
  res.send(file);
}));

// Read an uploaded expense sheet (.xlsx or .csv) into expense rows for the employee to check. Nothing is saved here;
// the rows are validated again when the claim is saved.
const HEADERS = { expenseDate: /date|day/i, category: /categ|type|head/i, amount: /amount|amt|rs|₹|inr|cost/i,
  description: /desc|purpose|detail|for|particular|remark|note/i, paymentMethod: /pay|mode|method|paid/i };
const parseDay = (v) => {
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);   // Indian order: day first
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -,]*(\d{4})$/);
  if (m) { const mo = "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(m[2].toLowerCase()) / 3 + 1; if (mo > 0) return `${m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return s;
};
reimbursementsRouter.post("/import", express.raw({ type: () => true, limit: 2 * 1024 * 1024 }), wrap(async (req, res) => {
  let rows;
  try { rows = readSheet(req.body); } catch (err) { return res.status(400).json({ error: err.message }); }
  const at = rows.findIndex((r) => r && r.some((c) => typeof c === "string" && HEADERS.amount.test(c)));
  if (at < 0) return res.status(400).json({ error: "No header row found. Use the template: Date, Category, Amount, Description, Payment method." });
  const head = rows[at].map((c) => String(c ?? ""));
  const col = {};
  for (const [k, re] of Object.entries(HEADERS)) { const i = head.findIndex((h, j) => re.test(h) && !Object.values(col).includes(j)); if (i >= 0) col[k] = i; }
  const missing = ["expenseDate", "category", "amount", "description"].filter((k) => col[k] === undefined);
  if (missing.length) return res.status(400).json({ error: `The sheet is missing these columns: ${missing.map((k) => ({ expenseDate: "Date", category: "Category", amount: "Amount", description: "Description" })[k]).join(", ")}.` });
  const { rows: cats } = await pool.query("SELECT key, name FROM reimbursement_categories WHERE active");
  const findCat = (v) => { const s = String(v ?? "").trim().toLowerCase(); return (cats.find((c) => c.name.toLowerCase() === s || c.key === s)
    || cats.find((c) => s && (c.name.toLowerCase().startsWith(s) || s.startsWith(c.name.toLowerCase().split(/\W/)[0])))); };
  const findPm = (v) => { const s = String(v ?? "").trim().toLowerCase(); return !s ? null : PAYMENT_METHODS.find((p) => p.toLowerCase() === s)
    || (/upi|gpay|phonepe|paytm/.test(s) ? "UPI" : /cash/.test(s) ? "Cash" : /debit/.test(s) ? "Debit card" : /credit/.test(s) ? "Credit card" : /net|bank|neft|imps/.test(s) ? "Net banking" : "Other"); };
  const catKeys = cats.map((c) => c.key), out = [];
  for (let r = at + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (!row.some((c) => c !== null && String(c).trim() !== "")) continue;
    const cat = findCat(row[col.category]);
    const rawAmt = row[col.amount], amount = typeof rawAmt === "number" ? rawAmt : Number(String(rawAmt ?? "").replace(/[₹,\s]|rs\.?|inr/gi, ""));
    const it = { expenseDate: parseDay(row[col.expenseDate]), category: cat ? cat.key : "", amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : "",
      description: String(row[col.description] ?? "").trim().slice(0, 500), paymentMethod: col.paymentMethod !== undefined ? findPm(row[col.paymentMethod]) : null,
      noReceipt: true, source: "excel" };
    if (Number(it.amount) > NO_RECEIPT_MAX) it.noReceipt = false;   // comes in as an expense that needs its receipt
    const errors = itemErrors(it, catKeys);
    if (!cat && row[col.category]) errors.category = `“${String(row[col.category]).slice(0, 40)}” isn't a category.`;
    out.push({ row: r + 1, ...it, errors });
    if (out.length >= MAX_ITEMS) break;
  }
  if (!out.length) return res.status(400).json({ error: "The sheet has no expense rows under the header." });
  res.json({ rows: out, noReceiptMax: NO_RECEIPT_MAX });
}));

/** Automation 3: a final bill above its approved budget is announced to the employee and HR. */
async function notifyBudgetExcess(c, el) {
  if (!el || !el.budget || !(el.budget.excess > 0)) return;
  const msg = `Approved budget ${inr(el.budget.approvedBudget)}, actual bill ${inr(el.budget.actual)}. The company covers ${inr(el.budget.covered)}; ${inr(el.budget.excess)} is not reimbursed.`;
  await notify(c.work_email, { title: `Your bill for ${el.budget.requestNo} is above the approved budget.`, body: msg, link: `claim:${c.id}`,
    email: { subject: `Bill above approved budget: ${el.budget.requestNo}`, body: msg } });
  await notify("hr", { title: `${c.claim_no}: bill above the approved budget (${el.budget.requestNo}).`, body: msg, link: `claim:${c.id}`,
    email: { subject: `Bill above approved budget: ${c.claim_no}`, body: msg } });
}

/** A new draft claim (for the employee, or for someone when HR files it), optionally the final bill for a budget. */
async function newDraft(db, req, { email, budgetId }) {
  const { rows: emp } = await db.query("SELECT work_email, status FROM employees WHERE lower(work_email)=$1", [email]);
  if (!emp[0]) return { err: { status: 400, body: { errors: { email: "Pick the employee." } } } };
  if (emp[0].status === "offboarded") return { err: { status: 400, body: { errors: { email: "This person has left." } } } };
  if (budgetId) {
    const { rows: [bq] } = await db.query("SELECT * FROM budget_requests WHERE id=$1 FOR UPDATE", [budgetId]);
    if (!bq || bq.work_email.toLowerCase() !== emp[0].work_email.toLowerCase()) return { err: { status: 404, body: { error: "Budget request not found." } } };
    if (!["approved", "partially_approved"].includes(bq.status)) return { err: { status: 409, body: { error: "The final bill can be filed once the budget is approved." } } };
    const { rows: [open] } = await db.query("SELECT id FROM reimbursements WHERE budget_request_id=$1 AND status <> 'rejected'", [budgetId]);
    if (open) return { existing: open.id };
  }
  const { rows: [c] } = await db.query(
    "INSERT INTO reimbursements (work_email, created_by, budget_request_id) VALUES ($1,$2,$3) RETURNING *", [emp[0].work_email, me(req), budgetId || null]);
  c.claim_no = `REIM-${c.created_at.getFullYear()}-${String(c.id).padStart(4, "0")}`;
  await db.query("UPDATE reimbursements SET claim_no=$2 WHERE id=$1", [c.id, c.claim_no]);
  return { claim: c };
}

/*
 * Invoice first (Automation 1). The employee uploads an invoice; it is checked and stored, a draft claim is created
 * (or the open draft is used), the invoice is read, and a new expense line is pre-filled from it. Nothing is submitted:
 * the employee reviews and edits every value next. ?claim=<id> adds to an existing draft; ?budget=<id> files the
 * final bill for an approved budget; HR may pass ?email= to file for someone.
 */
reimbursementsRouter.post("/from-document", express.raw({ type: () => true, limit: MAX_BYTES }), wrap(async (req, res) => {
  const file = await checkFile(req.body);
  if (!file.ok) return res.status(400).json({ error: file.checks.find((x) => !x.ok).label, checks: file.checks });
  const read = await readInvoice(req.body, file.type);
  const stored = crypto.randomUUID() + "." + file.type.ext;
  const name = String(req.query.name || "invoice").replace(/[^\w.\- ()]/g, "_").slice(0, 120);
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, stored), req.body);
  try {
    const out = await tx(async (db) => {
      let c;
      if (req.query.claim) {
        c = await loadClaim(db, req.query.claim, true);
        if (!canSee(req, c) || !owns(req, c)) return { status: 404, body: { error: "Claim not found." } };
        if (!TRANSITIONS.edit.includes(c.status)) return { status: 409, body: { error: "This claim can't be changed now." } };
      } else {
        const email = isHr(req) && req.query.email ? String(req.query.email).toLowerCase() : me(req);
        const d = await newDraft(db, req, { email, budgetId: Number(req.query.budget) || null });
        if (d.err) return d.err;
        c = d.existing ? await loadClaim(db, d.existing, true) : d.claim;
        if (d.existing && !TRANSITIONS.edit.includes(c.status)) return { status: 409, body: { error: `The final bill for this budget is already filed as ${c.claim_no}.`, claimId: c.id } };
        if (!d.existing) await event(db, c, { actor: me(req), kind: "Draft created from an invoice", status: "draft", note: c.budget_request_id ? "final bill for an approved budget" : null });
      }
      const f = { ...(read.fields || {}) };
      if (f.vendor) f.vendor = niceName(f.vendor);
      const { rows: cats } = await db.query("SELECT key FROM reimbursement_categories WHERE active");
      const guess = guessCategory(`${f.vendor || ""}\n${read.text || ""}`);
      const category = guess && cats.some((x) => x.key === guess) ? guess : null;
      const day = f.invoiceDate && f.invoiceDate <= todayIst() ? f.invoiceDate : null;
      const extracted = read.readable ? { vendor: f.vendor || null, invoiceNo: f.invoiceNo || null, expenseDate: day, amount: f.total ?? null,
        subtotal: f.subtotal ?? null, tax: f.tax ?? null, currency: guessCurrency(read.text), category, travelClass: category === "travel" ? guessClass(read.text) : null } : null;
      const { rows: [{ n }] } = await db.query("SELECT coalesce(max(position),0)+1 AS n FROM reimbursement_items WHERE reimbursement_id=$1", [c.id]);
      const { rows: [item] } = await db.query(
        `INSERT INTO reimbursement_items (reimbursement_id, position, category, expense_date, amount, description, vendor, invoice_no, currency, extracted, travel_class, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'document') RETURNING *`,
        [c.id, n, category, day, f.total > 0 ? f.total : null, f.vendor ? `${f.vendor}` : null, f.vendor || null, f.invoiceNo || null,
         (extracted && extracted.currency) || "INR", extracted ? JSON.stringify(extracted) : null, extracted ? extracted.travelClass : null]);
      const validation = { file: { ok: true, checks: file.checks }, read: { ...read, text: undefined } };
      const { rows: [doc] } = await db.query(
        `INSERT INTO reimbursement_documents (reimbursement_id, item_id, name, mime, size, stored, validation) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [c.id, item.id, name, file.type.mime, req.body.length, stored, JSON.stringify(validation)]);
      await event(db, c, { actor: me(req), kind: "Invoice uploaded", note: `${name} (expense ${n})` });
      const found = extracted ? Object.entries({ vendor: "vendor", invoiceNo: "invoice number", expenseDate: "date", amount: "total", tax: "tax", category: "category", travelClass: "travel class" })
        .filter(([k]) => extracted[k] != null && extracted[k] !== 0).map(([, l]) => l) : [];
      await event(db, c, { actor: "system", kind: found.length ? "Invoice details extracted" : "Invoice could not be read automatically",
        note: found.length ? `${found.join(", ")} read by ${read.method}${extracted.amount != null ? `; total ${inr(extracted.amount)}` : ""}` : read.note || null });
      const after = await syncHeader(db, c.id);
      await evaluate(db, after);
      return { status: 201, body: { claimId: c.id, claimNo: c.claim_no, item: itemApi(item, [doc]), read: { readable: read.readable, method: read.method, note: read.note || null, found } } };
    });
    if (out.status !== 201) await rmFiles([stored]);
    send(res, out);
  } catch (err) {
    await rmFiles([stored]);
    throw err;
  }
}));

reimbursementsRouter.get("/:id", wrap(async (req, res) => {
  const { rows } = await pool.query(`${SELECT} WHERE r.id=$1`, [Number(req.params.id) || 0]);
  if (!canSee(req, rows[0])) return res.status(404).json({ error: "Claim not found." });
  const { rows: ev } = await pool.query(
    `SELECT v.*, e.name AS actor_name FROM reimbursement_events v LEFT JOIN employees e ON lower(e.work_email)=lower(v.actor)
     WHERE reimbursement_id=$1 ORDER BY v.id`, [rows[0].id]);
  const items = await itemsOf(pool, rows[0].id), docs = await docsOf(pool, rows[0].id);
  res.json({ claim: { ...toApi(rows[0]), items: items.map((it) => itemApi(it, docs)) },
    events: ev.map((e) => ({ at: e.at, actor: e.actor === "system" ? "System" : e.actor_name || e.actor, kind: e.kind, status: e.status, note: e.note })) });
}));

// Create a draft with its expenses. Employees always for themselves; HR may file for someone.
reimbursementsRouter.post("/", wrap(async (req, res) => {
  const b = req.body || {};
  const email = isHr(req) && b.email ? String(b.email).toLowerCase() : me(req);
  const out = await tx(async (db) => {
    const { errors, items } = await readItems(db, b);
    if (errors) return { status: 400, body: { errors } };
    const d = await newDraft(db, req, { email, budgetId: Number(b.budgetId) || null });
    if (d.err) return d.err;
    if (d.existing) return { status: 409, body: { error: "The final bill for this budget is already being filed. Open that claim.", claimId: d.existing } };
    const c = d.claim;
    await saveItems(db, c.id, items.map((it) => ({ ...it, id: null })));
    const after = await syncHeader(db, c.id);
    await event(db, after, { actor: me(req), kind: "Draft created", status: "draft",
      note: `${items.length} expense${items.length === 1 ? "" : "s"}, ${inr(after.amount)}${items.some((it) => it.source === "excel") ? ", from an expense sheet" : ""}` });
    return { status: 201, body: { id: c.id, claimNo: c.claim_no } };
  });
  send(res, out);
}));

const owns = (req, c) => c.work_email.toLowerCase() === me(req) || c.created_by === me(req);

// Edit the expenses while it is a draft or after HR asked for changes. Only the employee (or HR who filed it).
reimbursementsRouter.put("/:id", wrap(async (req, res) => {
  const b = req.body || {};
  let files = [];
  const out = await tx(async (db) => {
    const c = await loadClaim(db, req.params.id, true);
    if (!canSee(req, c)) return { status: 404, body: { error: "Claim not found." } };
    if (!owns(req, c)) return { status: 403, body: { error: "Only the employee can change this claim." } };
    if (!TRANSITIONS.edit.includes(c.status)) return { status: 409, body: { error: "This claim can't be changed now." } };
    const { errors, items } = await readItems(db, b);
    if (errors) return { status: 400, body: { errors } };
    const before = await itemsOf(db, c.id);
    files = await saveItems(db, c.id, items);
    const after = await syncHeader(db, c.id), changed = [];
    if (Number(c.amount) !== Number(after.amount)) changed.push(`total ${inr(c.amount)} → ${inr(after.amount)}`);
    if (before.length !== items.length) changed.push(`${before.length} → ${items.length} expenses`);
    if (changed.length || c.status !== "draft") await event(db, after, { actor: me(req), kind: "Details updated", note: changed.join("; ") || null });
    if (files.edited.length) await event(db, after, { actor: me(req), kind: "Employee edited details read from the invoice", note: files.edited.join("; ") });
    else if (items.some((it) => before.find((x) => x.id === it.id && x.extracted)) && c.status === "draft")
      await event(db, after, { actor: me(req), kind: "Employee reviewed the details read from the invoice" });
    await evaluate(db, after);
    return { status: 200, body: { ok: true } };
  });
  if (out.status === 200) await rmFiles(files);
  send(res, out);
}));

// Delete a draft (never a submitted claim).
reimbursementsRouter.delete("/:id", wrap(async (req, res) => {
  let files = [];
  const out = await tx(async (db) => {
    const c = await loadClaim(db, req.params.id, true);
    if (!canSee(req, c) || !owns(req, c)) return { status: 404, body: { error: "Claim not found." } };
    if (c.status !== "draft") return { status: 409, body: { error: "Only a draft can be deleted." } };
    files = [...(await docsOf(db, c.id)).map((d) => d.stored), c.doc_stored];
    await db.query("DELETE FROM reimbursement_events WHERE reimbursement_id=$1", [c.id]);
    await db.query("DELETE FROM reimbursements WHERE id=$1", [c.id]);
    await db.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`${c.claim_no}: draft deleted`, c.work_email]);
    return { status: 200, body: { ok: true } };
  });
  if (out.status === 200) await rmFiles(files);
  send(res, out);
}));

/** Loads a claim and one of its expenses for a change by the employee; returns an error response when not allowed. */
async function editableItem(db, req, lock) {
  const c = await loadClaim(db, req.params.id, lock);
  if (!canSee(req, c)) return { err: { status: 404, body: { error: "Claim not found." } } };
  if (!owns(req, c)) return { err: { status: 403, body: { error: "Only the employee can change this claim." } } };
  if (!TRANSITIONS.edit.includes(c.status)) return { err: { status: 409, body: { error: "This claim can't be changed now." } } };
  const { rows } = await db.query("SELECT * FROM reimbursement_items WHERE id=$1 AND reimbursement_id=$2", [Number(req.params.itemId) || 0, c.id]);
  if (!rows[0]) return { err: { status: 404, body: { error: "Expense not found." } } };
  return { c, item: rows[0] };
}

// Upload or replace one expense's receipt. Automation 2: validate the file, read it, compare the amount, check duplicates.
reimbursementsRouter.put("/:id/items/:itemId/document", express.raw({ type: () => true, limit: MAX_BYTES }), wrap(async (req, res) => {
  const pre = await editableItem(pool, req, false);
  if (pre.err) return send(res, pre.err);
  const file = await checkFile(req.body);
  if (!file.ok) return res.status(400).json({ error: file.checks.find((c) => !c.ok).label, checks: file.checks });
  const read = await readInvoice(req.body, file.type);
  const stored = crypto.randomUUID() + "." + file.type.ext;
  const name = String(req.query.name || "document").replace(/[^\w.\- ()]/g, "_").slice(0, 120);
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, stored), req.body);
  let old = [];
  try {
    const out = await tx(async (db) => {
      const { c, item, err } = await editableItem(db, req, true);
      if (err) return err;
      const prev = (await docsOf(db, c.id)).filter((d) => d.item_id === item.id);
      old = prev.map((d) => d.stored);
      for (const d of prev) await db.query("DELETE FROM reimbursement_documents WHERE id=$1", [d.id]);
      const validation = { file: { ok: true, checks: file.checks }, read };
      const { rows: [doc] } = await db.query(
        `INSERT INTO reimbursement_documents (reimbursement_id, item_id, name, mime, size, stored, validation) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [c.id, item.id, name, file.type.mime, req.body.length, stored, JSON.stringify(validation)]);
      await db.query("UPDATE reimbursement_items SET no_receipt=false WHERE id=$1", [item.id]);
      const label = `expense ${item.position} (${inr(item.amount)})`;
      await event(db, c, { actor: me(req), kind: prev.length ? "Receipt replaced" : "Receipt uploaded", note: `${name} for ${label}` });
      const ev = await evaluate(db, c);
      const m = ev.validation.items[item.id].match;
      await event(db, c, { actor: "system", kind: "Receipt validated",
        note: [label, file.checks.map((x) => x.label).join(", "), read.readable ? `read by ${read.method}` : "not machine-readable",
          m.status === "match" ? "amount matches" : m.status === "mismatch" ? `receipt shows ${inr(m.invoiceTotal)}` : null].filter(Boolean).join("; ") });
      return { status: 200, body: { document: docApi(doc), validation: ev.validation, duplicates: ev.duplicates } };
    });
    if (out.status !== 200) { await rmFiles([stored]); return send(res, out); }
    await rmFiles(old);
    send(res, out);
  } catch (err) {
    await rmFiles([stored]);
    throw err;
  }
}));

// Remove one expense's receipt (to replace it with the no-receipt mark, or upload another later).
reimbursementsRouter.delete("/:id/items/:itemId/document", wrap(async (req, res) => {
  let files = [];
  const out = await tx(async (db) => {
    const { c, item, err } = await editableItem(db, req, true);
    if (err) return err;
    const docs = (await docsOf(db, c.id)).filter((d) => d.item_id === item.id);
    if (!docs.length) return { status: 404, body: { error: "This expense has no receipt." } };
    files = docs.map((d) => d.stored);
    await db.query("DELETE FROM reimbursement_documents WHERE item_id=$1", [item.id]);
    await event(db, c, { actor: me(req), kind: "Receipt removed", note: `${docs[0].name} from expense ${item.position}` });
    const ev = await evaluate(db, c);
    return { status: 200, body: { validation: ev.validation, duplicates: ev.duplicates } };
  });
  if (out.status === 200) await rmFiles(files);
  send(res, out);
}));

// Mark one expense as having no receipt (small expenses only), or undo that.
reimbursementsRouter.patch("/:id/items/:itemId", wrap(async (req, res) => {
  const want = !!(req.body && req.body.noReceipt);
  const out = await tx(async (db) => {
    const { c, item, err } = await editableItem(db, req, true);
    if (err) return err;
    if (want) {
      if ((await docsOf(db, c.id)).some((d) => d.item_id === item.id)) return { status: 409, body: { error: "Remove the uploaded receipt first." } };
      if (Number(item.amount) > NO_RECEIPT_MAX) return { status: 400, body: { error: `Expenses without a receipt can be up to ${inr(NO_RECEIPT_MAX)}. Upload the receipt for this one.` } };
    }
    await db.query("UPDATE reimbursement_items SET no_receipt=$2 WHERE id=$1", [item.id, want]);
    const ev = await evaluate(db, c);
    return { status: 200, body: { validation: ev.validation, duplicates: ev.duplicates } };
  });
  send(res, out);
}));

// A receipt, shown inside the page (or downloaded). Only the employee and HR; never a raw storage path.
reimbursementsRouter.get("/:id/documents/:docId", wrap(async (req, res) => {
  const c = await loadClaim(pool, req.params.id);
  const { rows } = c ? await pool.query("SELECT * FROM reimbursement_documents WHERE id=$1 AND reimbursement_id=$2", [Number(req.params.docId) || 0, c.id]) : { rows: [] };
  if (!canSee(req, c) || !rows[0]) return res.status(404).json({ error: "Receipt not found." });
  const d = rows[0], file = path.join(UPLOAD_DIR, path.basename(d.stored));
  try { await fs.access(file); } catch { return res.status(410).json({ error: "The receipt file is missing from storage." }); }
  res.set({
    "Content-Type": d.mime,
    "Content-Disposition": `${req.query.download ? "attachment" : "inline"}; filename="${d.name.replace(/"/g, "")}"`,
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
  });
  res.sendFile(file);
}));

/** Every expense needs a receipt or the no-receipt mark; no-receipt expenses need the employee's declaration. */
async function readyToSend(db, c, body, actor) {
  const all = await itemsOf(db, c.id);
  if (!all.length) return { status: 400, body: { error: "Upload an invoice or add an expense first." } };
  const blank = all.filter((it) => it.amount == null || !it.category || !it.expense_date || !String(it.description || "").trim());
  if (blank.length) return { status: 400, body: { error: `Fill in the details for expense ${blank.map((it) => it.position).join(", ")} (category, amount, date and what it was for).` } };
  const ev = await evaluate(db, c);
  if (ev.eligibility.needsFare.length) return { status: 400, body: { error: `Expense ${ev.eligibility.needsFare.join(", ")} was booked above the allowed travel class. Enter the fare for the allowed class.` } };
  // Automation 2: an amount that differs from the invoice must be confirmed before it goes to HR.
  if (ev.validation.match.mismatches && !(body && body.confirmAmounts)) return { status: 400, body: { error: "Some amounts differ from the invoice. Confirm them before submitting.", needsConfirm: true } };
  if (ev.validation.match.mismatches) await event(db, c, { actor, kind: "Employee confirmed amounts that differ from the invoice",
    note: `claimed ${inr(ev.validation.match.claimed)}, invoices show ${inr(ev.validation.match.invoiceTotal)}` });
  const gaps = await receiptGaps(db, c.id);
  if (gaps.length) return { status: 400, body: { error: `Add the receipt for expense ${gaps.map((g) => g.position).join(", ")}, or mark it as a small expense without a receipt.` } };
  const items = await itemsOf(db, c.id), docs = await docsOf(db, c.id);
  const nr = items.filter((it) => it.no_receipt && !docs.some((d) => d.item_id === it.id));
  const big = nr.find((it) => Number(it.amount) > NO_RECEIPT_MAX);
  if (big) return { status: 400, body: { error: `Expense ${big.position} is over ${inr(NO_RECEIPT_MAX)} and needs a receipt.` } };
  if (nr.length && !(body && body.declaration)) return { status: 400, body: { error: "Confirm the declaration for the expenses without a receipt." } };
  if (nr.length) await event(db, c, { actor, kind: "Declaration for expenses without a receipt",
    note: `${nr.length} expense${nr.length === 1 ? "" : "s"}, ${inr(nr.reduce((n, it) => n + Number(it.amount), 0))}` });
  return null;
}

// Submit a draft. Needs a document. Automations 1 (announce) and 3 (duplicates).
reimbursementsRouter.post("/:id/submit", wrap(async (req, res) => {
  const out = await tx(async (db) => {
    const c = await loadClaim(db, req.params.id, true);
    if (!canSee(req, c) || !(c.work_email.toLowerCase() === me(req) || c.created_by === me(req))) return { status: 404, body: { error: "Claim not found." } };
    if (!TRANSITIONS.submit.includes(c.status)) return { status: 409, body: { error: "This claim was already submitted." } };
    const bad = await readyToSend(db, c, req.body, me(req));
    if (bad) return bad;
    const { rows: [fresh] } = await db.query("UPDATE reimbursements SET status='submitted', submitted_at=now(), requested_amount=amount, updated_at=now() WHERE id=$1 RETURNING *", [c.id]);
    const r = await onSubmitted(db, fresh, me(req), false);
    return { status: 200, body: { ok: true, ...r }, claim: fresh, eligibility: r.eligibility };
  });
  if (out.status === 200) {
    const c = out.claim, name = await employeeName(pool, c.work_email);
    await notify("hr", { title: `New reimbursement claim from ${name} for ${inr(c.amount)} requires review.`, body: c.claim_no, link: `claim:${c.id}`,
      email: { subject: `New reimbursement claim: ${c.claim_no}`, body: `New reimbursement claim from ${name} for ${inr(c.amount)} requires review (${c.claim_no}).` } });
    await notifyBudgetExcess(c, out.eligibility);
  }
  send(res, { status: out.status, body: out.body });
}));

// HR opens the claim: it moves to Under review and the opening is recorded.
reimbursementsRouter.post("/:id/open", requireHr, wrap(async (req, res) => {
  const out = await tx(async (db) => {
    const c = await loadClaim(db, req.params.id, true);
    if (!c) return { status: 404, body: { error: "Claim not found." } };
    if (!TRANSITIONS.open.includes(c.status)) return { status: 200, body: { ok: true, changed: false } };
    await db.query("UPDATE reimbursements SET status='under_review', updated_at=now() WHERE id=$1", [c.id]);
    await event(db, c, { actor: me(req), kind: "HR opened the claim", status: "under_review" });
    return { status: 200, body: { ok: true, changed: true } };
  });
  send(res, out);
}));

// Approve. Automation 4: the claim is queued for the next payroll that hasn't been processed yet.
/*
 * Approve in full or in part (Automations 5 and 8). HR sends approvedAmount; when it is left out the eligible amount
 * (after travel policy and budget) is approved. The server enforces 0 < approved <= requested, keeps the requested
 * amount untouched, stores the unapproved difference, and only the approved amount goes to payroll.
 */
reimbursementsRouter.post("/:id/approve", requireHr, wrap(async (req, res) => {
  const b = req.body || {};
  const reason = clip(b.reason ?? b.note, 500);
  const out = await tx(async (db) => {
    const c = await loadClaim(db, req.params.id, true);
    if (!c) return { status: 404, body: { error: "Claim not found." } };
    if (!TRANSITIONS.decide.includes(c.status)) return { status: 409, body: { error: `This claim is ${c.status.replace(/_/g, " ")} and can't be approved.` } };
    if ((await receiptGaps(db, c.id)).length) return { status: 400, body: { error: "An expense has no receipt to approve against." } };
    const ev = await evaluate(db, c);
    const requested = Number(c.requested_amount ?? c.amount);
    const raw = b.approvedAmount === undefined || b.approvedAmount === null || b.approvedAmount === "" ? ev.eligibility.eligible : Number(b.approvedAmount);
    if (!(raw > 0) || Math.round(raw * 100) !== raw * 100) return { status: 400, body: { errors: { approvedAmount: "Enter the approved amount in rupees, more than zero." } } };
    if (raw > requested) return { status: 400, body: { errors: { approvedAmount: `The approved amount can't be more than the ${inr(requested)} requested.` } } };
    const approved = round2(raw), unapproved = round2(requested - approved), partial = unapproved > 0;
    if (partial && !reason && approved !== ev.eligibility.eligible) return { status: 400, body: { errors: { reason: "Give a reason for approving less than requested." } } };
    let period = istMonth();
    for (;;) { const { rowCount } = await db.query("SELECT 1 FROM payroll_runs WHERE period=$1", [period]); if (!rowCount) break; period = nextMonth(period); }
    await db.query(
      `UPDATE reimbursements SET status='payroll_pending', approved_by=$2, approved_at=now(), payroll_period=$3, requested_amount=$4,
         approved_amount=$5, unapproved_amount=$6, approval_reason=$7, updated_at=now() WHERE id=$1`,
      [c.id, me(req), period, requested, approved, unapproved, reason || (partial && ev.eligibility.reasons.length ? ev.eligibility.reasons.join(" ") : null)]);
    await event(db, c, { actor: me(req), kind: "HR reviewed the amounts", note: `requested ${inr(requested)}, eligible ${inr(ev.eligibility.eligible)}` });
    await event(db, c, { actor: me(req), kind: partial ? "Partially approved by HR" : "Approved by HR", status: "approved",
      note: partial ? `approved ${inr(approved)} of ${inr(requested)}; ${inr(unapproved)} not approved` : `approved ${inr(approved)}` });
    if (reason) await event(db, c, { actor: me(req), kind: "Approval reason recorded", note: reason });
    if (approved > ev.eligibility.eligible) await event(db, c, { actor: me(req), kind: "Approved above the eligible amount", note: `eligible ${inr(ev.eligibility.eligible)}` });
    await event(db, c, { actor: "system", kind: `Added to payroll for ${period}`, status: "payroll_pending", note: `${inr(approved)} on top of salary` });
    return { status: 200, body: { ok: true, payrollPeriod: period, approvedAmount: approved, unapprovedAmount: unapproved }, claim: c,
      facts: { requested, approved, unapproved, partial, reason } };
  });
  if (out.status === 200) {
    const c = out.claim, f = out.facts;
    if (f.partial) await notify(c.work_email, { title: `Your reimbursement of ${inr(f.requested)} was partly approved: ${inr(f.approved)}.`, body: `${c.claim_no} · ${inr(f.unapproved)} not approved`, link: `claim:${c.id}`,
      email: { subject: `Reimbursement partly approved: ${c.claim_no}`, body: `Your reimbursement request of ${inr(f.requested)} has been reviewed.\n\nApproved amount: ${inr(f.approved)}\nUnapproved amount: ${inr(f.unapproved)}${f.reason ? `\n\nReason:\n${f.reason}` : ""}\n\nThe approved amount will be paid with the ${out.body.payrollPeriod} payroll.` } });
    else await notify(c.work_email, { title: `Your reimbursement claim of ${inr(f.approved)} has been approved.`, body: `${c.claim_no} · paid with the ${out.body.payrollPeriod} payroll`, link: `claim:${c.id}`,
      email: { subject: `Reimbursement approved: ${c.claim_no}`, body: `Your reimbursement claim of ${inr(f.approved)} has been approved. It will be paid with the ${out.body.payrollPeriod} payroll.` } });
  }
  send(res, { status: out.status, body: out.body });
}));

reimbursementsRouter.post("/:id/reject", requireHr, wrap(async (req, res) => {
  const reason = req.body && req.body.reason, note = clip(req.body && req.body.note, 500);
  if (!REJECT_REASONS.includes(reason)) return res.status(400).json({ errors: { reason: "Pick a reason." } });
  if (reason === "Other" && !note) return res.status(400).json({ errors: { note: "Explain the reason." } });
  const out = await tx(async (db) => {
    const c = await loadClaim(db, req.params.id, true);
    if (!c) return { status: 404, body: { error: "Claim not found." } };
    if (!TRANSITIONS.decide.includes(c.status)) return { status: 409, body: { error: `This claim is ${c.status.replace(/_/g, " ")} and can't be rejected.` } };
    await db.query("UPDATE reimbursements SET status='rejected', rejection_reason=$2, rejection_note=$3, updated_at=now() WHERE id=$1", [c.id, reason, note]);
    await event(db, c, { actor: me(req), kind: "Rejected by HR", status: "rejected", note: [reason, note].filter(Boolean).join(": ") });
    return { status: 200, body: { ok: true }, claim: c };
  });
  if (out.status === 200) {
    const c = out.claim;
    await notify(c.work_email, { title: "Your reimbursement claim has been rejected.", body: `${c.claim_no} · ${reason}${note ? `: ${note}` : ""}`, link: `claim:${c.id}`,
      email: { subject: `Reimbursement rejected: ${c.claim_no}`, body: `Your reimbursement claim ${c.claim_no} of ${inr(c.amount)} has been rejected.\nReason: ${reason}${note ? `\n${note}` : ""}` } });
  }
  send(res, { status: out.status, body: out.body });
}));

reimbursementsRouter.post("/:id/request-changes", requireHr, wrap(async (req, res) => {
  const comment = clip(req.body && req.body.comment, 1000);
  if (!comment) return res.status(400).json({ errors: { comment: "Tell the employee what to change." } });
  const out = await tx(async (db) => {
    const c = await loadClaim(db, req.params.id, true);
    if (!c) return { status: 404, body: { error: "Claim not found." } };
    if (!TRANSITIONS.decide.includes(c.status)) return { status: 409, body: { error: `This claim is ${c.status.replace(/_/g, " ")}; changes can't be requested now.` } };
    await db.query("UPDATE reimbursements SET status='changes_requested', change_comment=$2, updated_at=now() WHERE id=$1", [c.id, comment]);
    await event(db, c, { actor: me(req), kind: "Changes requested", status: "changes_requested", note: comment });
    return { status: 200, body: { ok: true }, claim: c };
  });
  if (out.status === 200) {
    const c = out.claim;
    await notify(c.work_email, { title: "Additional information is required for your reimbursement claim.", body: `${c.claim_no} · ${comment}`, link: `claim:${c.id}`,
      email: { subject: `Changes needed: ${c.claim_no}`, body: `Additional information is required for your reimbursement claim ${c.claim_no}.\n\nHR's comment: ${comment}` } });
  }
  send(res, { status: out.status, body: out.body });
}));

// The employee sends it back after making the changes. Goes back to HR's review queue.
reimbursementsRouter.post("/:id/resubmit", wrap(async (req, res) => {
  const out = await tx(async (db) => {
    const c = await loadClaim(db, req.params.id, true);
    if (!canSee(req, c) || !(c.work_email.toLowerCase() === me(req) || c.created_by === me(req))) return { status: 404, body: { error: "Claim not found." } };
    if (!TRANSITIONS.resubmit.includes(c.status)) return { status: 409, body: { error: "Only a claim with changes requested can be resubmitted." } };
    const bad = await readyToSend(db, c, req.body, me(req));
    if (bad) return bad;
    const { rows: [fresh] } = await db.query("UPDATE reimbursements SET status='resubmitted', submitted_at=now(), requested_amount=amount, last_reminded_at=NULL, updated_at=now() WHERE id=$1 RETURNING *", [c.id]);
    const r = await onSubmitted(db, fresh, me(req), true);
    return { status: 200, body: { ok: true, ...r }, claim: fresh, eligibility: r.eligibility };
  });
  if (out.status === 200) {
    const c = out.claim, name = await employeeName(pool, c.work_email);
    await notify("hr", { title: `${name} resubmitted reimbursement ${c.claim_no} (${inr(c.amount)}) for review.`, link: `claim:${c.id}`,
      email: { subject: `Reimbursement resubmitted: ${c.claim_no}`, body: `${name} resubmitted reimbursement ${c.claim_no} (${inr(c.amount)}) after the requested changes.` } });
    await notifyBudgetExcess(c, out.eligibility);
  }
  send(res, { status: out.status, body: out.body });
}));

// Oversized uploads get a readable error.
reimbursementsRouter.use((err, _req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "The file is larger than 10 MB." });
  next(err);
});
