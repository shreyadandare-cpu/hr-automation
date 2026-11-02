import express from "express";
import { pool } from "./db.js";
import { notify } from "./notify.js";
import { emailLink, linkMinutes } from "./email-links.js";
import { lines, saveLine, tellIncluded } from "./payroll.js";
import { istMonth, previousMonth } from "./payroll-calc.js";

/*
 * Payslips made automatically. Checked every hour with the other background jobs.
 *
 *   From the 1st (India time)  last month's payslips are made as a draft for everyone whose payroll information is complete.
 *                              HR is told, with the names of anyone left out because something is missing.
 *   Review window              PAYSLIP_REVIEW_DAYS (2 by default). Each check rebuilds the draft from the current data, so a
 *                              salary HR corrects shows up. Employees can't see a draft. HR can publish early from Payroll.
 *   publish_at reached         the payslips are published and each employee is told they can download theirs.
 *   Afterwards                 anyone whose information is completed later gets a payslip on the next check, published at once,
 *                              until the month is marked paid. A published payslip never changes.
 *
 * Nobody with incomplete information gets a payslip line, so no amount is ever filled in for them.
 * PAYSLIP_AUTO_FROM=YYYY-MM (optional): the first month made automatically; earlier months are left alone.
 */
const reviewDays = () => { const n = Number(process.env.PAYSLIP_REVIEW_DAYS ?? 2); return Number.isFinite(n) && n >= 0 ? n : 2; };
const monthName = (p) => new Date(p + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const dateText = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", timeZone: "Asia/Kolkata" });
const names = (list) => list.slice(0, 15).map((l) => l.name).join(", ") + (list.length > 15 ? ` and ${list.length - 15} more` : "");
const ready = (l) => l.hasStructure && !l.incomplete.length;
const issued = (item) => item && item.slip && item.slip.earnings && item.slip.earnings.length && !item.slip.incomplete.length;

const tellReady = (people, period) => Promise.all(people.map(async (email) => notify(email, {
  title: `Your payslip for ${monthName(period)} is ready.`, body: "View or download it in My payslips.", link: "/app/payslips",
  email: { subject: `Payslip for ${monthName(period)}`, body: `Your payslip for ${monthName(period)} is ready.\n\nView or download it here: ${await emailLink("/app/payslips")} (works for ${linkMinutes()} minutes). After that, sign in to the HR Access Hub and open My payslips.` } })));

/** Publishes a draft run: employees can now see their payslips. Returns the people told, or null if it was not a draft. */
async function publish(client, run, actor) {
  const { rowCount } = await client.query("UPDATE payroll_runs SET published_at=now() WHERE id=$1 AND published_at IS NULL", [run.id]);
  if (!rowCount) return null;
  const { rows } = await client.query("SELECT work_email, slip FROM payroll_items WHERE run_id=$1", [run.id]);
  const people = rows.filter(issued).map((r) => r.work_email);
  await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1, NULL)", [`Payslips for ${monthName(run.period)} published by ${actor}: ${people.length} people`]);
  return people;
}

