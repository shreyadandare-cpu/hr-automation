import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { pool } from "./db.js";
import { UPLOAD_DIR } from "./documents.js";
import { mailConfigured, sendMail } from "./mail.js";
import { mailSkipped, notify } from "./notify.js";

/*
 * Celebrations: birthday and welcome posters. HR picks the person (birthdays come from the date of birth on file, new joiners
 * from the start date), the page draws the poster and uploads it, and HR sends it to every active employee by email.
 *
 *   Draft     created when HR reaches the preview: the details and the poster picture. Nothing is emailed.
 *   Sending   the first send fixes the recipient list (everyone active) and emails them in the background, a few at a time.
 *   Retry     emails only the people the poster has not reached; nobody who already got it gets it twice.
 *   Once      a person gets one birthday poster a year and one welcome poster ever (unique index on celebrations).
 *   Daily     a background check tells HR (the bell) about a birthday today or a new joiner; it never sends anything itself.
 * HR only. The poster is a PNG made by the page, so what HR previews is exactly what is emailed.
 */
const TEMPLATES = { birthday: "birthday-classic", welcome: "welcome-blue" };
const NEW_JOINER_DAYS = 30, UPCOMING_DAYS = 30, CONCURRENCY = 5, MAX_POSTER = 8 * 1024 * 1024, STALE_SENDING_MIN = 10;
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const me = (req) => req.user.email.toLowerCase();
const idOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + "T00:00:00Z"));
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ist = (d = new Date()) => new Date(d.getTime() + 330 * 60000);   // India time, read with getUTC*
const today = () => ist().toISOString().slice(0, 10);
const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const keyFor = (occasion, day = today()) => (occasion === "birthday" ? `birthday:${day.slice(0, 4)}` : "welcome");
/** When the birthday next falls (today included). 29 Feb is kept on 28 Feb in other years. */
function nextBirthday(dob, from) {
  const y = Number(from.slice(0, 4)), md = dob.slice(5, 10);
  const on = (yy) => (md === "02-29" && (yy % 4 !== 0 || (yy % 100 === 0 && yy % 400 !== 0)) ? `${yy}-02-28` : `${yy}-${md}`);
  return on(y) >= from ? on(y) : on(y + 1);
}

/** Everyone who is still with the company, with the details a poster needs. */
async function activeEmployees(db = pool) {
  const { rows } = await db.query(
    `SELECT e.work_email AS email, e.name, e.title, e.dept, e.employment_type, e.start_date,
            COALESCE(NULLIF(p.data->'primary'->>'dob', ''), e.dob::text) AS dob,
            (SELECT extract(epoch FROM ph.updated_at)::bigint FROM profile_photos ph WHERE lower(ph.email) = lower(e.work_email)) AS photo_v
     FROM employees e LEFT JOIN profiles p ON lower(p.email) = lower(e.work_email)
     WHERE e.status <> 'offboarded' AND e.last_day IS NULL ORDER BY e.name`);
  return rows;
}
const person = (e, extra = {}) => ({ email: e.email, name: e.name, title: e.title || "", dept: e.dept || "", employmentType: e.employment_type || "Employee",
  start: e.start_date || "", photoV: e.photo_v || null, ...extra });

/** Posters already sent for these keys, as a map "email|key" -> id. */
async function sentMap() {
  const { rows } = await pool.query("SELECT id, lower(employee_email) AS email, occasion_key FROM celebrations WHERE status <> 'draft'");
  return new Map(rows.map((r) => [`${r.email}|${r.occasion_key}`, r.id]));
}

