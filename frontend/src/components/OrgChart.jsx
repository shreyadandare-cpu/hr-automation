import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { initials } from "./ui.jsx";
import { isTop, mgrOf } from "../lib/people.js";

const lc = (s) => String(s || "").toLowerCase();

/* Who reports to whom, from the reporting manager HR sets on the Employees list. People whose manager is not a
   current employee start a branch of their own; anyone in a loop (A reports to B, B to A) is cut loose the same way. */
export function buildOrg(people) {
  const here = people.filter((p) => p.status !== "offboarded");
  const byName = new Map(here.map((p) => [lc(p.name), p]));
  const kids = new Map(here.map((p) => [p.id, []]));
  const parentOf = new Map();
  for (const p of here) {
    const boss = byName.get(lc(mgrOf(p)));
    if (boss && boss.id !== p.id && !isTop(p)) { parentOf.set(p.id, boss.id); kids.get(boss.id).push(p); }
  }
  const byNameSort = (a, b) => a.name.localeCompare(b.name);
  for (const list of kids.values()) list.sort(byNameSort);
  let roots = here.filter((p) => !parentOf.has(p.id));
  // Break loops: anyone not reachable from a root becomes a root.
  const seen = new Set(), walk = (p) => { if (seen.has(p.id)) return; seen.add(p.id); kids.get(p.id).forEach(walk); };
  roots.forEach(walk);
  for (const p of here) if (!seen.has(p.id)) { const boss = parentOf.get(p.id); kids.set(boss, kids.get(boss).filter((k) => k.id !== p.id)); parentOf.delete(p.id); roots.push(p); walk(p); }
  const count = (p) => kids.get(p.id).reduce((n, k) => n + 1 + count(k), 0);
  // The top of the company first (directors and VP, then whoever leads a team); people with no manager and no team wait apart.
  const leads = roots.filter((p) => isTop(p) || kids.get(p.id).length).sort((a, b) => (isTop(b) - isTop(a)) || count(b) - count(a) || byNameSort(a, b));
  const loose = roots.filter((p) => !leads.includes(p)).sort(byNameSort);
  return { leads, loose, kids, count, total: here.length };
}

function Face({ person, photoV }) {
  return (
    <span className="avatar" style={{ background: photoV ? "transparent" : person.color }}>
      {photoV ? <img src={`/api/profile/photo?email=${encodeURIComponent(person.email)}&v=${photoV}`} alt="" /> : initials(person.name)}
    </span>
  );
}

function Card({ person, photoV, me, reports, open, onToggle }) {
  const nav = useNavigate();
  const go = () => nav(`/app/employees/${encodeURIComponent(person.email)}`);
  return (
    <div className={`org-card${me ? " me" : ""}`}>
      <button type="button" className="org-main" onClick={go} title={`Open ${person.name}`}>
        <Face person={person} photoV={photoV} />
        <span className="org-txt"><b>{person.name}{me && <em> · You</em>}</b><span>{person.title}</span></span>
      </button>
      {reports > 0 && (
        <button type="button" className="org-toggle" aria-expanded={open} onClick={onToggle}
          aria-label={`${open ? "Hide" : "Show"} ${person.name}'s team`}>{open ? "−" : "+"} {reports}</button>
      )}
    </div>
  );
}

/* One person and, when open, the people under them. */
function Branch({ person, org, ctx }) {
  const team = org.kids.get(person.id);
  const open = !ctx.closed.has(person.id);
  const card = <Card person={person} photoV={ctx.photos[lc(person.email)]} me={lc(person.email) === ctx.me} reports={team.length}
    open={open} onToggle={() => ctx.toggle(person.id)} />;
  if (!team.length || !open) return <li>{card}</li>;
  // A team of individual contributors stacks in a column so the chart stays narrow.
  const allLeaves = team.length > 2 && team.every((k) => !org.kids.get(k.id).length);
  return (
    <li>
      {card}
      {allLeaves
        ? <div className="org-stack">{team.map((k) => <Card key={k.id} person={k} photoV={ctx.photos[lc(k.email)]} me={lc(k.email) === ctx.me} reports={0} />)}</div>
        : <ul>{team.map((k) => <Branch key={k.id} person={k} org={org} ctx={ctx} />)}</ul>}
    </li>
  );
}

export default function OrgChart({ people }) {
  const { user } = useAuth();
  const org = useMemo(() => buildOrg(people), [people]);
  const [photos, setPhotos] = useState({});
  const [closed, setClosed] = useState(() => new Set());
  useEffect(() => { api("GET", "/api/profile/photos").then((r) => r.ok && r.data && setPhotos(r.data)); }, []);
  const toggle = (id) => setClosed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const managers = [...org.kids.entries()].filter(([, k]) => k.length).map(([id]) => id);
  const ctx = { photos, closed, toggle, me: lc(user.email) };

  return (
    <div className="card org-bleed">
      <div className="card-h"><h3>Who reports to whom</h3>
        <div className="row" style={{ gap: 8 }}>
          <span className="muted">{org.total} people · {managers.length} managers</span>
          <button type="button" className="btn glass sm" onClick={() => setClosed(new Set())}>Expand all</button>
          <button type="button" className="btn glass sm" onClick={() => setClosed(new Set(managers))}>Collapse all</button>
        </div>
      </div>
      <div className="org" tabIndex={0} aria-label="Organisation chart">
        <ul>
          <li>
            <div className="org-card org-root"><span className="org-txt"><span className="org-logo"><img className="lg lg-light" src="/wohlig-logo.png" alt="Wohlig" /><img className="lg lg-dark" src="/wohlig-logo-dark.png" alt="" /></span>
              <span>Transformations · {org.total} people</span></span></div>
            {org.leads.length > 0 && <ul>{org.leads.map((p) => <Branch key={p.id} person={p} org={org} ctx={ctx} />)}</ul>}
          </li>
        </ul>
      </div>
      {org.loose.length > 0 && (
        <div className="org-loose">
          <div className="muted">No reporting manager set yet ({org.loose.length}). HR can set one in the list view.</div>
          <div className="org-loose-row">{org.loose.map((p) => <Card key={p.id} person={p} photoV={photos[lc(p.email)]} me={lc(p.email) === ctx.me} reports={0} />)}</div>
        </div>
      )}
    </div>
  );
}
