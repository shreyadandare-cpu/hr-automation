import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import { pool } from "./db.js";
import { V } from "./validate.js";
import { requireAuth } from "./auth.js";
import { UPLOAD_DIR } from "./documents.js";

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
    contact: { personalEmail: str(c.personalEmail, 120), phone: str(c.phone, 20) },
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
  return { data, errors };
}

export const profileRouter = express.Router();
profileRouter.use(requireAuth);

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const photoVersion = async (email) => {
  const { rows } = await pool.query("SELECT updated_at FROM profile_photos WHERE lower(email)=$1", [email.toLowerCase()]);
  return rows[0] ? new Date(rows[0].updated_at).getTime() : null;
};

profileRouter.get("/", wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM profiles WHERE lower(email)=$1", [req.user.email.toLowerCase()]);
  res.json({ ...(rows[0]?.data || {}), photoV: await photoVersion(req.user.email) });
}));

profileRouter.put("/", wrap(async (req, res) => {
  const { data, errors } = cleanProfile(req.body || {});
  // A personal email belongs to one person: not a colleague's from onboarding, and not one saved on another profile.
  const mine = req.user.email.toLowerCase(), pe = data.contact.personalEmail.toLowerCase();
  if (pe && /@wohlig\.com$/.test(pe)) errors["contact.personalEmail"] = "Use a personal email, not a @wohlig.com address.";
  else if (pe) {
    const a = await pool.query("SELECT name FROM employees WHERE lower(personal_email)=$1 AND lower(work_email)<>$2 LIMIT 1", [pe, mine]);
    const b = await pool.query("SELECT email FROM profiles WHERE lower(data->'contact'->>'personalEmail')=$1 AND lower(email)<>$2 LIMIT 1", [pe, mine]);
    if (a.rows[0] || b.rows[0]) errors["contact.personalEmail"] = "That email already belongs to someone else. Use a different one.";
  }
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  await pool.query(
    `INSERT INTO profiles (email, data) VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET data=$2, updated_at=now()`, [req.user.email.toLowerCase(), data]);
  res.json({ ...data, photoV: await photoVersion(req.user.email) });
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
  res.set({ "Content-Type": rows[0].mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=0, must-revalidate" });
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
