import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../data.jsx";
import { SectionHead } from "../components/ui.jsx";
import { byEmployeeNo, deptOf, isTop } from "../lib/people.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const initials = (name) => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/* The colour of a person's label: leadership, HR, someone with a team, or a team member. */
const roleOf = (p, hasTeam) => (isTop(p) ? "leader" : deptOf(p.title) === "HR" ? "hr" : hasTeam ? "lead" : "member");
const ROLE_NAME = { leader: "Leadership", hr: "HR", lead: "Manager / team lead", member: "Team member" };

/* Round avatar: the person's photo when they have one, their initials otherwise. */
function Face({ p }) {
  const [bad, setBad] = useState(false);
  return (
    <span className="org-av" style={{ background: p.color }}>
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
    .map(([d, list]) => ({ key: `g${d}`, kind: "group", label: d, sub: `${list.length} ${list.length === 1 ? "person" : "people"}, no manager set`, children: list.map((p) => person(p, true)), dashed: true }));
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

/* A person (or the company, or a group): avatar on top, then a label with the name band in the role colour and the
   designation underneath, like a printed org chart. `row` is the compact side-by-side form used in a stacked team. */
function Card({ n, hit, row = false }) {
  const cls = `vt-card${row ? " row" : ""}${hit ? " hit" : ""}`;
  if (n.kind === "person") {
    return (
      <Link className={cls} data-role={n.role} to={`/app/employees/${encodeURIComponent(n.p.email)}`} title={`${n.p.name}, ${n.p.title}`}>
        <Face p={n.p} />
        <span className="vt-label"><b>{n.p.name}</b><span>{n.p.title}</span></span>
      </Link>
    );
  }
  return (
    <div className={`${cls} ${n.kind}`} data-role={n.kind === "root" ? "root" : "group"}>
      <span className="org-av grp">{n.kind === "root" ? "W" : initials(n.label)}</span>
      <span className="vt-label"><b>{n.label}</b><span>{n.sub}</span></span>
    </div>
  );
}

const Toggle = ({ n, open, toggle }) => (
  <button type="button" className="ht-toggle" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} ${n.children.length} under ${n.p ? n.p.name : n.label}`}
    onClick={() => toggle(n.key)}>{open ? "−" : "+"} {n.children.length}</button>
);

/* The people under someone, one per line, joined to them by a rail and elbow lines. Anyone with a team of their own
   has it listed under them the same way, one step further in. */
function Rows({ list, open, toggle, hits }) {
  return (
    <ul className="vt-list">{list.map((c) => {
      const has = c.children.length > 0, isOpen = has && open.has(c.key);
      return (
        <li key={c.key} className={c.dashed ? "dsh" : ""}>
          <div className="vt-row"><Card n={c} hit={hits.has(c.key)} row />{has && <Toggle n={c} open={isOpen} toggle={toggle} />}</div>
          {isOpen && <Rows list={c.children} open={open} toggle={toggle} hits={hits} />}
        </li>
      );
    })}</ul>
  );
}

/* One branch under the company: the lead (or department) as a full card on the bus line, everyone under them
   branching downwards beneath it. */
export function Column({ n, open, toggle, hits }) {
  const has = n.children.length > 0, isOpen = has && open.has(n.key);
  // Deeper teams step further in on each level, so they get a wider share of the row.
  const depth = (x) => (x.children.length && open.has(x.key) ? 1 + Math.max(...x.children.map(depth)) : 0);
  return (
    <div style={{ flexGrow: 2 + depth(n) }} className={`vt-col${n.dashed || n.kind === "group" ? " dsh" : ""}${has ? " has" : ""}`}>
      <div className="vt-head"><Card n={n} hit={hits.has(n.key)} />{has && <Toggle n={n} open={isOpen} toggle={toggle} />}</div>
      {isOpen && <Rows list={n.children} open={open} toggle={toggle} hits={hits} />}
    </div>
  );
}

export default function OrgChart() {
  const { people } = useData();
  const tree = useMemo(() => (people ? buildTree(people) : null), [people]);
  const [q, setQ] = useState("");
  const [custom, setCustom] = useState(null);

  const allKeys = () => { const s = new Set(); const w = (n) => { if (n.children.length) s.add(n.key); n.children.forEach(w); }; w(tree); return s; };
  // Everyone starts open; the page only grows downwards.
  const base = useMemo(() => (tree ? allKeys() : new Set()), [tree]);
  const found = useMemo(() => (tree && q.trim() ? search(tree, lc(q)) : null), [tree, q]);
  const open = found ? new Set([...(custom || base), ...found.open]) : custom || base;
  const hits = found ? found.hits : new Set();
  // Bring the first search hit into view.
  const board = useRef(null);
  useEffect(() => { const hit = board.current && board.current.querySelector(".vt-card.hit"); if (hit) hit.scrollIntoView({ block: "center", behavior: "smooth" }); }, [q]);

  const toggle = (key) => { const s = new Set(open); s.has(key) ? s.delete(key) : s.add(key); setCustom(s); };

  if (!tree) return <section className="section"><div className="empty">Loading…</div></section>;
  return (
    <section className="section">
      <SectionHead eyebrow="People" title="Who reports" accent="to whom."
        sub="The whole company from the top down, built from the reporting managers set on the Employees page. Open or close a team with its + / − button, and click anyone to see their page."
        actions={<div className="org-tools">
          <input className="input" placeholder="Find a person or role" aria-label="Find in the chart" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className="btn glass sm" onClick={() => setCustom(allKeys())}>Expand all</button>
          <button type="button" className="btn glass sm" onClick={() => setCustom(new Set())}>Collapse all</button>
        </div>} />
      <div className="org-legend" aria-label="Key">
        {Object.entries(ROLE_NAME).map(([k, v]) => <span key={k}><i className={`r-${k}`} />{v}</span>)}
        <span><i className="dash" />No reporting manager set yet</span>
      </div>
      <div className="card vt-board org-bleed" ref={board}>
        <div className="vt-top"><Card n={tree} /></div>
        <div className="vt-cols">{tree.children.map((c) => <Column key={c.key} n={c} open={open} toggle={toggle} hits={hits} />)}</div>
      </div>
    </section>
  );
}
