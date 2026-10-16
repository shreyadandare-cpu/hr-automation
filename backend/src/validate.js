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
  if (!Array.isArray(apps) || !apps.length) e.apps = "Pick at least one tool to give.";
  return e;
}
