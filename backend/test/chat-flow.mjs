/*
 * Slack and Teams channels, end to end, against a LOCAL server and database (never the shared one): who may manage them,
 * webhook links checked against the real Slack and Teams hosts (never an internal address), the link never sent back,
 * a test message and real news (an announcement, praise) recorded as not sent because the server is local.
 *
 *   DATABASE_URL=postgresql://localhost:5432/hrhub_local BASE=http://localhost:3100 node test/chat-flow.mjs
 *
 * Not part of `npm test`. Nothing is posted to any real channel (a local server never sends). The test people, posts and
 * channels are clearly named and removed afterwards.
 */
import crypto from "node:crypto";
import pg from "pg";

const DB = process.env.DATABASE_URL || "", BASE = process.env.BASE || "http://localhost:3100";
if (!/(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("Refusing: DATABASE_URL must be a local database."); process.exit(2); }
const db = new pg.Pool({ connectionString: DB });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const HR = "test.chat.hr@wohlig.com", EMP = "test.chat.employee@wohlig.com", PEER = "test.chat.peer@wohlig.com", ALL = [HR, EMP, PEER];
const HOOK = "https://hooks.slack.com/services/TTEST0000/BTEST0000/testsecretabcd";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function login(email, perms = []) {
  await db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,'x','employee') ON CONFLICT DO NOTHING", [email]);
  for (const p of perms) await db.query("INSERT INTO access_grants (email, permission, scope, granted_by, note) VALUES ($1,$2,'company','test','flow-test')", [email, p]);
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [sha(token), email]);
  return token;
}
const call = async (token, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `sid=${token}`, origin: BASE, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const raw = await r.text();
  let data = null; try { data = JSON.parse(raw); } catch { /* not JSON */ }
  return { status: r.status, data, raw };
};
const clean = async () => {
  await db.query("DELETE FROM chat_channels WHERE name LIKE '#test-chat-%'");
  await db.query("DELETE FROM praises WHERE lower(from_email)=ANY($1) OR lower(to_email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM posts WHERE lower(author_email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM employees WHERE lower(work_email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM access_grants WHERE lower(email)=ANY($1) AND note='flow-test'", [ALL]);
  await db.query("DELETE FROM notifications WHERE lower(recipient)=ANY($1)", [ALL]);
  await db.query("DELETE FROM audit_log WHERE lower(work_email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM sessions WHERE lower(email)=ANY($1)", [ALL]);
  await db.query("DELETE FROM users WHERE lower(email)=ANY($1)", [ALL]);
};
try {
  await clean();
  await db.query("INSERT INTO employees (work_email, name, start_date, status) VALUES ($1,'Test Chat HR','2020-01-01','active'),($2,'Test Chat Employee','2020-01-01','active'),($3,'Test Chat Peer','2020-01-01','active')", ALL);
  const hr = await login(HR, ["engage.manage"]), emp = await login(EMP);

  ok("no access: an employee cannot see the channels", (await call(emp, "GET", "/api/chat-channels")).status === 403);
  ok("no access: an employee cannot add a channel", (await call(emp, "POST", "/api/chat-channels", { kind: "slack", name: "#test-chat-x", url: HOOK, events: ["praise"] })).status === 403);
  let r = await call(hr, "POST", "/api/chat-channels", {});
  ok("empty form: every missing answer is named", r.status === 400 && ["kind", "name", "url", "events"].every((k) => r.data.errors[k]), JSON.stringify(r.data));
  for (const bad of ["http://169.254.169.254/latest/meta-data", "https://localhost:3100/api/me", "https://hooks.slack.com.evil.example/services/a", "http://hooks.slack.com/services/a/b/c"]) {
    r = await call(hr, "POST", "/api/chat-channels", { kind: "slack", name: "#test-chat-bad", url: bad, events: ["praise"] });
    ok(`link refused: ${bad}`, r.status === 400 && !!r.data.errors.url);
  }
  r = await call(hr, "POST", "/api/chat-channels", { kind: "slack", name: "#test-chat-general", url: HOOK, events: ["announcements", "praise"] });
  ok("channel added", r.status === 201, JSON.stringify(r));
  const id = r.data.id;
  const stored = (await db.query("SELECT url_sealed FROM chat_channels WHERE id=$1", [id])).rows[0].url_sealed;
  ok("the link is stored encrypted, not as written", stored.startsWith("v1:") && !stored.includes("testsecret"));
  let g = await call(hr, "GET", "/api/chat-channels");
  ok("the link is never sent back, only its end", !g.raw.includes("testsecret") && g.data.channels.find((c) => c.id === id).link === "hooks.slack.com …abcd", g.raw.slice(0, 300));
  ok("the page is told this server never sends", g.data.sendsForReal === false);

  r = await call(hr, "POST", `/api/chat-channels/${id}/test`);
  ok("test message: recorded as not sent on a local server", r.status === 200 && r.data.status === "skipped", JSON.stringify(r.data));

  ok("announcement made", (await call(hr, "POST", "/api/posts", { title: "Test chat announcement", body: "Office closed on Friday for the test." })).status === 201);
  ok("praise given", (await call(emp, "POST", "/api/praise", { to: PEER, message: "Thank you for the test help.", badge: "thanks" })).status === 201);
  await wait(800);
  const out = (await db.query("SELECT event, title, status FROM chat_outbox WHERE channel_id=$1 ORDER BY id", [id])).rows;
  ok("the announcement went to the channel (recorded, not sent)", out.some((x) => x.event === "announcements" && x.title === "Test chat announcement" && x.status === "skipped"), JSON.stringify(out));
  ok("the praise went to the channel with both names", out.some((x) => x.event === "praise" && x.title === "Test Chat Employee praised Test Chat Peer"), JSON.stringify(out));

  r = await call(hr, "PUT", `/api/chat-channels/${id}`, { kind: "slack", name: "#test-chat-general", url: "", events: ["openings"], enabled: false });
  ok("edit: an empty link keeps the saved one", r.status === 200 && (await db.query("SELECT url_sealed FROM chat_channels WHERE id=$1", [id])).rows[0].url_sealed === stored);
  r = await call(hr, "PUT", `/api/chat-channels/${id}`, { kind: "teams", name: "#test-chat-general", url: "", events: ["openings"] });
  ok("edit: switching to Teams needs the new link", r.status === 400 && !!r.data.errors.url);
  ok("edit: an unknown channel gives 404", (await call(hr, "PUT", "/api/chat-channels/999999", { kind: "slack", name: "#test-chat-x", events: ["praise"] })).status === 404);
  ok("paused: a paused channel gets nothing", (await call(hr, "POST", "/api/posts", { title: "Test chat second", body: "Second." })).status === 201
    && (await wait(500), (await db.query("SELECT 1 FROM chat_outbox WHERE channel_id=$1 AND title='Test chat second'", [id])).rowCount === 0));
  ok("removed", (await call(hr, "DELETE", `/api/chat-channels/${id}`)).status === 200);
  ok("removed: the saved link is wiped", (await db.query("SELECT url_sealed FROM chat_channels WHERE id=$1", [id])).rows[0].url_sealed === "");
  ok("removed: twice gives 404", (await call(hr, "DELETE", `/api/chat-channels/${id}`)).status === 404);
} catch (err) { fail++; console.error("FAIL  the test stopped:", err.message); } finally {
  await clean();
  await db.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
