import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useData } from "../data.jsx";
import { useAuth } from "../auth.jsx";
import { PersonCell, Pill, SectionHead, Stat, shortDate, PageSkeleton } from "../components/ui.jsx";
import { BalanceModal, CompOffModal, DecideButtons, HolidayCalendar, PolicySettingsModal } from "../components/leaveParts.jsx";
import { CompOffHistory, LeaveHistory, ViewTabs } from "../components/leaveSummary.jsx";
import { R } from "../lib/leave.js";
import { LSTAT, LTYPE, dd, lc, rangeText, useLeave } from "../lib/useLeave.js";
import Pager, { usePaged } from "../components/Pager.jsx";


const VIEWS = [["requests", "Requests"], ["balances", "Balances"], ["history", "History"], ["compoff", "Comp off history"], ["holidays", "Holidays"]];

/* A table's rows a page at a time, with the page controls under it once there are more than 10. */
function PagedTable({ items, reset, head, row, cols, empty }) {
  const { rows, pager } = usePaged(items, reset);
  return <><div className="tbl-wrap"><table><thead>{head}</thead><tbody>{rows.length ? rows.map(row) : <tr><td colSpan={cols}><div className="empty">{empty}</div></td></tr>}</tbody></table></div>
    {items.length > 10 && <Pager {...pager} />}</>;
}

