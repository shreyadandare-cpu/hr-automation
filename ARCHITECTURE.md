---
title: Wohlig One (hr-automation) — Architecture
aliases:
  - Wohlig One
  - HR Access Hub
  - hr-automation architecture
  - HR Hub
tags:
  - architecture
  - hr-access-hub
  - wohlig
  - express
  - react
  - postgres
repo: hr-automation
role: Wohlig's internal HR portal — one Express API plus a React interface, on Postgres
updated: 2026-11-23
---

# Wohlig One — Architecture

> [!info] Read this first
> This is the map of the `hr-automation` repo, for people and LLMs. Read it before you open the code.
> The repo holds one Node server ([backend/](backend/)) and one React interface ([frontend/](frontend/)).
> There is no build step for the server and no ORM: routes run SQL directly through `pg`.
> The schema source of truth is [backend/src/schema.sql](backend/src/schema.sql), which the server applies on every start.
> Related docs: [[CLAUDE]] ([CLAUDE.md](CLAUDE.md), working rules) and [[BRAND_GUIDELINES]]
> ([docs/BRAND_GUIDELINES.md](docs/BRAND_GUIDELINES.md), Wohlig brand tokens). Read the brand file before any UI work.
> Also: [backend/docs/DEPLOY-CHECKLIST.md](backend/docs/DEPLOY-CHECKLIST.md), [backend/docs/PAYROLL.md](backend/docs/PAYROLL.md),
> [backend/attendance-bridge/README.md](backend/attendance-bridge/README.md).

## 1. Purpose

Wohlig One (formerly "HR Access Hub") is the staff portal for Wohlig (`@wohlig.com` accounts only). HR uses it to onboard and offboard people,
manage logins, approve leave, run payroll and review expense claims. Employees use it for their profile, documents, leave,
attendance, payslips, reimbursements, the company feed and their Digital Kit (signature, templates, greetings).

## 2. Tech stack

| Layer | What |
|---|---|
| Server | Node 22 (Docker image), ES modules, Express 4, `pg` 8, `dotenv` |
| Server libraries in use | `google-auth-library` (Workspace Admin SDK), `exceljs` (payroll Excel, tax import), `pdfkit` (payslip PDF) |
| Database | PostgreSQL (shared Cloud SQL in practice; `postgres:16` for the optional local container) |
| Interface | React 18, Vite 5, `react-router-dom` 6, Tailwind CSS 4 (`@tailwindcss/vite`) with the Wohlig theme in one stylesheet (older hand-written rules are being moved to Tailwind classes in stages), `radix-ui` for unstyled behaviour (dialog, dropdown menu, popover, tabs, tooltip); no styled UI kit, no state library |
| Email | SendGrid Web API over `fetch` |
| Office connector | Node 20+, `node-zklib`, Windows batch and VBS launchers |
| Tests | `node:test` plus two script-style flow tests |

`@anthropic-ai/sdk` and `nodemailer` are listed in [backend/package.json](backend/package.json) but no file imports them.

## 3. How it runs

### Local development

```
cd backend && cp .env.example .env    # fill in the values
npm install && npm run build:ui       # builds frontend/dist
npm run dev                           # node --watch src/index.js, http://localhost:3000
cd ../frontend && npm run dev         # optional: Vite on 5173, proxies /api, /auth, /invite to the server
```

Express serves everything on one origin: the API, `/login`, `/app/*` from `frontend/dist`, and the logos from `frontend/public`.
`frontend/dist` is committed, so the server works without a build.

### Docker

`docker compose up --build` gives `http://localhost:8080` ([docker-compose.yml](docker-compose.yml)).

| Service | Image | Job |
|---|---|---|
| `frontend` | [frontend/Dockerfile](frontend/Dockerfile), nginx 1.27 | Serves the built interface and `public/`; proxies `/api/`, `/auth/`, `/invite/`, `/l/`, `/p/` to the backend ([frontend/nginx.conf.template](frontend/nginx.conf.template)). Port 8080 to 80. |
| `backend` | [backend/Dockerfile](backend/Dockerfile), built from the repo root | The API on port 3000. Uploads live in the `hrhub-uploads` volume at `/srv/uploads`. |
| `db` | `postgres:16`, profile `local-db` only | A throwaway local database on 5432. |

In Docker, nginx decides who sees a page: it asks `GET /api/me` through `auth_request` and shows `/login` on a 401.

### Environment variable names

Values live in `backend/.env` (never committed). Names from [backend/.env.example](backend/.env.example):

- Core: `PORT`, `DATABASE_URL`, `DB_SCHEMA`, `SEED_ROSTER`, `BACKGROUND_JOBS`, `PUBLIC_URL`, `FRONTEND_URL`, `ALLOWED_EMAIL_DOMAIN`
- Speed: `DB_POOL_MAX` (database connections kept open, default 15), `DB_STATEMENT_TIMEOUT_MS` (longest one query may run, default 20000), `SLOW_REQUEST_MS` (log any /api request slower than this, default 400)
- Accounts: `DEFAULT_PASSWORD`, `HR_ADMIN_EMAIL`, `HR_LEAVE_APPROVERS`, `ALLOW_PASSWORD_LOGIN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
- Google Workspace: `GOOGLE_SERVICE_ACCOUNT_FILE`, `GOOGLE_ADMIN_EMAIL`, `GOOGLE_SKU_STARTER`, `GOOGLE_SKU_BUSINESS`, `GOOGLE_PRODUCT_ID`
- Email: `SENDGRID_API_KEY`, `SENDGRID_EU`, `MAIL_FROM`, `MAIL_SKIP_RECIPIENTS`
- Reimbursements: `REIMB_REMINDER_DAYS`, `REIMB_NO_RECEIPT_MAX`, `OCR_PROVIDER`
- Claude access: `ANTHROPIC_ADMIN_KEY`, `ANTHROPIC_INVITE_ROLE`
- Attendance: `ATTENDANCE_DEVICE_KEY`, `PORTAL_ATTENDANCE_SYNC`, `PORTAL_ATTENDANCE_SYNC_SECONDS`, `WEB_CLOCK_IN` (true lets everyone punch in and
  out from the app; off by default, so the office machine stays the record)
- AI (LinkedIn headline ideas in the Digital Kit): `GEMINI_API_KEY`, `GEMINI_MODEL`
- Gmail Intelligence Engine (project emails to weekly report facts): `GMAIL_INTEL_ENABLED`, `GMAIL_COMPANY_DOMAIN`, `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUSH_TOKEN`, `GMAIL_SYNC_MINUTES`, `ANTHROPIC_API_KEY` (a normal Claude key, separate from the admin key), `GMAIL_CLASSIFY_MODEL`, `GMAIL_EXTRACT_MODEL`, `GMAIL_PRICE_CLASSIFY`, `GMAIL_PRICE_EXTRACT`. It also reads `GOOGLE_SERVICE_ACCOUNT_FILE` and optional `OFFICE_LOCATION` (the work location saved when HR marks someone On-site, default Office)
- Payroll: `PAYROLL_DATABASE_URL`, `PAYROLL_DB_SCHEMA`, `PAYROLL_REVIEWERS`, `FINANCE_VIEWERS` (the accountant: finance reports only), `NOTICE_PERIOD_DAYS` (default notice, 30), `PAYROLL_ENCRYPTION_KEY`, `PAYROLL_DEBIT_ACCOUNT`, `PAYROLL_DEBIT_BANK_CODE`, `PAYSLIP_AUTO`.

The code also reads these, which the example file does not list: `UPLOAD_DIR`, `MAIL_REPLY_TO`, `EMAIL_LINK_MINUTES`,
`LEAVE_APPROVAL_LINK_HOURS`, `LEAVE_DIGEST_HOUR`, `LEAVE_DIGEST_SEND_EMPTY`, `LEAVE_DIGEST_EMAILS`, `LEAVE_HR_EMAILS`,
`CLAUDE_ADMIN_EMAILS`, `CLAUDE_REMIND_DAYS`, `PAYSLIP_AUTO_FROM`, `ANTHROPIC_API_URL` (test override).

The connector has its own file, [backend/attendance-bridge/.env.example](backend/attendance-bridge/.env.example):
`DEVICE_IP`, `DEVICE_PORT`, `DEVICE_NAME`, `APP_URL`, `DEVICE_KEY`, `INTERVAL_SECONDS`, `SYNC_FROM`.

Most integrations have a simulated mode when their settings are empty: Google Workspace, Claude access, email and device sync.

## 4. Runtime diagram

```mermaid
flowchart LR
  B[Browser<br/>login page + React app]
  subgraph Host
    N[nginx<br/>Docker only]
    E[Express server<br/>backend/src/index.js]
    U[(Upload folder<br/>UPLOAD_DIR)]
  end
  PG[(PostgreSQL<br/>schema DB_SCHEMA)]
  PP[(Payroll DB<br/>optional, PAYROLL_DATABASE_URL)]
  GO[Google OAuth<br/>sign-in]
  GW[Google Workspace<br/>Admin SDK + Licensing]
  SG[SendGrid Web API]
  AN[Anthropic Admin API<br/>organization invites]
  subgraph Office network
    BR[attendance-bridge<br/>bridge.mjs]
    DV[eSSL / ZKTeco device]
  end

  B --> N --> E
  B -. without Docker .-> E
  E --> PG
  E --> PP
  E --> U
  E --> GO
  E --> GW
  E --> SG
  E --> AN
  BR -- reads --> DV
  BR -- "POST /api/attendance/device/punches<br/>Bearer device key" --> E
