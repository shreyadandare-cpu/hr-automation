/*
 * The Access page's API (Company > Access). Super admins only: they see everyone's access, tick and remove permissions (for
 * the whole company or a reporting tree), and add or remove super admins. Every change is in the audit log with who made it,
 * and a removed permission keeps its row, so the history stays. Changes count from the person's very next click (auth.js
 * loadSession reads access fresh on every request).
 */
import express from "express";
import { pool } from "./db.js";
import { createGoogleUser } from "./auth.js";
import { needSuper } from "./access.js";
import { GROUPS, PERM, PERMISSIONS, PRESETS, readGrant } from "./access-rules.js";
import { isCompanyEmail } from "./validate.js";

const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const me = (req) => req.user.email.toLowerCase();
const audit = (action, email) => pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]);
const LIVE = "g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at >= (now() AT TIME ZONE 'Asia/Kolkata')::date)";
const grantOut = (g) => ({ id: g.id, permission: g.permission, scope: g.scope, scopeRootEmail: g.scope_root_email, note: g.note,
  grantedBy: g.granted_by, grantedAt: g.granted_at, expiresAt: g.expires_at ? String(g.expires_at instanceof Date ? g.expires_at.toISOString() : g.expires_at).slice(0, 10) : null,
  revokedAt: g.revoked_at, revokedBy: g.revoked_by });
const scopeText = (g, names) => (g.scope === "company" ? "the whole company" : `the team under ${names[g.scopeRootEmail || g.email] || g.scopeRootEmail || "them"}`);

