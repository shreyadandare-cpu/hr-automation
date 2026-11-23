import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { Pill, SectionHead, shortDate, PageSkeleton } from "../components/ui.jsx";
import { CompRequestModal, HolidayCalendar } from "../components/leaveParts.jsx";
import { CompOffHistory, LeaveHistory, LeaveStats, PolicyExplain, ViewTabs } from "../components/leaveSummary.jsx";
import TodayCards from "../components/TodayCards.jsx";
import LeaveBalanceCards from "../components/LeaveBalanceCards.jsx";
import { useToast } from "../components/toast.jsx";
import { R } from "../lib/leave.js";
import { LTYPE, dd, rangeText, useLeave } from "../lib/useLeave.js";

const VIEWS = [["summary", "Summary"], ["history", "Leave history"], ["compoff", "Comp off history"], ["holidays", "Holidays"]];

/* The employee's own leave, laid out like a standard HR leave screen: a summary (waiting requests, stats, balances),
   the full history with filters and pages, and the holiday list, each on its own tab. */
export default function MyLeave() {
  const { user, canAll } = useAuth();
  const { people, reloadLeave } = useData();
  const lv = useLeave(), toast = useToast();
  const [modal, setModal] = useState(null);
  const [yearPick, setYearPick] = useState(null);
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some(([k]) => k === params.get("view")) ? params.get("view") : "summary";
  const setView = (k) => { const n = new URLSearchParams(params); if (k === "summary") n.delete("view"); else n.set("view", k); setParams(n, { replace: true }); };
  if (!people) return <PageSkeleton />;

  const me = lv.empBy(user.email), thisYear = Number(lv.today.slice(0, 4)), year = yearPick || thisYear;
  const top = <SectionHead title="My leave" sub="Your requests, balances and history." />;
  if (!me) return <section className="section">{top}<div className="card"><div className="empty">Your employee record wasn't found, so leave can't be shown. Ask HR to check your work email.</div></div></section>;

  const future = year > thisYear;
  const inYear = (r) => Number(r.from.slice(0, 4)) === year;
  const mine = lv.reqsOf(me.email).filter(inYear);
  const pend = mine.filter((r) => r.status === "pending").sort((a, c) => (a.from < c.from ? -1 : 1));
  const compPend = lv.compsOf(me.email).filter((c) => c.status === "pending" && Number(c.workedOn.slice(0, 4)) === year);
  const years = []; for (let y = R.POLICY.startYear; y <= thisYear + 1; y++) years.push(y);
  const waitingFor = `Waiting for ${lv.approverName(me.email)}`;

  const cancel = async (r) => {
    const res = await api("POST", `/api/leave/requests/${r.id}/cancel`, {});
    if (!res.ok) { toast(apiMsg(res)); return; }
    toast("Leave request cancelled."); reloadLeave();
  };
  const yearPicker = <select className="input" aria-label="Year" style={{ width: "auto" }} value={year} onChange={(e) => setYearPick(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>Jan {y} - Dec {y}</option>)}</select>;

  return (
    <section className="section">
      {top}
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}><ViewTabs views={VIEWS} view={view} onView={setView} />{view !== "holidays" && view !== "compoff" && yearPicker}</div>

      {view === "summary" && <>
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
            </> : <div className="empty">You have no pending leave requests.</div>}
          </div>
          <div className="card" style={{ alignSelf: "start" }}><div className="card-b lv-actions">
            <Link className="btn primary" to="/app/leave/apply?self=1">Request leave</Link>
            <button type="button" className="btn link" onClick={() => setModal("comp")}>Request credit for compensatory off</button>
            <button type="button" className="btn link" onClick={() => setView("compoff")}>Compensatory off requests history</button>
            <button type="button" className="btn link" onClick={() => setModal("policy")}>Leave policy explanation</button>
          </div></div>
        </div>
        <h2 className="lv-h">My leave stats</h2>
        <LeaveStats email={me.email} year={year} />
        <h2 className="lv-h">Leave balances {year}{future ? " (projected)" : ""}</h2>
        <LeaveBalanceCards email={me.email} year={year} />
        {year === thisYear && <TodayCards />}
      </>}

      {view === "history" && <LeaveHistory list={mine} onCancel={cancel} title={`Leave history ${year}`} />}
      {view === "compoff" && <CompOffHistory list={lv.compsOf(me.email)} onRequest={() => setModal("comp")} />}
      {view === "holidays" && <HolidayCalendar editable={canAll("leave.manage")} />}   {/* HR (leave management) can upload and edit the list here too */}

      {modal === "comp" && <CompRequestModal email={me.email} onClose={() => setModal(null)} />}
      {modal === "policy" && <PolicyExplain email={me.email} year={year} onClose={() => setModal(null)} />}
    </section>
  );
}
