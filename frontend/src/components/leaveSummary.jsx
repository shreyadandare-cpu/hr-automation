import { useState } from "react";
import { api, apiMsg } from "../api.js";
import { useData } from "../data.jsx";
import { useToast } from "./toast.jsx";
import Modal from "./Modal.jsx";
import Pager, { usePaged } from "./Pager.jsx";
import { Pill, shortDate } from "./ui.jsx";
import { R } from "../lib/leave.js";
import { LSTAT, LTYPE, dd, lc, rangeText, useLeave } from "../lib/useLeave.js";

const TYPES = ["casual", "compoff", "sick", "unpaid"];
const COLOR = { casual: "var(--lv-casual)", sick: "var(--lv-sick)", compoff: "var(--lv-comp)", unpaid: "var(--lv-unpaid)" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const yearOf = (s) => Number(String(s).slice(0, 4));
const when = (ts) => (ts ? shortDate(String(ts).slice(0, 10)) : "—");

export const Ring = ({ pct, color, label, sub = "Available", big = false }) => (
  <div className={`ring${big ? " big" : ""}`} style={{ background: `conic-gradient(${color} ${Math.max(0, Math.min(100, pct))}%,var(--lv-track) 0)` }}><div><b>{label}</b><span>{sub}</span></div></div>
);

/* Bars for a count per slot (weekday or month), scaled to the biggest. */
function Bars({ labels, values, title, info }) {
  const max = Math.max(...values, 0);
  return (
    <div className="card lv-stat"><div className="card-h"><h3>{title}</h3><span className="lv-i" title={info} aria-label={info}>i</span></div>
      <div className="lv-bars" role="img" aria-label={`${title}: ${labels.map((l, i) => `${l} ${values[i]}`).join(", ")}`}>
        {labels.map((l, i) => (
          <div key={l} className="lv-bar"><span className="lv-bar-v">{values[i] ? values[i] : ""}</span>
            <i style={{ height: max ? `${(values[i] / max) * 100}%` : 0 }} /><small>{l}</small></div>))}
      </div></div>
  );
}

/* Days of approved leave on each weekday and in each month of the year, and the split by leave type. */
export function LeaveStats({ email, year }) {
  const lv = useLeave();
  const taken = lv.reqsOf(email).filter((r) => r.status === "approved" && yearOf(r.from) === year);
  const week = Array(7).fill(0), month = Array(12).fill(0), byType = Object.fromEntries(TYPES.map((t) => [t, 0]));
  for (const r of taken) {
    const each = r.half ? 0.5 : 1;
    for (const d of R.workingDates(r.from, r.half ? r.from : r.to, lv.holDays)) {
      week[(new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7] += each;
      month[Number(d.slice(5, 7)) - 1] += each;
    }
    byType[r.type] += Number(r.days || 0);
  }
  const total = TYPES.reduce((n, t) => n + byType[t], 0);
  let at = 0;
  const stops = TYPES.filter((t) => byType[t]).map((t) => { const s = `${COLOR[t]} ${at}% ${(at += (byType[t] / total) * 100)}%`; return s; });
  return (
    <div className="lv-stats">
      <Bars title="Weekly pattern" info="Approved leave days on each weekday this year" labels={DAYS} values={week} />
      <div className="card lv-stat"><div className="card-h"><h3>Consumed leave types</h3><span className="lv-i" title="Approved leave days by type this year">i</span></div>
        <div className="lv-donut-row">
          <div className="ring" style={{ background: total ? `conic-gradient(${stops.join(",")})` : "var(--lv-track)" }}><div><b>{total ? dd(total) : "None"}</b><span>{total ? "taken" : "taken yet"}</span></div></div>
          <ul className="lv-legend">{TYPES.map((t) => <li key={t}><i style={{ background: COLOR[t] }} />{LTYPE[t]}<b>{byType[t]}</b></li>)}</ul>
        </div></div>
      <Bars title="Monthly stats" info="Approved leave days in each month this year" labels={MONTHS} values={month} />
    </div>
  );
}

/* The leave list with filters and pages. Shows who asked, who decided and when. `who`: also show the employee column (HR). */
export function LeaveHistory({ list, who = false, onCancel, title = "Leave history" }) {
  const lv = useLeave();
  const [f, setF] = useState({ type: "", status: "", q: "" });
  const nameOf = (e) => (e ? (lv.empBy(e) || {}).name || e : "—");
  const rows = list.filter((r) => (!f.type || r.type === f.type) && (!f.status || r.status === f.status)
    && (!f.q || lc(`${r.reason} ${nameOf(r.email)} ${LTYPE[r.type]}`).includes(lc(f.q))))
    .sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : b.id - a.id));
  const { rows: page, pager } = usePaged(rows, JSON.stringify(f) + list.length);
  return (
    <div className="card"><div className="card-h"><h3>{title}</h3><span className="muted">Total: {rows.length}</span></div>
      <div className="lv-filters" role="search">
        <label className="lv-fsel"><span>Leave type</span>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{LTYPE[t]}</option>)}</select></label>
        <label className="lv-fsel"><span>Status</span>
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All statuses</option>{Object.keys(LSTAT).map((s) => <option key={s} value={s}>{LSTAT[s][0]}</option>)}</select></label>
        <label className="lv-fsearch"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" placeholder={who ? "Search name, type or note" : "Search notes"} aria-label="Search leave" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></label>
        {(f.type || f.status || f.q) && <button type="button" className="btn link" onClick={() => setF({ type: "", status: "", q: "" })}>Clear filters</button>}
      </div>
      <div className="tbl-wrap"><table className="lv-hist">
        <thead><tr>{who && <th>Employee</th>}<th>Leave dates</th><th>Leave type</th><th>Status</th><th className="hide-sm">Requested by</th><th className="hide-sm">Action taken on</th><th className="hide-sm">Leave note</th>{onCancel && <th><span className="sr">Actions</span></th>}</tr></thead>
        <tbody>{page.length ? page.map((r) => (
          <tr key={r.id}>
            {who && <td><b>{nameOf(r.email)}</b></td>}
            <td><b>{rangeText(r, shortDate)}</b><small>{r.status === "approved" ? <>{dd(r.paidDays)} paid{r.lopDays ? <>, <span style={{ color: "var(--bad)" }}>{dd(r.lopDays)} loss of pay</span></> : null}</> : dd(r.days)}</small></td>
            <td>{LTYPE[r.type]}<small>Requested on {when(r.createdAt)}</small></td>
            <td><Pill tone={LSTAT[r.status][1]}>{LSTAT[r.status][0]}</Pill>{r.status === "pending" ? <small>Waiting for {lv.approverName(r.email)}</small> : r.decidedBy ? <small>by {nameOf(r.decidedBy)}</small> : null}</td>
            <td className="hide-sm">{r.createdBy ? nameOf(r.createdBy) : "—"}</td>
            <td className="hide-sm">{r.status === "pending" ? "—" : when(r.decidedAt)}</td>
            <td className="hide-sm lv-note">{r.reason}</td>
            {onCancel && <td className="num">{r.status === "pending" && <button type="button" className="btn glass sm" onClick={() => onCancel(r)}>Cancel</button>}</td>}
          </tr>))
          : <tr><td colSpan={8}><div className="empty">{list.length ? "Nothing matches these filters." : "No leave to show yet."}</div></td></tr>}</tbody>
      </table></div>
      {rows.length > 10 && <Pager {...pager} />}
    </div>
  );
}

