/*
 * Offer letters and signing them (offers.js), as Keka's offer management and Keka Sign: HR prepares an offer, someone else approves
 * it, the candidate signs it through a private link by typing their name. Pure, tested without a database (test/offers.test.mjs).
 */
import crypto from "node:crypto";
const text = (v) => String(v == null ? "" : v).replace(/\r\n/g, "\n").trim();
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const SIGN_DAYS = 14;
export const STATUSES = ["pending_approval", "approved", "sent", "signed", "declined", "withdrawn", "returned"];

export function readOffer(b = {}, today) {
  const errors = {};
  const title = text(b.title).slice(0, 120), location = text(b.location).slice(0, 120), terms = text(b.terms).slice(0, 4000), joiningDate = text(b.joiningDate);
  const ctc = Number(String(b.ctc ?? "").replace(/[₹,\s]/g, ""));
  if (!title) errors.title = "Please enter the job title offered.";
  if (!Number.isFinite(ctc) || ctc <= 0 || ctc > 1e9) errors.ctc = "Please enter the yearly CTC in rupees.";
  if (!DAY.test(joiningDate)) errors.joiningDate = "Please choose the joining date.";
  else if (today && joiningDate < today) errors.joiningDate = "The joining date cannot be in the past.";
  return { value: { title, location, terms, joiningDate, ctc: Number.isFinite(ctc) ? Math.round(ctc) : 0 }, errors };
}

const inr = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const longDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
/** The words of the letter, fixed when it is sent: what the candidate signs, and what the fingerprint covers. */
export function offerText({ company, candidate, title, ctc, joiningDate, location, terms, expires }) {
  return [
    `Dear ${candidate},`,
    "",
    `We are pleased to offer you the position of ${title} at ${company}.`,
    "",
    `Your annual cost to company (CTC) will be ${inr(ctc)}, paid monthly as set out in your salary breakdown.`,
    `Your joining date will be ${longDay(joiningDate)}${location ? `, at ${location}` : ""}.`,
    "",
    ...(terms ? [terms, ""] : []),
    "This offer depends on the documents you share at joining being correct, and on our usual background checks.",
    "",
    `To accept, please sign this letter by ${longDay(expires)}. After that date the offer lapses.`,
    "",
    `We look forward to working with you.`,
    "",
    `For ${company}`,
  ].join("\n");
}

/** A private signing key: the link carries the key, the database keeps only its fingerprint. */
export function newSignKey() { const key = crypto.randomBytes(24).toString("base64url"); return { key, hash: hashKey(key) }; }
export const hashKey = (key) => crypto.createHash("sha256").update(String(key)).digest("hex");
export const fingerprint = (words) => crypto.createHash("sha256").update(String(words)).digest("hex");

/** Signing: the candidate types their full name (it must match the name on the letter, ignoring case and spaces) and accepts. */
export function readSignature(b = {}, expectedName) {
  const errors = {};
  const name = text(b.name).slice(0, 120);
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-zऀ-ॿ]+/g, "");
  if (!name) errors.name = "Please type your full name to sign.";
  else if (norm(name) !== norm(expectedName)) errors.name = `Please type your name as it appears on the letter: ${expectedName}.`;
  if (b.accept !== true) errors.accept = "Please confirm that you accept the offer.";
  return { value: { name }, errors };
}
