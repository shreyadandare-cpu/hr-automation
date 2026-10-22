import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { PersonCell, Pill, SectionHead, ToolIcon, shortDate } from "../components/ui.jsx";
import { useToast } from "../components/toast.jsx";
import { STATUS, TOOLS, isTop, mgrOf, toolIds } from "../lib/people.js";

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

const pageNumbers = (cur, total) => {
  const keep = [...new Set([1, total, cur - 1, cur, cur + 1].filter((n) => n >= 1 && n <= total))].sort((a, b) => a - b), out = [];
  keep.forEach((n, i) => { if (i && n - keep[i - 1] > 1) out.push(null); out.push(n); });
  return out;
};

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
    return (people || []).filter((p) => (showFormer || p.status !== "offboarded") && (!s || (p.name + p.email + p.dept + p.title).toLowerCase().includes(s)));
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
  const from = all.length ? (cur - 1) * size + 1 : 0, to = Math.min(all.length, cur * size);
  return (
    <section className="section">
      <SectionHead eyebrow="People" title="Everyone," accent="at a glance." sub="Everyone with a record here, and which tools they can use right now."
        actions={<>
          {isHr && formerCount > 0 && <label className="former-toggle"><input type="checkbox" checked={former} onChange={(e) => { setFormer(e.target.checked); setPage(1); }} />Show former employees ({formerCount})</label>}
          <input className="input" placeholder="Search by name, team or email" aria-label="Search employees" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </>} />
      <div className="card"><div className="tbl-wrap"><table>
        <thead><tr><th>Employee</th><th className="hide-sm">Department</th><th className="hide-sm">Reporting manager</th><th>Status</th><th>Tool access</th><th className="hide-sm">Start date</th></tr></thead>
        <tbody>
          {rows.length ? rows.map((p) => (
            <tr key={p.id} className={`click${p.status === "offboarded" ? " former" : ""}`} tabIndex={0}
              onClick={() => nav(`/app/employees/${encodeURIComponent(p.email)}`)}
              onKeyDown={(e) => e.key === "Enter" && nav(`/app/employees/${encodeURIComponent(p.email)}`)}>
              <td><PersonCell person={p} /></td>
              <td className="hide-sm">{p.dept}<div className="muted">{p.title}</div></td>
              <td className="hide-sm"><ManagerCell person={p} people={people} isHr={isHr} onChange={setManager} /></td>
              <td><StatusPill person={p} /></td>
              <td><div className="apps-row">{toolIds(p).map((id) => <ToolIcon key={id} tool={TOOLS[id]} state={p.grants[id]} />)}</div></td>
              <td className="num-cell hide-sm">{shortDate(p.start)}</td>
            </tr>
          )) : <tr><td colSpan="6"><div className="empty">No one matches “{q}”.</div></td></tr>}
        </tbody>
      </table></div>
      <div className="pager">
        <span className="muted" style={{ fontSize: 13 }}>Showing {from}–{to} of {all.length}</span>
        <div className="row">
          <label>Rows per page<select className="input" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }}>{[10, 25, 50].map((n) => <option key={n}>{n}</option>)}</select></label>
          {pages > 1 && (
            <nav className="pg-nav" aria-label="Pages">
              <button type="button" className="pg" disabled={cur <= 1} onClick={() => setPage(cur - 1)}>Previous</button>
              {pageNumbers(cur, pages).map((n, i) => n === null ? <span key={`g${i}`} className="pg-gap" aria-hidden="true">…</span>
                : <button key={n} type="button" className={`pg ${n === cur ? "on" : ""}`} aria-label={`Page ${n}`} aria-current={n === cur ? "page" : undefined} onClick={() => setPage(n)}>{n}</button>)}
              <button type="button" className="pg" disabled={cur >= pages} onClick={() => setPage(cur + 1)}>Next</button>
            </nav>
          )}
        </div>
      </div></div>
    </section>
  );
}