/* Every change to one leave type's balance in the year, oldest first, with the running balance. */
function ledger(type, year, emp, b, reqs, comps) {
  const rows = [], start = emp.start && yearOf(emp.start) === year ? emp.start : `${year}-01-01`;
  const used = reqs.filter((r) => r.status === "approved" && yearOf(r.from) === year);
  if (type === "casual") {
    if (b.casual.carried) rows.push([`${year}-01-01`, "Carried over from last year", b.casual.carried]);
    rows.push([start, start === `${year}-01-01` ? "Annual quota" : "Quota for the months left in your joining year", b.casual.quota]);
  }
  if (type === "sick") rows.push([start, start === `${year}-01-01` ? "Annual quota" : "Quota for the months left in your joining year", b.sick.quota]);
  if (type === "compoff") for (const c of comps.filter((x) => x.status === "approved" && yearOf(x.workedOn) === year)) rows.push([c.workedOn, `Earned for working on ${shortDate(c.workedOn)}`, Number(c.days)]);
  for (const r of used) {
    if (type === "unpaid") {
      if (r.type === "unpaid") rows.push([r.from, `Unpaid leave, ${rangeText(r, shortDate)}`, -Number(r.days)]);
      else if (r.lopDays) rows.push([r.from, `${LTYPE[r.type]} over the balance, ${rangeText(r, shortDate)}`, -Number(r.lopDays)]);
    } else if (r.type === type && r.paidDays) rows.push([r.from, `${LTYPE[type]}, ${rangeText(r, shortDate)}`, -Number(r.paidDays)]);
  }
  rows.sort((a, c) => (a[0] < c[0] ? -1 : a[0] > c[0] ? 1 : c[2] - a[2]));
  let bal = 0;
  return rows.map(([date, what, change]) => ({ date, what, change, balance: (bal += change) }));
}