```

The Anthropic link is the Admin API called with `fetch` in [backend/src/anthropic.js](backend/src/anthropic.js): it invites
people to the Claude organization and removes them. The app does not call a Claude model anywhere.

## 5. Directory map

```
hr-automation/
├── docker-compose.yml          frontend (nginx) + backend + optional db
├── .claude/settings.json       shared Claude Code hook: checks this file at the end of each turn
├── docs/                       BRAND_GUIDELINES.md and the brand PDF
├── backend/
│   ├── src/                    the server: index.js plus one file per feature
│   │   ├── index.js            app set-up and route mounts only (routes live in their own files)
│   │   ├── schema.sql          every table; applied on each start
│   │   └── payroll/            payroll workflow (routes, engine, tax, bank file, Excel, own schema.sql)
│   ├── migrations/hrhub-schema.sql   generated copy of schema.sql for a SQL console
│   ├── scripts/                one-off and operations scripts (migrate, imports, relay, check-architecture)
│   ├── seed/                   roster.json (first-run staff list) and digital-kit/ official files
│   ├── test/                   unit tests (*.test.mjs) and flow tests
│   ├── docs/                   DEPLOY-CHECKLIST.md, PAYROLL.md
│   └── attendance-bridge/      office connector for the attendance device (separate package)
└── frontend/
    ├── index.html, login.html  the two Vite entry pages
    ├── leave-rules.cjs         leave rules shared by server and browser
    ├── nginx.conf.template     nginx config for the Docker image
    ├── public/                 logos, favicons, sig/ icons; served at the site root
    ├── dist/                   committed build output
    └── src/                    App.jsx, pages/, modules/, components/, login/, lib/
