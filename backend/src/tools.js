/*
 * Tools and their cost (Manage > Tools): every paid tool, who has a seat, and what it costs each month.
 *   "Tool access" (tools.manage, whole company) adds and edits tools, gives and removes seats, and records monthly bills.
 *   "See finance reports" (finance.view, whole company) also sees prices and totals. Everyone sees which tools they have.
 * Claude is "connected": its seats come and go through Claude itself (anthropic.js, the person's page), not by hand here.
 * Rules and sums: tools-rules.js. Rupees and dollars are always totalled apart.
 */
import express from "express";
import { pool } from "./db.js";
import { canAll, needAll } from "./access.js";
import { BILLING, CATEGORIES, PAID, WAITING, costSummary, readBill, readTool } from "./tools-rules.js";
import { deptOf } from "./payroll/store.js";

const me = (req) => req.user.email.toLowerCase();
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const audit = (action, email) => pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]);
const seesCost = (req) => canAll(req, "tools.manage") || canAll(req, "finance.view");
const toolOut = (t, withCost) => ({ slug: t.slug, name: t.name, vendor: t.vendor, category: t.category, billing: t.billing, currency: t.currency,
  connected: t.connected, url: t.url, notes: t.notes, active: t.is_active, ...(withCost ? { seatCostMinor: t.seat_cost_minor } : {}) });
const month = (q) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(q || "")) ? String(q) : istToday().slice(0, 7));

