import crypto from "node:crypto";

import { canAll, holds, scopeOf } from "../access.js";
import { salaryOwners } from "../access-rules.js";
import { pool as mainPool } from "../db.js";

/*
 * Who may see payroll, and the encryption used for bank account numbers and bank files. The payroll permissions below are held
 * by the salary owners only (SALARY_OWNERS, kailash@wohlig.com by default; access-rules.js), never by a grant or a super admin.
 *
 *   payroll.prepare  (company)        prepares payroll: salaries, inputs, recalculation, Excel, adjustments, tax rules, declarations, publishing.
 *   payroll.approve  (company)        sees a run once it is sent for review, approves, rejects or asks for changes. Never sees bank
 *                                     account numbers. Nobody approves a run they sent, generated or edited (maker-checker).
 *   payroll.bank     (company)        salary bank accounts and the bank transfer file.
 *   payroll.view     (company or team) sees runs once they are sent for review; a team holder sees only their team's lines.
 *   Everyone else                     403. Their own payslip stays under /api/payslips.
 *
 * PAYROLL_REVIEWERS is read only once, by the first start-up step that turned the old payroll reviewers into payroll.approve
 * grants (access.js bootstrapAccess); nothing else reads it.
 */


/**
 * The signed-in person's payroll powers: { email, hr, reviewer, bank, viewer, scope }.
 * hr = payroll.prepare, reviewer = payroll.approve, bank = payroll.bank (all company-wide). scope is null when they may see every
 * line of a visible run, or a Set of the emails whose lines they may see (payroll.view for a team only).
 */
export async function actorOf(req) {
  const hr = canAll(req, "payroll.prepare"), reviewer = canAll(req, "payroll.approve"), bank = canAll(req, "payroll.bank");
  const viewer = holds(req, "payroll.view");
  const scope = hr || reviewer || bank ? null : viewer ? await scopeOf(req, "payroll.view") : new Set();
  // With one salary owner there is nobody else to check their work, so they may review and approve a run they prepared.
  const sole = salaryOwners().length === 1;
  return { email: req.user.email, hr, reviewer, bank, viewer, scope, sole };
}

/** Who is told that a payroll is waiting for review: the salary owners (access-rules.js), never anyone else. */
export async function approvers() {
  const { rows } = await mainPool.query("SELECT lower(email) AS email FROM users WHERE lower(email) = ANY($1) AND NOT login_blocked", [salaryOwners()]);
  return rows.map((r) => r.email);
}

const denied = (res) => res.status(403).json({ error: "You do not have access to this. Please ask a super admin if you need it." });

/** The /api/payroll gate: payroll.prepare, payroll.approve, payroll.bank or payroll.view (any scope). */
export const requirePayrollAccess = (req, res, next) =>
  !req.user ? res.status(401).json({ error: "Please sign in." })
  : !["payroll.prepare", "payroll.approve", "payroll.bank", "payroll.view"].some((p) => holds(req, p)) ? denied(res)
  : (res.setHeader("Cache-Control", "private, no-store"), next());

/** Preparing payroll: payroll.prepare for the whole company. (The name is kept: index.js mounts it.) */
export const hrOnly = (req, res, next) => (canAll(req, "payroll.prepare") ? next() : denied(res));
/** Salary bank accounts and the bank file: payroll.bank for the whole company. */
export const bankOnly = (req, res, next) => (canAll(req, "payroll.bank") ? next() : denied(res));

/* ---------- AES-256-GCM with PAYROLL_ENCRYPTION_KEY (32 bytes, as 64 hex characters or base64) ---------- */
function key() {
  const raw = String(process.env.PAYROLL_ENCRYPTION_KEY || "").trim();
  const k = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (k.length !== 32) {
    const e = new Error("Bank details can't be stored or read: set PAYROLL_ENCRYPTION_KEY (32 bytes, e.g. `openssl rand -hex 32`) on the server.");
    e.status = 503;
    throw e;
  }
  return k;
}
export const encryptionReady = () => { try { key(); return true; } catch { return false; } };

/** Buffer or string → "v1:<iv>:<tag>:<data>" (base64 parts). */
export function seal(data) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8")), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${body.toString("base64")}`;
}
/** The reverse of seal(). Returns a Buffer. Throws if the data was changed. */
export function open(sealed) {
  const [v, iv, tag, body] = String(sealed).split(":");
  if (v !== "v1") throw new Error("Unknown encryption format.");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]);
}

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
