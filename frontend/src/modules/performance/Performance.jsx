import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { Callout, CardSkeleton, ListSkeleton, PersonCell, Pill, SectionHead, ViewTabs } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { useList, usePerson, when } from "../engage/shared.jsx";

/* Performance, as Keka has it: OKRs (company and team objectives for a quarter, with key results measured from a start to a
   target, and personal goals linked to them) and 1:1 meetings between a manager and a direct report (talking points, actions,
   shared notes, and private notes only the writer sees). */
const HEALTH = { done: ["Done", "ok"], "on track": ["On track", "ok"], "at risk": ["At risk", "warn"], behind: ["Behind", "bad"] };
const quarterLabel = (q) => { const [y, n] = q.split("-Q").map(Number); return `Q${n} ${y}-${String((y + 1) % 100).padStart(2, "0")} (${["April to June", "July to September", "October to December", "January to March"][n - 1]})`; };
const shiftQuarter = (q, d) => { const [y, n] = q.split("-Q").map(Number), i = y * 4 + (n - 1) + d; return `${Math.floor(i / 4)}-Q${(i % 4) + 1}`; };
const Bar = ({ value, label }) => (
  <div className="flex items-center gap-3"><div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-tint" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
    <div className="h-full rounded-full bg-maroon" style={{ width: `${value}%` }} /></div><span className="w-11 text-right text-[14px] tabular-nums">{value}%</span></div>);

export default function Performance() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("meeting") ? "meetings" : "okrs");
  return (
    <section className="section">
      <SectionHead title="OKRs and 1:1s" sub="The company's and teams' objectives for the quarter, and your one-to-one meetings with your manager or your team."
        tabs={<ViewTabs label="Performance" view={tab} onView={setTab} views={[["okrs", "OKRs"], ["meetings", "1:1 meetings"]]} />} />
      {tab === "okrs" ? <Okrs /> : <Meetings first={Number(params.get("meeting")) || null} />}
    </section>
  );
}

/* ---------- OKRs ---------- */
function Okrs() {
  const toast = useToast();
  const [quarter, setQuarter] = useState("");
  const { data, error, reload } = useList(`/api/okrs${quarter ? `?quarter=${quarter}` : ""}`);
  const person = usePerson();
  const [adding, setAdding] = useState(null);
  if (!data) return <><CardSkeleton lines={4} /><CardSkeleton lines={4} /></>;
  const q = data.quarter || quarter;
  const list = data.objectives || [];
  const company = list.filter((o) => o.level === "company"), team = list.filter((o) => o.level === "team");
  const titleOf = (id) => (list.find((o) => o.id === id) || {}).title;
  const link = async (goal, objectiveId) => { const r = await api("PUT", `/api/okrs/goals/${goal.id}`, { objectiveId: objectiveId || null }); if (!r.ok) return toast(apiMsg(r)); toast(objectiveId ? "Your goal is linked." : "Your goal is unlinked."); reload(); };
  return (
    <>
      {error && <Callout>{error}</Callout>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="field m-0 min-w-0 flex-1 basis-[260px]"><label htmlFor="okr-q">Quarter</label>
          <select id="okr-q" className="input w-full max-w-md pr-10" value={q} onChange={(e) => setQuarter(e.target.value)}>{[-2, -1, 0, 1].map((d) => shiftQuarter(data.quarter && !quarter ? data.quarter : q, d)).filter((x, i, a) => a.indexOf(x) === i).map((x) => <option key={x} value={x}>{quarterLabel(x)}</option>)}</select></div>
        <div className="flex flex-wrap gap-2">
          {data.canCompany && <button type="button" className="btn primary" onClick={() => setAdding("company")}>Add a company objective</button>}
          {data.canTeam && <button type="button" className="btn glass" onClick={() => setAdding("team")}>Add a team objective</button>}
        </div>
      </div>
      {adding && <ObjectiveForm level={adding} quarter={q} parents={company} onClose={(saved) => { setAdding(null); if (saved) reload(); }} />}
      {!list.length ? <div className="card"><div className="empty">No objectives for this quarter yet.{data.canCompany ? " Add the company's first objective above." : data.canTeam ? " Add your team's first objective above." : " Your managers set them; please check back later."}</div></div> : <>
        {[["Company objectives", company], ["Team objectives", team]].map(([title, group]) => group.length > 0 && (
          <div key={title} className="flex flex-col gap-4"><h2 className="m-0 font-display text-[21px] font-medium">{title}</h2>
            {group.map((o) => <Objective key={o.id} o={o} supports={o.parentId ? titleOf(o.parentId) : null} person={person} onChanged={reload} />)}</div>))}
      </>}
      <div className="card"><div className="card-h"><h3>Link my goals</h3></div>
        <div className="card-b flex flex-col gap-3">
          {!(data.myGoals || []).length ? <p className="m-0 text-ink-dim">You have no goals yet. Add them on the Goals page, then link each one to the objective it supports.</p>
            : data.myGoals.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 basis-[220px]"><b className="font-bold">{g.title}</b> <span className="text-[14px] text-ink-dim">{g.progress}% done</span></span>
                <label className="sr-only" htmlFor={`goal-${g.id}`}>Objective for {g.title}</label>
                <select id={`goal-${g.id}`} className="input w-auto min-w-0 max-w-full flex-1 basis-[260px]" value={g.objectiveId || ""} onChange={(e) => link(g, Number(e.target.value) || null)}>
                  <option value="">Not linked</option>{list.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select>
              </div>))}
        </div>
      </div>
    </>
  );
}