export function toolsRouter(wrap) {
  const r = express.Router();
  r.use("/api/tools", (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Please sign in." })));

  // The tool list, with which ones you have. Prices and seat counts only for people who see cost.
  r.get("/api/tools", wrap(async (req, res) => {
    const cost = seesCost(req), manage = canAll(req, "tools.manage");
    const [{ rows: tools }, { rows: mine }, { rows: counts }] = await Promise.all([
      pool.query(`SELECT * FROM tools ${manage ? "" : "WHERE is_active"} ORDER BY sort, name`),
      pool.query("SELECT tool, status, since FROM tool_access WHERE lower(work_email)=$1", [me(req)]),
      cost ? pool.query("SELECT tool, lower(status) AS status, count(*)::int AS n FROM tool_access GROUP BY 1, 2") : { rows: [] },
    ]);
    const seats = {};
    for (const c of counts) { const s = (seats[c.tool] ||= { paid: 0, waiting: 0 }); if (PAID.has(c.status)) s.paid += c.n; else if (WAITING.has(c.status)) s.waiting += c.n; }
    res.json({ canManage: manage, seesCost: cost, categories: CATEGORIES, billing: BILLING,
      tools: tools.map((t) => ({ ...toolOut(t, cost), ...(cost ? { seats: seats[t.slug] || { paid: 0, waiting: 0 } } : {}),
        mine: mine.find((m) => m.tool === t.slug && (PAID.has(String(m.status).toLowerCase()) || WAITING.has(String(m.status).toLowerCase()))) ? { status: mine.find((m) => m.tool === t.slug).status } : null })) });
  }));

  r.post("/api/tools", needAll("tools.manage"), wrap(async (req, res) => {
    const { value, errors } = readTool(req.body, { isNew: true });
    if (errors) return res.status(400).json({ errors });
    const { rowCount } = await pool.query(
      `INSERT INTO tools (slug, name, vendor, category, billing, seat_cost_minor, currency, url, notes, is_active, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (slug) DO NOTHING`,
      [value.slug, value.name, value.vendor, value.category, value.billing, value.seatCostMinor, value.currency, value.url, value.notes, value.active, me(req)]);
    if (!rowCount) return res.status(409).json({ errors: { name: `${value.name} is already on the list.` } });
    await audit(`Tool added: ${value.name} (by ${req.user.email})`, me(req));
    res.status(201).json({ slug: value.slug });
  }));

  r.put("/api/tools/:slug", needAll("tools.manage"), wrap(async (req, res) => {
    const { value, errors } = readTool(req.body);
    if (errors) return res.status(400).json({ errors });
    const { rows: [t] } = await pool.query(
      `UPDATE tools SET name=$2, vendor=$3, category=$4, billing=$5, seat_cost_minor=$6, currency=$7, url=$8, notes=$9, is_active=$10, updated_at=now()
       WHERE slug=$1 RETURNING name`,
      [req.params.slug, value.name, value.vendor, value.category, value.billing, value.seatCostMinor, value.currency, value.url, value.notes, value.active]);
    if (!t) return res.status(404).json({ error: "This tool is not on the list." });
    await audit(`Tool changed: ${t.name} (by ${req.user.email})`, me(req));
    res.json({ ok: true });
  }));

  // Who has a seat.
  r.get("/api/tools/:slug/seats", needAll("tools.manage"), wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT lower(a.work_email) AS email, a.status, a.since, a.seat_cost_minor, e.name, e.title, e.dept, e.emp_no FROM tool_access a
         LEFT JOIN employees e ON lower(e.work_email)=lower(a.work_email)
        WHERE a.tool=$1 AND lower(a.status) NOT IN ('removed','revoked','none','declined') ORDER BY e.name LIMIT 1000`, [req.params.slug]);
    res.json({ seats: rows.map((x) => ({ email: x.email, name: x.name || x.email, title: x.title || "", no: x.emp_no || "", dept: deptOf(x.dept, x.title),
      status: x.status, since: x.since, seatCostMinor: x.seat_cost_minor })) });
  }));

  // Give a seat (tools tracked by hand). Claude seats go through Claude itself, from the person's page.
  r.post("/api/tools/:slug/seats", needAll("tools.manage"), wrap(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const { rows: [t] } = await pool.query("SELECT name, connected FROM tools WHERE slug=$1 AND is_active", [req.params.slug]);
    if (!t) return res.status(404).json({ error: "This tool is not on the list." });
    if (t.connected) return res.status(409).json({ error: `${t.name} seats are given from the person's page, through ${t.name} itself.` });
    const { rows: [emp] } = await pool.query("SELECT name, status FROM employees WHERE lower(work_email)=$1", [email]);
    if (!emp || emp.status === "offboarded") return res.status(400).json({ errors: { email: "Please choose a current employee." } });
    const own = req.body?.seatCost === "" || req.body?.seatCost == null ? null : Math.round(Number(String(req.body.seatCost).replace(/[₹$,\s]/g, "")) * 100);
    if (own != null && (!Number.isFinite(own) || own < 0)) return res.status(400).json({ errors: { seatCost: "Please enter the price as a number, or leave it empty." } });
    await pool.query(
      `INSERT INTO tool_access (work_email, tool, status, since, seat_cost_minor, updated_by, updated_at) VALUES ($1,$2,'active',CURRENT_DATE,$3,$4,now())
       ON CONFLICT (work_email, tool) DO UPDATE SET status='active', since=COALESCE(tool_access.since, CURRENT_DATE), seat_cost_minor=$3, updated_by=$4, updated_at=now()`,
      [email, req.params.slug, own, me(req)]);
    await audit(`${t.name}: seat given (by ${req.user.email})`, email);
    res.status(201).json({ ok: true });
  }));

  r.delete("/api/tools/:slug/seats/:email", needAll("tools.manage"), wrap(async (req, res) => {
    const email = String(req.params.email).toLowerCase();
    const { rows: [t] } = await pool.query("SELECT name, connected FROM tools WHERE slug=$1", [req.params.slug]);
    if (!t) return res.status(404).json({ error: "This tool is not on the list." });
    if (t.connected) return res.status(409).json({ error: `${t.name} seats are removed from the person's page, through ${t.name} itself.` });
    const { rowCount } = await pool.query("UPDATE tool_access SET status='removed', updated_by=$3, updated_at=now() WHERE lower(work_email)=$1 AND tool=$2 AND status <> 'removed'", [email, req.params.slug, me(req)]);
    if (!rowCount) return res.status(404).json({ error: "This person has no seat." });
    await audit(`${t.name}: seat removed (by ${req.user.email})`, email);
    res.json({ ok: true });
  }));

  // The month's cost: seats at their price, plus recorded bills; per tool, per department, per currency.
  r.get("/api/tools/costs", wrap(async (req, res) => {
    if (!seesCost(req)) return res.status(403).json({ error: "You do not have access to this. Please ask a super admin if you need it." });
    const m = month(req.query.month);
    const [{ rows: tools }, { rows: seats }, { rows: bills }] = await Promise.all([
      pool.query("SELECT slug, name, seat_cost_minor, currency, billing FROM tools WHERE is_active ORDER BY sort, name"),
      pool.query(`SELECT a.tool, lower(a.work_email) AS email, lower(a.status) AS status, a.seat_cost_minor, e.dept, e.title FROM tool_access a
                    LEFT JOIN employees e ON lower(e.work_email)=lower(a.work_email) WHERE lower(a.status) IN ('active','member','invited','pending','requested')`),
      pool.query("SELECT id, tool, amount_minor, currency, note, created_by, created_at FROM tool_bills WHERE month=$1 AND deleted_at IS NULL ORDER BY id", [m]),
    ]);
    const s = costSummary(tools.map((t) => ({ slug: t.slug, name: t.name, seatCostMinor: t.seat_cost_minor, currency: t.currency, billing: t.billing })),
      seats.map((x) => ({ tool: x.tool, email: x.email, status: x.status, seatCostMinor: x.seat_cost_minor, dept: deptOf(x.dept, x.title) })),
      bills.map((b) => ({ tool: b.tool, amountMinor: b.amount_minor, currency: b.currency })));
    res.set("Cache-Control", "private, no-store");
    res.json({ month: m, ...s, bills: bills.map((b) => ({ id: b.id, tool: b.tool, amountMinor: b.amount_minor, currency: b.currency, note: b.note, by: b.created_by, at: b.created_at })) });
  }));

  r.post("/api/tools/:slug/bills", needAll("tools.manage"), wrap(async (req, res) => {
    const { value, errors } = readBill(req.body, istToday());
    if (errors) return res.status(400).json({ errors });
    const { rows: [t] } = await pool.query("SELECT name FROM tools WHERE slug=$1", [req.params.slug]);
    if (!t) return res.status(404).json({ error: "This tool is not on the list." });
    const { rows: [b] } = await pool.query("INSERT INTO tool_bills (tool, month, amount_minor, currency, note, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [req.params.slug, value.month, value.amountMinor, value.currency, value.note, me(req)]);
    await audit(`${t.name}: bill of ${value.currency === "USD" ? "$" : "₹"}${(value.amountMinor / 100).toFixed(2)} recorded for ${value.month} (by ${req.user.email})`, me(req));
    res.status(201).json({ id: b.id });
  }));

  r.delete("/api/tools/bills/:id", needAll("tools.manage"), wrap(async (req, res) => {
    const { rows: [b] } = await pool.query("UPDATE tool_bills SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING tool, month", [Number(req.params.id) || 0]);
    if (!b) return res.status(404).json({ error: "This bill was already removed." });
    await audit(`Tool bill removed: ${b.tool}, ${b.month} (by ${req.user.email})`, me(req));
    res.json({ ok: true });
  }));

  return r;
}
