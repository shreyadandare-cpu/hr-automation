# Payroll processing and salary disbursement

This covers the monthly payroll in the HR Access Hub: salary set-up, calculation, the Excel report, review and approval, the bank transfer file and the history. The database is the record. The Excel and bank files are stored copies of it.

```
Onboarding → salary structure + bank account (Payroll › Salary & bank)
→ HR starts the month → lines are calculated from salaries, unpaid leave, approved claims, adjustments, tax declarations
→ HR edits inputs (incentives, bonus, LOP, deductions, TDS override with a reason, hold)
→ Mark as calculated → Generate Excel report → Send for review
→ Reviewer approves (or rejects / requests changes → HR corrects → back to draft)
→ Generate bank file → upload in corporate banking (outside the app) → Mark as processed with the bank's reference
→ History keeps everything; corrections go through adjustments in a later month
```

## Roles

| Who | How they get it | Can |
|---|---|---|
| HR | `users.role = 'hr'` | Everything except approving. Salaries, bank details, tax rules and declarations, monthly inputs, reports, bank file, marking processed |
| Payroll reviewer (Chirag Shah) | Email listed in `PAYROLL_REVIEWERS` (default `chirag@wohlig.com`) | See payrolls **once they are sent for review**, every line's calculation, the Excel report and history. Approve, reject or request changes. Never sees bank account numbers or the bank file. |
| Employee | everyone else | Their own payslip only (`/api/payslips`), once the month is approved |

The person who sent a payroll for review can't approve it (maker-checker), even if they are also listed as a reviewer.

## Workflow statuses

| Status | Meaning | Next |
|---|---|---|
| Draft | Started. Lines are calculated, and HR is editing inputs | Mark as calculated |
| Calculated | Every line is ready or on hold | Generate report |
| Generated | Excel report stored (versioned) | Send for review |
| Pending review | The reviewer is notified | Approve / Reject / Request changes |
| Rejected · Changes requested | Back with HR, with the reviewer's reason | HR edits → Draft |
| Approved | Figures final. Payslips are published to employees | Generate bank file |
| Ready for bank processing | Bank CSV stored (encrypted) | Mark as processed (with the bank reference) |
| Processed | The bank confirmed the transfer. Claims in the run are marked paid | (final) |

Any edit (inputs, recalculation) before approval moves the run back to **Draft** and supersedes the report, so a report that no longer matches the numbers can't be sent. From **Approved** on, the run can't change. The API refuses, and a database trigger (`payroll_items_frozen`) blocks direct edits too. Runs made before this workflow show as *Processed (before review)* and are read-only.

## Calculation (backend/src/payroll/engine.js)

All money is handled in paise (integers) and turned into rupees at the end, so totals never drift. Prorated components are rounded to whole rupees.

```
Days employed     = calendar days in the month between joining date and last day
Fixed earnings    = each structure line × days employed / days in month        (Basic, HRA, allowances)
Gross earnings    = Basic + HRA + Allowances + Incentives + Bonus + Overtime + Other earnings
                    + positive adjustment + arrears + Reimbursements
Loss of pay       = full-month fixed gross ÷ 30 × LOP days     (approved unpaid/over-balance leave + days HR enters)
PF (employee)     = amount on the structure (prorated), or 12% × min(Basic earned after loss of pay, ₹15,000)
Professional tax  = amount on the structure (February amount in February, e.g. ₹300 in Maharashtra)
Total deductions  = PF + PT + TDS + Loss of pay + other deductions (structure, HR input, recoveries, negative adjustment)
Net payable       = Gross earnings − Total deductions
```

Employer PF is shown as company cost and is **never** deducted from take-home pay. Reimbursements are paid with salary but are not taxable salary. A line is **incomplete** (and blocks calculation until fixed or put on hold) if there is no salary structure, no tax rules for the year, a fixed TDS is missing above ₹12 lakh, or net pay is zero or below (put such a salary on hold). Calculating a month is refused while an earlier month of the same financial year is not yet approved, because TDS counts what earlier months deducted. A salary bank account can't be changed for someone whose approved payroll isn't marked processed yet.

## TDS (backend/src/payroll/tax.js)

Tax rules are data, one row per financial year and regime in `tax_rules`, edited in Payroll › Tax rules. The defaults are FY 2025-26 and FY 2026-27 under the Finance Act 2025, unchanged by Budget 2026. Have the CA confirm each year before its first payroll.

