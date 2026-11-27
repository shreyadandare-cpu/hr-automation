/*
 * Access rules for Wohlig One, kept free of the database so they are tested on their own (test/access-rules.test.mjs).
 *
 * - Super admins (users.is_super_admin) can do everything and are the only people who give access.
 * - Everyone else holds the permissions a super admin ticked for them (access_grants), each for the whole company or for a
 *   reporting tree: everyone below a person in the manager chain, to any depth (employees.manager_email).
 * - Built in, with no tick: everyone acts on their own records, and a manager keeps what they have today over their direct reports.
 * - Nobody decides their own request, whatever they hold (mayDecide).
 * - Salaries are locked to the salary owners (SALARY_OWNERS; chintan@wohlig.com, chirag@wohlig.com and kailash@wohlig.com by default): the salary permissions below are
 *   held by them, company-wide, and by nobody else, super admins included. No grant on the Access page changes that; only the
 *   server's settings do.
 * The decisions against the database are in access.js.
 */

/** The people who are super admins when access starts (a one-time step in access.js). Super admins change this later on the Access page. */
export const FIRST_SUPER_ADMINS = ["chintan@wohlig.com", "chirag@wohlig.com", "jagruti@wohlig.com", "pratik.sawant@wohlig.com"];

/**
 * Every permission. `team: true` means it can be given for a reporting tree as well as for the whole company; the others are
 * company-wide only. Labels and hints are what super admins read on the Access page.
 */
export const PERMISSIONS = [
  { key: "people.view", group: "People", team: true, label: "See personal details", hint: "Phone, address, family, ID numbers and documents of the people in scope." },
  { key: "people.edit", group: "People", team: true, label: "Edit people", hint: "Change reporting manager, status, employee number and job details; add people to a team." },
  { key: "onboarding.manage", group: "People", team: false, label: "Run onboarding", hint: "Add new joiners and run their first days." },
  { key: "offboarding.manage", group: "People", team: false, label: "Run offboarding", hint: "Start and finish leaving, clearance and exits." },
  { key: "documents.view", group: "People", team: true, label: "See documents", hint: "Open the documents people uploaded." },
  { key: "leave.approve", group: "Time", team: true, label: "Approve leave", hint: "Decide leave and comp-off requests of the people in scope." },
  { key: "leave.manage", group: "Time", team: false, label: "Manage leave settings", hint: "Holidays, leave policy, balances and salary cuts." },
  { key: "attendance.view", group: "Time", team: true, label: "See attendance", hint: "Punches and monthly attendance of the people in scope." },
  { key: "attendance.edit", group: "Time", team: true, label: "Correct attendance", hint: "Add or change punches and decide attendance requests." },
  { key: "shifts.manage", group: "Time", team: false, label: "Manage shifts and clock-in", hint: "Create shifts, put people on them (the roster), choose who is paid overtime, and set web clock-in: the offices and the location check." },
  { key: "overtime.approve", group: "Time", team: true, label: "Approve overtime", hint: "Approve or reject the monthly overtime of the people in scope. Payroll still types the amount on the payslip." },
  { key: "timesheets.approve", group: "Time", team: true, label: "Approve timesheets", hint: "Approve or return weekly timesheets." },
  { key: "reviews.manage", group: "Performance and hiring", team: true, label: "Run reviews", hint: "Start review cycles, write the final review and read colleague feedback." },
  { key: "okrs.manage", group: "Performance and hiring", team: false, label: "Company OKRs", hint: "Set company objectives and key results, and change any team's." },
  { key: "goals.view", group: "Performance and hiring", team: true, label: "See goals", hint: "Read the goals of the people in scope." },
  { key: "offers.approve", group: "Performance and hiring", team: false, label: "Approve offers", hint: "Approve or return an offer letter someone else prepared, before it goes to the candidate." },
  { key: "hiring.manage", group: "Performance and hiring", team: false, label: "Run hiring", hint: "Openings, candidates and interviews." },
  { key: "probation.manage", group: "Performance and hiring", team: true, label: "Decide probation", hint: "Confirm, extend or end probation." },
  { key: "exit.manage", group: "Performance and hiring", team: true, label: "Exit interviews and notice", hint: "Exit interviews, resignations and notice periods." },
  { key: "expenses.approve", group: "Money", team: true, label: "Approve expenses", hint: "Decide expense claims." },
  { key: "budgets.approve", group: "Money", team: true, label: "Approve budgets", hint: "Decide budget requests." },
  { key: "advances.approve", group: "Money", team: true, label: "Approve advances", hint: "Decide salary advance requests." },
  { key: "payroll.view", group: "Money", team: true, label: "See salaries", hint: "Salaries, payslips and payroll lines of the people in scope." },
  { key: "payroll.prepare", group: "Money", team: false, label: "Prepare payroll", hint: "Create and calculate payroll runs, adjustments and tax rules." },
  { key: "payroll.approve", group: "Money", team: false, label: "Approve payroll", hint: "Check and approve a payroll run someone else prepared." },
  { key: "payroll.bank", group: "Money", team: false, label: "Bank details and bank file", hint: "Change salary bank accounts and download the bank file." },
  { key: "finance.view", group: "Money", team: false, label: "See finance reports", hint: "Statutory dues, journal, cost, gratuity and tax statements. Read only." },
  { key: "finance.contractors", group: "Money", team: false, label: "Record contractor payments", hint: "Add and remove contractor payments for the TDS return." },
  { key: "engage.manage", group: "Company", team: false, label: "Company posts and pages", hint: "Posts, polls, articles, app links, surveys and training." },
  { key: "rewards.give", group: "Company", team: false, label: "Give rewards", hint: "Give a person a reward from the Users page." },
  { key: "celebrations.manage", group: "Company", team: false, label: "Celebrations", hint: "Birthday and welcome posters emailed to everyone." },
  { key: "festivals.manage", group: "Company", team: false, label: "Festivals", hint: "The festival look and festival dates." },
  { key: "helpdesk.answer", group: "Company", team: false, label: "Answer the helpdesk", hint: "Read and answer everyone's helpdesk tickets." },
  { key: "assets.manage", group: "Admin", team: false, label: "Company assets", hint: "Laptops, phones and who has them." },
  { key: "tools.manage", group: "Admin", team: false, label: "Tool access", hint: "Claude and other tool access for staff." },
  { key: "users.manage", group: "Admin", team: false, label: "Logins", hint: "Create, invite, reset and remove logins." },
  { key: "audit.view", group: "Admin", team: false, label: "Audit log", hint: "Read the record of every change." },
];
export const PERM = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p]));
export const GROUPS = [...new Set(PERMISSIONS.map((p) => p.group))];
/** The permissions that show salaries, payslips, bank details, tax and finance figures: the salary owners only. */
// Since 2026-11-27 every other payment too (the salary owner's decision): expense claims, advances and loans, budgets and
// contractor payments. Each person still sees and files their own; deciding and seeing anyone else's is the salary owners' alone.
export const SALARY_PERMS = new Set(["payroll.view", "payroll.prepare", "payroll.approve", "payroll.bank", "finance.view",
  "expenses.approve", "advances.approve", "budgets.approve", "finance.contractors"]);

