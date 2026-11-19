# Redeploy checklist (Wohlig One)

Build **both** images from `main` and redeploy **both**. The email links, the poster pictures and the new pages need the new frontend
(nginx) image; the new features and the director email block need the new backend image.

```
docker build -f backend/Dockerfile -t hrhub-backend .      # from the repo root
docker build -t hrhub-frontend frontend
```

## Settings the server must have

| Setting | Value | Why |
|---|---|---|
| `PUBLIC_URL` | the real https address, e.g. `https://hr.wohlig.com` | Links in emails and the poster picture in emails are built from it. Anything with `localhost` makes email links and poster pictures unusable. |
| `FRONTEND_URL` | same as `PUBLIC_URL` | Invitation links. |
| `SENDGRID_API_KEY`, `MAIL_FROM` | the SendGrid key and the verified sender | Without them nothing is emailed (Festival Wishes sharing shows a message instead). |
| `MAIL_SKIP_RECIPIENTS` | leave **unset** (default is Chirag and Chintan) | Directors get no email. Setting it to empty turns the block off. |
| `PAYSLIP_AUTO` | `off` **until HR has entered the real salaries** | Stops the hourly job that starts and recalculates the monthly payroll draft. With it off, payroll changes only when HR does something. Remove it (or set anything else) to turn the automation back on. |
| `GEMINI_API_KEY` | a Gemini API key (Google AI Studio) | LinkedIn kit: the headline suggestions. Without it the button says Gemini isn't set up. Model defaults to `gemini-flash-lite-latest` (`GEMINI_MODEL` to change). Keep the key in the server settings only. |
| `PAYROLL_REVIEWERS`, `PAYROLL_ENCRYPTION_KEY` | as in `backend/.env.example` | Payroll approval and bank details. |
| `BACKGROUND_JOBS` | leave on only on the **one** server that should run scheduled jobs | Daily leave digest, reminders, payslip notices. |

Do not copy `backend/.env` into an image. It is excluded by `.dockerignore`.

## What the new backend does to the database when it starts
It only adds things (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), never removes or rewrites data:

- Celebrations tables (`celebrations`, `celebration_recipients`, `celebration_alerts`) and their extra columns.
- Festival Wishes tables (`festivals`, `festival_dates`, seeded with 7 festivals and their 2026 and 2027 dates).
- `created_by` and `decided_by` on `comp_off_credits`.

These are already present in the shared database, so the first start changes nothing there. The payroll schema, salaries, payslips and
tax rules are not touched by this release (the existing startup step only creates what is missing and never overwrites a saved tax rule).
Check the festival dates in `festival_dates` each year; Eid depends on the moon.

## After the redeploy (two minutes)
1. Open an email link from a test email (or `https://<site>/l/anything`): it must show **"This link has expired"** (the app's page), not an nginx 404.
2. Signed in, open **Community → Festival Wishes**: seven festivals, four templates each.
3. **My leave → Comp off history** and (HR) **Leave → Comp off history** open.
4. HR: **Payroll → Tax rules → Upload rules** downloads the Excel template.
5. Send nothing to the whole company as a test: check **Celebrations** shows the history only.

## If something is wrong
Redeploy the previous images. Nothing in this release removes or changes existing data, so going back loses nothing.
