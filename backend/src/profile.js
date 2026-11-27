import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import { pool } from "./db.js";
import { V, emergencyCheck } from "./validate.js";
import { requireAuth } from "./auth.js";
import { UPLOAD_DIR } from "./documents.js";
import { personalEmailTaken, updatePerson, updateProfile } from "./sealed-rows.js";

/* "My profile": the personal sections a person fills in about themselves. Everyone edits only their own. */
const ENUMS = {
  gender: ["", "Female", "Male", "Other", "Prefer not to say"],
  marital: ["", "Single", "Married", "Divorced", "Widowed"],
  blood: ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
  handicapped: ["", "No", "Yes"],
};
const str = (v, max) => String(v ?? "").trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + "T00:00:00"));

function cleanAddress(a = {}, path, errors) {
  const out = { line: str(a.line, 300), city: str(a.city, 80), state: str(a.state, 80), country: str(a.country, 80), pin: str(a.pin, 10) };
  if (out.pin && !/^[A-Za-z0-9 -]{3,10}$/.test(out.pin)) errors[`${path}.pin`] = "Enter a valid PIN code.";
  return out;
}

/** A LinkedIn profile link: only linkedin.com/in/<name>. Adds https:// when it is missing, drops anything after the name, returns "" for an empty value. */
function cleanLinkedin(v, errors) {
  let s = str(v, 200);
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { u = null; }
  const m = u && /^(?:[a-z0-9-]+\.)?linkedin\.com$/i.test(u.hostname) && u.pathname.match(/^\/in\/([^/?#\s]{2,100})\/?/i);
  if (!m) { errors["contact.linkedin"] = "Enter your LinkedIn profile link, like https://www.linkedin.com/in/your-name"; return s; }
  return `https://www.linkedin.com/in/${m[1]}`;
}

/** Emergency contacts on My profile, checked by emergencyCheck (validate.js) and reported under the profile's own field names. */
export function emergencyErrors(c, errors, needFirst, ownPhone = "") {
  const out = emergencyCheck([{ name: c.emergencyName, relation: c.emergencyRelation, phone: c.emergencyPhone }, { name: c.emergency2Name, relation: c.emergency2Relation, phone: c.emergency2Phone }], ownPhone || c.phone, needFirst);
  out.forEach((x, i) => { const k = i ? "emergency2" : "emergency"; for (const [f, F] of [["name", "Name"], ["relation", "Relation"], ["phone", "Phone"]]) if (x[f]) errors[`contact.${k}${F}`] = x[f].replace("the candidate's own", "your own").replace("the candidate", "you"); });
}

/** Keeps only the known fields, trims and limits them, and returns { data, errors }. */
export function cleanProfile(input = {}) {
  const errors = {};
  const p = input.primary || {}, c = input.contact || {}, a = input.addresses || {};
  const data = {
    about: str(input.about, 1000), loveJob: str(input.loveJob, 1000), hobbies: str(input.hobbies, 1000),
    primary: {
      first: str(p.first, 60), middle: str(p.middle, 60), last: str(p.last, 60),
      gender: str(p.gender, 30), dob: str(p.dob, 10), marital: str(p.marital, 30), blood: str(p.blood, 5),
      handicapped: str(p.handicapped, 5), nationality: str(p.nationality, 60),
    },
    contact: { personalEmail: str(c.personalEmail, 120), phone: str(c.phone, 20), linkedin: cleanLinkedin(c.linkedin, errors),
      emergencyName: str(c.emergencyName, 80), emergencyRelation: str(c.emergencyRelation, 40), emergencyPhone: str(c.emergencyPhone, 20),
      emergency2Name: str(c.emergency2Name, 80), emergency2Relation: str(c.emergency2Relation, 40), emergency2Phone: str(c.emergency2Phone, 20) },
    addresses: { current: cleanAddress(a.current, "addresses.current", errors), permanent: cleanAddress(a.permanent, "addresses.permanent", errors) },
    education: (Array.isArray(input.education) ? input.education : []).slice(0, 10).map((x = {}, i) => {
      const e = { degree: str(x.degree, 100), branch: str(x.branch, 100), college: str(x.college, 150),
        cgpa: str(x.cgpa, 10), joining: str(x.joining, 10), completion: str(x.completion, 10) };
      if (e.cgpa && !/^\d{1,3}(\.\d{1,2})?%?$/.test(e.cgpa)) errors[`education.${i}.cgpa`] = "Enter a number like 8.5 or 85%.";
      for (const k of ["joining", "completion"]) if (e[k] && !isDate(e[k])) errors[`education.${i}.${k}`] = "Enter a valid date.";
      return e;
    }),
  };
  for (const k of Object.keys(ENUMS)) if (!ENUMS[k].includes(data.primary[k])) errors[`primary.${k}`] = "Pick one of the options.";
  if (data.primary.dob && !V.dob(data.primary.dob)) errors["primary.dob"] = "Enter a valid date of birth (age 16 to 80).";
  if (data.contact.personalEmail && !V.email(data.contact.personalEmail)) errors["contact.personalEmail"] = "Enter a valid email.";
  if (data.contact.phone && !V.phone(data.contact.phone)) errors["contact.phone"] = "Enter a 10-digit mobile number.";
  emergencyErrors(data.contact, errors, input.requireEmergency === true);
  return { data, errors };
}

/**
 * What a saved profile writes onto the employee record, so the rest of Wohlig One (Employees, the employee page, letters, payroll lists, the ID card)
 * shows the same details the person just entered: personal email, mobile number, date of birth and the current address as one line. Only fields the
 * person filled in are written, so saving a profile never blanks something HR entered. The name is not copied: it is HR's, because payroll, the
 * bank file and reporting lines use it.
 */
export function employeeFieldsFrom(data) {
  const out = {};
  const c = data.contact || {}, p = data.primary || {}, cur = (data.addresses || {}).current || {};
  if (c.personalEmail) out.personal_email = c.personalEmail;
  if (c.phone) out.phone = c.phone;
  if (p.dob && isDate(p.dob)) out.dob = p.dob;
  const line = [cur.line, cur.city, cur.state, cur.pin, cur.country].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
  if (line) out.address = line;
  return out;
}

export const profileRouter = express.Router();
profileRouter.use(requireAuth);

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** The date of birth on the employee record (entered at onboarding or imported), as YYYY-MM-DD, or "". It is used when the profile has none of its own. */
const ownDob = async (email) => {
  const { rows } = await pool.query("SELECT dob, person_sealed FROM employees WHERE lower(work_email)=$1", [email.toLowerCase()]);
  return rows[0] && rows[0].dob ? String(rows[0].dob).slice(0, 10) : "";
};

/** The masked PAN and Aadhaar on the employee record. Shown on the person's own profile, read only: the app never keeps the full numbers, and HR corrects them. */
const ownIds = async (email) => {
  const { rows } = await pool.query("SELECT pan_masked, aadhaar_masked, person_sealed FROM employees WHERE lower(work_email)=$1", [email.toLowerCase()]);
  return { pan: (rows[0] && rows[0].pan_masked) || "", aadhaar: (rows[0] && rows[0].aadhaar_masked) || "" };
};

const photoVersion = async (email) => {
  const { rows } = await pool.query("SELECT updated_at FROM profile_photos WHERE lower(email)=$1", [email.toLowerCase()]);
  return rows[0] ? new Date(rows[0].updated_at).getTime() : null;
};

profileRouter.get("/", wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT data, profile_sealed FROM profiles WHERE lower(email)=$1", [req.user.email.toLowerCase()]);
  res.json({ ...(rows[0]?.data || {}), photoV: await photoVersion(req.user.email), employeeDob: await ownDob(req.user.email), ids: await ownIds(req.user.email) });
}));

profileRouter.put("/", wrap(async (req, res) => {
  const { data, errors } = cleanProfile(req.body || {});
  // A personal email belongs to one person: not a colleague's from onboarding, and not one saved on another profile.
  const mine = req.user.email.toLowerCase(), pe = data.contact.personalEmail.toLowerCase();
  if (pe && /@wohlig\.com$/.test(pe)) errors["contact.personalEmail"] = "Use a personal email, not a @wohlig.com address.";
  else if (pe && await personalEmailTaken(pool, pe, mine, { profiles: true })) errors["contact.personalEmail"] = "That email already belongs to someone else. Use a different one.";
  if (data.contact.emergencyPhone || data.contact.emergency2Phone) {
    const own = (await pool.query("SELECT phone, person_sealed FROM employees WHERE lower(work_email)=$1", [mine])).rows[0]?.phone;
    const again = {};
    emergencyErrors(data.contact, again, false, own);
    for (const [k, v] of Object.entries(again)) if (!errors[k] && /own number/.test(v)) errors[k] = v;
  }
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  // Both are stored encrypted (secret-box.js).
  await updateProfile(pool, mine, () => data);
  // The same details go onto the employee record, so the rest of Wohlig One shows what was just entered (see employeeFieldsFrom).
  const shared = employeeFieldsFrom(data), cols = Object.keys(shared);
  if (cols.length) {
    await updatePerson(pool, mine, shared);
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Profile saved: ${cols.map((k) => k.replace("_", " ")).join(", ")} updated on the employee record`, mine]);
  }
  res.json({ ...data, photoV: await photoVersion(req.user.email), employeeDob: await ownDob(req.user.email), ids: await ownIds(req.user.email) });
}));

/* Profile photo: one picture per person. The page crops it square before sending, so it is small. */
const MAX_PHOTO = 1024 * 1024;
const sniffImage = (b) =>
  b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? { mime: "image/jpeg", ext: "jpg" }
  : b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? { mime: "image/png", ext: "png" }
  : null;

profileRouter.put("/photo", express.raw({ type: () => true, limit: MAX_PHOTO }), wrap(async (req, res) => {
  const body = req.body;
  if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: "The picture is empty." });
  const type = sniffImage(body);
  if (!type) return res.status(400).json({ error: "Only JPG or PNG pictures are allowed." });
  const email = req.user.email.toLowerCase();
  const stored = `photo-${crypto.randomUUID()}.${type.ext}`;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, stored), body);
  const old = await pool.query("SELECT stored_name FROM profile_photos WHERE lower(email)=$1", [email]);
  await pool.query(
    `INSERT INTO profile_photos (email, stored_name, mime) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET stored_name=$2, mime=$3, updated_at=now()`, [email, stored, type.mime]);
  if (old.rows[0]) await fs.rm(path.join(UPLOAD_DIR, old.rows[0].stored_name), { force: true });
  res.json({ photoV: await photoVersion(email) });
}));

// Who has a photo, as { email: version }, so pages showing many people only ask for the photos that exist.
profileRouter.get("/photos", wrap(async (_req, res) => {
  const { rows } = await pool.query("SELECT lower(email) AS email, updated_at FROM profile_photos");
  res.json(Object.fromEntries(rows.map((r) => [r.email, new Date(r.updated_at).getTime()])));
}));

// Anyone signed in can see anyone's photo, like the names and job titles on the Employees page. ?email= picks the person.
profileRouter.get("/photo", wrap(async (req, res) => {
  const email = String(req.query.email || req.user.email).toLowerCase();
  const { rows } = await pool.query("SELECT stored_name, mime FROM profile_photos WHERE lower(email)=$1", [email]);
  if (!rows[0]) return res.status(404).json({ error: "No photo" });
  // Pages ask for /photo?…&v=<version>; a new photo gets a new version, so a versioned address can be kept for a year and every
  // avatar on a page full of people comes from the browser's cache. Without v, the browser checks each time.
  const versioned = typeof req.query.v === "string" && /^\d{1,15}$/.test(req.query.v);
  res.set({ "Content-Type": rows[0].mime, "X-Content-Type-Options": "nosniff", "Cache-Control": versioned ? "private, max-age=31536000, immutable" : "private, max-age=0, must-revalidate" });
  res.sendFile(path.join(UPLOAD_DIR, rows[0].stored_name));
}));

profileRouter.delete("/photo", wrap(async (req, res) => {
  const { rows } = await pool.query("DELETE FROM profile_photos WHERE lower(email)=$1 RETURNING stored_name", [req.user.email.toLowerCase()]);
  if (rows[0]) await fs.rm(path.join(UPLOAD_DIR, rows[0].stored_name), { force: true });
  res.json({ ok: true });
}));

// Oversized pictures get a readable error instead of the default HTML page.
profileRouter.use((err, _req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "The picture is larger than 1 MB." });
  next(err);
});
