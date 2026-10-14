import { createHash } from "node:crypto";

// Each audit row stores a hash of the previous row, so any edit to history is detectable.
export async function writeAudit(client, { actor, action, employeeId = null, appCode = null, result = "ok", detail = {} }) {
  const { rows } = await client.query("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1");
  const prev = rows[0]?.hash ?? "GENESIS";
  const payload = JSON.stringify({ actor, action, employeeId, appCode, result, detail });
  const hash = createHash("sha256").update(prev + payload).digest("hex");
  await client.query(
    `INSERT INTO audit_log (actor, action, employee_id, app_code, result, detail, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [actor, action, employeeId, appCode, result, JSON.stringify(detail), prev, hash],
  );
}

export async function verifyChain(client) {
  const { rows } = await client.query("SELECT actor, action, employee_id, app_code, result, detail, prev_hash, hash FROM audit_log ORDER BY id");
  let prev = "GENESIS";
  for (const [i, r] of rows.entries()) {
    const payload = JSON.stringify({ actor: r.actor, action: r.action, employeeId: r.employee_id, appCode: r.app_code, result: r.result, detail: r.detail });
    const expect = createHash("sha256").update(prev + payload).digest("hex");
    if (r.prev_hash !== prev || r.hash !== expect) return { ok: false, brokenAt: i + 1 };
    prev = r.hash;
  }
  return { ok: true, rows: rows.length };
}
