import express from "express";
import L from "../../frontend/leave-rules.cjs";
import { pool } from "./db.js";

/* Company assets (laptops, phones, monitors...). Only IT admins and HR can see or change them. */
export const CATEGORIES = ["Laptop", "Desktop", "Monitor", "Phone", "Tablet", "Keyboard / Mouse", "Headset", "Network", "Software licence", "Other"];
const STATUSES = ["In stock", "Assigned", "In repair", "Retired"];

export const requireItAdmin = (req, res, next) =>
  !req.user ? res.status(401).json({ error: "Please sign in." })
  : !(req.user.it_admin || req.user.role === "hr") ? res.status(403).json({ error: "IT admins and HR only." })
  : next();

const text = (v, max) => String(v ?? "").trim().slice(0, max);
const date = (v) => (v ? (L.validDate(String(v)) ? String(v) : false) : null);

const toApi = (r) => ({
  id: r.id, tag: r.tag, category: r.category, name: r.name, serial: r.serial_no || "", purchasedOn: r.purchased_on, warrantyUntil: r.warranty_until,
  status: r.status, notes: r.notes || "", assignedOn: r.assigned_on,
  assignee: r.assigned_to ? { id: r.assigned_to, name: r.emp_name, email: r.emp_email, no: r.emp_no || "", left: r.emp_status === "offboarded" } : null,
});
const SELECT = `SELECT a.*, e.name AS emp_name, e.work_email AS emp_email, e.emp_no, e.status AS emp_status
  FROM assets a LEFT JOIN employees e ON e.id = a.assigned_to`;
const one = async (id) => (await pool.query(`${SELECT} WHERE a.id=$1`, [id])).rows[0];
const log = (id, by, action) => pool.query("INSERT INTO asset_events (asset_id, by_email, action) VALUES ($1,$2,$3)", [id, by, action]);

/** Checks the fields a person can type; returns { error } or { v }. */
function readFields(b, partial = false) {
  const v = {};
  if (!partial || "name" in b) { v.name = text(b.name, 160); if (!v.name) return { error: "Give the asset a name, for example MacBook Air M2." }; }
  if (!partial || "category" in b) { v.category = text(b.category, 40); if (!CATEGORIES.includes(v.category)) return { error: "Choose a category." }; }
  if (!partial || "serial" in b) v.serial_no = text(b.serial, 80) || null;
  if (!partial || "notes" in b) v.notes = text(b.notes, 500) || null;
  for (const [k, col, label] of [["purchasedOn", "purchased_on", "purchase date"], ["warrantyUntil", "warranty_until", "warranty date"]]) {
    if (!partial || k in b) { const d = date(b[k]); if (d === false) return { error: `Enter a valid ${label}.` }; v[col] = d; }
  }
  return { v };
}

export function assetsRouter(wrap) {
  const r = express.Router();
  r.use("/api/assets", requireItAdmin);

  r.get("/api/assets", wrap(async (_req, res) => {
    const { rows } = await pool.query(`${SELECT} ORDER BY a.id DESC`);
    res.json({ categories: CATEGORIES, statuses: STATUSES, assets: rows.map(toApi) });
  }));

  r.post("/api/assets", wrap(async (req, res) => {
    const f = readFields(req.body || {});
    if (f.error) return res.status(400).json({ error: f.error });
    let tag = text(req.body.tag, 30);
    if (tag && !/^[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(tag)) return res.status(400).json({ error: "The asset tag can use letters, numbers and - . / _ only." });
    if (!tag) tag = `AST-${Date.now().toString(36).toUpperCase()}`;   // replaced by a numbered tag just below
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const ins = await c.query(
        `INSERT INTO assets (tag, category, name, serial_no, purchased_on, warranty_until, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tag) DO NOTHING RETURNING id`,
        [tag, f.v.category, f.v.name, f.v.serial_no, f.v.purchased_on, f.v.warranty_until, f.v.notes, req.user.email]);
      if (!ins.rowCount) { await c.query("ROLLBACK"); return res.status(409).json({ error: `The tag ${tag} is already used by another asset.` }); }
      const id = ins.rows[0].id;
      if (!text(req.body.tag, 30)) await c.query("UPDATE assets SET tag=$1 WHERE id=$2", [`AST-${String(id).padStart(4, "0")}`, id]);
      await c.query("INSERT INTO asset_events (asset_id, by_email, action) VALUES ($1,$2,$3)", [id, req.user.email, "Added to the register"]);
      await c.query("COMMIT");
      res.status(201).json({ asset: toApi(await one(id)) });
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
  }));

  r.put("/api/assets/:id", wrap(async (req, res) => {
    const id = Number(req.params.id), a = await one(id);
    if (!a) return res.status(404).json({ error: "Asset not found." });
    const f = readFields(req.body || {}, true);
    if (f.error) return res.status(400).json({ error: f.error });
    const cols = Object.keys(f.v);
    if (cols.length) {
      await pool.query(`UPDATE assets SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(", ")}, updated_at=now() WHERE id=$1`, [id, ...cols.map((c) => f.v[c])]);
      await log(id, req.user.email, "Details edited");
    }
    res.json({ asset: toApi(await one(id)) });
  }));

  // Hand the asset to someone (it must not be with anyone else or retired).
  r.post("/api/assets/:id/assign", wrap(async (req, res) => {
    const id = Number(req.params.id), a = await one(id);
    if (!a) return res.status(404).json({ error: "Asset not found." });
    if (a.status === "Retired") return res.status(409).json({ error: "A retired asset cannot be given out." });
    if (a.status === "Assigned") return res.status(409).json({ error: `Already with ${a.emp_name}. Take it back first.` });
    const emp = (await pool.query("SELECT id, name, status FROM employees WHERE id=$1", [Number(req.body?.employeeId)])).rows[0];
    if (!emp || emp.status === "offboarded") return res.status(400).json({ error: "Choose a current employee." });
    const on = date(req.body?.date) || new Date().toISOString().slice(0, 10);
    if (on === false) return res.status(400).json({ error: "Enter a valid date." });
    await pool.query("UPDATE assets SET status='Assigned', assigned_to=$2, assigned_on=$3, updated_at=now() WHERE id=$1", [id, emp.id, on]);
    await log(id, req.user.email, `Given to ${emp.name}`);
    res.json({ asset: toApi(await one(id)) });
  }));

  // Take it back, and say where it goes next.
  r.post("/api/assets/:id/return", wrap(async (req, res) => {
    const id = Number(req.params.id), a = await one(id);
    if (!a) return res.status(404).json({ error: "Asset not found." });
    const next = req.body?.status || "In stock";
    if (!["In stock", "In repair", "Retired"].includes(next)) return res.status(400).json({ error: "Choose In stock, In repair or Retired." });
    await pool.query("UPDATE assets SET status=$2, assigned_to=NULL, assigned_on=NULL, updated_at=now() WHERE id=$1", [id, next]);
    await log(id, req.user.email, a.assigned_to ? `Taken back from ${a.emp_name}, now ${next}` : `Marked ${next}`);
    res.json({ asset: toApi(await one(id)) });
  }));

  r.get("/api/assets/:id/history", wrap(async (req, res) => {
    const { rows } = await pool.query("SELECT at, by_email, action FROM asset_events WHERE asset_id=$1 ORDER BY at DESC, id DESC LIMIT 100", [Number(req.params.id)]);
    res.json({ events: rows.map((e) => ({ at: e.at, by: e.by_email, action: e.action })) });
  }));

  return r;
}
