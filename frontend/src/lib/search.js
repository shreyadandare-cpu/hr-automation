/* Search that finds people by name, email, role or employee ID. The employee ID may be typed without its slash or spaces ("203", "WT203", "wt 203" all find WT/203):
   the search text is compared as typed, and again with everything but letters and digits taken out of both sides. */
const plain = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function matches(query, ...fields) {
  const t = String(query || "").trim().toLowerCase();
  if (!t) return true;
  const hay = fields.map((f) => String(f || "")).join(" ").toLowerCase();
  if (hay.includes(t)) return true;
  const p = plain(t);
  return p.length > 0 && plain(hay).includes(p);
}
