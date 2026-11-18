import crypto from "node:crypto";
import { geminiConfigured, suggestHeadlines } from "./gemini.js";
import fs from "node:fs/promises";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { pool } from "./db.js";
import { UPLOAD_DIR } from "./documents.js";
import { requireHr } from "./auth.js";

/*
 * Digital Kit: every employee's personalised resources (email signature, business card, call backgrounds, LinkedIn kit)
 * and the company's shared ones (ready-to-use text, templates, downloads).
 *
 *   Personal   drawn by the page from the person's own record, so nothing personal is stored except a few optional overrides
 *              in digital_kits (HR can set a designation, phone, location or LinkedIn headline used instead of the record's).
 *   Shared     digital_kit_resources, managed by HR. They are read live, so an update reaches everyone at once.
 *   Everyone   a digital_kits row exists for every employee: created for existing staff by initDigitalKits (idempotent, run at start
 *              and by scripts/init-digital-kits.mjs), when onboarding completes, and the first time someone opens the page.
 * An employee only ever reaches their own kit: the person is taken from the session, never from the request.
 */
const MODULES = ["text", "template", "download", "background", "linkedin", "card"];
const MAX_FILE = 25 * 1024 * 1024;
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const str = (v, max) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
const line = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const idOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const audit = (db, action, email) => db.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]);

/* ---------- the kit record for each employee ---------- */

/** Creates the employee's kit if it is missing. Safe to call any number of times. */
export async function ensureKit(db, employeeId, source = "migration") {
  await db.query("INSERT INTO digital_kits (employee_id, source) VALUES ($1,$2) ON CONFLICT (employee_id) DO NOTHING", [employeeId, source]);
}

/** Gives every current employee a kit. Existing kits, employees and logins are left exactly as they are. Returns how many were created. */
export async function initDigitalKits(db = pool) {
  const r = await db.query(
    `INSERT INTO digital_kits (employee_id, source)
     SELECT e.id, 'migration' FROM employees e WHERE e.status <> 'offboarded'
     ON CONFLICT (employee_id) DO NOTHING`);
  return r.rowCount;
}

/* ---------- starter content (once; HR owns it afterwards) ---------- */
const TEXTS = [
  ["", "One-line pitch", "One sentence about you and Wohlig.",
`I'm {{name}}, {{title}} at Wohlig, the Google Cloud Premier Partner that India's boldest enterprises call when AI agents, automation and data need to simply work.`],
  ["", "About Wohlig", "The company in a short paragraph.",
`Wohlig is the Google Cloud Premier Partner India's boldest enterprises call when AI agents, automation and data need to simply work, minus the drama, the jargon and the heavy lifting.

We run majorly AI-driven ourselves. Our delivery is built on an AI-native operating model, so our processes run on AI and your project runs on time. It is not a slogan, just how a lean team ships 10+ published AI transformations, 50+ cloud migrations and 40+ active Google Cloud certifications without the usual consulting overhead.

wohlig is German for snug, comfortable, at ease. It's the feeling enterprise technology should give you, not another vendor relationship to manage.

Let's talk: wohlig.com`],
  ["", "Intro email", "A first note to someone you have not met.",
`Subject: Introduction from Wohlig

Hi [Name],

I'm {{name}}, {{title}} at Wohlig. We're the Google Cloud Premier Partner teams call when AI agents, automation and data need to simply work, and I work on [what you do].

[One sentence on why you are writing to them.]

Would you be open to a short call this week? I'm happy to work around your time.

Regards,
{{name}}
{{title}}, Wohlig
{{email}}{{phone_line}}`],
  ["", "Follow-up", "Send within a day of a call or meeting.",
`Subject: Thank you, and next steps

Hi [Name],

Thank you for your time today. A quick summary of what we agreed:

- [Point 1]
- [Point 2]
- [Next step, owner and date]

Please tell me if I have missed anything.

Regards,
{{name}}
{{title}}, Wohlig`],
  ["", "Out of office", "An automatic reply while you are away.",
`Hello,

Thank you for your email. I'm out of the office from [start date] to [end date] and will reply when I'm back.

For anything urgent, please contact [colleague name] at [colleague email].

Regards,
{{name}}
{{title}}, Wohlig`],
  ["", "Meeting invite", "Asking for time without a long back-and-forth.",
`Subject: Can we find 30 minutes?

Hi [Name],

I'd like to talk about [topic]. Would any of these suit you?

- [Day, time]
- [Day, time]
- [Day, time]

If not, send me a time that works and I'll fit around it.

Thanks,
{{name}}
{{title}}, Wohlig`],
  ["", "Agency brief", "A brief for a designer or agency, with the brand essentials.",
`Subject: Design brief: [project] for Wohlig

Hi [Name],

Thanks for taking this on. Here is what you need to stay on brand.

What we need: [deliverable, size and format]
Deadline: [date]
Audience: [who will see it]
Key message: [one sentence]

Brand essentials
- Logo: use the supplied SVG/PNG files only, never redrawn, recoloured or stretched, with one orb-diameter of clear space.
- Colours: deep maroon leads; sunset orange is only an accent. Warm ivory is the base.
- Type: Source Serif 4 for headlines, Lato for everything else.
- Voice: confident, warm, specific. No invented numbers.

Send me a first draft by [date] and I'll come back within a day.

{{name}}
{{title}}, Wohlig
{{email}}{{phone_line}}`],
];

