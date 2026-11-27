import crypto from "node:crypto";

/*
 * Salary figures are stored encrypted in the database (decided 2026-11-27): each salary row keeps its money columns in one
 * "sealed" column, AES-256-GCM with PAYROLL_ENCRYPTION_KEY, and the plain columns are left empty. Nobody reading the database
 * (a database login, a backup, a dump) sees a salary; only this server, holding the key, can.
 *
 * Which columns are sealed, and the fields each one holds:
 */
export const SEALED = {
  item_sealed: { table: "payroll_items", fields: ["base_salary", "lop_deduction", "reimbursement_total", "payable", "slip", "inputs"] },
  structure_sealed: { table: "salary_structures", fields: ["earnings", "other_deductions", "pf_employee", "professional_tax", "tds_monthly", "annual_ctc", "employer_pf", "esic_employee", "pt_february"] },
  adjustment_sealed: { table: "payroll_adjustments", fields: ["amount"] },
  run_sealed: { table: "payroll_runs", fields: ["totals"] },
  file_sealed: { table: "payroll_files", fields: ["totals"] },
  audit_sealed: { table: "payroll_audit", fields: ["detail"] },
  pay_sealed: { table: "employees", fields: ["monthly_gross"] },
  clearance_sealed: { table: "offboarding_clearances", fields: ["final_salary", "reimbursements_payable", "advance_outstanding", "total_recovery", "net_salary", "final_payout", "details"] },
  offer_sealed: { table: "offer_letters", fields: ["ctc_annual", "letter_text"] },
  // Every other payment (2026-11-27): expense claims, advances and loans, contractor payments, budgets, tax declarations.
  reimb_sealed: { table: "reimbursements", fields: ["amount", "paid_amount", "requested_amount", "eligible_amount", "non_eligible_amount", "approved_amount", "unapproved_amount", "validation", "eligibility", "duplicates", "approval_reason"] },
  reimb_doc_sealed: { table: "reimbursement_documents", fields: ["validation"] },
  reimb_item_sealed: { table: "reimbursement_items", fields: ["amount", "policy_fare", "extracted"] },
  advance_sealed: { table: "employee_advances", fields: ["amount", "monthly_recovery"] },
  recovery_sealed: { table: "advance_recoveries", fields: ["amount"] },
  advreq_sealed: { table: "advance_requests", fields: ["amount_minor"] },
  loan_sealed: { table: "loans", fields: ["requested_amount", "approved_amount", "monthly_amount"] },
  loan_event_sealed: { table: "loan_events", fields: ["detail"] },
  contractor_sealed: { table: "contractor_payments", fields: ["amount_minor", "tds_minor"] },
  budget_sealed: { table: "budget_requests", fields: ["requested_budget", "approved_budget"] },
  declreq_sealed: { table: "tax_declaration_requests", fields: ["items", "proofs"] },
  decl_sealed: { table: "tax_declarations", fields: ["declaration"] },
  reimb_event_sealed: { table: "reimbursement_events", fields: ["note"] },
  budget_event_sealed: { table: "budget_request_events", fields: ["note"] },
};
/** What a plain column is left holding once its figures are sealed (NOT NULL columns get their empty value). */
export const EMPTY = { inputs: "{}", detail: "{}", details: "{}", validation: "{}", eligibility: "{}", items: "[]", proofs: "{}", declaration: "{}", duplicates: "[]" };
/** Money columns that were NUMERIC(12,2): rounded to paise before sealing, as the database used to round them. */
const MONEY = new Set(["base_salary", "lop_deduction", "reimbursement_total", "payable", "pf_employee", "professional_tax", "tds_monthly", "annual_ctc",
  "employer_pf", "esic_employee", "pt_february", "amount", "monthly_gross", "final_salary", "reimbursements_payable", "advance_outstanding",
  "total_recovery", "net_salary", "final_payout", "ctc_annual", "paid_amount", "requested_amount", "eligible_amount", "non_eligible_amount",
  "approved_amount", "unapproved_amount", "policy_fare", "monthly_recovery", "monthly_amount", "requested_budget", "approved_budget"]);
const paise = (f, v) => (MONEY.has(f) && typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : v);

