---
title: Tools and their cost, design
updated: 2026-11-19
---

> [!info] Status
> Built. Manage > Tools & cost (`frontend/src/modules/tools`), API `backend/src/tools.js`, rules `backend/src/tools-rules.js`.

## What it is for
Wohlig pays for more than Claude: ChatGPT, Gemini, GitHub Copilot, Cursor, Perplexity, Notion AI and others. HR (and finance) need
one place to see who has a seat in each tool and what all of it costs per month.

## Decisions (user, 2026-11-19)
- Cost = seats at a monthly price per seat, plus monthly bills HR records for usage-based tools or invoices.
- Rupees and dollars are totalled separately, never converted.
- Starting list: Claude, ChatGPT, Gemini, GitHub Copilot, Cursor, Perplexity, Notion AI; HR adds more (prices start empty, HR sets them).
- Cost is visible to "Tool access" (tools.manage) and "See finance reports" (finance.view) holders; staff see only their own tools.

## Data (all additive; schema.sql, "Tools and their cost")
- `tools`: slug, name, vendor, category, billing (seat, usage, seat_and_usage, free), seat_cost_minor (paise or cents per seat per
  month, null = not set), currency (INR or USD), connected (Claude: seats move through Claude itself), url, notes, is_active, sort.
- `tool_access` (existing): one row per person and tool; adds `seat_cost_minor` (a person's own price), `since`, `updated_by`.
  A seat is paid while its status is active or member; invited, pending or requested are "waiting" and not counted.
- `tool_bills`: tool, month (YYYY-MM), amount_minor, currency, note; removing keeps the row (`deleted_at`).

## Behaviour
- Giving and removing seats by hand for tools that are not connected; Claude keeps its own flow on the person's page.
- Offboarding adds "Remove the <tool> seat" to the leaver's checklist for each hand-tracked seat; ticking it marks the seat removed.
- Costs: per tool (seats x price + bills), per department, and totals per currency for the chosen month.
- Every change goes to the audit log.

## Rollback
Nothing existing changes shape: drop the page and router, and the new tables and columns are simply unused.