/* Starter texts for particular designations, added once. They show only to people whose designation or department fits. HR can change who each is for. */
const BY_DESIGNATION = [
  [["hr"], "Interview invitation", "Inviting a candidate to interview.",
`Subject: Interview at Wohlig: [role]

Hi [Name],

Thank you for your interest in the [role] position at Wohlig. We'd like to invite you to an interview.

Date and time: [date, time, time zone]
Format: [video call link or office address]
Who you'll meet: [names and roles]

Please reply to confirm, or suggest another time if this doesn't suit you.

Regards,
{{name}}
{{title}}, Wohlig
{{email}}{{phone_line}}`],
  [["hr"], "Welcome email for a new joiner", "Sent before someone's first day.",
`Subject: Welcome to Wohlig, [Name]

Hi [Name],

We're glad you're joining us as [role] on [start date].

On your first day:
- Arrive at [time] at [place], and ask for {{name}}.
- Bring [documents].
- Your buddy will be [buddy name].

If you have any questions before then, reply to this email.

Welcome to the team,
{{name}}
{{title}}, Wohlig`],
  [["engineer", "developer", "devops", "architect", "tech"], "Ask for a code review", "A short, clear review request.",
`Hi [Name],

Could you review [link to the change] when you have time?

What it does: [one sentence]
What I'd like your eyes on: [the risky or unsure part]
How to test it: [steps]

I'd like to merge by [date]. Thanks,
{{name}}`],
  [["engineer", "developer", "devops", "architect", "tech"], "Share an incident update", "A calm update while something is being fixed.",
`Subject: Update on [issue], [time]

What happened: [one or two sentences, in plain words]
Who is affected: [teams or customers]
What we're doing: [the fix in progress]
Next update: [time]

If you see anything new, tell me straight away.

{{name}}
{{title}}, Wohlig`],
  [["sales", "business", "partner", "growth", "account"], "Follow up on a proposal", "A nudge after you've sent a proposal.",
`Subject: Your proposal from Wohlig

Hi [Name],

I wanted to check that the proposal for [project] reached you, and to see if there is anything you'd like us to clarify.

If it helps, I can walk your team through it in 20 minutes. Would [day] or [day] suit you?

Regards,
{{name}}
{{title}}, Wohlig
{{email}}{{phone_line}}`],
];
export async function seedDesignationTexts(db = pool) {
  if (!(await claim(db, "designation-texts-v1"))) return 0;
  let n = 80;
  for (const [audience, title, description, body] of BY_DESIGNATION) {
    await db.query(`INSERT INTO digital_kit_resources (module, category, title, description, body, published, sort_order, audience, created_by) VALUES ('text','',$1,$2,$3,true,$4,$5,'system')`,
      [title, description, body, (n += 10), audience]);
  }
  return BY_DESIGNATION.length;
}

/** Claims a one-time setup step. Only one server wins it, even if several start at once, so nothing is seeded twice. */
const claim = async (db, key) => (await db.query("INSERT INTO digital_kit_state (key, value) VALUES ($1,'1') ON CONFLICT DO NOTHING", [key])).rowCount === 1;

