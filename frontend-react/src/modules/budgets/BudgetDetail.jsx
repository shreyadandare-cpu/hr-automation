import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useToast } from "../../components/toast.jsx";
import { BqPill, ClaimPill, Ico, Kv, Wf, catName, dtShort, fdate, money, todayIso, useCats } from "./util.jsx";

/* The stepper follows the request and its final bill: decision, expense, bill, verification, payroll, paid. */
function budgetSteps(b) {
  const c = b.claim, cs = c && c.status, dec = ["approved", "partially_approved", "rejected"].includes(b.status);
  const verified = c && ["payroll_pending", "in_payroll", "paid"].includes(cs);
  const steps = [["Draft", true], ["Submitted", true], ["Under HR review", b.status !== "submitted"],
    [b.status === "rejected" ? "Rejected" : b.status === "partially_approved" ? "Partially approved" : "Approved", dec],
    ["Expense occurred", !!c || (dec && b.status !== "rejected" && b.eventDate <= todayIso())], ["Bill uploaded", !!c && cs !== "draft"], ["Bill verified", !!verified],
    ["Eligible amount calculated", !!verified], ["Payroll pending", (!!c && ["in_payroll", "paid"].includes(cs)) || cs === "payroll_pending"], ["Paid", cs === "paid"]];
  if (b.status === "rejected") return steps.slice(0, 4).map(([l], i) => ({ label: l, state: i === 3 ? "bad" : "done" }));
  const last = steps.map((x) => x[1]).lastIndexOf(true);
  return steps.map(([l, d], i) => ({ label: l, state: d ? (i === last && i < steps.length - 1 ? "current" : "done") : "future" }));
}

function Diff({ req, v }) {
  if (!(v > 0)) return <span className="ferr">Enter an amount more than zero.</span>;
  if (v > req) return <span className="ferr">That's more than the {money(req)} requested.</span>;
  if (v < req) return <span><Ico name="warn" /> Lower budget: <b>{money(req - v)}</b> less than requested. A reason is needed.</span>;
  return <span><Ico name="check" /> The full requested budget.</span>;
}

const Row = ({ k, v, cls = "" }) => <div className={`am-row ${cls}`}><span>{k}</span><b>{v}</b></div>;

