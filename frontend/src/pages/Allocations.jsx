import { useEffect, useMemo, useState } from "react";
import { api, apiMsg } from "../api.js";
import { Callout, Pill, SectionHead, shortDate } from "../components/ui.jsx";
import Pager, { Paged } from "../components/Pager.jsx";
import Modal from "../components/Modal.jsx";

const dash = <span className="muted">—</span>;
const tone = (s) => (s === "Active" ? "ok" : s === "Completed" ? "info" : "mute");

/* One row per employee per project. */
function AllocationTable({ rows }) {
  const [q, setQ] = useState("");
  const [view, setView] = useState("current");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows || []).filter((a) => (view === "all" || (view === "current") === (a.status === "Active"))
      && (!s || `${a.project} ${a.employee} ${a.lead || ""} ${a.location || ""}`.toLowerCase().includes(s)));
  }, [rows, q, view]);
  return (
    <>
      <Paged items={shown} resetKey={`${q}|${view}`}>{(page, pager) => (
        <div className="card">
          <div className="filters">
            <input className="input grow" placeholder="Search employee, project or lead…" aria-label="Search allocations" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" aria-label="Show" value={view} onChange={(e) => setView(e.target.value)}>
              <option value="current">Current allocations</option><option value="ended">Ended allocations</option><option value="all">All allocations</option>
            </select>
          </div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Project</th><th>Employee</th><th>Start</th><th>End</th><th>Project lead</th><th>Location</th><th>Status</th><th>Handed over to</th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan="8"><div className="empty">Loading…</div></td></tr>}
              {rows && !page.length && <tr><td colSpan="8"><div className="empty">No allocations match.</div></td></tr>}
              {page.map((a) => (
                <tr key={a.id}>
                  <td><b>{a.project}</b></td>
                  <td style={{ whiteSpace: "nowrap" }}>{a.employee}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{a.start ? shortDate(a.start) : dash}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{a.end ? shortDate(a.end) : dash}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{a.lead || dash}</td>
                  <td>{a.location || dash}</td>
                  <td><Pill tone={tone(a.status)}>{a.status}</Pill></td>
                  <td style={{ whiteSpace: "nowrap" }}>{a.handedOverTo || dash}</td>
                </tr>))}
            </tbody>
          </table></div>
          {rows && <Pager {...pager} />}
        </div>)}
      </Paged>
    </>
  );
}

/* One row per project, with the people working on it now. */
function ProjectTable({ rows }) {
  const [q, setQ] = useState("");
  const [view, setView] = useState("current");
  const [open, setOpen] = useState(null);
  const projects = useMemo(() => {
    const m = new Map();
    (rows || []).forEach((a) => {
      if (!m.has(a.projectId)) m.set(a.projectId, { id: a.projectId, name: a.project, lead: a.projectLead || a.lead, start: a.projectStart, end: a.projectEnd, status: a.projectStatus, all: [], current: [] });
      const p = m.get(a.projectId);
      p.all.push(a);
      if (a.status === "Active") p.current.push(a);
    });
    return [...m.values()].sort((x, y) => y.current.length - x.current.length || x.name.localeCompare(y.name));
  }, [rows]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return projects.filter((p) => (view === "all" || (view === "current") === (p.current.length > 0)) && (!s || `${p.name} ${p.lead || ""}`.toLowerCase().includes(s)));
  }, [projects, q, view]);
  const withCurrent = projects.filter((p) => p.current.length).length;
  return (
    <>
      <p className="muted" style={{ margin: "0 0 12px" }}>{withCurrent} projects with current allocations</p>
      <Paged items={shown} resetKey={`${q}|${view}`}>{(page, pager) => (
        <div className="card">
          <div className="filters">
            <input className="input grow" placeholder="Search project or lead…" aria-label="Search projects" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" aria-label="Show" value={view} onChange={(e) => setView(e.target.value)}>
              <option value="current">Projects with current allocations</option><option value="all">All projects</option>
            </select>
          </div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Project name</th><th>Employees</th><th>Project lead</th><th>Start date</th><th>End date</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan="7"><div className="empty">Loading…</div></td></tr>}
              {rows && !page.length && <tr><td colSpan="7"><div className="empty">No projects match.</div></td></tr>}
              {page.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b></td>
                  <td style={{ minWidth: 260 }}>
                    <div><b>{p.current.length}</b> <span className="muted">current</span></div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {p.current.slice(0, 5).map((a) => <span key={a.id} className="pill p-mute" style={{ fontWeight: 500 }}>{a.employee}</span>)}
                      {p.current.length > 5 && <span className="pill p-mute" style={{ fontWeight: 500 }}>+{p.current.length - 5} more</span>}
                    </div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{p.lead || dash}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{p.start ? shortDate(p.start) : dash}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{p.end ? shortDate(p.end) : dash}</td>
                  <td><Pill tone={tone(p.status)}>{p.status || "Active"}</Pill></td>
                  <td><button type="button" className="btn btn-sm" onClick={() => setOpen(p)}>View</button></td>
                </tr>))}
            </tbody>
          </table></div>
          {rows && <Pager {...pager} />}
        </div>)}
      </Paged>
      {open && (
        <Modal onClose={() => setOpen(null)}>
          <h3 style={{ margin: "0 0 4px" }}>{open.name}</h3>
          <p className="muted" style={{ margin: "0 0 12px" }}>Lead: {open.lead || "—"} · {open.all.length} allocations</p>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Employee</th><th>Start</th><th>End</th><th>Location</th><th>Status</th></tr></thead>
            <tbody>{open.all.map((a) => (
              <tr key={a.id}><td>{a.employee}</td><td style={{ whiteSpace: "nowrap" }}>{a.start ? shortDate(a.start) : dash}</td><td style={{ whiteSpace: "nowrap" }}>{a.end ? shortDate(a.end) : dash}</td>
                <td>{a.location || dash}</td><td><Pill tone={tone(a.status)}>{a.status}</Pill></td></tr>))}</tbody>
          </table></div>
          <div className="actions" style={{ marginTop: 14 }}><button type="button" className="btn" onClick={() => setOpen(null)}>Close</button></div>
        </Modal>)}
    </>
  );
}

/* Who works on which project, from the company database: a Projects view and the full Allocations list. */
export default function Allocations() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("projects");
  useEffect(() => {
    api("GET", "/api/allocations").then((r) => { if (r.ok) setRows(r.data); else { setError(apiMsg(r)); setRows([]); } });
  }, []);
  return (
    <section className="section">
      <SectionHead eyebrow="Projects" title="Project" accent="allocation." sub={tab === "projects" ? "Each project with the people working on it now" : rows ? `${rows.length} allocations · one row per employee per project` : "Loading…"} />
      {error && <Callout>{error}</Callout>}
      <div className="subtabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "projects"} className={tab === "projects" ? "on" : ""} onClick={() => setTab("projects")}>Projects</button>
        <button type="button" role="tab" aria-selected={tab === "people"} className={tab === "people" ? "on" : ""} onClick={() => setTab("people")}>Allocations</button>
      </div>
      {tab === "projects" ? <ProjectTable rows={rows} /> : <AllocationTable rows={rows} />}
    </section>
  );
}
