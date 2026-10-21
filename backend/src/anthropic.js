import { pool } from "./db.js";

/* Claude access through Anthropic's Admin API: invite someone to the organization, or remove them.
   Needs an Admin API key (starts with sk-ant-admin) in ANTHROPIC_ADMIN_KEY. Without it, calls are simulated so
   the screens can still be tried, and every result says so. */
const API = (process.env.ANTHROPIC_API_URL || "https://api.anthropic.com") + "/v1/organizations";   // the override is for testing against a local stand-in
export const claudeMode = () => (process.env.ANTHROPIC_ADMIN_KEY ? "live" : "simulated");

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { "x-api-key": process.env.ANTHROPIC_ADMIN_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error && data.error.message) || `Anthropic returned ${res.status}`);
  return data;
}

/** All pages of a list endpoint. */
async function listAll(path) {
  const out = [];
  let after = null;
  for (let i = 0; i < 20; i++) {
    const page = await call("GET", `${path}?limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ""}`);
    out.push(...(page.data || []));
    if (!page.has_more) break;
    after = page.last_id;
  }
  return out;
}
const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

/** "member", "invited" or "none" for this email, read from Anthropic. */
export async function claudeStatus(email) {
  if (claudeMode() === "simulated") return null;
  if ((await listAll("/users")).some((u) => same(u.email, email))) return "member";
  if ((await listAll("/invites")).some((i) => same(i.email, email) && i.status === "pending")) return "invited";
  return "none";
}

/** Invites the person. Returns { status: "active" | "invited", detail }. Throws a readable Error on failure. */
export async function grantClaude(email) {
  if (claudeMode() === "simulated") return { status: "invited", detail: "Invite recorded (simulated: ANTHROPIC_ADMIN_KEY is not set)" };
  const now = await claudeStatus(email);
  if (now === "member") return { status: "active", detail: "Already a member of the Claude organization" };
  if (now === "invited") return { status: "invited", detail: "An invite is already waiting for them to accept" };
  await call("POST", "/invites", { email, role: process.env.ANTHROPIC_INVITE_ROLE || "user" });
  return { status: "invited", detail: "Invite sent from the Claude organization. Access starts when they accept" };
}

/** Removes the person from the organization and cancels any pending invite. */
export async function removeClaude(email) {
  if (claudeMode() === "simulated") return "Removed from the Claude organization (simulated: ANTHROPIC_ADMIN_KEY is not set)";
  const parts = [];
  const user = (await listAll("/users")).find((u) => same(u.email, email));
  if (user) { await call("DELETE", `/users/${encodeURIComponent(user.id)}`); parts.push("removed from the Claude organization"); }
  for (const inv of (await listAll("/invites")).filter((i) => same(i.email, email) && i.status === "pending")) {
    await call("DELETE", `/invites/${encodeURIComponent(inv.id)}`); parts.push("pending invite cancelled");
  }
  return parts.length ? parts.join(", ").replace(/^./, (c) => c.toUpperCase()) : "Was not in the Claude organization";
}

/** What HR last did for each person and tool, so the Employees page survives a reload. */
export const recordAccess = (email, tool, status, detail) => pool.query(
  `INSERT INTO tool_access (work_email, tool, status, detail, updated_at) VALUES (lower($1),$2,$3,$4,now())
   ON CONFLICT (work_email, tool) DO UPDATE SET status=$3, detail=$4, updated_at=now()`, [email, tool, status, detail || null]);