export default function BudgetDetail() {
  const { id } = useParams();
  const { user, isHr: hr } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const cats = useCats();
  const [st, setSt] = useState("loading");
  const [b, setB] = useState(null);
  const [events, setEvents] = useState([]);
  const [amt, setAmt] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    let r = await api("GET", "/api/budget-requests/" + id);
    if (r.ok && hr && r.data.request.status === "submitted") {
      const o = await api("POST", `/api/budget-requests/${id}/open`);
      if (o.ok && o.data.changed) r = await api("GET", "/api/budget-requests/" + id);
    }
    if (!r.ok) { setSt(r.status === 404 ? "missing" : "error"); return; }
    setB(r.data.request); setEvents(r.data.events); setAmt(String(r.data.request.requestedBudget)); setReason(""); setSt("ready");
  }, [id, hr]);
  useEffect(() => { setSt("loading"); setB(null); window.scrollTo(0, 0); load(); }, [load]);

  const back = <button className="back" onClick={() => navigate("/app/budgets")}>← {hr ? "All budget requests" : "My budget requests"}</button>;
  if (st === "loading") return <section className="section">{back}<div className="card rb-head"><span className="skel" style={{ width: "30%" }} /><span className="skel big" style={{ width: "45%" }} /></div></section>;
  if (st !== "ready") return <section className="section">{back}<div className="card"><div className="empty">{st === "missing" ? "This budget request doesn't exist or isn't yours to see." : "Unable to load the budget request. Please try again."}</div></div></section>;

  const open = ["submitted", "under_review"].includes(b.status), approvedOk = ["approved", "partially_approved"].includes(b.status);
  const mine = b.email.toLowerCase() === (user.email || "").toLowerCase();
  const cmp = b.comparison;
  const v = Number(amt);

  const decide = async (path, body, okMsg) => {
    const r = await api("POST", `/api/budget-requests/${b.id}/${path}`, body);
    if (!r.ok) { const e = (r.data && r.data.errors) || {}; toast(e.approvedBudget || e.reason || apiMsg(r)); return; }
    toast(okMsg); await load();
  };
  const approve = (value) => {
    const rs = reason.trim();
    if (!(value > 0) || value > b.requestedBudget) return toast(`Approve between ₹1 and ${money(b.requestedBudget)}.`);
    if (value < b.requestedBudget && !rs) { toast("Give a reason for approving a lower amount."); return document.getElementById("bd-reason")?.focus(); }
    decide("approve", { approvedBudget: value, reason: rs }, value < b.requestedBudget ? `Approved a lower budget: ${money(value)}.` : "Budget approved.");
  };
  const reject = () => {
    const rs = reason.trim();
    if (!rs) { toast("Give a reason for the rejection."); return document.getElementById("bd-reason")?.focus(); }
    decide("reject", { reason: rs }, "Budget request rejected.");
  };
  const fileBill = () => navigate(`/app/reimbursements/new?budget=${b.id}`,
    { state: { budget: { id: b.id, requestNo: b.requestNo, purpose: b.purpose, approvedBudget: b.approvedBudget } } });
  const openClaim = (cid) => navigate(`/app/reimbursements/${cid}`);

  const decideCard = hr && open && (
    <div className="card rb-decide"><div className="card-h"><div><h3>HR decision</h3><span className="muted">Requested {money(b.requestedBudget)}</span></div></div>
      <div className="card-b form">
        <Wf id="bd-amt" label="Approved budget (₹)" hint={`Maximum ${money(b.requestedBudget)}. HR can't approve more than was requested.`}>
          <input className="input" id="bd-amt" type="number" min="1" max={b.requestedBudget} step="100" value={amt} onChange={(e) => setAmt(e.target.value)} />
        </Wf>
        <Wf id="bd-reason" label="Reason" hint="Needed for a lower amount or a rejection.">
          <input className="input" id="bd-reason" maxLength={500} placeholder="e.g. Team event budget is ₹1,500 a head" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Wf>
        <div className="span rb-diff" id="bd-diff"><Diff req={b.requestedBudget} v={v} /></div></div>
      <div className="rb-decide-f"><button className="btn danger" onClick={reject}>Reject</button><span className="grow"></span>
        <button className="btn glass" onClick={() => { setAmt(String(b.requestedBudget)); approve(b.requestedBudget); }}>Approve requested {money(b.requestedBudget)}</button>
        <button className="btn primary" id="bd-go" disabled={!(v > 0 && v <= b.requestedBudget)} onClick={() => approve(v)}>Approve {v > 0 ? money(v) : "—"}</button></div></div>
  );

  const bill = approvedOk && (b.claim ? (
    <div className="card"><div className="card-h"><h3>Final bill</h3><ClaimPill status={b.claim.status} /></div><div className="card-b">
      <Kv pairs={[["Claim", <button className="btn link nolink" onClick={() => openClaim(b.claim.id)}>{b.claim.claimNo}</button>], ["Bill amount", money(b.claim.actual)],
        ["Eligible", b.claim.eligible != null ? money(b.claim.eligible) : "Worked out when submitted"], ["Approved", b.claim.approved != null ? money(b.claim.approved) : "Waiting for HR"], ["Paid", b.claim.paid != null ? money(b.claim.paid) : "Not yet"]]} />
      {mine && ["draft", "changes_requested"].includes(b.claim.status) && <div className="row" style={{ marginTop: 12 }}><button className="btn primary sm" onClick={() => openClaim(b.claim.id)}>Continue the bill</button></div>}
    </div></div>
  ) : (
    <div className="card"><div className="card-h"><h3>Final bill</h3><span className="pill p-warn">Not filed yet</span></div><div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="muted">After the event, upload the final bill. Up to <b>{money(b.approvedBudget)}</b> is reimbursed; anything above it is not.</div>
      {mine ? <div><button className="btn primary" onClick={fileBill}><Ico name="doc" />Upload the final bill</button></div> : <div className="muted">Waiting for {b.employee.name} to upload it.</div>}
    </div></div>
  ));

  return (
    <section className="section" style={{ gap: 20 }}>
      {back}
      <div className="card rb-head"><div className="rb-head-l"><div className="eyebrow">Budget request <span className="mono">{b.requestNo}</span></div><h2>{b.purpose}</h2>
        <div className="muted">{b.employee.name}{b.employee.title ? ` · ${b.employee.title}` : ""} · Submitted {dtShort(b.submittedAt)}</div></div>
        <div className="rb-head-r"><b className="rb-amt">{money(b.approvedBudget != null ? b.approvedBudget : b.requestedBudget)}</b>
          {b.approvedBudget != null && b.approvedBudget < b.requestedBudget && <span className="muted">approved of {money(b.requestedBudget)}</span>}
          <BqPill status={b.status} /></div></div>
      <div className="card rb-stepcard"><ol className="rb-steps" aria-label="Budget progress">
        {budgetSteps(b).map((s) => (
          <li key={s.label} className={s.state} aria-current={s.state === "current" ? "step" : undefined}>
            <span className="dot">{s.state === "bad" ? <Ico name="x" /> : s.state === "future" ? null : <Ico name="check" />}</span><span className="t"><b>{s.label}</b></span></li>
        ))}</ol></div>
      {b.status === "rejected" ? <div className="callout bad"><Ico name="x" /><div><b>Rejected</b><div>{b.decisionReason || ""}</div></div></div>
        : b.decisionReason ? <div className="callout"><Ico name="info" /><div><b>HR's reason</b><div>{b.decisionReason}</div></div></div> : null}
      {decideCard}
      <div className="rb-grid"><div className="rb-col">
        <div className="card"><div className="card-h"><h3>Request</h3></div><div className="card-b">
          <Kv pairs={[["Purpose", b.purpose], ["Category", catName(cats, b.category)], ["Requested budget", <b>{money(b.requestedBudget)}</b>], ["Number of people", b.headcount ? String(b.headcount) : "—"], ["Date", fdate(b.eventDate)]]} />
          <div className="rb-descbox"><span className="lab">Description</span><p>{b.description}</p></div></div></div>
      </div><div className="rb-col">
        <div className="card"><div className="card-h"><h3>Budget vs actual</h3></div><div className="card-b rb-amounts">
          <Row k="Requested budget" v={money(b.requestedBudget)} />
          <Row k="Approved budget" v={b.approvedBudget != null ? money(b.approvedBudget) : "Not decided yet"} />
          <Row k="Actual expense" v={cmp ? money(cmp.actual) : "No bill yet"} />
          <Row k="Company covers" v={cmp ? money(cmp.covered) : "—"} cls={cmp ? "total" : ""} />
          <Row k="Employee excess" v={cmp && cmp.excess ? money(cmp.excess) : "—"} cls={cmp && cmp.excess ? "bad" : ""} />
          <div className="muted" style={{ fontSize: 12.5 }}>Company covers the lower of the actual bill and the approved budget. The excess is not reimbursed.</div></div></div>
        {bill}
      </div></div>
      <div className="card"><div className="card-h"><h3>Audit timeline</h3><span className="muted">{events.length} events</span></div>
        <ol className="rb-tl">{events.slice().reverse().map((e, i) => (
          <li key={i}><span className="dot"></span><div><b>{e.kind}</b>{e.note && <div className="muted">{e.note}</div>}<div className="meta">{dtShort(e.at)} · {e.actor || ""}</div></div></li>
        ))}</ol></div>
    </section>
  );
}
