const digits = (s) => String(s || "").replace(/\D/g, "");
const has = (v) => String(v ?? "").trim() !== "";

export const V = {
  email: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || "").trim()),
  phone: (v) => {
    let d = digits(v);
    if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
    return /^[6-9]\d{9}$/.test(d);
  },
  aadhaar: (v) => /^[2-9]\d{11}$/.test(digits(v)),
  pan: (v) => /^[A-Z]{5}\d{4}[A-Z]$/.test(String(v || "").trim().toUpperCase()),
  ifsc: (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(v || "").trim().toUpperCase()),
  acct: (v) => /^\d{9,18}$/.test(digits(v)),
  dob: (v) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v || "")) return false;
    const d = new Date(v + "T00:00:00");
    if (isNaN(d)) return false;
    const age = (Date.now() - d) / 31557600000;
    return age >= 16 && age <= 80;
  },
};

/** Only company addresses (name@wohlig.com) can have an account or sign in. Anything else, such as a lookalike domain, is refused. */
export const COMPANY_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || "wohlig.com").trim().toLowerCase().replace(/^@/, "");
export const COMPANY_EMAIL_MESSAGE = `Only @${COMPANY_DOMAIN} email addresses can have an account.`;
export const isCompanyEmail = (v) => {
  const s = String(v || "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+$/.test(s) && s.endsWith(`@${COMPANY_DOMAIN}`) && s.split("@").length === 2;
};

export const maskAadhaar = (v) => (digits(v).length === 12 ? "•••• •••• " + digits(v).slice(-4) : null);
export const maskPan = (v) => {
  const p = String(v || "").trim().toUpperCase();
  return p.length === 10 ? p.slice(0, 2) + "••••••" + p.slice(-2) : null;
};
export const maskAcct = (v) => (digits(v) ? "•••• " + digits(v).slice(-4) : null);

/** Step 1 fields: who the person is and the job. Returns { field: message }. */
export function detailsErrors(d = {}) {
  const e = {};
  if (!has(d.first)) e.first = "Enter a first name.";
  if (!has(d.last)) e.last = "Enter a surname.";
  if (!V.email(d.pemail)) e.pemail = "Enter a valid personal email.";
  else if (/@wohlig\.com$/i.test(String(d.pemail).trim())) e.pemail = "Use a personal email, not a @wohlig.com address.";
  if (!V.phone(d.phone)) e.phone = "Enter a valid 10-digit mobile number.";
  if (!has(d.address)) e.address = "Enter an address.";
  if (!has(d.title)) e.title = "Enter a job title.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.start || "")) e.start = "Enter a start date.";
  if (has(d.empNo) && !/^[A-Za-z0-9][A-Za-z0-9/_-]{0,19}$/.test(String(d.empNo).trim())) e.empNo = "Employee ID can use letters, digits, / - and _ (up to 20 characters).";
  return e;
}

/** Returns { field: message } for a submitted onboarding payload. Empty object means valid. */
export function onboardingErrors({ d = {}, ids = {}, apps }) {
  const e = detailsErrors(d);
  if (has(ids.dob) && !V.dob(ids.dob)) e.dob = "Enter a valid date of birth (age 16 to 80).";
  if (has(ids.aadhaar) && !V.aadhaar(ids.aadhaar)) e.aadhaar = "Aadhaar number must be 12 digits.";
  if (has(ids.pan) && !V.pan(ids.pan)) e.pan = "PAN must look like ABCDE1234F.";
  if (has(ids.acct) && !V.acct(ids.acct)) e.acct = "Bank account number must be 9 to 18 digits.";
  if (has(ids.ifsc) && !V.ifsc(ids.ifsc)) e.ifsc = "IFSC must look like HDFC0001234.";
  if (!Array.isArray(apps)) e.apps = "Say whether this person needs Claude access.";   // an empty list is fine: no access needed for now
  return e;
}

// PAN and Aadhaar. A PAN is five letters, four digits and a letter. An Aadhaar is 12 digits whose last digit is a Verhoeff check digit, so a mistyped digit is caught.
const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
export const verhoeff = (s) => { let c = 0; [...String(s)].reverse().forEach((ch, i) => { c = VD[c][VP[i % 8][Number(ch)]]; }); return c === 0; };
export const cleanPan = (v) => String(v || "").replace(/\s+/g, "").toUpperCase();
export const validPan = (v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(cleanPan(v));
export const cleanAadhaar = (v) => String(v || "").replace(/\D/g, "");
export const validAadhaar = (v) => cleanAadhaar(v).length === 12 && verhoeff(cleanAadhaar(v));
export const formatAadhaar = (v) => cleanAadhaar(v).replace(/(\d{4})(?=\d)/g, "$1 ");
