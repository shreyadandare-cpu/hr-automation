import fs from "node:fs";
import express from "express";
import { payPool as pool, pool as mainPool, PAYROLL_SEPARATE } from "../db.js";
import { notify as notifyAll } from "../notify.js";
import { event } from "../reimbursements.js";
import { V } from "../validate.js";
import { cleanInputs, INPUT_FIELDS } from "./engine.js";
import { fyOf, fyMonths as fyMonthsOf, rulesProblems, annualTax, payrollFieldsFrom } from "./tax.js";
import { fromEmployee } from "./declared.js";
import { STATUS, EDITABLE, FINAL, check, nextActions } from "./workflow.js";
import { actorOf, approvers, bankOnly, hrOnly, seal, open, sha256, encryptionReady } from "./access.js";
import { buildLines, recalcRun, loadRun, totalsOfLines, staffFor, joiningLater, payrollProfile, toStructure, structuresFor, seedTaxRules, deptOf, monthName } from "./store.js";
import { buildWorkbook } from "./excel.js";
import { buildBankFile, buildBankWorkbook } from "./bank.js";
import { readPayslipPdf } from "./payslip-read.js";
import { previewFromFile, templateCsv, templateXlsx } from "./tax-import.js";
import { DEFAULT_TAX_RULES } from "./tax-defaults.js";
import { PRODUCT } from "../brand.js";
import { onPayrollChange } from "./preview-cache.js";

/*
 * Payroll processing, review and disbursement. Mounted at /api/payroll behind requirePayrollAccess (payroll.prepare, payroll.approve,
 * payroll.bank or payroll.view; see access.js). Routes that change anything need payroll.prepare ("HR" below), except the review
 * decisions (payroll.approve, workflow.js) and bank accounts and the bank file (payroll.bank). A payroll.view holder for a team sees
 * only their team's lines and totals, and no reports.
 *
 *   GET  /overview?period=           dashboard figures for a month (the run's, or a preview when there is none: HR only)
 *   GET  /runs                       payroll history
 *   POST /runs {period}              start a month: one run per month, refused if it exists
 *   GET  /runs/:id                   the run, its lines (with every calculation), files, history and the next possible actions
 *   PUT  /runs/:id/lines/:lineId     HR's monthly inputs for one person; the run is recalculated
 *   POST /runs/:id/recalculate       re-read salaries, leave, claims and tax and recalculate every line
 *   POST /runs/:id/actions/:action   calculate | generate | submit | approve | reject | request_changes | bank_file | mark_paid
 *   GET  /runs/:id/files/:fileId     download a stored Excel report (everyone who sees every line) or bank file (payroll.bank)
 *   GET  /joiners?period=            people being onboarded and people joining from that month on: in this payroll or not, what their profile needs (HR)
 *   GET  /profile/:email             one person's payroll profile at a glance (HR)
 *   GET  /employees                  who is on the payroll, and who joins later (onboarded, so set up ahead), and whether their salary, bank and tax details are set (HR)
 *   GET/PUT /bank/:email             salary bank account (the number is write-only; only the last four digits come back) (payroll.bank)
 *   GET/PUT /declarations/:email     tax regime and declarations for a financial year (HR)
 *   GET/PUT /tax-rules[/:fy/:regime] slabs, rebate, surcharge, cess by financial year (HR)
 *   GET/POST/DELETE /adjustments     arrears and recoveries for finalized months (HR)
 *   GET  /audit                      the payroll audit trail (HR)
 */
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const FY = /^\d{4}-\d{2}$/;
const lc = (s) => String(s || "").toLowerCase();
const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const notify = (to, n) => (PAYROLL_SEPARATE ? Promise.resolve(console.log(`Payroll on its own database, notice not sent to ${to}: ${n.title}`)) : notifyAll(to, n));
const fyMonthsStart = (p) => `${fyOf(p).slice(0, 4)}-04`;
const istMonth = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);

/** Adds a row to the append-only payroll audit trail. */
export const audit = (db, actor, action, { run_id = null, period = null, work_email = null, detail = {} } = {}) =>
  db.query("INSERT INTO payroll_audit (actor, action, run_id, period, work_email, detail) VALUES ($1,$2,$3,$4,$5,$6)",
    [actor, action, run_id, period, work_email, JSON.stringify(detail)]);

/** Creates the payroll tables (on the payroll database) and the starting tax rules. */
export async function initPayroll(db) {
  await db.query(`SET statement_timeout = 0;\n${fs.readFileSync(new URL("schema.sql", import.meta.url), "utf8")}\nRESET statement_timeout;`);   // no limit at start-up
  await seedTaxRules(db);
}

/** Runs fn(client) in a transaction. fn returns { rollback: true, ... } to undo. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query(out && out.rollback ? "ROLLBACK" : "COMMIT");
    return out || {};
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
const fail = (status, error, extra = {}) => ({ rollback: true, status, error, ...extra });
const send = (res, out, ok) => (out.error ? res.status(out.status || 400).json({ error: out.error, ...(out.errors ? { errors: out.errors } : {}), ...(out.problems ? { problems: out.problems } : {}) }) : ok());

const runView = (r) => ({
  id: r.id, period: r.period, fy: fyOf(r.period), status: r.status, statusLabel: STATUS[r.status] || r.status, workflow: r.workflow,
  processedAt: r.processed_at, processedBy: r.processed_by, statusAt: r.status_at,
  submittedBy: r.submitted_by, submittedAt: r.submitted_at, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, reviewNote: r.review_note,
  paidAt: r.paid_at, paidBy: r.paid_by, bankReference: r.bank_reference, publishedAt: r.published_at, totals: r.totals,
});
const fileView = (f) => ({ id: f.id, kind: f.kind, version: f.version, filename: f.filename, size: f.size, sha256: f.sha256, totals: f.totals,
  generatedBy: f.generated_by, generatedAt: f.generated_at, superseded: f.superseded });

/** Approvers, bank-file holders and viewers see a run once it has been sent for review (never runs from before the review workflow). HR sees every run. */
const visible = (run, actor) => actor.hr || (run.workflow && !["draft", "calculated", "generated"].includes(run.status));
/** Whether this person's line is shown: everyone's, unless the viewer holds payroll.view for a team only. */
const inScope = (actor, email) => !actor.scope || actor.scope.has(lc(email));
/** Which stored files are listed: the bank file for payroll.bank holders, the Excel report for everyone who sees every line. */
const isBankFile = (kind) => kind === "bank" || kind === "bank_xlsx";
const fileShown = (actor, f) => !actor.scope && (isBankFile(f.kind) ? actor.bank : true);
/** Totals of the lines shown (the same sums loadRun makes). */
const totalsShown = (lines) => totalsOfLines(lines.map((l) => ({ ...l, slip: { summary: l.summary } })));

/** Audit entries that make someone a preparer of a run: they can't approve that run (maker-checker). */
const MAKER_ACTIONS = ["Payroll started", "Payroll inputs changed", "TDS overridden", "TDS override removed", "Payroll recalculated",
  "Payroll calculated", "Payroll report generated", "Payroll back to draft", "Adjustment cancelled"];
async function madeBy(db, runId, email) {
  const { rowCount } = await db.query("SELECT 1 FROM payroll_audit WHERE run_id=$1 AND lower(actor)=$2 AND action = ANY($3) LIMIT 1", [runId, lc(email), MAKER_ACTIONS]);
  return rowCount > 0;
}
/** actorOf(), plus whether they prepared this run (only worked out for approvers, who are the only ones it can stop). */
async function actorFor(req, db, run) {
  const actor = await actorOf(req);
  actor.maker = !!(run && actor.reviewer && run.workflow && await madeBy(db, run.id, actor.email));
  return actor;
}

