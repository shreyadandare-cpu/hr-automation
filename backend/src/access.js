/*
 * Access decisions against the database. The rules themselves are in access-rules.js.
 *
 *   req.access              { email, superAdmin, grants }, loaded with the session (auth.js loadSession), one query per request
 *   can(req, perm, target)  may this person use `perm`, on `target` (an email) when given
 *   scopeOf(req, perm)      null (everyone) or a Set of emails, to filter a list in SQL with = ANY($n)
 *   mayDecide(req, perm, owner)  can(), and never on your own request
 *   need(perm)              route guard: holds `perm` for anyone at all (the handler then checks the person)
 *   needSuper               route guard: super admins only
 *   canAll / needAll(perm)  `perm` for the whole company (company-level actions inside a team-able permission)
 *
 * The reporting tree comes from employees.manager_email and is kept in memory for 15 seconds; invalidateTree() drops it at once
 * when a manager changes.
 */
import { pool } from "./db.js";
import { FIRST_SUPER_ADMINS, PRESETS, decide, grantsFromRoles, mayDecideOn, scopeFor, subtree } from "./access-rules.js";
import { createGoogleUser } from "./auth.js";
import { isCompanyEmail } from "./validate.js";

const TREE_MS = 15_000;   // also dropped at once by invalidateTree() on manager and status changes
let tree = null;   // { at, people, cache: Map(root -> Set) }

async function loadTree() {
  if (tree && Date.now() - tree.at < TREE_MS) return tree;
  const { rows } = await pool.query("SELECT lower(work_email) AS email, lower(manager_email) AS m FROM employees WHERE status <> 'offboarded'");
  tree = { at: Date.now(), people: rows.map((r) => ({ email: r.email, managerEmail: r.m })), cache: new Map() };
  return tree;
}
/** Drops the cached reporting tree (call after any manager change). */
export const invalidateTree = () => { tree = null; };

async function treeFn() {
  const t = await loadTree();
  return (root) => {
    if (!t.cache.has(root)) t.cache.set(root, subtree(t.people, root));
    return t.cache.get(root);
  };
}
/** Everyone below `email` in the reporting tree, as a Set of lower-case emails. */
export async function treeOf(email) { return (await treeFn())(String(email || "").toLowerCase()); }

export const isSuper = (req) => !!(req.access && req.access.superAdmin);
export async function can(req, perm, target) { return decide(req.access, perm, target ?? null, await treeFn()); }
export async function scopeOf(req, perm) { return scopeFor(req.access, perm, await treeFn()); }
export async function mayDecide(req, perm, owner) { return mayDecideOn(req.access, perm, owner, await treeFn()); }
/** Holds `perm` for the whole company (a super admin, or a company grant): for company-level actions inside a team-able permission. */
export const canAll = (req, perm) => !!req.access && (req.access.superAdmin || (req.access.grants || []).some((g) => g.permission === perm && g.scope === "company"));
/** Route guard: `perm` for the whole company. */
export const needAll = (perm) => (req, res, next) => (!req.user ? res.status(401).json({ error: "Please sign in." }) : canAll(req, perm) ? next() : denied(res));

/** Holds `perm` in any scope (company or a team), without loading the reporting tree: for page gates and menus. */
export const holds = (req, perm) => decide(req.access, perm, null, () => new Set());
const denied = (res) => res.status(403).json({ error: "You do not have access to this. Please ask a super admin if you need it." });
export const need = (perm) => (req, res, next) => (!req.user ? res.status(401).json({ error: "Please sign in." })
  : holds(req, perm) ? next() : denied(res));
export const needSuper = (req, res, next) => (!req.user ? res.status(401).json({ error: "Please sign in." }) : isSuper(req) ? next() : denied(res));

/** The grants that count now for one person (used by loadSession through SQL, and by the Access page). */
export const LIVE_GRANTS_SQL = `revoked_at IS NULL AND (expires_at IS NULL OR expires_at >= (now() AT TIME ZONE 'Asia/Kolkata')::date)`;

