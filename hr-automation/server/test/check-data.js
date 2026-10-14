import { pool } from "../src/db.js";
const q = async (s) => (await pool.query(s)).rows;
console.log("by status", await q("select status, count(*)::int from employees group by 1 order by 1"));
console.log("by dept", await q("select department, count(*)::int from employees group by 1 order by 2 desc"));
console.log("grants", await q("select count(*)::int as n from access_grants"));
console.log("checklist", await q("select count(*)::int as n from checklist_items"));
console.log("audit", await q("select action, result from audit_log"));
await pool.end();
