import { useState } from "react";
import { api, apiMsg } from "../../api.js";
import Modal, { Field } from "../../components/Modal.jsx";
import ConfirmDialog from "../../components/ConfirmDialog.jsx";
import { Callout, Pill, SectionHead, PageSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { problems, useList, when } from "./shared.jsx";

/* Engage > Polls. Everyone votes once per poll (and may change their vote until it closes). Totals show after you vote
   or when the poll closes, and never who chose what. HR creates and removes polls. */
export default function Polls() {
  const { data, error, reload } = useList("/api/polls");
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(0);
  if (!data) return <PageSkeleton />;
  const polls = data.polls || [];

  const vote = async (p, option) => {
    setBusy(p.id);
    const r = await api("POST", `/api/polls/${p.id}/vote`, { option });
    setBusy(0);
    if (!r.ok) { toast(apiMsg(r)); return; }
    toast(p.myVote === null ? "Your vote is in." : "Your vote was changed."); reload();
  };

  return (
    <section className="section">
      <SectionHead title="Polls" sub="Quick questions for everyone. You see the totals once you have voted; nobody sees how you voted."
        actions={data.canManage ? <button type="button" className="btn primary" onClick={() => setAdding(true)}>Create a poll</button> : null} />
      {error && <Callout>{error}</Callout>}
      {polls.length ? <div className="eg-grid">{polls.map((p) => (
        <article className="card eg-poll" key={p.id}>
          <div className="card-h"><h3>{p.question}</h3>{p.closed ? <Pill tone="mute">Closed</Pill> : <Pill tone="ok">Open</Pill>}</div>
          <div className="card-b" role="group" aria-label={p.question}>
            {p.options.map((o, i) => {
              const pct = p.totals && p.votes ? Math.round(p.totals[i] / p.votes * 100) : 0;
              return (
                <button key={i} type="button" className={`eg-opt ${p.myVote === i ? "on" : ""}`} disabled={p.closed || busy === p.id} aria-pressed={p.myVote === i} onClick={() => vote(p, i)}>
                  {p.totals && <i style={{ width: `${pct}%` }} aria-hidden="true" />}
                  <span>{o}</span>{p.totals && <b>{pct}%</b>}
                </button>);
            })}
            <div className="eg-meta">
              <span>{p.votes} {p.votes === 1 ? "vote" : "votes"}{p.closesAt ? `, ${p.closed ? "closed" : "closes"} ${when(p.closesAt)}` : ""}</span>
              {data.canManage && <button type="button" className="btn link nolink" onClick={() => setRemoving(p)}>Remove</button>}
            </div>
          </div>
        </article>))}</div>
        : <div className="card"><div className="empty">{data.canManage ? "No polls yet. Create one to ask everyone a quick question." : "There are no polls right now."}</div></div>}
      {adding && <NewPoll onClose={() => setAdding(false)} onDone={() => { setAdding(false); toast("The poll is live."); reload(); }} />}
      {removing && <ConfirmDialog title="Remove this poll?" confirmLabel="Remove poll" danger onClose={() => setRemoving(null)}
        onConfirm={async () => { const r = await api("DELETE", `/api/polls/${removing.id}`); setRemoving(null); if (!r.ok) toast(apiMsg(r)); else { toast("The poll was removed."); reload(); } }}>
        “{removing.question}” and its votes will no longer be shown to anyone.</ConfirmDialog>}
    </section>
  );
}

function NewPoll({ onClose, onDone }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [closesAt, setClosesAt] = useState("");
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await api("POST", "/api/polls", { question, options, closesAt: closesAt ? `${closesAt}T23:59:59` : null });
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone();
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Create a poll</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <Field id="pl-q" label="Question" error={err.question}><input id="pl-q" className="input" value={question} maxLength={200} onChange={(e) => setQuestion(e.target.value)} placeholder="For example: Which day suits the team lunch?" aria-invalid={!!err.question} /></Field>
        <div className="field"><span className="lab">Options</span>
          {options.map((o, i) => (
            <div className="row" key={i} style={{ flexWrap: "nowrap" }}>
              <input className="input" aria-label={`Option ${i + 1}`} value={o} maxLength={80} placeholder={`Option ${i + 1}`} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
              {options.length > 2 && <button type="button" className="btn glass sm" aria-label={`Remove option ${i + 1}`} onClick={() => setOptions(options.filter((_, j) => j !== i))}>Remove</button>}
            </div>))}
          {err.options && <span className="ferr" role="alert">{err.options}</span>}
          {options.length < 6 && <button type="button" className="btn link nolink" style={{ alignSelf: "flex-start" }} onClick={() => setOptions([...options, ""])}>Add another option</button>}
        </div>
        <Field id="pl-c" label="Closes on (optional)" hint="Leave empty to keep the poll open until you remove it." error={err.closesAt}><input id="pl-c" type="date" className="input" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Publish poll"}</button></div>
    </Modal>
  );
}
