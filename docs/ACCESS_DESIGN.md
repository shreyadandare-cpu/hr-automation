---
title: Access hierarchy design
updated: 2026-11-28
---

> [!info] Status
> Phases 1 to 4 are built: super admins, the access tables and rules, emails for reporting lines, the sign-in fixes, the Access page,
> every server check on `access.js` (self-approval refused everywhere), the menu and pages on `useAuth().can`, notices to permission
> holders, role changes kept in step with grants, and sign-in links for existing logins sent to the work email only.
> Leave rule (user decision, 2026-11-19): only someone above the person in the reporting lines, or a super admin, decides a
> leave request; never the person themselves.
> Phase 5 is done too: `users.role` is only a label kept in step with the HR access set; "HR staff" for leave routing means
> anyone who approves leave for the whole company; PAYROLL_REVIEWERS and FINANCE_VIEWERS are read once, at the first start.

# Wohlig One: super admins, ticked permissions and the reporting-tree hierarchy

## Context

Access today is two stored roles (`hr`, `employee`) plus five side channels: `users.it_admin`, `PAYROLL_REVIEWERS` and
`FINANCE_VIEWERS` env lists, `HR_LEAVE_APPROVERS`, and "manager" worked out by matching **names** in `employees.manager`.
The checks are copied across the server (about 240: `requireHr` ×52, local `isHr` ×101 in 13 files, `hrOnly` ×57 in four
different versions, raw `role === "hr"` ×28) and the frontend (`isHr` ×198 in 47 files). The RBAC audit found the gaps this
causes: HR approving their own requests, leavers signing back in, deleted logins coming back, the accountant editing contractor
payments, managers matched by name.

What the user wants, with their answers:
- **Super admins: Chintan, Chirag, Jagruti and Pratik Sawant.** Full control, and the only people who give access. Current HR (Priyal, Shreya)
  become people with HR permissions.
- **Teams = the reporting tree.** A person's team is everyone below them in the manager chain, to any depth.
- **Access = permissions ticked per person**, each tick with a scope: the whole company, or a reporting tree.
- **Salaries and payroll only with a payroll permission**, which can be given for a team.

Outcome: one place that decides every "may this person do this to that person?", one screen where super admins tick access,
and a hierarchy that is reliable because it is built on emails, not names.

## Design

### Data (all additive; `schema.sql` stays re-runnable)
1. **`employees.manager_email`** (expand, migrate, switch; `manager` name kept and written alongside until the contract step).
   One-time backfill in an `app_migrations` block from the current name match. Names that match two people are left empty and
   listed for HR on the Employees page ("Choose the manager"). `applyManager` (people.js) and onboarding write both columns.
   Index on `lower(manager_email)`.
2. **`users.is_super_admin BOOLEAN NOT NULL DEFAULT false`**. One-time block sets it for chintan@, chirag@, jagruti@ and
   pratik.sawant@ (creating their login if missing; the list lives in one constant so it is easy to change). Rules: at least one super admin always; only a super admin can add or remove one; if none exists at
   boot, `HR_ADMIN_EMAIL` becomes one (replaces today's HR bootstrap).
3. **`access_grants`**: `id, email, permission, scope ('company'|'tree'), scope_root_email (null = the grantee's own tree),
   granted_by, granted_at, expires_at null, revoked_at, revoked_by, note`. Partial unique index on
   `(lower(email), permission, scope, coalesce(lower(scope_root_email),''))` where `revoked_at is null`; index on `lower(email)`.
   Revoking keeps the row (history). Every change also goes to `audit_log` with the actor.
4. **`users.login_blocked BOOLEAN NOT NULL DEFAULT false`**: deleting or offboarding sets it; sign-in and sessions refuse it.

### Permission catalogue (code, not data) in a new `backend/src/access-rules.js`
Each permission has a group, a plain label for the screen, and whether it may be scoped to a tree.
- **People:** `people.view` (personal details), `people.edit` (manager, status, employee no., add to team), `onboarding.manage`*,
  `offboarding.manage`*, `documents.view`
- **Time:** `leave.approve`, `leave.manage`* (holidays, policy, salary cuts), `attendance.view`, `attendance.edit`,
  `timesheets.approve`
- **Performance and hiring:** `reviews.manage`, `goals.view`, `hiring.manage`*, `probation.manage`, `exit.manage`
- **Money:** `expenses.approve`, `budgets.approve`, `advances.approve`, `payroll.view` (salaries, team-scopable),
  `payroll.prepare`*, `payroll.approve`*, `payroll.bank`*, `finance.view`*, `finance.contractors`*
- **Company:** `engage.manage`* (posts, polls, articles, apps, surveys, training), `celebrations.manage`*,
  `festivals.manage`*, `helpdesk.answer`*
- **Admin:** `assets.manage`*, `tools.manage`* (Claude), `users.manage`* (logins, invites), `audit.view`*

`*` = company-wide only. Giving access is not a permission: super admins only.

**Built in, no tick needed (same as today):** everyone acts on their own records; a manager approves leave and timesheets of
their direct reports and sees their team's attendance, goals and reviews (direct reports today; becomes the whole tree only if
ticked). Stand-ins keep working as now.

