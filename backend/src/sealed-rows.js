import { SEALED, sealFields } from "./secret-box.js";

/*
 * Changing part of a row whose figures are stored sealed (secret-box.js). The sealed column holds all of a row's figures together,
 * so a change to one of them reads the row (opened on the way out of the database, db.js), applies the change, and seals the whole
 * set again. Anything adding up or comparing these figures does it in the app, never in SQL: the plain columns are empty.
 */

/** The sealed figures of `row` under their own names. */
export const figuresOf = (col, row) => Object.fromEntries(SEALED[col].fields.map((f) => [f, row[f] === undefined ? null : row[f]]));

/**
 * Updates one row: `changes` gives new figures (a value, or a function of the current row), `also` other columns as they are
 * ({ sql: "now()" } for a database value). Returns the row as stored, opened. Pass the caller's transaction client when it has one.
 */
export async function updateSealed(db, col, id, changes = {}, also = {}) {
  // The row is locked while its figures are read, changed and sealed again, so two changes at once can't undo each other.
  // Given a pool (not a transaction's client), it runs in a short transaction of its own.
  if (db && typeof db.connect === "function" && "totalCount" in db) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const out = await updateSealed(client, col, id, changes, also);
      await client.query("COMMIT");
      return out;
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
  }
  const { table, fields } = SEALED[col];
  const { rows: [row] } = await db.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
  if (!row) return null;
  const next = figuresOf(col, row);
  for (const [f, v] of Object.entries(changes)) next[f] = typeof v === "function" ? v(row) : v;
  const { sealed, plain } = sealFields(col, next);
  const sets = [], args = [id];
  for (const f of fields) { args.push(plain[f]); sets.push(`"${f}"=$${args.length}`); }
  args.push(sealed); sets.push(`${col}=$${args.length}`);
  for (const [c, v] of Object.entries(also)) {
    if (v && typeof v === "object" && v.sql) sets.push(`"${c}"=${v.sql}`);
    else { args.push(v); sets.push(`"${c}"=$${args.length}`); }
  }
  const { rows: [out] } = await db.query(`UPDATE ${table} SET ${sets.join(", ")} WHERE id=$1 RETURNING *`, args);
  return out;
}

/** For an INSERT: the plain fields (emptied) and the sealed value, to put in the statement: { plain, sealed }. */
export const sealedValues = (col, values) => sealFields(col, values);

/**
 * Advance recoveries added up per advance, here in the app (the amounts are sealed): Map(advance_id → { repaid, lastOn }).
 * `advanceIds` limits it to those advances (null for all).
 */
export async function recoveriesByAdvance(db, advanceIds = null) {
  if (advanceIds && !advanceIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT advance_id, recovered_on, amount, recovery_sealed FROM advance_recoveries ${advanceIds ? "WHERE advance_id = ANY($1)" : ""}`, advanceIds ? [advanceIds] : []);
  const out = new Map();
  for (const r of rows) {
    const cur = out.get(r.advance_id) || { paise: 0, lastOn: null };
    cur.paise += Math.round(Number(r.amount || 0) * 100);
    const on = r.recovered_on ? String(r.recovered_on).slice(0, 10) : null;
    if (on && (!cur.lastOn || on > cur.lastOn)) cur.lastOn = on;
    out.set(r.advance_id, cur);
  }
  return new Map([...out].map(([k, v]) => [k, { repaid: v.paise / 100, lastOn: v.lastOn }]));
}