/** Moves a run to a new status (recorded in the audit trail). */
async function moveTo(client, run, to, actor, action, detail = {}, extra = {}) {
  const sets = ["status=$2", "status_at=now()"], args = [run.id, to];
  for (const [k, v] of Object.entries(extra)) { args.push(v); sets.push(`${k}=$${args.length}`); }
  await client.query(`UPDATE payroll_runs SET ${sets.join(", ")} WHERE id=$1`, args);
  await audit(client, actor, action, { run_id: run.id, period: run.period, detail: { from: run.status, to, ...detail } });
}

/** An edit after the report was made: the run goes back to draft and earlier reports no longer count. */
async function backToDraft(client, run, actor, why) {
  await client.query("UPDATE payroll_files SET superseded=true WHERE run_id=$1 AND kind='workbook' AND NOT superseded", [run.id]);
  if (run.status !== "draft") await moveTo(client, run, "draft", actor, "Payroll back to draft", { why });
}

export const payrollWorkflowRouter = express.Router();
const R = payrollWorkflowRouter;

/* ---------- dashboard and history ---------- */

/* The preview totals of a month with no payroll run yet: the whole company's payroll worked out from scratch, so it is kept for a
   minute instead of being recalculated on every visit. It is only a preview; starting the run calculates everything afresh. */
const previews = new Map(), refreshing = new Map();
// A salary saved or someone onboarded shows in the totals at once: the kept preview is dropped and the next visit works it out afresh.
onPayrollChange(() => { previewGen++; previews.clear(); refreshing.clear(); });
let previewGen = 0;   // bumped when figures change, so a calculation already under way cannot store the old answer
const refreshPreview = (period) => {
  const gen = previewGen;
  if (!refreshing.has(period)) refreshing.set(period, buildLines(pool, period).then((lines) => {
    const totals = totalsOfLines(lines); if (gen === previewGen) previews.set(period, { at: Date.now(), totals }); return totals;
  }).finally(() => refreshing.delete(period)));
  return refreshing.get(period);
};
/** The month's preview totals: fresh for a minute; after that the last answer is shown at once while a new one is worked out. */
/** Prepares this month's preview in the background at start-up, so the first visit to Payroll is quick too. */
export const warmPayrollPreview = () => { previewTotals(istMonth()).catch(() => {}); };
export async function previewTotals(period) {
  const hit = previews.get(period);
  if (hit && Date.now() - hit.at < 60_000) return hit.totals;
  if (hit) { refreshPreview(period).catch(() => {}); return hit.totals; }
  return refreshPreview(period);
}

R.get("/overview", wrap(async (req, res) => {
  const period = PERIOD.test(String(req.query.period || "")) ? String(req.query.period) : istMonth();
  const { rows: [run] } = await pool.query("SELECT * FROM payroll_runs WHERE period=$1", [period]);
  const actor = await actorFor(req, pool, run);
  const { rows: [{ n: all }] } = await pool.query("SELECT count(*)::int AS n FROM employees WHERE status <> 'offboarded'");
  const headcount = actor.scope ? actor.scope.size : all;
  let totals = null, source = "none";
  if (run && visible(run, actor)) {
    totals = actor.scope ? totalsShown((await loadRun(pool, run.id)).lines.filter((l) => inScope(actor, l.email)))
      : run.totals || (await loadRun(pool, run.id)).totals;
    source = "run";
  } else if (!run && actor.hr) {
    totals = await previewTotals(period);
    source = "preview";
  }
  res.json({
    period, fy: fyOf(period), monthName: monthName(period), headcount, source, totals,
    run: run && visible(run, actor) ? { ...runView(actor.scope ? { ...run, totals: null } : run), actions: nextActions(run, actor) } : null,
    you: { hr: actor.hr, reviewer: actor.reviewer, bank: actor.bank, team: !!actor.scope }, reviewers: actor.hr ? await approvers() : undefined, encryptionReady: encryptionReady(),
  });
}));

R.get("/runs", wrap(async (req, res) => {
  const actor = await actorOf(req), team = actor.scope ? [...actor.scope] : null;
  // A team viewer's people and net are their team's only (the run's stored totals are the whole company's).
  const { rows } = await pool.query(
    `SELECT r.*, count(i.id)::int AS people, coalesce(sum(i.payable),0) AS payable FROM payroll_runs r
     LEFT JOIN payroll_items i ON i.run_id=r.id ${team ? "AND lower(i.work_email) = ANY($1)" : ""}
     GROUP BY r.id ORDER BY r.period DESC`, team ? [team] : []);
  const { rows: files } = await pool.query("SELECT id, run_id, kind, version, filename, size, sha256, totals, generated_by, generated_at, superseded FROM payroll_files ORDER BY version DESC");
  res.json(rows.filter((r) => visible(r, actor)).map((r) => ({
    ...(team ? { ...runView(r), totals: null } : runView(r)),
    people: r.totals && !team ? r.totals.people : r.people, netTotal: r.totals && !team ? r.totals.net : Number(r.payable),
    files: files.filter((f) => f.run_id === r.id && fileShown(actor, f)).map(fileView),
  })));
}));

R.get("/runs/:id", wrap(async (req, res) => {
  const data = await loadRun(pool, Number(req.params.id) || 0);
  const actor = await actorFor(req, pool, data && data.run);
  if (!data || !visible(data.run, actor)) return res.status(404).json({ error: "Payroll run not found." });
  if (actor.scope) {   // payroll.view for a team: only their lines, totals and history
    data.lines = data.lines.filter((l) => inScope(actor, l.email));
    data.totals = totalsShown(data.lines);
    data.run = { ...data.run, totals: null };
  }
  const [{ rows: files }, { rows: events }] = await Promise.all([
    pool.query("SELECT id, kind, version, filename, size, sha256, totals, generated_by, generated_at, superseded FROM payroll_files WHERE run_id=$1 ORDER BY generated_at DESC", [data.run.id]),
    pool.query("SELECT id, ts, actor, action, work_email, detail FROM payroll_audit WHERE run_id=$1 ORDER BY id DESC LIMIT 300", [data.run.id]),
  ]);
  res.json({
    run: { ...runView(data.run), actions: nextActions(data.run, actor), editable: actor.hr && data.run.workflow && EDITABLE.has(data.run.status) },
    lines: data.lines, totals: data.totals,
    files: files.filter((f) => fileShown(actor, f)).map(fileView),
    events: events.filter((e) => !actor.scope || (e.work_email && inScope(actor, e.work_email))).map((e) => ({ id: e.id, ts: e.ts, actor: e.actor, action: e.action, email: e.work_email, detail: e.detail })),
    inputFields: INPUT_FIELDS,
  });
}));

/* ---------- starting and editing a month ---------- */

R.post("/runs", hrOnly, wrap(async (req, res) => {
  const period = String((req.body && req.body.period) || "");
  if (!PERIOD.test(period)) return res.status(400).json({ error: "Pick a month." });
  if (period > istMonth()) return res.status(400).json({ error: "Payroll can't be started for a future month." });
  const out = await tx(async (client) => {
    await client.query("LOCK TABLE payroll_runs IN SHARE ROW EXCLUSIVE MODE");   // one start at a time; period is UNIQUE as well
    const { rows: [have] } = await client.query("SELECT id, status FROM payroll_runs WHERE period=$1", [period]);
    if (have) return fail(409, `Payroll for ${monthName(period)} already exists (${STATUS[have.status] || have.status}). Open it instead of starting another.`, { id: have.id });
    const { rows: [run] } = await client.query(
      "INSERT INTO payroll_runs (period, status, processed_by, workflow, status_at) VALUES ($1,'draft',$2,true,now()) RETURNING *", [period, req.user.email]);
    const lines = await recalcRun(client, run, req.user.email);
    await audit(client, req.user.email, "Payroll started", { run_id: run.id, period, detail: { lines: lines.length, totals: totalsOfLines(lines) } });
    return { id: run.id };
  });
  send(res, out, () => res.status(201).json({ id: out.id }));
}));