export function accessRouter(wrap) {
  const r = express.Router();
  r.use("/api/access", needSuper);
  r.use("/api/access", (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });

  // Everyone who is here (or has a login), with their live access, and the list of permissions to tick.
  r.get("/api/access/people", wrap(async (_req, res) => {
    const { rows: people } = await pool.query(
      `SELECT lower(e.work_email) AS email, e.name, e.title, e.status, lower(e.manager_email) AS manager_email, e.manager,
              u.email IS NOT NULL AS has_login, COALESCE(u.is_super_admin,false) AS super_admin, COALESCE(u.login_blocked,false) AS blocked
         FROM employees e LEFT JOIN users u ON lower(u.email)=lower(e.work_email)
        WHERE e.status <> 'offboarded'
       UNION ALL
       SELECT lower(u.email), u.email, '', 'login only', NULL, NULL, true, u.is_super_admin, u.login_blocked FROM users u
        WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE lower(e.work_email)=lower(u.email))
        ORDER BY 2`);
    const { rows: grants } = await pool.query(`SELECT g.* FROM access_grants g WHERE ${LIVE} ORDER BY g.granted_at`);
    const byEmail = {};
    for (const g of grants) (byEmail[g.email.toLowerCase()] ||= []).push(grantOut(g));
    res.json({
      today: istToday(), me: _req.user.email.toLowerCase(),
      groups: GROUPS, permissions: PERMISSIONS, presets: PRESETS,
      people: people.map((p) => ({ email: p.email, name: p.name, title: p.title || "", status: p.status, managerEmail: p.manager_email, manager: p.manager || "",
        hasLogin: p.has_login, superAdmin: p.super_admin, blocked: p.blocked, grants: byEmail[p.email] || [] })),
    });
  }));

  // One person's history: every permission they were given, including removed and ended ones.
  r.get("/api/access/people/:email/history", wrap(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM access_grants WHERE lower(email)=$1 ORDER BY granted_at DESC LIMIT 100", [String(req.params.email).toLowerCase()]);
    res.json({ history: rows.map(grantOut) });
  }));

  // Give one or more permissions to one person: { email, grants: [{ permission, scope, scopeRootEmail?, expiresAt?, note? }] }.
  r.post("/api/access/grants", wrap(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const list = Array.isArray(req.body?.grants) ? req.body.grants.slice(0, PERMISSIONS.length) : [];
    if (!isCompanyEmail(email)) return res.status(400).json({ error: "Please choose a person with a work email." });
    if (!list.length) return res.status(400).json({ error: "Please tick at least one permission." });
    const person = (await pool.query("SELECT name, status FROM employees WHERE lower(work_email)=$1", [email])).rows[0];
    if (person && person.status === "offboarded") return res.status(400).json({ error: `${person.name} has left, so cannot be given access.` });
    const today = istToday(), clean = [];
    for (const g of list) {
      const { value, errors } = readGrant({ ...g, email }, today);
      if (errors) return res.status(400).json({ error: Object.values(errors)[0], errors });
      if (value.scopeRootEmail) {
        const root = (await pool.query("SELECT 1 FROM employees WHERE lower(work_email)=$1 AND status <> 'offboarded'", [value.scopeRootEmail])).rowCount;
        if (!root) return res.status(400).json({ error: "Please choose whose team from the list." });
      }
      clean.push(value);
    }
    const names = Object.fromEntries((await pool.query("SELECT lower(work_email) AS e, name FROM employees")).rows.map((x) => [x.e, x.name]));
    let added = 0;
    for (const g of clean) {
      const r2 = await pool.query(
        `INSERT INTO access_grants (email, permission, scope, scope_root_email, note, granted_by, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [g.email, g.permission, g.scope, g.scopeRootEmail, g.note, me(req), g.expiresAt]);
      if (r2.rowCount) {
        added++;
        await audit(`Access given: ${PERM[g.permission].label}, for ${scopeText({ ...g, email }, names)}${g.expiresAt ? ` until ${g.expiresAt}` : ""} (by ${req.user.email})`, email);
      }
    }
    res.status(201).json({ ok: true, added });
  }));

  // Remove one permission (the row stays as history).
  r.delete("/api/access/grants/:id", wrap(async (req, res) => {
    const { rows: [g] } = await pool.query(
      "UPDATE access_grants SET revoked_at=now(), revoked_by=$2 WHERE id=$1 AND revoked_at IS NULL RETURNING *", [Number(req.params.id) || 0, me(req)]);
    if (!g) return res.status(404).json({ error: "This access was already removed." });
    await audit(`Access removed: ${PERM[g.permission] ? PERM[g.permission].label : g.permission} (by ${req.user.email})`, g.email.toLowerCase());
    res.json({ ok: true });
  }));

  // Add or remove a super admin: { on: true|false }. There is always at least one active super admin left.
  r.put("/api/access/super-admins/:email", wrap(async (req, res) => {
    const email = String(req.params.email || "").trim().toLowerCase(), on = req.body?.on === true;
    if (!isCompanyEmail(email)) return res.status(400).json({ error: "Please choose a person with a work email." });
    if (on) {
      const person = (await pool.query("SELECT name, status FROM employees WHERE lower(work_email)=$1", [email])).rows[0];
      if (person && (person.status === "offboarded" || person.status === "offboarding")) return res.status(400).json({ error: `${person.name} is leaving, so cannot be a super admin.` });
      await createGoogleUser(pool, email, "employee");
      await pool.query("UPDATE users SET is_super_admin=true, login_blocked=false WHERE lower(email)=$1", [email]);
      await audit(`Made a super admin (by ${req.user.email})`, email);
      return res.json({ ok: true });
    }
    const r2 = await pool.query(
      `UPDATE users SET is_super_admin=false WHERE lower(email)=$1 AND is_super_admin
         AND EXISTS (SELECT 1 FROM users o WHERE o.is_super_admin AND NOT o.login_blocked AND lower(o.email)<>$1)`, [email]);
    if (!r2.rowCount) {
      const was = (await pool.query("SELECT is_super_admin FROM users WHERE lower(email)=$1", [email])).rows[0];
      return res.status(400).json({ error: was && was.is_super_admin ? "There must always be at least one super admin." : "This person is not a super admin." });
    }
    await audit(`No longer a super admin (by ${req.user.email})`, email);
    res.json({ ok: true });
  }));

  return r;
}
