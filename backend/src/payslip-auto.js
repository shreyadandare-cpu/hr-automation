import express from "express";
import { payPool as pool, PAYROLL_SEPARATE } from "./db.js";   // payroll may use its own database (PAYROLL_DATABASE_URL)
import { notify as notifyAll } from "./notify.js";
const notify = (to, n) => (PAYROLL_SEPARATE ? Promise.resolve(console.log(`Payroll on its own database, notice not sent to ${to}: ${n.title}`)) : notifyAll(to, n));
import { emailLink, linkMinutes } from "./email-links.js";
import { istMonth, previousMonth } from "./payroll-calc.js";
import { recalcRun, totalsOfLines, monthName } from "./payroll/store.js";
import { audit } from "./payroll/routes.js";

/*
 * Last month's payroll, started automatically. Checked every hour with the other background jobs.
 *
 *   From the 1st (India time)  if HR hasn't started last month's payroll, it is started as a draft and calculated, and HR is
 *                              told (with the names of anyone whose information is incomplete).
 *   While it is a draft        each check recalculates it, keeping HR's inputs, so approved leave and claims show up.
 *   After that                 nothing automatic: HR generates the report and sends it for review; payslips are published to
 *                              employees when the reviewer approves (payroll/routes.js). Nothing unapproved is ever published.
 *
 * PAYSLIP_AUTO_FROM=YYYY-MM (optional): the first month started automatically; earlier months are left alone.
 */
const names = (list) => list.slice(0, 15).map((l) => l.name).join(", ") + (list.length > 15 ? ` and ${list.length - 15} more` : "");

/** Tells each person their payslip can be downloaded (after approval). */
export const tellReady = (people, period) => PAYROLL_SEPARATE
  ? Promise.resolve(console.log(`Payroll on its own database: payslip-ready notices for ${period} not sent`))
  : Promise.all(people.map(async (email) => notify(email, {
    title: `Your payslip for ${monthName(period)} is ready.`, body: "View or download it in My payslips.", link: "/app/payslips",
    email: { subject: `Payslip for ${monthName(period)}`, body: `Your payslip for ${monthName(period)} is ready.\n\nView or download it here: ${await emailLink("/app/payslips")} (works for ${linkMinutes()} minutes). After that, sign in to the HR Access Hub and open My payslips.` } })));

/** One check. `now` can be set for tests. Returns what it did. */
export async function runPayslips(now = new Date()) {
  const period = previousMonth(istMonth(now));
  const from = process.env.PAYSLIP_AUTO_FROM;
  if (from && period < from) return { period, skipped: `before PAYSLIP_AUTO_FROM (${from})` };
  const client = await pool.connect();
  let out, hr = null;
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE payroll_runs IN SHARE ROW EXCLUSIVE MODE");   // one start at a time, manual or automatic
    let { rows: [run] } = await client.query("SELECT * FROM payroll_runs WHERE period=$1", [period]);
    if (run && !(run.workflow && run.status === "draft")) { await client.query("COMMIT"); return { period, skipped: `already ${run.status}` }; }
    const created = !run;
    if (created)
      ({ rows: [run] } = await client.query("INSERT INTO payroll_runs (period, status, processed_by, processed_at, workflow, status_at) VALUES ($1,'draft','automatic',$2,true,$2) RETURNING *", [period, now]));
    const lines = await recalcRun(client, run, "automatic");
    const t = totalsOfLines(lines), missing = lines.filter((l) => l.status === "incomplete");
    if (created) {
      await audit(client, "automatic", "Payroll started automatically", { run_id: run.id, period, detail: { totals: t } });
      hr = { title: `Payroll for ${monthName(period)} is calculated as a draft: ${t.people} ${t.people === 1 ? "person" : "people"} ready.`,
        body: "Check the inputs, generate the report and send it for review in Payroll."
          + (missing.length ? ` Payroll information is incomplete for: ${names(missing)}.` : "") };
    }
    out = { period, created, runId: run.id, ready: t.people, incomplete: missing.length };
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  if (hr) await notify("hr", { ...hr, link: "/app/payroll", email: { subject: hr.title, body: hr.body } });
  return out;
}

// HR: publish the payslips of a run processed before the review workflow. Workflow runs are published on approval.
export const payslipAutoRouter = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
payslipAutoRouter.post("/runs/:id/publish", wrap(async (req, res) => {
  const { rows: [run] } = await pool.query("SELECT * FROM payroll_runs WHERE id=$1", [Number(req.params.id) || 0]);
  if (!run) return res.status(404).json({ error: "Payroll run not found." });
  if (run.workflow) return res.status(409).json({ error: "Payslips for this month are published when the payroll is approved." });
  const { rowCount } = await pool.query("UPDATE payroll_runs SET published_at=now() WHERE id=$1 AND published_at IS NULL", [run.id]);
  if (!rowCount) return res.status(409).json({ error: "These payslips are already published." });
  const { rows } = await pool.query("SELECT work_email FROM payroll_items WHERE run_id=$1 AND slip IS NOT NULL AND jsonb_array_length(slip->'incomplete') = 0", [run.id]);
  await audit(pool, req.user.email, "Payslips published", { run_id: run.id, period: run.period, detail: { people: rows.length } });
  await tellReady(rows.map((r) => r.work_email), run.period);
  res.json({ ok: true, published: rows.length });
}));
