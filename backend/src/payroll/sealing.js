import { SEALED, EMPTY, MERGED, sealFields, sealingReady, openJson, indexesOf } from "../secret-box.js";
import { updateSealed } from "../sealed-rows.js";
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
  for (const [col, { table, fields, key = "id" }] of Object.entries(SEALED)) {
    const exists = (await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name=$2", [table, col])).rowCount;
    if (!exists) continue;   // a table this database does not hold
    const merged = MERGED.has(col);
    let n = 0;
    for (;;) {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL hrhub.sealing = 'on'");
        // A column written a few fields at a time keeps the sealed fields an older release did not write: the sealed copy is read
        // under another name (so it is not opened on the way out) and opened here, where a failure stops the step instead of losing them.
        const { rows } = await client.query(
          `SELECT "${key}" AS row_key, ${merged ? `${col} AS sealed_now, ` : ""}${cols(fields)} FROM ${table} WHERE ${plainWhere(fields)} ORDER BY "${key}" LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`);
        for (const r of rows) {
          const before = merged && r.sealed_now ? openJson(r.sealed_now) : {};
          const isSet = (f) => r[f] !== null && r[f] !== undefined && !(f in EMPTY && (r[f] === EMPTY[f] || (typeof r[f] === "object" && !Object.keys(r[f]).length)));
          const values = Object.fromEntries(fields.map((f) => [f, isSet(f) ? r[f] : f in before ? before[f] : r[f]]));
          const { sealed, plain } = sealFields(col, values);
          const index = indexesOf(col, values);
          const write = (idx) => client.query(
            `UPDATE ${table} SET ${[`${col}=$1`, ...fields.map((f, i) => `"${f}"=$${i + 2}`), ...Object.keys(idx).map((c, i) => `"${c}"=$${fields.length + 2 + i}`)].join(", ")} WHERE "${key}"=$${fields.length + Object.keys(idx).length + 2}`,
            [sealed, ...fields.map((f) => plain[f]), ...Object.values(idx), r.row_key]);
          if (!Object.keys(index).length) { await write(index); continue; }
          // A personal email someone else already has (two rows that differ only by a space, from before) must not stop the server
          // starting: the row is sealed without its look-up hash, and the server log names it so HR can correct one of them.
          await client.query("SAVEPOINT seal_row");
          try { await write(index); await client.query("RELEASE SAVEPOINT seal_row"); }
          catch (e) {
            if (e.code !== "23505") throw e;
            await client.query("ROLLBACK TO SAVEPOINT seal_row");
            console.error(`[salaries] ${table} ${r.row_key}: the personal email is the same as another person's, so it was sealed without its look-up hash. Please correct one of them.`);
            await write(Object.fromEntries(Object.keys(index).map((c) => [c, null])));
          }
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
    if (n) done[table] = (done[table] || 0) + n;
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
  for (const [col, { table, fields, key = "id" }] of Object.entries(SEALED)) {
    const exists = (await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name=$2", [table, col])).rowCount;
    if (!exists) continue;
    // Lookup hashes are of no use to an older release, and would go stale as it changes the plain columns: cleared too.
    const clear = Object.keys(indexesOf(col, Object.fromEntries(fields.map((f) => [f, null])))).map((c) => `, "${c}"=NULL`).join("");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL hrhub.sealing = 'on'");
      // The sealed copy is read under another name and opened here, where a failure stops the step: emptying the sealed column of a
      // row that could not be opened would lose it. A plain value an older release wrote after sealing wins, as on a read.
      const { rows } = await client.query(`SELECT "${key}" AS row_key, ${col} AS sealed_now, ${cols(fields)} FROM ${table} WHERE ${col} IS NOT NULL FOR UPDATE`);
      const asParam = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v ?? null);
      const isSet = (r, f) => r[f] !== null && r[f] !== undefined && !(f in EMPTY && (r[f] === EMPTY[f] || (typeof r[f] === "object" && !Object.keys(r[f]).length)));
      for (const r of rows) {
        const opened = openJson(r.sealed_now);
        const merged = MERGED.has(col), anyPlain = fields.some((f) => isSet(r, f));
        for (const f of fields) if (merged ? !isSet(r, f) && f in opened : !anyPlain) r[f] = opened[f];
        const sets = fields.map((f, i) => `"${f}"=$${i + 1}`).join(", ");
        await client.query(`UPDATE ${table} SET ${sets}, ${col}=NULL${clear} WHERE "${key}"=$${fields.length + 1}`, [...fields.map((f) => (r[f] === undefined ? EMPTY[f] ?? null : asParam(r[f]))), r.row_key]);
      }
      await client.query("COMMIT");
      if (rows.length) done[table] = (done[table] || 0) + rows.length;
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
    out[Object.values(SEALED).filter((x) => x.table === table).length > 1 ? `${table} (${col})` : table] = r;
  }
  return out;
}

/** Saves someone's monthly gross, sealed (employees.pay_sealed, beside the PF number, which is kept); null clears it. */
export async function setMonthlyGross(db, employeeId, gross) {
  await updateSealed(db, "pay_sealed", employeeId, { monthly_gross: gross === undefined ? null : gross });
}
/** Saves someone's PF number, sealed beside the monthly gross (employees.pay_sealed). */
export async function setPfNumber(db, employeeId, pfNumber) {
  await updateSealed(db, "pay_sealed", employeeId, { pf_number: pfNumber || null });
}

/*
 * Notices and audit lines written before 2026-11-27 could name amounts ("₹48,000 net", "CTC 1200000", "final salary ₹…"). Those
 * tables are not encrypted, so each amount is replaced with "[amount removed]". On demand only, since it rewrites history:
 * `node scripts/salary-encryption.mjs --redact-old-text` counts, and with `--commit` applies.
 */
const MONEY_TEXT = /₹\s?-?\d[\d,]*\d(\.\d+)?|₹\s?\d|\bCTC\s+\d[\d,]*\d(\.\d+)?|\b(INR|Rs\.?)\s?\d[\d,]*\d(\.\d+)?/gi;   // a trailing comma stays in the sentence
export const redactMoney = (s) => (s == null ? s : String(s).replace(MONEY_TEXT, "[amount removed]"));
const REDACT = [
  { table: "audit_log", cols: ["action"] },
  { table: "notifications", cols: ["title", "body"] },
];
export async function redactOldText(db, { commit = false } = {}) {
  const out = {};
  for (const { table, cols } of REDACT) {
    const exists = (await db.query("SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=$1", [table])).rowCount;
    if (!exists) continue;
    const where = cols.map((c) => `${c} ~* $1`).join(" OR ");
    const { rows } = await db.query(`SELECT id, ${cols.join(", ")} FROM ${table} WHERE ${where} ORDER BY id LIMIT 100000`, ["(₹|\\mCTC\\s+[0-9]|\\m(INR|Rs\\.?)\\s?[0-9])"]);
    out[table] = rows.length;
    if (!commit) continue;
    for (const r of rows) {   // a one-off maintenance step, not a request
      const sets = cols.map((c, i) => `${c}=$${i + 2}`).join(", ");
      await db.query(`UPDATE ${table} SET ${sets} WHERE id=$1`, [r.id, ...cols.map((c) => redactMoney(r[c]))]);
    }
  }
  return out;
}
