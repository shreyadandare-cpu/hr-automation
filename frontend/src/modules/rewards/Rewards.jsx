import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import { Avatar, Callout, Pill, SectionHead, ListSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { problems, useList, usePerson, when } from "../engage/shared.jsx";

/* Manage > Rewards: HR gives a person a reward with a short note; they are told and see it on Praise > My rewards. */
export default function Rewards() {
  const { canAll } = useAuth();
  const [params, setParams] = useSearchParams();
  const { data, error, reload } = useList("/api/rewards?scope=all");
  const person = usePerson();
  const toast = useToast();
  const [adding, setAdding] = useState(params.get("to") || (params.has("new") ? "-" : ""));
  const list = (data && data.rewards) || [];
  const close = () => { setAdding(""); if (params.has("to") || params.has("new")) setParams({}, { replace: true }); };
  if (!canAll("rewards.give")) return <section className="section"><SectionHead title="Rewards" /><div className="empty">You do not have access to rewards. Please ask a super admin if you need it.</div></section>;
  return (
    <section className="section">
      <SectionHead title="Rewards" sub="Recognise someone with a reward. They are told straight away and can see it under Praise, My rewards."
        actions={<button type="button" className="btn primary" onClick={() => setAdding("-")}>Give a reward</button>} />
      {error && <Callout>{error}</Callout>}
      {!data ? <ListSkeleton /> : list.length ? <div className="eg-grid">{list.map((x) => (
        <article className="card eg-praise" key={x.id}>
          <div className="eg-praise-h"><Avatar person={person(x.to)} /><div><b>{x.to.name}</b><span>from {x.from.name}, {when(x.createdAt)}</span></div><Pill tone="info">Reward</Pill></div>
          <p><b>{x.title}</b>{x.message ? ` · ${x.message}` : ""}</p>
        </article>))}</div>
        : <div className="card"><div className="empty">No rewards have been given yet.</div></div>}
      {adding && <NewReward to={adding === "-" ? "" : adding} onClose={close} onDone={() => { close(); toast("The reward was given. They have been told."); reload(); }} />}
    </section>
  );
}

function NewReward({ to: first, onClose, onDone }) {
  const { user } = useAuth();
  const { people } = useData();
  const others = (people || []).filter((p) => p.status !== "offboarded" && p.email.toLowerCase() !== user.email.toLowerCase()).sort((a, b) => a.name.localeCompare(b.name));
  const [to, setTo] = useState(first), [title, setTitle] = useState(""), [message, setMessage] = useState("");
  const [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await api("POST", "/api/rewards", { to, title, message });
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone();
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Give a reward</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <Field id="rw-to" label="Who" error={err.to}><select id="rw-to" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!!err.to}><option value="">Choose a colleague</option>{others.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}</select></Field>
        <Field id="rw-t" label="Reward" error={err.title}><input id="rw-t" className="input" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: Star performer of the month" aria-invalid={!!err.title} /></Field>
        <Field id="rw-m" label="Note (optional)" error={err.message}><textarea id="rw-m" className="input" rows={4} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Say why they are receiving it." /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Giving…" : "Give reward"}</button></div>
    </Modal>
  );
}
