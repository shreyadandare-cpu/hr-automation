import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import BackButton from "../../components/BackButton.jsx";
import PeoplePicker from "../../components/PeoplePicker.jsx";
import { Callout, Pill, SectionHead, PageSkeleton } from "../../components/ui.jsx";
import { useData } from "../../data.jsx";
import { MODE, VERDICTS, ivTime } from "../workforce/People.jsx";
import { useToast } from "../../components/toast.jsx";
import { problems, useList, when } from "../engage/shared.jsx";

export const STAGES = [["applied", "Applied"], ["screening", "Screening"], ["interview", "Interview"], ["offer", "Offer"], ["hired", "Hired"], ["rejected", "Not selected"]];
const stageName = (k) => (STAGES.find(([x]) => x === k) || ["", k])[1];
const STAGE_TONE = { applied: "mute", screening: "info", interview: "info", offer: "warn", hired: "ok", rejected: "bad" };

/* HR > Hiring: the roles that are open and how many candidates each has. Only for the people who run hiring. */
export default function Hiring() {
  const { data, error, reload } = useList("/api/hr/openings");
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const { canAll } = useAuth();
  if (!canAll("hiring.manage")) return <section className="section"><SectionHead title="Hiring" /><div className="empty">Only the people who run hiring can see this.</div></section>;
  if (!data) return <PageSkeleton />;
  const list = data.openings || [];
  const open = list.filter((o) => o.status === "open");
  return (
    <section className="section">
      <SectionHead title="Hiring" sub="Open roles and their candidates. Move each candidate through the stages as you go."
        actions={<button type="button" className="btn primary" onClick={() => setAdding(true)}>Open a role</button>} />
      {error && <Callout>{error}</Callout>}
      <div className="rb-stats four db-strip">
        <div className="rb-stat"><span className="lbl">Open roles</span><b>{open.length}</b><span className="sub">being hired for</span></div>
        <div className="rb-stat"><span className="lbl">Candidates in progress</span><b>{open.reduce((n, o) => n + o.active, 0)}</b><span className="sub">not yet hired or turned down</span></div>
        <div className="rb-stat"><span className="lbl">All candidates</span><b>{list.reduce((n, o) => n + o.candidates, 0)}</b><span className="sub">across every role</span></div>
        <div className="rb-stat"><span className="lbl">Closed roles</span><b>{list.length - open.length}</b><span className="sub">filled or stopped</span></div>
      </div>
      {list.length ? <div className="eg-grid">{list.map((o) => (
        <Link className="card eg-article" key={o.id} to={`/app/hiring/${o.id}`}>
          <div className="eg-article-h"><h3>{o.title}</h3>{o.status === "open" ? <Pill tone="ok">Open</Pill> : <Pill tone="mute">Closed</Pill>}</div>
          <p>{o.dept || "No department set"}</p>
          <span className="muted">{o.candidates} {o.candidates === 1 ? "candidate" : "candidates"}, {o.active} in progress. Opened {when(o.createdAt)}.</span>
        </Link>))}</div>
        : <div className="card"><div className="empty">No roles yet. Open a role to start tracking candidates.</div></div>}
      {adding && <NewOpening onClose={() => setAdding(false)} onDone={() => { setAdding(false); toast("The role is open."); reload(); }} />}
    </section>
  );
}

function NewOpening({ onClose, onDone }) {
  const [f, setF] = useState({ title: "", dept: "", description: "" }), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    const r = await api("POST", "/api/hr/openings", f);
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone();
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Open a role</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <Field id="op-t" label="Role" error={err.title}><input id="op-t" className="input" maxLength={120} value={f.title} onChange={set("title")} placeholder="For example: Senior Frontend Developer" aria-invalid={!!err.title} /></Field>
        <Field id="op-d" label="Department (optional)"><input id="op-d" className="input" maxLength={80} value={f.dept} onChange={set("dept")} /></Field>
        <Field id="op-n" label="Notes (optional)"><textarea id="op-n" className="input" rows={4} maxLength={4000} value={f.description} onChange={set("description")} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Open role"}</button></div>
    </Modal>
  );
}

