/*
 * The custom report builder (Manage > Report builder), as Keka's: choose what the report is about, its columns and filters,
 * see the first rows, download it as a spreadsheet (CSV), and save it to run again. The datasets, columns and filters are
 * fixed in report-builder-rules.js. Each dataset needs its own permission; one given for a reporting team limits the rows
 * to that team. Downloads are written to the audit log.
 *
 *   GET    /api/report-builder              the datasets you may use, and your saved reports
 *   POST   /api/report-builder/run          the first rows of a report
 *   POST   /api/report-builder/csv          the whole report as a CSV file (up to 10,000 rows)
 *   POST   /api/report-builder/saved        save a report; DELETE /api/report-builder/saved/:id removes one of yours
 */
import express from "express";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { canAll, holds, scopeOf } from "./access.js";
import { deptOf } from "./payroll/store.js";
import { CSV_ROWS, DATASETS, describe, PREVIEW_ROWS, readReport, readSaved, reportSql, shapeRows, toCsv } from "./report-builder-rules.js";

const NO_ACCESS = { error: "You do not have access to this report. Please ask a super admin if you need it." };

export function reportBuilderRouter(wrap) {
  const r = express.Router();
  r.use("/api/report-builder", requireAuth);
  const me = (req) => req.user.email.toLowerCase();
  const allowed = (req) => Object.entries(DATASETS).filter(([, ds]) => (ds.team ? holds(req, ds.perm) : canAll(req, ds.perm))).map(([k]) => k);
  /** The lists select filters are checked against: departments and review periods, from the data. */
  const optionLists = async () => {
    const [emps, periods] = await Promise.all([
      pool.query("SELECT DISTINCT dept, title FROM employees LIMIT 5000"),
      pool.query("SELECT DISTINCT period FROM reviews ORDER BY period DESC LIMIT 50"),
    ]);
    return { depts: [...new Set(emps.rows.map((x) => deptOf(x.dept, x.title)))].sort(), periods: periods.rows.map((x) => x.period) };
  };
  /** Runs a checked request for this person; null scope = every row, otherwise their team only. */
  const run = async (req, body, limit) => {
    const options = await optionLists();
    const q = readReport(body, options);
    if (Object.keys(q.errors).length) return { status: 400, body: { errors: q.errors } };
    if (!allowed(req).includes(body.dataset)) return { status: 403, body: NO_ACCESS };
    const scope = q.ds.team ? await scopeOf(req, q.ds.perm) : null;
    if (scope && !scope.size) return { ok: true, q, header: q.columns.map((c) => q.ds.columns[c].label), rows: [], more: false };   // a team with nobody in it
    const params = [...q.params, ...(scope ? [[...scope]] : [])];
    // A department filter is applied after the query (the department is worked out from the job title), so read them all then.
    const sqlLimit = q.after.length ? CSV_ROWS : limit;
    const { rows } = await pool.query(reportSql(q.ds, q.columns, q.where, scope ? params.length : null, sqlLimit), params);
    const shaped = shapeRows(q.ds, q.columns, rows, q.after, deptOf);
    return { ok: true, q, header: q.columns.map((c) => q.ds.columns[c].label), rows: shaped.slice(0, limit), more: shaped.length > limit };
  };

  r.get("/api/report-builder", wrap(async (req, res) => {
    const mine = allowed(req);
    const [options, saved] = await Promise.all([optionLists(), pool.query(
      "SELECT id, name, dataset, columns, filters, created_at FROM saved_reports WHERE lower(owner)=$1 AND deleted_at IS NULL ORDER BY name LIMIT 100", [me(req)])]);
    res.set("Cache-Control", "private, no-store");
    res.json({ datasets: describe(mine, options), previewRows: PREVIEW_ROWS, maxRows: CSV_ROWS,
      // A saved report whose data you can no longer see stays listed but cannot be run.
      saved: saved.rows.map((x) => ({ id: x.id, name: x.name, dataset: x.dataset, columns: x.columns, filters: x.filters, savedAt: x.created_at, available: mine.includes(x.dataset) })) });
  }));
  r.post("/api/report-builder/run", wrap(async (req, res) => {
    const out = await run(req, req.body || {}, PREVIEW_ROWS);
    if (!out.ok) return res.status(out.status).json(out.body);
    res.set("Cache-Control", "private, no-store");
    res.json({ header: out.header, rows: out.rows, more: out.more });
  }));
  r.post("/api/report-builder/csv", wrap(async (req, res) => {
    const out = await run(req, req.body || {}, CSV_ROWS);
    if (!out.ok) return res.status(out.status).json(out.body);
    const name = `${out.q.ds.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)}.csv`;
    await pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [`Report downloaded: ${out.q.ds.label}, ${out.rows.length} rows${out.more ? " (cut at the limit)" : ""}`, me(req)]);
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "X-Rows-Cut": out.more ? "1" : "0" });
    res.send(toCsv(out.header, out.rows));
  }));
  r.post("/api/report-builder/saved", wrap(async (req, res) => {
    const x = readSaved(req.body || {}, await optionLists());
    if (Object.keys(x.errors).length) return res.status(400).json({ errors: x.errors });
    if (!allowed(req).includes(x.report.dataset)) return res.status(403).json(NO_ACCESS);
    const { rowCount } = await pool.query("SELECT 1 FROM saved_reports WHERE lower(owner)=$1 AND deleted_at IS NULL", [me(req)]);
    if (rowCount >= 50) return res.status(400).json({ errors: { name: "You have 50 saved reports. Please remove one first." } });
    const { rows: [s] } = await pool.query("INSERT INTO saved_reports (owner, name, dataset, columns, filters) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [me(req), x.name, x.report.dataset, JSON.stringify(x.report.columns), JSON.stringify(x.report.filters)]);
    res.status(201).json({ id: s.id });
  }));
  r.delete("/api/report-builder/saved/:id", wrap(async (req, res) => {
    const { rowCount } = await pool.query("UPDATE saved_reports SET deleted_at=now() WHERE id=$1 AND lower(owner)=$2 AND deleted_at IS NULL", [Number(req.params.id) || 0, me(req)]);
    if (!rowCount) return res.status(404).json({ error: "This saved report was not found." });
    res.json({ ok: true });
  }));
  return r;
}
