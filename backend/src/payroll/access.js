import crypto from "node:crypto";

/*
 * Who may see payroll, and the encryption used for bank account numbers and bank files.
 *
 *   HR (users.role = 'hr')        prepares payroll: salaries, bank details, inputs, Excel, bank file.
 *   Payroll reviewer              PAYROLL_REVIEWERS (comma separated emails; default chirag@wohlig.com). Sees the run and the
 *                                 Excel report, approves, rejects or asks for changes. Never sees bank account numbers.
 *   Everyone else                 403. Their own payslip stays under /api/payslips.
 */
export const reviewers = () => (process.env.PAYROLL_REVIEWERS ?? "chirag@wohlig.com").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isReviewer = (email) => !!email && reviewers().includes(String(email).toLowerCase());
export const actorOf = (req) => ({ email: req.user.email, hr: req.user.role === "hr", reviewer: isReviewer(req.user.email) });

export const requirePayrollAccess = (req, res, next) =>
  !req.user ? res.status(401).json({ error: "Please sign in." })
  : req.user.role !== "hr" && !isReviewer(req.user.email) ? res.status(403).json({ error: "You are not authorized to access payroll." })
  : (res.setHeader("Cache-Control", "private, no-store"), next());

export const hrOnly = (req, res, next) => (req.user.role === "hr" ? next() : res.status(403).json({ error: "Only HR can do this." }));

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
