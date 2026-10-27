import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useData } from "../data.jsx";
import { useAuth } from "../auth.jsx";
import { PersonCell, Pill, SectionHead, Stat, shortDate } from "../components/ui.jsx";
import { CompOffModal, DecideButtons, HolidayCalendar } from "../components/leaveParts.jsx";
import { R } from "../lib/leave.js";
import { LSTAT, LTYPE, dd, lc, rangeText, useLeave } from "../lib/useLeave.js";
import MyLeave from "./MyLeave.jsx";
import Pager, { Paged } from "../components/Pager.jsx";


export default function LeaveHr() {
  const { isHr } = useAuth();
  const { people } = useData();
  const lv = useLeave();
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);   // "comp"
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "mine" ? "mine" : "manage";   // "mine": the HR person's own leave
  if (!isHr) return <section className="section"><SectionHead eyebrow="Time off" title="Leave" accent="management." /><div className="empty">Only HR can manage leave.</div></section>;
  if (!people) return <section className="section"><div className="empty">Loading…</div></section>;

  // HR manage everyone's leave here, and apply for their own under "My leave" (the directors approve it).
  const tabs = (
    <div className="seg" role="radiogroup" aria-label="Leave view" style={{ alignSelf: "flex-start" }}>
      <label><input type="radio" name="lv-tab" checked={tab === "manage"} onChange={() => setParams({}, { replace: true })} />Manage leave</label>
      <label><input type="radio" name="lv-tab" checked={tab === "mine"} onChange={() => setParams({ tab: "mine" }, { replace: true })} />My leave</label>
    </div>
  );
  if (tab === "mine") return <section className="section">{tabs}<MyLeave /></section>;

  const { today } = lv, year = Number(today.slice(0, 4));
  const named = (r) => ({ ...r, emp: lv.empBy(r.email) });
  const all = lv.requests.map(named).filter((r) => r.emp);
  const pend = all.filter((r) => r.status === "pending").sort((a, b) => (a.from < b.from ? -1 : 1));
  const compPend = lv.compOffs.filter((c) => c.status === "pending").map((c) => ({ ...c, emp: lv.empBy(c.email) })).filter((c) => c.emp);
  const away = all.filter((r) => r.status === "approved" && r.to >= today).sort((a, b) => (a.from < b.from ? -1 : 1));
  const done = all.filter((r) => r.status !== "pending").sort((a, b) => (a.from < b.from ? 1 : -1));
  const here = people.filter((e) => e.status !== "offboarded" && (!q || lc(e.name + e.email).includes(lc(q))));
  const lopNow = lv.lopDaysIn(today.slice(0, 7));
  const waitingForMe = pend.filter((r) => lv.canDecide(r.email)).length + compPend.filter((c) => lv.canDecide(c.email)).length;

  return (
    <section className="section">
      {tabs}
      <SectionHead eyebrow="Time off" title="Leave" accent="management."
        sub="Days beyond someone's balance, and all unpaid leave, are loss of pay. The salary cut is monthly gross ÷ 30 for each loss-of-pay day. Saturdays, Sundays and holidays are never counted."
        actions={<><button type="button" className="btn glass" onClick={() => setModal("comp")}>Record comp off</button><Link className="btn glass" to="/app/leave/apply">Add leave for someone</Link></>} />
      <div className="grid g4">
        <Stat value={waitingForMe} label="Waiting for you" />
        <Stat value={away.filter((r) => r.from <= today).length} label="Away today" />
        <Stat value={away.filter((r) => r.from > today).length} label="Upcoming leave" />
        <Stat value={lopNow} label="Loss-of-pay days this month" alert={lopNow > 0} />
      </div>
      <div className="grid g-main">
        <div className="card"><div className="card-h"><h3>Requests waiting</h3><span className="muted">{pend.length + compPend.length} open · approved by each person's reporting manager</span></div>
          {compPend.map((c) => (
            <div key={`c${c.id}`} className="li wrap"><div className="grow"><PersonCell person={c.emp} sub={`Comp off credit · worked on ${shortDate(c.workedOn)}`} /><div className="meta" style={{ margin: "6px 0 0 48px" }}>“{c.reason}”</div></div>
              <DecideButtons kind="comp-offs" id={c.id} email={c.email} /></div>))}
          {pend.map((r) => { const a = lv.preview(r);
            return (
              <div key={r.id} className="li wrap"><div className="grow"><PersonCell person={r.emp} sub={`${LTYPE[r.type]} · ${rangeText(r, shortDate)} · ${dd(a.paid + a.lop)}`} />
                <div className="meta" style={{ margin: "6px 0 0 48px" }}>“{r.reason}”</div>
                <div className="meta" style={{ margin: "4px 0 0 48px" }}>If approved now: <b style={{ color: "var(--ink)" }}>{dd(a.paid)} paid</b>{a.lop > 0 && <> · <b style={{ color: "var(--bad)" }}>{dd(a.lop)} loss of pay</b></>}</div></div>
                <DecideButtons kind="requests" id={r.id} email={r.email} /></div>); })}
          {!pend.length && !compPend.length && <div className="empty">No requests waiting. New ones show up here.</div>}
        </div>
        <div className="card"><div className="card-h"><h3>Away now &amp; coming up</h3></div>
          {away.length ? away.map((r) => <div key={r.id} className="li"><PersonCell person={r.emp} sub={`${LTYPE[r.type]} · ${rangeText(r, shortDate)}`} /></div>) : <div className="empty">No one is on approved leave.</div>}
        </div>
      </div>

      <div className="card"><div className="card-h"><h3>Balances {year}</h3>
        <input className="input" placeholder="Search people" aria-label="Search balances" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220, borderRadius: 999, padding: "8px 14px" }} /></div>
        <div style={{ padding: "0 24px 12px" }}><span className="muted">{LTYPE.casual} {R.POLICY.casualPerYear} days a year, unused days carry over · {LTYPE.sick} {R.POLICY.sickPerYear} days a year, lapses on 31 Dec · {LTYPE.compoff} earned by working a weekend or holiday, lapses on 31 Dec · {LTYPE.unpaid} is always a salary cut · Half days count as 0.5</span></div>
        <Paged items={here} resetKey={q}>{(rows, pager) => (<>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Employee</th><th>Casual left</th><th className="hide-sm">Carried + quota − used</th><th>Sick left</th><th>Comp off left</th><th>Loss of pay ({year})</th></tr></thead>
          <tbody>{rows.length ? rows.map((e) => { const b = lv.bal(e, year);
            return (
              <tr key={e.id}><td><PersonCell person={e} sub={e.title} /></td><td className="num-cell"><b>{b.casual.left}</b></td>
                <td className="num-cell hide-sm muted">{b.casual.carried} + {b.casual.quota} − {b.casual.used}</td><td className="num-cell">{b.sick.left}</td><td className="num-cell">{b.compoff.left}</td><td className="num-cell">{b.lopDays || "—"}</td> </tr>); })
            : <tr><td colSpan="6"><div className="empty">No one matches “{q}”.</div></td></tr>}</tbody>
        </table></div>
        <Pager {...pager} /></>)}</Paged></div>

      <div className="card"><div className="card-h"><h3>Decided</h3></div>
          <Paged items={done}>{(rows, pager) => (<>
          <div className="tbl-wrap"><table>
          <thead><tr><th>Employee</th><th>Type</th><th className="hide-sm">Dates</th><th>Paid</th><th>Loss of pay</th><th>Status</th></tr></thead>
          <tbody>{rows.length ? rows.map((r) => (
            <tr key={r.id}><td><PersonCell person={r.emp} sub={r.emp.title} /></td><td style={{ whiteSpace: "nowrap" }}>{LTYPE[r.type]}</td><td className="num-cell hide-sm">{rangeText(r, shortDate)}</td>
              <td className="num-cell">{r.status === "approved" ? r.paidDays : "—"}</td><td className="num-cell">{r.status === "approved" ? (r.lopDays || "—") : "—"}</td>
              <td><Pill tone={LSTAT[r.status][1]}>{LSTAT[r.status][0]}</Pill></td></tr>))
            : <tr><td colSpan="6"><div className="empty">Nothing decided yet.</div></td></tr>}</tbody>
        </table></div>
          {pager.total > 10 && <Pager {...pager} />}</>)}</Paged></div>
      <HolidayCalendar editable />
      {modal === "comp" && <CompOffModal onClose={() => setModal(null)} />}
    </section>
  );
}
