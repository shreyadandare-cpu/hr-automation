import { open as unseal } from "./payroll/access.js";
import { formatAadhaar } from "./validate.js";

/*
 * The full PAN and Aadhaar numbers for the Excel files HR downloads (the employee details and the documents status). Read in one query, decrypted here, and handed back as
 * Map(lower-case email → { pan, aadhaar }). A number that is not stored (or cannot be opened, for example without the server's encryption key) is simply missing from the map,
 * and the caller falls back to the masked form. Whoever asks must already be company-wide HR; the caller writes the audit line.
 */
export async function fullIdsOf(db) {
  const { rows } = await db.query("SELECT lower(work_email) AS e, pan_enc, aadhaar_enc FROM employee_ids");
  const out = new Map();
  for (const r of rows) {
    const open = (s) => { try { return s ? unseal(s).toString("utf8") : ""; } catch { return ""; } };
    out.set(r.e, { pan: open(r.pan_enc), aadhaar: open(r.aadhaar_enc) ? formatAadhaar(open(r.aadhaar_enc)) : "" });
  }
  return out;
}

/** Puts the full number where one is held, and keeps the masked form otherwise. */
export const withFull = (full, email, masked) => ({ pan: (full.get(String(email).toLowerCase()) || {}).pan || masked.pan || "", aadhaar: (full.get(String(email).toLowerCase()) || {}).aadhaar || masked.aadhaar || "" });
