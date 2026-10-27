// Copies attendance punches from the Employee Portal's table (public.attendance_punches) into this app's own table.
// The office device program installed on the Keka desktop feeds the portal; this lets the HR Hub show the same punches.
//   node scripts/sync-portal-attendance.mjs           shows what would be copied (nothing is written)
//   node scripts/sync-portal-attendance.mjs --apply   copies the punches that are missing here
// The app also does this by itself when PORTAL_ATTENDANCE_SYNC=true (see src/portal-attendance.js). This is the manual version.
// It only READS public.*. It adds punches the HR Hub does not have yet (same person, day and time) and never changes or removes any.
// Employee ids are the same in both schemas, so punches map one to one.
import "dotenv/config";
import { pool } from "../src/db.js";
import { syncPortalAttendance } from "../src/portal-attendance.js";

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("sync-portal-attendance.mjs")) {
  const apply = process.argv.includes("--apply");
  try {
    const r = await syncPortalAttendance(pool, { apply });
    console.log(`Portal holds ${r.portal} punches. ${r.missing} are not in the HR Hub yet${r.missing ? ` (${Object.entries(r.bySource).map(([k, v]) => `${k}: ${v}`).join(", ")})` : ""}.`);
    console.log(apply ? `Copied ${r.added}.` : "Dry run: nothing was written. Run again with --apply to copy.");
  } catch (e) { console.error("Failed:", e.message); process.exitCode = 1; }
  await pool.end();
}
