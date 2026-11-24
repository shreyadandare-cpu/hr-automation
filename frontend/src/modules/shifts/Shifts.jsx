import { useState } from "react";
import Modal from "../../components/Modal.jsx";
import ConfirmDialog from "../../components/ConfirmDialog.jsx";
import PeoplePicker from "../../components/PeoplePicker.jsx";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import { Callout, ListSkeleton, PersonCell, Pill, SectionHead, ViewTabs } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { useList, usePerson, when } from "../engage/shared.jsx";

/* Attendance > Shifts and overtime, as Keka has them.
   Shifts: the hours people work, the grace for arriving late and the weekly days off; one is the default.
   Roster: who is on which shift from a date. Overtime: the month's extra hours of the staff paid overtime, worked out from
   punches, approved or rejected (by HR, or by a manager for their team). Payroll never pays it by itself: the approved hours
   show on the payroll line and HR types the amount. Late arrival and early leaving are marked on attendance, never deducted. */
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hoursText = (m) => { const h = Math.floor(m / 60), r = m % 60; return h && r ? `${h} h ${r} min` : h ? `${h} h` : `${r} min`; };
const thisMonth = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const timeLabel = (t) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };

export default function Shifts() {
  const { canAll, can } = useAuth();
  const manages = canAll("shifts.manage"), approves = can("overtime.approve");
  const views = [...(manages ? [["shifts", "Shifts"], ["roster", "Roster"]] : []), ...(approves ? [["overtime", "Overtime"]] : []), ...(manages ? [["staff", "Paid overtime"], ["clockin", "Clock-in"]] : [])];
  const [tab, setTab] = useState(views[0] ? views[0][0] : "");
  if (!views.length) return <section className="section"><SectionHead title="Shifts and overtime" /><div className="empty">Only the people given shift management or overtime approval can use this page.</div></section>;
  return (
    <section className="section">
      <SectionHead title="Shifts and overtime" sub="The hours people work, who is on which shift, and the overtime to approve. Late arrival is marked on attendance only; nothing is deducted."
        tabs={views.length > 1 ? <ViewTabs label="Shifts and overtime" view={tab} onView={setTab} views={views} /> : null} />
      {tab === "shifts" ? <ShiftList /> : tab === "roster" ? <Roster /> : tab === "overtime" ? <Overtime /> : tab === "clockin" ? <ClockIn /> : <PaidStaff />}
    </section>
  );
}

/* ---------- shifts ---------- */
function ShiftList() {
  const toast = useToast();
  const { data, error, reload } = useList("/api/shifts");
  const [edit, setEdit] = useState(null);
  if (!data) return <ListSkeleton faces={false} rows={3} />;
  const list = data.shifts || [];
  const act = async (method, url, done) => { const r = await api(method, url); if (!r.ok) return toast(apiMsg(r)); toast(done); reload(); };
  return (
    <>
      {error && <Callout>{error}</Callout>}
      <div className="flex justify-end"><button type="button" className="btn primary" onClick={() => setEdit({})}>Add a shift</button></div>
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">{list.map((s) => (
        <article key={s.id} className="card flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="m-0 font-display text-[19px] font-medium">{s.name}</h3>{s.isDefault ? <Pill tone="ok">Default</Pill> : <Pill>{s.people === 0 ? "Nobody on it now" : s.people === 1 ? "1 person on it" : `${s.people} people on it`}</Pill>}</div>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
            <dt className="text-ink-dim">Hours</dt><dd className="m-0">{timeLabel(s.start)} to {timeLabel(s.end)}</dd>
            <dt className="text-ink-dim">Late after</dt><dd className="m-0">{s.graceMinutes} minutes</dd>
            <dt className="text-ink-dim">Days off</dt><dd className="m-0">{s.weeklyOffs.length ? s.weeklyOffs.map((d) => DAY_NAMES[d]).join(" and ") : "None"}</dd>
            <dt className="text-ink-dim">Full day</dt><dd className="m-0">{hoursText(s.presentMinutes)}, half day {hoursText(s.halfDayMinutes)}</dd>
            <dt className="text-ink-dim">Overtime from</dt><dd className="m-0">{s.overtimeAfterMinutes} minutes beyond the shift</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn glass sm" onClick={() => setEdit(s)}>Edit</button>
            {!s.isDefault && <button type="button" className="btn glass sm" onClick={() => act("POST", `/api/shifts/${s.id}/default`, `${s.name} is now the default shift.`)}>Make default</button>}
            {!s.isDefault && <button type="button" className="btn glass sm" onClick={() => act("DELETE", `/api/shifts/${s.id}`, `${s.name} was retired.`)}>Retire</button>}
          </div>
        </article>))}</div>
      <Callout>Everyone not on the roster works the default shift. A day counts as Present from the full-day hours and as a Half day from the half-day hours. Overtime is the time worked beyond the shift on a working day; weekend and holiday work still earns a comp-off.</Callout>
      {edit && <ShiftForm shift={edit} onClose={(saved) => { setEdit(null); if (saved) reload(); }} />}
    </>
  );
}

