import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import { SectionHead, PersonCell } from "../../components/ui.jsx";
import { BQ_STATUS, BqPill, ClaimPill, Ico, SkelRows, fdate, money, useCats } from "./util.jsx";

export function Tabs({ cur }) {
  const navigate = useNavigate();
  return (
    <div className="subtabs" role="tablist">
      <button type="button" role="tab" className={cur === "reimb" ? "on" : ""} aria-selected={cur === "reimb"} onClick={() => navigate("/app/reimbursements")}>Expense claims</button>
      <button type="button" role="tab" className={cur === "budgets" ? "on" : ""} aria-selected={cur === "budgets"} onClick={() => navigate("/app/budgets")}>Budget requests</button>
    </div>
  );
}

const Stat = ({ lbl, val, sub, tone = "" }) => (
  <div className={`rb-stat ${tone}`}><span className="lbl">{lbl}</span><b>{val}</b>{sub && <span className="sub">{sub}</span>}</div>
);

const BqBill = ({ b }) => !["approved", "partially_approved"].includes(b.status) ? <span className="muted">—</span>
  : b.claim ? <><ClaimPill status={b.claim.status} /><div className="muted" style={{ fontSize: 12 }}>{money(b.claim.actual)} bill</div></>
  : <span className="muted">Not filed yet</span>;

export default function Budgets() {
  const { isHr: hr } = useAuth();
  const { people } = useData();
  const navigate = useNavigate();
  useCats();
  const [state, setState] = useState("loading");
  const [list, setList] = useState([]);
  const [f, setF] = useState({ q: "", status: "" });
  const timer = useRef(null);

  const load = useCallback(async (filters) => {
    setState("loading");
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    const r = await api("GET", "/api/budget-requests" + (qs ? "?" + qs : ""));
    setList(r.ok ? r.data.requests : []); setState(r.ok ? "ready" : "error");
  }, []);
  useEffect(() => { load({ q: "", status: "" }); return () => clearTimeout(timer.current); }, [load]);

  const onQ = (v) => { const n = { ...f, q: v }; setF(n); clearTimeout(timer.current); timer.current = setTimeout(() => load(n), 400); };
  const onStatus = (v) => { const n = { ...f, status: v }; setF(n); load(n); };

  const personOf = (b) => { const e = (people || []).find((p) => p.email.toLowerCase() === b.email.toLowerCase()); return { name: b.employee.name, color: e ? e.color : "var(--purple)", email: b.email }; };
  const isOpen = (b) => ["submitted", "under_review"].includes(b.status);
  const open = list.filter(isOpen), ok = list.filter((b) => ["approved", "partially_approved"].includes(b.status));

  return (
    <section className="section">
      <Tabs cur="budgets" />
      <SectionHead eyebrow={hr ? "Finance" : "Me"} title="Budget" accent="requests."
        sub={hr ? "Approve spending before it happens. The final bill is reimbursed up to the approved budget, never more." : "Planning a team dinner or event? Ask HR for a budget first. After the event, upload the final bill and up to the approved budget is reimbursed."}
        actions={<button className="btn primary" onClick={() => navigate("/app/budgets/new")}><Ico name="plus" />New budget request</button>} />
      <div className="rb-stats four">
        <Stat lbl={hr ? "Waiting for a decision" : "Waiting for HR"} val={open.length} sub={money(open.reduce((n, b) => n + b.requestedBudget, 0)) + " requested"} tone={open.length ? "warn" : ""} />
        <Stat lbl="Approved" val={ok.length} sub={money(ok.reduce((n, b) => n + b.approvedBudget, 0)) + " approved"} />
        <Stat lbl="Bills to file" val={ok.filter((b) => !b.claim).length} sub="Approved, no final bill yet" />
        <Stat lbl="Paid out" val={money(list.reduce((n, b) => n + ((b.claim && b.claim.paid) || 0), 0))} sub="From final bills" />
      </div>
      <div className="card">
        <div className="rb-filters">
          <input className="input grow" type="search" placeholder={hr ? "Search employee, request number, purpose" : "Search request number or purpose"} value={f.q} onChange={(e) => onQ(e.target.value)} aria-label="Search" />
          <select className="input" aria-label="Status" value={f.status} onChange={(e) => onStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(BQ_STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
          </select>
        </div>
        {state === "loading" && !list.length ? <div className="tbl-wrap"><table className="rb-table"><tbody><SkelRows n={4} cols={6} /></tbody></table></div>
          : state === "error" ? <div className="empty"><Ico name="warn" /><div>Unable to load budget requests. Please try again.</div><button className="btn glass sm" onClick={() => load(f)}>Try again</button></div>
          : !list.length ? <div className="empty">{f.q || f.status ? "No budget requests match." : hr ? "No budget requests yet." : "You haven't asked for a budget yet."}</div>
          : <div className="tbl-wrap"><table className="rb-table"><thead><tr><th>Request</th>{hr && <th>Requested by</th>}<th className="num">Requested</th><th className="num">Approved</th><th className="hide-sm">Event date</th><th>Status</th><th className="hide-sm">Final bill</th><th><span className="sr">Action</span></th></tr></thead><tbody>
            {list.map((b) => (
              <tr key={b.id} className="click" onClick={() => navigate(`/app/budgets/${b.id}`)}>
                <td><b>{b.purpose}</b><div className="muted mono" style={{ fontSize: 12 }}>{b.requestNo}</div></td>
                {hr && <td><PersonCell person={personOf(b)} sub={b.employee.title || ""} /></td>}
                <td className="num">{money(b.requestedBudget)}</td>
                <td className="num">{b.approvedBudget != null ? <b>{money(b.approvedBudget)}</b> : "—"}</td>
                <td className="hide-sm num-cell">{fdate(b.eventDate)}</td>
                <td><BqPill status={b.status} /></td>
                <td className="hide-sm"><BqBill b={b} /></td>
                <td className="num"><button className={`btn ${hr && isOpen(b) ? "primary" : "glass"} sm`} onClick={(e) => { e.stopPropagation(); navigate(`/app/budgets/${b.id}`); }}>{hr && isOpen(b) ? "Review" : "View"}</button></td>
              </tr>
            ))}
          </tbody></table></div>}
      </div>
    </section>
  );
}
