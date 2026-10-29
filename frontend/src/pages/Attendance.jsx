import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Callout, Person, Pill, SectionHead, Stat, hours } from "../components/ui.jsx";
import { ActionsCard, AttendanceLog, DayCell, StatsCard, TimingsCard, istNow, useH24, useMonths, useNow } from "../components/attendance.jsx";
import Pager, { usePaged } from "../components/Pager.jsx";
import { useData } from "../data.jsx";

const TONE = { Present: "ok", "Half day": "warn", Working: "info", "Short hours": "warn", Absent: "bad", "On leave": "info", "Half day leave": "info", Weekend: "mute", Holiday: "mute" };
const StatusPill = ({ status }) => (status ? <Pill tone={TONE[status] || (/^Worked/.test(status) ? "ok" : "mute")}>{status}</Pill> : <span className="muted">—</span>);

/* Everyone for one day: HR sees all, a reporting manager sees their team. */
function DayTable({ day, onOpen }) {
  const people = day.people;
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? people.filter((x) => `${x.name} ${x.email} ${x.title || ""} ${x.no || ""}`.toLowerCase().includes(t)) : people;
  }, [people, q]);
  const { rows, pager } = usePaged(shown, `${day.date}|${q}`);
  const count = (s) => people.filter((x) => x.status === s).length;
  return (
    <>
      <div className="grid g4">
        <Stat value={people.filter((x) => /^(Present|Working|Half day)$/.test(x.status || "")).length} label="Punched in" />
        <Stat value={people.filter((x) => /leave$/i.test(x.status || "")).length} label="On leave" />
        <Stat value={count("Absent")} label="Absent" alert={count("Absent") > 0} />
        <Stat value={people.filter((x) => x.missingOut).length} label="No punch out" />
      </div>
      {day.off && <p className="muted">{day.holiday || day.off}: no attendance is expected on this day.</p>}
      <div className="card">
        <div className="filters"><input className="input grow" type="search" placeholder="Search any employee by name, email or role" aria-label="Search employees" value={q} onChange={(e) => setQ(e.target.value)} />
          {q.trim() && <span className="muted" style={{ whiteSpace: "nowrap" }}>{shown.length} of {people.length}</span>}</div>
        <div className="tbl-wrap"><table>
        <thead><tr><th>Employee</th><th>Status</th><th>First in</th><th>Last out</th><th className="hide-sm">Attendance visual</th><th>Hours</th></tr></thead>
        <tbody>{!rows.length && <tr><td colSpan="6"><div className="empty">{q.trim() ? `No one matches “${q.trim()}”.` : "No one to show."}</div></td></tr>}
          {rows.map((x) => (
          <tr key={x.email} className="click" tabIndex={0} onClick={() => onOpen(x)} onKeyDown={(e) => e.key === "Enter" && onOpen(x)}>
            <td><Person name={x.name} sub={x.title || x.email} /></td>
            <td><StatusPill status={x.status} />{x.missingOut && <> <Pill tone="warn">No punch out</Pill></>}</td>
            <td>{x.firstIn || "—"}</td><td>{x.lastOut || "—"}</td><td className="hide-sm"><DayCell x={x} /></td><td>{hours(x.minutes)}</td>
          </tr>
        ))}</tbody>
      </table></div><Pager {...pager} /></div>
    </>
  );
}

