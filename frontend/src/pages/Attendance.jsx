import { useCallback, useEffect, useState } from "react";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Callout, Person, Pill, SectionHead, Stat, dayLabel, hours } from "../components/ui.jsx";
import Pager, { usePaged } from "../components/Pager.jsx";

const TONE = { Present: "ok", "Half day": "warn", Working: "info", "Short hours": "warn", Absent: "bad", "On leave": "info", "Half day leave": "info", Weekend: "mute", Holiday: "mute" };
const StatusPill = ({ status }) => (status ? <Pill tone={TONE[status] || (/^Worked/.test(status) ? "ok" : "mute")}>{status}</Pill> : <span className="muted">—</span>);

/* Everyone for one day: HR sees all, a reporting manager sees their team. */
function DayTable({ day, onOpen }) {
  const people = day.people;
  const { rows, pager } = usePaged(people, day.date);
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
      <div className="card"><div className="tbl-wrap"><table>
        <thead><tr><th>Employee</th><th>Status</th><th>First in</th><th>Last out</th><th>Hours</th></tr></thead>
        <tbody>{rows.map((x) => (
          <tr key={x.email} className="click" tabIndex={0} onClick={() => onOpen(x.email)} onKeyDown={(e) => e.key === "Enter" && onOpen(x.email)}>
            <td><Person name={x.name} sub={x.title || x.email} /></td>
            <td><StatusPill status={x.status} />{x.missingOut && <> <Pill tone="warn">No punch out</Pill></>}</td>
            <td>{x.firstIn || "—"}</td><td>{x.lastOut || "—"}</td><td>{hours(x.minutes)}</td>
          </tr>
        ))}</tbody>
      </table></div><Pager {...pager} /></div>
    </>
  );
}

