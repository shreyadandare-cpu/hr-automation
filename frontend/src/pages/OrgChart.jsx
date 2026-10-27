import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../data.jsx";
import { SectionHead } from "../components/ui.jsx";
import { byEmployeeNo, deptOf, isTop } from "../lib/people.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const initials = (name) => (String(name || "?").match(/[A-Za-z0-9]+/g) || ["?"]).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/* The colour of a person's label: leadership, HR, someone with a team, or a team member. */
const roleOf = (p, hasTeam) => (isTop(p) ? "leader" : deptOf(p.title) === "HR" ? "hr" : hasTeam ? "lead" : "member");
const ROLE_NAME = { leader: "Leadership", hr: "HR", lead: "Manager / team lead", member: "Team member" };

/* Round avatar: the person's photo when they have one, their initials otherwise, on the colour of their role. */
function Face({ p, role }) {
  const [bad, setBad] = useState(false);
  return (
    <span className={`org-av r-${role}`}>
      {p.photoV && !bad ? <img src={`/api/profile/photo?email=${encodeURIComponent(p.email)}&v=${p.photoV}`} alt="" onError={() => setBad(true)} /> : initials(p.name)}
    </span>
  );
}

/* One tree: Company → leaders (and everyone who reports up to them) → department groups for people with no manager set yet. */
export function buildTree(people) {
  const active = people.filter((p) => p.status !== "offboarded");
  const byName = new Map(active.map((p) => [lc(p.name), p]));
  const kids = new Map(), tops = [];
  for (const p of active) {
    const m = p.manager ? byName.get(lc(p.manager)) : null;
    if (m && m.id !== p.id) kids.set(m.id, [...(kids.get(m.id) || []), p]); else tops.push(p);
  }
  const seen = new Set();
  const person = (p, dashed = false) => {
    seen.add(p.id);
    const list = (kids.get(p.id) || []).sort(byEmployeeNo).filter((c) => !seen.has(c.id));
    return { key: `p${p.id}`, kind: "person", p, dashed, children: list.map((c) => person(c)), role: roleOf(p, list.length > 0) };
  };
  tops.sort(byEmployeeNo);
  const leaders = tops.filter(isTop).map((p) => person(p));
  // People with no manager set are grouped by department, so the chart stays one tree without claiming who they report to.
  const groups = new Map();
  for (const p of tops.filter((p) => !isTop(p))) { const d = deptOf(p.title); groups.set(d, [...(groups.get(d) || []), p]); }
  const order = ["HR", "Engineering", "DevOps & Cloud", "Data", "Gen AI", "Sales", "Finance & Admin"];
  const groupNodes = [...groups.entries()].sort((a, b) => (order.indexOf(a[0]) + 99) % 99 - (order.indexOf(b[0]) + 99) % 99 || a[0].localeCompare(b[0]))
    .map(([d, list]) => ({ key: `g${d}`, kind: "group", label: d, sub: `${list.length} ${list.length === 1 ? "person" : "people"}`, children: list.map((p) => person(p, true)), dashed: true }));
  const rest = active.filter((p) => !seen.has(p.id)); // only if the data ever loops
  if (rest.length) groupNodes.push({ key: "g-other", kind: "group", label: "Other", sub: `${rest.length} not placed`, dashed: true, children: rest.map((p) => ({ key: `p${p.id}`, kind: "person", p, dashed: true, children: [], role: roleOf(p, false) })) });
  return { key: "root", kind: "root", label: "Wohlig Transformations", sub: `${active.length} people`, children: [...leaders, ...groupNodes] };
}

/* All the keys on the way down to anyone matching the search, so their branch opens by itself. */
function search(node, q, path = [], out = { hits: new Set(), open: new Set() }) {
  const own = node.p ? lc(`${node.p.name} ${node.p.title} ${node.p.no} ${node.p.location || ""}`).includes(q) : false;
  if (own) { out.hits.add(node.key); path.forEach((k) => out.open.add(k)); }
  node.children.forEach((c) => search(c, q, [...path, node.key], out));
  return out;
}