/** Loads a run for a change, locked. */
async function lockRun(client, id) {
  const { rows: [run] } = await client.query("SELECT * FROM payroll_runs WHERE id=$1 FOR UPDATE", [Number(id) || 0]);
  return run;
}

R.put("/runs/:id/lines/:lineId", hrOnly, wrap(async (req, res) => {
  const out = await tx(async (client) => {
    const run = await lockRun(client, req.params.id);
    if (!run) return fail(404, "Payroll run not found.");
    if (!run.workflow || !EDITABLE.has(run.status)) return fail(409, `Payroll for ${monthName(run.period)} is ${STATUS[run.status].toLowerCase()} and can't be edited. Corrections go through an adjustment in a later month.`);
    const { rows: [line] } = await client.query("SELECT * FROM payroll_items WHERE id=$1 AND run_id=$2", [Number(req.params.lineId) || 0, run.id]);
    if (!line) return fail(404, "This person isn't in this payroll.");
    const body = req.body || {};
    const { errors, value } = cleanInputs(body, line.slip && line.slip.days ? line.slip.days.actual || 31 : 31);
    if (errors) return fail(400, "Please check the highlighted fields.", { errors });
    if (body.hold === true) {
      const why = String(body.holdReason || "").trim().slice(0, 200);
      if (why.length < 5) return fail(400, "Please check the highlighted fields.", { errors: { holdReason: "Say why this salary is on hold." } });
      Object.assign(value, { hold: true, holdReason: why });
    }
    const before = line.inputs || {};
    await client.query("UPDATE payroll_items SET inputs=$2, updated_by=$3 WHERE id=$1", [line.id, JSON.stringify(value), req.user.email]);
    await backToDraft(client, run, req.user.email, `Inputs changed for ${line.work_email}`);
    await recalcRun(client, { ...run, status: "draft" }, req.user.email);
    const { rows: [after] } = await client.query("SELECT slip FROM payroll_items WHERE id=$1", [line.id]);
    await audit(client, req.user.email, "Payroll inputs changed", { run_id: run.id, period: run.period, work_email: line.work_email,
      detail: { before, after: value, netBefore: line.slip && line.slip.summary ? line.slip.summary.net : null, netAfter: after.slip.summary.net } });
    const was = before.tdsOverride, now = value.tdsOverride;
    if (was !== now)
      await audit(client, req.user.email, now === undefined ? "TDS override removed" : "TDS overridden", { run_id: run.id, period: run.period, work_email: line.work_email,
        detail: { calculated: after.slip.tds.calculated, override: now ?? null, reason: value.tdsOverrideReason || null, previous: was ?? null } });
    return {};
  });
  send(res, out, () => res.json({ ok: true }));
}));

// Choose who is processed this month: put several people on hold at once, take them off hold, or process only the people selected (everyone else is held).
// A hold needs a reason. Only while the run can still be edited; the run goes back to draft and is recalculated, like any other change to its inputs.
R.post("/runs/:id/hold", hrOnly, wrap(async (req, res) => {
  const body = req.body || {}, action = body.action, picked = new Set((Array.isArray(body.emails) ? body.emails : []).map(lc).slice(0, 1000));
  if (!["hold", "release", "only"].includes(action)) return res.status(400).json({ error: "Choose hold, release or only." });
  if (!picked.size) return res.status(400).json({ error: "Select at least one person." });
  const why = String(body.reason || "").trim().slice(0, 200);
  if (action !== "release" && why.length < 5) return res.status(400).json({ error: "Please say why.", errors: { reason: "Say why (at least 5 letters)." } });
  const out = await tx(async (client) => {
    const run = await lockRun(client, req.params.id);
    if (!run) return fail(404, "Payroll run not found.");
    if (!run.workflow || !EDITABLE.has(run.status)) return fail(409, `Payroll for ${monthName(run.period)} is ${STATUS[run.status].toLowerCase()} and can't be edited.`);
    const { rows: items } = await client.query("SELECT id, work_email, inputs FROM payroll_items WHERE run_id=$1 FOR UPDATE", [run.id]);
    const changes = [];
    for (const it of items) {
      const inputs = { ...(it.inputs || {}) }, isHeld = !!inputs.hold, sel = picked.has(lc(it.work_email));
      const hold = action === "hold" ? sel : action === "only" ? !sel : false, release = action === "release" || action === "only" ? sel : false;
      if (hold && !isHeld) { inputs.hold = true; inputs.holdReason = why; changes.push([it, inputs, "Salary put on hold"]); }
      else if (release && isHeld) { delete inputs.hold; delete inputs.holdReason; changes.push([it, inputs, "Salary hold released"]); }
    }
    if (!changes.length) return fail(409, "Nothing to change: those people are already as you asked.");
    for (const [it, inputs] of changes) await client.query("UPDATE payroll_items SET inputs=$2, updated_by=$3 WHERE id=$1", [it.id, JSON.stringify(inputs), req.user.email]);
    await backToDraft(client, run, req.user.email, `Who is processed was changed for ${changes.length} ${changes.length === 1 ? "person" : "people"}`);
    await recalcRun(client, { ...run, status: "draft" }, req.user.email);
    for (const [it, , what] of changes) await audit(client, req.user.email, what, { run_id: run.id, period: run.period, work_email: it.work_email, detail: { reason: what === "Salary put on hold" ? why : null, bulk: true } });
    return { held: changes.filter((c) => c[2] === "Salary put on hold").length, released: changes.filter((c) => c[2] === "Salary hold released").length };
  });
  send(res, out, () => res.json({ ok: true, held: out.held, released: out.released }));
}));

R.post("/runs/:id/recalculate", hrOnly, wrap(async (req, res) => {
  const out = await tx(async (client) => {
    const run = await lockRun(client, req.params.id);
    if (!run) return fail(404, "Payroll run not found.");
    if (!run.workflow || !EDITABLE.has(run.status)) return fail(409, "Only a payroll that isn't sent for review or approved can be recalculated.");
    const before = run.totals;
    await backToDraft(client, run, req.user.email, "Recalculated");
    const lines = await recalcRun(client, { ...run, status: "draft" }, req.user.email);
    await audit(client, req.user.email, "Payroll recalculated", { run_id: run.id, period: run.period, detail: { before, after: totalsOfLines(lines) } });
    return {};
  });
  send(res, out, () => res.json({ ok: true }));
}));

/* ---------- workflow ---------- */

