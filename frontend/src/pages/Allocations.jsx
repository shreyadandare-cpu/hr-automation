import { useEffect, useMemo, useState } from "react";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { useToast } from "../components/toast.jsx";
import { Callout, Pill, SectionHead, shortDate } from "../components/ui.jsx";
import Pager, { Paged } from "../components/Pager.jsx";
import Modal, { Field } from "../components/Modal.jsx";

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

const today = () => new Date().toISOString().slice(0, 10);

/* Start a project. HR chooses the lead; a manager's project is led by them. */
function AddProjectModal({ onClose, onDone }) {
  const { isHr } = useAuth();
  const { people } = useData();
  const toast = useToast();
  const [name, setName] = useState(""), [lead, setLead] = useState(""), [start, setStart] = useState(today()), [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const staff = (people || []).filter((p) => p.status !== "offboarded").sort((a, b) => a.name.localeCompare(b.name));
  const save = async () => {
    setBusy(true); setError("");
    const r = await api("POST", "/api/projects", { name, lead, start, description });
    setBusy(false);
    if (!r.ok) { setError(apiMsg(r)); return; }
    toast(`${name.trim()} added.`);
    await onDone(); onClose();
  };
  return (
    <Modal onClose={onClose}>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Add a project</h3></div>
      <div className="card-b">
        <Field id="pr-name" label="Project name"><input id="pr-name" className="input" autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {isHr
          ? <Field id="pr-lead" label="Project lead" hint="Can add and remove people on this project."><select id="pr-lead" className="input" value={lead} onChange={(e) => setLead(e.target.value)}>
              <option value="">No lead yet</option>{staff.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}</select></Field>
          : <p className="muted" style={{ margin: "12px 0 0" }}>You will be the project lead, so you can add and remove people on it.</p>}
        <Field id="pr-start" label="Start date"><input id="pr-start" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field id="pr-desc" label="Description (optional)"><input id="pr-desc" className="input" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {error && <p className="ferr" role="alert" style={{ marginTop: 12 }}>{error}</p>}
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={!name.trim() || busy} onClick={save}>{busy ? "Adding…" : "Add project"}</button></div>
    </Modal>
  );
}

/* A project's people. HR and the project's lead can add someone or take them off. */
function ProjectModal({ project, onClose, reload }) {
  const { people } = useData();
  const toast = useToast();
  const [who, setWho] = useState(""), [start, setStart] = useState(today()), [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const onIt = new Set(project.current.map((a) => String(a.email).toLowerCase()));
  const options = (people || []).filter((p) => p.status !== "offboarded" && !onIt.has(String(p.email).toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const chosen = options.find((p) => p.email === who);
  const add = async () => {
    setBusy(true); setError("");
    const r = await api("POST", `/api/projects/${project.id}/members`, { email: who, start, location });
    setBusy(false);
    if (!r.ok) { setError(apiMsg(r)); return; }
    toast(`${chosen.name} added to ${project.name}.`);
    setWho(""); setLocation(""); await reload();
  };
  const [end, setEnd] = useState(project.end ? String(project.end).slice(0, 10) : "");
  const saveEnd = async () => {
    const r = await api("PATCH", `/api/projects/${project.id}`, { end });
    if (!r.ok) { toast(apiMsg(r)); return; }
    toast(end ? `End date set to ${shortDate(end)}.` : "End date cleared."); await reload();
  };
  const endChanged = end !== (project.end ? String(project.end).slice(0, 10) : "");
  const remove = async (a) => {
    if (!window.confirm(`Take ${a.employee} off ${project.name}? The allocation ends today.`)) return;
    const r = await api("DELETE", `/api/allocations/${a.id}`);
    if (!r.ok) { toast(apiMsg(r)); return; }
    toast(`${a.employee} is off ${project.name}.`); await reload();
  };
  return (
    <Modal onClose={onClose} wide>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>{project.name}</h3></div>
      <div className="card-b">
        <p className="muted" style={{ margin: "0 0 12px" }}>Lead: {project.lead || "—"} · {project.current.length} current · {project.all.length} {project.all.length === 1 ? "allocation" : "allocations"} in total</p>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Employee</th><th>Start</th><th>End</th><th>Location</th><th>Status</th>{project.canManage && <th></th>}</tr></thead>
          <tbody>
            {!project.all.length && <tr><td colSpan="6"><div className="empty">No one is on this project yet.</div></td></tr>}
            {project.all.map((a) => (
              <tr key={a.id}><td style={{ whiteSpace: "nowrap" }}>{a.employee}</td><td style={{ whiteSpace: "nowrap" }}>{a.start ? shortDate(a.start) : dash}</td><td style={{ whiteSpace: "nowrap" }}>{a.end ? shortDate(a.end) : dash}</td>
                <td>{a.location || dash}</td><td><Pill tone={tone(a.status)}>{a.status}</Pill></td>
                {project.canManage && <td>{a.status === "Active" && <button type="button" className="btn glass sm" onClick={() => remove(a)}>Remove</button>}</td>}</tr>))}
          </tbody>
        </table></div>
        {project.canManage && (
          <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field id="pm-end" label="Project end date" hint="Leave empty if it has no end yet. A date that has passed marks the project Completed.">
              <input id="pm-end" type="date" className="input" min={project.start ? String(project.start).slice(0, 10) : undefined} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
            <button type="button" className="btn glass" disabled={!endChanged} onClick={saveEnd}>Save end date</button>
          </div>)}
        {project.canManage && (
          <div style={{ marginTop: 18 }}>
            <Field id="pm-who" label="Add a person">
              <select id="pm-who" className="input" value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Choose a person…</option>{options.map((p) => <option key={p.id} value={p.email}>{p.name} ({p.no})</option>)}</select>
            </Field>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Field id="pm-start" label="Start date"><input id="pm-start" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
              <Field id="pm-loc" label="Location (optional)"><input id="pm-loc" className="input" maxLength={80} placeholder="Their usual office" value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
            </div>
            {error && <p className="ferr" role="alert" style={{ marginTop: 8 }}>{error}</p>}
          </div>)}
        {!project.canManage && <p className="muted" style={{ margin: "14px 0 0", fontSize: 13 }}>Only HR or the project lead can change who is on this project.</p>}
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Close</button>
        {project.canManage && <button type="button" className="btn primary" disabled={!who || busy} onClick={add}>{busy ? "Adding…" : "Add to project"}</button>}</div>
    </Modal>
  );
}

/* One row per project, with the people working on it now. */
function ProjectTable({ rows, list, canCreate, reload }) {
  const [q, setQ] = useState("");
  const [view, setView] = useState("current");
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const projects = useMemo(() => {
    const m = new Map((list || []).map((p) => [p.id, { ...p, all: [], current: [] }]));
    (rows || []).forEach((a) => {
      const p = m.get(a.projectId);
      if (!p) return;
      p.all.push(a);
      if (a.status === "Active") p.current.push(a);
    });
    return [...m.values()].sort((x, y) => y.current.length - x.current.length || x.name.localeCompare(y.name));
  }, [rows, list]);
  const open = projects.find((p) => p.id === openId) || null;
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
            {canCreate && <button type="button" className="btn primary sm" onClick={() => setAdding(true)}>+ Add project</button>}
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
                  <td><button type="button" className="btn btn-sm" onClick={() => setOpenId(p.id)}>View</button></td>
                </tr>))}
            </tbody>
          </table></div>
          {rows && <Pager {...pager} />}
        </div>)}
      </Paged>
      {adding && <AddProjectModal onClose={() => setAdding(false)} onDone={reload} />}
      {open && <ProjectModal project={open} onClose={() => setOpenId(null)} reload={reload} />}
    </>
  );
}

/* Who works on which project, from the company database: a Projects view and the full Allocations list. */
export default function Allocations() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("projects");
  const reload = async () => {
    const r = await api("GET", "/api/allocations");
    if (r.ok) setData(r.data); else { setError(apiMsg(r)); setData((d) => d || { rows: [], projects: [], canCreate: false }); }
  };
  useEffect(() => { reload(); }, []);
  const rows = data ? data.rows : null;
  return (
    <section className="section">
      <SectionHead eyebrow="Projects" title="Project" accent="allocation." sub={tab === "projects" ? "Each project with the people working on it now" : rows ? `${rows.length} allocations · one row per employee per project` : "Loading…"} />
      {error && <Callout>{error}</Callout>}
      <div className="subtabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "projects"} className={tab === "projects" ? "on" : ""} onClick={() => setTab("projects")}>Projects</button>
        <button type="button" role="tab" aria-selected={tab === "people"} className={tab === "people" ? "on" : ""} onClick={() => setTab("people")}>Allocations</button>
      </div>
      {tab === "projects" ? <ProjectTable rows={rows} list={data && data.projects} canCreate={!!(data && data.canCreate)} reload={reload} /> : <AllocationTable rows={rows} />}
    </section>
  );
}