/* One person's month. HR also sees each punch with a Remove button. */
function MonthTable({ data, canEdit, onMonth, onRemove }) {
  const s = data.summary;
  const { rows, pager } = usePaged(data.days, `${data.email || data.name}-${data.month}`);
  return (
    <>
      <div className="grid g4">
        <Stat value={s.present} label="Days present" /><Stat value={s.half} label="Half days" />
        <Stat value={s.leave} label="Days on leave" /><Stat value={s.absent} label="Days absent" alert={s.absent > 0} />
      </div>
      <div className="card">
        <div className="card-h"><h3>{data.name}</h3>
          <input className="input" type="month" value={data.month} aria-label="Month" style={{ width: "auto", padding: "8px 12px" }} onChange={(e) => e.target.value && onMonth(e.target.value)} /></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Day</th><th>Status</th><th>First in</th><th>Last out</th><th>Hours</th>{canEdit && <th className="hide-sm">Punches</th>}</tr></thead>
          <tbody>{rows.map((d) => (
            <tr key={d.date}>
              <td>{dayLabel(d.date)}{d.holiday && <div className="muted">{d.holiday}</div>}</td>
              <td><StatusPill status={d.status} />{d.missingOut && <> <Pill tone="warn">No punch out</Pill></>}</td>
              <td>{d.firstIn || "—"}</td><td>{d.lastOut || "—"}</td><td>{hours(d.minutes)}</td>
              {canEdit && <td className="hide-sm">{d.punches.map((p) => (
                <span key={p.id} className="muted" style={{ whiteSpace: "nowrap", display: "block" }}>
                  {p.direction} {p.time}{p.source === "hr" ? ` (HR: ${p.note || ""})` : ""}{" "}
                  <button type="button" className="btn link sm" aria-label={`Remove ${p.direction} at ${p.time}`} onClick={() => onRemove(p.id)}>Remove</button>
                </span>
              ))}</td>}
            </tr>
          ))}</tbody>
        </table></div>
        <Pager {...pager} />
        <p className="muted" style={{ margin: 0, padding: "12px 24px 18px", fontSize: "12.5px" }}>
          Present is 6 hours or more, half day is 3 to 6 hours. Times are Indian time. Weekends and holidays are not counted as absent.
        </p>
      </div>
    </>
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

export default function Attendance() {
  const { isHr, isManager } = useAuth();
  const [today, setToday] = useState(null);      // my punches today
  const [mine, setMine] = useState(null);        // my month
  const [day, setDay] = useState(null);          // team (or everyone for HR) for one date
  const [date, setDate] = useState("");
  const [person, setPerson] = useState(null);    // { email, month data } while looking at someone
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  const say = (m) => { setToast(m); setTimeout(() => setToast(""), 3400); };
  const load = useCallback(async (get) => { const r = await api("GET", get); if (!r.ok) { setError(apiMsg(r)); return null; } setError(""); return r.data; }, []);

  const loadMine = useCallback(async (month) => {
    const t = await load("/api/attendance/today"); if (t) setToday(t);
    const m = await load(`/api/attendance/month${month ? `?month=${month}` : ""}`); if (m) setMine(m);
  }, [load]);
  const loadDay = useCallback(async (d) => {
    const x = await load(`/api/attendance/day${d ? `?date=${d}` : ""}`);
    if (x) { setDay(x); setDate(x.date); }
  }, [load]);
  const openPerson = useCallback(async (email, month) => {
    const m = await load(`/api/attendance/month?email=${encodeURIComponent(email)}${month ? `&month=${month}` : ""}`);
    if (m) setPerson({ email, data: m });
  }, [load]);

  useEffect(() => {
    if (!isHr) loadMine();
    if (isHr || isManager) loadDay();
  }, [isHr, isManager, loadMine, loadDay]);

  const punch = async () => {
    setBusy(true);
    const r = await api("POST", "/api/attendance/punch");
    setBusy(false);
    say(r.ok ? `Punched ${r.data.direction === "IN" ? "in" : "out"} at ${r.data.time}.` : apiMsg(r));
    loadMine(mine && mine.month);
  };
  const removePunch = async (id) => {
    if (!confirm("Remove this punch? This is recorded in the audit log.")) return;
    const r = await api("DELETE", `/api/attendance/punches/${id}`);
    say(r.ok ? "Punch removed." : apiMsg(r));
    openPerson(person.email, person.data.month);
  };
  const addPunch = async (f) => {
    const r = await api("POST", "/api/attendance/punches", { email: person.email, ...f });
    if (!r.ok) { say(apiMsg(r)); return; }
    say("Punch added."); setPerson({ email: person.email, data: r.data });
  };

  // Looking at one person (HR can change punches, a manager can only read).
  if (person) {
    return (
      <section className="section">
        <SectionHead eyebrow={isHr ? "Attendance" : "My team"} title={person.data.name}
          sub={isHr ? "Every punch for the month. Add a missed punch with a reason, or remove a wrong one. Both are recorded in the audit log." : "Their attendance for the month. Only HR can change punches."}
          actions={<button type="button" className="btn glass sm" onClick={() => setPerson(null)}>{isHr ? "Back to everyone" : "Back"}</button>} />
        {error && <Callout>{error}</Callout>}
        <MonthTable data={person.data} canEdit={isHr} onMonth={(m) => openPerson(person.email, m)} onRemove={removePunch} />
        {isHr && <AddPunch today={person.data.today} onAdd={addPunch} />}
        {toast && <div className="toast" role="status">{toast}</div>}
      </section>
    );
  }

  const datePick = <input className="input" type="date" aria-label="Date" value={date} style={{ width: "auto", padding: "8px 12px" }} onChange={(e) => e.target.value && loadDay(e.target.value)} />;

  if (isHr) {
    return (
      <section className="section">
        <SectionHead eyebrow="Attendance" title="Attendance" accent="today." sub="Who is in, who is on leave and who is absent. Open a person to see their month or fix a missed punch." actions={datePick} />
        {error && <Callout>{error}</Callout>}
        {day ? <DayTable day={day} onOpen={(e) => openPerson(e)} /> : <div className="empty">{error || "Loading…"}</div>}
        {toast && <div className="toast" role="status">{toast}</div>}
      </section>
    );
  }

  const inNow = today && today.state === "in";
  return (
    <section className="section">
      <SectionHead eyebrow="Me" title="My" accent="attendance." sub="Punch in when you start and out when you finish. Your hours and days are counted from these punches." />
      {error && <Callout>{error}</Callout>}
      {today && (
        <div className="card"><div className="card-b" style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="muted">{dayLabel(today.date)}, now {today.time}</div>
            <div style={{ font: "600 28px/1.2 var(--display)" }}>{inNow ? "You are punched in" : "You are punched out"}</div>
            <div className="muted">{today.punches.length ? `${today.punches.map((p) => `${p.direction} ${p.time}`).join(" · ")} · worked ${hours(today.minutes)}` : "No punches yet today."}</div>
          </div>
          <button type="button" className="btn primary" disabled={busy} onClick={punch}>{inNow ? "Punch out" : "Punch in"}</button>
        </div></div>
      )}
      {mine && <MonthTable data={mine} canEdit={false} onMonth={loadMine} />}
      {isManager && (
        <>
          <div className="sec-head" style={{ marginTop: 28 }}>
            <div><div className="eyebrow">My team</div><h2>Team attendance</h2></div><div className="row">{datePick}</div>
          </div>
          {day ? <DayTable day={day} onOpen={(e) => openPerson(e)} /> : <div className="empty">Loading…</div>}
        </>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}
