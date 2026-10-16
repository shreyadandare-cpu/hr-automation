import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { pool, initDb } from "./db.js";
import { onboardingErrors, maskAadhaar, maskPan, maskAcct } from "./validate.js";
import { documentsRouter } from "./documents.js";
import { bootstrapAuth, loadSession, requireAuth, requireHr, createUser } from "./auth.js";
import { sessionRouter, accountRouter, usersRouter } from "./users.js";
import { leaveRouter } from "./leave.js";
import { offboardingRouter, runDue } from "./offboarding.js";

const DOMAIN = "wohlig.com";
const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, "../../frontend");

const clean = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function nextWorkEmail(client, first, last) {
  const a = clean(first), b = clean(last);
  if (!a || !b) return "";
  const base = `${a}.${b}`;
  for (let n = 1; ; n++) {
    const email = `${base}${n > 1 ? n : ""}@${DOMAIN}`;
    const { rowCount } = await client.query("SELECT 1 FROM employees WHERE lower(work_email)=$1", [email]);
    if (!rowCount) return email;
  }
}

const toApi = (r) => ({
  email: r.work_email, name: r.name, personalEmail: r.personal_email, phone: r.phone, address: r.address,
  dept: r.dept, title: r.title, manager: r.manager,
  start: r.start_date, status: r.status,
  ids: { dob: r.dob || "", aadhaar: r.aadhaar_masked || "", pan: r.pan_masked || "",
         acct: r.acct_masked || "", ifsc: r.ifsc || "" },
  apps: r.apps,
});

const app = express();
app.use(loadSession);
app.use("/api/documents", requireAuth, documentsRouter); // raw file bodies, so it goes before the JSON parser
app.use(express.json({ limit: "100kb" }));
app.use("/api", sessionRouter); // login and logout are the only public API routes
app.use("/api", accountRouter);
app.use("/api/users", usersRouter);
// Onboarding is HR work; employees only reach their own account and documents.
app.use(["/api/onboarding", "/api/work-email"], requireHr);
const draftId = (req) => req.user.email.toLowerCase(); // each HR user has their own draft
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

// People who completed onboarding through this API. The page merges them into its employee list.
app.get("/api/onboarding", wrap(async (_req, res) => {
  const { rows } = await pool.query("SELECT * FROM employees WHERE onboarded_at IS NOT NULL ORDER BY onboarded_at");
  res.json(rows.map(toApi));
}));

// Preview of the work email that would be issued, with the uniqueness check done against the database.
app.get("/api/work-email", wrap(async (req, res) => {
  res.json({ email: await nextWorkEmail(pool, req.query.first, req.query.last) });
}));

app.get("/api/onboarding/draft", wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM onboarding_drafts WHERE id=$1", [draftId(req)]);
  res.json(rows[0] ? rows[0].data : null);
}));

// Drafts hold name, contact and job details only. ID numbers are never saved.
app.put("/api/onboarding/draft", wrap(async (req, res) => {
  const d = req.body && typeof req.body === "object" ? req.body : {};
  const keep = ["first", "last", "pemail", "phone", "address", "dept", "title", "mgr", "start"];
  const data = Object.fromEntries(keep.map((k) => [k, String(d[k] ?? "")]));
  await pool.query(
    `INSERT INTO onboarding_drafts (id,data) VALUES ($1,$2)
     ON CONFLICT (id) DO UPDATE SET data=$2, updated_at=now()`, [draftId(req), data]);
  res.json({ ok: true });
}));

app.delete("/api/onboarding/draft", wrap(async (req, res) => {
  await pool.query("DELETE FROM onboarding_drafts WHERE id=$1", [draftId(req)]);
  res.json({ ok: true });
}));

// Submit onboarding: validates, issues a unique work email and saves the record in one transaction.
app.post("/api/onboarding", wrap(async (req, res) => {
  const { d = {}, ids = {}, apps, existingEmail } = req.body || {};
  const errors = onboardingErrors({ d, ids, apps });
  if (Object.keys(errors).length) return res.status(400).json({ errors });

  const full = `${d.first} ${d.last}`.trim();
  const fields = [d.dept, d.title.trim(), d.mgr || null, d.start, d.pemail.trim(), d.phone.trim(), d.address.trim(),
    ids.dob || null, maskAadhaar(ids.aadhaar), maskPan(ids.pan), maskAcct(ids.acct),
    String(ids.ifsc || "").trim().toUpperCase() || null, JSON.stringify(apps)];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let email;
    if (existingEmail) {
      const { rows } = await client.query("SELECT work_email FROM employees WHERE lower(work_email)=$1 FOR UPDATE",
        [String(existingEmail).toLowerCase()]);
      if (!rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Employee not found" }); }
      email = rows[0].work_email;
      await client.query(
        `UPDATE employees SET name=$1, dept=$2, title=$3, manager=$4, start_date=$5, personal_email=$6, phone=$7,
         address=$8, dob=$9, aadhaar_masked=$10, pan_masked=$11, acct_masked=$12, ifsc=$13, apps=$14, onboarded_at=now()
         WHERE lower(work_email)=$15`, [full, ...fields, email.toLowerCase()]);
    } else {
      await client.query("LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE");
      email = await nextWorkEmail(client, d.first, d.last);
      await client.query(
        `INSERT INTO employees (name, dept, title, manager, start_date, personal_email, phone, address, dob,
         aadhaar_masked, pan_masked, acct_masked, ifsc, apps, work_email, status, onboarded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'onboarding',now())`, [full, ...fields, email]);
    }
    await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)",
      [existingEmail ? "Onboarding completed" : "Employee record created", email]);
    await client.query("DELETE FROM onboarding_drafts WHERE id=$1", [draftId(req)]);
    // The new joiner gets a login with the default password so they can upload their documents.
    await createUser(client, email, "employee");
    await client.query("COMMIT");
    const { rows } = await pool.query("SELECT * FROM employees WHERE lower(work_email)=$1", [email.toLowerCase()]);
    res.status(201).json(toApi(rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

app.use(leaveRouter(wrap));
app.use(offboardingRouter(wrap));

// The page itself, so one command serves everything on the same origin.
app.get("/favicon.ico", (_req, res) => res.status(204).end());
app.get("/favicon.ico", (_req, res) => res.status(204).end());
app.get("/login", (req, res) => (req.user ? res.redirect("/") : res.sendFile(path.join(here, "../public/login.html"))));
app.get("/", (req, res) => (req.user ? res.sendFile(path.join(frontendDir, "hr-access-hub.html")) : res.redirect("/login")));
// Leave rules shared by the page and the server (no personal data in it).
app.get("/leave-rules.js", (_req, res) => res.sendFile(path.join(frontendDir, "leave-rules.js")));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

await initDb();
await bootstrapAuth();
// Scheduled offboardings run at 6 pm India time on the last working day; check every minute.
const checkDue = () => runDue().catch((err) => console.error("Scheduled offboarding check failed:", err));
checkDue();
setInterval(checkDue, 60_000);
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`HR Access Hub on http://localhost:${port}`));
