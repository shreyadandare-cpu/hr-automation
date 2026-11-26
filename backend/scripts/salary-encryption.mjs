/*
 * Salary figures stored encrypted (src/secret-box.js, src/payroll/sealing.js).
 *
 *   node scripts/salary-encryption.mjs            how many rows of each table are encrypted and how many still plain (changes nothing)
 *   node scripts/salary-encryption.mjs --commit   encrypt every row still plain (the server also does this at start-up)
 *   node scripts/salary-encryption.mjs --down     the way back, before running an older release of Wohlig One: every figure is put back in its
 *                                                 plain column and the encrypted copy is removed. Stop the server first; starting this release
 *                                                 again encrypts everything again.
 *
 * Reads DATABASE_URL (and PAYROLL_DATABASE_URL when payroll has its own database) and PAYROLL_ENCRYPTION_KEY from the environment or backend/.env.
 */
import "dotenv/config";
import { pool, payPool } from "../src/db.js";
import { sealStoredSalaries, sealingStatus, unsealStoredSalaries } from "../src/payroll/sealing.js";

const mode = process.argv.includes("--down") ? "down" : process.argv.includes("--commit") ? "commit" : "status";
try {
  for (const db of new Set([pool, payPool])) {
    const name = db === payPool && payPool !== pool ? "payroll database" : "database";
    if (mode === "commit") console.log(name, "encrypted:", await sealStoredSalaries(db));
    if (mode === "down") console.log(name, "put back in plain columns:", await unsealStoredSalaries(db));
    console.log(name, "now:", await sealingStatus(db));
  }
} finally {
  await pool.end();
  if (payPool !== pool) await payPool.end();
}
