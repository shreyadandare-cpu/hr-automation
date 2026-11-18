# HR Access Hub (Wohlig HR portal)

Wohlig's internal HR portal: one Express server on Postgres ([backend/](backend/)) and one React interface
([frontend/](frontend/)). Staff sign in with their @wohlig.com Google account.

## Read first, every task

1. [ARCHITECTURE.md](ARCHITECTURE.md): the map of the repo (routes, pages, tables, how it runs). Read it before opening
   code, and update it in the same change when routes, pages, tables or env vars change.
2. [docs/BRAND_GUIDELINES.md](docs/BRAND_GUIDELINES.md): the Wohlig brand rules. Read it before any change a person
   can see: a screen, an email, a PDF, a document template.

## Design: always the Wohlig brand

Every screen follows the brand guidelines and the look of wohlig.com. The sign-in page
([frontend/src/login/](frontend/src/login/), [frontend/src/login.css](frontend/src/login.css)) is the reference build.

- Colours and fonts come from the tokens in [frontend/src/brand.css](frontend/src/brand.css). Never type a brand hex
  value or a font name into a component.
- Deep Maroon `#800D35` for identity and the primary action, Warm Ivory `#FFF7E9` as the page base, Sunset Orange
  `#F7781D` for one focal point per screen. Beige, terracotta and olive are supporting colours.
- Never put white or ivory text on orange (2.7:1, fails). Orange buttons take dark ink text.
- Headlines in Fraunces (`--brand-display`), everything else in Lato (`--brand-body`). Body text 16px.
- The logo is always a master file from [frontend/public/](frontend/public/): `wohlig-logo.svg` on light,
  `wohlig-logo-dark.svg` on maroon or dark, `wohlig-smile-mark.svg` for small marks. Never redraw, stretch or recolour it.
- Graphic motifs: flower, arch, dot grid, as thin line art. One per screen, with space around it.
- Animation is part of the brand: one entrance sequence per screen, line art that draws in, slow ambient movement,
  buttons that answer hover and press. Every animation switches off under `prefers-reduced-motion`.
- Both themes: every screen works in light and dark ([frontend/src/theme.js](frontend/src/theme.js)).
- Use the `frontend-design:frontend-design` skill for new or reshaped screens.

## Wording: always professional

Text that staff read (screens, emails, PDFs, error messages) is professional and warm:

- Full sentences, correct grammar and spelling, sentence case. No slang, emoji or exclamation marks.
- Say what happened and what to do next. Ask with "Please"; never blame the person.
- One word per thing everywhere: "Sign in" (not "Log in"), "HR team", "work email".
- No technical words in front of staff: no "token", "session", "payload", status codes or stack traces.
- "Wohlig" takes a capital in sentences. The product name is "HR Access Hub".

## Done means checked

- A UI change is checked in a real browser before it is called done: desktop and phone width (down to 320px), light
  and dark, keyboard focus visible, no sideways scroll, no console errors. Say what was checked.
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
