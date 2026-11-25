import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DropdownMenu } from "radix-ui";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import Modal, { Field } from "./Modal.jsx";
import PeoplePicker from "./PeoplePicker.jsx";
import { useToast } from "./toast.jsx";
import { initials } from "./ui.jsx";
import { deptOf, isTop, mgrOf } from "../lib/people.js";
import { BRAND } from "../brand.js";
import { scopeSet } from "../lib/useLeave.js";

const lc = (s) => String(s || "").toLowerCase();
const byName = (a, b) => a.name.localeCompare(b.name);
/* Departments in the order people expect to read them; anything else after, by size. */
const DEPT_ORDER = ["Leadership", "Engineering", "DevOps & Cloud", "Gen AI", "Data", "Sales", "Finance & Admin", "HR"];

/* Who reports to whom, from the reporting manager HR sets for each person. People whose manager is not a current employee
   start a branch of their own; anyone in a loop (A reports to B, B to A) is cut loose the same way. Those branch tops are
   then grouped under their department, so everyone sits in the tree even before every manager is set. */
export function buildOrg(people) {
  const here = people.filter((p) => p.status !== "offboarded");
  const named = new Map(here.map((p) => [lc(p.name), p]));
  const kids = new Map(here.map((p) => [p.id, []]));
  const parentOf = new Map();
  for (const p of here) {
    const boss = named.get(lc(mgrOf(p)));
    // Someone at the top (director, VP) hangs under another top person only, such as the CEO.
    if (boss && boss.id !== p.id && (!isTop(p) || isTop(boss))) { parentOf.set(p.id, boss.id); kids.get(boss.id).push(p); }
  }
  for (const list of kids.values()) list.sort(byName);
  const roots = here.filter((p) => !parentOf.has(p.id));
  const seen = new Set(), walk = (p) => { if (seen.has(p.id)) return; seen.add(p.id); kids.get(p.id).forEach(walk); };
  roots.forEach(walk);
  for (const p of here) if (!seen.has(p.id)) { const boss = parentOf.get(p.id); kids.set(boss, kids.get(boss).filter((k) => k.id !== p.id)); parentOf.delete(p.id); roots.push(p); walk(p); }
  const count = (p) => kids.get(p.id).reduce((n, k) => n + 1 + count(k), 0);
  // Only the top of the company starts a branch from the company card (the CEO, or the directors and VP when no one
  // is set above them). Everyone else with no manager, team leads included, waits in one branch of its own, grouped by
  // department, until HR sets their manager.
  const leads = roots.filter((p) => isTop(p)).sort((a, b) => count(b) - count(a) || byName(a, b));
  const loose = roots.filter((p) => !leads.includes(p));
  const groups = new Map();
  for (const p of loose) { const d = p.dept || deptOf(p.title); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(p); }
  const rank = (d) => { const i = DEPT_ORDER.indexOf(d); return i < 0 ? DEPT_ORDER.length : i; };
  const depts = [...groups.entries()].map(([name, list]) => ({ name, list: list.sort(byName) }))
    .sort((a, b) => rank(a.name) - rank(b.name) || b.list.length - a.list.length || a.name.localeCompare(b.name));
  const managers = here.filter((p) => kids.get(p.id).length).length;
  return { leads, depts, loose: loose.length, kids, parentOf, count, total: here.length, managers, here };
}

function Face({ person, photoV, small }) {
  return (
    <span className={`avatar ${small ? "size-9! text-[13px]!" : ""}`} style={{ background: photoV ? "transparent" : person.color }}>
      {photoV ? <img src={`/api/profile/photo?email=${encodeURIComponent(person.email)}&v=${photoV}`} alt="" loading="lazy" decoding="async" /> : initials(person.name)}
    </span>
  );
}

