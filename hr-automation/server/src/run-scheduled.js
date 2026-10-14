// Daily job: offboards everyone whose last working day has arrived (India time).
// Run by hand: node src/run-scheduled.js
import { runScheduledOffboarding } from "./ops.js";
import { pool } from "./db.js";

const result = await runScheduledOffboarding();
console.log(JSON.stringify(result, null, 2));
await pool.end();