/** Today's and upcoming birthdays and recent joiners, each marked with whether a poster already went out. */
export async function candidates() {
  const day = today(), sent = await sentMap(), staff = await activeEmployees();
  const bKey = keyFor("birthday", day);
  const birthdays = staff.filter((e) => /^\d{4}-\d{2}-\d{2}/.test(e.dob || "")).map((e) => ({ e, date: nextBirthday(e.dob, day) }))
    .filter((b) => b.date <= addDays(day, UPCOMING_DAYS)).sort((a, b) => a.date.localeCompare(b.date) || a.e.name.localeCompare(b.e.name))
    .map(({ e, date }) => person(e, { date, announced: sent.get(`${e.email.toLowerCase()}|${bKey}`) || null }));
  const since = addDays(day, -NEW_JOINER_DAYS);
  const joiners = staff.filter((e) => e.start_date && e.start_date >= since && e.start_date <= day)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
    .map((e) => person(e, { announced: sent.get(`${e.email.toLowerCase()}|welcome`) || null }));
  const all = staff.map((e) => person(e, {
    birthdayAnnounced: sent.get(`${e.email.toLowerCase()}|${bKey}`) || null, welcomeAnnounced: sent.get(`${e.email.toLowerCase()}|welcome`) || null }));
  return { today: day, birthdaysToday: birthdays.filter((b) => b.date === day), upcoming: birthdays.filter((b) => b.date !== day), joiners, all };
}

/* ---------- the email ---------- */
function mailFor(c) {
  const first = c.employee_name.split(" ")[0];
  const birthday = c.occasion === "birthday";
  const subject = birthday ? `Happy Birthday, ${c.employee_name}! 🎂` : `Welcome to Wohlig, ${c.employee_name}! 🎉`;
  const line = birthday
    ? `Today is ${first}'s birthday. Please join us in wishing ${first} a very happy birthday!`
    : `We are delighted to welcome ${c.employee_name}${c.designation ? ` to the team as our new ${c.designation}` : " to the team"}. Please join us in giving ${first} a warm welcome!`;
  const text = `Hello team,\n\n${line}\n\nWith warm wishes,\nWOHLIG TRANSFORMATIONS PRIVATE LIMITED\n`;
  const html = `<div style="font:15px/1.6 Arial,Helvetica,sans-serif;color:#2a1016;max-width:560px;margin:0 auto">`
    + `<p style="margin:0 0 14px">Hello team,</p><p style="margin:0 0 18px">${esc(line)}</p>`
    + `<p style="margin:0 0 18px"><img src="cid:poster" alt="${esc(subject)}" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:6px"></p>`
    + `<p style="margin:0">With warm wishes,<br><b>WOHLIG TRANSFORMATIONS PRIVATE LIMITED</b></p></div>`;
  return { subject, text, html };
}