/* What each leave type is, how much of it the person has and every change to it, and the rules for applying. */
export function PolicyExplain({ email, year, onClose }) {
  const lv = useLeave(), P = R.POLICY;
  const [tab, setTab] = useState("casual");
  const emp = lv.empBy(email) || {};
  const b = lv.bal(emp, year), reqs = lv.reqsOf(email), comps = lv.compsOf(email);
  const rows = ledger(tab, year, { start: emp.start }, b, reqs, comps);
  const info = {
    casual: { about: "For planned personal time off. Unused days carry over to next year.", left: b.casual.left, total: b.casual.carried + b.casual.quota,
      quota: `You are allotted ${dd(b.casual.quota)} of casual leave for Jan ${year} to Dec ${year}${b.casual.carried ? `, plus ${dd(b.casual.carried)} carried over from last year` : ""}. A full year is ${P.casualPerYear} days; joiners get a share for the months left in their first year.`,
      rules: ["Leave must start today or later. It can't be for a date that has passed.",
        "You can't take more casual leave than you have left (requests waiting for approval count). Days over that are sent as unpaid leave, which is loss of pay.",
        "A note is required."],
      end: "Unused casual leave carries over to next year in full." },
    compoff: { about: "One extra day for working on a Saturday, Sunday or company holiday, once your reporting manager approves the credit.", left: b.compoff.left, total: b.compoff.earned,
      quota: `You have earned ${dd(b.compoff.earned)} of comp off in ${year}. Ask for a credit with “Request credit for comp off” after working a weekend or holiday.`,
      rules: ["Leave must start today or later.", "You can only use comp off days you have earned and that were approved.", "A note is required."],
      end: "Comp offs lapse on 31 December. Unused days are not carried over or paid." },
    sick: { about: "For when you are unwell.", left: b.sick.left, total: b.sick.quota,
      quota: `You are allotted ${dd(b.sick.quota)} of sick leave for Jan ${year} to Dec ${year}. A full year is ${P.sickPerYear} days; joiners get a share for the months left in their first year.`,
      rules: [`Sick leave can be applied up to ${P.sickBackdateDays} days after the date. Further back is not allowed.`,
        "Days over what you have left are sent as unpaid leave (loss of pay). For a past date with no sick leave left, the whole request goes in as unpaid leave.",
        "A note is required."],
      end: "Unused sick leave lapses on 31 December." },
    unpaid: { about: "Loss of pay. For when your other leave has run out.", left: null, total: 0,
      quota: `There is no quota. Each unpaid day, and each day taken over another type's balance, cuts your salary by monthly gross ÷ ${P.lopDivisor}.`,
      rules: ["Leave must start today or later.", "A note is required."],
      end: "Loss-of-pay days are deducted from that month's salary." },
  }[tab];
  const taken = -rows.filter((r) => r.change < 0).reduce((n, r) => n + r.change, 0);
  return (
    <Modal onClose={onClose}><div className="lv-policy">
      <div className="card-h" style={{ paddingTop: 22 }}><h3>Leave policy explanation</h3><button type="button" className="btn glass sm" onClick={onClose} aria-label="Close">✕</button></div>
      <div className="card-b">
        <div className="subtabs" role="tablist" style={{ marginBottom: 0 }}>{TYPES.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{LTYPE[t]}</button>)}</div>
        <div className="lv-pol-head">
          <div><h2>{LTYPE[tab]}</h2><p>{info.about}</p></div>
          {info.left === null ? <Ring pct={taken ? 100 : 0} color={COLOR.unpaid} label={dd(taken)} sub={`Taken in ${year}`} />
            : <Ring pct={info.total ? (info.left / info.total) * 100 : 0} color={COLOR[tab]} label={dd(info.left)} />}
        </div>
        <h4>Leave quota</h4>
        <div className="lv-box">{info.quota}</div>
        <div className="tbl-wrap"><table className="lv-ledger"><thead><tr><th>Date</th><th>What changed</th><th>Change (days)</th><th>Balance (days)</th></tr></thead>
          <tbody>{rows.length ? rows.map((r, i) => <tr key={i}><td>{shortDate(r.date)}</td><td>{r.what}</td><td className={`num-cell${r.change < 0 ? " neg" : ""}`}>{r.change > 0 ? `+${r.change}` : r.change}</td><td className="num-cell"><b>{r.balance}</b></td></tr>)
            : <tr><td colSpan={4}><div className="empty">No changes in {year}.</div></td></tr>}</tbody></table></div>
        <h4>Applying for leave</h4>
        <p>{LTYPE[tab]} can be applied by you, or by HR on your behalf. Full days and half days (first or second half) are both allowed. Saturdays, Sundays and company holidays are never counted.</p>
        <h4>Restrictions for applying</h4>
        <ul>{info.rules.map((x) => <li key={x}>{x}</li>)}</ul>
        <h4>At the end of the year (Dec {year})</h4>
        <p>{info.end}</p>
      </div>
    </div></Modal>
  );
}

