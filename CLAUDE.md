# Wohlig One (the Wohlig employee portal, formerly "HR Access Hub")

Wohlig's internal HR portal: one Express server on Postgres ([backend/](backend/)) and one React interface
([frontend/](frontend/)). Staff sign in with their @wohlig.com Google account.

## Read first, every task

1. [ARCHITECTURE.md](ARCHITECTURE.md): the map of the repo (routes, pages, tables, how it runs). Read it before opening
   code, and update it in the same change when routes, pages, tables or env vars change (see "Keep ARCHITECTURE.md
   current" below).
2. [docs/BRAND_GUIDELINES.md](docs/BRAND_GUIDELINES.md): the Wohlig brand rules. Read it before any change a person
   can see: a screen, an email, a PDF, a document template.

## Keep ARCHITECTURE.md current (always, checked automatically)

Anyone who changes this repo keeps [ARCHITECTURE.md](ARCHITECTURE.md) true in the same change. Three things enforce it:

- **The check:** `cd backend && npm run check:docs` ([backend/scripts/check-architecture.mjs](backend/scripts/check-architecture.mjs)).
  It fails when the code has a server file, route mount, table, env var in `.env.example`, page, module or component
  that ARCHITECTURE.md does not name, or when ARCHITECTURE.md, CLAUDE.md or the brand guide link to a missing file.
- **The tests:** `npm test` runs the same check ([backend/test/architecture.test.mjs](backend/test/architecture.test.mjs)), so a stale map fails the tests.
- **Claude Code:** a Stop hook in [.claude/settings.json](.claude/settings.json) (committed, so it reaches everyone) runs the check
  when Claude finishes a turn and sends it back once to fix the map.

When you update it: change the right section (routes, endpoints, pages, data model, env vars, known gaps), set
`updated:` in the front matter to today, and keep the Obsidian front matter, the `> [!info]` callout and the links.
The check only sees names; you still describe what changed in plain words.

## Claude connector: keep it in step (always, checked automatically)

Wohlig One has a connector for Claude ([docs/MCP_CONNECTOR.md](docs/MCP_CONNECTOR.md)): staff use the portal from Claude, as
themselves, through `/mcp`. Anyone who adds or changes a page or an endpoint, a person or an AI assistant, decides in the same
change what the connector does with it:

- **Salary, payment, tax, bank, ID, offer or document data:** block it for access keys in
  [backend/src/access-keys-rules.js](backend/src/access-keys-rules.js) (`BLOCKED_PREFIXES` or `BLOCKED_PATTERNS`), and add any new
  field name that carries such a figure to `KEY_HIDDEN_FIELDS`. Never give it a tool or a line in `coverage.js`.
- **A job people do often:** a tool in [backend/src/mcp/tools.js](backend/src/mcp/tools.js) that calls the endpoint the page calls,
  with the same fields and values, listed in the tools table of docs/MCP_CONNECTOR.md.
- **Anything else:** a line in [backend/src/mcp/coverage.js](backend/src/mcp/coverage.js) `GENERAL`, in its group, with the reason
  it has no tool (it is reached through `wohlig_api_get` and `wohlig_api_call`, or stays in the browser).
- **A new page:** an entry in `coverage.js` `PAGES`: the tools that do its job, `general`, or `out` with the reason.
- **A router mounted under a new prefix** in `index.js` needs a line in `PREFIX` in [backend/src/mcp/catalog.js](backend/src/mcp/catalog.js).
- **A new sealed pay field** (a new column in `SEALED` in `secret-box.js`): add its name, and its camelCase form, to `KEY_HIDDEN_FIELDS`.
- **Write routes so the check can read them:** `r.get("/api/…")`, or a path variable whose value is set in the file that imports
  it (as `registerDetailsSheet(r, { base: "/api/…" })`). Not `.route()` or `.all()`.
- Keep the tool count in ARCHITECTURE.md right.

Three things enforce it, as for ARCHITECTURE.md: `cd backend && npm run check:docs` (also alone: `npm run check:connector`) runs
[backend/scripts/check-connector.mjs](backend/scripts/check-connector.mjs); `npm test` runs the same check
([backend/test/connector-coverage.test.mjs](backend/test/connector-coverage.test.mjs)); and a Stop hook in `.claude/settings.json` runs
it when Claude finishes a turn and sends it back once to fix it. The check fails when a page or a reachable endpoint has no entry,
when an entry or a tool points at something that is gone or blocked, when a reachable endpoint's path names pay, tax, a bank, a
loan, an advance, an offer or a document, when a router's prefix or a route's path cannot be worked out, when a sealed pay field is
not hidden from keys, or when docs/MCP_CONNECTOR.md misses a tool. After a change to access-keys-rules.js, run
`node --test test/access-keys.test.mjs`.

## Skills: always pick the right one first

Before a task, check the skills list and use the one that fits. If none fits, say so and propose one.

| Task | Skill |
|---|---|
| New or reshaped screen | `frontend-design:frontend-design`, then `redesign-existing-projects` for an existing page |
| Check a screen in a browser, every size | Claude's own browser first, then Claude in Chrome; `playwright-cli` only as the fallback (see below) |
| Accessibility, contrast, focus | `chrome-devtools-mcp:a11y-debugging` |
| Layout, network or console problems | `chrome-devtools-mcp:chrome-devtools` |
| Slow page load | `chrome-devtools-mcp:debug-optimize-lcp` |
| Diagram for ARCHITECTURE.md or a flow | `archify` (or a mermaid block) |
| Review a change before the pull request | `code-review`, then `security-review` for auth, uploads or payroll |
| Tidy changed code | `simplify` |
| Commit message or pull request | `commit-credit` (no AI attribution) |
| Update this file after a session | `claude-md-management:revise-claude-md` |
| Spec for a new feature | `product-management:write-spec` |

## Design: always the Wohlig brand

Every screen follows the brand guidelines and the look of wohlig.com. The sign-in page
([frontend/src/login/](frontend/src/login/), section 7 of [frontend/src/styles.css](frontend/src/styles.css)) is the reference build.

- Colours and fonts come from the brand tokens in [frontend/src/styles.css](frontend/src/styles.css), used through the Tailwind theme
  names (`bg-maroon`, `text-ink`, `font-display`). Never type a brand hex value or a font name into a component.
- Deep Maroon `#800D35` for identity and the primary action, Warm Ivory `#FFF7E9` as the page base, Sunset Orange
  `#F7781D` for one focal point per screen. Beige, terracotta and olive are supporting colours.
- Never put white or ivory text on orange (2.7:1, fails). Orange buttons take dark ink text.
- Headlines in Fraunces (`--brand-display`), everything else in Lato (`--brand-body`). Body text 16px.
- The logo is always a master file from [frontend/public/](frontend/public/): `wohlig-logo.svg` on light,
  `wohlig-logo-dark.svg` on maroon or dark, `wohlig-smile-mark.svg` for small marks. Never redraw, stretch or recolour it.
- **No sun, flower, petal, starburst or glowing-orb shapes, anywhere.** They were tried on the sign-in page and
  rejected. The only background motif allowed is the faint dot grid; when unsure, use none.
- **Clean layouts.** One clear job per area. The sign-in page is the pattern: the brand panel on one side, only the
  form on the other. No decoration behind or around a form.
- Animation stays quiet: one entrance sequence per screen (pieces rise in order) and buttons that answer hover and
  press. No looping or ambient background animation. Everything switches off under `prefers-reduced-motion`.
- Both themes: every screen works in light and dark ([frontend/src/theme.js](frontend/src/theme.js)).
- Use the `frontend-design:frontend-design` skill for new or reshaped screens.

## Brand in one place (always)

Names, logos, brand colours, fonts and the sign-in copy live in one file, [frontend/brand.config.json](frontend/brand.config.json).
The interface reads it through [frontend/src/brand.js](frontend/src/brand.js) (`BRAND`, `PRODUCT`; `applyBrand()` sets the `--brand-*`
variables the theme is built on), and the server through [backend/src/brand.js](backend/src/brand.js) (emails, PDFs, Excel files).
Never type the product name, company name or a brand hex into a component or a server file: import it. To re-brand, edit that
file and the logo files in `frontend/public`.

**Festival look:** from `festivalLook.daysBefore` days before a festival through the day, the sign-in page and the dashboard
banner show that festival's scene (`components/FestivalLook.jsx`, `GET /api/festival-look`). HR switches it off on Festival
wishes. Preview any festival with `?festival=<slug>` (for example `/login?festival=diwali`); it stays on in that browser tab until `?festival=off`. During that window the whole portal
takes the festival's colours (`festivalLook.festivals` in the brand file: a top ribbon, a chip in the top bar, the greeting) and plays
one short celebration a day, its own for each festival (Diwali lanterns and sparks, Holi colour bursts, Christmas snow, Eid
crescent moons, Ganesh Chaturthi gulal, Navratri dandiya sticks; set by `burst` in the brand file; about four seconds, then it
stops; off under reduced motion). A festival needs a date ahead, or its look never appears: HR adds dates on Festival wishes > Festival dates, and the
page warns when one is missing. A brand-new festival needs a developer: a row in `festivals` (schema.sql), its greeting
templates in `modules/festivals/designs.js` (words and layout) and `heroes.js` (the picture), and its colours and celebration in the brand file. Keep it to that: no looping effects, no buttons in the dashboard banner, and the scene itself is drawn once.

## Access: one engine (always)

Who may do what is decided by [backend/src/access.js](backend/src/access.js) with the permissions in
[backend/src/access-rules.js](backend/src/access-rules.js) (design: [docs/ACCESS_DESIGN.md](docs/ACCESS_DESIGN.md)). Super admins
give access per person on Company > Access, for the whole company or a reporting team.

- A new endpoint checks the caller with `need`/`needAll`, `can(req, perm, email)`, `scopeOf` for lists and `mayDecide` for
  decisions (never your own request). Never write `req.user.role === "hr"` or a new local `isHr` for a caller check.
- A new kind of admin action gets a permission in `access-rules.js` (with `team: true` only if it makes sense for a team).
- `users.role` is only a label now (kept in step with the HR access set). Never use it, or PAYROLL_REVIEWERS / FINANCE_VIEWERS, to decide anything.
- After a change to access, run `test/access-flow.mjs` against the local server (see its header).

## Salaries: the salary owners only (always)

Salaries, payslips, bank details, tax and finance reports, and every other payment (expense claims, advances and loans,
budgets, contractor payments) are decided and seen only by the salary owners (`SALARY_OWNERS`: chintan@wohlig.com,
chirag@wohlig.com and kailash@wohlig.com); each
person still sees and files their own. Decided 2026-11-27.

- The salary permissions (`SALARY_PERMS` in `access-rules.js`) are held by the owners and nobody else: not super admins, not a
  grant. Never add a way around it (a new role, a new permission that shows salary figures, a report, an export, a notice).
  A new screen or endpoint that shows a salary figure checks one of those permissions.
- Salary and every other payment figure (claims, advances, loans, budgets, contractor payments, tax declarations) is stored
  encrypted in the database (`secret-box.js`): a new salary column goes into its table's sealed column
  (`SEALED`), is written with `sealFields`, and is added up or filtered in the app, never in SQL (the plain columns are empty).
  Never put a salary figure in the audit log, a notification, an email or a server log: those are not encrypted.
- Personal details are stored encrypted too (2026-11-27): the personal email, phone, address, date of birth, masked Aadhaar,
  PAN and bank account and IFSC (`employees.person_sealed`), the PF number (`employees.pay_sealed`) and the whole My profile
  record with family and emergency contacts (`profiles.profile_sealed`). Names, work emails, job titles, teams, managers and
  joining dates stay plain (sign-in, search and reporting lines). A query that reads one of these fields also selects its sealed
  column; a change goes through `updatePerson`, `updateProfile` or `updateSealed` (`sealed-rows.js`); filters, sorting and
  birthdays on them are worked out in the app. A personal email is looked up by its keyed hash (`personalEmailTaken`).
- Personal documents and tax proofs are stored encrypted (`file-crypt.js`). Documents, tax proofs, Form 124 and payslips open
  only with the viewer's own document password (`doc-password.js`), and every one leaves as a PDF locked with it (`pdf-lock.js`,
  AES-256, for uploads and generated PDFs alike). Any new personal file or salary PDF goes the same way.
