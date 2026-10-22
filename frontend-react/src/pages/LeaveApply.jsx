import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { Avatar, SectionHead, shortDate } from "../components/ui.jsx";
import { Field } from "../components/Modal.jsx";
import { useToast } from "../components/toast.jsx";
import { R } from "../lib/leave.js";
import { LTYPE, dd, lc, rangeText, useLeave } from "../lib/useLeave.js";

const STEPS = ["Dates", "Leave type", "Note", "Review"];
const Stepper = ({ cur }) => (
  <div className="stepper" role="list">{STEPS.map((s, i) => <div key={s} className={`stp ${cur === i + 1 ? "on" : cur > i + 1 ? "done" : ""}`} role="listitem"><b>{cur > i + 1 ? "✓" : i + 1}</b>{s}</div>)}</div>
);
const Review = ({ title, step, go, children }) => (
  <div className="card"><div className="card-h"><h3>{title}</h3><button type="button" className="btn link" onClick={() => go(step)}>Edit</button></div><div className="card-b">{children}</div></div>
);
const Pairs = ({ pairs }) => <dl className="rv">{pairs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || "—"}</dd></div>)}</dl>;

/* Pick colleagues to tell about the leave: type to filter, click or use the arrow keys and Enter. */
function NotifyPicker({ chosen, exclude, people, onAdd, onRemove }) {
  const [text, setText] = useState(""), [open, setOpen] = useState(false), [at, setAt] = useState(0);
  const q = lc(text.trim());
  const opts = people.filter((x) => x.status !== "offboarded" && lc(x.email) !== lc(exclude) && !chosen.includes(x.email) && (!q || lc(x.name + " " + x.title).includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8);
  const pick = (x) => { onAdd(x.email); setText(""); setAt(0); };
  const key = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setAt((at + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % Math.max(1, opts.length)); }
    else if (e.key === "Enter") { e.preventDefault(); if (opts[at]) pick(opts[at]); }
    else if (e.key === "Escape") setOpen(false);
  };
  return (
    <div className="field" style={{ gridColumn: "1/-1" }}><label htmlFor="lw-notify">Notify <span className="muted">(optional)</span></label>
      <div className="combo" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
        <input className="input" id="lw-notify" type="search" placeholder="Search by name or job title" autoComplete="off" role="combobox" aria-expanded={open} aria-controls="lw-menu" aria-autocomplete="list"
          value={text} onChange={(e) => { setText(e.target.value); setAt(0); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={key} />
        {open && <div className="combo-menu" id="lw-menu" role="listbox">
          {opts.length ? opts.map((x, i) => <button key={x.email} type="button" className={`combo-opt${i === at ? " on" : ""}`} role="option" aria-selected={i === at} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(x)}>
            <Avatar person={x} /><span><b>{x.name}</b><span className="sub">{x.title}</span></span></button>) : <div className="combo-empty">No one matches that.</div>}</div>}
      </div>
      {chosen.length ? <div className="pchips">{chosen.map((x, i) => { const p = people.find((q2) => lc(q2.email) === lc(x)) || { name: x, color: "var(--purple)" };
        return <span key={x} className="pchip"><Avatar person={p} /><span>{p.name}</span><button type="button" aria-label={`Remove ${p.name}`} onClick={() => onRemove(i)}>×</button></span>; })}</div>
        : <span className="hint">They get a note about your leave. Your approver is told anyway.</span>}
    </div>
  );
}

/* Leave request: dates, type, note, review. Employees apply for themselves; HR can add leave for someone. */
export default function LeaveApply() {
  const { user, isHr } = useAuth();
  const { people, reloadLeave } = useData();
  const lv = useLeave(), toast = useToast(), nav = useNavigate();
  const [params] = useSearchParams();
  const self = !isHr || params.get("self") === "1";
  const [w, setW] = useState(() => ({ step: 1, email: self ? user.email : params.get("email") || "", dur: "full", from: lv.today, to: lv.today, half: "first", type: "", reason: "", notify: [], reviewed: false, fromReview: false, errors: {} }));
  const top = useRef(null);
  const set = (patch) => setW((x) => ({ ...x, ...patch }));
  if (!people) return <section className="section"><div className="empty">Loading…</div></section>;

  const back = self ? "/app/my-leave" : "/app/leave";
  const e = lv.empBy(w.email);
  const val = { email: w.email, type: w.type, from: w.from, to: w.dur === "half" ? w.from : w.to, half: w.dur === "half" ? w.half : null, reason: w.reason, notify: w.notify.slice() };
  const days = R.validDate(val.from) && R.validDate(val.to) && val.to >= val.from ? R.requestDays(val.from, val.to, val.half, lv.holDays) : 0;
  const bal = e && R.validDate(val.from) ? lv.bal(e, Number(val.from.slice(0, 4))) : null;
  const emp = e ? { name: e.name, status: e.status, start: e.start, casualOpening: lv.payOf(e.email).casualOpening } : null;

  const problems = () => {
    const all = R.requestProblems({ emp, type: val.type || "unpaid", from: val.from, to: val.to, half: val.half, reason: val.reason || "x", holidays: lv.holDays, existing: e ? lv.reqsOf(e.email) : [], bal });
    const pick = (ks) => Object.fromEntries(Object.entries(all).filter(([k]) => ks.includes(k)));
    if (w.step === 1) return pick(["email", "from", "to", "half"]);
    if (w.step === 2) return w.type ? pick(["type"]) : { type: "Pick a leave type." };
    if (w.step === 3) return w.reason.trim() ? {} : { reason: "Note is required." };
    return {};
  };
  const scrollTop = () => window.scrollTo(0, 0);
  const next = () => {
    const er = problems();
    if (Object.keys(er).length) { set({ errors: er }); toast("Please fix the highlighted fields."); return; }
    set({ step: w.fromReview ? 4 : w.step + 1, fromReview: false, errors: {} }); scrollTop();
  };
  const goStep = (s) => { set({ fromReview: w.step === 4, errors: {}, step: s }); scrollTop(); };
  const backStep = () => { set({ errors: {}, step: Math.max(1, w.step - 1), fromReview: false }); scrollTop(); };
  const submit = async (ev) => {
    ev.preventDefault();
    if (w.step < 4) { next(); return; }
    if (!w.reviewed) { toast("Tick the review box before submitting."); return; }
    const r = await api("POST", "/api/leave/requests", val);
    if (!r.ok) {
      const errs = (r.data && r.data.errors) || {}, k = Object.keys(errs)[0];
      if (!k) { toast(apiMsg(r)); return; }
      set({ errors: errs, step: ["email", "from", "to", "half"].includes(k) ? 1 : k === "type" ? 2 : 3, reviewed: false }); toast(errs[k]); return;
    }
    toast(self ? (lv.approverOf(val.email) === "hr" ? "Leave requested. HR will review it." : "Leave requested. Your manager will review it.") : `Leave request for ${e.name} sent for approval.`);
    reloadLeave(); nav(back);
  };

  const er = w.errors;
  let preview = null;
  if (e && days && val.type && bal) {
    const a = R.allocate(val.type, days, bal);
    preview = <div className="callout" id="lw-preview"><div><b>{dd(days)}</b>. If approved: <b>{dd(a.paid)} paid</b>{a.lop > 0 && <>, <b style={{ color: "var(--bad)" }}>{dd(a.lop)} loss of pay</b></>}.</div></div>;
  }

  let body = null;
  if (w.step === 1) body = (
    <div className="card"><div className="card-h"><h3>When are you away?</h3></div><div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {!self && <Field id="lw-email" label="Employee" error={er.email}><select className="input" id="lw-email" value={w.email} onChange={(x) => set({ email: x.target.value, type: "" })}><option value="">Choose…</option>
        {people.filter((p) => p.status !== "offboarded").sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.id} value={p.email}>{p.name}</option>)}</select></Field>}
      <div className="field"><span className="lab">Duration</span><div className="seg">
        <label><input type="radio" name="lw-dur" checked={w.dur === "full"} onChange={() => set({ dur: "full" })} />Full day(s)</label>
        <label><input type="radio" name="lw-dur" checked={w.dur === "half"} onChange={() => set({ dur: "half" })} />Half day</label></div></div>
      <div className="lv-dates">
        <Field id="lw-from" label={w.dur === "half" ? "Date" : "From"} error={er.from}><input className="input" type="date" id="lw-from" value={w.from} onChange={(x) => set({ from: x.target.value, to: w.to < x.target.value ? x.target.value : w.to })} /></Field>
        <span className="lv-days">{dd(days)}</span>
        {w.dur === "half"
          ? <Field id="lw-half" label="Which half" error={er.half}><select className="input" id="lw-half" value={w.half} onChange={(x) => set({ half: x.target.value })}><option value="first">First half (morning)</option><option value="second">Second half (afternoon)</option></select></Field>
          : <Field id="lw-to" label="To" error={er.to}><input className="input" type="date" id="lw-to" value={w.to} onChange={(x) => set({ to: x.target.value })} /></Field>}
      </div>
      <p className="muted" style={{ margin: 0 }}>Saturdays, Sundays and company holidays are not counted.</p>
    </div></div>
  );
  if (w.step === 2) {
    const info = { casual: [`${bal.casual.left} days available`, "For planned time off. Unused days carry over."], sick: [`${bal.sick.left} days available`, "When you are unwell."],
      compoff: [bal.compoff.left > 0 ? `${bal.compoff.left} day${bal.compoff.left === 1 ? "" : "s"} available` : "Not available", "Uses a day earned by working a weekend or holiday."], unpaid: ["", "When your other leave has run out."] };
    body = (
      <div className="card"><div className="card-h"><h3>Type of leave</h3><span className="muted">{dd(days)} requested</span></div><div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {er.type && <span className="ferr" role="alert">{er.type}</span>}
        <div className="tiles">{Object.entries(LTYPE).map(([k, name]) => { const off = k === "compoff" && bal.compoff.left <= 0;
          return <label key={k} className={`tile${off ? " off" : ""}`}><input type="radio" name="lw-type" checked={w.type === k} disabled={off} onChange={() => set({ type: k })} />
            <span className="t"><b>{name}{info[k][0] && ` · ${info[k][0]}`}</b><span>{info[k][1]}</span></span></label>; })}</div>
        {preview}
      </div></div>
    );
  }
  if (w.step === 3) body = (
    <div className="card"><div className="card-h"><h3>Note</h3></div><div className="card-b form">
      <div style={{ gridColumn: "1/-1" }}><Field id="lw-reason" label="Note" error={er.reason}><textarea className="input" id="lw-reason" rows={3} placeholder="Type here" value={w.reason} onChange={(x) => set({ reason: x.target.value })} /></Field></div>
      <NotifyPicker chosen={w.notify} exclude={w.email} people={people} onAdd={(x) => set({ notify: [...w.notify, x] })} onRemove={(i) => set({ notify: w.notify.filter((_, k) => k !== i) })} />
    </div></div>
  );
  if (w.step === 4) body = (
    <>
      {!self && <Review title="Employee" step={1} go={goStep}><Pairs pairs={[["Name", e.name], ["Work email", <span className="mono">{e.email}</span>]]} /></Review>}
      <Review title="Dates" step={1} go={goStep}><Pairs pairs={[["Dates", rangeText(val, shortDate)], ["Days", dd(days)]]} /></Review>
      <Review title="Leave type" step={2} go={goStep}><Pairs pairs={[["Type", LTYPE[val.type]]]} />{preview}</Review>
      <Review title="Note" step={3} go={goStep}><Pairs pairs={[["Note", val.reason], ["Notify", val.notify.map((x) => (lv.empBy(x) || { name: x }).name).join(", ") || "Nobody"]]} /></Review>
      <label className="check" style={{ border: 0, padding: 0 }}><input type="checkbox" checked={w.reviewed} onChange={(x) => set({ reviewed: x.target.checked })} /><div className="grow"><div className="lbl">I have reviewed all the details above</div></div></label>
    </>
  );

  return (
    <section className="section" ref={top}>
      <SectionHead eyebrow={self ? "Me" : "Time off"} title={self ? "Request" : "Add leave for"} accent={self ? "leave." : "someone."}
        sub={self ? `Pick your dates and the type of leave, add a note, then review. ${lv.approverOf(w.email) === "hr" ? "You have no reporting manager, so HR approves it." : "Your reporting manager approves it."}` : "For when HR enters leave on an employee's behalf. It still goes to the approval list."} />
      <Stepper cur={w.step} />
      <form className="grid" style={{ gap: 22 }} noValidate onSubmit={submit}>
        {body}
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">{w.step > 1 ? <button type="button" className="btn glass" onClick={backStep}>Back</button> : <button type="button" className="btn glass" onClick={() => nav(back)}>Cancel</button>}</div>
          {w.step === 4 ? <button type="submit" className="btn primary" disabled={!w.reviewed}>Request leave</button>
            : <button type="button" className="btn primary" onClick={next}>{w.fromReview ? "Back to review" : "Continue"}</button>}
        </div>
      </form>
    </section>
  );
}
