import { pool, SCHEMA } from "./db.js";

/* Punches from the office device reach the Employee Portal's table (public.attendance_punches), because the program on the Keka
   desktop sends them there. This copies the ones the HR Hub is missing into its own table. Employee ids are the same in both
   schemas, so punches map one to one. It only READS public.*, and only adds punches (same person, day and time = skipped). */

/** Counts, and with apply = true copies, the portal punches that are missing here. Returns { portal, missing, added, bySource }. */
export async function syncPortalAttendance(db, { apply = false, schema = SCHEMA } = {}) {
  if (!schema || schema === "public") throw new Error("Set DB_SCHEMA (for example hrhub): this must not write into public.");
  const missingSql = `
    SELECT p.id, p.employee_id, p.work_date, p.punch_time::time AS t, p.direction, p.note,
           CASE WHEN p.source IN ('web', 'hr') THEN p.source ELSE 'device' END AS source,
           COALESCE(u.email, 'portal') AS created_by
    FROM public.attendance_punches p
    JOIN ${schema}.employees e ON e.id = p.employee_id
    LEFT JOIN public.users u ON u.id = p.created_by_user_id
    WHERE p.direction IN ('IN', 'OUT')
      AND NOT EXISTS (SELECT 1 FROM ${schema}.attendance_punches h WHERE h.employee_id = p.employee_id AND h.work_date = p.work_date AND h.punch_time = p.punch_time::time)`;
  const portal = (await db.query("SELECT count(*)::int AS n FROM public.attendance_punches")).rows[0].n;
  const missing = (await db.query(`SELECT source, count(*)::int AS n FROM (${missingSql}) m GROUP BY 1`)).rows;
  const total = missing.reduce((n, r) => n + r.n, 0);
  let added = 0;
  if (apply && total) {
    added = (await db.query(
      `INSERT INTO ${schema}.attendance_punches (employee_id, work_date, punch_time, direction, source, note, created_by)
       SELECT employee_id, work_date, t, direction, source, note, created_by FROM (${missingSql}) m ORDER BY work_date, t
       ON CONFLICT DO NOTHING`)).rowCount;
  }
  return { portal, missing: total, added, bySource: Object.fromEntries(missing.map((r) => [r.source, r.n])) };
}

export const portalSyncEnabled = () => String(process.env.PORTAL_ATTENDANCE_SYNC || "").toLowerCase() === "true";
const LOCK = 7203001;   // one run at a time, even with several copies of the app running

/** One round: copy what is missing, and remember how it went (the Attendance page shows it to HR). Never throws. */
export async function runPortalSyncOnce() {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK])).rows[0].ok;
    if (!locked) return null;
    const r = await syncPortalAttendance(client, { apply: true });
    await client.query("INSERT INTO settings (key, value) VALUES ('portal_attendance_sync', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [JSON.stringify({ at: new Date().toISOString(), added: r.added, portal: r.portal })]);
    if (r.added) console.log(`Portal attendance sync: ${r.added} new punch${r.added === 1 ? "" : "es"} added.`);
    return r;
  } catch (err) {
    console.error("Portal attendance sync failed:", err.message);
    try { await client.query("INSERT INTO settings (key, value) VALUES ('portal_attendance_sync', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify({ at: new Date().toISOString(), error: String(err.message).slice(0, 200) })]); } catch {}
    return null;
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [LOCK]).catch(() => {});
    client.release();
  }
}

/** Starts the repeating job when PORTAL_ATTENDANCE_SYNC=true (every PORTAL_ATTENDANCE_SYNC_SECONDS, default 300, at least 30). */
export function startPortalAttendanceSync() {
  if (!portalSyncEnabled()) return false;
  const seconds = Math.max(30, Number(process.env.PORTAL_ATTENDANCE_SYNC_SECONDS || 300));
  setTimeout(runPortalSyncOnce, 10_000);
  setInterval(runPortalSyncOnce, seconds * 1000);
  console.log(`Portal attendance sync: on, every ${seconds} s`);
  return true;
}
