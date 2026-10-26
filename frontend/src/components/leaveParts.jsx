import { useState } from "react";
import { api, apiMsg } from "../api.js";
import { useData } from "../data.jsx";
import { useToast } from "./toast.jsx";
import Modal, { Field } from "./Modal.jsx";
import { Pill, shortDate } from "./ui.jsx";
import { R } from "../lib/leave.js";
import { lc, useLeave } from "../lib/useLeave.js";

/* Approve and decline buttons for people who may decide, otherwise who it is waiting for. kind: "requests" or "comp-offs". */
export function DecideButtons({ kind, id, email }) {
  const lv = useLeave(), { reloadLeave } = useData(), toast = useToast();
  if (!lv.canDecide(email)) return <Pill tone="warn">Waiting for {lv.approverName(email)}</Pill>;
  const decide = async (decision) => {
    const r = await api("POST", `/api/leave/${kind}/${id}/decision`, { decision });
    if (!r.ok) { toast(apiMsg(r)); return; }
    const who = (lv.empBy(email) || {}).name || email;
    toast(kind === "requests" ? `Leave for ${who} ${decision}${decision === "approved" && r.data.lopDays ? `, ${r.data.lopDays} loss of pay` : ""}.` : `Comp off for ${who} ${decision}.`);
    reloadLeave();
  };
  return <div className="row" style={{ gap: 8 }}><button type="button" className="btn glass sm" onClick={() => decide("declined")}>Decline</button><button type="button" className="btn primary sm" onClick={() => decide("approved")}>Approve</button></div>;
}

/* Errors from the server come back as { errors: { field: message } }. */
const errorsOf = (r) => (r.data && r.data.errors) || {};

/* HR records a comp-off day on someone's behalf. */
export function CompOffModal({ onClose }) {
  const lv = useLeave(), { people, reloadLeave } = useData(), toast = useToast();
  const [f, setF] = useState({ email: "", workedOn: "", reason: "" }), [er, setEr] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const r = await api("POST", "/api/leave/comp-offs", f);
    if (!r.ok) { setEr(errorsOf(r)); if (!Object.keys(errorsOf(r)).length) toast(apiMsg(r)); return; }
    toast(`Comp off added for ${(lv.empBy(f.email) || {}).name}.`); reloadLeave(); onClose();
  };
  const choices = people.filter((p) => p.status !== "offboarded").sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Modal onClose={onClose}><form onSubmit={submit} noValidate>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Record comp off</h3></div>
      <div className="card-b">
        <div className="muted" style={{ fontSize: 13 }}>One comp-off day for working on a Saturday, Sunday or holiday. It can be used until 31 December that year.</div>
        <Field id="lc-email" label="Employee" error={er.email}><select className="input" id="lc-email" value={f.email} onChange={set("email")}><option value="">Choose…</option>{choices.map((p) => <option key={p.id} value={p.email}>{p.name}</option>)}</select></Field>
        <Field id="lc-day" label="Date they worked" error={er.workedOn}><input className="input" type="date" id="lc-day" max={lv.today} value={f.workedOn} onChange={set("workedOn")} /></Field>
        <Field id="lc-reason" label="What they worked on" error={er.reason}><input className="input" id="lc-reason" placeholder="For example: weekend release" value={f.reason} onChange={set("reason")} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button><button type="submit" className="btn primary">Add comp off</button></div>
    </form></Modal>
  );
}