const TILE = ["#bfe3ea", "#c9d9f6", "#e3d5f3", "#cfe8d4", "#f6e4a6", "#f3d1bd", "#e6cfe8", "#e2c9e4", "#c9e2c6", "#f4c6cb", "#dcd2b8", "#bcd3f2"];

/* The holiday list as calendar tiles, two columns, one year at a time. HR can add, edit and remove. */
export function HolidayTiles({ editable, onEdit }) {
  const lv = useLeave(), { reloadLeave } = useData(), toast = useToast();
  const thisYear = yearOf(lv.today);
  const [y, setY] = useState(thisYear);
  const [add, setAdd] = useState({ day: "", name: "", type: "" });
  const years = lv.holidays.map((h) => yearOf(h.day));
  const lo = Math.min(thisYear, ...years), hi = Math.max(thisYear + 1, ...years);
  const list = lv.holidays.filter((h) => yearOf(h.day) === y).sort((a, b) => (a.day < b.day ? -1 : 1));
  const next = list.find((h) => h.day >= lv.today);
  const remove = async (h) => {
    const r = await api("DELETE", `/api/leave/holidays/${h.day}`);
    if (!r.ok) { toast(apiMsg(r)); return; }
    toast(`${h.name} removed.`); reloadLeave();
  };
  const addHoliday = async (e) => {
    e.preventDefault();
    const r = await api("POST", "/api/leave/holidays", add);
    if (!r.ok) { toast(apiMsg(r)); return; }
    toast(`${add.name.trim()} added as a holiday.`); setAdd({ day: "", name: "", type: "" }); reloadLeave();
  };
  return (
    <div className="card" id="holiday-calendar">
      <div className="card-h"><div className="row" style={{ gap: 6 }}><h3>Holidays</h3>
        <button type="button" className="btn glass sm" aria-label="Previous year" disabled={y <= lo} onClick={() => setY(y - 1)}>‹</button>
        <b className="lv-year">{y}</b>
        <button type="button" className="btn glass sm" aria-label="Next year" disabled={y >= hi} onClick={() => setY(y + 1)}>›</button></div>
        <span className="muted">{list.length} holiday{list.length === 1 ? "" : "s"} · never counted as leave</span></div>
      {list.length ? <div className="hol-grid">{list.map((h) => {
        const d = new Date(h.day + "T00:00:00"), m = d.getMonth();
        return (
          <div key={h.day} className={`hol${h.day < lv.today ? " past" : ""}${next && next.day === h.day ? " next" : ""}`}>
            <div className="hol-date" style={{ "--hc": TILE[m] }}><span>{MONTHS[m]}</span><b>{String(d.getDate()).padStart(2, "0")}</b></div>
            <div className="hol-txt"><b>{h.name}</b><span>{d.toLocaleDateString("en-IN", { weekday: "long" })}{h.type ? ` · ${h.type}` : ""}{next && next.day === h.day ? " · Next holiday" : ""}</span></div>
            {editable && <div className="hol-act">
              <button type="button" className="btn glass sm" aria-label={`Edit ${h.name}`} onClick={() => onEdit(h)}>Edit</button>
              <button type="button" className="btn glass sm" aria-label={`Remove ${h.name}`} onClick={() => remove(h)}>Remove</button></div>}
          </div>); })}</div>
        : <div className="empty">No holidays listed for {y}.</div>}
      {editable && (
        <form className="li wrap" noValidate onSubmit={addHoliday}>
          <input className="input" type="date" aria-label="Holiday date" style={{ width: "auto" }} value={add.day} onChange={(e) => setAdd({ ...add, day: e.target.value })} />
          <input className="input grow" maxLength={80} placeholder="Holiday name" aria-label="Holiday name" style={{ minWidth: 140 }} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
          <input className="input" maxLength={40} placeholder="Type (optional)" aria-label="Holiday type" style={{ width: 150 }} value={add.type} onChange={(e) => setAdd({ ...add, type: e.target.value })} />
          <button type="submit" className="btn primary sm">Add holiday</button>
        </form>
      )}
    </div>
  );
}