R.post("/runs/:id/actions/:action", wrap(async (req, res) => {
  const action = req.params.action, note = String((req.body && req.body.note) || "").trim().slice(0, 1000);
  const after = { tell: [] };
  const out = await tx(async (client) => {
    const run = await lockRun(client, req.params.id);
    const actor = await actorFor(req, client, run);
    if (!run || !visible(run, actor)) return fail(404, "Payroll run not found.");
    const c = check(run, action, actor, note);
    if (!c.ok) return fail(409, c.error);
    const month = monthName(run.period);

    if (action === "calculate") {
      // TDS counts what earlier months of the year deducted, so they must be final first.
      const { rows: open } = await client.query("SELECT period FROM payroll_runs WHERE workflow AND period < $1 AND period >= $2 AND status NOT IN ('approved','bank_ready','paid') ORDER BY period",
        [run.period, fyMonthsStart(run.period)]);
      if (open.length) return fail(409, `Get ${open.map((r) => monthName(r.period)).join(", ")} approved first: this month's TDS depends on it.`);
      const lines = await recalcRun(client, run, req.user.email);
      const bad = lines.filter((l) => l.status === "incomplete");
      if (bad.length) return fail(422, `${bad.length} ${bad.length === 1 ? "person has" : "people have"} incomplete payroll information. Complete it or put them on hold first.`,
        { problems: bad.map((l) => ({ email: l.email, name: l.name, error: l.slip.incomplete.join(" ") })) });
      if (!lines.some((l) => l.status === "ready")) return fail(422, "Nobody would be paid in this payroll.");
      await client.query("UPDATE payroll_files SET superseded=true WHERE run_id=$1 AND kind='workbook' AND NOT superseded", [run.id]);
      await moveTo(client, run, c.to, req.user.email, "Payroll calculated", { totals: totalsOfLines(lines) });
      return {};
    }

    if (action === "generate") {
      const data = await loadRun(client, run.id);
      const { rows: [{ v }] } = await client.query("SELECT coalesce(max(version),0)+1 AS v FROM payroll_files WHERE run_id=$1 AND kind='workbook'", [run.id]);
      const generatedAt = new Date();
      const { buffer, totals } = await buildWorkbook({ ...data, run: { ...run, status: c.to } }, { version: v, generatedBy: req.user.email, generatedAt });
      const filename = `Payroll-${run.period}-v${v}.xlsx`;
      await client.query("UPDATE payroll_files SET superseded=true WHERE run_id=$1 AND kind='workbook'", [run.id]);
      const { rows: [f] } = await client.query(
        `INSERT INTO payroll_files (run_id, kind, version, filename, mime, size, sha256, content, totals, generated_by, generated_at)
         VALUES ($1,'workbook',$2,$3,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',$4,$5,$6,$7,$8,$9) RETURNING id`,
        [run.id, v, filename, buffer.length, sha256(buffer), buffer, JSON.stringify(totals), req.user.email, generatedAt]);
      await moveTo(client, run, c.to, req.user.email, "Payroll report generated", { file: f.id, version: v, sha256: sha256(buffer), totals });
      return { file: f.id };
    }

    if (action === "submit") {
      const { rows: [f] } = await client.query("SELECT id, version FROM payroll_files WHERE run_id=$1 AND kind='workbook' AND NOT superseded ORDER BY version DESC LIMIT 1", [run.id]);
      if (!f) return fail(409, "Generate the payroll report first.");
      await moveTo(client, run, c.to, req.user.email, "Payroll sent for review", { file: f.id, version: f.version, note }, { submitted_by: req.user.email, submitted_at: new Date(), review_note: null });
      after.tell.push([await approvers(), { title: `Payroll for ${month} is waiting for your review.`, body: `${inr(run.totals && run.totals.net)} net for ${run.totals ? run.totals.people : "?"} people. Sent by ${req.user.email}.`, link: "/app/payroll" }]);
      return {};
    }

    if (action === "approve" || action === "reject" || action === "request_changes") {
      const verb = { approve: "approved", reject: "rejected", request_changes: "sent back for changes" }[action];
      await moveTo(client, run, c.to, req.user.email, `Payroll ${verb}`, { note }, { reviewed_by: req.user.email, reviewed_at: new Date(), review_note: note || null });
      if (action === "approve") {
        // Payslips become visible to employees; the reimbursements in this run are now part of it for certain.
        await client.query("UPDATE payroll_runs SET published_at=coalesce(published_at, now()) WHERE id=$1", [run.id]);
        const { rows: claims } = await client.query("SELECT * FROM reimbursements WHERE payroll_run_id=$1 AND status='in_payroll'", [run.id]);
        for (const cl of claims) await event(client, cl, { actor: req.user.email, kind: `Included in ${month} payroll`, status: "in_payroll", note: `payroll run #${run.id}` });
        const { rows: ready } = await client.query(
          "SELECT work_email FROM payroll_items WHERE run_id=$1 AND jsonb_array_length(slip->'incomplete') = 0 AND NOT coalesce((inputs->>'hold')::boolean, false)", [run.id]);
        after.claims = claims; after.period = run.period; after.ready = ready.map((r) => r.work_email);
        // Advance and loan instalments in the approved lines, recorded as recovered once the month is final (after the commit).
        const { rows: inst } = await client.query(
          `SELECT i.work_email, d->>'advanceId' AS advance_id, (d->>'amount')::numeric AS amount FROM payroll_items i, jsonb_array_elements(coalesce(i.slip->'deductions','[]'::jsonb)) d
            WHERE i.run_id=$1 AND d->>'code' = 'advance' AND jsonb_array_length(coalesce(i.slip->'incomplete','[]'::jsonb)) = 0 AND NOT coalesce((i.inputs->>'hold')::boolean, false)`, [run.id]);
        after.instalments = inst; after.reviewer = req.user.email;
      }
      after.tell.push(["hr", { title: `Payroll for ${month} was ${verb} by ${req.user.email}.`, body: note || "", link: "/app/payroll" }]);
      return {};
    }

    if (action === "bank_file") {
      const data = await loadRun(client, run.id);
      const paid = data.lines.filter((l) => l.status === "ready");
      const { rows: banks } = await client.query("SELECT * FROM payroll_bank_accounts WHERE lower(work_email) = ANY($1)", [paid.map((l) => lc(l.email))]);
      const bankOf = new Map(banks.map((b) => [lc(b.work_email), b]));
      const missing = paid.filter((l) => !bankOf.has(lc(l.email)));
      if (missing.length) return fail(422, `Add the salary bank account for ${missing.map((l) => l.name).join(", ")} first.`);
      const nonPositive = paid.filter((l) => !(l.summary.net > 0));
      if (nonPositive.length) return fail(422, `Net pay is zero for ${nonPositive.map((l) => l.name).join(", ")}. Put them on hold before approval next time; they are left out of the bank file.`);
      const rows = paid.map((l) => { const b = bankOf.get(lc(l.email)); return { empNo: l.empNo, email: l.email, holder: b.holder_name, account: open(b.acct_enc).toString("utf8"), ifsc: b.ifsc, bankName: b.bank_name, net: l.summary.net }; });
      const bf = buildBankFile(run.period, month, rows);
      const dbTotal = Math.round(data.totals.net * 100), fileTotal = Math.round(bf.total * 100);
      if (dbTotal !== fileTotal) return fail(500, `The bank file total ${inr(bf.total)} does not match the approved net ${inr(data.totals.net)}. Nothing was generated.`);
      const plain = Buffer.from(bf.csv, "utf8");
      const { rows: [{ v }] } = await client.query("SELECT coalesce(max(version),0)+1 AS v FROM payroll_files WHERE run_id=$1 AND kind='bank'", [run.id]);
      const totals = { people: bf.count, net: bf.total };
      await client.query("UPDATE payroll_files SET superseded=true WHERE run_id=$1 AND kind IN ('bank','bank_xlsx')", [run.id]);
      const { rows: [f] } = await client.query(
        `INSERT INTO payroll_files (run_id, kind, version, filename, mime, size, sha256, encrypted, content, totals, generated_by)
         VALUES ($1,'bank',$2,$3,'text/csv',$4,$5,true,$6,$7,$8) RETURNING id`,
        [run.id, v, `Salary-transfer-${run.period}-v${v}.csv`, plain.length, sha256(plain), Buffer.from(seal(plain), "utf8"), JSON.stringify(totals), req.user.email]);
      // The same payments as an Excel sheet, stored beside the CSV (encrypted too: it holds full account numbers) with the same version.
      const xlsx = await buildBankWorkbook(run.period, month, bf.payments, bf.total, data.totals.net, { version: v, generatedBy: req.user.email, generatedAt: new Date() });
      await client.query(
        `INSERT INTO payroll_files (run_id, kind, version, filename, mime, size, sha256, encrypted, content, totals, generated_by)
         VALUES ($1,'bank_xlsx',$2,$3,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',$4,$5,true,$6,$7,$8)`,
        [run.id, v, `Salary-transfer-${run.period}-v${v}.xlsx`, xlsx.length, sha256(xlsx), Buffer.from(seal(xlsx), "utf8"), JSON.stringify(totals), req.user.email]);
      await moveTo(client, run, c.to, req.user.email, "Bank transfer file generated", { file: f.id, version: v, sha256: sha256(plain), totals, excel: true });
      return { file: f.id };
    }

    if (action === "mark_paid") {
      const ref = String((req.body && req.body.bankReference) || "").trim().slice(0, 100);
      if (ref.length < 3) return fail(400, "Enter the bank's batch or transaction reference for this salary transfer.", { errors: { bankReference: "Required." } });
      await moveTo(client, run, c.to, req.user.email, "Payroll processed (bank transfer confirmed)", { bankReference: ref, note }, { paid_at: new Date(), paid_by: req.user.email, bank_reference: ref });
      const { rows } = await client.query(
        "UPDATE reimbursements SET status='paid', paid_at=now(), paid_amount=coalesce(approved_amount, amount), updated_at=now() WHERE payroll_run_id=$1 AND status='in_payroll' RETURNING *", [run.id]);
      for (const cl of rows) await event(client, cl, { actor: req.user.email, kind: "Paid", status: "paid", note: `${inr(cl.paid_amount)} with ${month} payroll (run #${run.id})` });
      after.paid = rows; after.period = run.period;
      return {};
    }
    return fail(400, "Unknown action.");
  });
  if (out.error) return send(res, out);
  for (const [to, n] of after.tell) await notify(to, { ...n, email: { subject: n.title, body: `${n.title}\n\n${n.body}\n\nOpen Payroll in ${PRODUCT} to see it.` } });
  if (after.instalments && after.instalments.length) {
    const [y, m] = after.period.split("-").map(Number), lastDay = `${after.period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    for (const x of after.instalments) {
      await mainPool.query(`INSERT INTO advance_recoveries (advance_id, amount, recovered_on, note, recorded_by, payroll_period) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (advance_id, payroll_period) WHERE payroll_period IS NOT NULL DO NOTHING`, [Number(x.advance_id), x.amount, lastDay, `Deducted in payroll for ${monthName(after.period)}`, after.reviewer, after.period])
        .catch((err) => console.error("Advance instalment not recorded:", err.message));
    }
  }
  if (after.claims) { const { tellIncluded } = await import("../payroll.js"); await tellIncluded(after.claims, after.period); }
  if (after.ready) { const { tellReady } = await import("../payslip-auto.js"); await tellReady(after.ready, after.period); }
  if (after.paid) { const { tellPaid } = await import("../payroll.js"); await tellPaid(after.paid, after.period); }
  res.json({ ok: true, ...(out.file ? { file: out.file } : {}) });
}));

R.get("/runs/:id/files/:fileId", wrap(async (req, res) => {
  const actor = await actorOf(req);
  const { rows: [f] } = await pool.query(
    "SELECT f.*, r.period, r.status, r.workflow FROM payroll_files f JOIN payroll_runs r ON r.id=f.run_id WHERE f.id=$1 AND f.run_id=$2", [Number(req.params.fileId) || 0, Number(req.params.id) || 0]);
  if (!f || !visible(f, actor)) return res.status(404).json({ error: "File not found." });
  if (!fileShown(actor, f)) return res.status(403).json({ error: "You do not have access to this." });
  if (isBankFile(f.kind) && !FINAL.has(f.status)) return res.status(409).json({ error: "The payroll isn't approved." });
  const body = f.encrypted ? open(f.content.toString("utf8")) : f.content;
  if (sha256(body) !== f.sha256) return res.status(500).json({ error: "This stored file failed its integrity check. Generate it again." });
  await audit(pool, req.user.email, isBankFile(f.kind) ? "Bank transfer file downloaded" : "Payroll report downloaded", { run_id: f.run_id, period: f.period, detail: { file: f.id, version: f.version, superseded: f.superseded } });
  res.setHeader("Content-Type", f.mime);
  res.setHeader("Content-Disposition", `attachment; filename="${f.filename}"`);
  res.send(body);
}));

/* ---------- employees: salary, bank and tax set-up ---------- */

// Reads an uploaded payslip PDF and suggests a salary structure from it. The file is read in memory and never stored; nothing is saved.
R.post("/payslip-read", hrOnly, express.raw({ type: () => true, limit: 5 * 1024 * 1024 }), wrap(async (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: "Choose a payslip PDF." });
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return res.status(400).json({ error: "That isn't a PDF. Upload the payslip as a PDF file." });
  const out = readPayslipPdf(buf);
  await audit(pool, req.user.email, "Payslip read to fill a salary structure", { work_email: lc(req.query.email) || null, detail: { ok: out.ok, period: out.period || null, matches: out.matches ?? null } });
  if (!out.ok) return res.status(422).json({ error: out.error });
  res.json(out);
}));

R.get("/employees", hrOnly, wrap(async (req, res) => {
  const period = PERIOD.test(String(req.query.period || "")) ? String(req.query.period) : istMonth();
  const fy = fyOf(period);
  const [onPayroll, later, structures, { rows: banks }, { rows: decls }, { rows: own }] = await Promise.all([
    staffFor(pool, period), joiningLater(pool, period), structuresFor(pool, period),
    pool.query("SELECT work_email, holder_name, bank_name, ifsc, acct_last4, updated_by, updated_at FROM payroll_bank_accounts"),
    pool.query("SELECT work_email, regime, updated_at FROM tax_declarations WHERE fy=$1", [fy]),
    mainPool.query("SELECT lower(email) AS email, regime FROM tax_declaration_requests WHERE financial_year=$1 AND status='submitted'", [Number(fy.slice(0, 4))]),
  ]);
  const ownOf = new Map(own.map((x) => [x.email, x]));   // employees' own submitted declarations: used when payroll has entered none
  // Someone who joins later has no salary structure in force this month; the one HR set from their joining month is theirs.
  const { rows: ahead } = later.length ? await pool.query(
    "SELECT DISTINCT ON (lower(work_email)) * FROM salary_structures WHERE lower(work_email) = ANY($1) ORDER BY lower(work_email), effective_from", [later.map((e) => lc(e.work_email))]) : { rows: [] };
  const sOf = new Map([...ahead, ...structures].map((s) => [lc(s.work_email), s])), bOf = new Map(banks.map((b) => [lc(b.work_email), b])), dOf = new Map(decls.map((d) => [lc(d.work_email), d]));
  const emps = [...onPayroll, ...later], laterSet = new Set(later.map((e) => lc(e.work_email)));
  res.json({ period, fy, employees: emps.map((e) => {
    const s = sOf.get(lc(e.work_email)), b = bOf.get(lc(e.work_email)), d = dOf.get(lc(e.work_email));
    const gross = s ? s.earnings.reduce((n, x) => n + Number(x.amount || 0), 0) : null;
    return { email: e.work_email, name: e.name, empNo: e.emp_no, dept: deptOf(e.dept, e.title), title: e.title, start: e.start_date, lastDay: e.last_day, status: e.status, employmentType: e.employment_type || "Employee", onboarding: e.status === "onboarding" && !e.onboarded_at, joinsLater: laterSet.has(lc(e.work_email)),
      salary: s ? { effectiveFrom: s.effective_from, monthlyGross: gross, annualCtc: s.annual_ctc === null ? null : Number(s.annual_ctc), tdsMode: s.tds_mode || (s.tds_monthly !== null ? "manual" : "auto") } : null,
      bank: b ? { holder: b.holder_name, bankName: b.bank_name, ifsc: b.ifsc, last4: b.acct_last4, updatedAt: b.updated_at } : null,
      onboardingIfsc: e.ifsc || null, regime: d ? d.regime : ownOf.has(lc(e.work_email)) ? ownOf.get(lc(e.work_email)).regime : "new", declared: !!d,
      declaredBy: d ? "payroll" : ownOf.has(lc(e.work_email)) ? "employee" : null,
      // A payroll profile is complete with a salary structure, a salary bank account and a PAN. Until then the person shows as incomplete, and no salary is invented for them.
      missing: [!s && "Salary structure", !b && "Bank account", !e.pan_masked && "PAN"].filter(Boolean) };
  }) });
}));

// New joiners for the Monthly payroll page: people whose onboarding is still going, and people who joined in the shown month or join later. For each: whether they are
// in that month's payroll (and in its run, once one has been started), and what their payroll profile still needs. They appear as soon as their work email is created.
R.get("/joiners", hrOnly, wrap(async (req, res) => {
  const period = PERIOD.test(String(req.query.period || "")) ? String(req.query.period) : istMonth();
  const [y, m] = period.split("-").map(Number), monthEnd = `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const { rows } = await pool.query(
    `SELECT work_email, name, emp_no, title, dept, start_date, status, onboarded_at, pan_masked, employment_type FROM employees
      WHERE status <> 'offboarded' AND last_day IS NULL AND ((status='onboarding' AND onboarded_at IS NULL) OR start_date >= $1::date)
      ORDER BY start_date NULLS LAST, name LIMIT 200`, [`${period}-01`]);
  const emails = rows.map((e) => lc(e.work_email));
  const [{ rows: sal }, { rows: bank }, { rows: inRun }, { rows: [run] }] = await Promise.all([
    pool.query("SELECT DISTINCT lower(work_email) AS e FROM salary_structures WHERE lower(work_email) = ANY($1)", [emails]),
    pool.query("SELECT lower(work_email) AS e FROM payroll_bank_accounts WHERE lower(work_email) = ANY($1)", [emails]),
    pool.query("SELECT DISTINCT lower(i.work_email) AS e FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id WHERE r.period=$1 AND lower(i.work_email) = ANY($2)", [period, emails]),
    pool.query("SELECT 1 AS one FROM payroll_runs WHERE period=$1", [period]),
  ]);
  const has = (list) => new Set(list.map((x) => x.e));
  const hasSal = has(sal), hasBank = has(bank), isInRun = has(inRun);
  res.json({ period, runStarted: !!run, joiners: rows.map((e) => {
    const k = lc(e.work_email);
    return { email: e.work_email, name: e.name, empNo: e.emp_no, title: e.title, dept: deptOf(e.dept, e.title), employmentType: e.employment_type || "Employee", start: e.start_date,
      onboarding: e.status === "onboarding" && !e.onboarded_at, inThisPayroll: !!e.start_date && e.start_date <= monthEnd, inRun: isInRun.has(k),
      missing: payrollProfile({ hasSalary: hasSal.has(k), hasBank: hasBank.has(k), pan: e.pan_masked }).missing };
  }) });
}));

// One person's payroll profile at a glance: whether it is ready, what is missing, and when they join the payroll. No bank number, no tax figures.
R.get("/profile/:email", hrOnly, wrap(async (req, res) => {
  const email = lc(req.params.email), month = istMonth();
  const { rows: [e] } = await pool.query(
    "SELECT name, emp_no, title, dept, start_date, last_day, status, pan_masked, employment_type, onboarded_at FROM employees WHERE lower(work_email)=$1", [email]);
  if (!e) return res.status(404).json({ error: "Employee not found." });
  const [{ rows: all }, { rows: [b] }] = await Promise.all([
    pool.query("SELECT * FROM salary_structures WHERE lower(work_email)=$1 ORDER BY effective_from", [email]),
    pool.query("SELECT bank_name, acct_last4, updated_at FROM payroll_bank_accounts WHERE lower(work_email)=$1", [email]),
  ]);
  const inForce = [...all].reverse().find((x) => x.effective_from <= month) || all[0] || null, st = inForce ? toStructure(inForce) : null;
  const joinMonth = e.start_date ? String(e.start_date).slice(0, 7) : null;
  res.json({
    name: e.name, empNo: e.emp_no, title: e.title, dept: deptOf(e.dept, e.title), employmentType: e.employment_type || "Employee", start: e.start_date, lastDay: e.last_day, status: e.status,
    onboarding: e.status === "onboarding" && !e.onboarded_at, paidFrom: joinMonth, joinsLater: !!joinMonth && joinMonth > month, leaving: !!e.last_day,
    profile: payrollProfile({ hasSalary: !!st, hasBank: !!b, pan: e.pan_masked }),
    salary: st ? { effectiveFrom: st.effectiveFrom, monthlyGross: st.earnings.reduce((n, x) => n + Number(x.amount || 0), 0), annualCtc: st.annualCtc, revisions: all.length } : null,
    bank: b ? { bankName: b.bank_name, last4: b.acct_last4, updatedAt: b.updated_at } : null,
    pan: e.pan_masked || null,
  });
}));

// "Bank details" holders who do not prepare payroll: everyone's bank-account status, without any salary figures.
R.get("/bank-people", bankOnly, wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT e.work_email, e.name, e.emp_no, e.title, b.holder_name, b.bank_name, b.ifsc, b.acct_last4, b.updated_at
       FROM employees e LEFT JOIN payroll_bank_accounts b ON lower(b.work_email)=lower(e.work_email)
      WHERE e.status NOT IN ('offboarded') ORDER BY e.name LIMIT 1000`);
  res.json({ employees: rows.map((r) => ({ email: r.work_email, name: r.name, no: r.emp_no || "", title: r.title || "",
    bank: r.acct_last4 ? { holder: r.holder_name, bankName: r.bank_name, ifsc: r.ifsc, last4: r.acct_last4, updatedAt: r.updated_at } : null })) });
}));

R.get("/bank/:email", bankOnly, wrap(async (req, res) => {
  const email = lc(req.params.email);
  const { rows: [emp] } = await pool.query("SELECT name, ifsc, acct_masked FROM employees WHERE lower(work_email)=$1", [email]);
  if (!emp) return res.status(404).json({ error: "Employee not found." });
  const { rows: [b] } = await pool.query("SELECT holder_name, bank_name, ifsc, acct_last4, updated_by, updated_at FROM payroll_bank_accounts WHERE lower(work_email)=$1", [email]);
  res.json({ name: emp.name, onboarding: { ifsc: emp.ifsc, acctMasked: emp.acct_masked }, encryptionReady: encryptionReady(),
    bank: b ? { holder: b.holder_name, bankName: b.bank_name, ifsc: b.ifsc, last4: b.acct_last4, updatedBy: b.updated_by, updatedAt: b.updated_at } : null });
}));

R.put("/bank/:email", bankOnly, wrap(async (req, res) => {
  const email = lc(req.params.email), body = req.body || {};
  const errors = {};
  const holder = String(body.holder || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const bankName = String(body.bankName || "").trim().slice(0, 80);
  const ifsc = String(body.ifsc || "").trim().toUpperCase();
  const account = String(body.account || "").replace(/[\s-]/g, "");
  if (!/^[A-Za-z .'&-]{2,80}$/.test(holder)) errors.holder = "Enter the name as on the bank account (letters only).";
  if (bankName.length < 2) errors.bankName = "Enter the bank's name.";
  if (!V.ifsc(ifsc)) errors.ifsc = "IFSC must look like HDFC0001234.";
  if (!/^\d{9,18}$/.test(account)) errors.account = "Bank account number must be 9 to 18 digits.";
  if (account && String(body.accountConfirm || "").replace(/[\s-]/g, "") !== account) errors.accountConfirm = "The two account numbers don't match.";
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please check the highlighted fields.", errors });
  const sealed = seal(account);   // throws 503 without PAYROLL_ENCRYPTION_KEY
  const out = await tx(async (client) => {
    const { rows: [emp] } = await client.query("SELECT id FROM employees WHERE lower(work_email)=$1", [email]);
    if (!emp) return fail(404, "Employee not found.");
    const { rows: [busy] } = await client.query(
      `SELECT r.period FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id WHERE lower(i.work_email)=$1 AND r.workflow AND r.status IN ('approved','bank_ready') LIMIT 1`, [email]);
    if (busy) return fail(409, `${monthName(busy.period)} is approved and its salary transfer isn't marked processed yet. Change the bank account after that, so the approved payment goes where the reviewer saw it.`);
    const { rows: [old] } = await client.query("SELECT holder_name, bank_name, ifsc, acct_last4 FROM payroll_bank_accounts WHERE lower(work_email)=$1", [email]);
    await client.query(
      `INSERT INTO payroll_bank_accounts (work_email, holder_name, bank_name, ifsc, acct_enc, acct_last4, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (work_email) DO UPDATE SET holder_name=EXCLUDED.holder_name, bank_name=EXCLUDED.bank_name, ifsc=EXCLUDED.ifsc, acct_enc=EXCLUDED.acct_enc,
         acct_last4=EXCLUDED.acct_last4, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [email, holder, bankName, ifsc, sealed, account.slice(-4), req.user.email]);
    await audit(client, req.user.email, old ? "Salary bank account changed" : "Salary bank account added", { work_email: email,
      detail: { before: old ? { holder: old.holder_name, bankName: old.bank_name, ifsc: old.ifsc, last4: old.acct_last4 } : null, after: { holder, bankName, ifsc, last4: account.slice(-4) } } });
    return {};
  });
  send(res, out, () => res.json({ ok: true }));
}));

// opening*: taxable salary, TDS and PT this employer paid earlier in the year, before payroll ran in this app.
const DECL_FIELDS = ["openingTaxable", "openingTds", "openingPt", "hraExemption", "ltaExemption", "section80C", "section80D", "homeLoanInterest", "nps80CCD1B", "employerNps", "otherDeductions", "otherIncome", "previousEmployerIncome", "previousEmployerTds",
  "rentWithoutHra", "savingsInterest", "educationLoan80E", "homeLoan80EEA", "donations80G", "disability80DD", "medical80DDB", "disability80U", "housePropertyIncome"];

R.get("/declarations/:email", hrOnly, wrap(async (req, res) => {
  const email = lc(req.params.email), fy = FY.test(String(req.query.fy || "")) ? String(req.query.fy) : fyOf(istMonth());
  // Payroll's own record, and what the employee submitted on Pay > Tax declaration (main database, read only), side by side.
  const [{ rows: [d] }, { rows: [own] }] = await Promise.all([
    pool.query("SELECT regime, declaration, updated_by, updated_at FROM tax_declarations WHERE fy=$1 AND lower(work_email)=$2", [fy, email]),
    mainPool.query("SELECT regime, items, proofs, submitted_at FROM tax_declaration_requests WHERE lower(email)=$1 AND financial_year=$2 AND status='submitted'", [email, Number(fy.slice(0, 4))]),
  ]);
  // The employee's submission as payroll's fields, with HR's proof decisions and the HRA exemption worked out from the salary.
  let submitted = null;
  if (own) {
    const [[s], { rows: [e] }] = await Promise.all([structuresFor(pool, fyMonthsOf(fy).at(-1), email), pool.query("SELECT start_date, last_day FROM employees WHERE lower(work_email)=$1", [email])]);
    const got = fromEmployee({ request: own, structure: s ? toStructure(s) : null, fy, start: e && e.start_date, lastDay: e && e.last_day });
    const { rentDeclared, metro } = payrollFieldsFrom(own.items, own.regime);
    submitted = { regime: got.regime, submittedAt: own.submitted_at, fields: got.declaration, rentDeclared, metro, hra: got.hra, lta: got.lta };
  }
  res.json({ fy, regime: d ? d.regime : "new", declaration: d ? d.declaration : {}, updatedBy: d && d.updated_by, updatedAt: d && d.updated_at, fields: DECL_FIELDS, submitted });
}));

R.put("/declarations/:email", hrOnly, wrap(async (req, res) => {
  const email = lc(req.params.email), body = req.body || {};
  const fy = String(body.fy || "");
  const errors = {}, declaration = {};
  if (!FY.test(fy)) errors.fy = "Pick a financial year like 2026-27.";
  if (!["new", "old"].includes(body.regime)) errors.regime = "Choose the new or old regime.";
  for (const k of DECL_FIELDS) {
    const raw = body.declaration && body.declaration[k];
    if (raw === "" || raw === null || raw === undefined) continue;
    const n = Number(raw);
    // Only a let-out house can be a loss (a negative amount).
    if (k === "housePropertyIncome" ? !Number.isFinite(n) || n <= -1e9 || n >= 1e9 : !Number.isFinite(n) || n < 0 || n >= 1e9) errors[k] = k === "housePropertyIncome" ? "Enter the amount in rupees; a loss is a negative amount." : "Enter an amount in rupees, 0 or more.";
    else if (n) declaration[k] = Math.round(n);
  }
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please check the highlighted fields.", errors });
  const out = await tx(async (client) => {
    const { rows: [emp] } = await client.query("SELECT id FROM employees WHERE lower(work_email)=$1", [email]);
    if (!emp) return fail(404, "Employee not found.");
    const { rows: [old] } = await client.query("SELECT regime, declaration FROM tax_declarations WHERE fy=$1 AND lower(work_email)=$2", [fy, email]);
    await client.query(
      `INSERT INTO tax_declarations (fy, work_email, regime, declaration, updated_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (fy, lower(work_email)) DO UPDATE SET regime=EXCLUDED.regime, declaration=EXCLUDED.declaration, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [fy, email, body.regime, JSON.stringify(declaration), req.user.email]);
    await audit(client, req.user.email, "Tax declaration saved", { work_email: email, detail: { fy, before: old || null, after: { regime: body.regime, declaration } } });
    return {};
  });
  send(res, out, () => res.json({ ok: true }));
}));

