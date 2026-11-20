import { useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout, PersonCell, Pill, SectionHead, PageSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { problems, useList, usePerson, when } from "../engage/shared.jsx";

export const REASONS = [["better-opportunity", "A better opportunity"], ["compensation", "Pay"], ["career-growth", "Career growth"], ["relocation", "Moving city"], ["personal", "Personal reasons"],
  ["higher-studies", "Higher studies"], ["work-environment", "Work environment"], ["end-of-contract", "End of contract"], ["other", "Other"]];
const reasonName = (k) => (REASONS.find(([x]) => x === k) || ["", k])[1];

/* HR > Exit interviews: why each person left, recorded by HR after talking to them. Only for people with the exit interviews permission. The reasons add up
   at the top, so patterns show. */
export default function ExitInterviews() {
  const { data, error, reload } = useList("/api/hr/exit-interviews");
  const toast = useToast();
  const person = usePerson();
  const [editing, setEditing] = useState(null);
  const { can } = useAuth();
  if (!can("exit.manage")) return <section className="section"><SectionHead title="Exit interviews" /><div className="empty">Only the people who handle exit interviews can see this.</div></section>;
  if (!data) return <PageSkeleton />;
  const list = data.interviews || [];
  const counts = REASONS.map(([k, label]) => ({ label, n: list.filter((x) => x.reason === k).length })).filter((x) => x.n).sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...counts.map((c) => c.n));
  const rehire = list.filter((x) => x.wouldRehire === true).length;
  return (
    <section className="section">
      <SectionHead title="Exit interviews" sub="Record why each person left, after you have spoken to them. Only the people who handle exit interviews can see this."
        actions={<button type="button" className="btn primary" onClick={() => setEditing({})}>Record an exit interview</button>} />
      {error && <Callout>{error}</Callout>}
      {list.length > 0 && <div className="grid g2">
        <div className="card"><div className="card-h"><h3>Why people leave</h3><span className="muted">{list.length} recorded</span></div>
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>{counts.map((c) => <div key={c.label}><div className="row" style={{ justifyContent: "space-between" }}><span>{c.label}</span><b className="num-cell">{c.n}</b></div><div className="progress" aria-hidden="true"><i style={{ width: `${c.n / max * 100}%` }} /></div></div>)}</div>
        </div>
        <div className="rb-stats db-strip" style={{ alignContent: "start" }}>
          <div className="rb-stat"><span className="lbl">Would rehire</span><b>{rehire}</b><span className="sub">of {list.length} recorded</span></div>
          <div className="rb-stat"><span className="lbl">Most common reason</span><b style={{ fontSize: 22 }}>{counts[0] ? counts[0].label : "None yet"}</b><span className="sub">{counts[0] ? `${counts[0].n} ${counts[0].n === 1 ? "person" : "people"}` : ""}</span></div>
        </div>
      </div>}
      <div className="card">{list.length ? (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Employee</th><th>Main reason</th><th>Notes</th><th>Would rehire</th><th>Recorded</th><th aria-label="Actions" /></tr></thead>
          <tbody>{list.map((x) => (
            <tr key={x.person.email}><td><PersonCell person={person(x.person)} /></td><td>{reasonName(x.reason)}</td><td style={{ maxWidth: 360, whiteSpace: "pre-wrap" }}>{x.notes || "None"}</td>
              <td>{x.wouldRehire === true ? <Pill tone="ok">Yes</Pill> : x.wouldRehire === false ? <Pill tone="bad">No</Pill> : <Pill tone="mute">Not said</Pill>}</td><td>{when(x.updatedAt)}</td>
              <td><button type="button" className="btn glass sm" onClick={() => setEditing({ email: x.person.email, reason: x.reason, notes: x.notes, wouldRehire: x.wouldRehire })}>Edit</button></td></tr>))}</tbody>
        </table></div>) : <div className="empty">No exit interviews recorded yet.</div>}
      </div>
      {editing && <Form start={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toast("The exit interview was saved."); reload(); }} />}
    </section>
  );
}

function Form({ start, onClose, onDone }) {
  const { people } = useData();
  const leavers = (people || []).filter((p) => p.status === "offboarded" || p.status === "offboarding" || p.lastDay).sort((a, b) => a.name.localeCompare(b.name));
  const [f, setF] = useState({ email: start.email || "", reason: start.reason || "", notes: start.notes || "", wouldRehire: start.wouldRehire === true ? "yes" : start.wouldRehire === false ? "no" : "" });
  const [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    const r = await api("POST", "/api/hr/exit-interviews", { email: f.email, reason: f.reason, notes: f.notes, wouldRehire: f.wouldRehire === "yes" ? true : f.wouldRehire === "no" ? false : null });
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone();
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>{start.email ? "Edit exit interview" : "Record an exit interview"}</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <Field id="ex-p" label="Who is leaving" hint="People who are leaving or have left." error={err.email}><select id="ex-p" className="input" value={f.email} onChange={set("email")} disabled={!!start.email}><option value="">Choose a person</option>{leavers.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}</select></Field>
        <Field id="ex-r" label="Main reason for leaving" error={err.reason}><select id="ex-r" className="input" value={f.reason} onChange={set("reason")}><option value="">Choose a reason</option>{REASONS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
        <Field id="ex-n" label="Notes from the conversation"><textarea id="ex-n" className="input" rows={5} maxLength={4000} value={f.notes} onChange={set("notes")} /></Field>
        <Field id="ex-h" label="Would we rehire them"><select id="ex-h" className="input" value={f.wouldRehire} onChange={set("wouldRehire")}><option value="">Not said</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    </Modal>
  );
}