/** One check. `now` can be set for tests. Returns what it did. */
export async function runPayslips(now = new Date()) {
  const period = previousMonth(istMonth(now));
  const from = process.env.PAYSLIP_AUTO_FROM;
  if (from && period < from) return { period, skipped: `before PAYSLIP_AUTO_FROM (${from})` };
  const client = await pool.connect();
  const after = { included: [], tell: [], hr: null };
  let out;
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE payroll_runs IN SHARE ROW EXCLUSIVE MODE");   // one processing at a time, manual or automatic
    let { rows: [run] } = await client.query("SELECT * FROM payroll_runs WHERE period=$1", [period]);
    if (run && run.status === "paid") { await client.query("COMMIT"); return { period, skipped: "already paid" }; }
    const ls = await lines(client, period, run ? run.id : null);
    const good = ls.filter(ready), missing = ls.filter((l) => l.onRoll && !ready(l));

    if (!run) {
      if (!good.length) {
        // Nothing to make yet. Tell HR once a month what is missing.
        const note = `Payslips for ${monthName(period)} could not be made automatically`;
        const { rowCount } = await client.query("SELECT 1 FROM audit_log WHERE action LIKE $1 || '%'", [note]);
        if (!rowCount && missing.length) {
          await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1, NULL)", [`${note}: payroll information is incomplete for ${missing.length} people`]);
          after.hr = { title: `Payslips for ${monthName(period)} could not be made: payroll information is missing for ${missing.length} ${missing.length === 1 ? "person" : "people"}.`,
            body: `Set their salary breakdown (and monthly TDS above ₹12,00,000 a year) in Payroll: ${names(missing)}.` };
        }
        out = { period, created: false, made: 0, missing: missing.length };
      } else {
        const publishAt = new Date(now.getTime() + reviewDays() * 864e5);
        ({ rows: [run] } = await client.query(
          "INSERT INTO payroll_runs (period, status, processed_by, processed_at, publish_at) VALUES ($1,'processed','automatic',$2,$3) RETURNING *", [period, now, publishAt]));
        for (const l of good) after.included.push(...await saveLine(client, run, l, "automatic"));
        await client.query("INSERT INTO audit_log (action, work_email) VALUES ($1, NULL)",
          [`Payslips for ${monthName(period)} made automatically as a draft: ${good.length} people, ${missing.length} left out with incomplete information`]);
        after.hr = { title: `Payslips for ${monthName(period)} are ready for your review: ${good.length} ${good.length === 1 ? "person" : "people"}.`,
          body: `Employees will see them on ${dateText(publishAt)}. Check them in Payroll, or publish now.`
            + (missing.length ? ` Left out because their payroll information is incomplete: ${names(missing)}.` : "") };
        out = { period, created: true, made: good.length, missing: missing.length, runId: run.id };
      }
    } else {
      const { rows: items } = await client.query("SELECT id, work_email, slip FROM payroll_items WHERE run_id=$1", [run.id]);
      const have = new Map(items.map((i) => [i.work_email.toLowerCase(), i]));
      const draft = !run.published_at;
      let made = 0;
      for (const l of good) {
        const cur = have.get(l.email.toLowerCase());
        if (!draft && issued(cur)) continue;   // published: never changed
        after.included.push(...await saveLine(client, run, l, "automatic"));
        made++;
        if (!draft) after.tell.push(l.email);
      }
      if (draft && run.processed_by === "automatic") {
        // A draft only holds complete payslips: drop anyone whose information became incomplete, and free their claims.
        const keep = new Set(good.map((l) => l.email.toLowerCase()));
        for (const i of items) if (!keep.has(i.work_email.toLowerCase())) {
          await client.query("UPDATE reimbursements SET status='payroll_pending', payroll_run_id=NULL, updated_at=now() WHERE payroll_run_id=$1 AND lower(work_email)=lower($2) AND status='in_payroll'", [run.id, i.work_email]);
          await client.query("DELETE FROM payroll_items WHERE id=$1", [i.id]);
        }
      }
      if (draft && run.publish_at && new Date(run.publish_at) <= now) {
        const people = await publish(client, run, "automatic");
        if (people) after.tell.push(...people);
      }
      out = { period, created: false, made, runId: run.id, published: !!(run.published_at || (run.publish_at && new Date(run.publish_at) <= now)) };
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  await tellIncluded(after.included, period);
  if (after.hr) await notify("hr", { ...after.hr, link: "/app/payroll", email: { subject: after.hr.title, body: after.hr.body } });
  await tellReady([...new Set(after.tell)], period);
  return { ...out, told: [...new Set(after.tell)].length };
}

// HR: publish a draft now instead of waiting for the review window to end.
export const payslipAutoRouter = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
payslipAutoRouter.post("/runs/:id/publish", wrap(async (req, res) => {
  const client = await pool.connect();
  let run, people;
  try {
    await client.query("BEGIN");
    ({ rows: [run] } = await client.query("SELECT * FROM payroll_runs WHERE id=$1 FOR UPDATE", [Number(req.params.id) || 0]));
    if (!run) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Payroll run not found." }); }
    people = await publish(client, run, req.user.email);
    if (!people) { await client.query("ROLLBACK"); return res.status(409).json({ error: "These payslips are already published." }); }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  await tellReady(people, run.period);
  res.json({ ok: true, published: people.length });
}));
