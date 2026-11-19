import { useState } from "react";
import { api, apiMsg } from "../../api.js";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout, Pill, SectionHead, shortDate, PageSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { problems, useList } from "./shared.jsx";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";

/* Whose goals the viewer may read with goals.view: everyone (whole company), or everyone below the team roots they were given
   (their own email when none is named), following the reporting manager names in the staff list. */
function goalsScope(people, me, all, roots) {
  if (all) return () => true;
  if (!Array.isArray(roots) || !roots.length) return () => false;
  const lc = (s) => String(s || "").toLowerCase(), byName = new Map();
  for (const p of people) { const m = lc(p.manager); if (m) { if (!byName.has(m)) byName.set(m, []); byName.get(m).push(p); } }
  const out = new Set(), stack = roots.map((r) => people.find((p) => lc(p.email) === lc(r || me))).filter(Boolean);
  while (stack.length) { const boss = stack.pop(); for (const k of byName.get(lc(boss.name)) || []) if (!out.has(lc(k.email))) { out.add(lc(k.email)); stack.push(k); } }
  return (p) => out.has(lc(p.email));
}

/* Me > Goals (performance): what you are working towards, with a due date and how far along it is.
   You, your reporting manager and the people allowed to see goals can see them. Praise from colleagues lives on Me > Praise. */
export default function Goals() {
  const { user, access, canAll } = useAuth();
  const { people } = useData();
  const [who, setWho] = useState("");   // empty = your own goals
  const meRow = (people || []).find((p) => p.email.toLowerCase() === user.email.toLowerCase());
  const inScope = goalsScope(people || [], user.email, canAll("goals.view"), access["goals.view"]);   // the server checks each person again
  const others = (people || []).filter((p) => p.status !== "offboarded" && p.email.toLowerCase() !== user.email.toLowerCase()
    && (inScope(p) || (meRow && p.manager && p.manager.toLowerCase() === meRow.name.toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name));
  const theirs = who ? others.find((p) => p.email === who) : null;
  const { data, error, reload } = useList(who ? `/api/goals?email=${encodeURIComponent(who)}` : "/api/goals");
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  if (!data) return <PageSkeleton />;
  const goals = data.goals || [];
  const done = goals.filter((g) => g.progress >= 100).length;
  const remove = async (g) => { const r = await api("DELETE", `/api/goals/${g.id}`); if (!r.ok) toast(apiMsg(r)); else { toast("The goal was removed."); reload(); } };
  return (
    <section className="section">
      <SectionHead title={theirs ? `Goals of ${theirs.name}` : "Goals"} sub={theirs ? "What they are working towards. Only they can change their goals." : "What you are working towards this year. You, your reporting manager and HR can see your goals."}
        actions={theirs ? null : <button type="button" className="btn primary" onClick={() => setEditing({})}>Add a goal</button>} />
      {others.length > 0 && <div className="flex flex-wrap items-center gap-3"><label className="font-body text-[14px] font-bold text-ink-dim" htmlFor="gl-who">Showing</label>
        <select id="gl-who" className="input w-auto max-w-full pr-10" value={who} onChange={(e) => setWho(e.target.value)}><option value="">My goals</option>{others.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}</select></div>}
      {error && <Callout>{error}</Callout>}
      {goals.length > 0 && <div className="rb-stats four db-strip">
        <div className="rb-stat"><span className="lbl">Goals</span><b>{goals.length}</b><span className="sub">in total</span></div>
        <div className="rb-stat"><span className="lbl">Completed</span><b>{done}</b><span className="sub">at 100%</span></div>
        <div className="rb-stat"><span className="lbl">In progress</span><b>{goals.length - done}</b><span className="sub">still open</span></div>
        <div className="rb-stat"><span className="lbl">Average progress</span><b>{Math.round(goals.reduce((n, g) => n + g.progress, 0) / goals.length)}%</b><span className="sub">across all goals</span></div>
      </div>}
      {goals.length ? <div className="eg-grid">{goals.map((g) => (
        <article className="card gl-card" key={g.id}>
          <div className="row"><h3>{g.title}</h3>{g.progress >= 100 ? <Pill tone="ok">Completed</Pill> : <Pill tone="info">{g.progress}%</Pill>}</div>
          {g.detail && <p>{g.detail}</p>}
          <div className="progress" role="progressbar" aria-valuenow={g.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Progress on ${g.title}`}><i style={{ width: `${g.progress}%` }} /></div>
          <div className="row"><span className="muted">{g.dueOn ? `Due ${shortDate(g.dueOn)}` : "No due date"}</span>
            {!theirs && <span className="row" style={{ gap: 4 }}><button type="button" className="btn link nolink" onClick={() => setEditing(g)}>Update</button><button type="button" className="btn link nolink" onClick={() => remove(g)}>Remove</button></span>}</div>
        </article>))}</div>
        : <div className="card"><div className="empty">{theirs ? `${theirs.name.split(" ")[0]} has no goals yet.` : "You have no goals yet. Add one to start tracking your progress."}</div></div>}
      {editing && <GoalForm goal={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toast("Your goal was saved."); reload(); }} />}
    </section>
  );
}

function GoalForm({ goal, onClose, onDone }) {
  const [f, setF] = useState({ title: goal.title || "", detail: goal.detail || "", dueOn: goal.dueOn || "", progress: goal.progress || 0 });
  const [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    const r = goal.id ? await api("PUT", `/api/goals/${goal.id}`, f) : await api("POST", "/api/goals", f);
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone();
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>{goal.id ? "Update goal" : "Add a goal"}</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <Field id="gl-t" label="Goal" error={err.title}><input id="gl-t" className="input" maxLength={140} value={f.title} onChange={set("title")} placeholder="For example: Ship the new onboarding flow" aria-invalid={!!err.title} /></Field>
        <Field id="gl-d" label="Details (optional)" error={err.detail}><textarea id="gl-d" className="input" rows={3} maxLength={1000} value={f.detail} onChange={set("detail")} /></Field>
        <Field id="gl-due" label="Due date (optional)" error={err.dueOn}><input id="gl-due" type="date" className="input" value={f.dueOn} onChange={set("dueOn")} /></Field>
        <Field id="gl-p" label={`Progress: ${f.progress}%`} error={err.progress}><input id="gl-p" type="range" min="0" max="100" step="5" value={f.progress} onChange={set("progress")} style={{ accentColor: "var(--purple)", width: "100%" }} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save goal"}</button></div>
    </Modal>
  );
}
