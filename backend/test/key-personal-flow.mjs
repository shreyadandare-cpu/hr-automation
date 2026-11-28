/*
 * Personal details through a key or the Claude connector (decided 2026-11-28), end to end, against a LOCAL server and database:
 * everyone gets their own; someone else's only a salary owner (Kailash, Chintan, Chirag) gets, and only what the browser already
 * shows them. Compares what the browser session sees with what a key sees, for a salary owner and for a super admin who is not one.
 * Read-only. Cleans up its own sessions and keys.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/key-personal-flow.mjs
 */
import crypto from "node:crypto";
import pg from "pg";
import { salaryOwners } from "../src/access-rules.js";
import { PERSONAL_FIELDS } from "../src/access-keys-rules.js";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error("Refusing: BASE must be a local server."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const owners = salaryOwners();
const supers = (await db.query("SELECT lower(email) AS e FROM users WHERE is_super_admin AND NOT login_blocked ORDER BY 1")).rows.map((r) => r.e);
const owner = supers.find((e) => owners.includes(e)), plain = supers.find((e) => !owners.includes(e));
if (!owner || !plain) { console.error("Needs a super admin who is a salary owner and one who is not, in the local database."); process.exit(2); }

const made = { sessions: [], keys: [] };
const browserOf = async (email) => {
  const t = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at, created_at) VALUES ($1,$2, now() + interval '1 hour', now())", [sha(t), email]);
  made.sessions.push(sha(t));
  return { Cookie: `sid=${t}` };
};
const keyOf = async (email) => {
  const k = "wo1_" + crypto.randomBytes(32).toString("base64url").slice(0, 43);
  await db.query("INSERT INTO access_keys (email, name, key_hash, hint, expires_at) VALUES ($1,'Personal flow key',$2,$3, now() + interval '1 hour')", [email, sha(k), k.slice(0, 10)]);
  return { Authorization: `Bearer ${k}` };
};
const get = async (path, headers) => { const r = await fetch(BASE + path, { headers }); let d = null; try { d = await r.json(); } catch { /* not JSON */ } return { status: r.status, data: d }; };
const personalOf = (row) => Object.fromEntries(Object.entries(row || {}).filter(([k]) => PERSONAL_FIELDS.has(k)));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };

try {
  for (const [who, isOwner] of [[plain, false], [owner, true]]) {
    const label = isOwner ? "salary owner" : "not a salary owner";
    const browser = await browserOf(who), key = await keyOf(who);
    // The staff list: in the browser everyone's phone shows; through the key only your own, unless you are a salary owner.
    const [rb, rk] = await Promise.all([get("/api/roster", browser), get("/api/roster", key)]);
    // Compared by whether the field is there at all, so the check holds whether or not anyone has a phone on file locally.
    const others = rb.data.filter((p) => p.email.toLowerCase() !== who && "phone" in p);
    const mineB = rb.data.find((p) => p.email.toLowerCase() === who), mineK = rk.data.find((p) => p.email.toLowerCase() === who);
    check(JSON.stringify(personalOf(mineB)) === JSON.stringify(personalOf(mineK)), `${label}: your own row keeps its phone through the key`);
    const otherK = rk.data.filter((p) => others.some((o) => o.email === p.email));
    if (isOwner) check(others.length > 0 && otherK.length === others.length && otherK.every((p) => "phone" in p), `${label}: other people's phones come through (${others.length} people)`);
    else check(others.length > 0 && otherK.every((p) => !("phone" in p)), `${label}: other people's phones are left out (${others.length} people)`);
    // Your own profile: the same personal details as the browser, without ID numbers.
    const [pb, pk] = await Promise.all([get("/api/profile", browser), get("/api/profile", key)]);
    check(JSON.stringify(pb.data.contact || {}) === JSON.stringify(pk.data.contact || {}) && JSON.stringify(pb.data.primary || {}) === JSON.stringify(pk.data.primary || {}),
      `${label}: your own profile's contact and personal details are the same as in the browser`);
    check(!pk.data.ids || (!pk.data.ids.pan && !pk.data.ids.aadhaar), `${label}: but no PAN or Aadhaar`);
    // The joiners list: other people's phone, personal email, address and date of birth only for a salary owner.
    const [ob, ok] = await Promise.all([get("/api/onboarding", browser), get("/api/onboarding", key)]);
    const otherJoiners = (ok.data || []).filter((j) => j.email.toLowerCase() !== who);
    const hadAny = (ob.data || []).some((j) => j.email.toLowerCase() !== who && (j.phone || j.personalEmail || j.address || j.ids?.dob));
    const leaked = otherJoiners.some((j) => j.phone || j.personalEmail || j.address || j.ids?.dob);
    if (isOwner) check(!hadAny || leaked, `${label}: joiners' personal details come through`);
    else check(!leaked, `${label}: joiners' phone, personal email, address and date of birth are left out${hadAny ? "" : " (none on file locally)"}`);
    // ID cards: your own, or anyone's for a salary owner.
    const someone = others[0] && others[0].email;
    check((await get("/api/id-card.json", key)).status === 200, `${label}: your own ID card`);
    const otherCard = await get(`/api/id-card.json?email=${encodeURIComponent(someone)}`, key);
    check(isOwner ? otherCard.status === 200 : otherCard.status === 403, `${label}: someone else's ID card is ${isOwner ? "allowed" : "refused"}`);
    check((await get("/api/id-cards.pdf", key)).status === (isOwner ? 200 : 403), `${label}: everyone's ID cards ${isOwner ? "allowed" : "refused"}`);
    // Pay, ID numbers and bank details stay out for everyone, the salary owners included.
    const lv = await get("/api/leave", key);
    check((lv.data.pay || []).every((p) => p.monthlyGross == null), `${label}: no salary in leave data`);
  }
} finally {
  await db.query("DELETE FROM access_keys WHERE name='Personal flow key'");
  if (made.sessions.length) await db.query("DELETE FROM sessions WHERE token_hash = ANY($1)", [made.sessions]);
  await db.end();
}
console.log(failed ? `\n${failed} check(s) failed` : "\nAll personal-details checks passed");
process.exit(failed ? 1 : 0);