/* HR's menu on a card: set or clear the reporting manager. */
function CardMenu({ person, onSet }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="absolute top-1.5 right-1.5 grid size-8 cursor-pointer place-items-center gap-0 rounded-full border-0 bg-transparent p-0 text-ink-faint hover:bg-tint hover:text-ink in-[.bg-maroon\!]:text-beige focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={`Actions for ${person.name}`}>⋯</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="row-menu" align="end" sideOffset={6} collisionPadding={8}>
          <DropdownMenu.Item className="row-menu-i" onSelect={() => onSet(person)}>{mgrOf(person) ? "Change reporting manager" : "Set reporting manager"}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Card({ person, ctx, reports = 0, open, onToggle, row = false }) {
  const nav = useNavigate();
  const me = lc(person.email) === ctx.me, hit = ctx.focus === person.id;
  const go = () => nav(`/app/employees/${encodeURIComponent(person.email)}`);
  const menu = ctx.mayEdit(person) ? <CardMenu person={person} onSet={ctx.setFor} /> : null;
  if (row) return (
    <div data-org={person.id} className={`relative flex min-h-[60px] items-center gap-2.5 rounded-card bg-surface py-2.5 pr-9 pl-3 shadow-[inset_0_0_0_1px_var(--line)] ${me ? "shadow-[inset_0_0_0_2px_var(--purple)]!" : ""} ${hit ? "outline-2 outline-offset-2 outline-orange" : ""}`}>
      <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left text-inherit [font:inherit] hover:[&_b]:text-accent focus-visible:rounded-[10px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent" onClick={go}>
        <Face person={person} photoV={ctx.photos[lc(person.email)]} small />
        <span className="flex min-w-0 flex-col gap-0.5"><b className="truncate font-display text-[15px] leading-tight font-medium text-ink">{person.name}{me && <em className="font-body text-[13px] font-bold text-accent not-italic"> · You</em>}</b><span className="line-clamp-2 text-[13px] leading-snug text-ink-faint">{person.title}</span></span>
      </button>
      {menu}
    </div>
  );
  // A wide card: photo, then the name in Fraunces, job title and department. The top of the company (MD, director, VP
  // with no one above them) sits on deep maroon, the one strong colour on the chart; anyone who leads a team carries a
  // thin accent line along the top of their card.
  const top = isTop(person) && !mgrOf(person);
  const lead = reports > 0 && !top;
  return (
    <div data-org={person.id} className={`org-card w-[256px]! items-stretch! gap-2.5! px-4! pt-3.5! pb-3! pr-9! text-left ${me ? "me" : ""}
      ${top ? "bg-maroon! shadow-[0_10px_24px_-12px_rgba(128,13,53,.55)]! [&_.org-main_b]:text-ivory! [&_.org-main_span]:text-beige!" : ""}
      ${lead ? "shadow-[inset_0_3px_0_var(--purple),inset_0_0_0_1px_var(--line),0_6px_18px_rgba(31,6,16,.06)]!" : ""}
      ${hit ? "outline-2 outline-offset-2 outline-orange" : ""}`}>
      <button type="button" className="org-main flex-row! items-center! gap-3! text-left!" onClick={go} title={`Open ${person.name}`}>
        <Face person={person} photoV={ctx.photos[lc(person.email)]} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <b className="truncate font-display text-[16.5px] leading-tight font-medium tracking-[-0.01em] text-ink">{person.name}{me && <em className="font-body text-[13px] font-bold text-accent not-italic"> · You</em>}</b>
          <span className="line-clamp-2 text-[13.5px] leading-snug text-ink-dim">{person.title}</span>
          {person.dept && <span className="truncate text-[13px] leading-snug text-ink-faint">{person.dept}</span>}
        </span>
      </button>
      {reports > 0 && (
        <button type="button" className={`org-toggle self-start! ml-[60px] inline-flex! items-center gap-1.5 rounded-full! px-3! py-1! text-[13px]! leading-none font-bold! ${top ? "bg-[rgba(255,247,233,.14)]! text-ivory!" : "bg-tint! text-accent!"}`}
          aria-expanded={open} onClick={onToggle} aria-label={`${open ? "Hide" : "Show"} ${person.name}'s team`}>
          {reports} in team<svg viewBox="0 0 12 8" width="10" height="7" aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      {menu}
    </div>
  );
}

/* People with nobody under them, as a compact grid (one column for a few, up to three for many). */
function Grid({ list, ctx, joined = false }) {   // joined: it is already a branch of the tree, so no line of its own
  const cols = list.length > 12 ? "grid-cols-3 max-xl:grid-cols-2 max-sm:grid-cols-1" : list.length > 5 ? "grid-cols-2 max-sm:grid-cols-1" : "grid-cols-1";
  const line = joined ? "" : "mt-[22px] before:absolute before:-top-[22px] before:left-1/2 before:h-[22px] before:border-l-2 before:border-line-2 before:content-['']";
  return <div className={`relative grid w-max max-w-[min(660px,92vw)] gap-2.5 ${cols} [&>div]:w-[210px] ${line}`}>
    {list.map((p) => <Card key={p.id} person={p} ctx={ctx} row />)}</div>;
}

/* One person and, when open, the people under them. */
function Branch({ person, org, ctx }) {
  const team = org.kids.get(person.id);
  const open = !ctx.closed.has(person.id);
  const card = <Card person={person} ctx={ctx} reports={team.length} open={open} onToggle={() => ctx.toggle(person.id)} />;
  if (!team.length || !open) return <li>{card}</li>;
  const leaves = team.filter((k) => !org.kids.get(k.id).length), leads = team.filter((k) => org.kids.get(k.id).length);
  // A team of individual contributors sits in a grid so the chart stays compact.
  if (!leads.length && team.length > 2) return <li>{card}<Grid list={leaves} ctx={ctx} /></li>;
  // Team leads each get a branch; everyone else under this person sits together in one grid beside them.
  if (leaves.length > 1) return <li>{card}<ul>{leads.map((k) => <Branch key={k.id} person={k} org={org} ctx={ctx} />)}<li><Grid list={leaves} ctx={ctx} joined /></li></ul></li>;
  return <li>{card}<ul>{team.map((k) => <Branch key={k.id} person={k} org={org} ctx={ctx} />)}</ul></li>;
}

/* People with no reporting manager yet, under the company card by department until HR sets one (HR sees a banner to fix it). */
function Dept({ d, ctx }) {
  const key = `dept:${d.name}`, open = !ctx.closed.has(key);
  return (
    <li>
      <div className="org-card w-[148px]! gap-1! px-2!">
        <b className="text-center font-display text-[15px] leading-tight font-medium text-ink">{d.name}</b>
        <span className="text-[13px] text-ink-dim">{d.list.length} {d.list.length === 1 ? "person" : "people"}</span>
        <button type="button" className="org-toggle mt-1" aria-expanded={open} onClick={() => ctx.toggle(key)} aria-label={`${open ? "Hide" : "Show"} ${d.name}`}>{open ? "− Hide" : "+ Show"}</button>
        {ctx.canEdit && d.list.length > 1 && open && <button type="button" className="btn link nolink mt-0.5 min-h-0! text-[13px]!" onClick={() => ctx.setForDept(d)}>Set one manager for all</button>}
      </div>
      {open && (() => {
        const heads = d.list.filter((p) => ctx.org.kids.get(p.id).length), rest = d.list.filter((p) => !heads.includes(p));
        if (!heads.length) return <Grid list={rest} ctx={ctx} />;
        return <ul>{heads.map((p) => <Branch key={p.id} person={p} org={ctx.org} ctx={ctx} />)}{rest.length > 0 && <li><Grid list={rest} ctx={ctx} joined /></li>}</ul>;
      })()}
    </li>
  );
}

const ZOOMS = [0.5, 0.65, 0.8, 1];

/* Find a person: type a name, pick them, and the chart opens their branch and shows them. */
function Finder({ org, onPick }) {
  const [q, setQ] = useState(""), [open, setOpen] = useState(false);
  const t = q.trim().toLowerCase();
  const hits = t ? org.here.filter((p) => `${p.name} ${p.title} ${p.no || ""}`.toLowerCase().includes(t)).sort(byName).slice(0, 6) : [];
  const pick = (p) => { setQ(""); setOpen(false); onPick(p); };
  return (
    <div className="relative min-w-0 flex-1 basis-[220px] max-w-[320px]">
      <label className="sr-only" htmlFor="org-find">Find a person in the chart</label>
      <input id="org-find" type="search" className="input pl-[42px]! [background-image:var(--search-ic)]! [background-position:14px_center]! [background-repeat:no-repeat]! [background-size:18px]!" placeholder="Find a person" autoComplete="off" value={q} role="combobox" aria-expanded={open && hits.length > 0} aria-controls="org-find-list"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) { e.preventDefault(); pick(hits[0]); } if (e.key === "Escape") setOpen(false); }} />
      {open && hits.length > 0 && (
        <ul id="org-find-list" role="listbox" className="absolute top-full right-0 left-0 z-20 m-0 mt-1 list-none rounded-field bg-surface p-1.5 shadow-dialog">
          {hits.map((p) => (
            <li key={p.id} role="option" aria-selected="false" className="flex min-h-11 cursor-pointer flex-col justify-center rounded-[10px] px-3 py-1.5 hover:bg-tint" onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
              <b className="text-[14px] font-bold">{p.name}</b><span className="text-[13px] text-ink-faint">{p.title}</span></li>))}
        </ul>)}
    </div>
  );
}

export default function OrgChart({ people }) {
  const auth = useAuth(), { user, can, canAll } = auth;
  // people.edit sets reporting managers: for anyone with it for the whole company, or for the people in its teams.
  const editsAll = canAll("people.edit");
  const editScope = can("people.edit") ? scopeSet(auth, "people.edit", people) : new Set();
  const { reload } = useData();
  const toast = useToast();
  const org = useMemo(() => buildOrg(people), [people]);
  const [photos, setPhotos] = useState({});
  // The departments of people with no manager start closed, so the first view is the reporting lines.
  const deptKeys = org.depts.map((d) => `dept:${d.name}`);
  const [closed, setClosed] = useState(() => new Set(deptKeys));
  const [setting, setSetting] = useState(null), [focus, setFocus] = useState(null), [bulk, setBulk] = useState(false);
  const [zoom, setZoom] = useState(() => (window.matchMedia("(max-width: 720px)").matches ? 0.65 : 1));   // phones start zoomed out
  useEffect(() => { api("GET", "/api/profile/photos").then((r) => r.ok && r.data && setPhotos(r.data)); }, []);
  const toggle = (id) => setClosed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const leaders = [...org.kids.entries()].filter(([, k]) => k.length).map(([id]) => id);
  // The tree is wider than the screen: open it with the company card in the middle, not at the left edge.
  const box = useRef(null);
  useEffect(() => { const el = box.current; if (el && !focus) el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2); }, [org.leads.length, zoom]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Find: open every branch above the person, then bring their card into view.
  const show = (p) => {
    const open = new Set(closed);
    for (let at = org.parentOf.get(p.id), i = 0; at && i < 60; at = org.parentOf.get(at), i++) open.delete(at);
    if (!org.parentOf.has(p.id) && !org.leads.includes(p)) { open.delete("loose"); open.delete(`dept:${p.dept || deptOf(p.title)}`); }
    setClosed(open); setFocus(p.id);
  };
  useEffect(() => {
    if (!focus) return;
    const el = box.current && box.current.querySelector(`[data-org="${focus}"]`);
    if (el) el.scrollIntoView({ block: "center", inline: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    const t = setTimeout(() => setFocus(null), 4000);
    return () => clearTimeout(t);
  }, [focus, closed]);
  const ctx = { org, photos, closed, toggle, focus, me: lc(user.email), canEdit: editsAll, mayEdit: (p) => !editScope || editScope.has(lc(p.email)), setFor: (p) => setSetting({ people: [p] }), setForDept: (d) => setSetting({ people: d.list, dept: d.name }) };
  const zi = ZOOMS.indexOf(zoom);
  // The people this person may fix who still have no reporting manager (only the top of the company may have none).
  const missing = (can("people.edit") ? org.here.filter((p) => !isTop(p) && !org.parentOf.has(p.id) && ctx.mayEdit(p)) : []).sort(byName);

  return (
    <div className="card org-bleed">
      <div className="card-h flex-wrap gap-3"><h3>Who reports to whom</h3>
        <span className="muted">{org.total} people · {org.managers} {org.managers === 1 ? "manager" : "managers"}</span>
      </div>
      {missing.length > 0 && <div className="mx-6 mb-3 flex flex-wrap items-center gap-3 rounded-field bg-tint px-4 py-3 max-sm:mx-4" role="status">
        <p className="m-0 min-w-0 flex-1 basis-[260px] text-[14px] text-ink">
          <b>{missing.length} {missing.length === 1 ? "person has" : "people have"} no reporting manager.</b>{" "}
          <span className="text-ink-dim">Everyone except directors, the Vice President and the CEO needs one: their manager approves leave and timesheets. Until one is set, a super admin approves their leave.</span></p>
        <button type="button" className="btn primary sm" onClick={() => setBulk(true)}>Assign managers</button>
      </div>}
      <div className="flex flex-wrap items-center gap-2 px-6 pb-3 max-sm:px-4">
        <Finder org={org} onPick={show} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn glass sm" onClick={() => { const el = box.current; if (el) { el.scrollTo({ left: Math.max(0, (el.scrollWidth - el.clientWidth) / 2), top: 0 }); el.closest(".card")?.scrollIntoView({ block: "start" }); } }}>Back to the top</button>
          {org.here.some((p) => lc(p.email) === lc(user.email)) && <button type="button" className="btn glass sm" onClick={() => show(org.here.find((p) => lc(p.email) === lc(user.email)))}>Find me</button>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 max-sm:ml-0">
          <div className="flex items-center gap-1 rounded-full p-1 shadow-[inset_0_0_0_1px_var(--line)]" role="group" aria-label="Zoom">
            <button type="button" className="grid size-9 cursor-pointer place-items-center gap-0 rounded-full border-0 bg-transparent p-0 text-[18px] text-ink hover:bg-tint disabled:cursor-default disabled:opacity-40" onClick={() => setZoom(ZOOMS[zi - 1])} disabled={zi <= 0} aria-label="Zoom out">−</button>
            <span className="num-cell w-12 text-center text-[13px] font-bold text-ink-dim" aria-live="polite">{Math.round(zoom * 100)}%</span>
            <button type="button" className="grid size-9 cursor-pointer place-items-center gap-0 rounded-full border-0 bg-transparent p-0 text-[18px] text-ink hover:bg-tint disabled:cursor-default disabled:opacity-40" onClick={() => setZoom(ZOOMS[zi + 1])} disabled={zi >= ZOOMS.length - 1} aria-label="Zoom in">+</button>
          </div>
          <button type="button" className="btn glass sm" onClick={() => setClosed(new Set())}>Expand all</button>
          <button type="button" className="btn glass sm" onClick={() => setClosed(new Set([...deptKeys, "loose", ...leaders]))}>Collapse all</button>
        </div>
      </div>
      <div className="org" ref={box} tabIndex={0} aria-label="Organisation chart">
          <ul style={{ zoom }}>
            <li>
              <div className="org-card org-root"><span className="org-txt"><span className="org-logo"><img className="lg lg-light" src={BRAND.logos.light} alt={BRAND.company.name} /><img className="lg lg-dark" src={BRAND.logos.dark} alt="" /></span>
                <span>{org.total} people</span></span></div>
              {(org.leads.length > 0 || org.depts.length > 0) && <ul>{org.leads.map((p) => <Branch key={p.id} person={p} org={org} ctx={ctx} />)}{org.depts.map((d) => <Dept key={d.name} d={d} ctx={ctx} />)}</ul>}
            </li>
          </ul>
      </div>
      {bulk && <AssignManagers list={missing} people={people} onClose={() => setBulk(false)} onDone={(n) => { setBulk(false); if (n) toast(`${n === 1 ? "1 person now has" : `${n} people now have`} a reporting manager.`); reload(); }} />}
      {setting && <SetManager set={setting} people={people} onClose={() => setSetting(null)} onDone={(n, name) => { setSetting(null); toast(name ? `${n === 1 ? "The reporting manager is" : `${n} people now report to`} ${name}.` : "The reporting manager was cleared."); reload(); }} toastError={toast} />}
    </div>
  );
}

/* HR picks the reporting manager for one person, or for everyone in a department who has none. */
function SetManager({ set, people, onClose, onDone, toastError }) {
  const targets = set.people, one = targets.length === 1 ? targets[0] : null;
  const ids = new Set(targets.map((p) => p.email));
  const choices = people.filter((p) => p.status !== "offboarded" && !ids.has(p.email)).sort(byName);
  const current = one ? (people.find((p) => lc(p.name) === lc(mgrOf(one))) || {}).email || "" : "";
  const [boss, setBoss] = useState(current), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const save = async (clear = false) => {
    const chosen = clear ? null : people.find((p) => p.email === boss);
    if (!clear && !chosen) { setErr("Please choose the reporting manager."); return; }
    setBusy(true);
    const results = await Promise.all(targets.map((p) => api("PUT", "/api/employees/manager", { email: p.email, manager: chosen ? chosen.name : "" })));
    setBusy(false);
    const failed = results.filter((r) => !r.ok);
    if (failed.length === results.length) { setErr(apiMsg(failed[0])); return; }
    if (failed.length) toastError(`${failed.length} could not be changed: ${apiMsg(failed[0])}`);
    onDone(results.length - failed.length, chosen ? chosen.name : "");
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>{one ? `Reporting manager for ${one.name}` : `One manager for ${targets.length} people in ${set.dept}`}</h3></div>
      <div className="card-b">
        {!one && <p className="m-0 text-ink-dim">Everyone in {set.dept} who has no reporting manager will report to the person you choose. You can change anyone later from their card.</p>}
        <Field id="om-b" label="Reporting manager" error={err}><PeoplePicker id="om-b" people={choices} value={boss} onChange={(v) => { setBoss(v || ""); setErr(""); }} /></Field>
      </div>
      <div className="modal-f">
        {one && mgrOf(one) && isTop(one) && <button type="button" className="btn glass mr-auto max-sheet:mr-0" onClick={() => save(true)} disabled={busy}>Clear manager</button>}
        <button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn primary" onClick={() => save(false)} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

/* HR sets every missing reporting manager on one screen (as a Keka bulk update would). Each row starts with a suggestion:
   when their manager has left, that manager's own manager. "Same for everyone" fills every row. Rows left empty are skipped. */
function AssignManagers({ list, people, onClose, onDone }) {
  const here = people.filter((p) => p.status !== "offboarded" && p.status !== "offboarding").sort(byName);
  const byEmail = new Map(people.map((p) => [lc(p.email), p])), byNameMap = new Map(people.map((p) => [lc(p.name), p]));
  const formerOf = (p) => (p.managerEmail && byEmail.get(lc(p.managerEmail))) || byNameMap.get(lc(mgrOf(p))) || null;
  const suggest = (p) => { const old = formerOf(p), up = old && byNameMap.get(lc(mgrOf(old))); return up && up.status !== "offboarded" && up.status !== "offboarding" && up.id !== p.id ? up.email : ""; };
  const [pick, setPick] = useState(() => Object.fromEntries(list.map((p) => [p.email, suggest(p)])));
  const [errs, setErrs] = useState({}), [busy, setBusy] = useState(false), [all, setAll] = useState("");
  const chosen = list.filter((p) => pick[p.email]);
  const save = async () => {
    if (!chosen.length) { setErrs({ _: "Please choose a manager for at least one person." }); return; }
    setBusy(true);
    const results = await Promise.all(chosen.map((p) => api("PUT", "/api/employees/manager", { email: p.email, managerEmail: pick[p.email] }).then((r) => [p.email, r])));
    setBusy(false);
    const bad = Object.fromEntries(results.filter(([, r]) => !r.ok).map(([email, r]) => [email, apiMsg(r)]));
    const done = results.length - Object.keys(bad).length;
    if (Object.keys(bad).length) { setErrs(bad); if (done) setPick((x) => Object.fromEntries(Object.entries(x).filter(([email]) => bad[email] || !chosen.some((p) => p.email === email)))); return; }
    onDone(done);
  };
  return (
    <Modal onClose={busy ? () => {} : onClose} wide>
      <div className="card-h"><h3>Assign reporting managers</h3></div>
      <div className="card-b">
        <p className="m-0 text-ink-dim">Choose a manager for each person. Where their manager has left, their manager's own manager is suggested. Rows you leave empty stay as they are.</p>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Field id="am-all" label="Same manager for everyone"><select className="input" id="am-all" value={all} onChange={(e) => setAll(e.target.value)}><option value="">Choose…</option>{here.map((m) => <option key={m.id} value={m.email}>{m.name}</option>)}</select></Field>
          <button type="button" className="btn glass sm mb-1" disabled={!all} onClick={() => setPick(Object.fromEntries(list.map((p) => [p.email, p.email === all ? pick[p.email] : all])))}>Apply to all</button>
        </div>
        {errs._ && <p className="ferr mt-3 mb-0" role="alert">{errs._}</p>}
        <ul className="m-0 mt-4 flex list-none flex-col gap-2.5 p-0">
          {list.map((p) => { const old = formerOf(p); return (
            <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 rounded-field px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)] max-sm:grid-cols-1">
              <span className="flex min-w-0 flex-col"><b className="truncate text-[15px] text-ink">{p.name}</b>
                <span className="text-[13px] text-ink-faint">{p.title}{old ? ` · was ${old.name}${old.status === "offboarded" ? ", who has left" : ""}` : " · never set"}</span></span>
              <span className="flex min-w-0 flex-col gap-1">
                <label className="sr-only" htmlFor={`am-${p.id}`}>Reporting manager for {p.name}</label>
                <select className="input" id={`am-${p.id}`} value={pick[p.email] || ""} aria-invalid={!!errs[p.email]} onChange={(e) => { setPick((x) => ({ ...x, [p.email]: e.target.value })); setErrs((x) => ({ ...x, [p.email]: "", _: "" })); }}>
                  <option value="">Choose…</option>{here.filter((m) => m.id !== p.id).map((m) => <option key={m.id} value={m.email}>{m.name}</option>)}</select>
                {errs[p.email] && <span className="ferr" role="alert">{errs[p.email]}</span>}</span>
            </li>); })}
        </ul>
      </div>
      <div className="modal-f">
        <button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : `Save ${chosen.length || ""}`.trim()}</button>
      </div>
    </Modal>
  );
}