function ShiftForm({ shift, onClose }) {
  const toast = useToast();
  const isNew = !shift.id;
  const [f, setF] = useState({ name: shift.name || "", start: shift.start || "09:30", end: shift.end || "18:30", graceMinutes: shift.graceMinutes ?? 15, weeklyOffs: shift.weeklyOffs || [0, 6],
    presentMinutes: shift.presentMinutes ?? 360, halfDayMinutes: shift.halfDayMinutes ?? 180, overtimeAfterMinutes: shift.overtimeAfterMinutes ?? 30 });
  const [er, setEr] = useState({}), [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggleDay = (d) => setF({ ...f, weeklyOffs: f.weeklyOffs.includes(d) ? f.weeklyOffs.filter((x) => x !== d) : [...f.weeklyOffs, d].sort() });
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    const r = await api(isNew ? "POST" : "PUT", isNew ? "/api/shifts" : `/api/shifts/${shift.id}`, { ...f, graceMinutes: Number(f.graceMinutes), presentMinutes: Number(f.presentMinutes), halfDayMinutes: Number(f.halfDayMinutes), overtimeAfterMinutes: Number(f.overtimeAfterMinutes) });
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors) || {}); if (!(r.data && r.data.errors)) toast(apiMsg(r)); return; }
    toast(isNew ? "The shift was added." : "The shift was saved."); onClose(true);
  };
  const field = (k, label, props = {}, hint = "") => (
    <div className="field"><label htmlFor={`sf-${k}`}>{label}</label><input id={`sf-${k}`} className="input" value={f[k]} onChange={set(k)} aria-invalid={!!er[k]} {...props} />{hint && <span className="hint">{hint}</span>}{er[k] && <span className="ferr" role="alert">{er[k]}</span>}</div>);
  return (
    <Modal onClose={() => onClose(false)}><form onSubmit={save} noValidate>
      <div className="card-h"><h3>{isNew ? "Add a shift" : `Edit ${shift.name}`}</h3></div>
      <div className="card-b">
        {field("name", "Name", { maxLength: 60, placeholder: "For example: Early shift" })}
        <div className="grid grid-cols-2 gap-4 max-xs:grid-cols-1">{field("start", "Starts at", { type: "time" })}{field("end", "Ends at", { type: "time" })}</div>
        <div className="grid grid-cols-2 gap-4 max-xs:grid-cols-1">{field("graceMinutes", "Late after (minutes of grace)", { type: "number", min: 0, max: 120, inputMode: "numeric" })}{field("overtimeAfterMinutes", "Overtime counts from (minutes)", { type: "number", min: 0, max: 600, inputMode: "numeric" }, "Extra time shorter than this is not overtime.")}</div>
        <div className="grid grid-cols-2 gap-4 max-xs:grid-cols-1">{field("presentMinutes", "Full day (minutes)", { type: "number", min: 30, inputMode: "numeric" }, "360 is 6 hours.")}{field("halfDayMinutes", "Half day (minutes)", { type: "number", min: 0, inputMode: "numeric" }, "180 is 3 hours.")}</div>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0"><legend className="lab mb-1 p-0">Weekly days off</legend>
          <div className="flex flex-wrap gap-2">{DAYS.map((d, i) => (
            <label key={d} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-field border px-3 text-[15px] ${f.weeklyOffs.includes(i) ? "border-maroon bg-tint" : "border-line"}`}>
              <input type="checkbox" checked={f.weeklyOffs.includes(i)} onChange={() => toggleDay(i)} aria-label={DAY_NAMES[i]} />{d}</label>))}</div>
          {er.weeklyOffs && <span className="ferr" role="alert">{er.weeklyOffs}</span>}</fieldset>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose(false)}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save shift"}</button></div>
    </form></Modal>
  );
}

/* ---------- roster ---------- */
function Roster() {
  const toast = useToast();
  const { people } = useData();
  const staff = (people || []).map((x) => ({ email: x.email, name: x.name, title: x.title }));
  const [month, setMonth] = useState(thisMonth());
  const { data, error, reload } = useList(`/api/shifts/roster?month=${month}`);
  const { data: sh } = useList("/api/shifts");
  const person = usePerson();
  const [f, setF] = useState({ emails: [], shiftId: "", from: `${thisMonth()}-01`, to: "" }), [er, setEr] = useState({}), [busy, setBusy] = useState(false);
  const shifts = (sh && sh.shifts) || [];
  const add = async () => {
    setBusy(true);
    const r = await api("POST", "/api/shifts/roster", { ...f, shiftId: Number(f.shiftId) });
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors) || {}); if (!(r.data && r.data.errors)) toast(apiMsg(r)); return; }
    setEr({}); setF({ ...f, emails: [] }); toast(r.data.added === 1 ? "The person is on the shift." : `${r.data.added} people are on the shift.`); reload();
  };
  const remove = async (x) => { const r = await api("DELETE", `/api/shifts/roster/${x.id}`); if (!r.ok) return toast(apiMsg(r)); toast("The roster entry was taken off."); reload(); };
  return (
    <>
      <div className="card"><div className="card-h"><h3>Put people on a shift</h3></div>
        <div className="card-b flex flex-col gap-4">
          <div className="field"><label htmlFor="rs-who">People</label><PeoplePicker id="rs-who" multi people={staff} value={f.emails} onChange={(v) => setF({ ...f, emails: v || [] })} />{er.emails && <span className="ferr" role="alert">{er.emails}</span>}</div>
          <div className="grid grid-cols-3 items-start gap-4 max-md:grid-cols-1">
            <div className="field"><label htmlFor="rs-shift">Shift</label><select id="rs-shift" className="input" value={f.shiftId} onChange={(e) => setF({ ...f, shiftId: e.target.value })} aria-invalid={!!er.shiftId}><option value="">Choose a shift</option>{shifts.map((s) => <option key={s.id} value={s.id}>{s.name}, {timeLabel(s.start)} to {timeLabel(s.end)}</option>)}</select>{er.shiftId && <span className="ferr" role="alert">{er.shiftId}</span>}</div>
            <div className="field"><label htmlFor="rs-from">From</label><input id="rs-from" type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-invalid={!!er.from} />{er.from && <span className="ferr" role="alert">{er.from}</span>}</div>
            <div className="field"><label htmlFor="rs-to">Until (optional)</label><input id="rs-to" type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-invalid={!!er.to} /><span className="hint">Empty means until changed. After an end date people go back to their earlier shift.</span>{er.to && <span className="ferr" role="alert">{er.to}</span>}</div>
          </div>
          <div><button type="button" className="btn primary" disabled={busy} onClick={add}>{busy ? "Saving…" : "Put on the shift"}</button></div>
        </div>
      </div>
      <div className="card"><div className="card-h"><h3>Roster for {monthLabel(month)}</h3>
        <input type="month" className="input w-auto" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></div>
        {error && <div className="card-b"><Callout>{error}</Callout></div>}
        {!data ? <ListSkeleton rows={3} /> : (data.entries || []).length ? (
          <ul className="m-0 flex list-none flex-col p-0">{data.entries.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-3 first:border-t-0 max-sm:px-4">
              <PersonCell person={person(x.person)} sub={`${x.shift.name}, from ${when(x.from)}${x.to ? ` to ${when(x.to)}` : ""}`} />
              <button type="button" className="btn glass sm" onClick={() => remove(x)} aria-label={`Take ${x.person.name} off ${x.shift.name}`}>Take off</button></li>))}</ul>)
          : <div className="empty">Nobody is rostered this month, so everyone works the default shift.</div>}
      </div>
    </>
  );
}

/* ---------- overtime ---------- */
function Overtime() {
  const toast = useToast();
  const [month, setMonth] = useState(thisMonth());
  const { data, error, reload } = useList(`/api/overtime?month=${month}`);
  const person = usePerson();
  const [f, setF] = useState({}), [er, setEr] = useState({}), [open, setOpen] = useState(null), [busy, setBusy] = useState(false);
  const decide = async (x, decision) => {
    const v = f[x.person.email] || {};
    setBusy(true);
    const r = await api("PUT", `/api/overtime/${encodeURIComponent(x.person.email)}/${month}`, { decision, hours: v.hours ?? "", note: v.note || "" });
    setBusy(false);
    const key = x.person.email;
    if (!r.ok) { setEr({ ...er, [key]: (r.data && r.data.errors && (r.data.errors.hours || r.data.errors.note || r.data.errors.decision)) || apiMsg(r) }); return; }
    setEr({ ...er, [key]: "" }); toast(decision === "approved" ? "The overtime was approved, and the person was told." : "The overtime was rejected, and the person was told."); reload();
  };
  const list = (data && data.people) || [];
  const set = (email, k) => (e) => setF({ ...f, [email]: { ...(f[email] || {}), [k]: e.target.value } });
  return (
    <>
      {error && <Callout>{error}</Callout>}
      <div className="card"><div className="card-h"><h3>Overtime for {monthLabel(month)}</h3>
        <input type="month" className="input w-auto" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></div>
        {!data ? <ListSkeleton rows={3} /> : list.length ? (
          <ul className="m-0 flex list-none flex-col p-0">{list.map((x) => {
            const key = x.person.email, own = data.me && key.toLowerCase() === data.me, d = x.decision;
            return (
              <li key={key} className="flex flex-col gap-3 border-t border-line px-6 py-4 first:border-t-0 max-sm:px-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <PersonCell person={person(x.person)} sub={`Worked out from punches: ${x.overtimeMinutes ? hoursText(x.overtimeMinutes) : "none"}`} />
                  {d ? <Pill tone={d.status === "approved" ? "ok" : "bad"}>{d.status === "approved" ? `Approved ${hoursText(d.approvedMinutes)}` : "Rejected"}</Pill> : <Pill tone="warn">Not decided</Pill>}
                </div>
                {d && d.note && <p className="m-0 text-[14px] text-ink-dim">Note: {d.note}</p>}
                {x.days.length > 0 && <button type="button" className="btn link nolink self-start" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>{open === key ? "Hide the days" : `See the ${x.days.length === 1 ? "day" : `${x.days.length} days`}`}</button>}
                {open === key && <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0 max-sm:grid-cols-1">{x.days.map((y) => (
                  <li key={y.date} className="rounded-field bg-tint px-3 py-2 text-[14px]"><b className="font-bold">{when(y.date)}</b><span className="block text-ink-dim">{y.firstIn} to {y.lastOut || "no punch out"}, {y.shift}</span><span className="tabular-nums">{hoursText(y.minutes)} extra</span></li>))}</ul>}
                {!own && <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-[14px] text-ink-dim">Hours to approve<input className="input w-44" inputMode="decimal" placeholder={`Empty: ${hoursText(x.overtimeMinutes)}`} value={(f[key] || {}).hours ?? ""} onChange={set(key, "hours")} /></label>
                  <label className="sr-only" htmlFor={`ot-note-${key}`}>Note for {x.person.name}</label>
                  <input id={`ot-note-${key}`} className="input min-w-0 flex-1 basis-[220px] max-sm:basis-full" maxLength={300} placeholder="Note (needed to reject or to change the hours)" value={(f[key] || {}).note || ""} onChange={set(key, "note")} />
                  <button type="button" className="btn primary sm" disabled={busy} onClick={() => decide(x, "approved")}>Approve</button>
                  <button type="button" className="btn glass sm" disabled={busy} onClick={() => decide(x, "rejected")}>Reject</button>
                </div>}
                {er[key] && <span className="ferr" role="alert">{er[key]}</span>}
              </li>);
          })}</ul>) : <div className="empty">{data.canManageStaff ? "Nobody is on the list of staff paid overtime yet. Add them under Paid overtime." : "None of the people you look after are paid overtime."}</div>}
      </div>
      <Callout>Approved hours appear on the person's payroll line. Payroll pays overtime only as the payroll team enters the amount there; nothing is paid by itself.</Callout>
    </>
  );
}

/* ---------- who is paid overtime ---------- */
function PaidStaff() {
  const toast = useToast();
  const { people } = useData();
  const staff = (people || []).map((x) => ({ email: x.email, name: x.name, title: x.title }));
  const { data, error, reload } = useList("/api/overtime/staff");
  const person = usePerson();
  const [email, setEmail] = useState(""), [busy, setBusy] = useState(false);
  const save = async (who, eligible) => {
    setBusy(true);
    const r = await api("PUT", "/api/overtime/staff", { email: who, eligible });
    setBusy(false);
    if (!r.ok) return toast((r.data && r.data.errors && r.data.errors.email) || apiMsg(r));
    toast(eligible ? "The person was added." : "The person was removed."); setEmail(""); reload();
  };
  return (
    <>
      {error && <Callout>{error}</Callout>}
      <div className="card"><div className="card-h"><h3>Staff paid overtime</h3></div>
        <div className="card-b flex flex-col gap-4">
          <p className="m-0 text-ink-dim">Overtime is worked out for everyone, but only the people here have it approved each month. Payroll then pays it as the payroll team enters it on the payslip.</p>
          <div className="flex flex-wrap items-end gap-3"><div className="field m-0 min-w-0 flex-1 basis-[260px]"><label htmlFor="ot-add">Add a person</label><PeoplePicker id="ot-add" people={staff} value={email} onChange={(v) => setEmail(v || "")} /></div>
            <button type="button" className="btn primary" disabled={busy || !email} onClick={() => save(email, true)}>Add</button></div>
        </div>
        {!data ? <ListSkeleton rows={3} /> : (data.staff || []).length ? (
          <ul className="m-0 flex list-none flex-col p-0">{data.staff.map((x) => (
            <li key={x.person.email} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-3 max-sm:px-4">
              <PersonCell person={person(x.person)} sub={`Added ${when(x.addedAt)}`} />
              <button type="button" className="btn glass sm" disabled={busy} onClick={() => save(x.person.email, false)} aria-label={`Remove ${x.person.name}`}>Remove</button></li>))}</ul>)
          : <div className="empty">Nobody is paid overtime yet.</div>}
      </div>
    </>
  );
}

/* ---------- clock-in: web punching, location and selfie, and the offices ---------- */
const SWITCHES = [
  ["enabled", "Let everyone punch in and out from the app", "The button appears on Home. The office machine keeps working as before."],
  ["needLocation", "Ask for the person's location", "The punch is checked against the offices below. With no office listed, the location is only recorded."],
  ["allowOutside", "Keep punches made outside every office, and flag them", "When this is off, a punch outside every office is refused and the person asks HR to add it."],
  ["needSelfie", "Ask for a selfie", "A small picture is taken with the punch. You and the manager can open it; it is deleted after 90 days."],
];
function ClockIn() {
  const { data, error, reload } = useList("/api/attendance/clock-in");
  const toast = useToast();
  const [f, setF] = useState(null), [busy, setBusy] = useState(false), [site, setSite] = useState(null), [removing, setRemoving] = useState(null);
  const cur = f || data;
  if (error) return <Callout>{error}</Callout>;
  if (!data || !data.sites) return <div className="card"><ListSkeleton faces={false} rows={4} /></div>;
  const save = async () => {
    setBusy(true);
    const r = await api("PUT", "/api/attendance/clock-in", { enabled: !!cur.enabled, needLocation: !!cur.needLocation, needSelfie: !!cur.needSelfie, allowOutside: !!cur.allowOutside });
    setBusy(false);
    if (!r.ok) { toast(apiMsg(r)); return; }
    setF(null); toast("Clock-in settings saved."); reload();
  };
  const remove = async (x) => {
    const r = await api("DELETE", `/api/attendance/clock-in/sites/${x.id}`);
    setRemoving(null);
    if (!r.ok) toast(apiMsg(r)); else { toast(`${x.name} was removed.`); reload(); }
  };
  const changed = !!f && SWITCHES.some(([k]) => !!f[k] !== !!data[k]);
  return (
    <>
      <div className="card">
        <div className="card-h"><h3>Web clock-in</h3></div>
        <div className="card-b flex flex-col gap-4">
          {data.fromEnv && <Callout>Web clock-in is switched on for everyone in the server settings, so the first switch cannot turn it off here. Please ask the technical team if it should be off.</Callout>}
          {SWITCHES.map(([k, label, hint]) => {
            const off = (k !== "enabled" && !cur.enabled) || (k === "allowOutside" && !cur.needLocation);
            return (
              <label key={k} className={`flex min-h-11 items-start gap-3 ${off ? "opacity-60" : ""}`}>
                <input type="checkbox" className="mt-1 size-5 flex-none accent-accent" checked={!!cur[k]} disabled={off || (k === "enabled" && data.fromEnv)}
                  onChange={(e) => setF({ ...cur, [k]: e.target.checked })} />
                <span className="flex flex-col"><b className="font-bold">{label}</b><span className="text-[14px] text-ink-dim">{hint}</span></span>
              </label>);
          })}
          <div className="flex justify-end"><button type="button" className="btn primary" disabled={busy || !changed} onClick={save}>{busy ? "Saving…" : "Save settings"}</button></div>
        </div>
      </div>
      <div className="card">
        <div className="card-h"><h3>Offices</h3><button type="button" className="btn glass sm" onClick={() => setSite({})}>Add an office</button></div>
        {data.sites.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>Office</th><th>Position</th><th className="text-right">Radius</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{data.sites.map((x) => (
              <tr key={x.id}><td><b className="font-bold">{x.name}</b></td>
                <td><a className="text-accent" href={`https://www.google.com/maps?q=${x.lat},${x.lng}`} target="_blank" rel="noopener noreferrer">{x.lat.toFixed(5)}, {x.lng.toFixed(5)}</a></td>
                <td className="num-cell text-right">{x.radius} m</td>
                <td className="text-right"><span className="inline-flex flex-wrap justify-end gap-2"><button type="button" className="btn glass sm" onClick={() => setSite(x)}>Edit</button><button type="button" className="btn glass sm" onClick={() => setRemoving(x)}>Remove</button></span></td></tr>))}</tbody>
          </table></div>)
          : <div className="empty">No offices yet. Add one so punches can be checked against it.</div>}
      </div>
      {site && <SiteForm site={site} onClose={(saved) => { setSite(null); if (saved) reload(); }} />}
      {removing && <ConfirmDialog title={`Remove ${removing.name}?`} confirmLabel="Remove office" onConfirm={() => remove(removing)} onClose={() => setRemoving(null)}>
        Punches already made there keep its name. New punches are no longer matched to it.</ConfirmDialog>}
    </>
  );
}
function SiteForm({ site, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ name: site.name || "", lat: site.lat ?? "", lng: site.lng ?? "", radius: site.radius || 150 }), [err, setErr] = useState({}), [busy, setBusy] = useState(false), [finding, setFinding] = useState(false);
  const here = () => {
    if (!navigator.geolocation) { setErr({ form: "This browser cannot share your location. Please type the position." }); return; }
    setFinding(true);
    navigator.geolocation.getCurrentPosition((p) => { setFinding(false); setF((x) => ({ ...x, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) })); },
      (e) => { setFinding(false); setErr({ form: e.code === 1 ? "Please allow location access in your browser settings, or type the position." : "Your location could not be found. Please type the position." }); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };
  const save = async () => {
    setBusy(true);
    const r = await api(site.id ? "PUT" : "POST", site.id ? `/api/attendance/clock-in/sites/${site.id}` : "/api/attendance/clock-in/sites", f);
    setBusy(false);
    if (!r.ok) { setErr(r.data && r.data.errors ? r.data.errors : { form: apiMsg(r) }); return; }
    toast(site.id ? `${f.name} was saved.` : `${f.name} was added.`); onClose(true);
  };
  const field = (k, label, props = {}) => (
    <div className="field m-0"><label htmlFor={`site-${k}`}>{label}</label><input id={`site-${k}`} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-invalid={!!err[k]} {...props} />
      {err[k] && <span className="ferr" role="alert">{err[k]}</span>}</div>);
  return (
    <Modal onClose={busy ? () => {} : () => onClose(false)}>
      <div className="card-h"><h3>{site.id ? `Edit ${site.name}` : "Add an office"}</h3></div>
      <div className="card-b flex flex-col gap-4">
        {err.form && <Callout><span role="alert">{err.form}</span></Callout>}
        {field("name", "Name", { maxLength: 80, placeholder: "For example Mumbai office" })}
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          {field("lat", "Latitude", { inputMode: "decimal", placeholder: "For example 19.076090" })}
          {field("lng", "Longitude", { inputMode: "decimal", placeholder: "For example 72.877426" })}
        </div>
        <button type="button" className="btn glass self-start" onClick={here} disabled={finding}>{finding ? "Finding you…" : "Use where I am now"}</button>
        {field("radius", "Radius in metres (30 to 5,000)", { inputMode: "numeric" })}
        <p className="m-0 text-[14px] text-ink-dim">Stand in the office and use where you are now, or copy the position from Google Maps (right-click the building). 150 metres suits most buildings; phones are less precise indoors.</p>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose(false)} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save office"}</button></div>
    </Modal>
  );
}