/*
 * Every database read goes through openSealedResult() (db.js): a row with a sealed column gets its fields back under their own
 * names, and the sealed column is removed, so the rest of the code reads salaries as before. Writes call sealFields().
 *
 * Without the key: on the live server (NODE_ENV=production) a salary cannot be written at all; in local development the figures
 * stay in the plain columns, as before, and the server log says so once.
 */
const V = "s1";
function key() {
  const raw = String(process.env.PAYROLL_ENCRYPTION_KEY || "").trim();
  if (!raw) return null;
  const k = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return k.length === 32 ? k : null;
}
export const sealingReady = () => !!key();

let warned = false;
function needKey() {
  const k = key();
  if (k) return k;
  if (process.env.NODE_ENV === "production") {
    const e = new Error("Salaries cannot be saved right now: the salary encryption key is not set on the server. Please tell the person who runs Wohlig One.");
    e.status = 503; e.expose = true;
    throw e;
  }
  if (!warned) { warned = true; console.warn("[salaries] PAYROLL_ENCRYPTION_KEY is not set: salary figures are stored unencrypted (local development only)."); }
  return null;
}

/** Seals an object as "s1:<iv>:<tag>:<data>" (base64 parts). */
export function sealJson(obj) {
  const k = needKey();
  if (!k) return null;
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return `${V}:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${body.toString("base64")}`;
}
/** The reverse of sealJson(). Throws if the value was changed or the key is wrong. */
export function openJson(sealed) {
  const [v, iv, tag, body] = String(sealed).split(":");
  if (v !== V) throw new Error("Unknown salary encryption format.");
  const k = key();
  if (!k) throw new Error("Salary figures are encrypted, but PAYROLL_ENCRYPTION_KEY is not set on the server.");
  const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8"));
}

/**
 * For a write: the sealed value and what each plain column should hold. `values` names the fields (as in SEALED[col].fields).
 * With the key: { sealed, plain: every field empty }. Without it (local development): { sealed: null, plain: values as given }.
 * JSON fields are given as objects; plain values come back ready for a query (objects as JSON text).
 */
export function sealFields(col, values) {
  const { fields } = SEALED[col];
  values = Object.fromEntries(Object.entries(values).map(([f, v]) => [f, paise(f, v)]));
  const sealed = sealJson(Object.fromEntries(fields.filter((f) => f in values).map((f) => [f, values[f] === undefined ? null : values[f]])));
  const asParam = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v ?? null);
  const plain = Object.fromEntries(fields.filter((f) => f in values).map((f) => [f, sealed ? EMPTY[f] ?? null : asParam(values[f])]));
  return { sealed, plain };
}

const isEmpty = (f, v) => v === null || v === undefined || (f in EMPTY && (v === EMPTY[f] || (typeof v === "object" && !Object.keys(v).length)));
let warnedGross = false;
/**
 * Puts a row's sealed fields back under their own names (in place) and removes the sealed column.
 * - If the row also holds plain figures, an older release wrote them after the row was sealed: they are the newer ones and win
 *   (the start-up step seals them again).
 * - The monthly gross (employees.pay_sealed) is read on many pages that are not about pay: if it can't be opened (no key, another
 *   key) it is left empty and the server log says so, so those pages keep working. Payroll's own tables refuse instead, so a
 *   recalculation can never run on figures it could not read.
 */
export function openSealedRow(row) {
  for (const col in SEALED) {
    if (!(col in row)) continue;
    const v = row[col];
    delete row[col];
    if (!v) continue;
    if (SEALED[col].fields.some((f) => f in row && !isEmpty(f, row[f]))) continue;
    if (col === "pay_sealed") {
      try { Object.assign(row, openJson(v)); }
      catch (e) { if (!warnedGross) { warnedGross = true; console.error("[salaries] a monthly gross could not be decrypted (check PAYROLL_ENCRYPTION_KEY):", e.message); } }
      continue;
    }
    Object.assign(row, openJson(v));
  }
  return row;
}

const NAMES = new Set(Object.keys(SEALED));
/** A pg result (or the list a multi-statement query returns), with every sealed column opened. */
export function openSealedResult(res) {
  if (Array.isArray(res)) { res.forEach(openSealedResult); return res; }
  if (!res || !Array.isArray(res.rows) || !res.fields || !res.fields.some((f) => NAMES.has(f.name))) return res;
  for (const row of res.rows) openSealedRow(row);
  return res;
}
