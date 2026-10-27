/* What the app knows about each person, worked out the same way the older pages do it. */
export const NEW_FROM = "2026-09-15";   // joined on or after this date: onboarding is still open
export const AVATAR_COLORS = ["#4254d4", "#7d6ee8", "#0e7c86", "#b4472a", "#2f6f3e", "#9a3b72", "#555177", "#3242b2"];

export function deptOf(title) {
  const t = String(title || "").toLowerCase();
  if (/director|vice president/.test(t)) return "Leadership";
  if (/^hr\b/.test(t)) return "HR";
  if (/account|admin/.test(t) && !/network/.test(t)) return "Finance & Admin";
  if (/sales/.test(t)) return "Sales";
  if (/gen ?ai/.test(t)) return "Gen AI";
  if (/data/.test(t)) return "Data";
  if (/devops|network/.test(t)) return "DevOps & Cloud";
  return "Engineering";
}

/* Directors and the Vice President are at the top of the company: nobody is above them. */
export const isTop = (p) => /\b(director|vice president)\b/i.test(p.title || "");

export const TOOLS = { claude: { id: "claude", name: "Claude", sub: "Claude Team seat", mono: "Cl", color: "#c96442" } };
export const SHOWN_TOOLS = ["claude"];

export const STATUS = { onboarding: ["Onboarding", "info"], active: ["Active", "ok"], offboarding: ["Offboarding", "warn"], offboarded: ["Offboarded", "mute"] };

/** One person, built from the server's roster row, their tool access and any offboarding in progress. */
export function buildPerson(r, i, toolRows, offs) {
  const start = String(r.start || "").slice(0, 10), title = r.title || "—";
  let status = r.status === "offboarded" ? "offboarded" : start >= NEW_FROM ? "onboarding" : "active";
  const off = offs.get(String(r.email).toLowerCase());
  let lastDay = String(r.lastDay || "").slice(0, 10) || undefined;
  if (off) {
    lastDay = off.lastDay || lastDay;
    if (off.status === "in_progress" || off.status === "access_removed") status = "offboarding";
    if (off.status === "completed") status = "offboarded";
  }
  const grants = status === "offboarded" ? {} : { claude: "none" };
  const errors = {};
  for (const t of toolRows) if (String(t.email).toLowerCase() === String(r.email).toLowerCase()) { grants[t.tool] = t.status; if (t.status === "failed") errors[t.tool] = t.detail; }
  return {
    id: r.id, no: r.no || "Not assigned", name: r.name, email: r.email, start, title, dept: deptOf(title), manager: r.manager || "",
    lastDay, location: r.location || "", projects: r.projects || [], photoV: r.photoV || 0, status, grants, errors, color: AVATAR_COLORS[i % AVATAR_COLORS.length],
  };
}

export const mgrOf = (p) => (p.manager && p.manager !== "—" ? p.manager : "");
export const toolIds = (p) => Object.keys(p.grants || {}).filter((k) => SHOWN_TOOLS.includes(k));

/** Who is above this person, from the top of the company down to their manager. */
export function chainOf(p, people) {
  const out = [], seen = new Set([p.id]);
  let cur = p;
  for (let i = 0; i < 6; i++) {
    const m = mgrOf(cur);
    if (!m) break;
    const boss = people.find((x) => x.name === m && x.status !== "offboarded");
    if (!boss || seen.has(boss.id)) break;
    out.unshift(boss); seen.add(boss.id); cur = boss;
  }
  return out;
}

export const docCount = (docs, email) => docs.filter((d) => String(d.email).toLowerCase() === String(email).toLowerCase()).length;

/* Employee number order: WT/01, WT/02, WT/03, WT/17, ... compared as numbers, not text. Former employees go last. */
const numOf = (p) => { const m = String(p.no || "").match(/\d+/); return m ? parseInt(m[0], 10) : Infinity; };
export const byEmployeeNo = (a, b) =>
  (a.status === "offboarded") - (b.status === "offboarded") || numOf(a) - numOf(b) || String(a.no).localeCompare(String(b.no)) || a.name.localeCompare(b.name);

/** Everyone under a person: `direct` are the people who report to them, `team` is everyone below them at any depth.
 *  Found from the reporting managers (matched by name). Safe if the data ever contains a loop. */
export function teamUnder(people, email) {
  const lc = (x) => String(x || "").trim().toLowerCase();
  const active = (people || []).filter((p) => p.status !== "offboarded");
  const me = active.find((p) => lc(p.email) === lc(email));
  if (!me) return { direct: [], team: [] };
  const under = (name) => active.filter((p) => lc(p.manager) === lc(name) && p.id !== me.id);
  const direct = under(me.name).sort(byEmployeeNo), seen = new Set([me.id]), team = [];
  const walk = (list) => list.forEach((p) => { if (seen.has(p.id)) return; seen.add(p.id); team.push(p); walk(under(p.name).sort(byEmployeeNo)); });
  walk(direct);
  return { direct, team };
}
