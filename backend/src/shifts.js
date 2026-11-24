/*
 * Shifts, the roster and overtime (Attendance > Shifts). The rules are in shift-rules.js; attendance.js reads people's shifts
 * through `shiftsFor`.
 *
 *   GET    /api/shifts                     the shifts (everyone signed in: people see their own shift on their attendance)
 *   POST   /api/shifts                     a new shift                                   shifts.manage
 *   PUT    /api/shifts/:id                 change a shift                                shifts.manage
 *   POST   /api/shifts/:id/default         make it the default shift                     shifts.manage
 *   DELETE /api/shifts/:id                 retire a shift nobody is rostered on          shifts.manage
 *   GET    /api/shifts/roster?month=       who is on which shift in the month            shifts.manage or attendance.view (company)
 *   POST   /api/shifts/roster              put people on a shift from a date             shifts.manage
 *   DELETE /api/shifts/roster/:id          take a roster entry off                       shifts.manage
 *   GET    /api/overtime/staff             who is paid overtime                          shifts.manage
 *   PUT    /api/overtime/staff             add or remove a person                        shifts.manage
 *   GET    /api/overtime?month=            eligible people in scope: hours worked out and the decision   overtime.approve
 *   PUT    /api/overtime/:email/:month     approve (the hours) or reject, never your own  overtime.approve
 *   GET    /api/overtime/mine?month=       your own month, if you are eligible
 *
 * Payroll never pays overtime by itself (company decision, 2026-11-24): the approved hours are shown on the payroll line and HR
 * types the amount on the payslip.
 */
import express from "express";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { canAll, mayDecide, scopeOf } from "./access.js";
import { notify } from "./notify.js";
import { DEFAULT_SHIFT, hoursText, readAssignment, readOvertimeDecision, readShift, shiftFromRow, WEEKDAYS } from "./shift-rules.js";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SHIFT_COLS = "id, name, start_time, end_time, grace_minutes, weekly_offs, present_minutes, half_day_minutes, overtime_after_minutes, is_default";
const NO_ACCESS = { error: "You do not have access to this. Please ask a super admin if you need it." };
const monthRange = (month) => { const [y, m] = month.split("-").map(Number); return [`${month}-01`, `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`]; };
const istMonth = async () => (await pool.query("SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYY-MM') AS m")).rows[0].m;

/**
 * People's shifts between two dates, read once: { fallback, of(email) → [{ from, to, shift }] }. `emails` null = everyone.
 * The default shift is the one marked default, or the built-in 9:30 to 6:30 if the table is empty.
 */
export async function shiftsFor(db, from, to, emails = null) {
  const list = emails ? emails.map((e) => String(e).toLowerCase()) : null;
  const [{ rows: [def] }, { rows }] = await Promise.all([
    db.query(`SELECT ${SHIFT_COLS} FROM shifts WHERE is_default AND archived_at IS NULL LIMIT 1`),
    db.query(`SELECT lower(a.email) AS email, to_char(a.from_date,'YYYY-MM-DD') AS f, to_char(a.to_date,'YYYY-MM-DD') AS t, ${SHIFT_COLS.split(", ").map((c) => `s.${c}`).join(", ")}
                FROM shift_assignments a JOIN shifts s ON s.id = a.shift_id
               WHERE a.from_date <= $2 AND (a.to_date IS NULL OR a.to_date >= $1) ${list ? "AND lower(a.email) = ANY($3)" : ""}`, list ? [from, to, list] : [from, to]),
  ]);
  const by = new Map();
  for (const r of rows) { if (!by.has(r.email)) by.set(r.email, []); by.get(r.email).push({ from: r.f, to: r.t, shift: shiftFromRow(r) }); }
  return { fallback: def ? shiftFromRow(def) : DEFAULT_SHIFT, of: (email) => by.get(String(email || "").toLowerCase()) || [] };
}

async function namesOf(emails) {
  const list = [...new Set(emails.map((e) => String(e).toLowerCase()))];
  const { rows } = list.length ? await pool.query("SELECT lower(work_email) AS e, name, title FROM employees WHERE lower(work_email) = ANY($1)", [list]) : { rows: [] };
  const m = new Map(rows.map((r) => [r.e, r]));
  return (email) => { const r = m.get(String(email).toLowerCase()); return { email, name: r ? r.name : String(email).split("@")[0], title: r ? r.title || "" : "" }; };
}
const out = (s) => ({ ...s, weeklyOffNames: s.weeklyOffs.map((d) => WEEKDAYS[d]) });