/** Quick-fill sets on the Access page. They only tick boxes; nothing named is stored. */
export const PRESETS = {
  hr: { label: "HR team", scope: "company", perms: PERMISSIONS.map((p) => p.key).filter((k) => !SALARY_PERMS.has(k)) },
  it: { label: "IT", scope: "company", perms: ["assets.manage", "tools.manage"] },
  teamHead: { label: "Team head (their team)", scope: "tree", perms: ["leave.approve", "attendance.view", "timesheets.approve", "goals.view", "reviews.manage", "overtime.approve"] },
};

const DEFAULT_SALARY_OWNERS = "chintan@wohlig.com,chirag@wohlig.com,kailash@wohlig.com";   // decided 2026-11-27
/** The salary owners, from SALARY_OWNERS (comma separated); chintan@wohlig.com, chirag@wohlig.com and kailash@wohlig.com when it is not set. Read each time, so tests can set it. */
export function salaryOwners() {
  const raw = process.env.SALARY_OWNERS === undefined || process.env.SALARY_OWNERS.trim() === "" ? DEFAULT_SALARY_OWNERS : process.env.SALARY_OWNERS;
  return [...new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => EMAIL.test(s)))];
}
export const isSalaryOwner = (email) => salaryOwners().includes(lc(email));
/** For a salary permission: true or false, decided by the owner list alone. For any other permission: null (the usual rules). */
export function salaryRule(access, perm) {
  if (!SALARY_PERMS.has(perm)) return null;
  return !!access && isSalaryOwner(access.email);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const lc = (s) => String(s || "").trim().toLowerCase();
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Checks one grant from the Access page. Returns { value } or { errors }. `today` is YYYY-MM-DD. */
export function readGrant(body, today) {
  const b = body || {}, errors = {};
  const email = lc(b.email), permission = String(b.permission || ""), scope = b.scope === "tree" ? "tree" : b.scope === "company" ? "company" : "";
  const root = lc(b.scopeRootEmail) || null, expires = b.expiresAt ? String(b.expiresAt) : null, note = String(b.note || "").trim();
  if (!EMAIL.test(email)) errors.email = "Please choose a person.";
  const p = PERM[permission];
  if (!p) errors.permission = "Please choose what they may do.";
  if (!scope) errors.scope = "Please choose the whole company or a team.";
  else if (p && scope === "tree" && !p.team) errors.scope = `"${p.label}" can only be given for the whole company.`;
  if (scope === "tree" && root && !EMAIL.test(root)) errors.scopeRootEmail = "Please choose whose team.";
  if (expires && (!DAY.test(expires) || Number.isNaN(Date.parse(`${expires}T00:00:00Z`)) || expires < today)) errors.expiresAt = "Please choose an end date from today on.";
  if (note.length > 300) errors.note = "Please keep the note under 300 characters.";
  if (Object.keys(errors).length) return { errors };
  return { value: { email, permission, scope, scopeRootEmail: scope === "tree" ? root : null, expiresAt: expires, note } };
}

/** The grants that count today: not removed and not past their end date. */
export function liveGrants(rows, today) {
  return (rows || []).filter((g) => !g.revoked_at && (!g.expires_at || String(g.expires_at).slice(0, 10) >= today));
}

/**
 * Everyone below `root` in the reporting tree, to any depth, as a Set of lower-case emails (not `root` itself).
 * `people` is [{ email, managerEmail }]. A loop in the data cannot hang it: each person is visited once.
 */
export function subtree(people, root) {
  const r = lc(root), kids = new Map();
  for (const p of people || []) {
    const m = lc(p.managerEmail);
    if (!m) continue;
    if (!kids.has(m)) kids.set(m, []);
    kids.get(m).push(lc(p.email));
  }
  const out = new Set(), stack = [...(kids.get(r) || [])];
  while (stack.length) {
    const e = stack.pop();
    if (e === r || out.has(e)) continue;
    out.add(e);
    stack.push(...(kids.get(e) || []));
  }
  return out;
}

/**
 * Whether someone with `access` ({ email, superAdmin, grants }) may use `perm`, and on `target` (an email) when given.
 * `treeOf(root)` returns the Set below a person. Without a target it answers "for anyone at all" (for a page or a menu).
 */
export function decide(access, perm, target, treeOf) {
  if (!access) return false;
  const locked = salaryRule(access, perm);
  if (locked !== null) return locked;
  if (access.superAdmin) return true;
  const mine = (access.grants || []).filter((g) => g.permission === perm);
  if (!mine.length) return false;
  if (mine.some((g) => g.scope === "company")) return true;
  if (target == null) return true;   // holds it for some team
  const t = lc(target);
  return mine.some((g) => treeOf(lc(g.scope_root_email) || lc(access.email)).has(t));
}

/** Who `perm` covers: null for everyone, or a Set of emails (empty when none). */
export function scopeFor(access, perm, treeOf) {
  if (!access) return new Set();
  const locked = salaryRule(access, perm);
  if (locked !== null) return locked ? null : new Set();
  if (access.superAdmin) return null;
  const mine = (access.grants || []).filter((g) => g.permission === perm);
  if (mine.some((g) => g.scope === "company")) return null;
  const out = new Set();
  for (const g of mine) for (const e of treeOf(lc(g.scope_root_email) || lc(access.email))) out.add(e);
  return out;
}

/** decide(), and never on your own request or record. */
export function mayDecideOn(access, perm, owner, treeOf) {
  if (!access) return false;
  if (lc(owner) === lc(access.email)) return decidesOwn(access, perm);
  return decide(access, perm, owner, treeOf);
}

/**
 * The one exception to "nobody decides their own request": with a single salary owner there is nobody else who may decide a
 * payment (salary permissions are theirs alone), so they decide their own claims, loans, advances and budgets. With two or more
 * owners, another owner has to.
 */
export const decidesOwn = (access, perm) => !!access && SALARY_PERMS.has(perm) && salaryOwners().length === 1 && isSalaryOwner(access.email);

/**
 * The grants that reproduce what someone could do before access existed, so day one changes nothing:
 * HR logins get the HR team set, IT admins assets and tools, payroll reviewers payroll approval, the accountant finance reports.
 */
export function grantsFromRoles(user, { reviewers = [], financeViewers = [] } = {}) {
  const email = lc(user.email), set = new Set();
  if (user.role === "hr") PRESETS.hr.perms.forEach((k) => set.add(k));
  if (user.it_admin) PRESETS.it.perms.forEach((k) => set.add(k));
  // Payroll reviewers and the accountant used to get payroll approval and finance reports here; salaries are now the salary
  // owners' alone (SALARY_OWNERS), so those lists give nothing. The options are kept so older callers still work.
  void reviewers; void financeViewers;
  return [...set].map((permission) => ({ email, permission, scope: "company" }));
}

/** What /api/me sends: each permission held, as "company" or the list of team roots. Super admins hold everything for the company. */
export function summary(access) {
  if (!access) return {};
  const owner = isSalaryOwner(access.email);
  const salary = owner ? Object.fromEntries([...SALARY_PERMS].map((k) => [k, "company"])) : {};
  if (access.superAdmin) return { ...Object.fromEntries(PERMISSIONS.filter((p) => !SALARY_PERMS.has(p.key)).map((p) => [p.key, "company"])), ...salary };
  const out = { ...salary };
  for (const g of access.grants || []) {
    if (SALARY_PERMS.has(g.permission)) continue;
    if (g.scope === "company") out[g.permission] = "company";
    else if (out[g.permission] !== "company") (out[g.permission] ||= []).push(lc(g.scope_root_email) || lc(access.email));
  }
  return out;
}