**Quick-fill buttons** on the screen only tick boxes (nothing named is stored): "HR team", "Payroll", "Accountant",
"IT", "Team head (their tree)".

### One decision engine: `backend/src/access.js` (+ pure `access-rules.js`, tested without a database)
- `loadSession` loads `{ superAdmin, grants }` once per request into `req.access` (one query, joined with the session lookup).
- `treeOf(rootEmail)`: everyone under a person, from a recursive query on `manager_email`, cached in memory for 60 s and
  cleared whenever a manager changes.
- `can(req, perm, targetEmail?)`: super admin → yes; a `company` grant → yes; a `tree` grant → target is in that tree.
- `scopeOf(req, perm)` → `null` (everyone) or a set of emails, for filtering lists in SQL (`= ANY($n)`).
- `need(perm)` middleware for whole routes; `mayDecide(req, perm, ownerEmail)` = `can(...)` and **never your own request**
  (fixes the self-approval gap everywhere decisions happen: leave, timesheets, advances, attendance requests, expenses, budgets,
  reviews, tax proofs).

### Moving the existing roles across without changing anyone's access on day one
A one-time block writes grants that reproduce today exactly:
- every `role='hr'` user → the "HR team" set, company-wide
- `it_admin` → `assets.manage`, `tools.manage`
- each `PAYROLL_REVIEWERS` email → `payroll.view` + `payroll.approve` (company)
- each `FINANCE_VIEWERS` email → `finance.view` (read only; `finance.contractors` stays HR, fixing the audit gap)
- `HR_LEAVE_APPROVERS` stays as the approvers of HR staff's own leave; they are super admins anyway.

The env lists are read only by that block, then removed from `.env.example` and the code in the last phase.

### Frontend
- `GET /api/me` adds `superAdmin` and `access: { perm: "company" | ["email", ...] }`. `useAuth()` gains `can(perm)`.
  `isHr` stays for now as "holds any HR-team permission", so the 47 files keep working while they are converted.
- `lib/menu.js` builds each section from `can()`; the `App.jsx` `HR_ONLY` list becomes a per-route permission.
- **New page: Company > Access** (super admins only; a new lazy page per the speed rule):
  - **People tab:** each person with a summary of their access. Opening one shows a sheet with ticks grouped as above. Each
    tick has a scope: "Whole company", "Their team", or "Team under…" (PeoplePicker). It also shows quick-fill buttons, an
    optional end date, and a history of who gave and removed what.
  - **Super admins tab:** add or remove a super admin, guarded by the rules above.
  - **Who can do what tab:** pick a permission and see everyone who holds it, with the scope.
- The org chart shows a small badge for super admins and for people who hold access over a team.
- Wording follows the brand rules: "Access", "Give access", "Remove access", no technical words.

