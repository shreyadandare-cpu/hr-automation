import express from "express";
import L from "../../frontend/leave-rules.js";
import { pool } from "./db.js";
import { requireAuth, requireHr } from "./auth.js";
import { approverOf, approverMap } from "./teams.js";

const num = (v) => (v === null || v === undefined ? null : Number(v));
const todayIso = () => new Date().toISOString().slice(0, 10);
const plural = (n) => `${n} day${n === 1 ? "" : "s"}`;
const when = (r) => (r.half ? `${r.from} (${L.HALVES[r.half]})` : `${r.from} to ${r.to}`);

const toRequest = (r) => ({
  id: r.id, email: r.work_email, type: r.type, from: r.from_date, to: r.to_date, half: r.half || null, days: num(r.days), reason: r.reason, notify: r.notify || [],
  status: r.status, paidDays: num(r.paid_days), lopDays: num(r.lop_days), decidedAt: r.decided_at, createdAt: r.created_at,
});
const toCompOff = (c) => ({ id: c.id, email: c.work_email, workedOn: c.worked_on, days: num(c.days), reason: c.reason, status: c.status });
const toEmp = (e) => ({ name: e.name, status: e.status, start: e.start_date, casualOpening: num(e.casual_opening) });

// Employees see and act on their own leave only; HR sees everyone and makes the decisions.
const isHr = (req) => req.user && req.user.role === "hr";
const self = (req) => req.user.email.toLowerCase();
// A reporting manager decides their own team's requests; HR decides the managers' own (and anyone without a manager).
// The reporting manager decides. When someone has no reporting manager (or theirs has left), HR decides instead.
// Nobody decides their own request: an HR person's own leave needs another HR login.
const mayDecide = (req, approver, owner) => (approver === "hr" ? isHr(req) && String(owner).toLowerCase() !== self(req) : !isHr(req) && approver === self(req));
const notYours = (approver) => ({ error: approver === "hr"
  ? "This person has no reporting manager, so HR approves it, and not the person's own request."
  : "Only this person's reporting manager can approve or decline this request." });

const holidayDays = async (db) => (await db.query("SELECT day FROM holidays ORDER BY day")).rows.map((h) => h.day);

/** Locks the employee row so two approvals or requests for the same person can't race each other. */
async function lockEmployee(client, email) {
  const { rows } = await client.query("SELECT * FROM employees WHERE lower(work_email)=$1 FOR UPDATE", [String(email || "").toLowerCase()]);
  return rows[0] || null;
}
async function historyOf(client, email) {
  const lc = email.toLowerCase();
  const [reqs, comps] = await Promise.all([
    client.query("SELECT * FROM leave_requests WHERE lower(work_email)=$1", [lc]),
    client.query("SELECT * FROM comp_off_credits WHERE lower(work_email)=$1", [lc]),
  ]);
  return { requests: reqs.rows.map(toRequest), compOffs: comps.rows.map(toCompOff) };
}
const audit = (client, action, email) => client.query("INSERT INTO audit_log (action, work_email) VALUES ($1,$2)", [action, email]);

