import { SEALED, EMPTY, sealFields, sealingReady } from "../secret-box.js";
import { seal } from "./access.js";

/*
 * Salary figures saved before encryption (2026-11-27) are sealed at start-up: each row's money columns go into its sealed column
 * (secret-box.js) and the plain columns are emptied. Safe to run again: a row that is already sealed is left alone. A row an older
 * release wrote plain figures into after it was sealed is sealed again from those (they are the newer ones).
 *
 *   sealStoredSalaries(db)    start-up; does nothing without PAYROLL_ENCRYPTION_KEY
 *   unsealStoredSalaries(db)  the way back (scripts/salary-encryption.mjs --down): plain columns again, sealed columns emptied,
 *                             so an older release of Wohlig One reads the figures. Never run on its own on the live server.
 *   sealingStatus(db)         how many rows of each table are sealed and how many still plain
 *
 * Approved payroll lines and the payroll history cannot change (database triggers); hrhub.sealing, set for this transaction only,
 * lets these two steps through, since they change no amount.
 */
const BATCH = 500;
const cols = (fields) => fields.map((f) => `"${f}"`).join(", ");
/** A row "still plain": not sealed, and holding at least one figure. */
const plainWhere = (fields) => fields.map((f) => `"${f}" IS NOT NULL${EMPTY[f] ? ` AND "${f}"::text <> '${EMPTY[f]}'` : ""}`).join(" OR ");

/** Seals every row still holding plain figures. Returns { [table]: rows sealed }. */
export async function sealStoredSalaries(db) {
  if (!sealingReady()) return {};
  const done = {};
  for (const [col, { table, fields }] of Object.entries(SEALED)) {
    const exists = (await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name=$2", [table, col])).rowCount;
    if (!exists) continue;   // a table this database does not hold
    let n = 0;
    for (;;) {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL hrhub.sealing = 'on'");
        const { rows } = await client.query(
          `SELECT id, ${cols(fields)} FROM ${table} WHERE ${plainWhere(fields)} ORDER BY id LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`);
        for (const r of rows) {
          const values = Object.fromEntries(fields.map((f) => [f, r[f]]));
          const { sealed, plain } = sealFields(col, values);
          const sets = fields.map((f, i) => `"${f}"=$${i + 2}`).join(", ");
          await client.query(`UPDATE ${table} SET ${col}=$1, ${sets} WHERE id=$${fields.length + 2}`, [sealed, ...fields.map((f) => plain[f]), r.id]);
        }
        await client.query("COMMIT");
        n += rows.length;
        if (rows.length < BATCH) break;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }
    if (n) done[table] = n;
  }
  // Payroll Excel reports saved before (bank files always were): encrypted in place, as the bank files are. Their checksum is of the
  // plain file, so it stays as it is; every release reads both forms (payroll/routes.js).
  const files = await db.query("SELECT id, content FROM payroll_files WHERE NOT encrypted ORDER BY id LIMIT 5000").catch(() => ({ rows: [] }));
  for (const f of files.rows) await db.query("UPDATE payroll_files SET content=$2, encrypted=true WHERE id=$1 AND NOT encrypted", [f.id, Buffer.from(seal(f.content), "utf8")]);
  if (files.rows.length) done.payroll_files_content = files.rows.length;
  if (Object.keys(done).length) console.log("[salaries] encrypted stored figures:", done);
  return done;
}

/** The way back: every sealed row gets its plain figures again and its sealed column is emptied. */
export async function unsealStoredSalaries(db) {
  const done = {};
  for (const [col, { table, fields }] of Object.entries(SEALED)) {
    const exists = (await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name=$2", [table, col])).rowCount;
    if (!exists) continue;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL hrhub.sealing = 'on'");
      // The read opens the sealed column (db.js), so each row comes back with its figures under their own names.
      const { rows } = await client.query(`SELECT id, ${col}, ${cols(fields)} FROM ${table} WHERE ${col} IS NOT NULL FOR UPDATE`);
      const asParam = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v ?? null);
      for (const r of rows) {
        const sets = fields.map((f, i) => `"${f}"=$${i + 1}`).join(", ");
        await client.query(`UPDATE ${table} SET ${sets}, ${col}=NULL WHERE id=$${fields.length + 1}`, [...fields.map((f) => (r[f] === undefined ? EMPTY[f] ?? null : asParam(r[f]))), r.id]);
      }
      await client.query("COMMIT");
      if (rows.length) done[table] = rows.length;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  return done;
}

/** { [table]: { sealed, plain } } — plain counts rows still holding a figure outside the sealed column. */
export async function sealingStatus(db) {
  const out = {};
  for (const [col, { table, fields }] of Object.entries(SEALED)) {
    const exists = (await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name=$2", [table, col])).rowCount;
    if (!exists) continue;
    const { rows: [r] } = await db.query(`SELECT count(*) FILTER (WHERE ${col} IS NOT NULL)::int AS sealed, count(*) FILTER (WHERE ${plainWhere(fields)})::int AS plain FROM ${table}`);
    out[table] = r;
  }
  return out;
}

/** Saves someone's monthly gross, sealed (employees.pay_sealed); null clears it. */
export async function setMonthlyGross(db, employeeId, gross) {
  const { sealed, plain } = sealFields("pay_sealed", { monthly_gross: gross === undefined ? null : gross });
  await db.query("UPDATE employees SET monthly_gross=$2, pay_sealed=$3 WHERE id=$1", [employeeId, plain.monthly_gross, gross == null ? null : sealed]);
}