/* ---------- sending ---------- */
/** Emails everyone the poster has not reached yet. Runs in the background; progress is read from celebration_recipients. */
async function deliver(id) {
  try {
    const { rows: [c] } = await pool.query("SELECT * FROM celebrations WHERE id=$1", [id]);
    if (!c) return;
    const poster = await fs.readFile(path.join(UPLOAD_DIR, c.poster_file));
    const skip = new Set(mailSkipped());
    const { rowCount: have } = await pool.query("SELECT 1 FROM celebration_recipients WHERE celebration_id=$1 LIMIT 1", [id]);
    if (!have) {   // the first send fixes the list
      for (const e of await activeEmployees()) {
        await pool.query(
          "INSERT INTO celebration_recipients (celebration_id, email, name, status, error) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
          [id, e.email, e.name, skip.has(e.email.toLowerCase()) ? "skipped" : "pending", skip.has(e.email.toLowerCase()) ? "No email is sent to the directors." : null]);
      }
    }
    const { rows: todo } = await pool.query("SELECT email FROM celebration_recipients WHERE celebration_id=$1 AND status='pending' ORDER BY email", [id]);
    const mail = mailFor(c);
    const attachments = [{ content: poster, type: "image/png", filename: `${c.occasion}-${c.employee_name.replace(/[^A-Za-z0-9]+/g, "-")}.png`, cid: "poster" }];
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const { email } = todo[next++];
        try {
          await sendMail({ to: email, ...mail, attachments });
          await pool.query("UPDATE celebration_recipients SET status='sent', error=NULL, sent_at=now() WHERE celebration_id=$1 AND email=$2", [id, email]);
        } catch (err) {
          await pool.query("UPDATE celebration_recipients SET status='failed', error=$3 WHERE celebration_id=$1 AND email=$2", [id, email, String(err.message).slice(0, 300)]);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
    const { rows: [n] } = await pool.query(
      `SELECT count(*) FILTER (WHERE status='sent')::int AS sent, count(*) FILTER (WHERE status IN ('failed','pending'))::int AS bad
       FROM celebration_recipients WHERE celebration_id=$1`, [id]);
    const status = n.bad ? (n.sent ? "partial" : "failed") : "sent";
    await pool.query("UPDATE celebrations SET status=$2, sent_at=CASE WHEN $2 = 'failed' THEN sent_at ELSE now() END WHERE id=$1", [id, status]);
    await notify(c.created_by, {
      title: status === "sent" ? `${c.employee_name}'s poster was sent` : `${c.employee_name}'s poster: ${n.bad} email${n.bad === 1 ? "" : "s"} not delivered`,
      body: status === "sent" ? `Delivered to ${n.sent} people.` : "Open Celebrations to retry the ones that failed.", link: "/app/celebrations" });
  } catch (err) {
    console.error("Celebration send failed:", err);
    await pool.query("UPDATE celebrations SET status='failed' WHERE id=$1 AND status='sending'", [id]).catch(() => {});
  }
}

/** Marks a poster as being sent, or says why it can't be (already sent to this person, nothing to retry...). */
async function claim(id, retry) {
  const ok = retry
    ? `status IN ('partial','failed') OR (status='sending' AND send_started_at < now() - interval '${STALE_SENDING_MIN} minutes')`
    : "status = 'draft'";
  try {
    const { rows } = await pool.query(`UPDATE celebrations SET status='sending', send_started_at=now() WHERE id=$1 AND poster_file IS NOT NULL AND (${ok}) RETURNING id`, [id]);
    return rows.length ? null : { code: 409, error: retry ? "Nothing to retry for this poster right now." : "This poster has already been sent, or its picture was not saved." };
  } catch (err) {
    if (err.code === "23505") return { code: 409, error: "A poster for this person and occasion has already been sent." };
    throw err;
  }
}

/* ---------- the daily check ---------- */
/** Tells HR (the bell) about birthdays today and new joiners that have no poster yet. Once per person; never sends anything. */
export async function runCelebrationAlerts() {
  const c = await candidates(), told = [];
  const once = async (e, key) => (await pool.query(
    "INSERT INTO celebration_alerts (employee_email, alert_key) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1", [e.email.toLowerCase(), key])).rowCount > 0;
  for (const b of c.birthdaysToday.filter((x) => !x.announced)) {
    if (await once(b, `birthday:${c.today}`)) { told.push(b.name); await notify("hr", { title: `Today is ${b.name}'s birthday`, body: "Create the birthday poster and send it to everyone.", link: "/app/celebrations" }); }
  }
  for (const j of c.joiners.filter((x) => !x.announced)) {
    if (await once(j, "welcome")) { told.push(j.name); await notify("hr", { title: `${j.name} joined: welcome poster ready to create`, body: j.title || "", link: "/app/celebrations" }); }
  }
  return { told };
}

/* ---------- routes ---------- */
export const celebrationsRouter = express.Router();
const forbid = (res, r) => res.status(r.code).json({ error: r.error });

const counts = async (id) => {
  const { rows: [n] } = await pool.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE status='sent')::int AS sent, count(*) FILTER (WHERE status='failed')::int AS failed,
            count(*) FILTER (WHERE status='pending')::int AS pending, count(*) FILTER (WHERE status='skipped')::int AS skipped
     FROM celebration_recipients WHERE celebration_id=$1`, [id]);
  return n;
};
const shape = (c, n) => ({ id: c.id, occasion: c.occasion, status: c.status, employee: { email: c.employee_email, name: c.employee_name }, template: c.template,
  heading: c.heading || "", designation: c.designation || "", joiningDate: c.joining_date || "", message: c.message || "", hasPoster: !!c.poster_file,
  createdBy: c.created_by, createdAt: c.created_at, sentAt: c.sent_at, counts: n });

// Everything the Celebrations page shows, and what the recipients will be.
celebrationsRouter.get("/overview", wrap(async (_req, res) => {
  const c = await candidates();
  res.json({ today: c.today, birthdaysToday: c.birthdaysToday, upcoming: c.upcoming, joiners: c.joiners, employees: c.all,
    recipients: c.all.length - c.all.filter((e) => mailSkipped().includes(e.email.toLowerCase())).length, mailReady: mailConfigured() });
}));

celebrationsRouter.get("/recipients", wrap(async (_req, res) => {
  const skip = new Set(mailSkipped());
  res.json({ people: (await activeEmployees()).map((e) => ({ email: e.email, name: e.name, skipped: skip.has(e.email.toLowerCase()) })) });
}));

celebrationsRouter.get("/", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*, count(r.*)::int AS total, count(r.*) FILTER (WHERE r.status='sent')::int AS sent, count(r.*) FILTER (WHERE r.status='failed')::int AS failed,
            count(r.*) FILTER (WHERE r.status='pending')::int AS pending, count(r.*) FILTER (WHERE r.status='skipped')::int AS skipped
     FROM celebrations c LEFT JOIN celebration_recipients r ON r.celebration_id = c.id
     WHERE c.status <> 'draft' GROUP BY c.id ORDER BY c.id DESC LIMIT 100`);
  res.json({ items: rows.map((c) => shape(c, { total: c.total, sent: c.sent, failed: c.failed, pending: c.pending, skipped: c.skipped })) });
}));