/** Runs fn inside a transaction; fn returns [status, body]. */
async function tx(res, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const [status, body] = await fn(client);
    await client.query(status < 400 ? "COMMIT" : "ROLLBACK");
    res.status(status).json(body);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function leaveRouter(wrap) {
  const r = express.Router();
  r.use(["/api/leave", "/api/employees"], requireAuth);

  // Everything the Leave page needs; the page works out balances with the same leave-rules.js.
  r.get("/api/leave", wrap(async (req, res) => {
    let scope = null;   // null = everyone (HR)
    if (!isHr(req)) {
      scope = [self(req)];
      // plus the people they are reporting manager of (set by HR in the Employees list)
      const { rows } = await pool.query(
        `SELECT lower(e.work_email) AS e FROM employees e JOIN employees me ON lower(me.name) = lower(e.manager)
         WHERE lower(me.work_email) = $1`, [self(req)]);
      scope.push(...rows.map((x) => x.e));
    }
    const where = scope ? "WHERE lower(work_email) = ANY($1)" : "";
    const args = scope ? [scope] : [];
    const approvers = await approverMap(pool, scope);
    const [reqs, comps, hols, pay] = await Promise.all([
      pool.query(`SELECT * FROM leave_requests ${where} ORDER BY from_date DESC, id DESC`, args),
      pool.query(`SELECT * FROM comp_off_credits ${where} ORDER BY worked_on DESC`, args),
      pool.query("SELECT day, name, type, source FROM holidays ORDER BY day"),
      pool.query(`SELECT work_email, start_date, monthly_gross, casual_opening FROM employees ${where}`, args),
    ]);
    res.json({
      policy: L.POLICY,
      today: todayIso(),
      requests: reqs.rows.map(toRequest),
      compOffs: comps.rows.map(toCompOff),
      holidays: hols.rows,
      // salaries only for HR, or your own
      pay: pay.rows.map((p) => ({ email: p.work_email, start: p.start_date,
        monthlyGross: isHr(req) || p.work_email.toLowerCase() === self(req) ? num(p.monthly_gross) : null, casualOpening: num(p.casual_opening) })),
      approvers,
    });
  }));

  r.post("/api/leave/requests", wrap(async (req, res) => {
    const { type, from, reason } = req.body || {};
    const email = isHr(req) ? req.body && req.body.email : self(req);   // employees always apply for themselves
    const half = req.body && req.body.half ? req.body.half : null;
    const to = half ? from : req.body && req.body.to;   // a half day is always a single date
    await tx(res, async (client) => {
      const emp = await lockEmployee(client, email);
      const hist = emp ? await historyOf(client, emp.work_email) : { requests: [], compOffs: [] };
      const holidays = await holidayDays(client);
      const bal = emp && L.validDate(from) ? L.balances(Number(from.slice(0, 4)), toEmp(emp), hist.requests, hist.compOffs) : null;
      const errors = L.requestProblems({ emp: emp && toEmp(emp), type, from, to, half, reason, holidays, existing: hist.requests, bal });
      // People to notify must be colleagues on the employee list; anything else is dropped.
      const asked = Array.isArray(req.body.notify) ? req.body.notify.map((x) => String(x).toLowerCase()).slice(0, 20) : [];
      const { rows: known } = asked.length
        ? await client.query("SELECT work_email FROM employees WHERE lower(work_email) = ANY($1)", [asked]) : { rows: [] };
      const notify = known.map((k) => k.work_email).filter((x) => !emp || x.toLowerCase() !== emp.work_email.toLowerCase());
      if (Object.keys(errors).length) return [400, { errors }];
      const days = L.requestDays(from, to, half, holidays);
      const { rows } = await client.query(
        `INSERT INTO leave_requests (work_email, type, from_date, to_date, half, days, reason, notify) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [emp.work_email, type, from, to, half, days, String(reason).trim(), JSON.stringify(notify)]);
      const lr = toRequest(rows[0]);
      await audit(client, `${L.TYPES[type].name} requested: ${when(lr)} (${plural(days)})`, emp.work_email);
      return [201, lr];
    });
  }));

  // Approve or decline. Approval fixes how many days are paid and how many are loss of pay, using the balance right now.
  r.post("/api/leave/requests/:id/decision", wrap(async (req, res) => {
    const decision = req.body && req.body.decision;
    if (!["approved", "declined"].includes(decision)) return res.status(400).json({ error: "Decision must be approved or declined." });
    await tx(res, async (client) => {
      const found = await client.query("SELECT work_email FROM leave_requests WHERE id=$1", [Number(req.params.id) || 0]);
      if (!found.rows[0]) return [404, { error: "Leave request not found." }];
      const approver = await approverOf(client, found.rows[0].work_email);
      if (!mayDecide(req, approver, found.rows[0].work_email)) return [403, notYours(approver)];
      const emp = await lockEmployee(client, found.rows[0].work_email);
      const { rows } = await client.query("SELECT * FROM leave_requests WHERE id=$1 FOR UPDATE", [Number(req.params.id)]);
      const lr = toRequest(rows[0]);
      if (lr.status !== "pending") return [409, { error: `This request was already ${lr.status}.` }];
      const name = L.TYPES[lr.type].name;
      if (decision === "declined") {
        const { rows: out } = await client.query(
          "UPDATE leave_requests SET status='declined', decided_at=now() WHERE id=$1 RETURNING *", [lr.id]);
        await audit(client, `${name} declined by ${req.user.email}: ${when(lr)}`, lr.email);
        return [200, toRequest(out[0])];
      }
      const holidays = await holidayDays(client);
      const days = L.requestDays(lr.from, lr.to, lr.half, holidays);   // recount in case holidays changed since the request
      const hist = await historyOf(client, lr.email);
      const bal = L.balances(Number(lr.from.slice(0, 4)), emp ? toEmp(emp) : {}, hist.requests, hist.compOffs);
      const { paid, lop } = L.allocate(lr.type, days, bal);
      const { rows: out } = await client.query(
        `UPDATE leave_requests SET status='approved', days=$2, paid_days=$3, lop_days=$4, decided_at=now() WHERE id=$1 RETURNING *`,
        [lr.id, days, paid, lop]);
      await audit(client, `${name} approved by ${req.user.email}: ${when(lr)} (${plural(paid)} paid${lop ? `, ${plural(lop)} loss of pay` : ""})`, lr.email);
      return [200, toRequest(out[0])];
    });
  }));

  // The employee withdraws a request that is still waiting.
  r.post("/api/leave/requests/:id/cancel", wrap(async (req, res) => {
    await tx(res, async (client) => {
      const { rows } = await client.query("SELECT * FROM leave_requests WHERE id=$1 FOR UPDATE", [Number(req.params.id) || 0]);
      if (!rows[0]) return [404, { error: "Leave request not found." }];
      const lr = toRequest(rows[0]);
      if (!isHr(req) && lr.email.toLowerCase() !== self(req)) return [404, { error: "Leave request not found." }];
      if (lr.status !== "pending") return [409, { error: `This request was already ${lr.status}, so it can't be cancelled.` }];
      const { rows: out } = await client.query("UPDATE leave_requests SET status='cancelled', decided_at=now() WHERE id=$1 RETURNING *", [lr.id]);
      await audit(client, `${L.TYPES[lr.type].name} cancelled by the employee: ${when(lr)}`, lr.email);
      return [200, toRequest(out[0])];
    });
  }));

  // HR records a comp off directly (approved at once), or an employee asks for one (pending until HR decides).
  const addCompOff = (status) => wrap(async (req, res) => {
    const { workedOn, reason } = req.body || {};
    const email = isHr(req) ? req.body && req.body.email : self(req);
    await tx(res, async (client) => {
      const emp = await lockEmployee(client, email);
      const { compOffs } = emp ? await historyOf(client, emp.work_email) : { compOffs: [] };
      const errors = L.compOffProblems({ emp, workedOn, reason, holidays: await holidayDays(client), today: todayIso(), existing: compOffs });
      if (Object.keys(errors).length) return [400, { errors }];
      const final = status;
      const { rows } = await client.query(
        "INSERT INTO comp_off_credits (work_email, worked_on, reason, status, decided_at) VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [emp.work_email, workedOn, String(reason).trim(), final, final === "approved" ? new Date() : null]);
      await audit(client, final === "approved" ? `Comp off earned for working on ${workedOn}` : `Comp off credit requested for working on ${workedOn}`, emp.work_email);
      return [201, toCompOff(rows[0])];
    });
  });
  r.post("/api/leave/comp-off-requests", addCompOff("pending"));

  r.post("/api/leave/comp-offs/:id/decision", wrap(async (req, res) => {
    const decision = req.body && req.body.decision;
    if (!["approved", "declined"].includes(decision)) return res.status(400).json({ error: "Decision must be approved or declined." });
    await tx(res, async (client) => {
      const { rows } = await client.query("SELECT * FROM comp_off_credits WHERE id=$1 FOR UPDATE", [Number(req.params.id) || 0]);
      if (!rows[0]) return [404, { error: "Comp off request not found." }];
      const approver = await approverOf(client, rows[0].work_email);
      if (!mayDecide(req, approver, rows[0].work_email)) return [403, notYours(approver)];
      if (rows[0].status !== "pending") return [409, { error: `This comp off was already ${rows[0].status}.` }];
      const { rows: out } = await client.query("UPDATE comp_off_credits SET status=$2, decided_at=now() WHERE id=$1 RETURNING *", [rows[0].id, decision]);
      await audit(client, `Comp off credit ${decision} by ${req.user.email} for working on ${rows[0].worked_on}`, rows[0].work_email);
      return [200, toCompOff(out[0])];
    });
  }));

  r.post("/api/leave/comp-offs", requireHr, addCompOff("approved"));
  r.post("/api/leave/holidays", requireHr, wrap(async (req, res) => {
    const { day, name } = req.body || {};
    const type = String((req.body && req.body.type) || "").trim().slice(0, 40) || null;
    if (!L.validDate(day) || !String(name || "").trim()) return res.status(400).json({ error: "Enter a date and a name for the holiday." });
    if (String(name).trim().length > 80) return res.status(400).json({ error: "Keep the holiday name under 80 characters." });
    await tx(res, async (client) => {
      const { rowCount } = await client.query("INSERT INTO holidays (day, name, type, source, updated_by, updated_at) VALUES ($1,$2,$3,'manual',$4,now()) ON CONFLICT DO NOTHING",
        [day, String(name).trim(), type, req.user.email]);
      if (!rowCount) return [409, { error: "That date is already a holiday." }];
      await audit(client, `Holiday added: ${String(name).trim()} on ${day}`, null);
      return [201, { day, name: String(name).trim(), type, source: "manual" }];
    });
  }));

  // Rename a holiday, change its type, or move it to another date. An imported holiday stays marked as imported.
  r.put("/api/leave/holidays/:day", requireHr, wrap(async (req, res) => {
    const { day, name } = req.body || {};
    const type = String((req.body && req.body.type) || "").trim().slice(0, 40) || null;
    if (!L.validDate(day) || !String(name || "").trim()) return res.status(400).json({ error: "Enter a date and a name for the holiday." });
    if (String(name).trim().length > 80) return res.status(400).json({ error: "Keep the holiday name under 80 characters." });
    await tx(res, async (client) => {
      const old = L.validDate(req.params.day) ? req.params.day : null;
      const { rows: [h] } = await client.query("SELECT * FROM holidays WHERE day=$1 FOR UPDATE", [old]);
      if (!h) return [404, { error: "Holiday not found." }];
      if (day !== old) {
        const { rowCount } = await client.query("SELECT 1 FROM holidays WHERE day=$1", [day]);
        if (rowCount) return [409, { error: "That date is already a holiday." }];
      }
      await client.query("UPDATE holidays SET day=$2, name=$3, type=$4, updated_by=$5, updated_at=now() WHERE day=$1", [old, day, String(name).trim(), type, req.user.email]);
      const what = [h.name !== String(name).trim() ? `renamed "${h.name}" to "${String(name).trim()}"` : null, day !== old ? `moved from ${old} to ${day}` : null,
        (h.type || null) !== type ? `type ${type || "none"}` : null].filter(Boolean).join(", ");
      await audit(client, `Holiday updated: ${what || "no change"}`, null);
      return [200, { day, name: String(name).trim(), type, source: h.source }];
    });
  }));

  r.delete("/api/leave/holidays/:day", requireHr, wrap(async (req, res) => {
    await tx(res, async (client) => {
      const { rows } = await client.query("DELETE FROM holidays WHERE day=$1 RETURNING name", [L.validDate(req.params.day) ? req.params.day : null]);
      if (!rows[0]) return [404, { error: "Holiday not found." }];
      await audit(client, `Holiday removed: ${rows[0].name} on ${req.params.day}`, null);
      return [200, { ok: true }];
    });
  }));

  // Monthly gross (for the salary cut) and the casual balance someone had before this system started.
  r.put("/api/employees/:email/pay", requireHr, wrap(async (req, res) => {
    const { monthlyGross, casualOpening } = req.body || {};
    const gross = monthlyGross === "" || monthlyGross === null || monthlyGross === undefined ? null : Number(monthlyGross);
    const opening = Number(casualOpening ?? 0);
    const errors = {};
    if (gross !== null && !(gross > 0 && gross < 1e8)) errors.monthlyGross = "Enter the monthly gross salary in rupees.";
    if (!(opening >= 0 && opening <= 365 && Number.isInteger(opening * 2))) errors.casualOpening = "Enter whole or half days, 0 to 365.";
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    await tx(res, async (client) => {
      const emp = await lockEmployee(client, req.params.email);
      if (!emp) return [404, { error: "Employee not found." }];
      const changed = [];
      if (num(emp.monthly_gross) !== gross) changed.push("monthly salary");
      if (num(emp.casual_opening) !== opening) changed.push(`opening casual balance (${num(emp.casual_opening)} → ${opening})`);
      if (!changed.length) return [200, { ok: true, changed: false }];
      await client.query("UPDATE employees SET monthly_gross=$2, casual_opening=$3 WHERE id=$1", [emp.id, gross, opening]);
      await audit(client, `Updated ${changed.join(" and ")}`, emp.work_email);   // the salary figure itself is not logged
      return [200, { ok: true, changed: true }];
    });
  }));

  // Salary cuts for one month: loss-of-pay days that fall in that month × monthly gross / 30.
  r.get("/api/leave/salary-cuts", requireHr, wrap(async (req, res) => {
    const month = String(req.query.month || "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: "Month must look like 2026-10." });
    const [reqs, emps, holidays] = await Promise.all([
      pool.query("SELECT * FROM leave_requests WHERE status='approved' AND lop_days > 0"),
      pool.query("SELECT work_email, name, monthly_gross FROM employees"),
      holidayDays(pool),
    ]);
    const byEmail = new Map(emps.rows.map((e) => [e.work_email.toLowerCase(), e]));
    const days = new Map();
    for (const lr of reqs.rows.map(toRequest)) {
      const n = L.lopByMonth(lr, holidays)[month] || 0;
      if (n) days.set(lr.email.toLowerCase(), (days.get(lr.email.toLowerCase()) || 0) + n);
    }
    res.json([...days].map(([email, lop]) => {
      const e = byEmail.get(email) || {};
      const gross = num(e.monthly_gross);
      return { email: e.work_email || email, name: e.name || email, lopDays: lop, monthlyGross: gross, cut: gross ? L.salaryCut(gross, lop) : null };
    }));
  }));

  return r;
}
