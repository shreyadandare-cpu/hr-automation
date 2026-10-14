// Loads the 8 Oct 2026 HR sheet once. Safe to re-run: it does nothing if employees already exist.
import roster from "../data/roster.json" with { type: "json" };
import { pool, withTx } from "./db.js";
import { BUNDLES, ON_TASKS, deptOf, bundleKey, statusFor } from "./rules.js";
import { writeAudit } from "./audit.js";

const HR_ADMIN = "shreya.dandare@wohlig.com";

const { rows } = await pool.query("SELECT count(*)::int AS n FROM employees");
if (rows[0].n > 0) {
  console.log(`already seeded (${rows[0].n} employees), nothing done`);
  await pool.end();
  process.exit(0);
}

await withTx(async (c) => {
  await c.query("INSERT INTO hr_users (email, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING", [HR_ADMIN]);
  for (const [empNo, name, email, start, title, lastDay] of roster) {
    const dept = deptOf(title);
    const status = statusFor(start);
    const { rows: [emp] } = await c.query(
      `INSERT INTO employees (emp_no, full_name, work_email, job_title, department, start_date, last_working_day, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [/dummy/i.test(empNo) ? null : empNo, name, email, title, dept, start, lastDay || null, status],
    );
    for (const app of BUNDLES[bundleKey(dept)]) {
      // Active people: tools assumed active from the bundle (the sheet has no tool data).
      // Joiners: tools not yet granted, and their checklist still open.
      await c.query(
        "INSERT INTO access_grants (employee_id, app_code, status, external_id) VALUES ($1,$2,$3,$4)",
        [emp.id, app, status === "active" ? "active" : "none", status === "active" ? "seed" : null],
      );
    }
    if (status === "onboarding") {
      for (const t of ON_TASKS) {
        await c.query("INSERT INTO checklist_items (employee_id, phase, title) VALUES ($1,'onboarding',$2)", [emp.id, t]);
      }
    }
  }
  await writeAudit(c, {
    actor: HR_ADMIN,
    action: "Employee list imported from HR sheet (8 Oct 2026)",
    result: "ok",
    detail: { count: roster.length },
  });
});

const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM employees");
console.log(`seeded ${n} employees`);
await pool.end();