export function shiftsRouter(wrap, { monthsFor }) {
  const r = express.Router();
  r.use(["/api/shifts", "/api/overtime"], requireAuth);
  const me = (req) => req.user.email.toLowerCase();
  const manages = (req, res) => (canAll(req, "shifts.manage") ? true : (res.status(403).json(NO_ACCESS), false));
  const audit = (req, action, email = null) => pool.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email || me(req)]).catch(() => {});

  /* ---------- shifts ---------- */
  r.get("/api/shifts", wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT ${SHIFT_COLS}, (SELECT count(DISTINCT lower(a.email)) FROM shift_assignments a WHERE a.shift_id = s.id
      AND (a.to_date IS NULL OR a.to_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date))::int AS people FROM shifts s WHERE archived_at IS NULL ORDER BY is_default DESC, start_time, name LIMIT 100`);
    res.json({ shifts: rows.map((x) => ({ ...out(shiftFromRow(x)), people: x.people })), canManage: canAll(req, "shifts.manage") });
  }));
  const saveShift = async (req, res, id = null) => {
    if (!manages(req, res)) return;
    const { value: v, errors } = readShift(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    try {
      const { rows: [x] } = id
        ? await pool.query(`UPDATE shifts SET name=$2, start_time=$3, end_time=$4, grace_minutes=$5, weekly_offs=$6, present_minutes=$7, half_day_minutes=$8,
            overtime_after_minutes=$9, updated_at=now() WHERE id=$1 AND archived_at IS NULL RETURNING ${SHIFT_COLS}`, [id, v.name, v.start, v.end, v.graceMinutes, v.weeklyOffs, v.presentMinutes, v.halfDayMinutes, v.overtimeAfterMinutes])
        : await pool.query(`INSERT INTO shifts (name, start_time, end_time, grace_minutes, weekly_offs, present_minutes, half_day_minutes, overtime_after_minutes, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${SHIFT_COLS}`, [v.name, v.start, v.end, v.graceMinutes, v.weeklyOffs, v.presentMinutes, v.halfDayMinutes, v.overtimeAfterMinutes, me(req)]);
      if (!x) return res.status(404).json({ error: "This shift was not found." });
      await audit(req, `Shift ${id ? "changed" : "created"}: ${v.name}, ${v.start} to ${v.end}, grace ${v.graceMinutes} min, off ${v.weeklyOffs.map((d) => WEEKDAYS[d]).join(" and ") || "no day"}`);
      res.status(id ? 200 : 201).json(out(shiftFromRow(x)));
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ errors: { name: "A shift with this name already exists." } });
      throw err;
    }
  };
  r.post("/api/shifts", wrap((req, res) => saveShift(req, res)));
  r.put("/api/shifts/:id", wrap((req, res) => saveShift(req, res, Number(req.params.id) || 0)));
  r.post("/api/shifts/:id/default", wrap(async (req, res) => {
    if (!manages(req, res)) return;
    const id = Number(req.params.id) || 0;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [x] } = await client.query("SELECT id, name FROM shifts WHERE id=$1 AND archived_at IS NULL FOR UPDATE", [id]);
      if (!x) { await client.query("ROLLBACK"); return res.status(404).json({ error: "This shift was not found." }); }
      await client.query("UPDATE shifts SET is_default=false, updated_at=now() WHERE is_default AND id <> $1", [id]);
      await client.query("UPDATE shifts SET is_default=true, updated_at=now() WHERE id=$1", [id]);
      await client.query("COMMIT");
      await audit(req, `Default shift is now ${x.name}`);
      res.json({ ok: true });
    } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
  }));
  r.delete("/api/shifts/:id", wrap(async (req, res) => {
    if (!manages(req, res)) return;
    const id = Number(req.params.id) || 0;
    const { rows: [x] } = await pool.query("SELECT name, is_default FROM shifts WHERE id=$1 AND archived_at IS NULL", [id]);
    if (!x) return res.status(404).json({ error: "This shift was not found." });
    if (x.is_default) return res.status(409).json({ error: "This is the default shift. Please make another shift the default first." });
    const { rows: [use] } = await pool.query("SELECT count(*)::int AS n FROM shift_assignments WHERE shift_id=$1 AND (to_date IS NULL OR to_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date)", [id]);
    if (use.n) return res.status(409).json({ error: `${use.n === 1 ? "One roster entry still uses" : `${use.n} roster entries still use`} this shift. Please move those people to another shift first.` });
    await pool.query("UPDATE shifts SET archived_at=now() WHERE id=$1", [id]);
    await audit(req, `Shift retired: ${x.name}`);
    res.json({ ok: true });
  }));

  /* ---------- the roster ---------- */
  r.get("/api/shifts/roster", wrap(async (req, res) => {
    if (!canAll(req, "shifts.manage") && !canAll(req, "attendance.view")) return res.status(403).json(NO_ACCESS);
    const month = String(req.query.month || (await istMonth()));
    if (!MONTH.test(month)) return res.status(400).json({ error: "Month must look like 2026-11." });
    const [from, to] = monthRange(month);
    const { rows } = await pool.query(`SELECT a.id, a.email, to_char(a.from_date,'YYYY-MM-DD') AS f, to_char(a.to_date,'YYYY-MM-DD') AS t, s.id AS shift_id, s.name AS shift, a.created_by
        FROM shift_assignments a JOIN shifts s ON s.id = a.shift_id WHERE a.from_date <= $2 AND (a.to_date IS NULL OR a.to_date >= $1) ORDER BY a.from_date DESC, a.id DESC LIMIT 500`, [from, to]);
    const person = await namesOf(rows.map((x) => x.email));
    res.json({ month, entries: rows.map((x) => ({ id: x.id, person: person(x.email), from: x.f, to: x.t, shift: { id: x.shift_id, name: x.shift } })) });
  }));
  r.post("/api/shifts/roster", wrap(async (req, res) => {
    if (!manages(req, res)) return;
    const { value: v, errors } = readAssignment(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const [{ rows: [s] }, { rows: known }] = await Promise.all([
      pool.query("SELECT name FROM shifts WHERE id=$1 AND archived_at IS NULL", [v.shiftId]),
      pool.query("SELECT lower(work_email) AS e FROM employees WHERE lower(work_email) = ANY($1)", [v.emails]),
    ]);
    if (!s) return res.status(400).json({ errors: { shiftId: "This shift was not found." } });
    const found = new Set(known.map((x) => x.e)), missing = v.emails.filter((e) => !found.has(e));
    if (missing.length) return res.status(400).json({ errors: { emails: `No employee record for ${missing.slice(0, 3).join(", ")}.` } });
    await pool.query(`INSERT INTO shift_assignments (email, shift_id, from_date, to_date, created_by) SELECT e, $2, $3, $4, $5 FROM unnest($1::text[]) AS e`,
      [v.emails, v.shiftId, v.from, v.to, me(req)]);
    await audit(req, `Roster: ${v.emails.length} ${v.emails.length === 1 ? "person" : "people"} on ${s.name} from ${v.from}${v.to ? ` to ${v.to}` : ""} (${v.emails.slice(0, 5).join(", ")}${v.emails.length > 5 ? ", …" : ""})`);
    res.status(201).json({ ok: true, added: v.emails.length });
  }));
  r.delete("/api/shifts/roster/:id", wrap(async (req, res) => {
    if (!manages(req, res)) return;
    const { rows: [x] } = await pool.query("DELETE FROM shift_assignments a USING shifts s WHERE a.id=$1 AND s.id=a.shift_id RETURNING a.email, s.name, to_char(a.from_date,'YYYY-MM-DD') AS f", [Number(req.params.id) || 0]);
    if (!x) return res.status(404).json({ error: "This roster entry was not found." });
    await audit(req, `Roster: ${x.email} taken off ${x.name} (from ${x.f})`, x.email);
    res.json({ ok: true });
  }));

  /* ---------- overtime ---------- */
  r.get("/api/overtime/staff", wrap(async (req, res) => {
    if (!manages(req, res)) return;
    const { rows } = await pool.query("SELECT email, added_by, added_at FROM overtime_staff ORDER BY added_at DESC LIMIT 500");
    const person = await namesOf(rows.map((x) => x.email));
    res.json({ staff: rows.map((x) => ({ person: person(x.email), addedAt: x.added_at })) });
  }));
  r.put("/api/overtime/staff", wrap(async (req, res) => {
    if (!manages(req, res)) return;
    const email = String((req.body && req.body.email) || "").trim().toLowerCase(), eligible = req.body && req.body.eligible === true;
    const { rows: [e] } = await pool.query("SELECT name FROM employees WHERE lower(work_email)=$1", [email]);
    if (!e) return res.status(400).json({ errors: { email: "Please choose a person." } });
    if (eligible) await pool.query("INSERT INTO overtime_staff (email, added_by) VALUES ($1,$2) ON CONFLICT (lower(email)) DO NOTHING", [email, me(req)]);
    else await pool.query("DELETE FROM overtime_staff WHERE lower(email)=$1", [email]);
    await audit(req, `Overtime: ${e.name} ${eligible ? "added to" : "removed from"} the staff paid overtime`, email);
    res.json({ ok: true });
  }));

  /** Eligible people (in `scope`, null = all) with their month's overtime worked out from attendance and any decision. */
  const monthFor = async (month, scope = null) => {
    const { rows: staff } = await pool.query(`SELECT lower(email) AS email FROM overtime_staff ${scope ? "WHERE lower(email) = ANY($1)" : ""} LIMIT 500`, scope ? [[...scope]] : []);
    if (!staff.length) return [];
    const emails = staff.map((x) => x.email);
    const [months, { rows: decided }] = await Promise.all([
      monthsFor(month, emails),
      pool.query("SELECT lower(email) AS email, computed_minutes, approved_minutes, status, note, decided_by, decided_at FROM overtime_approvals WHERE month=$1 AND lower(email) = ANY($2)", [month, emails]),
    ]);
    const dec = new Map(decided.map((d) => [d.email, d]));
    return months.map(({ emp, days, summary }) => {
      const d = dec.get(emp.work_email.toLowerCase());
      return { person: { email: emp.work_email, name: emp.name, title: emp.title || "" }, overtimeMinutes: summary.overtimeMinutes,
        days: days.filter((x) => x.overtimeMinutes).map((x) => ({ date: x.date, minutes: x.overtimeMinutes, firstIn: x.firstIn, lastOut: x.lastOut, shift: x.shift.name })),
        decision: d ? { status: d.status, approvedMinutes: d.approved_minutes, computedMinutes: d.computed_minutes, note: d.note, by: d.decided_by, at: d.decided_at } : null };
    }).sort((a, b) => a.person.name.localeCompare(b.person.name));
  };
  r.get("/api/overtime/mine", wrap(async (req, res) => {
    const month = String(req.query.month || (await istMonth()));
    if (!MONTH.test(month)) return res.status(400).json({ error: "Month must look like 2026-11." });
    const [row] = await monthFor(month, [me(req)]);
    res.json({ month, eligible: !!row, ...(row || {}) });
  }));
  r.get("/api/overtime", wrap(async (req, res) => {
    const scope = await scopeOf(req, "overtime.approve");
    if (scope && !scope.size) return res.status(403).json(NO_ACCESS);
    const month = String(req.query.month || (await istMonth()));
    if (!MONTH.test(month)) return res.status(400).json({ error: "Month must look like 2026-11." });
    res.json({ month, people: await monthFor(month, scope), canManageStaff: canAll(req, "shifts.manage"), me: me(req) });
  }));
  r.put("/api/overtime/:email/:month", wrap(async (req, res) => {
    const email = String(req.params.email || "").toLowerCase(), month = String(req.params.month || "");
    if (!MONTH.test(month)) return res.status(400).json({ error: "Month must look like 2026-11." });
    if (month > (await istMonth())) return res.status(400).json({ error: "Overtime can only be decided for this month or earlier ones." });
    if (!(await mayDecide(req, "overtime.approve", email))) return res.status(403).json(NO_ACCESS);
    const [row] = await monthFor(month, [email]);
    if (!row) return res.status(404).json({ error: "This person is not on the list of staff paid overtime." });
    const { value: v, errors } = readOvertimeDecision(req.body, row.overtimeMinutes);
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    await pool.query(`INSERT INTO overtime_approvals (email, month, computed_minutes, approved_minutes, status, note, decided_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (lower(email), month) DO UPDATE SET computed_minutes=EXCLUDED.computed_minutes, approved_minutes=EXCLUDED.approved_minutes, status=EXCLUDED.status,
        note=EXCLUDED.note, decided_by=EXCLUDED.decided_by, decided_at=now()`, [email, month, row.overtimeMinutes, v.minutes, v.decision, v.note, me(req)]);
    await audit(req, `Overtime for ${month}: ${v.decision === "approved" ? `${hoursText(v.minutes)} approved` : "rejected"} for ${email}${v.note ? ` (${v.note})` : ""}`, email);
    notify(email, v.decision === "approved"
      ? { title: `Your overtime for ${month} was approved`, body: `${hoursText(v.minutes)}. Payroll adds the payment to your payslip.${v.note ? ` ${v.note}` : ""}`.slice(0, 180), link: "/app/my-attendance" }
      : { title: `Your overtime for ${month} was not approved`, body: v.note.slice(0, 180), link: "/app/my-attendance" }).catch(() => {});
    const [after] = await monthFor(month, [email]);
    res.json(after);
  }));
  return r;
}

/** Approved overtime minutes for a payroll month, by lower-case email (payroll shows them; HR types the amount). */
export async function approvedOvertime(db, month) {
  const { rows } = await db.query("SELECT lower(email) AS email, approved_minutes FROM overtime_approvals WHERE month=$1 AND status='approved'", [month]);
  return new Map(rows.map((r) => [r.email, r.approved_minutes]));
}