```
Projected salary  = taxable salary already paid this FY (earlier runs) + this month's taxable salary
                    + full monthly gross × months left after this one (fewer if the person is leaving)
Gross income      = projected salary + previous employer's salary + other income declared
Taxable income    = gross income − standard deduction − deductions the regime allows (capped per the rules)
Tax               = slabs → rebate 87A (with marginal relief where the regime has it) → surcharge (with marginal relief) → 4% cess,
                    rounded to ₹10
This month's TDS  = (tax − TDS already deducted this FY − previous employer's TDS) ÷ months left including this one
```

**Going live mid-year:** for months paid before payroll ran in this app, enter each person's *taxable salary, TDS and PT we paid this year before payroll moved here* in their Tax details. They count as already paid, so the year's TDS is not understated. The regime and declarations are per employee per year (Payroll › Salary & bank › Tax). No declaration means the new regime. A structure can instead use a **fixed monthly TDS** from the CA (the earlier behaviour). HR can **override** a month's TDS with a mandatory reason. The override is shown against the calculated figure on screen, in the Excel report and in the audit log. The full working (slabs, rebate, cess, already deducted, months) is shown per person.

Known simplifications: basic exemption is the under-60 one (senior citizens need their own rule or an override), HRA exemption is the amount declared rather than computed from rent, and perquisites are not modelled.

## Salary revisions and history

A salary structure applies from a month on. A raise is a new structure from a later month. Saving over a month that was already **approved** is refused, so the record of what was paid stays as it was. Every month's lines store their own full payslip (`payroll_items.slip`), so later revisions never change history. To correct an approved month, use **History › Adjustments**. An arrear or recovery is paid in the next payroll and shows as *Arrears for 2026-10: …*.

## Excel report (backend/src/payroll/excel.js)

`Payroll-YYYY-MM-vN.xlsx`, generated from the database and stored with the run. Earlier versions stay downloadable, marked old.

1. **Employee Payroll Summary**: one row per person paid. ID, name, department, designation, account holder, account number (**masked: XXXX1234**), IFSC, bank, Basic, HRA, Allowances, Other earnings, Gross (formula), PF, PT, TDS, LOP, Other deductions, Total deductions (formula), Net (formula). The grand total row uses `SUM` formulas. Amounts are in INR with Indian digit grouping.
2. **Salary Calculation Details**: every earning and deduction per person, subtotals as formulas, employer contributions, the TDS working and each calculation step.
3. **Payroll Summary**: month, FY, status, version, who generated it. Each total is a formula over sheet 1 beside the database figure, with a *Matches/Check* column.

Account numbers are masked because the report is emailed for review. Only the bank file has full numbers.

## Bank transfer file (backend/src/payroll/bank.js)

Only after approval, and only HR. A CSV with Payment reference (`SAL202611<EmpID>`), beneficiary name, full account number, IFSC, bank, amount, mode (NEFT/IFT), salary month, narration, employee ID and debit account. It refuses to generate if anyone paid lacks a bank account, or if its total differs from the approved net. It's stored encrypted.

**It does not move money.** Upload it in your corporate banking portal, where the bank's own maker/checker applies. Then mark the payroll processed with the bank's batch reference. No bank API is called. If your bank's bulk-upload template needs different columns, change `BANK_COLUMNS` in `bank.js`.

## Security

- `/api/payroll/*` needs HR or a reviewer (`requirePayrollAccess`). Changes are HR only (`hrOnly`), and review decisions are reviewer only (`workflow.js`). Responses are `Cache-Control: private, no-store`.
- Full bank account numbers are written once (HR enters them twice) and stored AES-256-GCM encrypted with `PAYROLL_ENCRYPTION_KEY`. APIs only ever return the last four digits. Bank files are stored encrypted, with a SHA-256 integrity check on every download.
- `payroll_audit` is append-only (a trigger refuses UPDATE/DELETE). It records salary and bank changes (before/after), tax rules and declarations, run start, input edits, TDS overrides, recalculations, status changes with reasons, generated files with hashes, and every report and bank-file download.
- Payroll can live on its own database (`PAYROLL_DATABASE_URL`). In that case notifications and emails about payroll are skipped.

## Database (backend/src/payroll/schema.sql, applied to the payroll database at start-up)