/* The employee asks for a comp-off credit; their reporting manager approves it. */
export function CompRequestModal({ email, onClose }) {
  const lv = useLeave(), { reloadLeave } = useData(), toast = useToast();
  const [f, setF] = useState({ workedOn: "", reason: "" }), [er, setEr] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  // Say straight away what the picked day is, so a working day is obvious before sending.
  let what = "Pick a Saturday, Sunday or company holiday.", dayErr = "";
  if (R.validDate(f.workedOn)) {
    const day = new Date(f.workedOn + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long" }), hol = lv.holidays.find((h) => h.day === f.workedOn);
    if (f.workedOn > lv.today) { what = ""; dayErr = "That date hasn't happened yet."; }
    else if (hol) what = `${day}, company holiday: ${hol.name}.`;
    else if (R.isWeekend(f.workedOn)) what = `${day}. This counts for a comp off.`;
    else { what = ""; dayErr = `${day} is a working day, so it doesn't earn a comp off.`; }
  }
  const submit = async (e) => {
    e.preventDefault();
    const r = await api("POST", "/api/leave/comp-off-requests", { email, ...f });
    if (!r.ok) { setEr(errorsOf(r)); if (!Object.keys(errorsOf(r)).length) toast(apiMsg(r)); return; }
    const a = lv.approverOf(email);
    toast(`Comp off credit requested. ${a === "hr" || a === "directors" ? lv.approverName(email) : "Your reporting manager"} will review it.`); reloadLeave(); onClose();
  };
  return (
    <Modal onClose={onClose}><form onSubmit={submit} noValidate>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Request credit for comp off</h3></div>
      <div className="card-b">
        <div className="muted" style={{ fontSize: 13 }}>Worked on a Saturday, Sunday or holiday? Ask for one comp-off day. Once your reporting manager approves it, you can use it until 31 December.</div>
        <Field id="lq-day" label="Date you worked" hint={what} error={dayErr || er.workedOn}><input className="input" type="date" id="lq-day" max={lv.today} value={f.workedOn} onChange={set("workedOn")} /></Field>
        <Field id="lq-reason" label="Note" error={er.reason}><textarea className="input" id="lq-reason" rows={3} placeholder="What did you work on?" value={f.reason} onChange={set("reason")} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button><button type="submit" className="btn primary">Request credit</button></div>
    </form></Modal>
  );
}

export function PolicyModal({ onClose }) {
  const P = R.POLICY;
  return (
    <Modal onClose={onClose}>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Leave policy</h3></div>
      <div className="card-b" style={{ fontSize: 14 }}>
        <div><b>Casual leave</b>: {P.casualPerYear} days a year (January to December). Unused days carry over to next year. Joiners get a share for the months left in their first year.</div>
        <div><b>Sick leave</b>: {P.sickPerYear} days a year. Unused days lapse on 31 December.</div>
        <div><b>Comp off</b>: one day for working on a Saturday, Sunday or holiday, once your reporting manager approves it. Use it by 31 December that year.</div>
        <div><b>Unpaid leave</b>: always a salary cut.</div>
        <div><b>Half day</b>: counts as 0.5 days. Pick the first or second half.</div>
        <div><b>Over your balance</b>: extra days are loss of pay. The cut is monthly gross ÷ {P.lopDivisor} for each loss-of-pay day.</div>
        <div className="muted">Saturdays, Sundays and company holidays are never counted as leave.</div>
      </div>
      <div className="modal-f"><button type="button" className="btn primary" onClick={onClose}>Got it</button></div>
    </Modal>
  );
}

/* HR sets someone's monthly salary (for loss-of-pay cuts) and the casual leave they bring in. */
export function PayModal({ email, onClose }) {
  const lv = useLeave(), { reloadLeave } = useData(), toast = useToast();
  const p = lv.payOf(email), e = lv.empBy(email);
  const [f, setF] = useState({ monthlyGross: p.monthlyGross ?? "", casualOpening: p.casualOpening || 0 }), [er, setEr] = useState({});
  if (!e) return null;
  const submit = async (ev) => {
    ev.preventDefault();
    const r = await api("PUT", `/api/employees/${encodeURIComponent(e.email)}/pay`, { monthlyGross: f.monthlyGross, casualOpening: f.casualOpening || 0 });
    if (!r.ok) { setEr(errorsOf(r)); if (!Object.keys(errorsOf(r)).length) toast(apiMsg(r)); return; }
    const changed = [];
    if ((p.monthlyGross ?? null) !== (f.monthlyGross === "" ? null : Number(f.monthlyGross))) changed.push("monthly salary");
    if (Number(p.casualOpening || 0) !== Number(f.casualOpening || 0)) changed.push("opening casual balance");
    toast(changed.length ? `Saved for ${e.name}.` : "No changes to save."); reloadLeave(); onClose();
  };
  return (
    <Modal onClose={onClose}><form onSubmit={submit} noValidate>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Pay &amp; balance: {e.name}</h3></div>
      <div className="card-b">
        <Field id="lp-gross" label="Monthly gross salary (₹)" hint="Used only to work out the salary cut for loss-of-pay days." error={er.monthlyGross}>
          <input className="input" type="number" min="1" step="1" inputMode="numeric" id="lp-gross" value={f.monthlyGross} onChange={(ev) => setF({ ...f, monthlyGross: ev.target.value })} /></Field>
        <Field id="lp-open" label={`Casual leave carried into ${R.POLICY.startYear}`} hint="Unused casual days from before this system started. They carry over like any other casual days." error={er.casualOpening}>
          <input className="input" type="number" min="0" max="365" step="0.5" id="lp-open" value={f.casualOpening} onChange={(ev) => setF({ ...f, casualOpening: ev.target.value })} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button><button type="submit" className="btn primary">Save</button></div>
    </form></Modal>
  );
}

function HolidayModal({ holiday, onClose }) {
  const { reloadLeave } = useData(), toast = useToast();
  const [f, setF] = useState({ day: holiday.day, name: holiday.name, type: holiday.type || "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const r = await api("PUT", `/api/leave/holidays/${holiday.day}`, f);
    if (!r.ok) { toast(apiMsg(r)); return; }
    toast("Holiday saved."); reloadLeave(); onClose();
  };
  return (
    <Modal onClose={onClose}><form onSubmit={submit} noValidate>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Edit holiday</h3>{holiday.source === "imported" && <Pill tone="info">From the company holiday list</Pill>}</div>
      <div className="card-b form">
        <Field id="he-day" label="Date"><input className="input" type="date" id="he-day" value={f.day} onChange={set("day")} /></Field>
        <Field id="he-name" label="Holiday"><input className="input" id="he-name" maxLength={80} value={f.name} onChange={set("name")} /></Field>
        <Field id="he-type" label="Type (optional)"><input className="input" id="he-type" maxLength={40} placeholder="e.g. Optional, Regional" value={f.type} onChange={set("type")} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button><button type="submit" className="btn primary">Save holiday</button></div>
    </form></Modal>
  );
}

/* The company holiday list. Leave never counts these days, or Saturdays and Sundays. HR can add, edit and remove. */
export function HolidayCalendar({ editable }) {
  const lv = useLeave(), { reloadLeave } = useData(), toast = useToast();
  const [yearPick, setYearPick] = useState(null);
  const [editing, setEditing] = useState(null);
  const [add, setAdd] = useState({ day: "", name: "", type: "" });
  const today = lv.today, all = lv.holidays;
  const years = [...new Set([...all.map((h) => Number(h.day.slice(0, 4))), Number(today.slice(0, 4))])].sort();
  const y = yearPick && years.includes(yearPick) ? yearPick : Number(today.slice(0, 4));
  const list = all.filter((h) => h.day.startsWith(String(y))).sort((a, b) => (a.day < b.day ? -1 : 1));
  const wd = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long" });
  const weekend = (d) => [0, 6].includes(new Date(d + "T00:00:00").getDay());
  const next = list.find((h) => h.day >= today);
  const remove = async (h) => {
    const r = await api("DELETE", `/api/leave/holidays/${h.day}`);
    if (!r.ok) { toast(apiMsg(r)); return; }
    reloadLeave();
  };
  const addHoliday = async (e) => {
    e.preventDefault();
    const r = await api("POST", "/api/leave/holidays", add);
    if (!r.ok) { toast(apiMsg(r)); return; }
    toast(`${add.name.trim()} added as a holiday.`); setAdd({ day: "", name: "", type: "" }); reloadLeave();
  };
  return (
    <div className="card" id="holiday-calendar">
      <div className="card-h">
        <div><h3>Holiday calendar — {y}</h3><span className="muted">{list.length} holiday{list.length === 1 ? "" : "s"} · not counted as leave, like Saturdays and Sundays</span></div>
        {years.length > 1 && <select className="input" aria-label="Year" style={{ width: "auto" }} value={y} onChange={(e) => setYearPick(Number(e.target.value))}>{years.map((x) => <option key={x}>{x}</option>)}</select>}
      </div>
      {list.length ? (
        <div className="tbl-wrap"><table className="hol-table">
          <thead><tr><th>Date</th><th>Day</th><th>Holiday</th><th className="hide-sm">Type</th><th className="hide-sm">Source</th>{editable && <th><span className="sr">Actions</span></th>}</tr></thead>
          <tbody>{list.map((h) => (
            <tr key={h.day} className={`${h.day < today ? "past" : ""}${next && h.day === next.day ? " next" : ""}`}>
              <td className="num-cell"><b>{new Date(h.day + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</b></td>
              <td>{wd(h.day)}{weekend(h.day) && <> <span className="muted" style={{ fontSize: 12 }}>(weekend)</span></>}</td>
              <td>{h.name}{next && h.day === next.day && <> <Pill tone="info">Next</Pill></>}</td>
              <td className="hide-sm">{h.type || <span className="muted">—</span>}</td>
              <td className="hide-sm"><span className="muted">{h.source === "imported" ? "Company list" : "Added by HR"}</span></td>
              {editable && <td className="num"><div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                <button type="button" className="btn glass sm" aria-label={`Edit ${h.name}`} onClick={() => setEditing(h)}>Edit</button>
                <button type="button" className="btn glass sm" aria-label={`Remove ${h.name}`} onClick={() => remove(h)}>Remove</button></div></td>}
            </tr>))}</tbody>
        </table></div>
      ) : <div className="empty">No holidays for {y} yet.</div>}
      {editable && (
        <form className="li wrap" noValidate onSubmit={addHoliday}>
          <input className="input" type="date" aria-label="Holiday date" style={{ width: "auto" }} value={add.day} onChange={(e) => setAdd({ ...add, day: e.target.value })} />
          <input className="input grow" maxLength={80} placeholder="Holiday name" aria-label="Holiday name" style={{ minWidth: 140 }} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
          <input className="input" maxLength={40} placeholder="Type (optional)" aria-label="Holiday type" style={{ width: 150 }} value={add.type} onChange={(e) => setAdd({ ...add, type: e.target.value })} />
          <button type="submit" className="btn primary sm">Add holiday</button>
        </form>
      )}
      {editing && <HolidayModal holiday={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