const insertTexts = async (db) => {
  let n = 0;
  for (const [category, title, description, body] of TEXTS) {
    await db.query(`INSERT INTO digital_kit_resources (module, category, title, description, body, published, sort_order, created_by) VALUES ('text',$1,$2,$3,$4,true,$5,'system')`,
      [category, title, description, body, (n += 10)]);
  }
};

export async function seedDigitalKit(db = pool) {
  if (!(await claim(db, "seeded"))) return false;
  await claim(db, "official-texts-v1");   // a fresh start already gets the current texts
  await insertTexts(db);
  return true;
}

/** Replaces the first version's starter texts with the current set. Only texts nobody has edited (version 1, made by the system) go; HR's own and edited ones stay. */
export async function seedOfficialTexts(db = pool) {
  if (!(await claim(db, "official-texts-v1"))) return false;
  await db.query("DELETE FROM digital_kit_resources WHERE module='text' AND created_by='system' AND version=1");
  await insertTexts(db);
  return true;
}

/* The official company files (from the brand guidelines), shipped with the app in seed/digital-kit and published once.
   HR can replace, unpublish or delete any of them in Manage; they are never put back. */
const SEED_DIR = fileURLToPath(new URL("../seed/digital-kit/", import.meta.url));
const exists = async (f) => { try { await fs.access(f); return true; } catch { return false; } };
/** Where to read a resource's file from. An official file whose stored copy has gone missing is read from the app's seed folder. */
async function fileOf(r) {
  const main = diskPath(r.stored_name);
  if (await exists(main)) return main;
  if (r.created_by === "system" && r.filename) { const seed = path.join(SEED_DIR, path.basename(r.filename)); if (await exists(seed)) return seed; }
  return null;
}
const diskPath = (stored) => (stored.startsWith("seed:") ? path.join(SEED_DIR, path.basename(stored.slice(5))) : path.join(UPLOAD_DIR, stored));
/** Official files that come with a preview picture (seed/digital-kit/<file>.preview.png). */
const PREVIEWS = new Set((() => { try { return readdirSync(SEED_DIR).filter((f) => f.endsWith(".preview.png")).map((f) => f.slice(0, -12)); } catch { return []; } })());
const hasPreview = (r) => !!r.stored_name && r.stored_name.startsWith("seed:") && PREVIEWS.has(path.basename(r.stored_name.slice(5)));
const dropFile = async (stored) => { if (stored && !stored.startsWith("seed:")) await fs.rm(path.join(UPLOAD_DIR, stored), { force: true }); };   // the official files belong to the app, never deleted
const OFFICIAL = [
  { file: "wohlig-deck-template.pptx", module: "template", category: "Documents", title: "Pitch and proposal deck", description: "PowerPoint, 17 slides: about us, services, approach, proof, case study, timeline, team, investment, next steps.", sort: 10 },
  { file: "wohlig-sow-template.docx", module: "template", category: "Documents", title: "Statement of work / proposal", description: "Word, cover and 15 sections: success measures, scope, deliverables, milestones, commercials, change control, sign-off.", sort: 20 },
  { file: "wohlig-letterhead.docx", module: "template", category: "Documents", title: "Letterhead", description: "Word, A4 letter with contact header, reference line and company footer.", sort: 30 },
  { file: "wohlig-linkedin-banner.png", module: "download", category: "", title: "LinkedIn banner", description: "PNG · company page, 1128×191", sort: 10 },
];
export async function seedOfficialFiles(db = pool) {
  if (!(await claim(db, "official-files-v1"))) return 0;
  // The invented outline from the first version is replaced by the real statement of work (only if nobody has edited it).
  await db.query("DELETE FROM digital_kit_resources WHERE created_by='system' AND module='template' AND title='Statement of Work (SOW) outline' AND version=1");
  let made = 0;
  for (const o of OFFICIAL) {
    let buf; try { buf = await fs.readFile(path.join(SEED_DIR, o.file)); } catch { continue; }
    const kind = sniff(buf, o.file); if (!kind) continue;
    const stored = `seed:${o.file}`;
    await db.query(
      `INSERT INTO digital_kit_resources (module, category, title, description, filename, mime, size, stored_name, published, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,'system')`,
      [o.module, o.category, o.title, o.description, o.file, MIME[kind], buf.length, stored, o.sort]);
    made++;
  }
  return made;
}