function Objective({ o, supports, person, onChanged }) {
  const toast = useToast();
  const [kr, setKr] = useState({ title: "", start: "", target: "", unit: "" }), [er, setEr] = useState({}), [val, setVal] = useState({}), [busy, setBusy] = useState(false);
  const [h, tone] = HEALTH[o.health] || ["", "mute"];
  const addKr = async () => {
    setBusy(true);
    const r = await api("POST", `/api/okrs/${o.id}/key-results`, kr);
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors) || {}); if (!(r.data && r.data.errors)) toast(apiMsg(r)); return; }
    setEr({}); setKr({ title: "", start: "", target: "", unit: "" }); toast("The key result was added."); onChanged();
  };
  const update = async (k) => {
    const r = await api("PUT", `/api/okrs/key-results/${k.id}`, { current: val[k.id] });
    if (!r.ok) return toast((r.data && r.data.errors && Object.values(r.data.errors)[0]) || apiMsg(r));
    setVal({ ...val, [k.id]: undefined }); toast("Progress updated."); onChanged();
  };
  const del = async (url, done) => { const r = await api("DELETE", url); if (!r.ok) return toast(apiMsg(r)); toast(done); onChanged(); };
  return (
    <article className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-[260px]"><h3 className="m-0 font-display text-[19px] font-medium">{o.title}</h3>
          <p className="m-0 mt-1 text-[14px] text-ink-dim">{o.owner.name}{supports ? `, supports “${supports}”` : ""}</p>
          {o.detail && <p className="m-0 mt-2 text-[15px]">{o.detail}</p>}</div>
        <div className="flex flex-wrap items-center gap-2"><Pill tone={tone}>{h}</Pill>{o.canEdit && <button type="button" className="btn glass sm" onClick={() => del(`/api/okrs/${o.id}`, "The objective was removed.")}>Remove</button>}</div>
      </div>
      <Bar value={o.progress} label={`Progress of ${o.title}`} />
      {o.keyResults.length > 0 && <ul className="m-0 flex list-none flex-col gap-3 p-0">{o.keyResults.map((k) => (
        <li key={k.id} className="flex flex-col gap-2 rounded-field bg-tint p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold">{k.title}</span>
            <span className="text-[14px] text-ink-dim">{k.current}{k.unit ? ` ${k.unit}` : ""} of {k.target}{k.unit ? ` ${k.unit}` : ""} (from {k.start})</span></div>
          <Bar value={k.progress} label={`Progress of ${k.title}`} />
          {o.canEdit && <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`kr-${k.id}`}>Current value of {k.title}</label>
            <input id={`kr-${k.id}`} className="input w-40" inputMode="decimal" placeholder={`Now: ${k.current}`} value={val[k.id] ?? ""} onChange={(e) => setVal({ ...val, [k.id]: e.target.value })} />
            <button type="button" className="btn glass sm" disabled={val[k.id] === undefined || val[k.id] === ""} onClick={() => update(k)}>Update</button>
            <button type="button" className="btn link nolink" onClick={() => del(`/api/okrs/key-results/${k.id}`, "The key result was removed.")}>Remove</button></div>}
        </li>))}</ul>}
      {o.goals.length > 0 && <div><h4 className="m-0 mb-2 text-[15px] font-bold">Goals linked to it</h4>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">{o.goals.map((g) => <li key={g.id} className="flex flex-wrap items-center justify-between gap-2"><PersonCell person={person(g.person)} sub={g.title} /><span className="text-[14px] tabular-nums">{g.progress}%</span></li>)}</ul></div>}
      {o.canEdit && <div className="flex flex-col gap-2 border-t border-line pt-3">
        <span className="text-[15px] font-bold">Add a key result</span>
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 max-md:grid-cols-2 max-xs:grid-cols-1">
          <input className="input" aria-label="Key result" placeholder="For example: Monthly active clients" maxLength={200} value={kr.title} onChange={(e) => setKr({ ...kr, title: e.target.value })} aria-invalid={!!er.title} />
          <input className="input" aria-label="Starting value" inputMode="decimal" placeholder="Start, e.g. 20" value={kr.start} onChange={(e) => setKr({ ...kr, start: e.target.value })} aria-invalid={!!er.start} />
          <input className="input" aria-label="Target" inputMode="decimal" placeholder="Target, e.g. 50" value={kr.target} onChange={(e) => setKr({ ...kr, target: e.target.value })} aria-invalid={!!er.target} />
          <input className="input" aria-label="Unit" placeholder="Unit, e.g. clients" maxLength={20} value={kr.unit} onChange={(e) => setKr({ ...kr, unit: e.target.value })} />
        </div>
        {Object.values(er).length > 0 && <span className="ferr" role="alert">{Object.values(er)[0]}</span>}
        <div><button type="button" className="btn glass sm" disabled={busy} onClick={addKr}>{busy ? "Adding…" : "Add key result"}</button></div>
      </div>}
    </article>
  );
}