- **Claude never reads salaries, staff documents or the keys**, whoever asks: not from the database, `.env`, the uploads folder,
  a dump or the running app. `.claude/hooks/salary-guard.mjs` blocks it; do not work around it. If a task needs real figures,
  ask the salary owner to do that step.

## Styling: Tailwind CSS (always)

The interface is styled with [Tailwind CSS](https://tailwindcss.com) v4 (`tailwindcss` and `@tailwindcss/vite` in
`frontend/package.json`). The setup and the Wohlig theme are in [frontend/src/styles.css](frontend/src/styles.css), the one
CSS file; both entry pages load it. The move from hand-written rules is being done in stages (decided 2026-11-19).

- **New and changed screens use Tailwind classes** in the component's `className`. Use the Wohlig names from the theme
  (part B of `styles.css`): colours `maroon`, `orange`, `ivory`, `beige`, `terracotta`, `olive`; theme-following colours
  `paper`, `surface`, `tint`, `ink`, `ink-dim`, `ink-faint`, `accent`, `line`, `edge`, `ok`, `warn`, `bad`; fonts
  `font-display`, `font-body`, `font-mono`; radii `rounded-field` (12px), `rounded-card` (20px, as on wohlig.com). Tailwind's own palette is
  switched off, so `bg-red-500` produces nothing.
