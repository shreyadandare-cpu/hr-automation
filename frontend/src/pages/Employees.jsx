import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { PersonCell, Pill, SectionHead, ToolIcon, shortDate } from "../components/ui.jsx";
import Pager from "../components/Pager.jsx";
import OrgChart from "../components/OrgChart.jsx";
import { AddMemberModal } from "../modules/employee/cards.jsx";
import { STATUS, TOOLS, byEmployeeNo, isTop, mgrOf, teamUnder, toolIds } from "../lib/people.js";

function StatusPill({ person }) {
  if (person.status === "active" && person.lastDay) return <Pill tone="warn">Leaving {shortDate(person.lastDay)}</Pill>;
  const [label, tone] = STATUS[person.status];
  return <Pill tone={tone}>{label}</Pill>;
}

/* Reporting manager: everyone just reads it. HR changes it from the three-dot menu at the end of the row. */
function ManagerCell({ person }) {
  const cur = mgrOf(person);
  if (isTop(person)) return <span className="muted" title="At the top of the company">No manager</span>;
  return <span className={cur ? "" : "muted"}>{cur || "—"}</span>;
}

/* The three dots at the end of a row (HR only). The menu is drawn over the page so the table never clips it. */
function RowMenu({ person, onEdit }) {
  const [at, setAt] = useState(null);
  const btn = useRef(null);
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const esc = (e) => { if (e.key === "Escape") { close(); btn.current && btn.current.focus(); } };
    document.addEventListener("keydown", esc); window.addEventListener("scroll", close, true); window.addEventListener("resize", close);
    return () => { document.removeEventListener("keydown", esc); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [at]);
  const toggle = (e) => {
    e.stopPropagation();
    if (at) { setAt(null); return; }
    const r = btn.current.getBoundingClientRect();
    setAt({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  };
  const pick = (e) => { e.stopPropagation(); setAt(null); onEdit(person); };
  return (
    <>
      <button ref={btn} type="button" className="dots-btn" aria-label={`Actions for ${person.name}`} aria-haspopup="menu" aria-expanded={!!at} onClick={toggle}>⋯</button>
      {at && createPortal(
        <>
          <div className="row-menu-scrim" onMouseDown={() => setAt(null)} />
          <div className="row-menu" role="menu" style={{ top: at.top, right: at.right }}>
            <button type="button" role="menuitem" onClick={pick} disabled={person.status === "offboarded"}>Edit</button>
          </div>
        </>, document.body)}
    </>
  );
}

/* The projects someone is working on now: the first one, and a "+N" badge (hover for all, with where each runs). */
function ProjectsCell({ person }) {
  const now = (person.projects || []).filter((a) => a.status === "Active");
  if (!now.length) return <span className="muted">—</span>;
  const all = now.map((a) => (a.location ? `${a.project} · ${a.location}` : a.project)).join("\n");
  return (
    <div className="proj-line" title={all}>
      <span className="proj-name">{now[0].project}</span>
      {now.length > 1 && <span className="proj-more">+{now.length - 1}</span>}
    </div>
  );
}

export default function Employees() {
  const { isHr, user } = useAuth();
  const { people } = useData();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [former, setFormer] = useState(false);
  const [size, setSize] = useState(10);
  const [page, setPage] = useState(1);
  const [params, setParams] = useSearchParams();
  const chart = params.get("view") === "chart";
  const [scope, setScope] = useState("all");          // "all" or "team": the people under me
  const [adding, setAdding] = useState(false);        // the Add member dialog for my own team

  const { direct, team } = useMemo(() => teamUnder(people, user && user.email), [people, user]);   // the people under me
  const inTeam = scope === "team" && team.length > 0;
  const meP = (people || []).find((p) => String(p.email).toLowerCase() === String(user && user.email).toLowerCase());

  const formerCount = (people || []).filter((p) => p.status === "offboarded").length;
  const showFormer = isHr && former && formerCount > 0;
  const all = useMemo(() => {
    const s = q.toLowerCase();
    return (inTeam ? team : (people || [])).filter((p) => (showFormer || p.status !== "offboarded") && (!s || (p.no + p.name + p.email + p.dept + p.title + (p.location || "") + (p.projects || []).map((a) => a.project).join(" ")).toLowerCase().includes(s)))
      .sort(byEmployeeNo);
  }, [people, team, inTeam, q, showFormer]);
  const pages = Math.max(1, Math.ceil(all.length / size)), cur = Math.min(page, pages);
  const rows = all.slice((cur - 1) * size, cur * size);

  if (!people) return <section className="section"><div className="empty">Loading…</div></section>;
  const views = (
    <div className="seg" role="radiogroup" aria-label="Employees view" style={{ alignSelf: "flex-start" }}>
      <label><input type="radio" name="emp-view" checked={!chart} onChange={() => setParams({}, { replace: true })} />List</label>
      <label><input type="radio" name="emp-view" checked={chart} onChange={() => setParams({ view: "chart" }, { replace: true })} />Org chart</label>
    </div>
  );
  if (chart) return (
    <section className="section">
      {views}
      <SectionHead eyebrow="People" title="Who reports" accent="to whom." sub="The company from the top down, from the reporting manager set for each person. Click someone to open their page." />
      <OrgChart people={people} />
    </section>
  );
  return (
    <section className="section">
      {views}
      <SectionHead eyebrow="People" title="Everyone," accent="at a glance." sub="Everyone with a record here, and which tools they can use right now."
        actions={<>
          {isHr && formerCount > 0 && <label className="former-toggle"><input type="checkbox" checked={former} onChange={(e) => { setFormer(e.target.checked); setPage(1); }} />Show former employees ({formerCount})</label>}
          <input className="input" placeholder="Search by name, ID, project, location or email" aria-label="Search employees" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </>} />
      {team.length > 0 && (
        <div className="row" style={{ alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div className="seg" role="radiogroup" aria-label="Whose people">
            <label><input type="radio" name="emp-scope" checked={scope === "all"} onChange={() => { setScope("all"); setPage(1); }} />Everyone</label>
            <label><input type="radio" name="emp-scope" checked={scope === "team"} onChange={() => { setScope("team"); setPage(1); }} />My team ({team.length})</label>
          </div>
          <button type="button" className="btn glass sm" onClick={() => setAdding(true)}>+ Add member</button>
          {inTeam && <span className="muted">{direct.length} {direct.length === 1 ? "person reports" : "people report"} to you directly{team.length > direct.length ? `, ${team.length - direct.length} more work under them` : ""}.</span>}
        </div>)}
      <div className="card"><div className="tbl-wrap"><table className="dir-table">
        <thead><tr><th>ID</th><th>Employee</th><th className="hide-sm">Role</th><th className="hide-sm">Reporting manager</th><th className="hide-sm">Projects</th><th>Status</th><th>Tools</th>{isHr && <th aria-label="Actions" />}</tr></thead>
        <tbody>
          {rows.length ? rows.map((p) => (
            <tr key={p.id} className={`click${p.status === "offboarded" ? " former" : ""}`} tabIndex={0}
              onClick={() => nav(`/app/employees/${encodeURIComponent(p.email)}`)}
              onKeyDown={(e) => e.key === "Enter" && nav(`/app/employees/${encodeURIComponent(p.email)}`)}>
              <td className="num-cell"><span className="emp-no">{p.no}</span></td>
              <td><PersonCell person={p} /></td>
              <td className="hide-sm"><div className="cell-main">{p.title}</div><div className="cell-sub">{[p.dept, p.location].filter((x) => x && x !== "—").join(" · ")}</div></td>
              <td className="hide-sm"><ManagerCell person={p} /></td>
              <td className="hide-sm"><ProjectsCell person={p} /></td>
              <td><StatusPill person={p} /><div className="cell-sub">Joined {shortDate(p.start)}</div></td>
              <td><div className="apps-row">{toolIds(p).map((id) => <ToolIcon key={id} tool={TOOLS[id]} state={p.grants[id]} />)}</div></td>
              {isHr && <td className="dots-cell" onKeyDown={(e) => e.stopPropagation()}><RowMenu person={p} onEdit={(x) => nav(`/app/employees/${encodeURIComponent(x.email)}?edit=1`)} /></td>}
            </tr>
          )) : <tr><td colSpan={isHr ? 8 : 7}><div className="empty">{q ? `No one matches “${q}”.` : "No one here yet."}</div></td></tr>}
        </tbody>
      </table></div>
      <Pager total={all.length} page={cur} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} /></div>
      {adding && meP && <AddMemberModal boss={meP} asHr={isHr} onClose={() => setAdding(false)} />}
    </section>
  );
}