## Phases (each one ships on its own and leaves the app working)
1. **Foundation, no visible change:** `manager_email` (expand + backfill + dual write, `teams.js` and `OrgChart` switched to it),
   the `is_super_admin`/`access_grants`/`login_blocked` tables, `access.js` + `access-rules.js` with tests, the role mapping
   block, `/api/me` access, `useAuth().can`. Also fix the sign-in gaps from the audit: refuse `offboarding` and blocked people
   in `accountForSignIn` and `loadSession`; deleting a login sets `login_blocked`; the last-HR race becomes one guarded UPDATE.
2. **Access screen** and its API (`GET/POST/DELETE /api/access/...`, super admins only).
3. **Convert the server, module by module**, replacing `requireHr`/`isHr`/`hrOnly` with `need`/`can`/`scopeOf`/`mayDecide`:
   users and access → people, onboarding, offboarding → leave, attendance, timesheets, stand-ins → reviews, goals, hiring,
   probation, exits → expenses, budgets, advances, clearance → payroll and finance → engage, posts, festivals, celebrations,
   helpdesk → assets and Claude tools. Each module comes with its rows in the access test below.
4. **Convert the frontend:** menu, route guards, `canManage` flags, then the `isHr` uses file by file (EmployeePage and the
   employee cards first).
5. **Contract:** stop reading `users.role` and `employees.manager` for decisions, drop the env lists, delete the old helpers,
   and update `ARCHITECTURE.md` (auth section, tables, routes, env vars) and CLAUDE.md.

## Critical files
- New: `backend/src/access.js`, `backend/src/access-rules.js`, `backend/test/access-rules.test.mjs`,
  `backend/test/access-flow.mjs` (needs the local DB, like `invite-flow.mjs`), `frontend/src/modules/access/` (`index.jsx`
  lazy routes, `Access.jsx`).
- Changed: `backend/src/schema.sql` (+ regenerate `migrations/hrhub-schema.sql`), `auth.js` (loadSession, accountForSignIn,
  bootstrap), `users.js` (`/api/me`, role and delete routes), `teams.js` (email joins), `people.js` (`applyManager`, team
  members), `onboarding-routes.js`, `offboarding.js`, then every router listed in phase 3; `frontend/src/auth.jsx`,
  `lib/menu.js`, `App.jsx`, `components/OrgChart.jsx`, `pages/Users.jsx`.
- Reuse: `teams.js` helpers (rebuilt on email), `coveredBy`/`standInsOf`, `PeoplePicker`, `Modal`, `ViewTabs`, `useList`,
  `apiShared`, the `app_migrations` one-time pattern, `audit_log`.

## Design record (per the data-schema rule)
- **Owner:** this repo's `schema.sql`; no other service writes these tables. **Clients:** this backend and frontend only.
- **Class:** additive (A) for the new tables and columns; `manager_email` is expand, migrate, switch, contract (B), with
  `manager` kept until phase 5.
- **Old code keeps working:** `users.role` and `employees.manager` stay filled throughout; `/api/me` only adds keys.
- **Rollback:** before phase 3, ignore the new tables (no reader). After phase 3, every converted check falls back to the
  mapped grants, which match the old roles. Rehearse the backfill on a copy of the local DB first, and never against the
  shared remote database `backend/.env` points to.
- **PII:** grants hold emails only; nothing new to export or erase beyond the existing person records.

## Verification
- `cd backend && npm test`: the new `access-rules` tests cover the catalogue, company-only permissions, tree membership at
  any depth, expiry, revoked grants, the "never your own request" rule, and the role mapping producing today's access.
- `access-flow.mjs` against the local DB (`wohlig-one-local`): signs in as a salary owner, a super admin, the HR team, a team
  head with leave and attendance (and inert salary grants) for their tree, an accountant with an inert finance grant, and a
  plain employee; only the "owner" is ever a salary owner. It calls every endpoint in the matrix and fails on any unexpected
  answer, including another team's member, the caller's own request, and any salary or payment path reached by a non-owner.
- `npm run check:docs`; a `code-review`, then `security-review`, before the pull request (auth change).
- In the browser at the CLAUDE.md sizes, light and dark: the Access page (give, scope, end date, remove, history), the menu
  for each profile, and the org chart badges. Send no emails while testing.
- Work on a new branch (`feat/access-hierarchy`), one pull request per phase, nothing pushed or merged without the user's yes.