export function OpeningPage() {
  const { id } = useParams();
  const toast = useToast();
  const [d, setD] = useState(null), [error, setError] = useState(""), [editing, setEditing] = useState(null), [iv, setIv] = useState(null);
  const nav = useNavigate();
  const onboard = async (c) => { const r = await api("POST", `/api/hr/candidates/${c.id}/onboard`); if (!r.ok) { toast(apiMsg(r)); return; } toast(`${c.name}'s details are in a new onboarding draft. Please check and complete it.`); nav(r.data.to); };
  const load = () => api("GET", `/api/hr/openings/${encodeURIComponent(id)}/candidates`).then((r) => { if (r.ok) { setD(r.data); setError(""); } else { setError(apiMsg(r)); setD({}); } });
  useEffect(() => { setD(null); load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <PageSkeleton />;
  const o = d.opening, list = d.candidates || [];
  const setStatus = async (status) => { const r = await api("POST", `/api/hr/openings/${o.id}/status`, { status }); if (!r.ok) toast(apiMsg(r)); else { toast(status === "closed" ? "The role was closed." : "The role is open again."); load(); } };
  const move = async (c, stage) => { const r = await api("PUT", `/api/hr/candidates/${c.id}`, { ...c, stage }); if (!r.ok) toast(apiMsg(r)); else { toast(`${c.name} moved to ${stageName(stage)}.`); load(); } };
  return (
    <section className="section">
      <BackButton to="/app/hiring" label="Hiring" />
      {error || !o ? <Callout>{error || "This role is not available."}</Callout> : <>
        <SectionHead title={o.title} sub={[o.dept, o.description].filter(Boolean).join(". ") || "No notes for this role."}
          actions={<>{o.status === "open" ? <button type="button" className="btn glass" onClick={() => setStatus("closed")}>Close role</button> : <button type="button" className="btn glass" onClick={() => setStatus("open")}>Reopen role</button>}
            <button type="button" className="btn primary" onClick={() => setEditing({})}>Add a candidate</button></>} />
        <div className="rb-stats six db-strip">{STAGES.map(([k, n]) => <div className="rb-stat" key={k}><span className="lbl">{n}</span><b>{list.filter((c) => c.stage === k).length}</b></div>)}</div>
        <div className="card">{list.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>Candidate</th><th>Contact</th><th>Notes</th><th>Stage</th><th>Move to</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{list.map((c) => (
              <tr key={c.id}><td><b style={{ fontWeight: 700 }}>{c.name}</b><div className="muted">Updated {when(c.updatedAt)}</div></td><td>{c.email || "No email"}<div className="muted">{c.phone}</div></td>
                <td style={{ maxWidth: 320, whiteSpace: "pre-wrap" }}>{c.notes || "None"}</td><td><Pill tone={STAGE_TONE[c.stage]}>{stageName(c.stage)}</Pill></td>
                <td><select className="input" aria-label={`Move ${c.name} to a stage`} value={c.stage} onChange={(e) => move(c, e.target.value)} style={{ minWidth: 150 }}>{STAGES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></td>
                <td><div className="flex flex-wrap justify-end gap-2">
                  {c.stage === "hired" && <button type="button" className="btn primary sm" onClick={() => onboard(c)}>Start onboarding</button>}
                  {c.stage !== "hired" && c.stage !== "rejected" && <button type="button" className="btn glass sm" onClick={() => setIv(c)}>Interviews</button>}
                  <button type="button" className="btn glass sm" onClick={() => setEditing(c)}>Edit</button></div></td></tr>))}</tbody>
          </table></div>) : <div className="empty">No candidates yet. Add the first one.</div>}
        </div>
        {iv && <InterviewsFor c={iv} role={o.title} onClose={() => { setIv(null); load(); }} />}
        {editing && <CandidateForm openingId={o.id} c={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toast("The candidate was saved."); load(); }} />}
      </>}
    </section>
  );
}

function CandidateForm({ openingId, c, onClose, onDone }) {
  const [f, setF] = useState({ name: c.name || "", email: c.email || "", phone: c.phone || "", notes: c.notes || "", stage: c.stage || "applied" }), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    const r = c.id ? await api("PUT", `/api/hr/candidates/${c.id}`, f) : await api("POST", `/api/hr/openings/${openingId}/candidates`, f);
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone();
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>{c.id ? "Edit candidate" : "Add a candidate"}</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <Field id="cd-n" label="Name" error={err.name}><input id="cd-n" className="input" maxLength={120} value={f.name} onChange={set("name")} aria-invalid={!!err.name} /></Field>
        <Field id="cd-e" label="Email (optional)" error={err.email}><input id="cd-e" type="email" className="input" value={f.email} onChange={set("email")} aria-invalid={!!err.email} /></Field>
        <Field id="cd-p" label="Phone (optional)"><input id="cd-p" className="input" maxLength={30} value={f.phone} onChange={set("phone")} /></Field>
        <Field id="cd-s" label="Stage"><select id="cd-s" className="input" value={f.stage} onChange={set("stage")}>{STAGES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
        <Field id="cd-t" label="Notes (optional)"><textarea id="cd-t" className="input" rows={4} maxLength={4000} value={f.notes} onChange={set("notes")} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save candidate"}</button></div>
    </Modal>
  );
}

/* A candidate's interviews: who said what, and scheduling the next one. Interviewers are told and add it to their calendar. */
function InterviewsFor({ c, role, onClose }) {
  const { people } = useData();
  const staff = (people || []).filter((p) => p.status !== "offboarded");
  const toast = useToast();
  const { data, reload } = useList(`/api/hr/candidates/${c.id}/interviews`);
  const [f, setF] = useState({ at: "", minutes: "45", mode: "video", place: "", note: "", interviewers: [] }), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); const r = await api("POST", `/api/hr/candidates/${c.id}/interviews`, { ...f, minutes: Number(f.minutes) }); setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    setErr({}); setF({ ...f, at: "", note: "", interviewers: [] }); toast("The interview was scheduled, and the interviewers have been told."); reload();
  };
  const cancel = async (x) => { const r = await api("POST", `/api/hr/interviews/${x.id}/cancel`); if (!r.ok) toast(apiMsg(r)); else { toast("The interview was cancelled."); reload(); } };
  const list = (data && data.interviews) || [];
  const v = (k) => VERDICTS.find(([x]) => x === k) || ["", k, "mute"];
  return (
    <Modal wide onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Interviews: {c.name}, {role}</h3></div>
      <div className="card-b">
        {list.length > 0 && <ul className="m-0 flex list-none flex-col gap-4 p-0">{list.map((x) => (
          <li key={x.id} className="flex flex-col gap-2 rounded-field p-4 shadow-[inset_0_0_0_1px_var(--line-2)]">
            <div className="flex flex-wrap items-center justify-between gap-2"><b className="font-bold">{ivTime(x.at)}, {x.minutes} minutes, {MODE[x.mode] || x.mode}</b>
              {x.cancelled ? <Pill>Cancelled</Pill> : <div className="flex flex-wrap gap-2"><a className="btn glass sm" href={`/api/interviews/${x.id}/calendar`} download>Calendar file</a><button type="button" className="btn glass sm" onClick={() => cancel(x)}>Cancel</button></div>}</div>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">{x.interviewers.map((i) => (
              <li key={i.email} className="text-[15px]"><span className="font-bold">{i.name}</span>: {i.verdict ? <><Pill tone={v(i.verdict.verdict)[2]}>{v(i.verdict.verdict)[1]}</Pill> <span className="whitespace-pre-wrap text-ink-dim">{i.verdict.notes}</span></> : <span className="text-ink-faint">No recommendation yet.</span>}</li>))}</ul>
          </li>))}</ul>}
        <h4 className="m-0 font-display text-[18px] font-medium">Schedule an interview</h4>
        {err.form && <Callout>{err.form}</Callout>}
        <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
          <Field id="iv-at" label="Date and time, India time" error={err.at}><input id="iv-at" type="datetime-local" className="input" value={f.at} onChange={set("at")} aria-invalid={!!err.at} /></Field>
          <Field id="iv-m" label="Length" error={err.minutes}><select id="iv-m" className="input" value={f.minutes} onChange={set("minutes")}>{[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></Field>
          <Field id="iv-mo" label="How" error={err.mode}><select id="iv-mo" className="input" value={f.mode} onChange={set("mode")}>{Object.entries(MODE).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
        </div>
        <Field id="iv-pl" label={f.mode === "video" ? "Meeting link (optional)" : f.mode === "phone" ? "Number to call (optional)" : "Where (optional)"} error={err.place}><input id="iv-pl" className="input" maxLength={300} value={f.place} onChange={set("place")} aria-invalid={!!err.place} /></Field>
        <Field id="iv-who" label="Interviewers, up to five" error={err.interviewers}><PeoplePicker id="iv-who" multi people={staff} value={f.interviewers} onChange={(x) => setF({ ...f, interviewers: x })} /></Field>
        <Field id="iv-no" label="Note for the interviewers (optional)" hint="For example, what to focus on."><textarea id="iv-no" className="input" rows={2} maxLength={500} value={f.note} onChange={set("note")} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Close</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Scheduling…" : "Schedule interview"}</button></div>
    </Modal>
  );
}
