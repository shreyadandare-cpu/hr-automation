import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import BackButton from "../../components/BackButton.jsx";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import { Callout, Person, Pill, SectionHead, ToolIcon, shortDate } from "../../components/ui.jsx";
import { Field } from "../../components/Modal.jsx";
import { useToast } from "../../components/toast.jsx";
import { R } from "../../lib/leave.js";
import { STATUS, TOOLS } from "../../lib/people.js";
import { lc, useLeave } from "../../lib/useLeave.js";
import SettlementSummary from "./SettlementSummary.jsx";

const OW_STEPS = ["Who is leaving", "Access", "Last day & settlement", "Assets & checklist", "Review"];
const OFF_TOOLS = ["claude"];   // offboarding handles Claude only for now
const TOOL_DO = { gws: "Suspend, sign out everywhere, reset password, move Drive and email", gemini: "Remove the Gemini licence", claude: "Remove from the Claude Team workspace", github: "Remove from the wohlig org and teams", gcp: "Remove IAM roles from all projects" };
const OW_RET = { returned: "Returned", pending: "Not returned yet", none: "Not issued" };
const LP_COND = ["Good", "Minor wear", "Damaged"];
const OFF_TASKS = ["Laptop returned", "Final settlement cleared"];
// OFF_TASKS order: laptop, final settlement
const taskDone = (a, i) => [a.laptop.status !== "pending", a.settlement][i];
const liveTools = (p) => Object.keys(p.grants || {}).filter((k) => OFF_TOOLS.includes(k) && ["active", "failed", "created"].includes(p.grants[k]));

function StatusPill({ person }) {
  if (person.status === "active" && person.lastDay) return <Pill tone="warn">Leaving {shortDate(person.lastDay)}</Pill>;
  const [label, tone] = STATUS[person.status];
  return <Pill tone={tone}>{label}</Pill>;
}

const Stepper = ({ cur }) => (
  <div className="stepper" role="list">{OW_STEPS.map((s, i) => <div key={s} className={`stp ${cur === i + 1 ? "on" : cur > i + 1 ? "done" : ""}`} role="listitem"><b>{cur > i + 1 ? "✓" : i + 1}</b>{s}</div>)}</div>
);
const Review = ({ title, step, go, children }) => (
  <div className="card"><div className="card-h"><h3>{title}</h3><button type="button" className="btn link" onClick={() => go(step)}>Edit</button></div><div className="card-b">{children}</div></div>
);
const Pairs = ({ pairs }) => <dl className="rv">{pairs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || "—"}</dd></div>)}</dl>;
const Info = ({ children }) => <Callout>{children}</Callout>;

function LaptopFields({ l, er, pre, today, set }) {
  return (
    <div className="form">
      <Field id={pre + "serial"} label="Serial number" error={er.laptopSerial}><input className="input mono" id={pre + "serial"} maxLength={60} value={l.serial} placeholder="e.g. C02XK1ABJG5H" onChange={(x) => set({ serial: x.target.value })} /></Field>
      <Field id={pre + "date"} label="Return date" error={er.laptopDate}><input className="input" type="date" id={pre + "date"} max={today} value={l.date} onChange={(x) => set({ date: x.target.value })} /></Field>
      <Field id={pre + "condition"} label="Condition" error={er.laptopCondition}><select className="input" id={pre + "condition"} value={l.condition} onChange={(x) => set({ condition: x.target.value })}>{LP_COND.map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field id={pre + "note"} label="Note (optional)" error={er.laptopNote}><input className="input" id={pre + "note"} maxLength={300} value={l.note || ""} placeholder="Charger returned, scratch on the lid…" onChange={(x) => set({ note: x.target.value })} /></Field>
    </div>
  );
}

function assetsSummary(a) {
  const l = a.laptop;
  return [["Laptop", l.status === "returned"
    ? <>Returned · <span className="mono">{l.serial}</span> · {shortDate(l.date)}{l.condition ? ` · ${l.condition}` : ""}{l.note ? <div className="muted">{l.note}</div> : null}</>
    : l.status === "none" ? "No laptop was issued" : <span style={{ color: "var(--warn)" }}>Not returned yet</span>],
  ["Final settlement", a.settlement ? "Cleared" : "Not cleared yet"]];
}

/* What employees see: a read-only list of who is leaving and who has left. */
function OffboardView({ people }) {
  const nav = useNavigate();
  const list = people.filter((e) => ["offboarding", "offboarded"].includes(e.status) || e.lastDay).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className="section">
      <SectionHead eyebrow="Offboarding" title="How people" accent="leave." sub="When someone leaves, HR suspends their Google account first, then removes each tool and records it." />
      <div className="card"><div className="card-h"><h3>Leaving and left</h3><span className="muted">{list.length}</span></div>
        {list.length ? list.map((c) => (
          <div key={c.id} className="radio-li" style={{ cursor: "pointer" }} onClick={() => nav(`/app/employees/${encodeURIComponent(c.email)}`)}>
            <Person name={c.name} sub={`${c.title} · ${c.dept}`} color={c.color} /><span style={{ marginLeft: "auto" }}><StatusPill person={c} /></span>
          </div>)) : <div className="card-b muted">No one is leaving right now.</div>}
      </div>
    </section>
  );
}

