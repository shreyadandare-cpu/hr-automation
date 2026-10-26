import { useState } from "react";
import { Link } from "react-router-dom";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { Pill, SectionHead, shortDate } from "../components/ui.jsx";
import { CompRequestModal, HolidayCalendar, PolicyModal } from "../components/leaveParts.jsx";
import { useToast } from "../components/toast.jsx";
import { R } from "../lib/leave.js";
import { LSTAT, LTYPE, dd, lc, rangeText, useLeave } from "../lib/useLeave.js";

const Ring = ({ pct, color, label, sub = "Available" }) => (
  <div className="ring" style={{ background: `conic-gradient(${color} ${Math.max(0, Math.min(100, pct))}%,var(--lv-track) 0)` }}><div><b>{label}</b><span>{sub}</span></div></div>
);

/* The employee's own leave: balances, waiting requests, history and the holiday list. */
export default function MyLeave() {
  const { user } = useAuth();
  const { people, reloadLeave } = useData();
  const lv = useLeave(), toast = useToast();
  const [modal, setModal] = useState(null);
  const [yearPick, setYearPick] = useState(null);
  if (!people) return <section className="section"><div className="empty">Loading…</div></section>;

  const me = lv.empBy(user.email), thisYear = Number(lv.today.slice(0, 4)), year = yearPick || thisYear;
  const top = <SectionHead eyebrow="Me" title="My" accent="leave." sub="Your balances, your requests and your history. Request leave or a comp-off credit here." />;
  if (!me) return <section className="section">{top}<div className="card"><div className="empty">Your employee record wasn't found, so leave can't be shown. Ask HR to check your work email.</div></div></section>;

  const b = lv.bal(me, year), future = year > thisYear;
  const inYear = (r) => Number(r.from.slice(0, 4)) === year;
  const mine = lv.reqsOf(me.email).filter(inYear).sort((a, c) => (a.from < c.from ? 1 : -1));
  const pend = mine.filter((r) => r.status === "pending");
  const compPend = lv.compsOf(me.email).filter((c) => c.status === "pending" && Number(c.workedOn.slice(0, 4)) === year);
  const hist = mine.filter((r) => r.status !== "pending");
  const pendOf = (t) => pend.filter((r) => r.type === t).reduce((n, r) => n + Number(r.days || 0), 0);
  const years = []; for (let y = R.POLICY.startYear; y <= thisYear + 1; y++) years.push(y);
  const waitingFor = `Waiting for ${lv.approverOf(me.email) === "hr" || lv.approverOf(me.email) === "directors" ? lv.approverName(me.email) : "manager"}`;
  const cTot = b.casual.carried + b.casual.quota;

  const cancel = async (r) => {
    const res = await api("POST", `/api/leave/requests/${r.id}/cancel`, {});
    if (!res.ok) { toast(apiMsg(res)); return; }
    toast("Leave request cancelled."); reloadLeave();
  };
  const card = (title, pct, color, label, cells, sub) => (
    <div className="card lv-bal"><div className="card-h"><h3>{title}</h3></div><div className="card-b"><Ring pct={pct} color={color} label={label} sub={sub} />
      <dl className="lv-cells">{cells.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div></div>
  );

  return (
    <section className="section">
      {top}
      <div className="row" style={{ justifyContent: "flex-end", marginBottom: -8 }}>
        <select className="input" aria-label="Year" style={{ width: "auto" }} value={year} onChange={(e) => setYearPick(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>Jan {y} - Dec {y}</option>)}</select>
      </div>
      {future && <div className="callout"><div><b>Looking ahead to {year}.</b> Casual leave carried over assumes you take no more casual leave before 31 Dec {thisYear}. Requests still waiting for approval are not deducted until they are approved.</div></div>}
      <div className="grid g-main">
        <div className="card"><div className="card-h"><h3>Pending leave requests</h3><span className="muted">{pend.length + compPend.length} waiting</span></div>
          {pend.length || compPend.length ? <>
            {pend.map((r) => (
              <div key={r.id} className="li wrap"><div className="grow"><b style={{ fontWeight: 600 }}>{LTYPE[r.type]}</b> · {rangeText(r, shortDate)} · {dd(r.days)}
                <div className="meta">“{r.reason}”{r.notify && r.notify.length > 0 && ` · Notify: ${r.notify.map((x) => (lv.empBy(x) || { name: x }).name).join(", ")}`}</div></div>
                <Pill tone="warn">{waitingFor}</Pill><button type="button" className="btn glass sm" onClick={() => cancel(r)}>Cancel</button></div>))}
            {compPend.map((c) => (
              <div key={`c${c.id}`} className="li"><div className="grow"><b style={{ fontWeight: 600 }}>Comp off credit</b> · worked on {shortDate(c.workedOn)}<div className="meta">“{c.reason}”</div></div>
                <Pill tone="warn">{waitingFor}</Pill></div>))}
          </> : <div className="empty">No pending leave requests. Request leave on the right.</div>}
        </div>
        <div className="card" style={{ alignSelf: "start" }}><div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start", paddingTop: 22 }}>
          <Link className="btn primary" to="/app/leave/apply?self=1">Request leave</Link>
          <button type="button" className="btn link" onClick={() => setModal("comp")}>Request credit for comp off</button>
          <button type="button" className="btn link" onClick={() => setModal("policy")}>Leave policy explanation</button>
        </div></div>
      </div>
      <div className="section" style={{ gap: 16 }}><h3 style={{ fontSize: 22 }}>Leave balances {year}{future ? " (projected)" : ""}</h3>
        <div className="grid g4">
          {card(LTYPE.casual, cTot ? b.casual.left / cTot * 100 : 0, "var(--lv-casual)", dd(b.casual.left), [["Available", dd(b.casual.left)], ["Consumed", dd(b.consumed.casual)], ["Pending approval", dd(pendOf("casual"))], ["Annual quota", dd(b.casual.quota)], ["Carried over", dd(b.casual.carried)]])}
          {card(LTYPE.compoff, b.compoff.earned ? b.compoff.left / b.compoff.earned * 100 : 0, "var(--lv-comp)", b.compoff.earned ? dd(b.compoff.left) : "None", [["Available", dd(b.compoff.left)], ["Consumed", dd(b.consumed.compoff)], ["Pending approval", dd(pendOf("compoff"))], ["Earned", dd(b.compoff.earned)], ["Lapses", "31 Dec"]])}
          {card(LTYPE.sick, b.sick.quota ? b.sick.left / b.sick.quota * 100 : 0, "var(--lv-sick)", dd(b.sick.left), [["Available", dd(b.sick.left)], ["Consumed", dd(b.consumed.sick)], ["Pending approval", dd(pendOf("sick"))], ["Annual quota", dd(b.sick.quota)], ["Lapses", "31 Dec"]])}
          {card(LTYPE.unpaid, b.consumed.unpaid ? 100 : 0, "var(--lv-unpaid)", dd(b.consumed.unpaid), [["Consumed", dd(b.consumed.unpaid)], ["Pending approval", dd(pendOf("unpaid"))], ["Annual quota", "No limit"]], future ? `Taken in ${year}` : "Taken this year")}
        </div>
      </div>
      <div className="card"><div className="card-h"><h3>Leave history</h3></div><div className="tbl-wrap"><table>
        <thead><tr><th>Type</th><th>Dates</th><th>Days</th><th className="hide-sm">Note</th><th>Status</th></tr></thead>
        <tbody>{hist.length ? hist.map((r) => (
          <tr key={r.id}><td>{LTYPE[r.type]}</td><td className="num-cell">{rangeText(r, shortDate)}</td>
            <td className="num-cell">{r.status === "approved" ? <>{r.paidDays} paid{r.lopDays ? <> · <span style={{ color: "var(--bad)" }}>{r.lopDays} loss of pay</span></> : null}</> : dd(r.days)}</td>
            <td className="hide-sm">{r.reason}</td><td><Pill tone={LSTAT[r.status][1]}>{LSTAT[r.status][0]}</Pill></td></tr>))
          : <tr><td colSpan="5"><div className="empty">No leave history to show.</div></td></tr>}</tbody>
      </table></div></div>
      <HolidayCalendar editable={false} />
      {modal === "comp" && <CompRequestModal email={me.email} onClose={() => setModal(null)} />}
      {modal === "policy" && <PolicyModal onClose={() => setModal(null)} />}
    </section>
  );
}
