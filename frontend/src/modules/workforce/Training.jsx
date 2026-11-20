import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import BackButton from "../../components/BackButton.jsx";
import ConfirmDialog from "../../components/ConfirmDialog.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import PeoplePicker from "../../components/PeoplePicker.jsx";
import { Callout, PersonCell, Pill, SectionHead, ViewTabs, ListSkeleton, PageSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { useData } from "../../data.jsx";
import { problems, useList, usePerson } from "../engage/shared.jsx";

const longDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "");
const state = (t, today) => (t.completedOn ? ["Done", "ok"] : t.dueOn && t.dueOn < today ? ["Overdue", "bad"] : ["To do", "warn"]);

/* Me > Training: what the HR team has asked you to complete, and marking it done. HR also manages trainings here. */
export default function Training() {
  const { data, error, reload } = useList("/api/training");
  const [tab, setTab] = useState(() => (new URLSearchParams(window.location.search).get("tab") === "manage" ? "manage" : "mine"));
  const can = data && data.canManage;
  return (
    <section className="section">
      <SectionHead title="Training" sub="Courses and sessions the HR team has asked you to complete. Mark each one done when you finish."
        tabs={can ? <ViewTabs label="Training" view={tab} onView={setTab} views={[["mine", "My training"], ["manage", "Manage"]]} /> : null} />
      {error && <Callout>{error}</Callout>}
      {tab === "manage" && can ? <Manage /> : !data ? <ListSkeleton /> : <Mine data={data} reload={reload} />}
    </section>
  );
}

function Mine({ data, reload }) {
  const toast = useToast();
  const [done, setDone] = useState(null);
  const list = data.trainings || [];
  const undo = async (t) => { const r = await api("PUT", `/api/training/${t.id}`, { done: false }); if (!r.ok) toast(apiMsg(r)); else { toast("Marked as not done."); reload(); } };
  return (
    <>
      {list.length ? <div className="eg-grid">{list.map((t) => {
        const [label, tone] = state(t, data.today);
        return (
          <article className="card gl-card" key={t.id}>
            <div className="row"><h3>{t.title}</h3><Pill tone={tone}>{label}</Pill></div>
            {t.detail && <p className="whitespace-pre-wrap">{t.detail}</p>}
            <p>{t.completedOn ? `Finished ${longDate(t.completedOn)}.` : t.dueOn ? `Please finish by ${longDate(t.dueOn)}.` : "No due date."}{t.note ? ` ${t.note}` : ""}</p>
            <div className="row">{t.link ? <a className="btn link nolink" href={t.link} target="_blank" rel="noreferrer">Open the course</a> : <span />}
              {t.completedOn ? <button type="button" className="btn glass sm" onClick={() => undo(t)}>Mark not done</button> : <button type="button" className="btn primary sm" onClick={() => setDone(t)}>Mark done</button>}</div>
          </article>);
      })}</div> : <div className="card"><div className="empty">You have no training to do right now.</div></div>}
      {done && <Done t={done} today={data.today} onClose={() => setDone(null)} onDone={() => { setDone(null); toast("Marked as done. Thank you."); reload(); }} />}
    </>
  );
}

function Done({ t, today, onClose, onDone }) {
  const [f, setF] = useState({ completedOn: today, note: "" }), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); const r = await api("PUT", `/api/training/${t.id}`, f); setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone();
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Finished: {t.title}</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <Field id="tr-d" label="The day you finished" error={err.completedOn}><input id="tr-d" type="date" className="input" max={today} value={f.completedOn} onChange={(e) => setF({ ...f, completedOn: e.target.value })} aria-invalid={!!err.completedOn} /></Field>
        <Field id="tr-n" label="Note (optional)" hint="For example, the certificate number."><input id="tr-n" className="input" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Mark done"}</button></div>
    </Modal>
  );
}

function Manage() {
  const { data, error, reload } = useList("/api/trainings");
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const list = (data && data.trainings) || [];
  return (
    <>
      <div className="flex justify-end"><button type="button" className="btn primary" onClick={() => setCreating(true)}>Add a training</button></div>
      {error && <Callout>{error}</Callout>}
      <div className="card">{!data ? <ListSkeleton /> : list.length ? (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Training</th><th>Due</th><th className="text-right">Done</th><th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{list.map((t) => (
            <tr key={t.id}><td><b className="font-bold">{t.title}</b></td><td>{t.dueOn ? longDate(t.dueOn) : "No due date"}</td>
              <td className="num-cell text-right">{t.done} of {t.assigned}</td><td className="text-right"><Link className="btn glass sm" to={`/app/training/${t.id}`}>Open</Link></td></tr>))}</tbody>
        </table></div>) : <div className="empty">No trainings yet. Add the first one.</div>}
      </div>
      {creating && <Create onClose={() => setCreating(false)} onDone={(n) => { setCreating(false); toast(`The training was added for ${n} ${n === 1 ? "person" : "people"}, and they have been told.`); reload(); }} />}
    </>
  );
}