/* HR: the office biometric device. Each person has a user ID on the device; link the IDs to people so punches count. */
function DeviceCard({ say }) {
  const { people } = useData();
  const [d, setD] = useState(null);
  const [pick, setPick] = useState({});   // deviceUserId -> chosen email
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState({ id: "", email: "" });   // link a device ID by hand, before it has punched
  const load = useCallback(async () => { const r = await api("GET", "/api/attendance/device/users"); if (r.ok) setD(r.data); }, []);
  useEffect(() => { load(); }, [load]);
  const staff = useMemo(() => (people || []).filter((p) => p.status !== "offboarded").sort((a, b) => a.name.localeCompare(b.name)), [people]);
  if (!d) return null;
  const chosen = (u) => pick[u.deviceUserId] ?? (u.suggestion ? u.suggestion.email : "");
  const link = async (matches) => {
    if (!matches.length) return;
    setBusy(true);
    const r = await api("PUT", "/api/attendance/device/users", { matches });
    setBusy(false);
    if (!r.ok) { say(apiMsg(r)); return; }
    say(`${r.data.linked} linked${r.data.applied ? `, ${r.data.applied} waiting punches added` : ""}.`);
    setPick({}); load();
  };
  const suggested = d.unmatched.filter((u) => chosen(u));
  const last = d.lastSync && new Date(d.lastSync.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="card"><div className="card-h"><h3>Office device</h3>
      <span className="muted">{!d.keySet ? "Not set up on the server" : last ? `Last sync ${last}` : "Waiting for the first sync"}</span></div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {d.portalSync && d.portalSync.enabled && (
          <p className="muted" style={{ margin: 0 }}>
            {!d.portalSync.last ? "Portal sync is on. Waiting for its first run."
              : d.portalSync.last.error ? <>Portal sync could not run: {d.portalSync.last.error}</>
              : <>Portal sync is on. Last ran {new Date(d.portalSync.last.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}; the portal holds {d.portalSync.last.portal} punches{d.portalSync.last.added ? `, ${d.portalSync.last.added} new copied` : ", nothing new"}.</>}
          </p>)}
        {!d.keySet && <Callout>Add <span className="mono">ATTENDANCE_DEVICE_KEY</span> to the server's <span className="mono">.env</span> and restart. The same key goes into the office connector.</Callout>}
        <div>
          <div className="muted" style={{ marginBottom: 8 }}>Match a device ID to a person by hand. Use it for someone who has not punched yet, or when the suggestion is wrong.</div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input className="input" style={{ width: 150 }} aria-label="Device ID" placeholder="Device ID, e.g. 17" inputMode="numeric" maxLength={40} value={manual.id} onChange={(e) => setManual({ ...manual, id: e.target.value })} />
            <select className="input" style={{ width: "auto", minWidth: 240 }} aria-label="Person" value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })}>
              <option value="">Choose a person…</option>{staff.map((p) => <option key={p.email} value={p.email}>{p.name} ({p.no})</option>)}</select>
            <button type="button" className="btn glass sm" disabled={busy || !manual.id.trim() || !manual.email}
              onClick={async () => { await link([{ deviceUserId: manual.id.trim(), email: manual.email }]); setManual({ id: "", email: "" }); }}>Match</button>
          </div>
        </div>
        {d.unmatched.length === 0 && d.keySet && <p className="muted" style={{ margin: 0 }}>{d.mapped.length ? "Every device ID that has punched is linked to a person." : "No punches have arrived yet. Once the connector runs, the device's user IDs show up here to be linked to people."}</p>}
        {d.unmatched.length > 0 && <>
          <p style={{ margin: 0 }}><b>{d.unmatched.length}</b> device {d.unmatched.length === 1 ? "ID has" : "IDs have"} punched but {d.unmatched.length === 1 ? "is" : "are"} not linked to a person. Their punches are held and added as soon as you link them.</p>
          <div className="tbl-wrap audit-box"><table>
            <thead><tr><th>Device ID</th><th>Punches</th><th>Person</th><th></th></tr></thead>
            <tbody>{d.unmatched.map((u) => (
              <tr key={u.deviceUserId}>
                <td className="mono">{u.deviceUserId}</td><td>{u.punches}<div className="muted">{u.firstDay === u.lastDay ? u.firstDay : `${u.firstDay} to ${u.lastDay}`}</div></td>
                <td><select className="input" aria-label={`Person for device ID ${u.deviceUserId}`} value={chosen(u)} onChange={(e) => setPick({ ...pick, [u.deviceUserId]: e.target.value })}>
                  <option value="">Choose a person…</option>{staff.map((p) => <option key={p.email} value={p.email}>{p.name} ({p.no})</option>)}</select>
                  {u.suggestion && !pick[u.deviceUserId] && <div className="muted">Suggested from the employee number</div>}</td>
                <td><button type="button" className="btn glass sm" disabled={busy || !chosen(u)} onClick={() => link([{ deviceUserId: u.deviceUserId, email: chosen(u) }])}>Link</button></td>
              </tr>))}</tbody>
          </table></div>
          {suggested.length > 0 && <div className="row"><button type="button" className="btn primary sm" disabled={busy} onClick={() => link(suggested.map((u) => ({ deviceUserId: u.deviceUserId, email: chosen(u) })))}>Link all {suggested.length} with a person chosen</button></div>}
        </>}
        {d.mapped.length > 0 && <details><summary style={{ cursor: "pointer" }}>{d.mapped.length} linked {d.mapped.length === 1 ? "person" : "people"}</summary>
          <div className="tbl-wrap audit-box" style={{ marginTop: 10 }}><table>
            <thead><tr><th>Device ID</th><th>Person</th><th></th></tr></thead>
            <tbody>{d.mapped.map((m) => (
              <tr key={m.deviceUserId}><td className="mono">{m.deviceUserId}</td><td><b>{m.name}</b><div className="muted">{m.no}</div></td>
                <td><button type="button" className="btn link sm" onClick={async () => { if (!confirm(`Unlink device ID ${m.deviceUserId} from ${m.name}? Punches already recorded stay.`)) return; const r = await api("DELETE", `/api/attendance/device/users/${encodeURIComponent(m.deviceUserId)}`); say(r.ok ? "Unlinked." : apiMsg(r)); load(); }}>Unlink</button></td></tr>))}</tbody>
          </table></div></details>}
      </div>
    </div>
  );
}