| Table | Holds |
|---|---|
| `salary_structures` (extended) | earnings lines, PF/PT/TDS applicability, PF employee/employer, PT and February PT, TDS mode, annual CTC, revision reason. One row per person per starting month |
| `payroll_bank_accounts` | holder, bank, IFSC, encrypted account number, last 4 |
| `tax_rules` | per FY and regime: slabs, standard deduction, rebate, surcharge, cess, caps, source |
| `tax_declarations` | per FY and person: regime and declared amounts |
| `payroll_runs` (extended) | one per month (`period` UNIQUE): status, who submitted and reviewed and when, review note, bank reference, totals |
| `payroll_items` (extended) | one per person per run (UNIQUE): HR's `inputs`, the full calculated `slip`, structure used |
| `payroll_adjustments` | arrears/recoveries for finalized months and the run that paid them |
| `payroll_files` | versioned Excel reports and bank files (bank encrypted), hash, totals, who generated them |
| `payroll_audit` | the audit trail (append-only) |

## API (`/api/payroll`)

| Method & path | Who | Does |
|---|---|---|
| `GET /overview?period=YYYY-MM` | HR, reviewer | Dashboard figures, run status and next actions (a preview for HR when not started) |
| `GET /runs` | HR, reviewer | History with totals, files and approval details |
| `POST /runs {period}` | HR | Start a month (409 if it exists, 400 for a future month) |
| `GET /runs/:id` | HR, reviewer* | Run, every line with its breakdown, totals, files, activity, next actions |
| `PUT /runs/:id/lines/:lineId` | HR | Monthly inputs: `incentives, bonus, overtime, otherEarnings(+Reason), reimbursements, adjustment(+Reason), additionalDeductions(+Reason), lopDays, tdsOverride(+Reason), hold(+holdReason), note` |
| `POST /runs/:id/recalculate` | HR | Re-read everything and recalculate (before review) |
| `POST /runs/:id/actions/:action` | per workflow | `calculate, generate, submit, approve, reject, request_changes, bank_file, mark_paid` (`{note}`, `{bankReference}`) |
| `GET /runs/:id/files/:fileId` | HR; reviewer for reports | Download (audited) |
| `GET /employees` | HR | Who is on the payroll and whether salary, bank and tax details are set |
| `GET/PUT /structures/:email`, `POST /structures/import` | HR | Salary structures and CSV import |
| `GET/PUT /bank/:email` | HR | Bank account (number write-only) |
| `GET/PUT /declarations/:email?fy=` | HR | Regime and declarations |
| `GET /tax-rules`, `PUT /tax-rules/:fy/:regime` | HR | Tax rules (with a source) |
| `GET/POST /adjustments`, `DELETE /adjustments/:id` | HR | Corrections to finalized months |
| `GET /audit?runId=&email=` | HR | Audit trail |

\* A reviewer sees a run only once it has been sent for review.

## How HR runs a month

1. **Payroll › Salary & bank**: for anyone new, set **Salary** (structure from their first month), **Bank** (enter the account number twice) and, if they gave declarations, **Tax**. The callout lists who is missing what.
2. **Payroll › Monthly payroll**: pick the month and press **Start payroll**. Unpaid leave and approved reimbursements are already in.
3. Click a row to see the full calculation and edit that person's inputs. Put anyone not to be paid this month **on hold** with a reason. Use filters (department, designation, status) and sorting to check.
4. **Mark as calculated**, then **Generate Excel report**, then **Download Excel** and send it to Chirag. Then **Send for review**.
5. If Chirag rejects or requests changes, his reason shows at the top. Correct the lines, then calculate, generate and send again.
6. Once approved, press **Generate bank file**, then **Download bank file**, and upload it in corporate banking for authorized release.
7. When the bank confirms, press **Mark as processed** and enter the bank's batch or UTR reference.
8. Missed something after approval? **History › Adjustments** adds it to the next month.

From the 1st of each month the server also starts last month's payroll as a draft automatically (if HR hasn't) and tells HR. Nothing is published to employees before approval.

## Configuration

`PAYROLL_REVIEWERS`, `PAYROLL_ENCRYPTION_KEY` (required for bank details: `openssl rand -hex 32`, keep it backed up), `PAYROLL_DEBIT_ACCOUNT`, `PAYROLL_DEBIT_BANK_CODE`, `PAYROLL_DATABASE_URL`/`PAYROLL_DB_SCHEMA`. See `backend/.env.example`.
