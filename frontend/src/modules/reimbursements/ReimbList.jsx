import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import { Avatar, Person } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { Dlg, Fld, Head, Ico, RB_STATUS, RbPill, SkelRows, catName, dtShort, lc, money, monthLabel, rbExp, rbReq, useMeta } from "./util.jsx";

const EMPTY = { q: "", category: "", status: "", from: "", to: "", min: "", max: "" };
const rbPay = (c) => (c.approvedAmount != null ? c.approvedAmount : c.amount || 0);
const REVIEWING = ["submitted", "resubmitted", "under_review"];

function Flags({ c }) {
  const v = c.validation || {};
  return <>
    {c.duplicates && c.duplicates.length > 0 && <span className="flag" title="Possible duplicate"><Ico k="warn" />Duplicate?</span>}
    {v.match && v.match.status === "mismatch" && <span className="flag" title="Claimed amount differs from the invoice"><Ico k="warn" />Mismatch</span>}
    {v.policy && v.policy.over && <span className="flag" title="Above the category limit"><Ico k="warn" />Over limit</span>}
    {c.partial ? <span className="flag" title="Approved less than requested">Partly approved</span>
      : c.eligibleAmount != null && c.approvedAmount == null && c.eligibleAmount < rbReq(c) ? <span className="flag" title="Travel policy or budget limits what can be reimbursed"><Ico k="warn" />Policy cap</span> : null}
    {c.budget && <span className="flag ok" title={`Final bill for ${c.budget.requestNo}`}>Budget</span>}
  </>;
}

function Table({ claims, hr, state, meta, filtered, people, onReload }) {
  const nav = useNavigate();
  const head = <tr>{hr ? <th>Employee</th> : <th>Claim</th>}<th>Category</th><th className="hide-sm hide-md">Description</th><th className="num">Amount</th><th className="hide-sm">Submitted</th><th>Receipts</th><th>Status</th><th><span className="sr">Action</span></th></tr>;
  if (state === "loading" && !claims.length) return <div className="tbl-wrap"><table className="rb-table"><thead>{head}</thead><tbody><SkelRows n={5} cols={8} /></tbody></table></div>;
  if (state === "error") return <div className="empty"><Ico k="warn" /><div>Unable to load reimbursements. Please try again.</div><button type="button" className="btn glass sm" onClick={onReload}>Try again</button></div>;
  if (!claims.length) return <div className="empty">{filtered ? "No claims match these filters." : hr ? "No reimbursement claims yet." : "You haven't filed any reimbursement claims yet."}</div>;
  const open = (id, doc) => nav(`/app/reimbursements/${id}${doc ? "?doc=1" : ""}`);
  return (
    <div className="tbl-wrap"><table className="rb-table"><thead>{head}</thead><tbody>
      {claims.map((c) => {
        const exp = rbExp(c), cats = [...new Set(exp.map((x) => x.category))], nr = exp.filter((x) => x.noReceipt).length, d = c.documentCount || 0;
        const emp = people && people.find((p) => lc(p.email) === lc(c.email));
        const review = hr && REVIEWING.includes(c.status);
        return (
          <tr key={c.id} className="click" onClick={() => open(c.id)}>
            <td>{hr ? <Person name={c.employee.name} color={emp ? emp.color : "var(--purple)"} sub={`${c.employee.empNo || "No employee no."} · ${c.claimNo}`} /> : <b className="mono">{c.claimNo}</b>}</td>
            <td>{catName(meta, cats[0])}{cats.length > 1 && <> <span className="muted">+{cats.length - 1} more</span></>}{exp.length > 1 && <div className="muted" style={{ fontSize: 12.5 }}>{exp.length} expenses</div>}</td>
            <td className="hide-sm hide-md rb-desc">{c.description}</td>
            <td className="num">{c.approvedAmount != null && c.partial ? <><b>{money(c.approvedAmount)}</b><div className="muted" style={{ fontSize: 12 }}>of {money(rbReq(c))}</div></> : <b>{money(c.approvedAmount != null ? c.approvedAmount : rbReq(c))}</b>}
              {c.eligibleAmount != null && c.approvedAmount == null && c.eligibleAmount < rbReq(c) && <div className="muted" style={{ fontSize: 12 }}>eligible {money(c.eligibleAmount)}</div>}</td>
            <td className="hide-sm num-cell">{c.submittedAt ? dtShort(c.submittedAt) : <span className="muted">Not sent</span>}</td>
            <td>{d > 0 && <button type="button" className="btn link sm nolink" onClick={(e) => { e.stopPropagation(); open(c.id, true); }}><Ico k="doc" />View{d > 1 ? ` (${d})` : ""}</button>}
              {nr > 0 && <div className="muted" style={{ fontSize: 12.5 }}>{nr} without receipt</div>}{!d && !nr && <span className="muted">None</span>}</td>
            <td><div className="rb-st"><RbPill status={c.status} /><Flags c={c} /></div></td>
            <td className="num"><button type="button" className={`btn ${review ? "primary" : "glass"} sm`} onClick={(e) => { e.stopPropagation(); open(c.id); }}>
              {review ? "Review" : c.status === "draft" || c.status === "changes_requested" ? "Continue" : "View"}</button></td>
          </tr>);
      })}</tbody></table></div>
  );
}