function newOw(person, today, people, startStep) {
  const e = person || null;
  const mgr = e ? people.find((m) => m.name === e.manager && m.id !== e.id) : null;
  return {
    step: e ? 2 : 1, empId: e ? e.id : null, tools: e ? liveTools(e) : null, to: mgr ? mgr.email : "",
    lastDay: today, when: "now", reviewed: false, fromReview: false, errors: {}, q: "",
    assets: { laptop: { status: "pending", serial: "", date: today, condition: "Good", note: "" }, settlement: false }, ...(startStep ? { step: startStep } : {}),
  };
}

function Wizard({ people, offs, initial }) {
  const lv = useLeave(), toast = useToast(), nav = useNavigate();
  const { reload, reloadLeave } = useData();
  const today = lv.today;
  const [w, setW] = useState(() => newOw(initial, today, people));
  const set = (patch) => setW((x) => ({ ...x, ...patch }));
  const setLaptop = (patch) => setW((x) => ({ ...x, assets: { ...x.assets, laptop: { ...x.assets.laptop, ...patch } } }));
  const e = people.find((x) => x.id === w.empId) || null;
  const tools = w.tools || (e ? liveTools(e) : []);
  const er = w.errors;

  // Move focus to the first field with a problem.
  useEffect(() => {
    if (!Object.keys(w.errors).length) return;
    const f = document.querySelector(".ferr")?.closest(".field")?.querySelector("input,select,textarea");
    if (f) f.focus();
  }, [w.errors]);

  const scrollTop = () => window.scrollTo(0, 0);
  const sched = (p) => offs.some((o) => lc(o.email) === lc(p.email) && o.status === "scheduled");
  const cands = people.filter((x) => (x.status === "active" || x.status === "onboarding") && !sched(x));
  const busy = people.filter((x) => x.status === "offboarding");
  const schedPeople = people.filter(sched);
  const link = (p) => `/app/employees/${encodeURIComponent(p.email)}`;

  const errorsFor = () => {
    const x = {};
    if (w.step === 1 && !e) x.emp = "Choose who is leaving.";
    if (w.step === 2 && tools.includes("gws")) {
      if (!w.to) x.to = "Pick who receives their Drive files and email.";
      else if (e && lc(w.to) === lc(e.email)) x.to = "Pick someone other than the person leaving.";
    }
    if (w.step === 3) {
      if (!R.validDate(w.lastDay || "")) x.lastDay = "Enter the last working day.";
      else if (w.when === "later" && w.lastDay < today) x.lastDay = "That day has passed. Choose Now instead.";
    }
    if (w.step === 4 && w.assets.laptop.status === "returned") {
      const l = w.assets.laptop;
      if (!String(l.serial || "").trim()) x.laptopSerial = "Enter the laptop serial number.";
      if (!R.validDate(l.date || "")) x.laptopDate = "Enter the date the laptop was returned.";
      else if (l.date > today) x.laptopDate = "The return date can't be in the future.";
    }
    return x;
  };
  const next = () => {
    const x = errorsFor();
    if (Object.keys(x).length) { set({ errors: x }); toast("Please fix the highlighted fields."); return; }
    set({ step: w.fromReview ? 5 : w.step + 1, fromReview: false, errors: {} }); scrollTop();
  };
  const back = () => { set({ errors: {}, step: Math.max(1, w.step - 1), fromReview: false }); scrollTop(); };
  const goStep = (s) => { set({ fromReview: w.step === 5, errors: {}, step: s }); scrollTop(); };

  const submit = async (ev) => {
    ev.preventDefault();
    if (w.step < 5) { next(); return; }
    if (!e) return;
    if (!w.reviewed) { toast("Tick the review box before submitting."); return; }
    const later = w.when === "later", day = w.lastDay;
    const r = await api("POST", "/api/offboarding", { email: e.email, lastDay: day, transferTo: w.to, when: w.when, tools, checklist: w.assets });
    if (!r.ok) { toast((r.data && (r.data.error || Object.values(r.data.errors || {})[0])) || apiMsg(r) || "Could not save. Try again."); return; }
    toast(later ? `Offboarding for ${e.name} scheduled for ${shortDate(day)}.` : `Access removed for ${e.name}. Finish the manual tasks to close it out.`);
    reload(); reloadLeave();   // leave after the last day may have been cancelled
    nav(link(e));
  };

  const mgrs = people.filter((m) => m.status === "active" && (!e || m.id !== e.id)).sort((a, b) => (a.name < b.name ? -1 : 1));
  const toName = (people.find((p) => lc(p.email) === lc(w.to)) || {}).name || "";
  const first = e ? e.name.split(" ")[0] : "";

  let body = null;
  if (w.step === 1) {
    const q = lc(w.q.trim()), hay = (c) => lc(c.name + " " + c.title + " " + c.dept + " " + c.email), shown = cands.filter((c) => !q || hay(c).includes(q));
    body = (
      <div className="card"><div className="card-h"><h3>Who is leaving?</h3><span className="muted">{cands.length} people</span></div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 16 }}>
          <input className="input" id="ow-q" type="search" placeholder="Search by name, job title or team" aria-label="Search employees" value={w.q} autoComplete="off" onChange={(x) => set({ q: x.target.value })} />
          {e && <div className="picked"><Person name={e.name} sub={`${e.title} · ${e.dept}`} color={e.color} /><span className="pill p-info">Selected</span></div>}
          {er.emp && <span className="ferr" role="alert">{er.emp}</span>}
          <div className="pick-list" role="radiogroup" aria-label="Employees">
            {shown.map((c) => (
              <label key={c.id} className="radio-li"><input type="radio" name="ow-emp" value={c.id} checked={!!e && e.id === c.id}
                onChange={() => { setW((x) => ({ ...newOw(c, today, people), step: 1, q: x.q })); }} />
                <Person name={c.name} sub={`${c.title} · ${c.dept}`} color={c.color} /><span style={{ marginLeft: "auto" }}><StatusPill person={c} /></span></label>))}
            {!shown.length && <div className="empty" id="ow-none">No one matches that search.</div>}
          </div>
        </div></div>
    );
  }
  if (w.step === 2) {
    const live = liveTools(e);
    body = (
      <>
        <div className="card"><div className="card-h"><h3>Access to remove</h3><span className="muted">Claude</span></div><div className="card-b">
          {live.length ? <div className="tiles">{live.map((id) => (
            <label key={id} className="tile"><input type="checkbox" id={`ow-tool-${id}`} value={id} checked={tools.includes(id)}
              onChange={(x) => set({ tools: x.target.checked ? [...tools, id] : tools.filter((t) => t !== id) })} />
              <ToolIcon tool={TOOLS[id]} state="active" /><span className="t"><b>{TOOLS[id].name}</b><span>{TOOL_DO[id]}</span></span></label>))}</div>
            : <p className="muted" style={{ margin: 0 }}>{e.name} has no tool access to remove.</p>}</div></div>
        {OFF_TOOLS.includes("gws") && <div className="card"><div className="card-h"><h3>Handover</h3></div><div className="card-b form">
          <Field id="ow-to" label="Move Drive files and email to" error={er.to} hint={tools.includes("gws") ? "Needed because Google Workspace is being removed." : "Only needed when Google Workspace is removed."}>
            <select className="input" id="ow-to" value={w.to} onChange={(x) => set({ to: x.target.value })}><option value="">Choose…</option>{mgrs.map((m) => <option key={m.id} value={m.email}>{m.name}</option>)}</select></Field>
        </div></div>}
      </>
    );
  }
  if (w.step === 3) body = (
    <>
      <div className="card"><div className="card-h"><h3>Last working day</h3></div><div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="form">
          <Field id="ow-day" label="Last working day" error={er.lastDay}><input className="input" type="date" id="ow-day" value={w.lastDay} onChange={(x) => set({ lastDay: x.target.value })} /></Field>
          <div className="field"><span className="lab">When to remove access</span><div className="seg">
            <label><input type="radio" name="ow-when" value="now" checked={w.when === "now"} onChange={() => set({ when: "now" })} />Now</label>
            <label><input type="radio" name="ow-when" value="later" checked={w.when === "later"} onChange={() => set({ when: "later" })} />On the last working day</label></div></div>
        </div>
        <Info>{w.when === "later" ? <>Access is removed automatically at <b>6:00 pm</b> on the last working day. Until then HR can remove it early or call the offboarding off.</> : "Access is removed as soon as you submit."}</Info>
      </div></div>
      <div className="card"><div className="card-h"><h3>Final settlement</h3><span className="muted">Leave only</span></div><div className="card-b" id="ow-settle"><SettlementSummary person={e} lastDay={w.lastDay} open /></div></div>
    </>
  );
  if (w.step === 4) {
    const a = w.assets;
    body = (
      <>
        <div className="card"><div className="card-h"><h3>Company laptop</h3><span className={`pill ${a.laptop.status === "pending" ? "p-warn" : "p-ok"}`}>{OW_RET[a.laptop.status]}</span></div>
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div className="field"><span className="lab">Has {first} returned the laptop?</span>
              <div className="seg" role="radiogroup" style={{ alignSelf: "flex-start" }}>{Object.entries(OW_RET).map(([k, v]) => (
                <label key={k}><input type="radio" name="ow-lp" value={k} checked={a.laptop.status === k} onChange={() => { setLaptop({ status: k }); set({ errors: {} }); }} />{v}</label>))}</div></div>
            {a.laptop.status === "returned" ? <LaptopFields l={a.laptop} er={er} pre="ow-lp-" today={today} set={setLaptop} />
              : a.laptop.status === "pending" ? <Info>The offboarding stays open until the laptop is back. Tick <b>Laptop returned</b> on {first}'s checklist when it comes in; you'll be asked for the serial number then.</Info> : null}
          </div></div>
        <div className="card"><div className="card-h"><h3>Exit checklist</h3><span className="muted">Tick if it's already done</span></div>
          <label className="check"><input type="checkbox" id="ow-fnf" checked={a.settlement} onChange={(x) => set({ assets: { ...a, settlement: x.target.checked } })} />
            <div className="grow"><div className="lbl">Final settlement cleared</div><div className="tag">Leave payout and dues, see step 3</div></div></label></div>
      </>
    );
  }
  if (w.step === 5) {
    const open = OFF_TASKS.filter((_, i) => !taskDone(w.assets, i));
    body = (
      <>
        <Review title="Who is leaving" step={1} go={goStep}><Pairs pairs={[["Name", e.name], ["Job title", e.title], ["Department", e.dept], ["Work email", <span className="mono">{e.email}</span>]]} /></Review>
        <Review title="Access" step={2} go={goStep}>
          <div className="chips" style={{ marginBottom: 14 }}>{tools.map((id) => <span key={id} className="chip"><ToolIcon tool={TOOLS[id]} state="active" />{TOOLS[id].name}</span>)}{!tools.length && <span className="muted">No tool access to remove</span>}</div>
          {OFF_TOOLS.includes("gws") && <Pairs pairs={[["Drive files and email go to", toName]]} />}</Review>
        <Review title="Last working day" step={3} go={goStep}><Pairs pairs={[["Last working day", shortDate(w.lastDay)], ["Access removed", w.when === "later" ? `On ${shortDate(w.lastDay)} at 6:00 pm` : "Right away, when you submit"]]} /></Review>
        <Review title="Final settlement" step={3} go={goStep}><SettlementSummary person={e} lastDay={w.lastDay} open /></Review>
        <Review title="Assets & checklist" step={4} go={goStep}><Pairs pairs={assetsSummary(w.assets)} /></Review>
        {open.length > 0 && <Info>Still open after you submit: <b>{open.join(", ")}</b>. The offboarding closes once {open.length === 1 ? "it is" : "they are"} ticked on the employee's checklist.</Info>}
        <div className="callout bad">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></svg>
          <div>{first} will lose access to <b>{tools.length} tool{tools.length === 1 ? "" : "s"}</b>{w.when === "later" ? ` on ${shortDate(w.lastDay)} at 6:00 pm` : " right away"}, and their HR Access Hub login is removed. Every step is written to the audit log.</div></div>
        <label className="check" style={{ border: 0, padding: 0 }}><input type="checkbox" id="ow-reviewed" checked={w.reviewed} onChange={(x) => set({ reviewed: x.target.checked })} /><div className="grow"><div className="lbl">I have reviewed all the details above</div></div></label>
      </>
    );
  }

  return (
    <section className="section">
      <BackButton to="/app/offboarding" />
      <SectionHead eyebrow="Offboarding" title="Remove access," accent="step by step." sub="Pick who is leaving, confirm the access to remove, set the last day, then review. Nothing happens until you submit." />
      {busy.length > 0 && <Info>{busy.map((b, i) => <span key={b.id}>{i > 0 && ", "}<b>{b.name}</b></span>)} {busy.length > 1 ? "are" : "is"} still being offboarded. <Link className="btn link" to={link(busy[0])}>Open checklist</Link></Info>}
      {schedPeople.length > 0 && <Info>Scheduled: {schedPeople.map((b, i) => <span key={b.id}>{i > 0 && " · "}<Link className="btn link" to={link(b)}>{b.name}, {shortDate(b.lastDay)}</Link></span>)}</Info>}
      <Stepper cur={w.step} />
      <form id="owf" className="grid" style={{ gap: 22 }} noValidate onSubmit={submit}>
        {body}
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">{w.step > 1 ? <button type="button" className="btn glass" onClick={back}>Back</button> : <button type="button" className="btn glass" onClick={() => nav("/app/employees")}>Cancel</button>}</div>
          {w.step === 5 ? <button type="submit" className="btn danger" id="ow-submit" disabled={!w.reviewed}>{w.when === "later" ? "Schedule offboarding" : "Offboard now"}</button>
            : <button type="button" className="btn primary" onClick={next}>{w.fromReview ? "Back to review" : "Continue"}</button>}
        </div>
      </form>
    </section>
  );
}

export default function Offboarding() {
  const { isHr } = useAuth();
  const { people } = useData();
  const [params] = useSearchParams();
  const [offs, setOffs] = useState(null);

  useEffect(() => {
    if (!isHr) return;
    api("GET", "/api/offboarding").then((r) => setOffs(r.ok && Array.isArray(r.data) ? r.data : []));
  }, [isHr]);

  if (!people || (isHr && !offs)) return <section className="section"><div className="empty">Loading…</div></section>;
  if (!isHr) return <OffboardView people={people} />;
  const want = params.get("email");
  const initial = want ? people.find((p) => lc(p.email) === lc(want) && (p.status === "active" || p.status === "onboarding") && !offs.some((o) => lc(o.email) === lc(p.email) && o.status === "scheduled")) : null;
  return <Wizard people={people} offs={offs} initial={initial || null} key={initial ? initial.id : "new"} />;
}
