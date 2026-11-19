import { useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { Callout, SectionHead } from "../../components/ui.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import { useAuth } from "../../auth.jsx";
import { useToast } from "../../components/toast.jsx";

/* The weekly report for one project, Monday to Sunday, built on the server from the project emails. HR sees every project;
   everyone else sees the projects they are on. */
const fmt = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const shift = (d, days) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); };
const when = (t) => (t ? new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");

/* Send this week's report to colleagues: company addresses only, up to 10. */
function EmailDialog({ project, from, me, onClose }) {
  const toast = useToast();
  const [to, setTo] = useState(me);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    const r = await api("POST", `/api/project-reports/${project}/email`, { week: from, to });
    setBusy(false);
    if (!r.ok) return setErr(apiMsg(r));
    toast(`Report emailed to ${r.data.sent} ${r.data.sent === 1 ? "person" : "people"}.`); onClose();
  };
  return (
    <Modal onClose={onClose}>
      <form onSubmit={send}>
        <h3>Email this report</h3>
        <Field id="pr-to" label="Send to" hint="Work email addresses, separated by commas or spaces. Up to 10." error={err}>
          <input id="pr-to" className="input" autoFocus value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" className="btn glass" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !to.trim()}>{busy ? "Sending…" : "Send"}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function ProjectReport() {
  const { user } = useAuth();
  const [mailing, setMailing] = useState(false);
  const [projects, setProjects] = useState(null);
  const [project, setProject] = useState("");
  const [from, setFrom] = useState("");
  const [rep, setRep] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("GET", "/api/project-reports").then((r) => {
      if (!r.ok) return setError(apiMsg(r));
      setProjects(r.data.projects); setFrom(r.data.week.from);
      if (r.data.projects[0]) setProject(String(r.data.projects[0].id));
    });
  }, []);
  useEffect(() => {
    if (!project || !from) return;
    setRep(null);
    api("GET", `/api/project-reports/${project}?week=${from}`).then((r) => (r.ok ? setRep(r.data) : setError(apiMsg(r))));
  }, [project, from]);

  const head = <SectionHead eyebrow="Workforce" title="Project" accent="reports." sub="Each week's progress, pending work, blockers and decisions for a project, gathered from the team's project emails." />;
  if (error) return <section className="section">{head}<Callout>{error}</Callout></section>;
  if (!projects) return <section className="section">{head}<div className="empty">Loading…</div></section>;
  if (!projects.length) return <section className="section">{head}<div className="empty">You are not on a project yet.</div></section>;

  return (
    <section className="section">
      {head}
      <div className="filters pr-bar">
        <select className="input" aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="pr-week">
          <button className="btn glass sm" aria-label="Previous week" onClick={() => setFrom(shift(from, -7))}>←</button>
          <strong>{fmt(from)} – {fmt(shift(from, 6))}</strong>
          <button className="btn glass sm" aria-label="Next week" onClick={() => setFrom(shift(from, 7))}>→</button>
        </div>
        <div className="pr-acts">
          <button className="btn glass sm" disabled={!rep || !rep.updates} onClick={() => setMailing(true)}>Email</button>
          <button className="btn glass sm" disabled={!rep || !rep.updates} onClick={() => window.print()}>Print</button>
        </div>
      </div>
      {mailing && <EmailDialog project={project} from={from} me={user.email} onClose={() => setMailing(false)} />}
      {!rep && <div className="empty">Loading…</div>}
      {rep && !rep.updates && <div className="empty">No updates were collected for this project this week.</div>}
      {rep && rep.updates > 0 && (
        <div className="pr-doc">
          <div className="card pr-top"><strong>{rep.project.name}</strong><span className="muted">{rep.updates} {rep.updates === 1 ? "update" : "updates"} from {rep.people.length} {rep.people.length === 1 ? "person" : "people"}</span></div>
          <div className="pr-grid">
            {rep.sections.filter((s) => s.items.length).map((s) => (
              <div key={s.key} className={`card pr-sec pr-${s.key}`}>
                <h3>{s.title}</h3>
                <ul>{s.items.map((it, i) => <li key={i}>{it.text}<span className="pr-by"> {it.by.join(", ")}</span></li>)}</ul>
              </div>))}
          </div>
          <div className="card pr-sec">
            <h3>Updates by person</h3>
            {rep.people.map((p) => (
              <div key={p.name} className="pr-person"><strong>{p.name}</strong>
                {p.updates.map((u, i) => <p key={i}>{u.summary} <span className="pr-by">{when(u.date)}</span></p>)}</div>))}
          </div>
        </div>
      )}
    </section>
  );
}