export default function LeaveHr() {
  const { can, canAny, canAll } = useAuth();
  // leave.approve (company or a team) decides requests and records leave for others; leave.manage (whole company) edits holidays.
  const decides = can("leave.approve"), manages = canAll("leave.manage");
  const { people } = useData();
  const lv = useLeave();
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);   // "comp", "policy", or { balance: email }
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some(([k]) => k === params.get("view")) ? params.get("view") : "requests";
  const setView = (k) => setParams(k === "requests" ? {} : { view: k }, { replace: true });
  if (!canAny("leave.approve", "leave.manage")) return <section className="section"><SectionHead eyebrow="Time off" title="Leave management" /><div className="empty">You do not have access to leave management. Please ask a super admin if you need it.</div></section>;
  if (!people) return <PageSkeleton />;

  // HR manage everyone's leave here. Their own leave is the "My leave" tab of the shared switch (the directors approve it).
  if (params.get("tab") === "mine") return <Navigate to="/app/my-leave" replace />;

  const { today } = lv, year = Number(today.slice(0, 4));
  const named = (r) => ({ ...r, emp: lv.empBy(r.email) });
  const all = lv.requests.map(named).filter((r) => r.emp);
  const pend = all.filter((r) => r.status === "pending").sort((a, b) => (a.from < b.from ? -1 : 1));
  const compPend = lv.compOffs.filter((c) => c.status === "pending").map((c) => ({ ...c, emp: lv.empBy(c.email) })).filter((c) => c.emp);
  const away = all.filter((r) => r.status === "approved" && r.to >= today).sort((a, b) => (a.from < b.from ? -1 : 1));
  const covered = new Set((lv.L.pay || []).map((p) => lc(p.email)));   // the server sends leave data only for the people this person may see
  const here = people.filter((e) => e.status !== "offboarded" && covered.has(lc(e.email)) && (!q || lc(e.name + e.email).includes(lc(q))));
  const lopNow = lv.lopDaysIn(today.slice(0, 7));
  // Others in the same team away on those dates (the same approver, pending or approved), so a clash is clear before approving.
  const clashes = (r) => all.filter((o) => o.id !== r.id && o.email !== r.email && (o.status === "approved" || o.status === "pending") && o.from <= r.to && o.to >= r.from && lv.approverOf(o.email) === lv.approverOf(r.email));
  const waitingForMe = pend.filter((r) => lv.canDecide(r.email)).length + compPend.filter((c) => lv.canDecide(c.email)).length;

  return (
    <section className="section">
      <SectionHead eyebrow="Time off" title="Leave management"
        sub="Days beyond someone's balance, and all unpaid leave, are loss of pay. The salary cut is monthly gross ÷ 30 for each loss-of-pay day. Saturdays, Sundays and holidays are never counted."
        actions={<>{(canAll("leave.manage") || canAll("leave.approve")) && <a className="btn glass" href={`/api/leave/export?year=${String(lv.today || "").slice(0, 4) || new Date().getFullYear()}`} download>Download Excel</a>}{decides && <><button type="button" className="btn glass" onClick={() => setModal("comp")}>Record comp off</button><Link className="btn primary" to="/app/leave/apply">Add leave for someone</Link></>}</>} />
      <div className="grid g4">
        <Stat value={waitingForMe} label="Waiting for you" />
        <Stat value={away.filter((r) => r.from <= today).length} label="Away today" />
        <Stat value={away.filter((r) => r.from > today).length} label="Upcoming leave" />
        <Stat value={lopNow} label="Loss-of-pay days this month" alert={lopNow > 0} />
      </div>
      <ViewTabs views={VIEWS} view={view} onView={setView} />

      {view === "requests" && <div className="grid g-main">
        <div className="card"><div className="card-h"><h3>Requests waiting</h3><span className="muted">{pend.length + compPend.length} open · approved by each person's reporting manager</span></div>
          {compPend.map((c) => (
            <div key={`c${c.id}`} className="li wrap"><div className="grow"><PersonCell person={c.emp} sub={`Comp off credit · worked on ${shortDate(c.workedOn)}`} /><div className="meta" style={{ margin: "6px 0 0 48px" }}>“{c.reason}”</div></div>
              <DecideButtons kind="comp-offs" id={c.id} email={c.email} /></div>))}
          {pend.map((r) => { const a = lv.preview(r);
            return (
              <div key={r.id} className="li wrap"><div className="grow"><PersonCell person={r.emp} sub={`${LTYPE[r.type]} · ${rangeText(r, shortDate)} · ${dd(a.paid + a.lop)}`} />
                <div className="meta" style={{ margin: "6px 0 0 48px" }}>“{r.reason}”</div>
                {(() => { const c = clashes(r); return c.length ? <div className="meta" style={{ margin: "4px 0 0 48px", color: "var(--warn)" }}>Overlaps with {c.slice(0, 3).map((o) => `${o.emp.name} (${rangeText(o, shortDate)}, ${o.status === "pending" ? "waiting" : "approved"})`).join(", ")}{c.length > 3 ? ` and ${c.length - 3} more` : ""}</div> : null; })()}
                <div className="meta" style={{ margin: "4px 0 0 48px" }}>If approved now: <b style={{ color: "var(--ink)" }}>{dd(a.paid)} paid</b>{a.lop > 0 && <> · <b style={{ color: "var(--bad)" }}>{dd(a.lop)} loss of pay</b></>}</div></div>
                <DecideButtons kind="requests" id={r.id} email={r.email} /></div>); })}
          {!pend.length && !compPend.length && <div className="empty">No requests waiting. New ones show up here.</div>}
        </div>
        <div className="card"><div className="card-h"><h3>Away now &amp; coming up</h3></div>
          {away.length ? away.slice(0, 12).map((r) => <div key={r.id} className="li"><PersonCell person={r.emp} sub={`${LTYPE[r.type]} · ${rangeText(r, shortDate)}`} /></div>) : <div className="empty">No one is on approved leave.</div>}
          {away.length > 12 && <div className="li"><button type="button" className="btn link" onClick={() => setView("history")}>See all {away.length} in History</button></div>}
        </div>
      </div>}

      {view === "balances" && <div className="card"><div className="card-h"><h3>Balances {year}</h3>
        {manages && <button type="button" className="btn glass sm" onClick={() => setModal("policy")}>Leave policy</button>}
        <input className="input" placeholder="Search people" aria-label="Search balances" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220, borderRadius: 999, padding: "8px 14px" }} /></div>
        <div style={{ padding: "0 24px 12px" }}><span className="muted">{LTYPE.casual} {R.POLICY.casualPerYear} days a year, unused days carry over · {LTYPE.sick} {R.POLICY.sickPerYear} days a year, lapses on 31 Dec · {LTYPE.compoff} earned by working a weekend or holiday, lapses on 31 Dec · {LTYPE.unpaid} is always a salary cut · Half days count as 0.5</span></div>
        <PagedTable items={here} reset={q} cols={manages ? 7 : 6} empty={`No one matches “${q}”.`}
          head={<tr><th>Employee</th><th>Casual left</th><th className="hide-sm" title="Carried over + quota − used">Breakdown</th><th>Sick left</th><th>Comp off</th><th>Loss of pay</th>{manages && <th />}</tr>}
          row={(e) => { const b = lv.bal(e, year);
            return (
              <tr key={e.id}><td><PersonCell person={e} sub={e.title} /></td><td className="num-cell"><b>{b.casual.left}</b></td>
                <td className="num-cell hide-sm muted">{b.casual.carried} + {b.casual.quota} − {b.casual.used}</td><td className="num-cell">{b.sick.left}</td><td className="num-cell">{b.compoff.left}</td><td className="num-cell">{b.lopDays || "—"}</td>{manages && <td className="num"><button type="button" className="btn glass sm" onClick={() => setModal({ balance: e.email })}>Correct</button></td>}</tr>); }} /></div>}

      {view === "history" && <LeaveHistory list={all} who title="All leave" />}
      {view === "compoff" && <CompOffHistory list={lv.compOffs} who />}
      {view === "holidays" && <HolidayCalendar editable={manages} />}
      {modal === "comp" && <CompOffModal onClose={() => setModal(null)} />}
      {modal === "policy" && <PolicySettingsModal onClose={() => setModal(null)} />}
      {modal && modal.balance && <BalanceModal email={modal.balance} onClose={() => setModal(null)} />}
    </section>
  );
}