/* ---------- tax rules ---------- */

R.get("/tax-rules", hrOnly, wrap(async (_req, res) => {
  const { rows } = await pool.query("SELECT fy, regime, rules, source, updated_by, updated_at FROM tax_rules ORDER BY fy DESC, regime");
  res.json(rows.map((r) => ({ fy: r.fy, regime: r.regime, rules: r.rules, source: r.source, updatedBy: r.updated_by, updatedAt: r.updated_at })));
}));

R.put("/tax-rules/:fy/:regime", hrOnly, wrap(async (req, res) => {
  const { fy, regime } = req.params;
  if (!FY.test(fy) || !["new", "old"].includes(regime)) return res.status(400).json({ error: "Pick a financial year and regime." });
  const rules = req.body && req.body.rules;
  const problems = rulesProblems(rules);
  if (problems.length) return res.status(400).json({ error: problems.join(" ") });
  const source = String((req.body && req.body.source) || "").trim().slice(0, 200);
  if (source.length < 3) return res.status(400).json({ error: "Say where these rules come from (e.g. Finance Act 2026, CA's note)." });
  const clean = { ...rules, slabs: rules.slabs.map((s) => ({ upTo: s.upTo == null ? null : Number(s.upTo), rate: Number(s.rate) })) };
  const check = annualTax(clean, 1500000);   // the rules must work out a tax
  if (!Number.isFinite(check.total)) return res.status(400).json({ error: "These rules don't produce a tax amount." });
  await tx(async (client) => {
    const { rows: [old] } = await client.query("SELECT rules, source FROM tax_rules WHERE fy=$1 AND regime=$2", [fy, regime]);
    await client.query(`INSERT INTO tax_rules (fy, regime, rules, source, updated_by) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (fy, regime) DO UPDATE SET rules=EXCLUDED.rules, source=EXCLUDED.source, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [fy, regime, JSON.stringify(clean), source, req.user.email]);
    await audit(client, req.user.email, "Tax rules saved", { detail: { fy, regime, before: old || null, after: { rules: clean, source } } });
  });
  res.json({ ok: true });
}));

/* The tax rules as a sheet for the CA to fill in (Excel, or ?format=csv), and reading one back. Reading saves nothing: the page shows
   what would change and HR confirms, which saves each rule set through PUT /tax-rules/:fy/:regime above. */
R.get("/tax-rules/template", hrOnly, wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT fy, regime, rules FROM tax_rules ORDER BY fy DESC, regime");
  const sets = rows.length ? rows : DEFAULT_TAX_RULES;
  if (req.query.format === "csv") {
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="tax-rules-template.csv"' });
    return res.send(templateCsv(sets));
  }
  res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="tax-rules-template.xlsx"' });
  res.send(await templateXlsx(sets));
}));

R.post("/tax-rules/import", hrOnly, express.raw({ type: () => true, limit: 2 * 1024 * 1024 }), wrap(async (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: "Choose the Excel or CSV file with the tax rules." });
  const { rows } = await pool.query("SELECT fy, regime, rules FROM tax_rules");
  let out;
  try { out = await previewFromFile(buf, rows); } catch (err) { return res.status(422).json({ error: err.message }); }
  await audit(pool, req.user.email, "Tax rules file read (nothing saved yet)", { detail: { sets: out.sets.map((x) => `${x.fy} ${x.regime}`), errors: out.errors.length } });
  res.json(out);
}));

/* ---------- adjustments to finalized months ---------- */

R.get("/adjustments", hrOnly, wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*, e.name, r.period AS applied_period FROM payroll_adjustments a LEFT JOIN employees e ON lower(e.work_email)=lower(a.work_email)
     LEFT JOIN payroll_runs r ON r.id=a.applied_run_id ORDER BY a.id DESC LIMIT 500`);
  res.json(rows.map((a) => ({ id: a.id, email: a.work_email, name: a.name || a.work_email, sourcePeriod: a.source_period, kind: a.kind, amount: Number(a.amount), reason: a.reason,
    createdBy: a.created_by, createdAt: a.created_at, appliedPeriod: a.applied_period, cancelledAt: a.cancelled_at })));
}));

R.post("/adjustments", hrOnly, wrap(async (req, res) => {
  const b = req.body || {}, errors = {};
  const email = lc(b.email), sourcePeriod = String(b.sourcePeriod || ""), amount = Number(b.amount), reason = String(b.reason || "").trim().slice(0, 300);
  if (!PERIOD.test(sourcePeriod)) errors.sourcePeriod = "Pick the month being corrected.";
  if (!["earning", "deduction"].includes(b.kind)) errors.kind = "Choose arrears (paid to the employee) or a recovery.";
  if (!(Number.isFinite(amount) && amount > 0 && amount < 1e8) || !/^\d+(\.\d{1,2})?$/.test(String(b.amount))) errors.amount = "Enter an amount in rupees.";
  if (reason.length < 5) errors.reason = "Say what is being corrected.";
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please check the highlighted fields.", errors });
  const out = await tx(async (client) => {
    const { rows: [run] } = await client.query("SELECT status, workflow FROM payroll_runs WHERE period=$1", [sourcePeriod]);
    if (!run || !(FINAL.has(run.status) || run.status === "processed")) return fail(409, `${monthName(sourcePeriod)} isn't finalised. Change its inputs directly instead.`);
    const { rows: [line] } = await client.query("SELECT 1 FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id WHERE r.period=$1 AND lower(i.work_email)=$2", [sourcePeriod, email]);
    if (!line) return fail(404, `This person wasn't in the ${monthName(sourcePeriod)} payroll.`);
    const { rows: [a] } = await client.query("INSERT INTO payroll_adjustments (work_email, source_period, kind, amount, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [email, sourcePeriod, b.kind, amount, reason, req.user.email]);
    await audit(client, req.user.email, "Adjustment added", { work_email: email, period: sourcePeriod, detail: { id: a.id, kind: b.kind, amount, reason } });
    return { id: a.id };
  });
  send(res, out, () => res.status(201).json({ id: out.id }));
}));

R.delete("/adjustments/:id", hrOnly, wrap(async (req, res) => {
  const out = await tx(async (client) => {
    const { rows: [a] } = await client.query(
      `SELECT a.*, r.status FROM payroll_adjustments a LEFT JOIN payroll_runs r ON r.id=a.applied_run_id WHERE a.id=$1 FOR UPDATE OF a`, [Number(req.params.id) || 0]);
    if (!a || a.cancelled_at) return fail(404, "Adjustment not found.");
    if (a.applied_run_id && !EDITABLE.has(a.status)) return fail(409, "This adjustment is in a payroll that is sent for review or approved.");
    const run = a.applied_run_id ? await lockRun(client, a.applied_run_id) : null;
    await client.query("UPDATE payroll_adjustments SET cancelled_at=now(), cancelled_by=$2, applied_run_id=NULL WHERE id=$1", [a.id, req.user.email]);
    await audit(client, req.user.email, "Adjustment cancelled", { work_email: a.work_email, period: a.source_period, run_id: run ? run.id : null, detail: { id: a.id } });
    if (run) {   // the open payroll it was in no longer includes it, and its report no longer counts
      await backToDraft(client, run, req.user.email, `Adjustment #${a.id} cancelled`);
      await recalcRun(client, { ...run, status: "draft" }, req.user.email);
    }
    return { runId: run ? run.id : null };
  });
  send(res, out, () => res.json({ ok: true, recalculate: !!out.runId }));
}));

/* ---------- audit trail ---------- */

R.get("/audit", hrOnly, wrap(async (req, res) => {
  const args = [], where = [];
  if (req.query.runId) { args.push(Number(req.query.runId) || 0); where.push(`run_id=$${args.length}`); }
  if (req.query.email) { args.push(lc(req.query.email)); where.push(`lower(work_email)=$${args.length}`); }
  const { rows } = await pool.query(`SELECT * FROM payroll_audit ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT 500`, args);
  res.json(rows.map((e) => ({ id: e.id, ts: e.ts, actor: e.actor, action: e.action, runId: e.run_id, period: e.period, email: e.work_email, detail: e.detail })));
}));
