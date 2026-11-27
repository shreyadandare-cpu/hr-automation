/*
 * Reminders before the tax declaration and proof due dates, as Keka sends them: seven days before and the day before each date,
 * to everyone still working here who has not finished. Declarations: no submitted declaration for the year. Proofs: a submitted
 * declaration with a claim that has no document and has not been verified (income lines need no proof). Each reminder goes out
 * once (tax_reminders_sent); checked hourly by jobs.js, sent from 9 am India time.
 */
import { pool } from "./db.js";
import { notify } from "./notify.js";
import { frontendUrl } from "./mail.js";
import { PRODUCT, SIGN_OFF } from "./brand.js";
import { leaveHtml } from "./leave-mail.js";

const BEFORE = [7, 1];   // days before the due date
const NO_PROOF = new Set(["Previous employer salary", "Previous employer TDS", "Income from other sources", "Let-out property"]);
const longDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

/** Who still has something to do, from the year's requests: pure, for the tests. */
export function stillToDo(kind, staff, requests, files) {
  const byEmail = new Map(requests.map((r) => [r.email.toLowerCase(), r]));
  const withFile = new Set(files.map((f) => `${f.request_id}:${f.line_index}`));
  return staff.filter((email) => {
    const r = byEmail.get(email);
    if (kind === "declaration") return !r || r.status !== "submitted";
    if (!r || r.status !== "submitted") return false;
    return r.items.some((i, n) => !NO_PROOF.has(i.section) && !withFile.has(`${r.id}:${n}`) && !((r.proofs || {})[n] && r.proofs[n].status === "verified"));
  });
}

/** `anyHour`: for a check by hand; the hourly job waits for 9 am. */
export async function runTaxReminders({ anyHour = false } = {}) {
  const { rows: [now] } = await pool.query(`SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day,
    extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::int AS hour`);
  if (now.hour < 9 && !anyHour) return { sent: 0 };
  const day = now.day, [y, m] = day.split("-").map(Number), fy = m >= 4 ? y : y - 1;
  const { rows: [pol] } = await pool.query("SELECT to_char(declaration_due,'YYYY-MM-DD') AS declaration, to_char(proof_due,'YYYY-MM-DD') AS proof FROM tax_regime_policies WHERE financial_year=$1", [fy]);
  if (!pol) return { sent: 0 };
  let sent = 0;
  for (const kind of ["declaration", "proof"]) {
    const due = pol[kind];
    if (!due) continue;
    const left = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000);
    if (!BEFORE.includes(left)) continue;
    // Claim this reminder first, so two servers (or a restart) never send it twice.
    const { rowCount } = await pool.query("INSERT INTO tax_reminders_sent (financial_year, kind, due, days_before) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [fy, kind, due, left]);
    if (!rowCount) continue;
    const [{ rows: staff }, { rows: requests }] = await Promise.all([
      pool.query(`SELECT lower(work_email) AS email FROM employees WHERE work_email IS NOT NULL AND coalesce(status,'') <> 'offboarded'
        AND (last_day IS NULL OR last_day >= $1::date) LIMIT 5000`, [day]),
      pool.query("SELECT id, email, status, items, proofs, declreq_sealed FROM tax_declaration_requests WHERE financial_year=$1", [fy]),
    ]);
    const { rows: files } = requests.length ? await pool.query("SELECT request_id, line_index FROM tax_proof_files WHERE request_id = ANY($1)", [requests.map((r) => r.id)]) : { rows: [] };
    const to = stillToDo(kind, staff.map((s) => s.email), requests, files);
    if (!to.length) continue;
    const what = kind === "proof" ? "tax proofs" : "tax declaration";
    const when = left === 1 ? "tomorrow" : `on ${longDay(due)}`;
    const url = `${frontendUrl()}/app/tax`;
    const ask = kind === "proof"
      ? `Please add the proof for each claim on your tax declaration by ${longDay(due)}. After that date only verified claims count, so payroll may deduct more tax from your salary.`
      : `Please submit your tax declaration for this financial year by ${longDay(due)}, so payroll works out your tax correctly. If nothing changes, please still submit it, choosing your tax regime.`;
    const { rows: names } = await pool.query("SELECT lower(work_email) AS e, name FROM employees WHERE lower(work_email) = ANY($1)", [to]);
    const nameOf = new Map(names.map((n) => [n.e, String(n.name || "").split(" ")[0]]));
    // One email each, addressed by name, in the same branded layout as the leave emails.
    for (const email of to) {
      const body = [`Dear ${nameOf.get(email) || "colleague"},`, "", ask, "", `Open your tax declaration: ${url}`, "", "Regards,", SIGN_OFF].join("\n");
      await notify(email, {
        title: `Your ${what} ${left === 1 ? "is due tomorrow" : `is due in ${left} days`}`,
        body: ask, link: "/app/tax",
        email: { subject: `Reminder: your ${what} closes ${when}`, body, html: leaveHtml({ body, button: kind === "proof" ? "Add my proofs" : "Open my tax declaration" }, url) },
      });
    }
    sent += to.length;
  }
  return { sent };
}