- **The semantic colours change with the theme by themselves**; reach for `dark:` only when a screen needs a different
  layout or a value the theme does not carry.
- **Breakpoints match the older rules**: `max-xs:` 460px and narrower, `max-sm:` 620px, `max-md:` 720px, `max-lg:` 900px,
  `max-xl:` 1080px, `max-2xl:` 1300px. Two named ones: `rail:` is 1024px and wider (the sections are in the top bar;
  below it, `max-rail:`, they are in a drawer) and `max-sheet:` is 560px and narrower (a dialog opens as a sheet).
- **Never add a rule to the `legacy` layer** (part C of `styles.css`), another `.css` file, a `<style>` block or a
  CSS-in-JS library. A new token goes in the theme; a pattern used in many places becomes a React component
  ([frontend/src/components/ui.jsx](frontend/src/components/ui.jsx)), not a new class.
- **Converting a screen**: move every element of the screen to Tailwind classes, then delete its rules from the `legacy`
  layer in the same change, and check the screen in a browser against how it looked before. A Tailwind class always
  beats an older rule (layer order), so a half-converted element is a bug, not a state to leave.
- **Class names that Tailwind owns must not be used for anything else** (`block`, `hidden`, `ring`, `border`, `shadow`,
  `flex`, `grid`, `table`, `fixed`, `container`, and the rest of its fixed utility names): Tailwind generates its
  utility for any such word it finds in the source, and that would override an older rule of the same name.