/* HR search: a dropdown of matching employees. Picking one filters the claims to that person. */
function SearchBox({ hr, value, onChange, onPick, onEnter, claims, people }) {
  const [open, setOpen] = useState(false), [at, setAt] = useState(0);
  const withClaims = useMemo(() => new Set(claims.map((c) => lc(c.email))), [claims]);
  const q = lc(value.trim());
  const opts = hr && people ? people.filter((e) => e.status !== "offboarded" && (!q || lc(e.name + " " + e.title + " " + e.email).includes(q)))
    .sort((a, b) => (withClaims.has(lc(b.email)) - withClaims.has(lc(a.email))) || (a.name < b.name ? -1 : 1)).slice(0, 8) : [];
  const idx = Math.min(at, Math.max(0, opts.length - 1));
  const pick = (e) => { setOpen(false); setAt(0); onPick(e.name); };
  const key = (e) => {
    if (!hr) { if (e.key === "Enter") { e.preventDefault(); onEnter(); } return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!open) return setOpen(true); setAt((idx + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % Math.max(1, opts.length)); }
    else if (e.key === "Enter") { e.preventDefault(); if (open && opts[idx]) pick(opts[idx]); else { setOpen(false); onEnter(); } }
    else if (e.key === "Escape") setOpen(false);
  };
  if (!hr) return <input className="input grow" id="rbf-q" type="search" placeholder="Search claim number or description" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={key} aria-label="Search" />;
  return (
    <div className="combo grow" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <input className="input" id="rbf-q" type="search" placeholder="Search employee, claim number, description" value={value} aria-label="Search employee" role="combobox" aria-expanded={open}
        aria-controls="rbf-menu" aria-autocomplete="list" autoComplete="off" style={{ width: "100%" }}
        onChange={(e) => { onChange(e.target.value); setAt(0); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={key} />
      {open && <div className="combo-menu" id="rbf-menu" role="listbox">
        {opts.length ? opts.map((e, i) => <button key={e.email} type="button" className={`combo-opt${i === idx ? " on" : ""}`} role="option" aria-selected={i === idx}
          onMouseDown={(ev) => ev.preventDefault()} onClick={() => pick(e)}>
          <Avatar person={e} /><span><b>{e.name}</b><span className="sub">{e.title || ""}{withClaims.has(lc(e.email)) ? " · has claims" : ""}</span></span></button>)
          : <div className="combo-empty">No employee matches. Press Enter to search claims and descriptions.</div>}</div>}
    </div>
  );
}

/* Monthly totals (HR): each person's claims for the month added up, the amount to add to that month's salary. */
function Monthly({ people, onEmp, refresh }) {
  const [period, setPeriod] = useState(() => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7));
  const [st, setSt] = useState({ state: "loading", data: null });
  useEffect(() => {
    let live = true;
    setSt((s) => ({ ...s, state: "loading" }));
    api("GET", "/api/reimbursements/monthly?period=" + period).then((r) => { if (live) setSt({ state: r.ok ? "ready" : "error", data: r.ok ? r.data : null }); });
    return () => { live = false; };
  }, [period, refresh]);
  const d = st.data, ps = d && d.payrollStatus;
  return (
    <div className="card"><div className="card-h"><div><h3>Monthly totals</h3><span className="muted">Every claim a person files is added up for the month. The approved total is added to that month's salary.</span></div>
      <input className="input" type="month" id="rbm-period" value={period} aria-label="Month" style={{ width: "auto" }} onChange={(e) => e.target.value && setPeriod(e.target.value)} /></div>
      {st.state === "loading" && !d ? <div className="tbl-wrap"><table><tbody><SkelRows n={3} cols={5} /></tbody></table></div>
        : st.state === "error" || !d ? <div className="empty">Unable to load the monthly totals. Please try again.</div>
        : d.people.length ? <div className="tbl-wrap"><table><thead><tr><th>Employee</th><th className="num">Approved claims</th><th className="num">Add to salary</th><th className="num hide-sm">Waiting for review</th><th>Payroll</th></tr></thead><tbody>
          {d.people.map((p) => { const e = (people && people.find((x) => lc(x.email) === lc(p.email))) || { name: p.name, color: "var(--purple)" };
            return <tr key={p.email} className="click" onClick={() => onEmp(e.name || p.email)}><td><Person name={e.name} color={e.color} sub={p.empNo || p.email} /></td><td className="num">{p.approvedCount || "—"}</td>
              <td className="num"><b>{p.approvedTotal ? money(p.approvedTotal) : "—"}</b></td><td className="num hide-sm">{p.waitingCount ? <>{money(p.waitingTotal)} <span className="muted">({p.waitingCount})</span></> : "—"}</td>
              <td>{!p.approvedCount ? <span className="muted">Nothing approved</span> : p.paidTotal >= p.approvedTotal ? <span className="pill p-ok">Paid</span>
                : ps === "processed" || p.inPayrollCount ? <span className="pill p-info">In payroll</span> : <span className="pill p-warn">Payroll pending</span>}</td></tr>; })}
          <tr className="rb-total"><td><b>Total for {monthLabel(d.period)}</b></td><td></td><td className="num"><b>{money(d.totals.approved)}</b></td><td className="num hide-sm">{d.totals.waiting ? money(d.totals.waiting) : "—"}</td>
            <td>{ps === "paid" ? <span className="pill p-ok">Payroll paid</span> : ps === "processed" ? <span className="pill p-info">Payroll processed</span> : <Link className="btn link sm" to="/app/payroll">Go to payroll</Link>}</td></tr>
        </tbody></table></div> : <div className="empty">No claims for {monthLabel(d.period)} yet.</div>}
    </div>
  );
}

function CategoryDlg({ cat, meta, onClose, onSaved }) {
  const toast = useToast();
  const [max, setMax] = useState(cat.maxAmount || ""), [cls, setCls] = useState(cat.allowedClass || ""), [on, setOn] = useState(!!cat.active), [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    const r = await api("PUT", `/api/reimbursements/categories/${cat.key}`, { maxAmount: max, allowedClass: cls, active: on });
    setBusy(false);
    if (!r.ok) return toast(apiMsg(r));
    onSaved(); toast("Category saved.");
  };
  return (
    <Dlg onClose={onClose}><form noValidate onSubmit={save}><div className="card-h" style={{ paddingTop: 24 }}><h3>{cat.name}</h3></div><div className="card-b">
      <Fld id="ct-max" label="Limit per claim (₹)" hint="Claims above it are flagged for HR. Leave empty for no limit."><input className="input" id="ct-max" type="number" min="0" step="100" value={max} placeholder="No limit" onChange={(e) => setMax(e.target.value)} /></Fld>
      <Fld id="ct-class" label="Highest travel class reimbursed in full" hint="Someone who books a higher class enters this class's fare; only that is reimbursed.">
        <select className="input" id="ct-class" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">No class rule</option>{((meta && meta.travelClasses) || []).map((x) => <option key={x}>{x}</option>)}</select></Fld>
      <label className="check" style={{ border: 0, padding: 0 }}><input type="checkbox" id="ct-on" checked={on} onChange={(e) => setOn(e.target.checked)} /><div className="grow"><div className="lbl">Employees can choose this category</div></div></label></div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>Save</button></div></form></Dlg>
  );
}

export default function ReimbList() {
  const { isHr: hr } = useAuth();
  const { people } = useData();
  const nav = useNavigate(), [params] = useSearchParams();
  const [meta, reloadMeta] = useMeta();
  const [f, setF] = useState(() => ({ ...EMPTY, q: params.get("q") || "" }));   // what the inputs show
  const [applied, setApplied] = useState(f);                                       // what was asked of the server
  const [state, setState] = useState("loading");
  const [claims, setClaims] = useState([]), [summary, setSummary] = useState(null), [allMine, setAllMine] = useState(null);
  const [tick, setTick] = useState(0), [catEdit, setCatEdit] = useState(null);
  const timer = useRef(null);

  // An old link to #claim-<id> opens that claim.
  useEffect(() => { const m = location.hash.match(/^#claim-(\d+)$/); if (m) nav(`/app/reimbursements/${m[1]}`, { replace: true }); }, [nav]);

  useEffect(() => {
    let live = true;
    setState("loading");
    const qs = new URLSearchParams(Object.entries(applied).filter(([, v]) => v)).toString();
    api("GET", "/api/reimbursements" + (qs ? "?" + qs : "")).then((r) => {
      if (!live) return;
      if (!r.ok) { setState("error"); return; }
      setClaims(r.data.claims); setSummary(r.data.summary); setState("ready");
      if (!qs) setAllMine(r.data.claims);
    });
    return () => { live = false; };
  }, [applied, tick]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const setNow = (patch) => { clearTimeout(timer.current); const n = { ...f, ...patch }; setF(n); setApplied(n); };
  const setLater = (patch, ms) => { const n = { ...f, ...patch }; setF(n); clearTimeout(timer.current); timer.current = setTimeout(() => setApplied(n), ms); };
  const filtered = Object.values(applied).some(Boolean);

  const card = (lbl, val, sub, tone = "") => <div className={`rb-stat ${tone}`} key={lbl}><span className="lbl">{lbl}</span><b>{val}</b>{sub ? <span className="sub">{sub}</span> : null}</div>;
  let cards;
  if (hr) {
    const s = summary;
    cards = state === "loading" && !s ? Array.from({ length: 6 }, (_, i) => <div className="rb-stat" key={i}><span className="skel" style={{ width: "60%" }} /><span className="skel big" /></div>)
      : s ? [card("Pending review", s.pendingReview, "Waiting for HR", s.pendingReview ? "warn" : ""), card("Needs changes", s.needsChanges, "With the employee"), card("Approved", s.approved, "All time"),
        card("Pending payroll", s.pendingPayroll, money(s.pendingPayrollAmount) + " to pay"), card("Paid this month", money(s.paidThisMonth), monthLabel(new Date().toISOString().slice(0, 7))),
        card("Total reimbursed", money(s.totalReimbursed), "All time")] : null;
  } else {
    const mine = allMine || claims, sum = (a) => money(a.reduce((n, c) => n + rbPay(c), 0));
    const wait = mine.filter((c) => REVIEWING.includes(c.status)), todo = mine.filter((c) => ["draft", "changes_requested"].includes(c.status)),
      pay = mine.filter((c) => ["approved", "payroll_pending", "in_payroll"].includes(c.status)), paid = mine.filter((c) => c.status === "paid");
    cards = [card("Waiting for HR", wait.length, sum(wait)), card("Needs your action", todo.length, "Drafts and changes asked", todo.length ? "warn" : ""),
      card("Coming with payroll", pay.length, sum(pay)), card("Paid to you", sum(paid), `${paid.length} claim${paid.length === 1 ? "" : "s"}`)];
  }
  const cats = (meta && meta.categories) || [];

  return (
    <section className="section">
      <div className="subtabs" role="tablist"><button type="button" role="tab" className="on" aria-selected="true">Expense claims</button>
        <button type="button" role="tab" aria-selected="false" onClick={() => nav("/app/budgets")}>Budget requests</button></div>
      <Head eyebrow={hr ? "Finance" : "Me"} title={hr ? "Reimburse" : "My reimburse"} accent="ments."
        sub={hr ? "Review expense claims against their invoices, approve in full or in part, and send approved amounts to payroll."
          : "Upload an invoice and the details are filled in for you. HR reviews the claim and the approved amount is paid with your salary."}
        actions={<button type="button" className="btn primary" onClick={() => nav("/app/reimbursements/new")}><Ico k="plus" />{hr ? "File a claim for someone" : "New claim"}</button>} />
      <div className={`rb-stats ${hr ? "six" : "four"}`}>{cards}</div>
      <div className="card">
        <div className="rb-filters">
          <SearchBox hr={hr} value={f.q} claims={claims} people={people} onChange={(q) => setLater({ q }, 400)} onPick={(q) => setNow({ q })} onEnter={() => setNow({})} />
          <select className="input" id="rbf-category" aria-label="Category" value={f.category} onChange={(e) => setNow({ category: e.target.value })}><option value="">All categories</option>{cats.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select>
          <select className="input" id="rbf-status" aria-label="Status" value={f.status} onChange={(e) => setNow({ status: e.target.value })}><option value="">All statuses</option>
            {Object.entries(RB_STATUS).filter(([k]) => k !== "approved" && (hr ? k !== "draft" : true)).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select>
          <label className="rb-range"><span>Expense date</span><input className="input" type="date" id="rbf-from" value={f.from} aria-label="From date" onChange={(e) => setNow({ from: e.target.value })} /><span>–</span>
            <input className="input" type="date" id="rbf-to" value={f.to} aria-label="To date" onChange={(e) => setNow({ to: e.target.value })} /></label>
          <label className="rb-range"><span>Amount ₹</span><input className="input" type="number" min="0" step="100" id="rbf-min" value={f.min} placeholder="Min" aria-label="Minimum amount" onChange={(e) => setLater({ min: e.target.value }, 500)} /><span>–</span>
            <input className="input" type="number" min="0" step="100" id="rbf-max" value={f.max} placeholder="Max" aria-label="Maximum amount" onChange={(e) => setLater({ max: e.target.value }, 500)} /></label>
          {Object.values(f).some(Boolean) && <button type="button" className="btn link sm" onClick={() => setNow({ ...EMPTY })}>Clear filters</button>}
        </div>
        <Table claims={claims} hr={hr} state={state} meta={meta} filtered={filtered} people={people} onReload={() => setTick((t) => t + 1)} />
      </div>
      {hr && <Monthly people={people} refresh={tick} onEmp={(name) => { setNow({ ...EMPTY, q: name }); window.scrollTo(0, 0); }} />}
      {hr && <div className="card"><div className="card-h"><h3>Categories</h3><span className="muted">Limits flag claims above them. A travel class rule reimburses only the allowed class's fare when someone books higher.</span></div>
        <div className="tbl-wrap"><table><thead><tr><th>Category</th><th>Limit per claim</th><th>Travel class allowed</th><th>Status</th><th></th></tr></thead><tbody>
          {cats.map((c) => <tr key={c.key}><td>{c.name}</td><td>{c.maxAmount ? money(c.maxAmount) : <span className="muted">No limit</span>}</td><td>{c.allowedClass ? `Up to ${c.allowedClass}` : <span className="muted">No class rule</span>}</td>
            <td>{c.active ? <span className="pill p-ok">On</span> : <span className="pill p-mute">Off</span>}</td><td className="num"><button type="button" className="btn glass sm" onClick={() => setCatEdit(c)}>Edit</button></td></tr>)}
        </tbody></table></div></div>}
      {catEdit && <CategoryDlg cat={catEdit} meta={meta} onClose={() => setCatEdit(null)} onSaved={async () => { setCatEdit(null); await reloadMeta(); setTick((t) => t + 1); }} />}
    </section>
  );
}