/** Title, names and message from the request, with any problems. */
async function readDraft(b) {
  const occasion = b.occasion === "birthday" || b.occasion === "welcome" ? b.occasion : null;
  if (!occasion) return { error: "Choose birthday or welcome." };
  const { rows: [emp] } = await pool.query("SELECT work_email, name, title, start_date FROM employees WHERE lower(work_email)=lower($1) AND status <> 'offboarded' AND last_day IS NULL", [String(b.email || "")]);
  if (!emp) return { error: "That person is not a current employee." };
  const d = { occasion, email: emp.work_email, template: TEMPLATES[occasion], heading: str(b.heading, 60), name: str(b.name, 80) || emp.name,
    designation: str(b.designation, 80), joiningDate: str(b.joiningDate, 10), message: str(b.message, 300) };
  if (!d.heading) return { error: "The heading can't be empty." };
  if (!d.message) return { error: "The message can't be empty." };
  if (occasion === "welcome") {
    if (!d.joiningDate || !isDate(d.joiningDate)) return { error: "Enter a valid joining date." };
  } else d.joiningDate = null;
  return { d };
}
const dupe = async (d, exceptId = 0) => {
  const { rows } = await pool.query("SELECT id FROM celebrations WHERE lower(employee_email)=lower($1) AND occasion_key=$2 AND status <> 'draft' AND id <> $3", [d.email, keyFor(d.occasion), exceptId]);
  return rows[0] ? `A ${d.occasion} poster for ${d.name} has already been sent${d.occasion === "birthday" ? " this year" : ""}.` : null;
};