function Card({ n, hit }) {
  if (n.kind === "person") {
    return (
      <Link className={`ht-card${hit ? " hit" : ""}`} to={`/app/employees/${encodeURIComponent(n.p.email)}`} title={`${n.p.name}, ${n.p.title}`}>
        <Face p={n.p} role={n.role} />
        <span className="ht-txt"><b>{n.p.name}</b><span className={`org-role r-${n.role}`}>{n.p.title}</span></span>
      </Link>
    );
  }
  return (
    <div className={`ht-card ${n.kind === "root" ? "root" : "group"}`}>
      <span className="org-av grp" style={n.kind === "root" ? { background: "var(--purple)", color: "#fff", border: 0 } : undefined}>{n.kind === "root" ? "W" : initials(n.label)}</span>
      <span className="ht-txt"><b>{n.label}</b><small>{n.sub}</small></span>
    </div>
  );
}

export function Branch({ n, open, toggle, hits }) {
  const isOpen = open.has(n.key), has = n.children.length > 0;
  return (
    <li className={n.dashed ? "dsh" : ""}>
      <div className="ht-node">
        <Card n={n} hit={hits.has(n.key)} />
        {has && <button type="button" className="ht-toggle" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} ${n.children.length} under ${n.p ? n.p.name : n.label}`} onClick={() => toggle(n.key)}>{isOpen ? "−" : "+"} {n.children.length}</button>}
      </div>
      {has && isOpen && <ul className="ht-kids">{n.children.map((c) => <Branch key={c.key} n={c} open={open} toggle={toggle} hits={hits} />)}</ul>}
    </li>
  );
}

export default function OrgChart() {
  const { people } = useData();
  const tree = useMemo(() => (people ? buildTree(people) : null), [people]);
  const [q, setQ] = useState("");
  const [custom, setCustom] = useState(null);
  const box = useRef(null);
  const [centerTick, setCenterTick] = useState(0);   // bumped to scroll the company root back into the middle
  useEffect(() => {
    const el = box.current, root = el && el.querySelector(".ht-card.root");
    if (!el || !root) return;
    const r = root.getBoundingClientRect(), c = el.getBoundingClientRect();
    el.scrollLeft += (r.left + r.width / 2) - (c.left + c.width / 2);
  }, [centerTick, tree]);

  const base = useMemo(() => {
    if (!tree) return new Set();
    // Start with just the company and its first level showing. Open any branch with the + button, so the first screen is the whole picture.
    return new Set(["root"]);
  }, [tree]);
  const found = useMemo(() => (tree && q.trim() ? search(tree, lc(q)) : null), [tree, q]);
  const open = found ? new Set([...(custom || base), ...found.open]) : custom || base;
  const hits = found ? found.hits : new Set();

  const allKeys = () => { const s = new Set(); const w = (n) => { if (n.children.length) s.add(n.key); n.children.forEach(w); }; w(tree); return s; };
  const toggle = (key) => { const s = new Set(open); s.has(key) ? s.delete(key) : s.add(key); setCustom(s); };

  if (!tree) return <section className="section"><div className="empty">Loading…</div></section>;
  return (
    <section className="section">
      <SectionHead eyebrow="People" title="Who reports" accent="to whom."
        sub="One chart for the whole company, built from the reporting managers set on the Employees page. Open a branch with +, and click anyone to see their page."
        actions={<div className="org-tools">
          <input className="input" placeholder="Find a person or role" aria-label="Find in the chart" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className="btn glass sm" onClick={() => { setCustom(allKeys()); setCenterTick((t) => t + 1); }}>Expand all</button>
          <button type="button" className="btn glass sm" onClick={() => { setCustom(new Set(["root"])); setCenterTick((t) => t + 1); }}>Collapse all</button>
        </div>} />
      <div className="org-legend" aria-label="Key">
        {Object.entries(ROLE_NAME).map(([k, v]) => <span key={k}><i className={`r-${k}`} />{v}</span>)}
        <span><i className="dash" />No reporting manager set yet</span>
      </div>
      <div className="card"><div className="ht-scroll" ref={box}><div className="ht"><ul><Branch n={tree} open={open} toggle={toggle} hits={hits} /></ul></div></div></div>
    </section>
  );
}