function AddPunch({ today, onAdd }) {
  const [f, setF] = useState({ date: "", time: "", direction: "IN", note: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="card"><div className="card-h"><h3>Add a missed punch</h3></div><div className="card-b">
      <form className="row" style={{ flexWrap: "wrap", gap: 12 }} onSubmit={(e) => { e.preventDefault(); onAdd(f); }}>
        <input className="input" type="date" aria-label="Date" max={today} value={f.date} onChange={set("date")} style={{ width: "auto" }} />
        <input className="input" type="time" aria-label="Time" value={f.time} onChange={set("time")} style={{ width: "auto" }} />
        <select className="input" aria-label="In or out" value={f.direction} onChange={set("direction")} style={{ width: "auto" }}><option>IN</option><option>OUT</option></select>
        <input className="input grow" placeholder="Reason, for example forgot to punch out" aria-label="Reason" maxLength={300} value={f.note} onChange={set("note")} />
        <button type="submit" className="btn primary">Add punch</button>
      </form>
    </div></div>
  );
}

/* One person's attendance (HR can change punches; a reporting manager can only read). */
function PersonView({ person, canEdit, onBack, say }) {
  const months = useMonths(person.email);
  const now = istNow();
  const clockNow = useNow(1000);
  const [h24] = useH24();
  useEffect(() => { months.ensure(now.date.slice(0, 7)); }, [months.ensure, now.date]);   // today's month, for the Timings and Today cards
  const todayDay = months.byMonth[now.date.slice(0, 7)]?.days.find((d) => d.date === now.date);
  const todayState = todayDay && todayDay.punches.length && todayDay.punches[todayDay.punches.length - 1].direction === "IN" ? "in" : "out";
  const name = Object.values(months.byMonth)[0]?.name || person.name;
  const removePunch = async (id) => {
    if (!confirm("Remove this punch? This is recorded in the audit log.")) return;
    const r = await api("DELETE", `/api/attendance/punches/${id}`);
    say(r.ok ? "Punch removed." : apiMsg(r));
    months.refresh();
  };
  const addPunch = async (f) => {
    const r = await api("POST", "/api/attendance/punches", { email: person.email, ...f });
    if (!r.ok) { say(apiMsg(r)); return; }
    say("Punch added."); months.refresh();
  };
  return (
    <section className="section">
      <SectionHead eyebrow={canEdit ? "Attendance" : "My team"} title={name}
        sub={canEdit ? "Every day, with the punches behind it. Open a day to see its punches, add a missed one with a reason, or remove a wrong one. Both are recorded in the audit log." : "Their attendance. Only HR can change punches."}
        actions={<button type="button" className="btn glass sm" onClick={onBack}>{canEdit ? "Back to everyone" : "Back"}</button>} />
      {months.error && <Callout>{months.error}</Callout>}
      <div className="att-top">
        <div className="att-col"><h3 className="att-h">Your numbers</h3><StatsCard byMonth={months.byMonth} today={now.date} name={name.split(" ")[0]} /></div>
        {todayDay ? <>
          <div className="att-col"><h3 className="att-h">Today's shift</h3><TimingsCard today={now.date} punches={todayDay.punches} minutesToday={todayDay.minutes} now={clockNow} h24={h24} /></div>
          <div className="att-col"><h3 className="att-h">Right now</h3><ActionsCard today={now.date} state={todayState} punches={todayDay.punches} now={clockNow} h24={h24} /></div>
        </> : null}
      </div>
      <AttendanceLog months={months} today={now.date} canEdit={canEdit} onRemove={removePunch} />
      {canEdit && <AddPunch today={now.date} onAdd={addPunch} />}
    </section>
  );
}

export default function Attendance() {
  const { isHr, isManager, user } = useAuth();
  const [today, setToday] = useState(null);      // my punches today
  const mine = useMonths(null);                  // my own months
  const [day, setDay] = useState(null);          // team (or everyone for HR) for one date
  const [date, setDate] = useState("");
  const [person, setPerson] = useState(null);    // { email, name } while looking at someone
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const now = useNow(1000);
  const [h24] = useH24();

  const say = (m) => { setToast(m); setTimeout(() => setToast(""), 3400); };
  const load = useCallback(async (get) => { const r = await api("GET", get); if (!r.ok) { setError(apiMsg(r)); return null; } setError(""); return r.data; }, []);
  const loadToday = useCallback(async () => { const t = await load("/api/attendance/today"); if (t) setToday(t); }, [load]);
  const loadDay = useCallback(async (d) => {
    const x = await load(`/api/attendance/day${d ? `?date=${d}` : ""}`);
    if (x) { setDay(x); setDate(x.date); }
  }, [load]);

  useEffect(() => {
    if (!isHr) loadToday();
    if (isHr || isManager) loadDay();
  }, [isHr, isManager, loadToday, loadDay]);

  const punch = async () => {
    setBusy(true);
    const r = await api("POST", "/api/attendance/punch");
    setBusy(false);
    say(r.ok ? `Punched ${r.data.direction === "IN" ? "in" : "out"} at ${r.data.time}.` : apiMsg(r));
    loadToday(); mine.refresh();
  };

  // Looking at one person.
  if (person) return <PersonView key={person.email} person={person} canEdit={isHr} onBack={() => setPerson(null)} say={say} />;

  const datePick = <input className="input" type="date" aria-label="Date" value={date} style={{ width: "auto", padding: "8px 12px" }} onChange={(e) => e.target.value && loadDay(e.target.value)} />;

  // HR: everyone's attendance.
  if (isHr) {
    return (
      <section className="section">
        <SectionHead eyebrow="Attendance" title="Everyone's" accent="attendance." sub="Who is in, who is on leave and who is absent, for any day. Open a person to see their days, or to fix a missed punch." actions={datePick} />
        {error && <Callout>{error}</Callout>}
        {day ? <DayTable day={day} onOpen={(x) => setPerson({ email: x.email, name: x.name })} /> : <div className="empty">{error || "Loading…"}</div>}
        <DeviceCard say={say} />
        {toast && <div className="toast" role="status">{toast}</div>}
      </section>
    );
  }

  // Everyone else: my own attendance only.
  const inNow = today && today.state === "in";
  return (
    <section className="section">
      <SectionHead eyebrow="Me" title="My" accent="attendance." sub="Punch in when you start and out when you finish. Your hours and days are counted from these punches. You see only your own attendance here." />
      {(error || mine.error) && <Callout>{error || mine.error}</Callout>}
      {today ? (
        <>
          <div className="att-top">
            <div className="att-col"><h3 className="att-h">Your numbers</h3><StatsCard byMonth={mine.byMonth} today={today.date} name={(user && user.name ? user.name.split(" ")[0] : "Me")} /></div>
            <div className="att-col"><h3 className="att-h">Today's shift</h3><TimingsCard today={today.date} punches={today.punches} minutesToday={today.minutes} now={now} h24={h24} /></div>
            <div className="att-col"><h3 className="att-h">Punch clock</h3><ActionsCard today={today.date} state={today.state} punches={today.punches} onPunch={punch} busy={busy} now={now} h24={h24} /></div>
          </div>
          <AttendanceLog months={mine} today={today.date} />
        </>
      ) : <div className="empty">{error || "Loading…"}</div>}
      {isManager && (
        <>
          <div className="sec-head" style={{ marginTop: 28 }}>
            <div><div className="eyebrow">My team</div><h2>Team attendance</h2></div><div className="row">{datePick}</div>
          </div>
          {day ? <DayTable day={day} onOpen={(x) => setPerson({ email: x.email, name: x.name })} /> : <div className="empty">Loading…</div>}
        </>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}