celebrationsRouter.post("/", wrap(async (req, res) => {
  const { d, error } = await readDraft(req.body || {});
  if (error) return res.status(400).json({ error });
  const msg = await dupe(d);
  if (msg) return res.status(409).json({ error: msg });
  const { rows: [c] } = await pool.query(
    `INSERT INTO celebrations (occasion, occasion_key, employee_email, employee_name, template, heading, designation, joining_date, message, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [d.occasion, keyFor(d.occasion), d.email, d.name, d.template, d.heading, d.designation, d.joiningDate, d.message, me(req)]);
  res.status(201).json({ id: c.id });
}));

const loadDraft = async (req, res) => {
  const id = idOf(req.params.id);
  const { rows: [c] } = id ? await pool.query("SELECT * FROM celebrations WHERE id=$1", [id]) : { rows: [] };
  if (!c) { res.status(404).json({ error: "Poster not found." }); return null; }
  return c;
};

celebrationsRouter.put("/:id", wrap(async (req, res) => {
  const c = await loadDraft(req, res); if (!c) return;
  if (c.status !== "draft") return res.status(409).json({ error: "This poster has been sent and can no longer be edited." });
  const { d, error } = await readDraft({ ...(req.body || {}), occasion: c.occasion, email: c.employee_email });
  if (error) return res.status(400).json({ error });
  await pool.query("UPDATE celebrations SET employee_name=$2, heading=$3, designation=$4, joining_date=$5, message=$6 WHERE id=$1", [c.id, d.name, d.heading, d.designation, d.joiningDate, d.message]);
  res.json({ ok: true });
}));

celebrationsRouter.put("/:id/poster", express.raw({ type: () => true, limit: MAX_POSTER }), wrap(async (req, res) => {
  const c = await loadDraft(req, res); if (!c) return;
  if (c.status !== "draft") return res.status(409).json({ error: "This poster has been sent and can no longer be changed." });
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length < 1000 || !body.subarray(0, 8).equals(PNG)) return res.status(400).json({ error: "The poster must be a PNG picture." });
  const stored = `celebration-${crypto.randomUUID()}.png`;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, stored), body);
  await pool.query("UPDATE celebrations SET poster_file=$2 WHERE id=$1", [c.id, stored]);
  if (c.poster_file) await fs.rm(path.join(UPLOAD_DIR, c.poster_file), { force: true });
  res.json({ ok: true });
}));

celebrationsRouter.get("/:id/poster", wrap(async (req, res) => {
  const c = await loadDraft(req, res); if (!c) return;
  if (!c.poster_file) return res.status(404).json({ error: "No poster yet." });
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.sendFile(path.join(UPLOAD_DIR, c.poster_file));
}));

// One poster with its delivery progress, and who it failed for.
celebrationsRouter.get("/:id", wrap(async (req, res) => {
  const c = await loadDraft(req, res); if (!c) return;
  const { rows } = await pool.query("SELECT email, name, status, error FROM celebration_recipients WHERE celebration_id=$1 AND status IN ('failed','pending') ORDER BY email LIMIT 200", [c.id]);
  res.json({ ...shape(c, await counts(c.id)), problems: rows });
}));

celebrationsRouter.post("/:id/send", wrap(async (req, res) => {
  const c = await loadDraft(req, res); if (!c) return;
  if (!mailConfigured()) return res.status(409).json({ error: "Email is not set up yet. Add SENDGRID_API_KEY and MAIL_FROM to the backend settings, then try again." });
  const bad = await claim(c.id, false);
  if (bad) return forbid(res, bad);
  deliver(c.id);   // in the background; the page watches GET /:id
  res.status(202).json({ status: "sending" });
}));

celebrationsRouter.post("/:id/retry", wrap(async (req, res) => {
  const c = await loadDraft(req, res); if (!c) return;
  if (!mailConfigured()) return res.status(409).json({ error: "Email is not set up yet. Add SENDGRID_API_KEY and MAIL_FROM to the backend settings, then try again." });
  const bad = await claim(c.id, true);
  if (bad) return forbid(res, bad);
  await pool.query("UPDATE celebration_recipients SET status='pending', error=NULL WHERE celebration_id=$1 AND status='failed'", [c.id]);
  deliver(c.id);
  res.status(202).json({ status: "sending" });
}));
