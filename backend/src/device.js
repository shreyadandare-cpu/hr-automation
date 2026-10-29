import crypto from "node:crypto";
import express from "express";
import { pool } from "./db.js";
import { requireHr } from "./auth.js";
import { tooMany } from "./invites.js";

/* The office biometric device (eSSL / ZKTeco). A small program inside the office network reads the device and posts new
   punches here with a secret key. Each punch is matched to an employee through the device user ID; IDs nobody has linked
   yet are kept aside and applied as soon as HR links them. Times are Indian wall-clock times, as the device shows them. */
const IST = "Asia/Kolkata";
const WALL = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/;
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const keySet = () => (process.env.ATTENDANCE_DEVICE_KEY || "").length >= 32;
const keyOk = (req) => {
  const got = /^Bearer (.+)$/.exec(req.headers.authorization || "")?.[1] || "";
  return keySet() && crypto.timingSafeEqual(sha(got), sha(process.env.ATTENDANCE_DEVICE_KEY));
};
const audit = (db, action, email) => db.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]);
const digits = (s) => String(s || "").replace(/\D/g, "").replace(/^0+/, "");

/** { date: "YYYY-MM-DD", time: "HH:MM:SS" } in Indian time, or null when the text is not a time we understand. */
async function istParts(db, text) {
  const t = String(text || "").trim();
  const m = WALL.exec(t);
  if (m) return { date: m[1], time: `${m[2]}:${m[3] || "00"}` };
  if (!ISO_WITH_ZONE.test(t)) return null;
  const r = (await db.query(
    `SELECT to_char($1::timestamptz AT TIME ZONE '${IST}','YYYY-MM-DD') AS d, to_char($1::timestamptz AT TIME ZONE '${IST}','HH24:MI:SS') AS t`, [t])).rows[0];
  return { date: r.d, time: r.t };
}

/**
 * Adds one device punch. The device does not always say IN or OUT, so it alternates through the day: first punch IN, next OUT, and so on.
 * A second scan within a minute of another punch is ignored (people tap twice). Returns true when a punch was added.
 */
async function addPunch(db, employeeId, { date, time }, createdBy) {
  const r = await db.query(
    `INSERT INTO attendance_punches (employee_id, work_date, punch_time, direction, source, created_by)
     SELECT $1::int, $2::date, $3::time,
       CASE WHEN (SELECT count(*) FROM attendance_punches WHERE employee_id = $1::int AND work_date = $2::date AND punch_time < $3::time) % 2 = 0 THEN 'IN' ELSE 'OUT' END,
       'device', $4::text
     WHERE NOT EXISTS (SELECT 1 FROM attendance_punches WHERE employee_id = $1::int AND work_date = $2::date
                         AND abs(extract(epoch FROM (punch_time - $3::time))) < 60)
     ON CONFLICT DO NOTHING RETURNING id`, [employeeId, date, time, createdBy]);
  return r.rowCount === 1;
}

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