```

## 6. Backend

### Layering

There are no controller, service or repository layers. Each feature file in [backend/src/](backend/src/) holds its routes,
its SQL and its helpers, and exports a router. [backend/src/index.js](backend/src/index.js) (about 110 lines) only wires
them together: middleware, the routers in order, start-up and the background jobs. [backend/src/db.js](backend/src/db.js) exports `pool`
(main database) and `payPool` (payroll database, the same pool unless `PAYROLL_DATABASE_URL` is set).

Mount order matters. `security.js` runs first (security headers, then the same-origin check on changes). The documents and
Digital Kit routers are mounted before `express.json()` because they read raw file bodies. `accountRouter` makes every
later `/api` route require sign-in. The pages router comes last. The JSON body limit is 100 kb. `trust proxy` is set from
`TRUST_PROXY` (default 1), so `req.ip` is the caller behind nginx or Cloud Run.

### Routers and modules

| File | Mount | Job |
|---|---|---|
| [users.js](backend/src/users.js) | `/api` (`sessionRouter`, `accountRouter`), `/api/users` | Password login (testing only), logout, invite acceptance, `/api/me`, HR user management |
| [google-signin.js](backend/src/google-signin.js) | `/auth` | Google OAuth code flow with PKCE |
| [onboarding-routes.js](backend/src/onboarding-routes.js) | `/api/onboarding/*`, `/api/work-email` (HR only) | New joiners: draft, work email, Google account, first login, final record |
| [id-card.js](backend/src/id-card.js) | `/api/id-card.pdf`, `/api/id-cards.pdf` | Staff ID cards as CR80 PDFs (85.6 × 54 mm, front and back): own for everyone, anyone's in scope with `people.view`, all current staff for `people.view` company-wide |
| [people.js](backend/src/people.js) | `/api/directory`, `/api/roster`, `/api/managers`, `/api/employees/{manager,number,status}`, `/api/team/members` | Who is at the company, reporting lines, employee IDs |
| [projects.js](backend/src/projects.js) | `/api/allocations`, `/api/projects` | Projects and who works on them; handovers |
| [tool-access.js](backend/src/tool-access.js) | `/api/audit`, `/api/tool-access` | The audit log and Claude access |
| [pages.js](backend/src/pages.js) | `/`, `/login`, `/app/*`, `/auth`, `/invite`, `/l`, `/p`, `/sig`, logos, `/leave-rules.js` | The pages and public links; mounted last |
| [jobs.js](backend/src/jobs.js) | none (timers) | Every scheduled job; started unless `BACKGROUND_JOBS=off` |
| [security.js](backend/src/security.js) | every request | Security headers; refuses changes (POST, PUT, PATCH, DELETE) sent from another website |
| [limits.js](backend/src/limits.js) | none | Sign-in lockout and rate limits, kept in the `rate_limits` table |
| [invites.js](backend/src/invites.js) | `/invite` | One-time 30-minute invite links |
| [email-links.js](backend/src/email-links.js) | `/l` | Short-lived links used in automatic emails |
| [profile.js](backend/src/profile.js) | `/api/profile` | "My profile" sections and profile photo |
| [documents.js](backend/src/documents.js) | `/api/documents` | Personal document uploads; owns `UPLOAD_DIR` |
| [digital-kit.js](backend/src/digital-kit.js) | `/api/digital-kit` | Each person's kit; HR manages shared resources under `/admin` |
| [gemini.js](backend/src/gemini.js) | none | LinkedIn headline ideas from Gemini for the Digital Kit. Sends only designation, department and an optional note; cleans the replies |
| [holiday-import.js](backend/src/holiday-import.js) | none (used by leave.js) | Reads an Excel or CSV holiday list (any year) into holidays, compares it with the saved list, builds the template |
| [leave.js](backend/src/leave.js) | absolute `/api/leave/*`, `/api/employees/:email/pay` | Leave requests, decisions, comp offs, holidays, salary cuts |
| [leave-digest.js](backend/src/leave-digest.js) | `/api/leave/digest` | Daily "who is on leave" email to HR |
| [leave-mail.js](backend/src/leave-mail.js), [teams.js](backend/src/teams.js) | none | Leave emails; who approves whose leave |
| [attendance.js](backend/src/attendance.js) | `/api/attendance` | Today, month, day, report, manual punches |
| [device.js](backend/src/device.js) | `/api/attendance/device/*` | Punch intake from the connector; linking device IDs to people |
| [portal-attendance.js](backend/src/portal-attendance.js) | none (timer) | Copies punches from the Employee Portal's table when enabled |
| [gmail-intel.js](backend/src/gmail-intel.js) | none (library) | Reads and filters project emails, asks Claude Haiku to sort them and Claude Sonnet to extract facts, validates every reply |
| [gmail-api.js](backend/src/gmail-api.js) | none (library) | Read-only Gmail through the service account's domain-wide delegation (`gmail.readonly` only) |
| [gmail-intel-routes.js](backend/src/gmail-intel-routes.js) | `/api/gmail-intel/*`, `/api/project-reports/*` | Mailbox list, sync, review queue and AI usage (HR); Pub/Sub push (token); weekly project reports with email (everyone sees their own projects, HR sees all) |
| [assets.js](backend/src/assets.js) | `/api/assets` | Company assets; IT admins and HR |
| [posts.js](backend/src/posts.js) | `/api/posts` | Company feed: posts, images, likes, comments, shares |
| [engage.js](backend/src/engage.js), [engage-rules.js](backend/src/engage-rules.js) | `/api/polls`, `/api/praise`, `/api/rewards`, `/api/articles`, `/api/apps`, `/api/requests/advance`, `/api/requests/attendance`, `/api/remote-today`, `/api/tax-declaration`, `/api/tax-declarations`, `/api/goals` | Polls (one vote each, totals only), praise between colleagues, rewards (`rewards.give` gives one from Users; people read their own on Praise > My rewards), HR articles, app links, and advance and attendance requests that HR approves or declines. The checking rules are in `engage-rules.js`, tested without a database |
| [hr-tools.js](backend/src/hr-tools.js), [hr-tools-rules.js](backend/src/hr-tools-rules.js) | `/api/hr/probations`, `/api/tickets`, `/api/hr/exit-interviews`, `/api/hr/openings`, `/api/hr/candidates`, `/api/reviews`, `/api/review-cycles`, `/api/feedback-requests`, `/api/interviews` | HR tools: probation decisions, the helpdesk, exit interviews, hiring and performance reviews. Probation, exit interviews and hiring are HR only; people see only their own tickets and reviews. Rules in `hr-tools-rules.js`, tested without a database |
| [hr-tools.js](backend/src/hr-tools.js), continued | `/api/review-cycles`, `/api/reviews/:id/manager`, `/api/reviews/:id/feedback-requests`, `/api/feedback-requests`, `/api/hr/candidates/:id/onboard`, `/api/hr/candidates/:id/interviews`, `/api/hr/interviews/:id/cancel`, `/api/interviews`, `/api/interviews/:id/verdict`, `/api/interviews/:id/calendar` | Review cycles for everyone or a department, the reporting manager's review between the self-review and HR, colleague feedback the person never sees, managers reading their team's goals (`/api/goals?email=`), a hired candidate copied into the HR user's onboarding draft, and interviews with each interviewer's recommendation and a calendar file (.ics) |
| [workforce.js](backend/src/workforce.js), [workforce-rules.js](backend/src/workforce-rules.js) | `/api/timesheet`, `/api/timesheets/to-approve`, `/api/timesheets/:id/decision`, `/api/surveys`, `/api/training`, `/api/trainings`, `/api/hr/resignations`, `/api/stand-ins` | Timesheets (a week per person, approved by the reporting manager, a stand-in covering them, or HR), surveys (named or anonymous; HR creates them and sees results), training (HR assigns, people mark done), notice periods (HR records resignations; expected last day = resigned on + notice days) and approval stand-ins (someone who decides leave for a manager while they are away). `workforce-rules.js` holds the checking rules, also for review cycles, colleague feedback and interviews (used by `hr-tools.js`), and timesheet minutes per project (used by `finance-reports.js`); tested without a database. Design: [docs/HR_GAPS_DESIGN.md](docs/HR_GAPS_DESIGN.md) |
| [finance-reports.js](backend/src/finance-reports.js), [finance-rules.js](backend/src/finance-rules.js) | `/api/finance/periods`, `/api/finance/statutory`, `/api/finance/journal`, `/api/finance/cost`, `/api/finance/gratuity`, `/api/finance/tax-statements`, `/api/finance/tax-statements/:email`, `/api/finance/files`, `/api/finance/tds-sheet`, `/api/finance/shares`, `/api/finance/contractors` | Open to HR, payroll reviewers and the accountant (`FINANCE_VIEWERS`, who see only this). Also: employer ESIC (3.25%, worked out in the report), labour welfare fund for Maharashtra in June and December, the PF return (ECR) text file, the ESIC contribution sheet, a Tally import file for the journal, a TDS sheet per quarter, project shares in per cent (HR sets them; `employee_project_allocations.share_percent`) and contractor payments with TDS (`contractor_payments`). Finance reports for the accountant, read from payroll that is already calculated: statutory dues (PF, ESIC, professional tax, TDS) with due dates, the month as one balanced journal entry, cost by department and project, a gratuity estimate, and the year's salary and TDS per person and per quarter. Open to HR and the payroll reviewers. Nothing here writes to payroll. `finance-rules.js` also checks HR's proof notes on tax declarations (`PUT /api/tax-declarations/:email/proofs` in engage.js) |
| [workforce.js](backend/src/workforce.js), [workforce-rules.js](backend/src/workforce-rules.js) | `/api/timesheet`, `/api/timesheets/to-approve`, `/api/timesheets/:id/decision`, `/api/surveys`, `/api/surveys/:id/answers`, `/api/surveys/:id/results`, `/api/training`, `/api/trainings`, `/api/hr/resignations`, `/api/stand-ins` | Timesheets (a week of hours per project; the reporting manager, a stand-in or HR approves; approved hours set cost by project), surveys (anonymous by default, results hidden below 3 answers, eNPS), training records, notice periods (resignation date plus notice days, short notice flagged) and approval stand-ins (cover a manager's leave approvals; `teams.js` `coveredBy`, used by `leave.js` and `leave-mail.js`). Design: [docs/HR_GAPS_DESIGN.md](docs/HR_GAPS_DESIGN.md) |
| [celebrations.js](backend/src/celebrations.js) | `/api/celebrations`, `/p` | Birthday and welcome posters emailed by HR; public poster picture |
| [access.js](backend/src/access.js), [access-rules.js](backend/src/access-rules.js), [access-routes.js](backend/src/access-routes.js) | `/api/access/people`, `/api/access/people/:email/history`, `/api/access/grants`, `/api/access/super-admins/:email` | Super admins only: who may do what, for the company or a reporting tree; give and remove access; add and remove super admins. Every change is audited and kept as history |
| [tools.js](backend/src/tools.js), [tools-rules.js](backend/src/tools-rules.js) | `/api/tools`, `/api/tools/:slug`, `/api/tools/:slug/seats`, `/api/tools/costs`, `/api/tools/:slug/bills`, `/api/tools/bills/:id` | Every paid tool (AI assistants and others): who has a seat, price per seat, monthly bills, cost per tool, department and currency (₹ and $ apart). Tool access manages; finance sees cost. Design: [docs/TOOLS_DESIGN.md](docs/TOOLS_DESIGN.md) |
| [festivals.js](backend/src/festivals.js) | `/api/festivals`, `/api/festival-look` (public), `PUT /api/festivals/look`, `POST /api/festivals/:slug/dates`, `DELETE /api/festivals/:slug/dates/:day` | Festival list and dates (HR adds and removes dates on Festival wishes > Festival dates; a year back to five years ahead); share a greeting; the festival look (from `festivalLook.daysBefore` days before a festival through the day, the sign-in page and the dashboard banner show its scene; HR switches it off with the `settings` key `festival_look`; `?preview=<slug>` previews one) |
| [brand.js](backend/src/brand.js) | none | Reads [frontend/brand.config.json](frontend/brand.config.json) (product name, company names, colours) for emails, PDFs, Excel files and the sign-off. The Docker image copies the file in |
| [reimbursements.js](backend/src/reimbursements.js) | `/api/reimbursements` | Expense claims, receipts, review workflow; [extract.js](backend/src/extract.js) reads invoice PDFs |
| [budgets.js](backend/src/budgets.js) | `/api/budget-requests` | Pre-approved spending requests |
| [payroll/routes.js](backend/src/payroll/routes.js) | `/api/payroll` | Payroll runs, review workflow, bank details, tax rules, adjustments |
| [payslip-auto.js](backend/src/payslip-auto.js), [payroll.js](backend/src/payroll.js) | `/api/payroll` (HR only) | Automatic monthly draft, publish, salary structures, mark paid |
| [payslips.js](backend/src/payslips.js) | `/api/payslips` | A person's own payslips and PDF |
| [offboarding.js](backend/src/offboarding.js) | `/api/offboarding` | Offboarding records, steps, scheduled runs |
| [clearance.js](backend/src/clearance.js) | `/api/offboarding/.../clearance`, `/api/advances` | Final settlement figures and employee advances |
| [claude-requests.js](backend/src/claude-requests.js) | `/api/claude-requests` | Queue of Claude access requests when no admin key is set |
| [anthropic.js](backend/src/anthropic.js) | none | Anthropic Admin API calls and sync into `tool_access` |
| [google.js](backend/src/google.js), [mail-plan.js](backend/src/mail-plan.js) | none | Create Workspace users, assign licences |
| [notify.js](backend/src/notify.js) | `/api/notifications` | Bell notifications; `sendEmail` with outbox logging |
| [mail.js](backend/src/mail.js) | none | SendGrid call, `publicUrl()`, `frontendUrl()` |
| [connectors.js](backend/src/connectors.js) | none | Stand-in tool-removal connectors (nothing real is touched) |
| [validate.js](backend/src/validate.js), [employee-no.js](backend/src/employee-no.js), [sheet.js](backend/src/sheet.js), [payroll-calc.js](backend/src/payroll-calc.js) | none | Validation and masking, employee ID series, xlsx read and write, payslip maths |

Payroll internals in [backend/src/payroll/](backend/src/payroll/): `access.js` (who may see payroll, AES-256-GCM `seal`/`open`),
`workflow.js` (status machine), `engine.js`, `tax.js`, `tax-defaults.js`, `tax-import.js`, `bank.js`, `excel.js`,
`payslip-read.js`, `store.js`.

### Auth, sessions and roles

- Sign-in is Google OAuth at `/auth/google`. Password login works only when `ALLOW_PASSWORD_LOGIN=true`.
- **Leave balances brought over** (`employees.leave_opening`, [backend/scripts/import-leave-balances.mjs](backend/scripts/import-leave-balances.mjs)): to start from the days people have left in another leave system (for example a Keka balance report), `{ asOf, casual, sick, compoff }` is saved per person. In that year each balance starts from the figure on that day and only leave on later dates comes off it; a casual balance carries into the next year as usual (`leave-rules.cjs`). The script is a dry run by default, `--apply` saves it in one transaction with an audit line for each person. The report file holds people's leave and stays out of git.
- A session is a random token in the `sid` cookie (HttpOnly, SameSite=Lax, 12 hours). Only its SHA-256 hash is stored in `sessions`.
- `loadSession` runs on every request and sets `req.user = { email, role, it_admin }`. `requireAuth` and `requireHr` live in [auth.js](backend/src/auth.js).
- **Access hierarchy** ([docs/ACCESS_DESIGN.md](docs/ACCESS_DESIGN.md)):
  - Super admins (`users.is_super_admin`) can do everything and are the only people who give access. The first ones are Chintan, Chirag, Jagruti and Pratik (set once at start-up). There is always at least one.
  - Everyone else holds the permissions a super admin ticked for them on Company > Access (`access_grants`). Each is for the whole company or for a reporting tree: everyone below a person, to any depth.
  - The catalogue of permissions and the pure rules are in [access-rules.js](backend/src/access-rules.js). The decisions (`can`, `scopeOf`, `mayDecide`, `need`, `needSuper`, with the tree cached for a minute) are in [access.js](backend/src/access.js). The Access page's API is [access-routes.js](backend/src/access-routes.js).
  - `loadSession` loads `req.access` with the session in one query.
  - At the first start, a one-time step turned today's roles into grants (HR → the HR team set, IT admin, payroll reviewers, accountant), so nobody's access changed.
  - Every server check of what a caller may do goes through `access.js` (phase 3 done). The menu and pages follow `useAuth().can/canAll/canAny` (phase 4). Notices go to whoever holds the matching permission (`notify("perm:<key>")`). Giving or removing the HR role or IT admin adds or removes the matching grants (`syncRoleGrants`). Nobody but a super admin can re-invite, reset or remove a login with more access than their own (`mayActOnLogin`), and sign-in links for anyone who has signed in before go to the work email only. `users.role` is now only a label (shown on Users, kept in step with the HR access set). Leave is decided by anyone above the person in the reporting lines (or a stand-in the direct manager named), or by a super admin; nobody decides their own, HR included. Someone with no manager: the super admins. A new request notifies the direct manager and stand-ins (the super admins when there is no manager); `leave.approve` lets someone see team leave and add leave for people, not decide it. PAYROLL_REVIEWERS and FINANCE_VIEWERS are read only once, by the first start-up step. Someone with only "Bank details" gets a bank-accounts list without salaries (`GET /api/payroll/bank-people`). Reporting managers can add a person who has no manager and no access of their own to their team; onboarding manager changes run the same checks (`checkManager` in people.js). Super admins still also count as HR for those. `test/access-flow.mjs` checks the matrix end to end against a local server.
  - Reporting lines are matched on `employees.manager_email`. A database trigger fills it whenever only the manager's name is written, and leaves it empty when two current people share that name.
  - A removed login is blocked (`users.login_blocked`), not deleted. A blocked login, or anyone who is leaving or has left, cannot sign in or keep a session.
- `users.role` is `hr` or `employee`. Three more capabilities are derived, not roles:
  - IT admin: `users.it_admin` (HR counts too). Checked by `requireItAdmin` in [assets.js](backend/src/assets.js).
  - Payroll reviewer: an email listed in `PAYROLL_REVIEWERS` ([payroll/access.js](backend/src/payroll/access.js)).
  - Accountant: an email listed in `FINANCE_VIEWERS` ([finance-rules.js](backend/src/finance-rules.js)). Opens Finance reports only; not payroll, not HR pages.
  - Manager: anyone with people whose `employees.manager` is their name. Project leads manage their own projects.
- A first Google sign-in by someone on the staff list creates their `employee` login automatically.

### Main endpoints

All paths below were read from the code. Unless noted, a signed-in session is required.

| Area | Endpoints | Who |
|---|---|---|
| Session | `POST /api/login`, `POST /api/logout`, `GET /api/login-options`, `POST /api/auth/accept-invitation`, `POST /api/auth/resend-invitation` | Public |
| Sign-in | `GET /auth/google`, `GET /auth/google/callback`, `GET /invite/:token`, `GET /invite/:token/info`, `GET /l/:token` | Public |
| Account | `GET /api/me`, `POST /api/password` | Everyone |
| Users | `GET/POST /api/users`, `POST /api/users/bulk`, `POST /api/users/:email/invite`, `POST /api/users/:email/reset`, `PUT /api/users/:email/role`, `PUT /api/users/:email/it-admin`, `PUT /api/users/:email/disabled` (disable or enable a login), `PUT /api/users/:email/hidden` (hide articles, polls or surveys for one person; the server refuses those pages and the menu drops them), `PUT /api/users/default-password`, `DELETE /api/users/:email` | HR |
| People | `GET /api/roster`, `GET /api/directory`, `GET /api/managers` | Everyone |
| People (HR) | `PUT /api/employees/manager`, `PUT /api/employees/number`, `PUT /api/employees/status`, `PUT /api/employees/:email/pay` | HR |
| Teams and projects | `POST /api/team/members`, `GET /api/allocations`, `POST /api/projects`, `PATCH /api/projects/:id`, `POST /api/projects/:id/members`, `POST /api/allocations/:id/end` | Managers, leads, HR |
| Onboarding | `GET/POST /api/onboarding`, `GET/PUT/DELETE /api/onboarding/draft`, `GET /api/onboarding/next-employee-no`, `POST /api/onboarding/work-email`, `GET /api/work-email` | HR |
| Offboarding | `GET/POST /api/offboarding`, `POST /api/offboarding/:id/run`, `/cancel`, `/steps/:key`, `/steps/:key/retry`, `/clearance/complete`, `GET /api/offboarding/:id/clearance`, `GET/POST /api/advances` | HR |
| Profile and documents | `GET/PUT /api/profile`, `PUT/GET/DELETE /api/profile/photo`, `GET /api/documents`, `PUT /api/documents/:docKey`, `GET /api/documents/:id/file` | Own data |
| Leave | `GET /api/leave`, `GET /api/leave/today`, `POST /api/leave/requests`, `POST /api/leave/requests/:id/decision` (a decline needs a reason, an approval may carry a comment), `POST /api/leave/requests/:id/cancel`, `PUT /api/leave/balances/:email` (HR corrects casual, sick and comp-off balances, with a reason; audited), `GET/PUT /api/leave/policy` (HR changes the policy numbers), `POST /api/leave/comp-off-requests`, `POST/PUT/DELETE /api/leave/holidays`, `GET /api/leave/salary-cuts` | Everyone; decisions by approver or HR; balance corrections and the policy by `leave.manage` |
| Holiday list upload | `GET /api/leave/holidays/template?year=`, `POST /api/leave/holidays/import` (preview, saves nothing), `POST /api/leave/holidays/import/apply` | `leave.manage` (company-wide); the sheet is read by `holiday-import.js` and each row is saved like the 2026 holidays, marked `imported` |
| Attendance | `GET /api/attendance/today`, `/presence` (who is in, not in yet or on leave today; shown on Employees and the dashboard head; off-site people left out), `/month`, `/day`, `/report`, `POST /api/attendance/punch`, `POST /api/attendance/punches`, `PUT /api/attendance/work-site` (HR: On-site or Off-site) | Everyone; team data for managers and HR |
| Device | `POST /api/attendance/device/punches` (device key, no session), `GET/PUT /api/attendance/device/users` | Connector; HR |
| Reimbursements | `GET/POST /api/reimbursements`, `POST /from-document`, `PUT /:id/items/:itemId/document`, `POST /:id/submit`, `/approve`, `/reject`, `/request-changes`, `/resubmit`, `GET/PUT /categories` | Own claims; review by HR |
| Budgets | `GET/POST /api/budget-requests`, `POST /:id/approve`, `POST /:id/reject` | Own requests; decisions by HR |
| Payroll | `GET /api/payroll/overview`, `GET/POST /api/payroll/runs`, `POST /runs/:id/recalculate`, `POST /runs/:id/actions/:action`, `GET /runs/:id/files/:fileId`, `GET/PUT /bank/:email`, `GET/PUT /structures/:email`, `GET /tax-rules`, `GET/POST /adjustments`, `GET /audit` | HR, payroll reviewers and the accountant (`FINANCE_VIEWERS`) |
| Payslips | `GET /api/payslips`, `GET /api/payslips/:period`, `GET /api/payslips/:period/pdf` | Own payslips; Pay unlocked |
| Tax regime policy | `GET/PUT /api/tax-declaration/policy`, `GET/PUT/DELETE /api/tax-declaration/policy/document` | Read: signed in, Pay unlocked. Change: `payroll.prepare` (company-wide) |
| Tool access | `GET /api/tool-access`, `POST /api/tool-access/claude`, `POST /api/tool-access/claude/refresh`, `POST /api/tool-access/claude/confirm`, `GET /api/claude-requests` | HR; IT admins for the queue |
| Assets | `GET/POST /api/assets`, `PUT /api/assets/:id`, `POST /api/assets/:id/assign`, `POST /api/assets/:id/return` | IT admins, HR |
| Feed | `GET/POST /api/posts`, `PATCH/DELETE /api/posts/:id`, `PUT/DELETE /api/posts/:id/like`, `GET/POST /api/posts/:id/comments`, `POST /api/posts/images` | Everyone |
| Celebrations and festivals | `GET/POST /api/celebrations`, `POST /api/celebrations/:id/send`, `GET /p/:file` (public), `GET /api/festivals`, `POST /api/festivals/share`, `GET /api/festival-look` (public), `PUT /api/festivals/look`, `POST /api/festivals/:slug/dates`, `DELETE /api/festivals/:slug/dates/:day` (HR) | HR; festivals for everyone |
| Digital Kit | `GET /api/digital-kit`, `GET /api/digital-kit/resources/:id/file`, `POST /api/digital-kit/headline-ai` (10 an hour each), `/api/digital-kit/admin/*` | Everyone; admin part HR |
| Gmail engine and project reports | `GET /api/gmail-intel/status`, `/usage`, `/extractions`, `POST /api/gmail-intel/mailboxes`, `/sync`, `/extractions/:id/review` (HR); `POST /api/gmail-intel/push?token=` (Pub/Sub, no session); `GET /api/project-reports`, `/:id?week=`, `POST /api/project-reports/:id/email` (company addresses only, at most 10) | HR; reports for project members |
| Other | `GET /api/notifications`, `POST /api/notifications/read`, `GET /api/audit` | Everyone; audit HR |

### Pages and static files served by Express

`GET /` and `GET /login` redirect signed-in people to `/app/dashboard`. `GET /app/*` sends `frontend/dist/index.html`, or
redirects to `/login` and remembers the page in the `hrhub_after` cookie for 15 minutes. `/app/assets` is the hashed build
output. A fixed list of logo and favicon files and `/sig` come from `frontend/public`. `/leave-rules.js` serves
[frontend/leave-rules.cjs](frontend/leave-rules.cjs).

### Background jobs

Timers in `jobs.js` (all skipped when `BACKGROUND_JOBS=off`): scheduled offboardings and invite expiry every minute; leave
digest every 10 minutes; reimbursement and budget reminders, automatic payroll draft, Claude request reminders and
celebration alerts every hour; optional Employee Portal attendance sync; the Gmail engine (a sync every `GMAIL_SYNC_MINUTES` and watch renewal) when `GMAIL_INTEL_ENABLED=true`. They run in the server process, so two running
servers on one database would both run them.

## 7. Frontend

### Entries

| Page | Entry script | Served at | Content |
|---|---|---|---|
| [frontend/index.html](frontend/index.html) | [src/main.jsx](frontend/src/main.jsx) | `/app/*` | The app: `BrowserRouter` > `AuthProvider` > `ToastProvider` > `DataProvider` > `App` |
| [frontend/login.html](frontend/login.html) | [src/login-main.jsx](frontend/src/login-main.jsx) | `/login`, `/invite/<token>` | [login/Login.jsx](frontend/src/login/Login.jsx), or [login/Invite.jsx](frontend/src/login/Invite.jsx) when the path starts with `/invite/`; both use [login/AuthLayout.jsx](frontend/src/login/AuthLayout.jsx) |

Vite builds both with `base: "/app/"` and `publicDir: false` ([frontend/vite.config.js](frontend/vite.config.js)).
`index.html` loads `/leave-rules.js` before the app, which sets `window.LeaveRules`.

### Routing

- **Loading speed:** every page except the dashboard is loaded the first time it is opened (`lazy()` in `App.jsx` and in each `modules/*/index.jsx`; `Shell.jsx` holds the frame in a `Suspense` meanwhile), so the first script is about 70 KB compressed instead of one 1 MB file. Express sends `/app/assets` scripts and styles compressed (Brotli or gzip, compressed once and kept in memory: `compressedAssets` in `pages.js`); the Docker nginx turns on gzip. The Google font stylesheet loads without holding up the first paint. Requests several cards make at once share one call (`apiShared` in `api.js`).

Routes are in [frontend/src/App.jsx](frontend/src/App.jsx). Page routes are listed there; module routes are collected with
`import.meta.glob("./modules/*/index.jsx")`, each module exporting `routes`. Unknown paths go to `/app/dashboard`.

| Path | Component |
|---|---|
| `/app/dashboard` | `pages/Dashboard.jsx` |
| `/app/inbox` | `pages/Inbox.jsx` |
| `/app/my-attendance` | `pages/Attendance.jsx` (own attendance only, also for HR) |
| `/app/my-team` | `pages/MyTeam.jsx` (the people who report to you: away today, waiting for you, away soon) |
| `/app/my-finances` | `pages/MyFinances.jsx` (pay at a glance from published payslips) |
| `/app/org-documents` | `modules/digitalkit/OrgDocuments.jsx` (company templates and files, the Digital Kit's shared resources) |
| `/app/polls`, `/app/praise`, `/app/articles`, `/app/articles/:id`, `/app/apps`, `/app/requests`, `/app/hr-requests`, `/app/tax`, `/app/goals` | `modules/engage/` (Polls, Praise, Articles, Apps, Requests: own requests, and everyone's for HR; Tax: a declaration for payroll to review; Goals) |
| `/app/hr-reports`, `/app/probation`, `/app/letters`, `/app/exit-interviews`, `/app/hiring`, `/app/hiring/:id`, `/app/helpdesk`, `/app/helpdesk/:id`, `/app/hr-helpdesk`, `/app/hr-helpdesk/:id`, `/app/reviews`, `/app/hr-reviews` | `modules/hrtools/` (Reports counted from the staff list and leave data, with a spreadsheet download; Probation; Letters printed from the browser; Exit interviews; Hiring; Helpdesk; Reviews) |
| `/app/timesheet`, `/app/surveys`, `/app/surveys/:id`, `/app/surveys/:id/results`, `/app/training`, `/app/training/:id`, `/app/interviews`, `/app/notice-periods`, `/app/stand-ins` | `modules/workforce/` (Timesheet, Surveys, Training, and People pages for interviews, notice periods and approval stand-ins) | Everyone for their own timesheet, surveys and training; managers and HR approve; results, notice periods and training setup are HR only |
| `/app/finance-reports`, `/app/finance-reports/tax/:email` | `modules/finance/` (Finance reports: Statutory dues, Payroll journal, Cost (with project shares), Gratuity, Annual tax and Contractors tabs, each with a spreadsheet download; one person's annual tax statement to print) | HR and payroll reviewers |
| `/app/timesheet`, `/app/surveys`, `/app/surveys/:id`, `/app/surveys/:id/results`, `/app/training`, `/app/training/:id`, `/app/interviews`, `/app/notice-periods`, `/app/stand-ins` | `modules/workforce/` (Timesheet with My week and To approve; Surveys to answer and, for HR, create and read; Training with Manage for HR; Interviews for interviewers; Notice periods for HR; Approval cover) | Everyone; approving weeks for managers, stand-ins and HR; creating surveys and trainings, notice periods for HR |
| `/app/employees` | `pages/Employees.jsx` |
| `/app/employees/:email` | `modules/employee/EmployeePage.jsx` |
| `/app/allocations` | `pages/Allocations.jsx` |
| `/app/assets` | `pages/Assets.jsx` |
| `/app/attendance` | `pages/Attendance.jsx` |
| `/app/leave` | `pages/LeaveHr.jsx` |
| `/app/leave/apply` | `pages/LeaveApply.jsx` |
| `/app/leave/review/:id` | `pages/LeaveReview.jsx` |
| `/app/my-leave` | `pages/MyLeave.jsx` |
| `/app/team-leave` | `pages/TeamLeave.jsx` |
| `/app/payslips` | `pages/Payslips.jsx` |
| `/app/profile` | `pages/Profile.jsx` |
| `/app/account` | `pages/Account.jsx` |
| `/app/rewards` | `modules/rewards/` (Manage > Rewards: give a reward and see those given; needs `rewards.give`) |
| `/app/id-card` | `modules/idcard/` (ID card preview and PDF download; HR can pick anyone or download everyone's) |
| `/app/users` | `pages/Users.jsx` |
| `/app/audit` | `pages/Audit.jsx` |
| `/app/onboarding`, `/app/onboarding/progress` | `modules/onboarding/Onboarding.jsx`, `Progress.jsx` (HR only) |
| `/app/documents`, `/app/claude-requests` | `modules/onboarding/Documents.jsx`, `ClaudeRequests.jsx` |
| `/app/offboarding`, `/app/offboarding/leavers` | `modules/offboarding/Offboarding.jsx`, `Leavers.jsx` (HR only) |
| `/app/reimbursements`, `/new`, `/:id` | `modules/reimbursements/ReimbList.jsx`, `ClaimNew.jsx`, `ClaimDetail.jsx` |
| `/app/budgets`, `/new`, `/:id` | `modules/budgets/Budgets.jsx`, `BudgetNew.jsx`, `BudgetDetail.jsx` |
| `/app/payroll` | `modules/payroll/Payroll.jsx` |
| `/app/posts`, `/app/posts/:id` | `modules/posts/Posts.jsx` (`SinglePost`) |
| `/app/celebrations` | `modules/celebrations/Celebrations.jsx` (HR only) |
| `/app/festivals` | `modules/festivals/Festivals.jsx` |
| `/app/digital-kit` | `modules/digitalkit/DigitalKit.jsx` |
| `/app/project-reports` | `modules/projectreport/ProjectReport.jsx` (Email and Print) |

The "HR only" marks come from the `HR_ONLY` list in `App.jsx`. Every other page relies on the server refusing the request.

### Shared code

- [src/api.js](frontend/src/api.js): `api(method, url, body)` returns `{ ok, status, data }` and sends the browser to `/login` on 401.
- [src/auth.jsx](frontend/src/auth.jsx): `useAuth()` gives `user`, `isHr`, `itAdmin`, `isManager`, `payrollReviewer`.
- [src/data.jsx](frontend/src/data.jsx): `useData()` loads roster, tool access, documents, profile and leave once, with `reload()`.
- [src/components/](frontend/src/components/): `Shell.jsx` (the app layout, as on wohlig.com: one top bar with the logo, the sections (Home, My work, To do, My team, Pay, Company, Community and, for HR, HR; filtered
  by role; each opens its pages in a menu; Keka features that still need new tables are designed in [docs/KEKA_PARITY_DESIGN.md](docs/KEKA_PARITY_DESIGN.md)); then search, notifications and the account menu (which holds Appearance: light, dark or the device setting); the bar floats as a rounded capsule like wohlig.com's;
  on screens under 1024px the sections move into a drawer listing every page), `QuickSearch` (Ctrl+K or "/": finds any menu page or colleague),
  `Modal` (the one dialog, on Radix UI Dialog: focus kept inside and returned, Escape, page scroll locked, close button, a bottom sheet on phones; the
  reimbursement `Dlg` is the same component), `ConfirmDialog`, `DatePicker`, `Pager`,
  `PeoplePicker`, `PersonAvatar`, `PhotoEditor`, `OrgChart`, `NotificationBell`, `TodayCards`, `TimeToday` (Home: time worked today, and the punch button when `WEB_CLOCK_IN` is on), `RemoteToday` (Home: who is working from home today), `RemoteToday` (Home: who has an approved work-from-home request for today, from `/api/remote-today`), `toast.jsx`, `ui.jsx`,
  `charts.jsx`, `leaveParts.jsx`, `leaveSummary.jsx`, `LeaveBalanceCards` (the four balance cards, shared by My leave and an employee's profile), `attendance.jsx`, `BackButton`, `BirthdayPopup`, `CelebrateCard`, `NextHolidayPopup`, `HolidayImport` (HR's holiday list upload dialog).
  Every page opens with `SectionHead` from `ui.jsx`: the page name, one line, the page's actions on the right and, for a
  page with several views (Employees, Onboarding, Reimbursements), `PageTabs` under it. My leave, Team leave and Leave management are
  separate menu items. Onboarding and Offboarding open on their lists; adding a joiner and offboarding someone are buttons there.
- Brand in one place: [brand.config.json](frontend/brand.config.json) holds the product and company names, the headline and copy of the sign-in page, logo paths, brand colours, fonts and `festivalLook.daysBefore`. [src/brand.js](frontend/src/brand.js) exports `BRAND` and `PRODUCT` and `applyBrand()` (both entries call it after `styles.css`), which sets the `--brand-*` colour and font variables the theme is built on; [backend/src/brand.js](backend/src/brand.js) reads the same file. Re-branding for another product means editing this one file and the logo files.
- [src/components/FestivalLook.jsx](frontend/src/components/FestivalLook.jsx): `useFestivalLook()` (asks `/api/festival-look`; `?festival=<slug>` in any address previews one), `festivalTheme` (each festival's three colours, celebration and greeting from `festivalLook.festivals` in `brand.config.json`), `festivalGreeting`, `festivalFrom`, `festivalWhen`, `FestivalArt` (the festival's scene drawn once into a canvas), `FestiveFrame` (sets `data-festival` and `--fest-a/b/c` on `<html>`, draws the colour ribbon along the top of every page and plays the celebration: about four seconds of the festival's own motion (`burst`: lanterns, colours, snow, crescents, gulal, dandiya, sparks or confetti), once a day per festival, never under reduced motion) and `FestivalChip` (the top bar's "Diwali in 2 days" chip, linking to Festival wishes). Used by `Shell.jsx`, the sign-in layout (festival headline) and the dashboard banner (festival greeting, no buttons inside the banner).
- [src/lib/](frontend/src/lib/): `leave.js` (re-exports `window.LeaveRules`), `useLeave.js`, `people.js`, `menu.js` (the menu for each role,
  shared by the sidebar and quick search).
- [src/modules/](frontend/src/modules/): `access` (Company > Access, super admins only), `tools` (Manage > Tools & cost), `budgets`, `celebrations`, `digitalkit`, `employee`, `idcard`, `rewards`, `engage`, `festivals`, `finance`, `hrtools`, `offboarding`, `onboarding`, `payroll`, `posts`, `projectreport`, `reimbursements`, `workforce`.

### Styling and theme

- [src/styles.css](frontend/src/styles.css) is the one stylesheet for the whole interface; both entries import it and no other CSS file exists. It opens with the Tailwind CSS setup (layer order `theme, base, legacy, components, utilities`; no preflight yet) and the Wohlig theme (`@theme`: brand and theme-following colours, fonts, radii, breakpoints that match the older `max-width` steps). The older hand-written rules follow inside `@layer legacy` and are deleted as screens move to Tailwind classes; converted so far: `SectionHead`, `PageTabs`, `ViewTabs` and `Stat` in `components/ui.jsx`, the app shell in `components/Shell.jsx` (sidebar, top bar, account menu, tooltips) dialogs in `components/Modal.jsx` (the frame, and the title row, body and footer bar it holds) quick search in `components/QuickSearch.jsx` and status pills (`Pill` and `pill()` in `components/ui.jsx`); the button (`.btn`) stays a class in the legacy layer for now. The numbered sections of the legacy layer: 1 brand tokens (`--brand-*`, `--btn-*`), 2 celebrations (`.cel-*`), 3 Digital Kit (`.dk-*`), 4 festival wishes (`.fw-*`), 5 birthday cards (`.bd-*`, `.cc-*`), 6 the signed-in app, 7 the sign-in and invitation pages (everything under `.auth`; `login.html` puts `auth-page` on `<body>`).
- Buttons are one standard, the wohlig.com button: `btn primary`, `btn glass`, with `lg`, `sm`, `block`. The rules are in [CLAUDE.md](CLAUDE.md) and [docs/BRAND_GUIDELINES.md](docs/BRAND_GUIDELINES.md).
- Sign-in components: [login/AuthLayout.jsx](frontend/src/login/AuthLayout.jsx) (shared layout), [login/PasswordField.jsx](frontend/src/login/PasswordField.jsx).
- Theme: [src/theme.js](frontend/src/theme.js) stores `light` or `dark` under `localStorage` key `hr_theme` and sets `data-theme` on `<html>`.
  With nothing stored it follows the system setting. The CSS answers both `:root[data-theme="dark"]` and `prefers-color-scheme`.

## 8. Data model

[backend/src/schema.sql](backend/src/schema.sql) defines 85 tables; [backend/src/payroll/schema.sql](backend/src/payroll/schema.sql) adds 6.
People are linked mostly by work email (text, compared in lower case), not by foreign key. `employees.manager` and
`projects.project_lead` hold a person's name.

| Table | Purpose | Key relations |
|---|---|---|
| `employees` | Everyone on staff; status `onboarding`, `active` or `offboarded`; masked ID numbers only | Hub of the model |
| `rate_limits` | One row per sign-in failure or rate-limited attempt, by key; rows older than a day are removed | none |
| `users`, `sessions`, `settings`, `invites` | Logins (`role`, `it_admin`), session hashes, default password, invite link hashes | `users.email` = `employees.work_email` |
| `onboarding_drafts` | One unsaved onboarding form per HR user | keyed by HR email |
| `audit_log` | Every recorded action (`action`, `work_email`, `ts`) | by email |
| `documents`, `profiles`, `profile_photos` | Uploaded documents, profile sections, photo | by email |
| `leave_requests`, `comp_off_credits`, `holidays` | Leave, comp-off credit, holiday calendar. A decided request keeps the approver's comment or the reason for a decline (`decision_note`). | by email |
| `leave_policy` | The policy numbers HR can change (casual and sick days a year, loss-of-pay divisor, days sick leave can be applied late). A missing key uses the default in `leave-rules.cjs`. | `key` |
| `projects`, `employee_project_allocations` | Projects and who works on them | FK to `employees`, `projects` |
| `attendance_punches`, `device_users`, `device_unmatched` | Punches, device ID links, punches waiting for a link | FK to `employees` |
| `offboardings`, `offboarding_steps`, `offboarding_clearances` | Offboarding record, its steps, confirmed settlements | steps and clearances FK to `offboardings` |
| `employee_advances`, `advance_recoveries` | Money paid ahead and what was recovered | recoveries FK to advances |
| `reimbursement_categories`, `reimbursements`, `reimbursement_items`, `reimbursement_documents`, `reimbursement_events` | Claim categories, claims, expense lines, receipts, timeline | items, documents, events FK to `reimbursements` |
| `gmail_mailboxes`, `gmail_messages`, `gmail_extractions`, `gmail_ai_usage` | Mailboxes read by the Gmail engine and their sync cursor; processed message ids; extracted project facts (no email bodies); AI tokens and estimated cost | extractions FK to messages and projects |
| `budget_requests`, `budget_request_events` | Pre-approved budgets and their timeline | `reimbursements.budget_request_id` |
| `payroll_runs`, `payroll_items`, `salary_structures` | One run per month, one line per person (stores the whole slip), salary breakdowns | items FK to runs |
| `payroll_bank_accounts`, `tax_rules`, `tax_declarations`, `payroll_adjustments`, `payroll_files`, `payroll_audit` | Encrypted bank numbers, tax rules, declarations, arrears and recoveries, generated files, append-only trail | payroll schema file |
| `tool_access` | Which tools a person has and what the tool said | by email |
| `notifications`, `email_outbox`, `email_links` | Bell items, log of every email attempt, short-lived link hashes | by email |
| `posts`, `post_likes`, `post_comments`, `post_images`, `post_shares` | Company feed | FK to `posts` |
| `polls`, `poll_votes` | Polls and one vote per person | FK to `polls` |
| `praises` | Praise from one colleague to another | emails |
| `rewards` | A reward HR gives a person, with a note | emails |
| `articles` | HR articles, draft or live | author email |
| `app_links` | Links to the company's other tools | none |
| `advance_requests`, `attendance_requests` | Requests people raise and HR decides; approving records the decision only | emails |
| `tax_regime_policies` | The regime a tax declaration starts on for a financial year (New or Old, set by payroll on Pay > Tax declaration > Regime policy) and the policy document behind it (file in `UPLOAD_DIR`). A year without a row uses the latest earlier one; none at all means New. Saved declarations are never changed by it. | `financial_year` is the starting year |
| `tax_declaration_requests` | What a person submits to payroll for a financial year (regime and planned claims). Payroll's own `tax_declarations` (payroll schema) is separate and is the only one the calculation reads. `proofs` holds HR's note on the proof for each line and is cleared when the lines change | email |
| `tax_proof_files` | The document a person uploads as proof for one line of their declaration (`PUT /api/tax-declaration/proofs/:index/file`); the file is on disk under `UPLOAD_DIR`. Removed when the lines change | request_id |
| `contractor_payments` | Payments to contractors and consultants with the tax deducted (section, rate, amount in paise). Only a masked PAN is kept. Soft delete | paid_on |
| `timesheet_weeks`, `timesheet_entries` | A week of hours per person (draft, submitted, approved, returned) and the minutes per project per day; no project = internal work | email + week_start; week_id |
| `surveys`, `survey_takers`, `survey_responses` | A survey and its questions (JSON); who answered (one each, kept apart); the answers, with no email when anonymous | survey_id |
| `trainings`, `training_assignments` | A training and who must do it, with the day they finished | training_id; email |
| `resignations` | Resignation date, notice days and an agreed last day, for notice periods | email |
| `approval_stand_ins` | Who covers a manager's leave approvals, and from when to when | for_email; stand_in_email |
| `review_cycles`, `review_feedback` | A review cycle opened for everyone or a department; colleague feedback on a review. `reviews` gained `cycle_id`, `manager_email`, `manager_text`, `manager_rating`, `manager_at` | review_id |
| `interviews` | A candidate's interview: time, length, how, where, interviewers and their recommendations | candidate_id |
| `goals` | A person's own goals with due date and progress; visible to them and HR | email |
| `probations` | HR's decision on a person's probation (confirmed or extended); with no row it ends six months after joining | email |
| `tickets`, `ticket_replies` | Helpdesk questions and the replies under them | FK to `tickets` |
| `article_acks` (and `articles.requires_ack`) | Policy sign-off: who confirmed they read an article | FK to `articles` |
| `exit_interviews` | Why a person left, recorded by HR; HR only | email |
| `job_openings`, `candidates` | Hiring: open roles and candidates by stage; HR only | FK to `job_openings` |
| `reviews` | Performance reviews: self-review, HR review and rating; the person and HR only | email |
| `timesheet_weeks`, `timesheet_entries` | A person's week (draft, submitted, approved or returned) and minutes per project per day; empty project = internal work | entries FK to weeks |
| `surveys`, `survey_takers`, `survey_responses` | Surveys, who answered (one each), and the answers; an anonymous answer carries no email | FK to `surveys` |
| `trainings`, `training_assignments` | Trainings HR sets up and who must finish them by when | assignments FK to `trainings` |
| `resignations` | Notice periods recorded by HR: resigned on, notice days, agreed last day, withdrawn | email |
| `approval_stand_ins` | Who decides leave for a manager between two days; the manager can still decide | emails |
| `review_cycles`, `review_feedback` (and new nullable manager columns on `reviews`) | HR opens reviews for everyone or a department at once; colleague (360) feedback, seen by HR and the manager, never the person reviewed | `reviews` link to cycles; feedback FK to `reviews` |
| `interviews` | Interviews for a candidate; each interviewer leaves a recommendation and notes | FK to `candidates` |
| `assets`, `asset_events` | Company assets and their history | `assigned_to` FK to `employees` |
| `celebrations`, `celebration_recipients`, `celebration_alerts` | Posters, delivery per recipient, alerts already sent | recipients FK to `celebrations` |
| `digital_kits`, `digital_kit_resources`, `digital_kit_state` | Per-person kit, shared resources, seeding flags | kits FK to `employees` |
| `tools`, `tool_bills` | The tool catalogue with seat prices (INR or USD) and monthly bills; seats are `tool_access` rows | `tool_bills.tool` → `tools.slug` |
| `access_grants` | One ticked permission for one person: company-wide or a reporting tree (`scope_root_email`), with an optional end date; a removed one keeps its row | `users.is_super_admin`, `users.login_blocked`, `employees.manager_email` belong to the same change |
| `festivals`, `festival_dates` | Festivals and their yearly dates | dates FK to `festivals` |
| `app_migrations` | Keys of one-time data fixes that already ran | none |

## 9. Cross-cutting concerns

- **Speed.** [timing.js](backend/src/timing.js) puts a `Server-Timing: app;dur=…` header on every response (the browser's Network panel
  shows it) and logs `[slow request]` for any /api request over `SLOW_REQUEST_MS`. The pools in [db.js](backend/src/db.js) keep
  connections open (opening one is the slowest part of a quick request) with a statement timeout; the start-up schema step runs
  without it. Every read path has an index (lower(email) indexes for email lookups; see the "Speed" block at the end of
  `schema.sql`). Independent reads run side by side; inside a transaction they take turns (payroll/store.js `together`). The payroll
  overview keeps its month preview for a minute. Measured locally over 83 list endpoints: median 6 ms, all under 60 ms except
  a first payroll preview.
- **Auth.** See section 6. Only `@wohlig.com` addresses can hold a login; a database check constraint enforces it as well.
- **Permissions.** Enforced on the server per router. The interface hides pages but is not the control.
- **Audit log.** Modules insert a plain sentence into `audit_log` after a change. Payroll has its own append-only `payroll_audit`.
- **Email.** `notify()` in [notify.js](backend/src/notify.js) writes a bell item and optionally emails. Every attempt lands in `email_outbox` as `sent`, `skipped` or `failed`. Without `SENDGRID_API_KEY` nothing is sent. `MAIL_SKIP_RECIPIENTS` blocks named addresses.
- **Uploads.** Files arrive as raw request bodies (`express.raw`), are type-checked from their first bytes, and are written to `UPLOAD_DIR` (default `backend/uploads`, ignored by Git). Table rows hold the stored file name. Digital Kit official files come from [backend/seed/digital-kit/](backend/seed/digital-kit/).
- **Sensitive data.** Aadhaar, PAN and account numbers are stored masked at onboarding. Payroll bank numbers and bank files are encrypted with `PAYROLL_ENCRYPTION_KEY`.
- **Migrations.** There is no migration tool. `initDb()` runs all of `schema.sql` on every start, so every statement is written to be repeatable (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guarded `DO` blocks, `app_migrations` keys). `npm run migrate` does the same by hand, with `-- --dry-run`. `npm run migrate:sql` regenerates [backend/migrations/hrhub-schema.sql](backend/migrations/hrhub-schema.sql).
- **Tests.** Run from `backend/`:
  - `npm test` runs `test/*.test.mjs` (`leave-rules`, `payroll-calc`, `tax-import`, `architecture`). No database needed.
  - `npm run check:docs` runs [backend/scripts/check-architecture.mjs](backend/scripts/check-architecture.mjs): it fails when this file no longer names every server file, route mount, table, `.env.example` variable, page, module and component, or when the docs link to a missing file. The `architecture` test runs the same check, and a Claude Code Stop hook in [.claude/settings.json](.claude/settings.json) runs it at the end of each Claude turn.
  - `npm run test:invites` and `npm run test:device` start a throwaway server and use the database in `DATABASE_URL`; they create and remove temporary rows.
  - The frontend has no tests and no lint script.

## 10. Conventions seen in the code

- ES modules everywhere; the one CommonJS/UMD file is `frontend/leave-rules.cjs`, imported by the server as `../../frontend/leave-rules.cjs`.
- Async route handlers are wrapped with `wrap(fn)` so a thrown error becomes a JSON 500. Errors are `{ error }`; form errors are `{ errors: { field } }`.
- SQL is parameterised (`$1`, `$2`). Emails are compared with `lower(...)`. Multi-step writes use `BEGIN`/`COMMIT` on a pooled client.
- DATE columns come back as `YYYY-MM-DD` strings (type parser in `db.js`). "Today" is India time.
- Database columns are snake_case; JSON sent to the browser is camelCase, mapped by hand in each route.
- User-facing messages are full plain sentences. Comments explain why, in the same style.
- New frontend features go in `src/modules/<name>/index.jsx` and export `routes`; nothing else needs registering.
- Data-copy scripts in [backend/scripts/](backend/scripts/) default to a dry run and write only with a flag such as `--apply`. `migrate.mjs` is the exception: it writes unless given `--dry-run`.

## 11. Known gaps and risks

Fixed on 2026-11-18: `index.js` split into route files; limits moved to the database; `trust proxy` set; security headers
and a same-origin check on changes; unused packages removed; the SQL copy regenerated (a test now keeps it in step);
duplicate tables removed from `schema.sql`; stale paths and comments corrected; the dev proxy completed.

Still open:

- **Name-based links.** Managers and project leads are stored as names, not ids, so renaming someone or two people with the
  same name breaks reporting lines. Fixing it needs new id columns, a backfill of live data and changes to every reader;
  it is a data migration and needs its own planned change.
- **`frontend/dist` is committed.** A source change without `npm run build:ui` leaves the non-Docker server on the old interface.
- **Two servers decide page access.** Express does it without Docker; nginx does it in Docker. A new public path (like
  `/l/` or `/p/`) must be added to both `pages.js` and `nginx.conf.template`.
- **The frontend has no tests and no lint script.**
- **Named defaults, on purpose.** When unset, `MAIL_SKIP_RECIPIENTS` stops email to the two directors and
  `PAYROLL_REVIEWERS` makes a director the payroll reviewer. The deploy checklist relies on these defaults, so they stay;
  set the variables to change them.
