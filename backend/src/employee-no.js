/* The next employee ID in the series. The person who joined most recently sets the style (WT/205, WOH-035),
   and the next one is the highest number in that series plus one, written with the same number of digits. */
const SPLIT = /^(.*?)(\d+)$/;

export function nextEmployeeNo(rows) {
  const parsed = rows.map((r) => {
    const m = SPLIT.exec(String(r.emp_no || "").trim());
    return m ? { prefix: m[1], width: m[2].length, n: Number(m[2]), start: r.start_date ? String(r.start_date).slice(0, 10) : "" } : null;
  }).filter(Boolean);
  if (!parsed.length) return null;
  const last = parsed.reduce((a, b) => (b.start > a.start || (b.start === a.start && b.n > a.n) ? b : a));
  const max = Math.max(...parsed.filter((p) => p.prefix.toLowerCase() === last.prefix.toLowerCase()).map((p) => p.n));
  return last.prefix + String(max + 1).padStart(last.width, "0");
}

export async function nextEmployeeNoFrom(db) {
  const { rows } = await db.query("SELECT emp_no, start_date FROM employees WHERE emp_no ~ '[0-9]$'");
  return nextEmployeeNo(rows);
}

export const EMP_NO_RE = /^[A-Za-z0-9][A-Za-z0-9/_-]{0,19}$/;

/** The name of someone else who already has this ID, or null. */
export async function employeeNoOwner(db, no, ownEmail = "") {
  const { rows } = await db.query("SELECT name FROM employees WHERE lower(emp_no)=lower($1) AND lower(work_email) <> lower($2) LIMIT 1", [no, ownEmail]);
  return rows[0] ? rows[0].name : null;
}