export function deviceRouter() {
  const r = express.Router();

  // ---- The office connector posts punches here. No sign-in: it carries the device key instead.
  r.post("/api/attendance/device/punches", wrap(async (req, res) => {
    if (!keySet()) return res.status(503).json({ error: "Device sync is not set up on the server (ATTENDANCE_DEVICE_KEY)." });
    if (tooMany(`device:${req.ip}`, 120, 10 * 60 * 1000)) return res.status(429).json({ error: "Too many requests. Try again in a few minutes." });
    if (!keyOk(req)) return res.status(401).json({ error: "Wrong device key." });
    const device = String(req.body?.device || "device").replace(/[^\w .-]/g, "").slice(0, 40) || "device";
    const list = req.body?.punches;
    if (!Array.isArray(list) || list.length > 1000) return res.status(400).json({ error: "Send { device, punches: [ { userId, time } ] } with at most 1000 punches." });

    const client = await pool.connect();
    const out = { received: list.length, added: 0, duplicates: 0, unmatched: 0, rejected: 0, unmatchedIds: [] };
    try {
      await client.query("BEGIN");
      const cutoff = (await client.query(`SELECT to_char((now() AT TIME ZONE '${IST}') + interval '10 minutes','YYYY-MM-DD HH24:MI:SS') AS c`)).rows[0].c;
      const parsed = [];
      for (const p of list) {
        const userId = String(p?.userId ?? "").trim();
        let when = null;
        try { when = await istParts(client, p?.time); } catch { when = null; }
        if (!userId || userId.length > 40 || !when || `${when.date} ${when.time}` > cutoff) { out.rejected++; continue; }
        parsed.push({ userId, ...when });
      }
      parsed.sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));   // oldest first, so IN / OUT alternate correctly
      const ids = new Map();
      for (const p of parsed) {
        if (!ids.has(p.userId)) {
          const m = (await client.query(
            "SELECT d.employee_id, e.status FROM device_users d JOIN employees e ON e.id = d.employee_id WHERE d.device_user_id = $1", [p.userId])).rows[0];
          ids.set(p.userId, m || null);
        }
        const m = ids.get(p.userId);
        if (!m) {
          const k = await client.query("INSERT INTO device_unmatched (device_user_id, punched_at) VALUES ($1, ($2 || ' ' || $3)::timestamp) ON CONFLICT DO NOTHING", [p.userId, p.date, p.time]);
          if (k.rowCount) out.unmatched++; else out.duplicates++;
          if (!out.unmatchedIds.includes(p.userId)) out.unmatchedIds.push(p.userId);
        } else if (m.status === "offboarded") out.rejected++;
        else if (await addPunch(client, m.employee_id, p, `device:${device}`)) out.added++;
        else out.duplicates++;
      }
      await client.query("INSERT INTO settings (key, value) VALUES ('device_last_sync', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify({ at: new Date().toISOString(), device, added: out.added })]);
      await client.query("COMMIT");
    } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
    res.json(out);
  }));

  // ---- HR: link device user IDs to people.
  r.get("/api/attendance/device/users", requireHr, wrap(async (_req, res) => {
    const mapped = (await pool.query(
      `SELECT d.device_user_id, e.name, e.work_email, e.emp_no FROM device_users d JOIN employees e ON e.id = d.employee_id WHERE e.status <> 'offboarded' ORDER BY nullif(regexp_replace(d.device_user_id, '\\D', '', 'g'), '')::numeric NULLS LAST, d.device_user_id`)).rows;
    const unmatched = (await pool.query(
      `SELECT device_user_id, count(*)::int AS punches, to_char(min(punched_at), 'YYYY-MM-DD') AS first_day, to_char(max(punched_at), 'YYYY-MM-DD') AS last_day
       FROM device_unmatched GROUP BY 1 ORDER BY nullif(regexp_replace(device_user_id, '\\D', '', 'g'), '')::numeric NULLS LAST, 1`)).rows;
    // A suggestion only when the device ID equals exactly one active person's employee number (WT/17 -> 17).
    const staff = (await pool.query("SELECT name, work_email, emp_no FROM employees WHERE status <> 'offboarded'")).rows;
    const taken = new Set(mapped.map((m) => m.work_email.toLowerCase()));
    const suggest = (id) => { const n = digits(id); const hit = n ? staff.filter((s) => digits(s.emp_no) === n && !taken.has(s.work_email.toLowerCase())) : []; return hit.length === 1 ? { email: hit[0].work_email, name: hit[0].name } : null; };
    const last = (await pool.query("SELECT value FROM settings WHERE key = 'device_last_sync'")).rows[0];
    const portal = (await pool.query("SELECT value FROM settings WHERE key = 'portal_attendance_sync'")).rows[0];
    res.json({
      keySet: keySet(), lastSync: last ? JSON.parse(last.value) : null,
      portalSync: { enabled: String(process.env.PORTAL_ATTENDANCE_SYNC || "").toLowerCase() === "true", last: portal ? JSON.parse(portal.value) : null },
      mapped: mapped.map((m) => ({ deviceUserId: m.device_user_id, name: m.name, email: m.work_email, no: m.emp_no || "" })),
      unmatched: unmatched.map((u) => ({ deviceUserId: u.device_user_id, punches: u.punches, firstDay: u.first_day, lastDay: u.last_day, suggestion: suggest(u.device_user_id) })),
    });
  }));

  // Link one or many device user IDs: { matches: [ { deviceUserId, email } ] }. Punches kept aside for them are applied at once.
  r.put("/api/attendance/device/users", requireHr, wrap(async (req, res) => {
    const matches = Array.isArray(req.body?.matches) ? req.body.matches : [];
    if (!matches.length || matches.length > 500) return res.status(400).json({ error: "Send { matches: [ { deviceUserId, email } ] }." });
    const client = await pool.connect();
    let linked = 0, applied = 0;
    try {
      await client.query("BEGIN");
      for (const m of matches) {
        const id = String(m?.deviceUserId ?? "").trim(), email = String(m?.email || "").trim().toLowerCase();
        const emp = (await client.query("SELECT id, name, status FROM employees WHERE lower(work_email) = $1", [email])).rows[0];
        if (!id || id.length > 40 || !emp) { await client.query("ROLLBACK"); return res.status(400).json({ error: `Could not link "${id}": pick an employee from the list.` }); }
        if (emp.status === "offboarded") { await client.query("ROLLBACK"); return res.status(400).json({ error: `${emp.name} has left, so a device ID cannot be linked to them.` }); }
        await client.query("INSERT INTO device_users (device_user_id, employee_id) VALUES ($1,$2) ON CONFLICT (device_user_id) DO UPDATE SET employee_id = $2", [id, emp.id]);
        const held = (await client.query(
          "DELETE FROM device_unmatched WHERE device_user_id = $1 RETURNING to_char(punched_at,'YYYY-MM-DD') AS d, to_char(punched_at,'HH24:MI:SS') AS t", [id])).rows
          .sort((a, b) => (a.d + a.t < b.d + b.t ? -1 : 1));
        for (const h of held) if (await addPunch(client, emp.id, { date: h.d, time: h.t }, "device:linked")) applied++;
        await audit(client, `Device user ${id} linked to ${emp.name} by ${req.user.email}${held.length ? `, ${held.length} waiting punches applied` : ""}`, email);
        linked++;
      }
      await client.query("COMMIT");
    } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
    res.json({ linked, applied });
  }));

  // Remove a link. Punches already recorded stay.
  r.delete("/api/attendance/device/users/:id", requireHr, wrap(async (req, res) => {
    const row = (await pool.query("DELETE FROM device_users WHERE device_user_id = $1 RETURNING (SELECT work_email FROM employees WHERE id = employee_id) AS email", [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ error: "That device ID is not linked." });
    await audit(pool, `Device user ${req.params.id} unlinked by ${req.user.email}`, row.email);
    res.json({ ok: true });
  }));

  return r;
}