/** Gives the official LinkedIn banner the same name and group as the brand guidelines page. Only if nobody has edited it. */
export async function updateOfficialLabels(db = pool) {
  if (!(await claim(db, "official-labels-v2"))) return 0;
  const r = await db.query(
    `UPDATE digital_kit_resources SET title='LinkedIn banner', description='PNG · company page, 1128×191', category=''
     WHERE created_by='system' AND stored_name='seed:wohlig-linkedin-banner.png' AND version=1`);
  return r.rowCount;
}

/** Points official files made by the first version (copies in the uploads folder, which a server may not have) at the app's own seed copy.
    Only unedited ones (version 1, made by the system) whose file name matches a seed file. Safe to run at every start. */
export async function repairOfficialFiles(db = pool) {
  let names = []; try { names = readdirSync(SEED_DIR).filter((f) => !f.endsWith(".preview.png") && !f.startsWith(".")); } catch { return 0; }
  const r = await db.query(
    `UPDATE digital_kit_resources SET stored_name='seed:' || filename
     WHERE created_by='system' AND version=1 AND stored_name IS NOT NULL AND stored_name NOT LIKE 'seed:%' AND filename = ANY($1::text[])`, [names]);
  return r.rowCount;
}

/** Removes copies of starter items that an earlier double start created (same title, made by the system). The oldest copy stays. */
export async function removeDuplicateStarters(db = pool) {
  const r = await db.query(
    `DELETE FROM digital_kit_resources a USING digital_kit_resources b
     WHERE a.created_by='system' AND b.created_by='system' AND a.module=b.module AND a.title=b.title AND a.id > b.id AND a.stored_name IS NULL AND b.stored_name IS NULL`);
  return r.rowCount;
}

/* ---------- who a resource is for ---------- */
/** An empty audience means everyone. Otherwise a person sees the resource when their designation or department has a word starting with one of the audience words
    (so "engineer" fits "Software Engineer" and "Engineering"), or when the word is "hr" and they have the HR role. */
const escRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function forPerson(audience, who) {
  const a = Array.isArray(audience) ? audience : [];
  if (!a.length) return true;
  const hay = `${who.title || ""} ${who.dept || ""}`;
  return a.some((w) => (w === "hr" && who.role === "hr") || new RegExp(`(^|[^a-z0-9])${escRe(w)}`, "i").test(hay));
}
/** The words typed by HR (a list or a comma separated line), cleaned. Returns { list } or { error }. */
function cleanAudience(v) {
  const raw = Array.isArray(v) ? v : String(v ?? "").split(/[,\n]/);
  const list = [...new Set(raw.map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
  if (list.length > 12) return { error: "Use at most 12 words." };
  if (list.some((w) => !/^[a-z0-9][a-z0-9 &/+.-]{0,29}$/.test(w))) return { error: "Use short words like hr, sales or engineer, separated by commas." };
  return { list };
}

/* ---------- who is asking ---------- */
const placeholderTitle = (t) => { const s = line(t, 120); return !s || s === "—" || s === "-" ? "" : s; };

async function personOf(email, role = "employee") {
  const key = email.toLowerCase();
  const e = (await pool.query("SELECT * FROM employees WHERE lower(work_email)=$1", [key])).rows[0];
  if (!e) return null;
  await ensureKit(pool, e.id, "first-visit");
  const kit = (await pool.query("SELECT * FROM digital_kits WHERE employee_id=$1", [e.id])).rows[0];
  const profile = (await pool.query("SELECT data FROM profiles WHERE lower(email)=$1", [key])).rows[0]?.data || {};
  const ov = kit.overrides || {};
  const person = {
    id: e.id, empNo: e.emp_no || "", name: e.name, email: e.work_email.toLowerCase(), dept: e.dept || "", role,
    title: placeholderTitle(ov.title) || placeholderTitle(e.title),
    phone: line(ov.phone, 20) || line(profile.contact?.phone, 20) || line(e.phone, 20),
    location: line(ov.location, 80) || line(e.work_location, 80),
    linkedin: line(profile.contact?.linkedin, 200),
    linkedinHeadline: line(ov.linkedinHeadline, 220),
  };
  const missing = [];
  if (!person.title) missing.push({ key: "title", label: "Designation", by: "hr", hint: "Ask HR to add your designation." });
  if (!person.phone) missing.push({ key: "phone", label: "Phone number", by: "you", hint: "Add it in My profile, under Contact details.", link: "/app/profile" });
  return { person, missing, kit: { createdAt: kit.created_at, source: kit.source } };
}

const shape = (r, withDraft = false) => ({
  id: r.id, module: r.module, category: r.category, title: r.title, description: r.description, body: r.body,
  audience: r.audience || [], hasFile: !!r.stored_name, hasPreview: hasPreview(r), filename: r.filename, mime: r.mime, size: r.size, version: r.version, updatedAt: r.updated_at,
  ...(withDraft ? { published: r.published, sortOrder: r.sort_order, updatedBy: r.updated_by } : {}),
});

/* ---------- files: what is allowed in, decided by the first bytes (and the extension for Office files) ---------- */
const MIME = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", zip: "application/zip" };
const sniff = (b, name) => {
  const ext = String(name || "").toLowerCase().split(".").pop();
  if (b.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (b.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  if (b[0] === 0x50 && b[1] === 0x4b && ["docx", "pptx", "xlsx", "zip"].includes(ext)) return ext;
  return null;
};
const safeName = (s) => String(s || "file").replace(/[^\w.\- ()]/g, "_").slice(0, 120);
const INLINE = new Set(["png", "jpg", "webp", "gif", "pdf"]);

/* ---------- routes ---------- */
export const digitalKitRouter = express.Router();

/** Is this resource for the person asking? (Their own designation and department decide, never anything in the request.) */
async function mine(req, r) {
  if (!(r.audience || []).length) return true;
  const me = await personOf(req.user.email, req.user.role);
  return !!me && forPerson(r.audience, me.person);
}

// A file is only reachable while it is published and meant for the person (HR can always reach it).
digitalKitRouter.get("/resources/:id/file", wrap(async (req, res) => {
  const r = (await pool.query("SELECT * FROM digital_kit_resources WHERE id=$1", [idOf(req.params.id)])).rows[0];
  if (!r || !r.stored_name || !(req.user.role === "hr" || (r.published && await mine(req, r)))) return res.status(404).json({ error: "Not found" });
  const ext = Object.keys(MIME).find((k) => MIME[k] === r.mime) || "";
  res.set({
    "Content-Type": r.mime,
    "Content-Disposition": `${req.query.download || !INLINE.has(ext) ? "attachment" : "inline"}; filename="${safeName(r.filename).replace(/"/g, "")}"`,
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'", "Cache-Control": "private, max-age=0, must-revalidate", ETag: `"v${r.version}"`,
  });
  const file = await fileOf(r);
  if (!file) return res.status(404).json({ error: "The file is missing on the server. Ask HR to upload it again." });
  res.sendFile(file);
}));

// The preview picture of an official document, under the same rule: only while published (HR can always see it).
digitalKitRouter.get("/resources/:id/preview", wrap(async (req, res) => {
  const r = (await pool.query("SELECT * FROM digital_kit_resources WHERE id=$1", [idOf(req.params.id)])).rows[0];
  if (!r || !hasPreview(r) || !(req.user.role === "hr" || (r.published && await mine(req, r)))) return res.status(404).json({ error: "Not found" });
  res.set({ "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600" });
  // ?thumb=1 gives a small copy for the little pictures in lists; the full-size one is for the preview window.
  const base = path.basename(r.stored_name.slice(5)), small = path.join(SEED_DIR, `${base}.thumb.png`);
  res.sendFile(req.query.thumb && (await exists(small)) ? small : path.join(SEED_DIR, `${base}.preview.png`));
}));

// Raw file body, so it is read before the JSON parser below.
digitalKitRouter.put("/admin/resources/:id/file", requireHr, express.raw({ type: () => true, limit: MAX_FILE }), wrap(async (req, res) => {
  const id = idOf(req.params.id), body = req.body;
  const cur = (await pool.query("SELECT * FROM digital_kit_resources WHERE id=$1", [id])).rows[0];
  if (!cur) return res.status(404).json({ error: "Not found" });
  if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: "The file is empty." });
  const name = safeName(req.query.name), kind = sniff(body, name);
  if (!kind) return res.status(400).json({ error: "Allowed files: PDF, PNG, JPG, WEBP, GIF, Word, PowerPoint, Excel or ZIP." });
  const stored = `kit-${crypto.randomUUID()}.${kind}`;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, stored), body);
  const r = await pool.query(
    `UPDATE digital_kit_resources SET filename=$2, mime=$3, size=$4, stored_name=$5, version=version+1, updated_by=$6, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, name, MIME[kind], body.length, stored, req.user.email]);
  await dropFile(cur.stored_name);
  await audit(pool, `Digital Kit: file uploaded for "${cur.title}"`, req.user.email);
  res.json(shape(r.rows[0], true));
}));

digitalKitRouter.use(express.json({ limit: "200kb" }));

// My kit: my details, what is missing, and everything HR has published.
digitalKitRouter.get("/", wrap(async (req, res) => {
  const me = await personOf(req.user.email, req.user.role);
  if (!me) return res.status(404).json({ error: "There is no employee record for your account yet. Ask HR." });
  const rows = (await pool.query("SELECT * FROM digital_kit_resources WHERE published ORDER BY sort_order, id")).rows.filter((r) => forPerson(r.audience, me.person));   // only what is for this person's designation
  const resources = Object.fromEntries(MODULES.map((m) => [m, rows.filter((r) => r.module === m).map((r) => shape(r))]));
  res.json({ ...me, resources, isHr: req.user.role === "hr" });
}));

// LinkedIn headline ideas from Gemini. Only the person's own designation and department (read here, never taken from the request) go out;
// see gemini.js. Each person can ask 10 times an hour.
const aiAsked = new Map();
digitalKitRouter.post("/headline-ai", wrap(async (req, res) => {
  const me = await personOf(req.user.email, req.user.role);
  if (!me) return res.status(404).json({ error: "There is no employee record for your account yet. Ask HR." });
  if (!geminiConfigured()) return res.status(409).json({ error: "Gemini AI is not set up on this server yet. Ask IT to add the GEMINI_API_KEY setting." });
  const now = Date.now(), recent = (aiAsked.get(me.person.email) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= 10) return res.status(429).json({ error: "You have asked Gemini a lot in the last hour. Try again a little later." });
  aiAsked.set(me.person.email, [...recent, now]);
  try {
    // "avoid" = the ideas already on screen, so Shuffle brings new ones (a few short strings, nothing else is taken from the request)
    const avoid = (Array.isArray(req.body && req.body.avoid) ? req.body.avoid : []).filter((t) => typeof t === "string").slice(0, 6).map((t) => line(t, 220)).filter(Boolean);
    const headlines = await suggestHeadlines({ title: me.person.title, dept: me.person.dept, avoid });
    res.json({ headlines });
  } catch (err) {
    res.status(err.code === "NOT_SET_UP" ? 409 : 502).json({ error: err.message });
  }
}));

/* ----- HR administration (separate from employee access) ----- */
const admin = express.Router();
admin.use(requireHr);

admin.get("/resources", wrap(async (_req, res) => {
  const { rows } = await pool.query("SELECT * FROM digital_kit_resources ORDER BY module, sort_order, id");
  res.json(rows.map((r) => shape(r, true)));
}));

function cleanResource(b = {}, partial = false) {
  const errors = {}, out = {};
  if (!partial || b.module !== undefined) { if (!MODULES.includes(b.module)) errors.module = "Pick a section."; else out.module = b.module; }
  if (!partial || b.title !== undefined) { const t = line(b.title, 120); if (!t) errors.title = "Enter a title."; else out.title = t; }
  if (b.category !== undefined) out.category = line(b.category, 60);
  if (b.description !== undefined) out.description = line(b.description, 500);
  if (b.body !== undefined) out.body = b.body === null ? null : str(b.body, 20000);
  if (b.published !== undefined) out.published = !!b.published;
  if (b.audience !== undefined) { const a = cleanAudience(b.audience); if (a.error) errors.audience = a.error; else out.audience = a.list; }
  if (b.sortOrder !== undefined) { const n = Number(b.sortOrder); if (!Number.isInteger(n) || n < -9999 || n > 9999) errors.sortOrder = "Enter a whole number."; else out.sort_order = n; }
  return { out, errors };
}

admin.post("/resources", wrap(async (req, res) => {
  const { out, errors } = cleanResource(req.body, false);
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  const r = await pool.query(
    `INSERT INTO digital_kit_resources (module, category, title, description, body, published, sort_order, audience, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
    [out.module, out.category || "", out.title, out.description || "", out.body ?? null, out.published ?? false, out.sort_order ?? 100, out.audience || [], req.user.email]);
  await audit(pool, `Digital Kit: added "${out.title}" (${out.module})`, req.user.email);
  res.status(201).json(shape(r.rows[0], true));
}));

admin.put("/resources/:id", wrap(async (req, res) => {
  const id = idOf(req.params.id), { out, errors } = cleanResource(req.body, true);
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  const keys = Object.keys(out);
  if (!keys.length) return res.status(400).json({ error: "Nothing to change." });
  const sets = keys.map((k, i) => `${k}=$${i + 2}`);
  const content = keys.some((k) => ["title", "category", "description", "body"].includes(k));
  const r = await pool.query(
    `UPDATE digital_kit_resources SET ${sets.join(", ")}${content ? ", version=version+1" : ""}, updated_by=$${keys.length + 2}, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, ...keys.map((k) => out[k]), req.user.email]);
  if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
  await audit(pool, `Digital Kit: ${out.published === true ? "published" : out.published === false ? "unpublished" : "updated"} "${r.rows[0].title}"`, req.user.email);
  res.json(shape(r.rows[0], true));
}));

admin.delete("/resources/:id", wrap(async (req, res) => {
  const r = await pool.query("DELETE FROM digital_kit_resources WHERE id=$1 RETURNING title, stored_name", [idOf(req.params.id)]);
  if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
  await dropFile(r.rows[0].stored_name);
  await audit(pool, `Digital Kit: deleted "${r.rows[0].title}"`, req.user.email);
  res.json({ ok: true });
}));

// Each employee's kit, with what is missing for personalising it, and HR's overrides.
admin.get("/employees", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT e.id, e.emp_no, e.name, e.work_email, e.title, e.phone, e.work_location, e.status, k.overrides, k.created_at AS kit_at, k.source,
            p.data->'contact'->>'phone' AS profile_phone
     FROM employees e LEFT JOIN digital_kits k ON k.employee_id = e.id LEFT JOIN profiles p ON lower(p.email) = lower(e.work_email)
     WHERE e.status <> 'offboarded' ORDER BY e.name`);
  res.json(rows.map((r) => {
    const ov = r.overrides || {};
    const title = placeholderTitle(ov.title) || placeholderTitle(r.title), phone = line(ov.phone, 20) || line(r.profile_phone, 20) || line(r.phone, 20);
    return { id: r.id, empNo: r.emp_no || "", name: r.name, email: r.work_email, status: r.status, title, phone, location: line(ov.location, 80) || line(r.work_location, 80),
      overrides: { title: ov.title || "", phone: ov.phone || "", location: ov.location || "", linkedinHeadline: ov.linkedinHeadline || "" },
      hasKit: !!r.kit_at, source: r.source || "", missing: [!title && "Designation", !phone && "Phone"].filter(Boolean) };
  }));
}));

admin.put("/employees/:id", wrap(async (req, res) => {
  const id = idOf(req.params.id), b = req.body || {}, errors = {};
  const e = (await pool.query("SELECT id, name, work_email FROM employees WHERE id=$1", [id])).rows[0];
  if (!e) return res.status(404).json({ error: "Employee not found" });
  const ov = { title: line(b.title, 120), phone: line(b.phone, 20), location: line(b.location, 80), linkedinHeadline: line(b.linkedinHeadline, 220) };
  if (ov.phone && !/^[+()\d\s-]{7,20}$/.test(ov.phone)) errors.phone = "Enter a valid phone number.";
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  await ensureKit(pool, id, "hr");
  await pool.query("UPDATE digital_kits SET overrides=$2, updated_at=now() WHERE employee_id=$1", [id, ov]);
  await audit(pool, `Digital Kit: details used for personalising updated (by ${req.user.email})`, e.work_email);
  res.json({ ok: true });
}));

// Gives every employee a kit (what the server also does at start). Nobody is duplicated or changed.
admin.post("/init", wrap(async (req, res) => {
  const created = await initDigitalKits(pool);
  await audit(pool, `Digital Kit: kits created for ${created} employee${created === 1 ? "" : "s"} (by ${req.user.email})`, req.user.email);
  res.json({ created });
}));

digitalKitRouter.use("/admin", admin);
