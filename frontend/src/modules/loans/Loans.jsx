import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { SectionHead, ViewTabs, CardSkeleton, Callout } from "../../components/ui.jsx";
import { Tabs } from "../budgets/Budgets.jsx";
import { LoanDetail, RequestDialog } from "./LoanDialogs.jsx";
import { LoanPill, MONTHS, Progress, fdate, money } from "./util.jsx";

const Stat = ({ lbl, val, sub, tone = "" }) => <div className={`rb-stat ${tone}`}><span className="lbl">{lbl}</span><b>{val}</b>{sub && <span className="sub">{sub}</span>}</div>;
const GRID = { display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" };
const VIEWS_HR = [["pending", "Pending approvals"], ["all", "All loan requests"], ["active", "Active loans"], ["completed", "Completed loans"], ["tracking", "Repayment tracking"], ["mine", "My loans"]];
const YEARS = (() => { const y = new Date().getFullYear(); return [y, y - 1, y - 2]; })();

/* Loan requests, inside Expenses next to Budget requests. Everyone asks for a loan and follows their own; HR sees every loan, decides the waiting ones and tracks repayment.
   The instalments are deducted by payroll by itself once HR activates a loan. */
export default function Loans() {
  const { user, canAll } = useAuth(), hr = canAll("advances.approve");
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState(hr ? "pending" : "mine");
  const [mine, setMine] = useState(null), [all, setAll] = useState(null), [err, setErr] = useState("");
  const [f, setF] = useState({ q: "", dept: "", status: "", month: "", year: "" });
  const [dlg, setDlg] = useState(() => (params.get("open") ? { kind: "detail", id: Number(params.get("open")) } : null));
  const loadMine = useCallback(async () => { const r = await api("GET", "/api/loans/mine"); if (r.ok) setMine(r.data); else setErr(apiMsg(r)); }, []);
  const loadAll = useCallback(async (filters) => {
    if (!hr) return;
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    const r = await api("GET", `/api/loans${qs ? `?${qs}` : ""}`);
    if (r.ok) setAll(r.data); else setErr(apiMsg(r));
  }, [hr]);
  useEffect(() => { loadMine(); }, [loadMine]);
  useEffect(() => { const t = setTimeout(() => loadAll(f), f.q ? 300 : 0); return () => clearTimeout(t); }, [f, loadAll]);
  const reload = () => { loadMine(); loadAll(f); };
  const close = (changed) => { setDlg(null); if (params.get("open")) setParams({}, { replace: true }); if (changed) reload(); };

  const asHr = hr && view !== "mine", rows = asHr ? (all ? all.loans.filter((l) => ({ pending: l.status === "pending", all: true, active: l.status === "active", completed: l.status === "completed", tracking: l.status === "active" || l.status === "completed" }[view])) : null) : (mine ? mine.loans : null);
  const own = mine ? mine.loans : [], active = own.find((l) => l.status === "active");
  const s = all && all.stats;

  const stats = asHr && s ? (
    <>
      <div style={GRID}>
        <Stat lbl="Total loan requests" val={s.total} />
        <Stat lbl="Pending HR approval" val={s.pending} tone={s.pending ? "warn" : ""} />
        <Stat lbl="Active loans" val={s.active} />
        <Stat lbl="Completed loans" val={s.completed} />
        <Stat lbl="Total outstanding" val={money(s.outstanding)} sub="Still to be deducted" />
      </div>
      <div style={GRID}>
        <Stat lbl="Rejected requests" val={s.rejected} />
        <Stat lbl="Total disbursed" val={money(s.disbursed)} />
        <Stat lbl="Total repaid" val={money(s.repaid)} />
      </div>
    </>) : (
    <div style={GRID}>
      <Stat lbl="My loan requests" val={own.length} />
      <Stat lbl="Pending HR approval" val={own.filter((l) => l.status === "pending").length} />
      <Stat lbl="Active loans" val={own.filter((l) => l.status === "active").length} />
      <Stat lbl="Completed loans" val={own.filter((l) => l.status === "completed").length} />
      <Stat lbl="Outstanding" val={money(own.reduce((n, l) => n + l.outstanding, 0))} sub="Still to be deducted" />
    </div>);

  return (
    <section className="section">
      <SectionHead title={hr ? "Expenses" : "My expenses"} tabs={<Tabs cur="loans" />}
        sub={hr ? "Review loan requests, approve the amount and the months, and activate the loan. Payroll then deducts each instalment from the salary by itself until it is repaid." : "Need to borrow from the company? Request a loan. HR decides the amount and the months, and the instalments are deducted from your salary once the loan is active."}
        actions={<button className="btn primary" onClick={() => setDlg({ kind: "request" })} disabled={!mine}>Request a loan</button>} />
      {err && <Callout>{err}</Callout>}
      {hr && <ViewTabs label="Loan views" views={VIEWS_HR} view={view} onView={setView} />}
      {stats}
      {!asHr && active && <ActiveLoan loan={active} onOpen={() => setDlg({ kind: "detail", id: active.id })} />}
      <div className="card">
        <div className="card-h"><h3>{asHr ? (VIEWS_HR.find((v) => v[0] === view) || [])[1] : "My loan requests"}</h3></div>
        {asHr && (
          <div className="filters">
            <input className="input grow" type="search" placeholder="Search employee name, number or loan number" aria-label="Search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
            <select className="input" aria-label="Department" value={f.dept} onChange={(e) => setF({ ...f, dept: e.target.value })}><option value="">All departments</option>{(all ? all.departments : []).map((d) => <option key={d}>{d}</option>)}</select>
            {view === "all" && <select className="input" aria-label="Loan status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All statuses</option><option value="pending">Pending HR approval</option><option value="active">Approved / Active</option><option value="completed">Completed</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select>}
            <select className="input" aria-label="Month requested" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })}><option value="">Any month</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
            <select className="input" aria-label="Year requested" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })}><option value="">Any year</option>{YEARS.map((y) => <option key={y}>{y}</option>)}</select>
          </div>)}
        {!rows ? <div className="card-b"><CardSkeleton lines={4} /></div> : !rows.length ? <div className="empty">{asHr ? (view === "pending" ? "No loan requests are waiting for a decision." : "No loans match.") : "You have not requested a loan yet."}</div> : (
          <div className="tbl-wrap"><table className="pr-table">
            <thead><tr><th>Loan</th>{asHr && <th>Employee</th>}<th className="num">Requested</th><th className="num">Approved</th><th className="num hide-sm">Monthly</th><th className="hide-sm">Repayment</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((l) => (
              <tr key={l.id} className="click" onClick={() => setDlg({ kind: "detail", id: l.id })}>
                <td><b>{l.loanNo}</b><div className="muted" style={{ fontSize: 12 }}>{fdate(String(l.createdAt).slice(0, 10))} · {l.reason.length > 40 ? `${l.reason.slice(0, 40)}…` : l.reason}</div></td>
                {asHr && <td><b>{l.employee.name}</b><div className="muted" style={{ fontSize: 12 }}>{l.employee.empNo} · {l.employee.dept}</div></td>}
                <td className="num">{money(l.requestedAmount)}</td><td className="num">{l.approvedAmount != null ? <b>{money(l.approvedAmount)}</b> : "—"}</td>
                <td className="num hide-sm">{l.monthly != null ? money(l.monthly) : l.status === "pending" ? <span className="muted">{money(l.estimatedMonthly)} est.</span> : "—"}</td>
                <td className="hide-sm">{l.status === "active" || l.status === "completed" ? <><Progress percent={l.percent} /><span className="muted" style={{ fontSize: 12 }}>{money(l.outstanding)} outstanding</span></> : "—"}</td>
                <td><LoanPill status={l.status} /></td>
                <td className="num"><button type="button" className={`btn ${asHr && l.status === "pending" && l.email.toLowerCase() !== user.email.toLowerCase() ? "primary" : "glass"} sm`} onClick={(e) => { e.stopPropagation(); setDlg({ kind: "detail", id: l.id }); }}>{asHr && l.status === "pending" && l.email.toLowerCase() !== user.email.toLowerCase() ? "Review" : "View"}</button></td>
              </tr>))}</tbody>
          </table></div>)}
      </div>
      {dlg && dlg.kind === "request" && mine && <RequestDialog profile={mine.profile} onClose={(changed) => { setDlg(null); if (changed) { setView(hr ? "mine" : view); reload(); } }} />}
      {dlg && dlg.kind === "detail" && <LoanDetail id={dlg.id} hr={hr} me={user.email} onClose={close} />}
    </section>
  );
}

/* The person's live loan: how much is repaid and what is left. */
function ActiveLoan({ loan, onOpen }) {
  return (
    <div className="card">
      <div className="card-h"><div><h3>Active loan details</h3><div className="muted">{loan.loanNo} · {loan.reason}</div></div><button type="button" className="btn glass sm" onClick={onOpen}>Repayment history</button></div>
      <div className="card-b">
        <div style={GRID}>
          <Stat lbl="Approved amount" val={money(loan.approvedAmount)} sub={`Asked for ${money(loan.requestedAmount)}`} />
          <Stat lbl="Monthly deduction" val={money(loan.monthly)} sub={`${loan.months} month${loan.months === 1 ? "" : "s"}`} />
          <Stat lbl="Repaid so far" val={money(loan.repaid)} />
          <Stat lbl="Outstanding" val={money(loan.outstanding)} />
        </div>
        <Progress percent={loan.percent} />
      </div>
    </div>
  );
}