function ObjectiveForm({ level, quarter, parents, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ title: "", detail: "", parentId: "" }), [er, setEr] = useState({}), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await api("POST", "/api/okrs", { ...f, level, quarter });
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors) || {}); if (!(r.data && r.data.errors)) toast(apiMsg(r)); return; }
    toast("The objective was added. Now add its key results."); onClose(true);
  };
  return (
    <div className="card"><div className="card-h"><h3>{level === "company" ? "New company objective" : "New team objective"}</h3></div>
      <div className="card-b flex flex-col gap-4">
        <div className="field m-0"><label htmlFor="ob-title">Objective</label><input id="ob-title" className="input" maxLength={200} placeholder="For example: Make our clients' launches faster" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-invalid={!!er.title} />{er.title && <span className="ferr" role="alert">{er.title}</span>}</div>
        <div className="field m-0"><label htmlFor="ob-detail">Why it matters (optional)</label><textarea id="ob-detail" className="input min-h-20" maxLength={1000} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} /></div>
        {level === "team" && parents.length > 0 && <div className="field m-0"><label htmlFor="ob-parent">Company objective it supports (optional)</label>
          <select id="ob-parent" className="input" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}><option value="">None</option>{parents.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>}
        <div className="flex flex-wrap gap-2"><button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Add objective"}</button><button type="button" className="btn glass" onClick={() => onClose(false)}>Cancel</button></div>
      </div>
    </div>
  );
}

