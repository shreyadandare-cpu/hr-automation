# Wohlig One (the Wohlig employee portal, formerly "HR Access Hub")

Wohlig's internal HR portal: one Express server on Postgres ([backend/](backend/)) and one React interface
([frontend/](frontend/)). Staff sign in with their @wohlig.com Google account.

## Read first, every task

1. [ARCHITECTURE.md](ARCHITECTURE.md): the map of the repo (routes, pages, tables, how it runs). Read it before opening
   code, and update it in the same change when routes, pages, tables or env vars change.
2. [docs/BRAND_GUIDELINES.md](docs/BRAND_GUIDELINES.md): the Wohlig brand rules. Read it before any change a person
   can see: a screen, an email, a PDF, a document template.

## Design: always the Wohlig brand

Every screen follows the brand guidelines and the look of wohlig.com. The sign-in page
([frontend/src/login/](frontend/src/login/), section 7 of [frontend/src/styles.css](frontend/src/styles.css)) is the reference build.

- Colours and fonts come from the brand tokens at the top of [frontend/src/styles.css](frontend/src/styles.css). Never type a brand hex
  value or a font name into a component.
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

## One stylesheet (always)

All CSS for the interface lives in one file: [frontend/src/styles.css](frontend/src/styles.css). Both entry pages
load it.

- Never add another `.css` file, a `<style>` block or a CSS-in-JS library. Add to the right numbered section of
  `styles.css` (the list is at the top of the file), or start a new numbered section there.
- Prefix a feature's classes (`.dk-*`, `.fw-*`, `.auth-*`) so sections cannot collide. The app's element rules
  (`body`, `h1`, `button`, `input`) reach every page, so scope new page styles under one wrapper class.
- Inline `style={{…}}` is only for values computed at run time (a width from data, an animation delay).
- A section's phone and tablet rules go at the end of that section.

## Buttons: always the wohlig.com button

There is one button, copied from wohlig.com (measured on the live site, 2026-11-18). Its values are the `--btn-*`
tokens in `styles.css`.

| Use | Classes |
|---|---|
| Main action (one per view) | `btn primary` |
| Second action | `btn glass` |
| Page-level size, 50px tall as on wohlig.com | add `lg` |
| Full width (forms, phones) | add `block` |
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
- The product name is **"Wohlig One"**: the portal is for every employee, not only the HR team. The sign-in page uses
  it. The older name "HR Access Hub" is still in the signed-in app, emails and the attendance tool; use "Wohlig One"
  in anything new, and rename the old places only in a change made for that purpose.

## Responsive on every screen, tested with Playwright (always)

This applies to everyone who works in this repo, on every screen they add or change.

- Every screen must work on every screen size: small phone, phone, tablet, laptop, desktop and large monitor, in
  portrait and landscape. No sideways scroll, no cut-off or overlapping content, no text below 14px.
- Build it responsive from the start: fluid widths, `clamp()` sizes, grid or flex that reflows, container or media
  queries. Never fixed pixel widths for layout.
- **Test with Playwright before calling the work done.** Load the `playwright-cli` skill, or use the Playwright
  browser tools, and open the built page at these sizes:

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
| Unit tests | `cd backend && npm test` |
| Everything in Docker | `docker compose up --build` (http://localhost:8080) |

## Things that are easy to get wrong

- **`frontend/dist` is committed** and is what the server serves outside Docker. After any change under
  `frontend/src`, rebuild and commit `dist` in the same change.
- **The schema lives in `backend/src/schema.sql`**, applied on every server start. `backend/migrations/hrhub-schema.sql`
  is an older copy. Schema changes must be safe to run again on a live database.
- **A new public path needs two edits**: `backend/src/index.js` and `frontend/nginx.conf.template`.
- **Logos are served from the site root by Express**, not copied by Vite (`publicDir` is off). A new file in
  `frontend/public` must be added to the list in `backend/src/index.js` and to the dev proxy in `frontend/vite.config.js`.
- Never commit `backend/.env`, database dumps or anything with staff data.

## Git

Work on a new branch (`feat/…`, `fix/…`, `docs/…`), push that branch only, and raise a pull request. Never push to
`main`. Commit messages and pull requests carry no AI attribution.
