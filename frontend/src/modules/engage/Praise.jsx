import { useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import { Avatar, Callout, Pill, SectionHead, ViewTabs, ListSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { problems, useList, usePerson, when } from "./shared.jsx";

export const BADGES = [["thanks", "Thank you"], ["team-player", "Team player"], ["problem-solver", "Problem solver"], ["above-and-beyond", "Above and beyond"], ["mentor", "Mentor"]];
const badgeName = (k) => (BADGES.find(([b]) => b === k) || BADGES[0])[1];

/* Me > Praise: thank a colleague in public. Everyone sees the wall; "Received" and "Given" are your own. */
export default function Praise() {
  const [scope, setScope] = useState(() => (new URLSearchParams(window.location.search).get("view") === "rewards" ? "rewards" : "all"));
  const rewardsView = scope === "rewards";
  const { data, error, reload } = useList(rewardsView ? "/api/rewards" : `/api/praise?scope=${scope}`);
  const toast = useToast();
  const person = usePerson();
  const [adding, setAdding] = useState(false);
  const list = (data && (rewardsView ? data.rewards : data.praise)) || [];
  const remove = async (x) => { const r = await api("DELETE", `/api/praise/${x.id}`); if (!r.ok) toast(apiMsg(r)); else { toast("The praise was removed."); reload(); } };
  return (
    <section className="section">
      <SectionHead title="Praise" sub="Thank a colleague for something they did. Everyone at Wohlig can see it."
        actions={<button type="button" className="btn primary" onClick={() => setAdding(true)}>Praise a colleague</button>}
        tabs={<ViewTabs label="Praise" view={scope} onView={setScope} views={[["all", "Everyone"], ["mine", "Received"], ["given", "Given"], ["rewards", "My rewards"]]} />} />
      {error && <Callout>{error}</Callout>}
      {!data ? <ListSkeleton /> : rewardsView ? (list.length ? <div className="eg-grid">{list.map((x) => (
        <article className="card eg-praise" key={x.id}>
          <div className="eg-praise-h"><Avatar person={person(x.to)} /><div><b>{x.title}</b><span>from {x.from.name}, {when(x.createdAt)}</span></div><Pill tone="info">Reward</Pill></div>
          {x.message && <p>{x.message}</p>}
        </article>))}</div>
        : <div className="card"><div className="empty">You have not received a reward yet.</div></div>)
      : list.length ? <div className="eg-grid">{list.map((x) => (
        <article className="card eg-praise" key={x.id}>
          <div className="eg-praise-h"><Avatar person={person(x.to)} /><div><b>{x.to.name}</b><span>from {x.from.name}, {when(x.createdAt)}</span></div><Pill tone="info">{badgeName(x.badge)}</Pill></div>
          <p>{x.message}</p>
          {x.canDelete && <button type="button" className="btn link nolink" onClick={() => remove(x)}>Remove</button>}
        </article>))}</div>
        : <div className="card"><div className="empty">{scope === "mine" ? "You have not received praise yet." : scope === "given" ? "You have not praised anyone yet." : "No praise yet. Be the first to thank a colleague."}</div></div>}
      {adding && <NewPraise onClose={() => setAdding(false)} onDone={() => { setAdding(false); toast("Your praise was shared."); reload(); }} />}
    </section>
  );
}

function NewPraise({ onClose, onDone }) {
  const { user } = useAuth();
  const { people } = useData();
  const others = (people || []).filter((p) => p.status !== "offboarded" && p.email.toLowerCase() !== user.email.toLowerCase()).sort((a, b) => a.name.localeCompare(b.name));
  const [to, setTo] = useState(""), [message, setMessage] = useState(""), [badge, setBadge] = useState("thanks");
  const [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await api("POST", "/api/praise", { to, message, badge });
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone();
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Praise a colleague</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <Field id="pr-to" label="Who" error={err.to}><select id="pr-to" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!!err.to}><option value="">Choose a colleague</option>{others.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}</select></Field>
        <Field id="pr-b" label="For"><select id="pr-b" className="input" value={badge} onChange={(e) => setBadge(e.target.value)}>{BADGES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
        <Field id="pr-m" label="What they did" error={err.message}><textarea id="pr-m" className="input" rows={4} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="For example: Stayed late to get the release out and kept everyone calm." aria-invalid={!!err.message} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Sharing…" : "Share praise"}</button></div>
    </Modal>
  );
}