/* ---------- 1:1 meetings ---------- */
function Meetings({ first }) {
  const toast = useToast();
  const { data, error, reload } = useList("/api/one-on-ones");
  const person = usePerson();
  const [open, setOpen] = useState(first);
  const [f, setF] = useState({ with: "", on: "" }), [er, setEr] = useState({}), [busy, setBusy] = useState(false);
  if (!data) return <ListSkeleton rows={4} />;
  const list = data.meetings || [], upcoming = list.filter((m) => m.status === "scheduled" && m.on >= data.today).reverse(), past = list.filter((m) => !(m.status === "scheduled" && m.on >= data.today));
  const schedule = async () => {
    setBusy(true);
    const r = await api("POST", "/api/one-on-ones", f);
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors) || {}); if (!(r.data && r.data.errors)) toast(apiMsg(r)); return; }
    setEr({}); setF({ with: "", on: "" }); toast("The 1:1 is scheduled, and the other person was told."); setOpen(r.data.id); reload();
  };
  const row = (m) => (
    <li key={m.id}><button type="button" className={`flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 border-0 border-t border-line bg-transparent px-6 py-3 text-left text-ink max-sm:px-4 ${open === m.id ? "bg-tint" : ""}`} aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}>
      <PersonCell person={person(m.with)} sub={`${when(m.on)}, ${m.role === "manager" ? "your report" : "your manager"}`} />
      <span className="flex flex-wrap gap-2">{m.openActions > 0 && <Pill tone="warn">{m.openActions === 1 ? "1 open action" : `${m.openActions} open actions`}</Pill>}<Pill tone={m.status === "done" ? "ok" : m.status === "cancelled" ? "mute" : "info"}>{m.status === "done" ? "Done" : m.status === "cancelled" ? "Cancelled" : "Scheduled"}</Pill></span>
    </button>{open === m.id && <Meeting id={m.id} onChanged={reload} />}</li>);
  return (
    <>
      {error && <Callout>{error}</Callout>}
      <div className="card"><div className="card-h"><h3>Schedule a 1:1</h3></div>
        <div className="card-b">{!(data.canMeet || []).length ? <p className="m-0 text-ink-dim">1:1s are between a manager and their direct reports. You have no reporting manager or team on record; please ask HR if that is wrong.</p> :
          <div className="grid grid-cols-[2fr_1fr_auto] items-end gap-3 max-md:grid-cols-1">
            <div className="field m-0"><label htmlFor="oo-with">With</label><select id="oo-with" className="input" value={f.with} onChange={(e) => setF({ ...f, with: e.target.value })} aria-invalid={!!er.with}><option value="">Choose a person</option>{data.canMeet.map((p) => <option key={p.email} value={p.email}>{p.name}, {p.relation === "manager" ? "your manager" : "your report"}</option>)}</select>{er.with && <span className="ferr" role="alert">{er.with}</span>}</div>
            <div className="field m-0"><label htmlFor="oo-on">On</label><input id="oo-on" type="date" className="input" min={data.today} value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} aria-invalid={!!er.on} />{er.on && <span className="ferr" role="alert">{er.on}</span>}</div>
            <button type="button" className="btn primary" disabled={busy} onClick={schedule}>{busy ? "Scheduling…" : "Schedule"}</button>
          </div>}</div>
      </div>
      <div className="card"><div className="card-h"><h3>Upcoming</h3></div>{upcoming.length ? <ul className="m-0 list-none p-0">{upcoming.map(row)}</ul> : <div className="empty">No 1:1s are scheduled.</div>}</div>
      {past.length > 0 && <div className="card"><div className="card-h"><h3>Earlier</h3></div><ul className="m-0 list-none p-0">{past.map(row)}</ul></div>}
    </>
  );
}

