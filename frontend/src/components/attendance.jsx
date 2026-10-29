import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, apiMsg } from "../api.js";
import Modal from "./Modal.jsx";

/* The employee's attendance page, laid out like a standard HR attendance screen: stats, today's shift and the punch button on top,
   then a log of every day with a 24-hour bar, break time and gross hours, and a calendar. Times are Indian time. */
export const SHIFT = { start: "09:30", end: "18:30" };   // the office shift
const GRACE_MIN = 0;                                     // minutes after the shift start that still count as on time
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ---- dates and times ---- */
const mins = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const dow = (s) => parse(s).getUTCDay();
const prevMonth = (m) => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
const nextMonth = (m) => { const [y, mo] = m.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };
const monthLabel = (m) => `${MONTH_LONG[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
export const dur = (m) => `${Math.floor(m / 60)}h ${m % 60}m`;
/** "9:30 AM", or "09:30" in 24 hour format. */
export const clock = (t, h24) => {
  if (!t) return "—";
  const [h, m] = String(t).split(":").map(Number);
  if (h24) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const monTitle = (s) => { const m = MON[Number(s.slice(5, 7)) - 1]; return m.charAt(0) + m.slice(1).toLowerCase(); };
const dayText = (s) => `${DOW[dow(s)]}, ${Number(s.slice(8))} ${monTitle(s)}`;

/** Now in Indian time, from the browser's clock (punching itself always uses the server's clock). */
export function istNow(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
export function useNow(everyMs = 1000) {
  const [now, setNow] = useState(() => istNow());
  useEffect(() => { const t = setInterval(() => setNow(istNow()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return now;
}
export function useH24() {
  const [h24, set] = useState(() => { try { return localStorage.getItem("att-24h") === "1"; } catch { return false; } });
  return [h24, (v) => { set(v); try { localStorage.setItem("att-24h", v ? "1" : "0"); } catch {} }];
}

/* ---- loading months of attendance (own, or someone else's for HR and managers) ---- */
export function useMonths(email) {
  const [byMonth, setBy] = useState({});
  const [error, setError] = useState("");
  const seen = useRef(new Set());
  const load = useCallback(async (month) => {
    const r = await api("GET", `/api/attendance/month?month=${month}${email ? `&email=${encodeURIComponent(email)}` : ""}`);
    if (!r.ok) { setError(apiMsg(r)); return; }
    setError(""); seen.current.add(month); setBy((m) => ({ ...m, [month]: r.data }));
  }, [email]);
  const ensure = useCallback((month) => { if (!seen.current.has(month)) { seen.current.add(month); load(month); } }, [load]);
  const refresh = useCallback(() => Promise.all([...seen.current].map(load)), [load]);
  return { byMonth, error, ensure, refresh };
}
const daysIn = (byMonth, from, to) => {
  const out = [];
  for (let d = to; d >= from; d = addDays(d, -1)) { const day = byMonth[d.slice(0, 7)]?.days.find((x) => x.date === d); if (day) out.push(day); }
  return out;   // newest first
};

/** What a day is, for the log: worked, weekend, holiday, leave, nothing logged yet, absent, or not counted (before joining, in the future). */
function kind(d, today) {
  if (d.status === null) return "none";
  if (d.punches.length) return "worked";
  if (d.holiday || d.off === "Holiday") return "holiday";
  if (d.off === "Weekend") return "weekend";
  if (/leave$/i.test(d.status)) return "leave";
  if (d.status === "Off-site") return "offsite";
  return d.date === today ? "nolog" : "absent";
}
/** Break = time between an OUT and the next IN. Gross hours = first in to last out (to now for today). */
function grossOf(d, today, nowMin) {
  if (!d.firstIn) return null;
  if (d.lastOut && mins(d.lastOut) >= mins(d.firstIn)) return mins(d.lastOut) - mins(d.firstIn);
  return d.date === today ? Math.max(0, nowMin - mins(d.firstIn)) : null;
}

/* ---- the 24 hour bar ---- */
export function DayBar({ firstIn, lastOut, open }) {
  const a = (mins(firstIn) / 1440) * 100;
  const b = lastOut ? Math.max((mins(lastOut) / 1440) * 100, a + 0.8) : a + 0.8;
  return (
    <div className="att-bar" aria-hidden="true">
      <i className={`att-fill${open ? " open" : ""}`} style={{ left: `${a}%`, width: `${b - a}%` }} />
      <s style={{ left: `${a}%` }} />{lastOut && <s style={{ left: `${b}%` }} />}
    </div>
  );
}

/* ---- top row ---- */
const RANGES = { week: "Last week", thisweek: "This week", month: "This month", d30: "Last 30 days" };
function rangeFor(kindOf, today) {
  const monday = addDays(today, -((dow(today) + 6) % 7));
  if (kindOf === "thisweek") return [monday, today];
  if (kindOf === "week") return [addDays(monday, -7), addDays(monday, -1)];
  if (kindOf === "month") return [`${today.slice(0, 7)}-01`, today];
  return [addDays(today, -29), today];
}
export function StatsCard({ byMonth, today, name = "Me" }) {
  const [range, setRange] = useState("week");
  const [from, to] = rangeFor(range, today);
  const days = daysIn(byMonth, from, to).filter((d) => d.firstIn);
  const avg = days.length ? Math.round(days.reduce((n, d) => n + d.minutes, 0) / days.length) : null;
  const onTime = days.length ? Math.round((days.filter((d) => mins(d.firstIn) <= mins(SHIFT.start) + GRACE_MIN).length / days.length) * 100) : null;
  return (
    <div className="card att-stats"><div className="att-stats-h">
      <select className="input" aria-label="Period" value={range} onChange={(e) => setRange(e.target.value)}>{Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <span className="att-info" title={`On time means the first punch is at or before ${clock(SHIFT.start)}. Average hours count the days you punched.`}>i</span></div>
      <div className="att-stat-row"><span className="att-av">{String(name).charAt(0).toUpperCase()}</span><b>{name}</b>
        <div><small>AVG HRS / DAY</small><strong>{avg === null ? "—" : dur(avg)}</strong></div>
        <div><small>ON TIME ARRIVAL</small><strong>{onTime === null ? "—" : `${onTime}%`}</strong></div></div>
    </div>
  );
}

/** The week's days are buttons: today shows the live shift bar, any earlier day of the week shows that day's first in, last out and hours. */
export function TimingsCard({ today, punches, minutesToday, now, h24, byMonth = {} }) {
  const [pick, setPick] = useState(today);
  const monday = addDays(today, -((dow(today) + 6) % 7));
  const week = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
  const s = mins(SHIFT.start), e = mins(SHIFT.end), span = e - s;
  const pct = (m) => Math.max(0, Math.min(100, ((m - s) / span) * 100));
  const isToday = pick === today;
  const rec = byMonth[pick.slice(0, 7)]?.days.find((d) => d.date === pick);
  // The bar and the numbers for the picked day.
  let from = null, to = null, worked = 0, note = "";   // stepping out to eat is not a break, so there is none to show
  if (isToday) {
    const first = punches.find((p) => p.direction === "IN");
    if (first) { from = mins(first.time); to = now.minutes; }
    worked = minutesToday || 0;
  } else if (rec && rec.firstIn) {
    from = mins(rec.firstIn); to = rec.lastOut ? mins(rec.lastOut) : null;
    worked = rec.minutes;
    if (to === null) note = "No punch out";
  } else if (rec) note = rec.holiday || (rec.off === "Weekend" ? "Weekly off" : /leave$/i.test(rec.status || "") ? rec.status : rec.status === "Absent" ? "Absent" : "No time entries");
  const fillFrom = from === null ? 0 : pct(from), fillTo = from === null ? 0 : to === null ? Math.min(100, fillFrom + 2) : pct(to);
  const title = isToday ? "Today" : dayText(pick);
  return (
    <div className="card att-timings">
      <div className="att-dow" role="group" aria-label="Pick a day of this week">
        {week.map((d, i) => (
          <button key={d} type="button" className={d === pick ? "on" : ""} disabled={d > today} aria-pressed={d === pick} aria-current={d === today ? "date" : undefined}
            title={d > today ? "Not yet" : dayText(d)} onClick={() => setPick(d)}>{["M", "T", "W", "T", "F", "S", "S"][i]}</button>))}
      </div>
      <div className="att-shift">
        <div className="att-shift-t">{title} ({clock(SHIFT.start, h24)} - {clock(SHIFT.end, h24)})</div>
        <div className="att-track"><i style={{ left: `${fillFrom}%`, width: `${Math.max(0, fillTo - fillFrom)}%` }} /></div>
        <div className="att-shift-b"><span>Duration: {dur(span)}</span><span title="Stepping out is not counted as a break">☕ 0 min</span></div>
        <div className="att-shift-n">{note ? <span className="muted">{note}</span> : from !== null
          ? <span>In <b>{clock(`${Math.floor(from / 60)}:${String(from % 60).padStart(2, "0")}`, h24)}</b>{!isToday && to !== null && <> · Out <b>{clock(`${Math.floor(to / 60)}:${String(to % 60).padStart(2, "0")}`, h24)}</b></>} · <b>{dur(worked)}</b> worked</span>
          : <span className="muted">{isToday ? "No punches yet today" : "No time entries"}</span>}</div>
      </div>
    </div>
  );
}

/* The attendance policy, in two tabs: how lateness and missing days are penalised, and how time is tracked. */
const POLICY = {
  penal: { label: "Penalisation Policy", intro: "Below are the details of your Penalisation Policy", note: "Penalisation policy is effective 02 Feb 2023", items: [
    ["No Attendance", "You won't be penalized for any leave if there is no attendance logged by you."],
    ["Late Arrival", "You won't be penalized for any late arrival incidents."],
    ["Work Hours", "There is no penalization for number of work hours you spend in office."],
    ["Missing Swipes", "There is no penalization for Missing Swipes, but it is recommended to regularize your attendance."],
  ] },
  track: { label: "Time tracking policy", intro: "Below are the details of time tracking policy assigned to you", items: [
    ["Bio-Metric & Web Clock-In", "Your attendance is automatically tracked using biometric device(s)."],
    ["On-duty (OD)", "You can request for only full day OD."],
    ["How days are counted", `The shift is ${clock(SHIFT.start)} to ${clock(SHIFT.end)}. Hours come from your punches, each IN with the next OUT. Six hours or more is a present day and three to six hours is a half day. Weekends and holidays are not expected working days.`],
  ] },
};
export function PolicyModal({ onClose }) {
  const [tab, setTab] = useState("penal");
  const p = POLICY[tab];
  return (
    <Modal onClose={onClose} wide>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Attendance Policy</h3><button type="button" className="btn glass sm" onClick={onClose} aria-label="Close">Close</button></div>
      <div className="card-b">
        <div className="att-tabs" role="tablist" style={{ padding: 0 }}>
          {Object.entries(POLICY).map(([k, v]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{v.label}</button>)}
        </div>
        <p style={{ margin: 0 }}>{p.intro}</p>
        {p.note && <p className="muted" style={{ margin: 0 }}>{p.note}</p>}
        {p.items.map(([h, t]) => <div key={h}><h4 style={{ margin: "0 0 4px", fontSize: 16 }}>{h}</h4><p className="muted" style={{ margin: 0 }}>{t}</p></div>)}
      </div>
    </Modal>
  );
}

export function ActionsCard({ today, state, punches, onPunch, busy, now, h24 }) {
  const [policy, setPolicy] = useState(false);
  const t = now.time.slice(0, 5);
  const label = h24 ? now.time : `${clock(t)}`.replace(/(\d+:\d+) (AM|PM)/, `$1:${now.time.slice(6)} $2`);
  const first = punches.find((p) => p.direction === "IN");
  return (
    <div className="card att-actions">
      <div className="att-clock" aria-live="off">{label}</div>
      <div className="muted">{dayText(now.date)} {now.date.slice(0, 4)}</div>
      <div className="att-punch">
        {onPunch && <button type="button" className={`btn ${state === "in" ? "glass" : "primary"}`} disabled={busy} onClick={onPunch}>{state === "in" ? "Punch out" : "Punch in"}</button>}
        <span className="muted">{state === "in" ? `${onPunch ? "Punched in" : "In"}${first ? ` since ${clock(first.time, h24)}` : ""}` : punches.length ? `${onPunch ? "Punched out" : "Out"} at ${clock(punches[punches.length - 1].time, h24)}` : onPunch ? "You have not punched in today" : "No punches yet today"}</span>
      </div>
      <button type="button" className="btn link sm" aria-haspopup="dialog" onClick={() => setPolicy(true)}>Attendance policy</button>
      {policy && <PolicyModal onClose={() => setPolicy(false)} />}
    </div>
  );
}

/* ---- the log, and the calendar ---- */
const LOG_ICON = { ok: "On track", warn: "Check", live: "Live" };
function logIcon(d, today) {
  if (d.missingOut) return ["warn", "No punch out"];
  if (d.missingSwipe) return ["warn", "A punch in the middle has no matching return: ask HR to check the day"];
  if (d.status === "Working") return ["live", "Still working"];
  if (/^(Present|Worked on)/.test(d.status)) return ["ok", d.status];
  return ["warn", d.status];
}

function Row({ d, today, nowMin, h24, canEdit, onRemove }) {
  const [open, setOpen] = useState(false);
  const k = kind(d, today);
  const tag = k === "weekend" ? <span className="att-tag off">W-OFF</span> : k === "holiday" ? <span className="att-tag hol">HLDY</span> : null;
  const rowClass = k === "weekend" ? "att-off" : k === "holiday" ? "att-hol" : "";
  const date = <td><span className="att-date">{dayText(d.date)}</span> {tag}</td>;
  if (k === "worked") {
    const gross = grossOf(d, today, nowMin), brk = 0;   // stepping out to eat is not counted as a break
    const [tone, tip] = logIcon(d, today);
    return (
      <>
        <tr className={`${rowClass} click`} onClick={() => setOpen(!open)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(!open)} aria-expanded={open}>
          {date}
          <td><DayBar firstIn={d.firstIn} lastOut={d.lastOut} open={!d.lastOut} /></td>
          <td className="num-cell">{dur(brk)}</td>
          <td className="num-cell">{gross === null ? <span className="muted">No punch out</span> : dur(gross)}</td>
          <td><span className={`att-chip ${tone}`} title={tip}>{/^Half day/.test(d.status || "") ? "Half day" : LOG_ICON[tone]}</span></td>
        </tr>
        {open && <tr className="att-detail"><td colSpan="5">
          <div className="att-punches">{d.punches.map((p) => (
            <span key={p.id}><b>{p.direction}</b> {clock(p.time, h24)}{p.source === "hr" ? ` (HR: ${p.note || ""})` : p.source === "device" ? " (office device)" : ""}
              {canEdit && <> <button type="button" className="btn link sm" aria-label={`Remove ${p.direction} at ${p.time}`} onClick={(e) => { e.stopPropagation(); onRemove(p.id); }}>Remove</button></>}</span>))}
            <span className="muted">{d.status}{d.off ? ` · ${d.off.toLowerCase()}` : ""}</span></div>
        </td></tr>}
      </>
    );
  }
  const msg = { weekend: "Full day Weekly-off", holiday: d.holiday || "Holiday", leave: d.status, offsite: `Working from ${d.site || "another location"}: no office punch expected`, nolog: "No Time Entries Logged", absent: "Absent", none: "" }[k];
  return (
    <tr className={rowClass}>{date}<td colSpan="3" className={`att-msg${k === "absent" ? " bad" : ""}`}>{msg}</td><td>{k === "absent" ? <span className="att-chip bad" title="Absent">Absent</span> : <span className="att-dots" aria-hidden="true">···</span>}</td></tr>
  );
}

function Calendar({ byMonth, ensure, today, h24 }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  useEffect(() => { ensure(month); }, [month, ensure]);
  const data = byMonth[month];
  const first = `${month}-01`, lead = (dow(first) + 6) % 7;
  const cells = [...Array(lead).fill(null), ...(data ? data.days : [])];
  const cls = (d) => { const k = kind(d, today); return k === "worked" ? (/^(Present|Worked on)/.test(d.status) ? "ok" : "warn") : k === "holiday" ? "hol" : k === "weekend" ? "off" : k === "leave" ? "lv" : k === "offsite" ? "lv" : k === "absent" ? "bad" : ""; };
  return (
    <div className="att-cal">
      <div className="att-cal-h"><button type="button" className="btn glass sm" aria-label="Previous month" onClick={() => setMonth(prevMonth(month))}>‹</button>
        <b>{monthLabel(month)}</b>
        <button type="button" className="btn glass sm" aria-label="Next month" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(nextMonth(month))}>›</button></div>
      <div className="att-cal-g" role="grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((l) => <div key={l} className="att-cal-l" role="columnheader">{l}</div>)}
        {cells.map((d, i) => d === null ? <div key={`e${i}`} /> : (
          <div key={d.date} className={`att-cell ${cls(d)}${d.date === today ? " today" : ""}`} role="gridcell" title={`${dayText(d.date)}: ${d.status || "no data"}${d.firstIn ? `, in ${clock(d.firstIn, h24)}` : ""}${d.lastOut ? `, out ${clock(d.lastOut, h24)}` : ""}`}>
            <span>{Number(d.date.slice(8))}</span>{d.minutes > 0 ? <small>{dur(d.minutes)}</small> : d.holiday ? <small>{d.holiday}</small> : d.status && kind(d, today) !== "none" ? <small>{kind(d, today) === "weekend" ? "W-OFF" : d.status}</small> : null}
          </div>))}
      </div>
      {!data && <div className="empty">Loading…</div>}
      <div className="att-legend"><span><i className="ok" />Present</span><span><i className="warn" />Half day / short</span><span><i className="lv" />Leave</span><span><i className="hol" />Holiday</span><span><i className="off" />Weekly off</span><span><i className="bad" />Absent</span></div>
    </div>
  );
}

export function AttendanceLog({ months, today, canEdit = false, onRemove = () => {} }) {
  const { byMonth, error, ensure } = months;
  const now = useNow(30000);
  const [h24, setH24] = useH24();
  const [tab, setTab] = useState("log");
  const [range, setRange] = useState("d30");            // "d30" or a month like "2026-09"
  const thisMonth = today.slice(0, 7);
  const tabs = useMemo(() => { const out = []; let m = prevMonth(thisMonth); for (let i = 0; i < 6; i++) { out.push(m); m = prevMonth(m); } return out; }, [thisMonth]);
  useEffect(() => { ensure(thisMonth); ensure(prevMonth(thisMonth)); }, [ensure, thisMonth]);
  useEffect(() => { if (range !== "d30") ensure(range); }, [range, ensure]);
  const days = range === "d30" ? daysIn(byMonth, addDays(today, -29), today) : (byMonth[range]?.days || []).slice().reverse();
  const loading = range === "d30" ? !byMonth[thisMonth] : !byMonth[range];
  return (
    <div>
      <div className="att-logs-h"><h3 className="att-h">Day by day</h3>
        <label className="att-toggle"><input type="checkbox" checked={h24} onChange={(e) => setH24(e.target.checked)} />24 hour format</label></div>
      <div className="card att-logs">
        <div className="att-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "log"} className={tab === "log" ? "on" : ""} onClick={() => setTab("log")}>Daily log</button>
          <button type="button" role="tab" aria-selected={tab === "cal"} className={tab === "cal" ? "on" : ""} onClick={() => setTab("cal")}>Month view</button>
        </div>
        {error && <div className="att-err">{error}</div>}
        {tab === "cal" ? <Calendar byMonth={byMonth} ensure={ensure} today={today} h24={h24} /> : (
          <>
            <div className="att-range-h"><b>{range === "d30" ? "Last 30 days" : monthLabel(range)}</b>
              <div className="att-range" role="group" aria-label="Period">
                <button type="button" className={range === "d30" ? "on" : ""} onClick={() => setRange("d30")}>Last 30 days</button>
                {tabs.map((m) => <button key={m} type="button" className={range === m ? "on" : ""} onClick={() => setRange(m)}>{monTitle(m + "-01")}</button>)}
              </div></div>
            <div className="tbl-wrap att-table"><table>
              <thead><tr><th>Date</th><th>Time on site</th><th className="num-cell">Break</th><th className="num-cell">Hours</th><th>Log</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan="5"><div className="empty">Loading…</div></td></tr>}
                {days.filter((d) => kind(d, today) !== "none").map((d) => <Row key={d.date} d={d} today={today} nowMin={now.minutes} h24={h24} canEdit={canEdit} onRemove={onRemove} />)}
              </tbody>
            </table></div>
          </>)}
      </div>
    </div>
  );
}

/** The 24 hour bar and times for one person on one day: used in the everyone-for-a-day table that HR sees. */
export const DayCell = ({ x, h24 }) => (x.firstIn ? <DayBar firstIn={x.firstIn} lastOut={x.lastOut} open={!x.lastOut} /> : <span className="muted">—</span>);
