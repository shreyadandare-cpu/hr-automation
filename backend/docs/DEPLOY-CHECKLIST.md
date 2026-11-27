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
| `SALARY_OWNERS` | `kailash@wohlig.com` (the default) | The only people who see salaries, payslips, bank details and finance reports. |
| `PAYROLL_ENCRYPTION_KEY`, `DOCUMENTS_ENCRYPTION_KEY` | each `openssl rand -hex 32`, from the secret store (below) | Every salary figure, bank number, PAN, Aadhaar and document is encrypted with them. Without them no salary or document can be saved or read. |
| `BACKGROUND_JOBS` | leave on only on the **one** server that should run scheduled jobs | Daily leave digest, reminders, payslip notices. |

Do not copy `backend/.env` into an image. It is excluded by `.dockerignore`.

## Salaries: the keys, and who may hold them

The app shows salaries only to `SALARY_OWNERS`, and the database holds them only encrypted. That keeps them from every developer
and every AI tool **only while nobody else holds the key together with the database**. The code cannot enforce this part; how the
server is run does:

1. Keep `PAYROLL_ENCRYPTION_KEY` and `DOCUMENTS_ENCRYPTION_KEY` in the cloud secret store (Google Secret Manager or the host's
   equivalent) and give the server access to them as secrets, not as plain environment values in the service settings (those can
   be read by anyone who can view the service).
2. Only the person who deploys and the salary owner may read those secrets. Developers do not get them, and never put them in a
   `.env` on a laptop, in chat, in a ticket or in the repository.
3. Back both keys up offline (for example in the salary owner's password manager). Without them no salary or document can be read again.
4. Developers work on a local database with made-up salaries. A copy of the live database is still encrypted; it is useless without the key.
5. Require a review on `main` (branch protection), so no change that sends salaries elsewhere can go live unseen.
6. Claude Code is kept away from salaries, documents and keys by `.claude/hooks/salary-guard.mjs`. Other AI tools are not; they see
   only what a developer can see, which is why points 1 and 2 matter.

## What the new backend does to the database when it starts
**Salary release (2026-11-27):** on its first start it encrypts every salary figure already stored (payroll, salary structures,
adjustments, totals, payroll history details, monthly gross, exit settlements, offer letters, payroll Excel reports) and empties the
plain columns, and the same for every other payment (expense claims, advances, loans, budgets, contractor payments, tax declarations).
After it has started once, run `cd backend && node scripts/salary-encryption.mjs --redact-old-text` to count notices and audit lines from
before that still name an amount, and add `--commit` to remove those amounts. Stop the old release first and then start this one; never run both at once. To go back to an older release, stop
the server and run `cd backend && node scripts/salary-encryption.mjs --down` first. `node scripts/salary-encryption.mjs` (no option)
shows how many rows are encrypted and how many are still plain.

Otherwise it only adds things (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), never removes or rewrites data:

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
