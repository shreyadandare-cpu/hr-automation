import express from "express";
import { pool } from "./db.js";
import { mailConfigured, sendMail } from "./mail.js";
import { mailSkipped } from "./notify.js";

/*
 * Festival Wishes: the list of festivals and when each next falls, for everyone who is signed in. The greeting images themselves
 * are drawn in the browser (frontend/src/modules/festivals), so nothing else is needed here. Festivals and their dates live in
 * the festivals and festival_dates tables, so a new year's dates (or a new festival) is a data change, not a release.
 */
export const festivalsRouter = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const ist = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const utc = (d) => Date.parse(`${d}T00:00:00Z`);
const daysBetween = (from, to) => Math.round((utc(to) - utc(from)) / 86400000);

festivalsRouter.get("/", wrap(async (_req, res) => {
  const today = ist();
  const { rows: fests } = await pool.query("SELECT slug, name, description, sort FROM festivals WHERE active ORDER BY sort, name");
  const { rows: dates } = await pool.query("SELECT slug, day FROM festival_dates WHERE day >= $1 ORDER BY day", [today]);
  const items = fests.map((f) => {
    const upcoming = dates.filter((d) => d.slug === f.slug).map((d) => d.day);
    const next = upcoming[0] || null;
    return { slug: f.slug, name: f.name, description: f.description, next, inDays: next ? daysBetween(today, next) : null, dates: upcoming.slice(0, 3) };
  });
  // the soonest first, festivals with no date left at the end
  items.sort((a, b) => (a.next && b.next ? a.next.localeCompare(b.next) : a.next ? -1 : b.next ? 1 : 0));
  res.json({ today, items });
}));

/*
 * Share by email: the signed-in person picks colleagues and the page sends them the greeting they made. The picture comes from the
 * page (a PNG), the people must be current employees (so this can't be used to email strangers from the company address), and
 * each person can send to 30 people an hour. The directors on the "no email" list are skipped, like every other email.
 */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_TO = 10, PER_HOUR = 30;
const recent = new Map();   // sender email -> times of their recent sends
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

festivalsRouter.post("/share", express.raw({ type: () => true, limit: 6 * 1024 * 1024 }), wrap(async (req, res) => {
  if (!mailConfigured()) return res.status(409).json({ error: "Email is not set up on this server yet, so the greeting can't be emailed. Use Download or Copy instead." });
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length < 1000 || !body.subarray(0, 8).equals(PNG)) return res.status(400).json({ error: "The greeting must be a PNG picture." });
  const { rows: [fest] } = await pool.query("SELECT name FROM festivals WHERE slug=$1 AND active", [String(req.query.slug || "")]);
  if (!fest) return res.status(400).json({ error: "Unknown festival." });
  const to = [...new Set(String(req.query.to || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!to.length) return res.status(400).json({ error: "Choose at least one person." });
  if (to.length > MAX_TO) return res.status(400).json({ error: `You can send to up to ${MAX_TO} people at a time.` });
  const { rows: people } = await pool.query(
    "SELECT lower(work_email) AS email, name FROM employees WHERE lower(work_email) = ANY($1) AND status <> 'offboarded' AND last_day IS NULL", [to]);
  const known = new Map(people.map((p) => [p.email, p.name]));
  const unknown = to.filter((e) => !known.has(e));
  if (unknown.length) return res.status(400).json({ error: `${unknown[0]} is not a current employee.` });
  const me = req.user.email.toLowerCase(), now = Date.now();
  const used = (recent.get(me) || []).filter((t) => now - t < 3600_000);
  if (used.length + to.length > PER_HOUR) return res.status(429).json({ error: "You have sent a lot of greetings in the last hour. Try again a little later." });
  recent.set(me, [...used, ...to.map(() => now)]);

  const { rows: [sender] } = await pool.query("SELECT name FROM employees WHERE lower(work_email)=$1", [me]);
  const from = sender ? sender.name : me.split("@")[0];
  const note = String(req.query.note || "").replace(/\s+/g, " ").trim().slice(0, 300);
  const subject = `${from} sent you a ${fest.name} greeting`;
  const skip = new Set(mailSkipped());
  const out = { sent: [], skipped: [], failed: [] };
  for (const email of to) {
    const first = known.get(email).split(" ")[0];
    const text = `Hello ${first},\n\n${from} sent you a ${fest.name} greeting from Wohlig.${note ? `\n\n"${note}"` : ""}\n\nThe greeting is attached.\n`;
    const html = `<div style="font:15px/1.6 Arial,Helvetica,sans-serif;color:#2a1016;max-width:560px;margin:0 auto"><p style="margin:0 0 14px">Hello ${esc(first)},</p>`
      + `<p style="margin:0 0 14px">${esc(from)} sent you a ${esc(fest.name)} greeting from Wohlig.</p>${note ? `<p style="margin:0 0 14px;font-style:italic">&ldquo;${esc(note)}&rdquo;</p>` : ""}`
      + `<p style="margin:0"><img src="cid:greeting" alt="${esc(fest.name)} greeting" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:6px"></p></div>`;
    if (skip.has(email)) {
      await pool.query("INSERT INTO email_outbox (recipient, subject, body, status) VALUES ($1,$2,$3,'skipped')", [email, subject, text]);
      out.skipped.push(email); continue;
    }
    try {
      await sendMail({ to: email, subject, text, html, attachments: [{ content: body, type: "image/png", filename: `${req.query.slug}-greeting.png`, cid: "greeting" }] });
      await pool.query("INSERT INTO email_outbox (recipient, subject, body, status) VALUES ($1,$2,$3,'sent')", [email, subject, text]);
      out.sent.push(email);
    } catch (err) {
      await pool.query("INSERT INTO email_outbox (recipient, subject, body, status, error) VALUES ($1,$2,$3,'failed',$4)", [email, subject, text, String(err.message).slice(0, 300)]);
      out.failed.push({ email, error: "Could not be delivered." });
    }
  }
  res.json(out);
}));