/* A small card in the corner on opening My leave: how much of each leave type is left this year. Shown once per
   browser session; the close button hides it. */
export function LeaveLeftPopup({ email, year, onRequest }) {
  const lv = useLeave();
  const key = `lv-left-seen-${year}`;
  const [open, setOpen] = useState(() => { try { return !sessionStorage.getItem(key); } catch { return true; } });
  if (!open) return null;
  const close = () => { try { sessionStorage.setItem(key, "1"); } catch { /* private window: just hide it */ } setOpen(false); };
  const emp = lv.empBy(email); if (!emp) return null;
  const b = lv.bal(emp, year);
  const rows = [["casual", b.casual.left, b.casual.carried + b.casual.quota], ["sick", b.sick.left, b.sick.quota], ["compoff", b.compoff.left, b.compoff.earned]];
  return (
    <div className="lv-pop" role="status" aria-live="polite">
      <div className="lv-pop-h"><b>Leave remaining in {year}</b><button type="button" aria-label="Close" onClick={close}>×</button></div>
      {rows.map(([t, left, of]) => (
        <div key={t} className="lv-pop-r"><i style={{ background: COLOR[t] }} /><span>{LTYPE[t]}</span>
          <b>{dd(left)}</b><small>{of ? `of ${of}` : "none earned"}</small>
          <em style={{ "--w": `${of ? Math.max(0, Math.min(100, (left / of) * 100)) : 0}%`, "--c": COLOR[t] }} /></div>))}
      <button type="button" className="btn primary sm" onClick={() => { close(); onRequest(); }}>Request leave</button>
    </div>
  );
}

/* Page tabs kept in the address (?view=), so a refresh or the back button stays on the same tab. */
export function ViewTabs({ views, view, onView }) {
  return <div className="subtabs" role="tablist">{views.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => onView(k)}>{label}</button>)}</div>;
}
