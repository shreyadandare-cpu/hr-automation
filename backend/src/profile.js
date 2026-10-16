import express from "express";
import { pool } from "./db.js";
import { V } from "./validate.js";
import { requireAuth } from "./auth.js";

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

profileRouter.get("/", wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM profiles WHERE lower(email)=$1", [req.user.email.toLowerCase()]);
  res.json(rows[0]?.data || {});
}));

profileRouter.put("/", wrap(async (req, res) => {
  const { data, errors } = cleanProfile(req.body || {});
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  await pool.query(
    `INSERT INTO profiles (email, data) VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET data=$2, updated_at=now()`, [req.user.email.toLowerCase(), data]);
  res.json(data);
}));