- Tailwind's reset (preflight) is not loaded yet, because the older rules rely on the browser's defaults. It is added
  when the `legacy` layer is empty. Until then a converted element sets what it needs itself (`m-0`, `border-0`, `p-0`).
- Converted so far: the page head (`SectionHead`), the underlined tabs (`PageTabs`, `ViewTabs`), the stat tile (`Stat`),
  the app shell in [Shell.jsx](frontend/src/components/Shell.jsx) (top bar with the section menus, phone and tablet
  drawer, account menu, tooltips, the bell button), dialogs in [Modal.jsx](frontend/src/components/Modal.jsx) (dimmed page, box, close
  button, phone sheet, and the title row, body and footer bar a dialog holds) and quick search
  ([QuickSearch.jsx](frontend/src/components/QuickSearch.jsx)) and status pills (`<Pill tone>`, or `pill("warn")` from
  `ui.jsx` for an element that is not a `<Pill>`; the class `pill p-warn` no longer exists). Keep this line current.
- **Inside a dialog, use the plain names `card-h`, `card-b` and `modal-f`** for the title row, body and footer: `Modal`
  styles them itself. The same footer bar on a page, outside a dialog, is `ACTION_BAR` from `ui.jsx`.
- Not converted yet, on purpose: the button (`.btn`) stays a class in the `legacy` layer while older rules still adjust
  buttons in places. Cards (`card`, `card-h`, `card-b`), form fields (`input`, `field`), tables, `row`, `muted` and `empty`
  are each used in 50 to 75 files and are adjusted by rules that belong to single screens (`.lv-bal .card-h`,
  `.rb-filters .input`). A Tailwind class beats those adjustments, so these move screen by screen, one module at a time,
  together with the rules that adjust them, not as one sweep.