/* Who should do it: everyone, a department or chosen people. Used to add a training and to add more people to one. */
function Who({ f, setF, err }) {
  const { people } = useData();
  const staff = (people || []).filter((p) => p.status !== "offboarded");
  const depts = [...new Set(staff.map((p) => p.dept).filter((d) => d && d !== "—"))].sort();
  return <>
    <Field id="tr-to" label="Who should do it" error={err.to}><select id="tr-to" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}><option value="everyone">Everyone</option><option value="department">One department</option><option value="people">Chosen people</option></select></Field>
    {f.to === "department" && <Field id="tr-dp" label="Department" error={err.dept}><select id="tr-dp" className="input" value={f.dept} onChange={(e) => setF({ ...f, dept: e.target.value })}><option value="">Choose a department</option>{depts.map((d) => <option key={d}>{d}</option>)}</select></Field>}
    {f.to === "people" && <Field id="tr-pp" label="People" error={err.emails}><PeoplePicker id="tr-pp" multi people={staff} value={f.emails} onChange={(v) => setF({ ...f, emails: v })} /></Field>}
  </>;
}

function Create({ onClose, onDone }) {
  const [f, setF] = useState({ title: "", detail: "", link: "", dueOn: "", to: "everyone", dept: "", emails: [] }), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); const r = await api("POST", "/api/trainings", f); setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone(r.data.assigned);
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Add a training</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <Field id="tr-t" label="Title" error={err.title}><input id="tr-t" className="input" maxLength={140} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-invalid={!!err.title} placeholder="For example: Prevention of sexual harassment (POSH)" /></Field>
        <Field id="tr-x" label="What it is (optional)"><textarea id="tr-x" className="input" rows={3} maxLength={2000} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} /></Field>
        <Field id="tr-l" label="Link to the course (optional)" error={err.link}><input id="tr-l" className="input" maxLength={500} placeholder="https://" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} aria-invalid={!!err.link} /></Field>
        <Field id="tr-du" label="Due date (optional)" error={err.dueOn}><input id="tr-du" type="date" className="input" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></Field>
        <Who f={f} setF={setF} err={err} />
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Add training"}</button></div>
    </Modal>
  );
}

/* HR: one training, who has finished it, and adding more people. */
export function TrainingPage() {
  const { id } = useParams();
  const { data, error, reload } = useList(`/api/trainings/${encodeURIComponent(id)}`);
  const person = usePerson(), toast = useToast(), nav = useNavigate();
  const [removing, setRemoving] = useState(false);
  const [adding, setAdding] = useState(false), [f, setF] = useState({ to: "people", dept: "", emails: [] }), [err, setErr] = useState({});
  const back = <BackButton to="/app/training" label="Training" />;
  if (!data) return <PageSkeleton />;
  if (error || !data.training) return <section className="section">{back}<Callout>{error || "This training was not found."}</Callout></section>;
  const t = data.training, list = data.people || [], doneN = list.filter((p) => p.completedOn).length;
  const add = async () => {
    const r = await api("POST", `/api/trainings/${t.id}/assign`, f);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    setAdding(false); setErr({}); toast(r.data.assigned ? `${r.data.assigned} more ${r.data.assigned === 1 ? "person was" : "people were"} added.` : "Everyone chosen already has this training."); reload();
  };
  const remove = async () => { const r = await api("DELETE", `/api/trainings/${t.id}`); if (!r.ok) toast(apiMsg(r)); else { toast("The training was removed."); nav("/app/training?tab=manage"); } };
  return (
    <section className="section">
      {back}
      <SectionHead title={t.title} sub={`${doneN} of ${list.length} done${t.dueOn ? `, due ${longDate(t.dueOn)}` : ""}.`}
        actions={<><button type="button" className="btn glass" onClick={() => setRemoving(true)}>Remove training</button><button type="button" className="btn primary" onClick={() => setAdding(true)}>Add people</button></>} />
      <div className="card">{list.length ? (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Employee</th><th>Status</th><th>Finished</th><th>Note</th></tr></thead>
          <tbody>{list.map((p) => { const [label, tone] = state({ ...p, dueOn: t.dueOn }, data.today); return (
            <tr key={p.person.email}><td><PersonCell person={person(p.person)} /></td><td><Pill tone={tone}>{label}</Pill></td>
              <td>{p.completedOn ? longDate(p.completedOn) : ""}</td><td>{p.note}</td></tr>); })}</tbody>
        </table></div>) : <div className="empty">No one has this training yet.</div>}
      </div>
      {removing && <ConfirmDialog title={`Remove ${t.title}?`} confirmLabel="Remove training" onClose={() => setRemoving(false)} onConfirm={remove}>It disappears from everyone's training list, including the record of who finished it. This cannot be undone from the app.</ConfirmDialog>}
      {adding && <Modal onClose={() => setAdding(false)}>
        <div className="card-h"><h3>Add people to {t.title}</h3></div>
        <div className="card-b">{err.form && <Callout>{err.form}</Callout>}<Who f={f} setF={setF} err={err} /></div>
        <div className="modal-f"><button type="button" className="btn glass" onClick={() => setAdding(false)}>Cancel</button><button type="button" className="btn primary" onClick={add}>Add</button></div>
      </Modal>}
    </section>
  );
}
