// Personal access keys: the rules, without the database (tested in test/access-keys.test.mjs).
//
// A key lets the Wohlig One MCP (mcp/) act as the person who made it, through the same /api endpoints the dashboard uses,
// so access.js still decides everything. Two limits on top: a key never holds a salary permission (salaryRule in
// access-rules.js), and a key cannot reach the paths below at all, because whatever a key reads is handed to an AI assistant
// and Claude never reads salaries, payments, tax, bank details or staff documents (CLAUDE.md). Changing who may do what,
// signing in and managing keys also stay with a person in the browser.
import crypto from "node:crypto";

export const KEY_PREFIX = "wo1_";
export const KEY_PATTERN = /^wo1_[A-Za-z0-9_-]{43}$/;
export const MAX_LIVE_KEYS = 5;
export const DEFAULT_DAYS = 90;
export const MAX_DAYS = 365;

/** A new key: the secret shown once, its SHA-256 hash (all that is stored) and the first characters, to recognise it in a list. */
export function newKey() {
  const secret = KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
  return { secret, hash: hashKey(secret), hint: secret.slice(0, 10) };
}
export const hashKey = (secret) => crypto.createHash("sha256").update(String(secret)).digest("hex");

/** The key in "Authorization: Bearer wo1_…", or null. Anything else in the header is not a key and is ignored. */
export function keyFromHeader(header) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(header || ""));
  return m && KEY_PATTERN.test(m[1]) ? m[1] : null;
}

/** Checks the form on Account > Access keys. Returns { value: { name, days } } or { errors }. */
export function readKeyForm(body) {
  const b = body || {}, errors = {};
  const name = String(b.name || "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069"`<>]/g, "").trim().replace(/\s+/g, " ");
  if (!name) errors.name = "Please give the key a name, for example the computer it is for.";
  else if (name.length > 60) errors.name = "Please keep the name under 60 characters.";
  const days = b.days === undefined || b.days === null || b.days === "" ? DEFAULT_DAYS : Number(b.days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) errors.days = `Please choose between 1 and ${MAX_DAYS} days.`;
  return Object.keys(errors).length ? { errors } : { value: { name, days } };
}

// Paths a key never reaches, whoever made it. Each is matched against the start of the path, at a "/" boundary.
const BLOCKED_PREFIXES = [
  // Salaries and every other payment (decided 2026-11-27): payroll, payslips, finance reports, claims, loans, budgets, advances, tax.
  "/api/payroll", "/api/payslips", "/api/finance", "/api/reimbursements", "/api/loans", "/api/budget-requests", "/api/advances",
  "/api/tax-declaration", "/api/tax-declarations", "/api/requests/advance", "/api/leave/salary-cuts", "/api/tools",
  // The employee details sheet: a workbook of everyone's masked IDs and bank details, and uploads that write them.
  "/api/onboarding/import",
  // Offer letters carry the offered pay.
  "/api/hr/offers",
  // Staff documents, the document password, full PAN and Aadhaar numbers, and the employee workbook that holds them.
  "/api/documents", "/api/document-password", "/api/employees/ids", "/api/employees/export",
  // Who may do what, signing in, passkeys and the keys themselves stay with a person in the browser.
  "/api/access", "/api/access-keys", "/api/oauth", "/api/passkeys", "/api/password", "/api/login", "/api/logout", "/api/auth",
  // A punch needs the person's own phone and place, not a script.
  "/api/attendance/punch",
];
// Paths with a part in the middle.
const BLOCKED_PATTERNS = [
  /^\/api\/employees\/[^/]+\/pay(\/|$)/,          // salary cuts for leave without pay
  /^\/api\/offboarding\/[^/]+\/clearance(\/|$)/,  // final settlement figures
  /^\/api\/offboarding\/clearance(\/|$)/,
  /^\/api\/hr\/candidates\/[^/]+\/offers(\/|$)/,  // offer letters for a candidate
  /^\/api\/requests\/advance(\/|$)/,
];
// Changes a key may not make, though it may read the same place: logins and passwords (Manage > Users: resets, roles, the default
// password, new logins), a Google account with its first password (Onboarding > work email), and your own missed punch, which an
// attendance request can add at once without your phone or place.
const BLOCKED_WRITES = [
  /^\/api\/users(\/|$)/,
  /^\/api\/onboarding\/work-email$/,
  /^\/api\/requests\/attendance$/,
];

const clean = (path) => {
  let p = String(path || "").split("?")[0].split("#")[0];
  try { p = decodeURIComponent(p); } catch { /* keep as sent */ }
  p = p.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
  return p.toLowerCase();
};

/**
 * Whether a request made with an access key may reach this path with this method. Only /api paths, none of the blocked ones,
 * and no blocked change. An encoded slash, backslash or NUL is refused outright, so a decoded path can never differ from the
 * one Express routes on.
 */
export function keyMayReach(path, method = "GET") {
  if (/%(2f|5c|00)/i.test(String(path || ""))) return false;
  const p = clean(path);
  if (p.split("/").includes("..")) return false;
  if (p === "/mcp") return true;   // the hosted connector itself (mcp-server.js), which calls back into /api with the same key
  // The connector's public sign-in paths read no one's data: a client that sends its old token along is not refused.
  if (["/oauth/token", "/oauth/register", "/oauth/revoke"].includes(p) || p.startsWith("/.well-known/oauth-")) return true;
  if (p !== "/api" && !p.startsWith("/api/")) return false;
  if (BLOCKED_PREFIXES.some((b) => p === b || p.startsWith(b + "/"))) return false;
  if (BLOCKED_PATTERNS.some((re) => re.test(p))) return false;
  const reads = ["GET", "HEAD", "OPTIONS"].includes(String(method || "GET").toUpperCase());
  if (!reads && BLOCKED_WRITES.some((re) => re.test(p))) return false;
  return true;
}

/*
 * Fields no answer to a key ever carries, wherever they appear (any depth, any endpoint): ID numbers, bank details, the PF number
 * and pay figures, masked or not. keyGuard removes them from every JSON answer to a key, so an endpoint that starts returning one
 * of them later cannot hand it to an AI assistant. A second wall behind the blocked paths and the salary rule.
 */
export const KEY_HIDDEN_FIELDS = new Set([
  "pan", "aadhaar", "acct", "ifsc", "panMasked", "aadhaarMasked", "acctMasked", "pan_masked", "aadhaar_masked", "acct_masked",
  "pan_enc", "aadhaar_enc", "hasPan", "has_pan", "pfNumber", "pf_number", "uan", "bankAccount", "bankName", "accountNumber",
  "account_number", "monthlyGross", "monthly_gross", "annualCtc", "annual_ctc", "ctc", "grossPay", "netPay", "settlement", "clearance",
]);
/** A copy of a JSON answer without KEY_HIDDEN_FIELDS, at any depth. Other values are kept exactly. */
export function scrubForKey(value, depth = 0) {
  if (depth > 40 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrubForKey(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) if (!KEY_HIDDEN_FIELDS.has(k)) out[k] = scrubForKey(v, depth + 1);
  return out;
}

/** The words the MCP shows when a path is out of reach. */
export const BLOCKED_MESSAGE = "This part of Wohlig One cannot be used with an access key. Salaries, payments, tax, bank details, staff "
  + "documents, access rights and sign-in stay in the browser, for the people allowed to see them.";
