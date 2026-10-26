import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { PersonCell, Pill, SectionHead, ToolIcon, shortDate } from "../components/ui.jsx";
import { useToast } from "../components/toast.jsx";
import Pager from "../components/Pager.jsx";
import { STATUS, TOOLS, byEmployeeNo, isTop, mgrOf, toolIds } from "../lib/people.js";

function StatusPill({ person }) {
  if (person.status === "active" && person.lastDay) return <Pill tone="warn">Leaving {shortDate(person.lastDay)}</Pill>;
  const [label, tone] = STATUS[person.status];
  return <Pill tone={tone}>{label}</Pill>;
}

/* Reporting manager: HR picks from a list, everyone else just reads it. */
function ManagerCell({ person, people, isHr, onChange }) {
  const cur = mgrOf(person);
  if (isTop(person)) return <span className="muted" title="At the top of the company">No manager</span>;
  if (!isHr || person.status === "offboarded") return <span className={cur ? "" : "muted"}>{cur || "—"}</span>;
  const names = people.filter((m) => m.id !== person.id && m.status !== "offboarded").map((m) => m.name).sort((a, b) => a.localeCompare(b));
  if (cur && !names.includes(cur)) names.unshift(cur);   // keep a manager who has since left visible
  return (
    <select className="input mgr-sel" aria-label={`Reporting manager for ${person.name}`} value={cur} onClick={(e) => e.stopPropagation()} onChange={(e) => onChange(person, e.target.value)}>
      <option value="">No manager</option>
      {names.map((n) => <option key={n}>{n}</option>)}
    </select>
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
  const { isHr } = useAuth();
  const { people, setRoster } = useData();
  const toast = useToast();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [former, setFormer] = useState(false);
  const [size, setSize] = useState(10);
  const [page, setPage] = useState(1);

  const formerCount = (people || []).filter((p) => p.status === "offboarded").length;
  const showFormer = isHr && former && formerCount > 0;
  const all = useMemo(() => {
    const s = q.toLowerCase();
    return (people || []).filter((p) => (showFormer || p.status !== "offboarded") && (!s || (p.no + p.name + p.email + p.dept + p.title + (p.location || "") + (p.projects || []).map((a) => a.project).join(" ")).toLowerCase().includes(s)))
      .sort(byEmployeeNo);
  }, [people, q, showFormer]);
  const pages = Math.max(1, Math.ceil(all.length / size)), cur = Math.min(page, pages);
  const rows = all.slice((cur - 1) * size, cur * size);

  const setManager = async (person, value) => {
    const r = await api("PUT", "/api/employees/manager", { email: person.email, manager: value });
    if (!r.ok) { toast(apiMsg(r)); return; }
    setRoster((rs) => rs.map((x) => (x.email === person.email ? { ...x, manager: value } : x)));
    toast(value ? `${person.name} now reports to ${value}.` : `${person.name} has no reporting manager now.`);
  };

  if (!people) return <section className="section"><div className="empty">Loading…</div></section>;
  return (
    <section className="section">
      <SectionHead eyebrow="People" title="Everyone," accent="at a glance." sub="Everyone with a record here, and which tools they can use right now."
        actions={<>
          {isHr && formerCount > 0 && <label className="former-toggle"><input type="checkbox" checked={former} onChange={(e) => { setFormer(e.target.checked); setPage(1); }} />Show former employees ({formerCount})</label>}
          <input className="input" placeholder="Search by name, ID, project, location or email" aria-label="Search employees" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </>} />
      <div className="card"><div className="tbl-wrap"><table className="dir-table">
        <thead><tr><th>ID</th><th>Employee</th><th className="hide-sm">Role</th><th className="hide-sm">Reporting manager</th><th className="hide-sm">Projects</th><th>Status</th><th>Tools</th></tr></thead>
        <tbody>
          {rows.length ? rows.map((p) => (
            <tr key={p.id} className={`click${p.status === "offboarded" ? " former" : ""}`} tabIndex={0}
              onClick={() => nav(`/app/employees/${encodeURIComponent(p.email)}`)}
              onKeyDown={(e) => e.key === "Enter" && nav(`/app/employees/${encodeURIComponent(p.email)}`)}>
              <td className="num-cell"><span className="emp-no">{p.no}</span></td>
              <td><PersonCell person={p} /></td>
              <td className="hide-sm"><div className="cell-main">{p.title}</div><div className="cell-sub">{[p.dept, p.location].filter((x) => x && x !== "—").join(" · ")}</div></td>
              <td className="hide-sm"><ManagerCell person={p} people={people} isHr={isHr} onChange={setManager} /></td>
              <td className="hide-sm"><ProjectsCell person={p} /></td>
              <td><StatusPill person={p} /><div className="cell-sub">Joined {shortDate(p.start)}</div></td>
              <td><div className="apps-row">{toolIds(p).map((id) => <ToolIcon key={id} tool={TOOLS[id]} state={p.grants[id]} />)}</div></td>
            </tr>
          )) : <tr><td colSpan="7"><div className="empty">No one matches “{q}”.</div></td></tr>}
        </tbody>
      </table></div>
      <Pager total={all.length} page={cur} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} /></div>
    </section>
  );
}
