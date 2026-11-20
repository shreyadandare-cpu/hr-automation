---
title: Keka parity: features that need new data
aliases: [Keka parity design, Schema design record for Keka features]
tags: [design, schema, keka, proposal]
repo: hr-automation
role: schema design record for approval before any table is added
updated: 2026-11-19
---

# Keka parity: features that need new data

> [!info] Status on 2026-11-19: all nine are built in a first form; see the limits below
> Built: Polls, Praise, Articles, Advance requests, Attendance requests (including work from home) and Apps
> ([backend/src/engage.js](../backend/src/engage.js), `frontend/src/modules/engage/`).
> Web clock-in (6) needed no new table: the server already had a one-tap punch for HR and already counts hours from IN and
> OUT pairs whatever their source. It is now open to everyone when `WEB_CLOCK_IN=true` (off by default).
> Manage tax (7) is a submission for payroll to review, in its own table `tax_declaration_requests`. Payroll already had a
> `tax_declarations` table that its calculation reads; that table is not written by the employee form, so no payslip changes.
> Tax proofs: `tax_declaration_requests` gained one column, `proofs` (HR's note per declared line: received, verified or sent back).
> It is additive, defaults to empty, and is cleared when the person changes the lines. Documents are not uploaded.
> Finance reports (statutory dues, journal, cost, gratuity, annual tax) add no tables: they only read payroll.
> Accountant tools (2026-11-19): two new tables, `contractor_payments` (money in paise, masked PAN only, soft delete, index on `paid_on`)
> and `tax_proof_files` (one uploaded document per declared line, file on disk), and one nullable column,
> `employee_project_allocations.share_percent`. All additive; older code ignores them. Rollback: drop the two tables and the column.
> Performance (8) is personal goals plus praise. Reviews, ratings and manager visibility are not built: HR decides those rules first.

## What is already matched (no new data)

Home (banner, Quick access, feed), Me (Attendance, Leave, Profile), Inbox (Take action, Notifications, Archive),
My Team (Summary, Team leave), My Finances (Summary, My pay), Org (Employees: directory and tree, Documents, Allocations),
Engage (Announcements, Celebrations, Festival wishes).

## Proposed features, in suggested order

Every table: owner is this repo (`schema.sql`, applied on start, safe to run again), `id bigserial`, `created_at`,
`updated_at`, soft delete with `deleted_at`, snake_case columns, an index for every read path, and all changes additive.
No existing table changes shape. Rollback for each: drop the new tables and remove the routes and pages.

| # | Keka feature | New tables | Read paths (indexes) | Personal data | Size |
|---|---|---|---|---|---|
| 1 | Engage: Polls | `polls` (question, options jsonb, closes_at, created_by), `poll_votes` (poll_id, voter_email, option_index, unique per poll and voter) | open polls by `closes_at`; votes by `poll_id` | Who voted for what: show totals only, never names | Small |
| 2 | Home and Me: Praise | `praises` (from_email, to_email, message, badge) | by `to_email`, newest first; feed by `created_at` | Names and messages, visible to everyone by design | Small |
| 3 | Engage: Articles | `articles` (title, body, cover_file, status draft or live, published_at, author_email) | live by `published_at` | None beyond the author | Small |
| 4 | Me: Expenses, Advance requests | `advance_requests` (email, amount_minor, currency, reason, status, decided_by, decided_at) linked to the existing advances HR records | by `email`; pending by `status` | Money owed to or by a person: owner and HR only | Medium |
| 5 | Me: Attendance requests and remote working | `attendance_requests` (email, date, kind: missed punch, work from home, on duty; note; status; decided_by) | by `email` and month; pending by `status`; today's approved WFH | Where a person works: team and HR only | Medium |
| 6 | Home: web clock-in ("Time today") | `web_punches` (email, at, direction, source) merged with device punches when hours are counted | by `email` and day | Location is not stored | Medium; changes how hours are counted, so it goes behind a setting |
| 7 | My Finances: Manage tax | `tax_declarations` (email, financial_year, regime, items jsonb, status, proof files) | by `email` and year | Sensitive financial data: encrypted like payroll bank details, owner and payroll reviewers only | Large; touches payroll tax |
| 8 | Me: Performance, Feedback | `feedback` (from_email, to_email, text, visibility), later goals and review cycles | by `to_email` | Sensitive: needs clear visibility rules first | Large; needs HR to decide the rules |
| 9 | Me: Apps | none: a list of links kept in settings | - | None | Small, but only useful once there are apps to list |

## Checks before each one ships

- Old pages keep working: every change is a new table and new routes; nothing existing is renamed or removed.
- `npm test` passes before and after, compared against the same baseline.
- Money (4, 7) and anything that changes pay or hours (6, 7) ship switched off, behind a setting HR turns on.
- Each page is checked at the sizes in CLAUDE.md, light and dark.

## Not proposed

Keka's own colours, logo and illustrations. Wohlig One keeps the Wohlig brand ([BRAND_GUIDELINES.md](BRAND_GUIDELINES.md)).