function Meeting({ id, onChanged }) {
  const toast = useToast();
  const [m, setM] = useState(null), [item, setItem] = useState({ kind: "talking_point", text: "" }), [shared, setShared] = useState(""), [priv, setPriv] = useState(""), [err, setErr] = useState("");
  const load = async () => { const r = await api("GET", `/api/one-on-ones/${id}`); if (!r.ok) return setErr(apiMsg(r)); setM(r.data); setShared(r.data.sharedNotes); setPriv(r.data.privateNotes); };
  useEffect(() => { load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="px-6 pb-4"><Callout>{err}</Callout></div>;
  if (!m) return <div className="px-6 pb-4"><CardSkeleton lines={3} /></div>;
  const act = async (method, url, body, done) => { const r = await api(method, url, body); if (!r.ok) { toast((r.data && r.data.errors && Object.values(r.data.errors)[0]) || apiMsg(r)); return false; } if (done) toast(done); await load(); onChanged(); return true; };
  const add = async () => { if (await act("POST", `/api/one-on-ones/${id}/items`, item, null)) setItem({ ...item, text: "" }); };
  const list = (kind) => m.items.filter((i) => i.kind === kind);
  return (
    <div className="flex flex-col gap-4 border-t border-line bg-tint px-6 py-4 max-sm:px-4">
      <div className="flex flex-wrap gap-2">
        {m.status !== "done" && <button type="button" className="btn primary sm" onClick={() => act("PUT", `/api/one-on-ones/${id}`, { status: "done" }, "Marked as done.")}>Mark as done</button>}
        {m.status === "scheduled" && <button type="button" className="btn glass sm" onClick={() => act("PUT", `/api/one-on-ones/${id}`, { status: "cancelled" }, "The 1:1 was cancelled, and the other person was told.")}>Cancel the meeting</button>}
        {m.status !== "scheduled" && <button type="button" className="btn glass sm" onClick={() => act("PUT", `/api/one-on-ones/${id}`, { status: "scheduled" }, "The 1:1 is scheduled again.")}>Schedule it again</button>}
      </div>
      {m.openFromEarlier.length > 0 && <div><h4 className="m-0 mb-1 text-[15px] font-bold">Still open from earlier 1:1s</h4>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">{m.openFromEarlier.map((i) => <li key={i.id} className="flex flex-wrap items-center gap-2 text-[15px]"><label className="flex min-h-11 items-center gap-2"><input type="checkbox" onChange={() => act("PUT", `/api/one-on-ones/items/${i.id}`, { done: true }, "Marked as done.")} />{i.text}</label><span className="text-[13px] text-ink-faint">{i.owner ? `${i.owner.name}, ` : ""}from {when(i.on)}</span></li>)}</ul></div>}
      {[["talking_point", "Talking points"], ["action", "Actions"]].map(([kind, title]) => (
        <div key={kind}><h4 className="m-0 mb-1 text-[15px] font-bold">{title}</h4>
          {list(kind).length ? <ul className="m-0 flex list-none flex-col gap-1 p-0">{list(kind).map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2 text-[15px]">
              <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={i.done} onChange={(e) => act("PUT", `/api/one-on-ones/items/${i.id}`, { done: e.target.checked })} /><span className={i.done ? "text-ink-faint line-through" : ""}>{i.text}</span></label>
              {i.owner && kind === "action" && <span className="text-[13px] text-ink-faint">{i.owner.name}</span>}
              {i.mine && <button type="button" className="btn link nolink" onClick={() => act("DELETE", `/api/one-on-ones/items/${i.id}`, null, "Removed.")} aria-label={`Remove ${i.text}`}>Remove</button>}</li>))}</ul>
            : <p className="m-0 text-[14px] text-ink-dim">{kind === "action" ? "No actions yet." : "No talking points yet. Add what you would like to discuss."}</p>}
        </div>))}
      <div className="flex flex-wrap items-end gap-2">
        <label className="sr-only" htmlFor={`it-kind-${id}`}>Kind</label>
        <select id={`it-kind-${id}`} className="input w-auto" value={item.kind} onChange={(e) => setItem({ ...item, kind: e.target.value })}><option value="talking_point">Talking point</option><option value="action">Action</option></select>
        <label className="sr-only" htmlFor={`it-text-${id}`}>Text</label>
        <input id={`it-text-${id}`} className="input min-w-0 flex-1 basis-[240px]" maxLength={500} placeholder={item.kind === "action" ? "For example: Share the release plan by Friday" : "For example: Feedback on the client demo"} value={item.text} onChange={(e) => setItem({ ...item, text: e.target.value })} />
        <button type="button" className="btn glass sm" disabled={!item.text.trim()} onClick={add}>Add</button>
      </div>
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <div className="field m-0"><label htmlFor={`sh-${id}`}>Shared notes (both of you see these)</label><textarea id={`sh-${id}`} className="input min-h-28" maxLength={5000} value={shared} onChange={(e) => setShared(e.target.value)} />
          <div><button type="button" className="btn glass sm mt-2" disabled={shared === m.sharedNotes} onClick={() => act("PUT", `/api/one-on-ones/${id}`, { sharedNotes: shared }, "The shared notes were saved.")}>Save shared notes</button></div></div>
        <div className="field m-0"><label htmlFor={`pr-${id}`}>My private notes (only you see these)</label><textarea id={`pr-${id}`} className="input min-h-28" maxLength={5000} value={priv} onChange={(e) => setPriv(e.target.value)} />
          <div><button type="button" className="btn glass sm mt-2" disabled={priv === m.privateNotes} onClick={() => act("PUT", `/api/one-on-ones/${id}/private`, { notes: priv }, "Your private notes were saved.")}>Save private notes</button></div></div>
      </div>
    </div>
  );
}
