/*
 * The careers page, applications and referrals (careers.js), as Keka Hire has them. Pure, tested without a database
 * (test/careers.test.mjs).
 */
const text = (v) => String(v == null ? "" : v).replace(/\r\n/g, "\n").trim();
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
export const JOB_KINDS = ["Full time", "Part time", "Internship", "Contract"];
export const RESUME_MAX = 5 * 1024 * 1024;

/** A CV is a PDF or a Word file (.docx), told apart by its first bytes, never by its name. */
export function resumeType(buf) {
  if (!buf || !buf.length) return null;
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf.subarray(0, Math.min(buf.length, 4096)).toString("latin1").includes("[Content_Types].xml") && buf.toString("latin1").includes("word/"))
    return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" };
  return null;
}

/** What HR publishes about a role on top of its title and description. */
export function readJobDetails(b = {}) {
  const errors = {};
  const location = text(b.location).slice(0, 80), experience = text(b.experience).slice(0, 60);
  const kind = JOB_KINDS.includes(b.kind) ? b.kind : JOB_KINDS[0];
  const isPublic = b.isPublic === true;
  return { location, experience, kind, isPublic, errors };
}

/** An application from the careers page, or a referral. `website` is a field people never see: a filled one is a bot. */
export function readApplication(b = {}, { referral = false } = {}) {
  const errors = {};
  const name = text(b.name).slice(0, 120), email = text(b.email).toLowerCase().slice(0, 200), phone = text(b.phone).slice(0, 30);
  const note = text(b.note).slice(0, 2000), link = text(b.link).slice(0, 300);
  if (!name) errors.name = referral ? "Please enter the person's name." : "Please enter your name.";
  if (!isEmail(email)) errors.email = referral ? "Please enter the person's email address." : "Please enter your email address.";
  if (phone && !/^[+\d][\d\s-]{6,}$/.test(phone)) errors.phone = "Please enter a valid phone number, or leave it empty.";
  if (link && !/^https?:\/\/\S+$/i.test(link)) errors.link = "Please enter a full link starting with https://, or leave it empty.";
  if (!referral && b.consent !== true) errors.consent = "Please agree that we may keep your details for this role.";
  const bot = !referral && text(b.website) !== "";
  return { value: { name, email, phone, note, link }, errors, bot };
}

/** What a person who referred someone may see of their progress: never the hiring team's notes or the exact stage. */
export const referralStatus = (stage) => (stage === "hired" ? "Hired" : stage === "rejected" ? "Not selected" : stage === "applied" ? "Received" : "In process");
