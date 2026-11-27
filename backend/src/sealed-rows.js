import { SEALED, sealFields, indexesOf, emailIndex, openJson } from "./secret-box.js";

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
  const { rows: [row] } = await db.query(`SELECT *, ${col} AS sealed_now FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
  if (!row) return null;
  // Personal details are opened leniently on the way out (a page keeps working if they can't be read). A save must not be: it
  // would seal the fields it could not read as empty. So the copy is opened here again, and a failure stops the save.
  if (row.sealed_now) openJson(row.sealed_now);
  delete row.sealed_now;
  const next = figuresOf(col, row);
  for (const [f, v] of Object.entries(changes)) next[f] = typeof v === "function" ? v(row) : v;
  const { sealed, plain } = sealFields(col, next);
  const sets = [], args = [id];
  for (const f of fields) { args.push(plain[f]); sets.push(`"${f}"=$${args.length}`); }
  args.push(sealed); sets.push(`${col}=$${args.length}`);
  for (const [c, v] of Object.entries(indexesOf(col, next))) { args.push(v); sets.push(`"${c}"=$${args.length}`); }
  for (const [c, v] of Object.entries(also)) {
    if (v && typeof v === "object" && v.sql) sets.push(`"${c}"=${v.sql}`);
    else { args.push(v); sets.push(`"${c}"=$${args.length}`); }
  }
  const { rows: [out] } = await db.query(`UPDATE ${table} SET ${sets.join(", ")} WHERE id=$1 RETURNING *`, args);
  return out;
}

/** For an INSERT: the plain fields (emptied) and the sealed value, to put in the statement: { plain, sealed, index }. */
export const sealedValues = (col, values) => ({ ...sealFields(col, values), index: indexesOf(col, values) });

/** Runs fn(client) in a transaction of its own when given a pool, or on the caller's transaction client as it is. */
async function inTx(db, fn) {
  if (!(db && typeof db.connect === "function" && "totalCount" in db)) return fn(db);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/**
 * Changes someone's personal details (employees.person_sealed: personal email, phone, address, date of birth, masked Aadhaar, PAN and
 * bank account, IFSC), found by work email. `changes` names only the fields that change (a value, or a function of the current row);
 * the rest are kept. `also` sets other columns as they are. Returns the row as stored, opened, or null.
 */
export function updatePerson(db, workEmail, changes, also = {}) {
  return inTx(db, async (client) => {
    const { rows: [e] } = await client.query("SELECT id FROM employees WHERE lower(work_email)=$1", [String(workEmail).toLowerCase()]);
    return e ? updateSealed(client, "person_sealed", e.id, changes, also) : null;
  });
}

/**
 * Changes someone's "My profile" record (profiles.data, sealed in profile_sealed). `change(current)` returns the new record; the
 * row is locked meanwhile, so two saves at once can't undo each other. Creates the record when there is none. Returns the new record.
 */
export function updateProfile(db, email, change) {
  return inTx(db, async (client) => {
    const key = String(email).toLowerCase();
    // The row is made first if there is none, so the lock below always holds: two first saves at once take turns.
    await client.query("INSERT INTO profiles (email) VALUES ($1) ON CONFLICT (email) DO NOTHING", [key]);
    const { rows: [row] } = await client.query("SELECT data, profile_sealed, profile_sealed AS sealed_now FROM profiles WHERE lower(email)=$1 FOR UPDATE", [key]);
    if (row && row.sealed_now) openJson(row.sealed_now);   // never save over a record that could not be read (see updateSealed)
    const next = change((row && row.data) || {});
    const { sealed, plain } = sealFields("profile_sealed", { data: next });
    const { personal_email_hash } = indexesOf("profile_sealed", { data: next });
    await client.query(
      `INSERT INTO profiles (email, data, profile_sealed, personal_email_hash) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET data=EXCLUDED.data, profile_sealed=EXCLUDED.profile_sealed, personal_email_hash=EXCLUDED.personal_email_hash, updated_at=now()`,
      [key, plain.data, sealed, personal_email_hash]);
    return next;
  });
}

/**
 * A row read with the employee's `dob` and their profile's `data` (both opened): the date of birth from the person's own profile
 * wins over the one HR entered, as "YYYY-MM-DD" or null. The profile itself is left out of what comes back.
 */
export const dobOf = (r) => {
  const { data, ...rest } = r;
  const own = data && data.primary && String(data.primary.dob || "").trim();
  return { ...rest, dob: own || (r.dob ? String(r.dob).slice(0, 10) : null) };
};

/**
 * Who else uses this personal email: the name of another employee, or the email of another profile, or null. The address is stored
 * sealed, so it is found by its keyed hash (secret-box.js emailIndex), or by the plain column for rows not sealed yet.
 */
export async function personalEmailTaken(db, personalEmail, exceptWorkEmail, { profiles = false } = {}) {
  const pe = String(personalEmail || "").trim().toLowerCase(), mine = String(exceptWorkEmail || "").toLowerCase();
  if (!pe) return null;
  const h = emailIndex(pe);
  // Two lookups, each on its own index: by hash (sealed rows), then the plain column (rows not sealed yet, or no key in development).
  const first = async (byHash, byPlain) => (h && (await db.query(byHash, [h, mine])).rows[0]) || (await db.query(byPlain, [pe, mine])).rows[0] || null;
  const a = await first(
    "SELECT name FROM employees WHERE personal_email_hash=$1 AND lower(work_email)<>$2 LIMIT 1",
    "SELECT name FROM employees WHERE lower(personal_email)=$1 AND personal_email <> '' AND lower(work_email)<>$2 LIMIT 1");
  if (a) return a.name;
  if (!profiles) return null;
  const b = await first(
    "SELECT email FROM profiles WHERE personal_email_hash=$1 AND lower(email)<>$2 LIMIT 1",
    "SELECT email FROM profiles WHERE lower(data->'contact'->>'personalEmail')=$1 AND lower(email)<>$2 LIMIT 1");
  return b ? b.email : null;
}

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