/**
 * Start-up, once per database (app_migrations keys):
 * - the first super admins (FIRST_SUPER_ADMINS), with a login made for any who has none;
 * - grants that reproduce each login's access from before (HR, IT admin, payroll reviewers, the accountant), so nothing changes;
 * - and always: if no super admin is left, the HR_ADMIN_EMAIL logins become super admins, so someone can always give access.
 */
export async function bootstrapAccess() {
  const done = async (key) => (await pool.query("SELECT 1 FROM app_migrations WHERE key=$1", [key])).rowCount > 0;
  const mark = (key) => pool.query("INSERT INTO app_migrations (key) VALUES ($1) ON CONFLICT DO NOTHING", [key]);
  if (!(await done("access-first-super-admins"))) {
    for (const e of FIRST_SUPER_ADMINS) {
      if (!isCompanyEmail(e)) continue;
      await createGoogleUser(pool, e, "employee");
      await pool.query("UPDATE users SET is_super_admin=true WHERE lower(email)=$1", [e]);
      await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", ["Made a super admin when access started", e]);
    }
    await mark("access-first-super-admins");
  }
  if (!(await done("access-grants-from-roles"))) {
    const list = (v) => String(v || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const reviewers = list(process.env.PAYROLL_REVIEWERS ?? "chirag@wohlig.com"), financeViewers = list(process.env.FINANCE_VIEWERS);
    const { rows: users } = await pool.query("SELECT email, role, it_admin FROM users");
    for (const u of users) {
      for (const g of grantsFromRoles(u, { reviewers, financeViewers })) {
        await pool.query(
          `INSERT INTO access_grants (email, permission, scope, granted_by, note) VALUES ($1,$2,'company','system','From the access this login had before')
           ON CONFLICT DO NOTHING`, [g.email, g.permission]);
      }
    }
    await mark("access-grants-from-roles");
  }
  const { rowCount } = await pool.query("SELECT 1 FROM users WHERE is_super_admin AND NOT login_blocked LIMIT 1");
  if (!rowCount) {
    for (const a of String(process.env.HR_ADMIN_EMAIL || "").split(",").map((s) => s.trim().toLowerCase()).filter(isCompanyEmail)) {
      await pool.query("UPDATE users SET is_super_admin=true WHERE lower(email)=$1", [a]);
    }
  }
}

/*
 * Keeps grants in step with the two older switches on a login, so they still mean what they say:
 * giving the HR role adds the HR team set (company-wide); removing it removes those grants. The same for IT admin with assets
 * and tool access. Grants a super admin ticked by hand for other permissions are left alone.
 */
export async function syncRoleGrants(email, { hr, itAdmin }, actor) {
  const e = String(email).toLowerCase();
  const sets = [];
  if (hr !== undefined) sets.push([PRESETS.hr.perms, hr, "Given with the HR role"]);
  if (itAdmin !== undefined) sets.push([PRESETS.it.perms, itAdmin, "Given with IT admin"]);
  for (const [perms, on, note] of sets) {
    if (on) {
      for (const p of perms) {
        await pool.query(`INSERT INTO access_grants (email, permission, scope, granted_by, note) VALUES ($1,$2,'company',$3,$4) ON CONFLICT DO NOTHING`, [e, p, actor, note]);
      }
    } else {
      await pool.query(`UPDATE access_grants SET revoked_at=now(), revoked_by=$3 WHERE lower(email)=$1 AND permission = ANY($2) AND scope='company' AND revoked_at IS NULL`, [e, perms, actor]);
    }
  }
}

/**
 * Whether the caller may act on another person's login (send them a sign-in link, reset or unblock it, change their personal
 * email): super admins always; otherwise only when the person is not a super admin and holds no permission the caller lacks.
 * Stops anyone from taking over a login that has more power than their own.
 */
export async function mayActOnLogin(req, email) {
  if (isSuper(req)) return true;
  const e = String(email).toLowerCase();
  const u = (await pool.query("SELECT is_super_admin FROM users WHERE lower(email)=$1", [e])).rows[0];
  if (u && u.is_super_admin) return false;
  const { rows } = await pool.query(`SELECT DISTINCT permission FROM access_grants WHERE lower(email)=$1 AND ${LIVE_GRANTS_SQL}`, [e]);
  return rows.every((r) => canAll(req, r.permission));
}