- **Printing**: the shell and the page head hide themselves with `print:hidden!`. A new part of the frame needs the same.
- **`grid` and `grow` still have older rules** (`.grid` adds a 16px gap). Until they are removed, a Tailwind `grid`
  needs its own `gap-*` (use `gap-0` for none), and Tailwind's `grow` is switched off in `styles.css`: use `flex-1`.
- A class name built at run time (`` `lv-ring${big ? " big" : ""}` ``) is not found by searching for `"lv-ring"`. Search
  for the bare word before renaming or deleting a class.
- Inline `style={{…}}` is only for values computed at run time (a width from data, an animation delay).

## Component library: Radix UI, unstyled (always)

Behaviour that is hard to get right by hand (dialogs, dropdown menus, tooltips, popovers, tabs, selects) comes from
[Radix UI](https://www.radix-ui.com) (`radix-ui` in `frontend/package.json`). It ships no styles, so the Wohlig look stays ours.

- Import the part you need from `radix-ui` and style it with Tailwind classes (older parts still use classes in `styles.css`). In use today: `Dialog`
  ([frontend/src/components/Modal.jsx](frontend/src/components/Modal.jsx)), `DropdownMenu` (the account menu, table row menus, the post
  menu), `Popover` (notifications), `Tabs` (`ViewTabs` in [frontend/src/components/ui.jsx](frontend/src/components/ui.jsx)) and `Tooltip`.
- Kept as they are on purpose: select boxes stay native (they open the phone's own picker), and the date picker and people
  picker stay ours (Radix has no date picker or searchable combobox).
- Every dialog goes through `Modal`. Do not hand-roll a new overlay, menu or tooltip when Radix has the part.
- Do not add a styled kit (Material UI, Ant Design, Chakra, Mantine, shadcn/ui) or a CSS-in-JS or StyleX library: they
  bring their own look or a second styling system. Radix parts are styled with Tailwind classes. Checked on 2026-11-19:
  Meta's Astryx is in beta and needs React 19 and StyleX.

## Buttons: always the wohlig.com button

There is one button, copied from wohlig.com (measured on the live site, 2026-11-18). Its values are the `--btn-*`
tokens in `styles.css`.

| Use | Classes |
|---|---|
| Main action (one per view) | `btn primary` |
| Second action | `btn glass` |
| Page-level size, 50px tall as on wohlig.com | add `lg` |
| Full width (forms, phones) | add `flex w-full` (Tailwind; `block` is a Tailwind word and is no longer used) |
| Dense rows and tables | add `sm` |

- Primary: maroon gradient `#C85F44 → #800D35 → #6A0A2B`, ivory text, Fraunces 600 16px, pill shape, soft maroon
  shadow. On hover it lifts 2px, deepens, and a light sweeps across. Focus ring: 2px orange.
- Second: white glass with maroon text on light; ivory glass with ivory text on dark (wohlig.com has no dark theme).
- The primary button is the same in light and dark. Never an orange button.
- Never write a new button style, change a `--btn-*` value, or restyle a button inside a feature. If a screen needs
  something the standard lacks, add a size or variant to the standard, checked against wohlig.com.

## Wording: always professional

Text that staff read (screens, emails, PDFs, error messages) is professional and warm:

- Full sentences, correct grammar and spelling, sentence case. No slang, emoji or exclamation marks.
- Say what happened and what to do next. Ask with "Please"; never blame the person.
- One word per thing everywhere: "Sign in" (not "Log in"), "HR team", "work email".
- No technical words in front of staff: no "token", "session", "payload", status codes or stack traces.
- "Wohlig" takes a capital in sentences.
- The product name is **"Wohlig One"**: the portal is for every employee, not only the HR team. Use it on every screen,
  email, PDF, Excel file and script message, without "the" ("Sign in to Wohlig One"). Never write "HR Access Hub" or
  "HR Hub" again. The old name survives only in technical names that would lose data or break deploys if renamed: the
  `hrhub` database schema and volumes, the `hrhub_after` cookie, the Docker image tags and the npm package names.

## Fast by default: pages, data, images and files (always)

Every change keeps Wohlig One quick to open and quick to use, without being asked. Check each point when you add or change a
page, an endpoint, or anything that shows a picture or a file, wherever it is stored (the database, the uploads folder, or a
storage bucket such as Google Cloud Storage or S3 if one is added).

- **Pages load on demand.** A new page is added with `lazy(() => import("./Page.jsx"))`, never a plain import, so it stays out
  of the first script. Heavy libraries (charts, PDF, Excel, canvas drawing) are imported inside the page or the click that needs them.
- **One request per piece of data.** Cards that need the same read at the same time use `apiShared(url)` from `api.js`. No
  fetching in a loop, no refetch on every render; independent requests go out together (`Promise.all`).
- **Lists are paged.** An endpoint that returns rows takes a limit (100 at most) and reads only the columns it shows.
- **Pictures are made small before they are stored.** Shrink in the browser before upload (as `uploadPhoto` and `PhotoEditor`
  do): about 1600px on the long side for photos, 400px for faces, JPEG or WebP. Never store or send a picture as base64 inside JSON.
- **Pictures are served to be cached.** A picture's address changes when the picture changes (a new id, or `?v=<version>` as
  for profile photos), and the server answers with `Cache-Control: private, max-age=31536000, immutable` for it. An address that
  does not change uses `private, max-age=0, must-revalidate`. Always set `Content-Type` and `X-Content-Type-Options: nosniff`.
- **Pictures in a list or below the fold** get `loading="lazy" decoding="async"`; give them a fixed box (width and height, or a
  CSS size) so the page does not jump as they arrive. The logo and the first picture on screen load normally.
- **Files are streamed, not read whole.** Send stored files with `res.sendFile` or a stream; never load a large file into
  memory to send it. With a bucket, send the browser a short-lived signed address (or stream it through the server) with the
  same cache rules, and keep a small thumbnail beside a large picture for lists.
- **Scripts and styles go compressed** (`compressedAssets` in `pages.js`, gzip in nginx). A new kind of static file served by
  Express gets the same treatment.
- **Measure, do not guess.** Before calling a speed change done, open the page in a browser and compare first paint, the size of
  what is downloaded and the number of requests, before and after; put the numbers in the pull request.

## Database and API speed (always)

Every endpoint stays fast as the company grows. Budgets for server time (the `Server-Timing: app;dur=…` header that
[backend/src/timing.js](backend/src/timing.js) adds to every response): read one thing ≤ 150 ms, a list ≤ 300 ms, a write ≤ 400 ms.
Anything that can take longer (a whole-company export, an external service) runs in the background or is cached.

- **An index for every read path.** A new `WHERE` or `ORDER BY` on a table that grows gets an index in `schema.sql`
  (`CREATE INDEX IF NOT EXISTS`, named). Email lookups are written `lower(x)=$1` and need a `lower(x)` index; a plain index on
  the column is not used. Check a new query with `EXPLAIN ANALYZE` on the local database: no `Seq Scan` on a table that grows.
- **No query inside a loop on a request.** Fetch everything at once with `= ANY($1)` (or one `JOIN`), then match in memory with
  a `Map`; write many rows with one statement (`unnest`) where it is easy. Loops are fine in start-up steps and background jobs.
- **Independent reads go together** with `Promise.all` on the pool. Inside a transaction they must take turns (one client):
  use the `together(db, …)` pattern in `payroll/store.js`.
- **Lists are bounded and lean.** A `LIMIT` (at most 500, page beyond that), only the columns the page shows (no `SELECT *` in
  a list), and correlated subqueries only when they hit an index.
- **Never wait on another service in a request** (Claude, Google, SendGrid, Gemini): start it in the background (as
  `syncClaudeSoon` and the notices do) or give it a timeout and a fallback.
- **Use the shared pools** (`pool`, `payPool` in `db.js`): they keep connections warm and have a statement timeout. Never create
  a new `pg.Pool` or `Client` for a request.
- **Expensive results that do not change by the second** (a payroll preview, a whole-company report) are kept for a short time
  in memory (see `previewTotals` in `payroll/routes.js`), and the cache is cleared or short enough to stay correct.
- **Prove it.** Before calling a change done, call the new or changed endpoints a few times on the local server and read the
  `Server-Timing` header; the server log must have no `[slow request]` line for them. Put the numbers in the pull request.

## Loading: always skeletons, never "Loading…" (always)

Nothing anywhere shows a "Loading…" text, spinner-only box or blank area while it waits. It shows the **shape of what is coming**,
softly lit, from the shared pieces in [frontend/src/components/ui.jsx](frontend/src/components/ui.jsx):

| While this loads | Use |
|---|---|
| A whole page | `<PageSkeleton />` (`stats={0}` when the page has no figures) |
| A card or list body | `<ListSkeleton rows={…} />` (`faces={false}` for lists without people) or `<CardSkeleton lines={…} />` |
| Table rows | `<TableSkeletonRow cols={…} />` inside `<tbody>` |
| One line of text | `<LineSkeleton width="w-40" />` |
| A picture being drawn | `<Skeleton className="aspect-square w-full rounded-card" />` |

- Match the real layout (same card, same row height, faces where faces will be), so nothing jumps when the content arrives.
- Each skeleton already says "Loading" to screen readers only (`role="status"`); add no visible text.
- Its gentle sheen is the one looping animation allowed (it stops when the content arrives, and the reduced-motion rule turns it off).
- Empty and error states stay as words ("No requests yet.", the error): a skeleton is only for waiting.
- Words for an action in progress on its own button ("Saving…", "Uploading…") are fine: that is feedback, not loading.

## Responsive on every screen, tested in a browser (always)

This applies to everyone who works in this repo, on every screen they add or change.

- Every screen must work on every screen size: small phone, phone, tablet, laptop, desktop and large monitor, in
  portrait and landscape. No sideways scroll, no cut-off or overlapping content, no text below 14px.
- Build it responsive from the start: fluid widths, `clamp()` sizes, grid or flex that reflows, container or media
  queries. Never fixed pixel widths for layout.
- **Check every interface change in a browser before calling the work done. This is compulsory** for any change
  under `frontend/` (pages, components, styles, `brand.config.json`, files in `frontend/public`), however small.
  Use the browsers in this order:
  1. **Claude's own browser** (the browser pane in the Claude app, `mcp__Claude_Browser__*`): `preview_start` the
     local server from `.claude/launch.json`, then `navigate`, `read_page`, `resize_window`, a screenshot and
     `read_console_messages`.
  2. **Claude in Chrome** (the Chrome extension, `mcp__claude-in-chrome__*`) when the built-in browser cannot reach
     the page.
  3. **Playwright** (the `playwright-cli` skill or the Playwright browser tools) only as the fallback, when neither
     Claude browser works. Say why the first two could not be used.
- A Stop hook enforces it ([.claude/hooks/browser-check.mjs](.claude/hooks/browser-check.mjs)): when a file under
  `frontend/` changed and no browser looked at a page afterwards, Claude is sent back once to check it. Opening the
  server or listing tabs does not count; a page has to be looked at.
- Open the page at these sizes:

  | Screen | Size |
  |---|---|
  | Small phone | 320 x 568 |
  | Phone | 390 x 844 |
  | Phone, landscape | 844 x 390 |
  | Tablet | 768 x 1024 |
  | Small laptop | 1024 x 768 |
  | Laptop | 1280 x 720 and 1440 x 900 |
  | Large monitor | 1920 x 1080 |

- At each size: check `scrollWidth` is not wider than the window, take a screenshot and look at it, in light and
  dark. Click through the screen's main actions and read the console; there must be no errors.
- Use the browser skills for deeper checks: `chrome-devtools-mcp:a11y-debugging` for accessibility,
  `chrome-devtools-mcp:chrome-devtools` for layout and network problems.
- In the pull request, list the sizes tested and anything that was not tested. Never write "responsive" or
  "verified" from reading the code alone.
- To see a page without the database, serve `frontend/dist` and `frontend/public` from a small local server with the
  API calls stubbed, as was done for the sign-in page.

## Done means checked

- A UI change is checked in a real browser before it is called done (sizes above), light and dark, keyboard focus
  visible, no sideways scroll, no console errors. Say what was checked.
- Text contrast is 4.5:1 or better (3:1 for text 24px and larger). Inputs have labels; errors use `role="alert"`.
- Touch targets are 44px or taller.

## Commands

| Task | Command |
|---|---|
| Run the server | `cd backend && npm run dev` (needs `backend/.env`, see `backend/.env.example`) |
| Run the interface with hot reload | `cd frontend && npm run dev` (proxies the API to port 3000) |
| Build the interface | `cd backend && npm run build:ui` |
| Unit tests (includes the ARCHITECTURE.md check) | `cd backend && npm test` |
| Check ARCHITECTURE.md against the code | `cd backend && npm run check:docs` |
| Everything in Docker | `docker compose up --build` (http://localhost:8080) |

## Things that are easy to get wrong

- **`frontend/dist` is committed** and is what the server serves outside Docker. After any change under
  `frontend/src`, rebuild and commit `dist` in the same change.
- **The schema lives in `backend/src/schema.sql`**, applied on every server start. `backend/migrations/hrhub-schema.sql`
  is an older copy. Schema changes must be safe to run again on a live database.
- **A new page loads on demand**: add it with `lazy(() => import("./Page.jsx"))` (in `App.jsx` or the module's `index.jsx`), never a plain import, or it goes back into the first script everyone downloads.
- **A new public path needs two edits**: `backend/src/pages.js` and `frontend/nginx.conf.template`.
- **Logos are served from the site root by Express**, not copied by Vite (`publicDir` is off). A new file in
  `frontend/public` must be added to the list in `backend/src/pages.js` and to the dev proxy in `frontend/vite.config.js`.
- Never commit `backend/.env`, database dumps or anything with staff data.

## Git

Work on a new branch (`feat/…`, `fix/…`, `docs/…`), push that branch only, and raise a pull request. Never push to
`main`. Commit messages and pull requests carry no AI attribution.
