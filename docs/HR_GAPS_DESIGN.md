---
title: HR gaps, design record
aliases: [HR gaps design, Timesheets surveys training design]
tags: [design, schema, hr]
repo: hr-automation
role: schema design record for the HR gap features (2026-11-19)
updated: 2026-11-19
---

# HR gaps, design record

> [!info] What this covers
> Timesheets, review cycles with a manager review and colleague feedback, surveys, training records, notice periods,
> approval stand-ins, and hiring carried into onboarding with interview scheduling. Owner: this repo
> ([backend/src/schema.sql](../backend/src/schema.sql), applied on start, safe to run again). Related:
> [KEKA_PARITY_DESIGN.md](KEKA_PARITY_DESIGN.md), [ARCHITECTURE.md](../ARCHITECTURE.md).

## Classification

All changes are **additive (class A)**: new tables, plus new nullable columns on `reviews`. No column is renamed,
removed, retyped or given a new meaning. Older code ignores the new columns; a review with no `manager_email` behaves
exactly as before (self-review, then HR). Rollback: drop the new tables and the new `reviews` columns, remove the routes
and pages.

## New tables

| Table | Holds | Read paths and indexes | Personal data and visibility |
|---|---|---|---|
| `timesheet_weeks` | One week per person: Monday's date, status (draft, submitted, approved, returned), who decided | by person and week (unique); submitted weeks by status | Owner, their reporting manager, HR |
| `timesheet_entries` | Minutes per project per day of a week; project empty = internal work | by week | as above |
| `surveys` | Title, questions (JSON, at most 20), anonymous or named, closing date | open surveys by closing date | Created by HR |
| `survey_takers` | Who has answered (one answer each) | by survey and person (unique) | Never joined to answers |
| `survey_responses` | The answers. For an anonymous survey there is no email on the row | by survey | Results to HR only; an anonymous survey shows nothing until 3 people answer |
| `trainings` | Title, what it is, link, due date | open trainings by due date | None |
| `training_assignments` | Who must do it, when they finished, their note | by training; by person | Owner and HR |
| `resignations` | Date of resignation, notice days, agreed last day, note | by person (unique) | HR only |
| `approval_stand_ins` | Who covers whose approvals, from and to | active ones by the person covered and by the stand-in | Manager, the stand-in, HR |
| `review_cycles` | A cycle HR launches for everyone or a department: name, due dates, status | by status | HR |
| `review_feedback` | Feedback from a colleague on a review: who asked, who wrote, the text | by review; by writer | HR and the reviewer's manager see it; the reviewed person does not |
| `interviews` | A candidate's interview: when, how long, how, where, interviewers, each interviewer's verdict and notes | by candidate; by interviewer | HR and the interviewers |

## New columns on `reviews`

`cycle_id`, `manager_email`, `manager_text`, `manager_rating`, `manager_at`. Status adds `manager-pending` between
`self-pending` and `hr-pending`, used only when a manager is set.

## Rules decided here (please confirm)

- **Notice period**: 30 days unless HR types another number for the person (`NOTICE_PERIOD_DAYS` changes the default).
  The expected last day is the resignation date plus the notice days. A last day before that is flagged as short notice.
- **Stand-ins** cover leave approvals only, for at most 90 days. The person covered still sees and can decide.
- **Surveys**: anonymous by default; results hidden until 3 answers; written answers shown without names or order.
- **Timesheets**: a day holds at most 24 hours. Only approved weeks feed cost by project, and then they replace the
  percentage shares for that person and month.
- **Interviews** are stored in India time. A calendar file (.ics) is offered; nothing is sent to Google Calendar.

## Not built, on purpose

- A public job application page: it is the first page anyone could write to without signing in, so it needs a decision
  on spam protection and on storing applicants' CVs first.
- Sending calendar invites through Google: needs a Google Calendar connection the app does not have.

## Checks

`npm test` before and after (the rules have their own tests), `npm run check:docs`, and every new page at the sizes in
[CLAUDE.md](../CLAUDE.md), light and dark.
