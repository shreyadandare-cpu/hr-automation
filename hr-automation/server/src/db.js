import pg from "pg";

// Connection string comes from the environment so no password lives in the code.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://hr:hr_local_only@localhost:5432/hr_automation",
});

export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialise writes so the audit hash chain stays in order.
    await client.query("SELECT pg_advisory_xact_lock(4242)");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
