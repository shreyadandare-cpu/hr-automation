import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useToast } from "../../components/toast.jsx";
import { BudgetLink, Dlg, Fld, Ico, InfoCallout, LinesTable, RB_STATUS, RbPill, Skel, catName, dtShort, fdate, money, monthLabel, rbElig, rbReq, useMeta } from "./util.jsx";

/* The stepper is built from the claim's real event history: every review round shows, and rejection ends it. */
function claimSteps(c, events) {
  const L = { submitted: "Submitted", under_review: "Under review", changes_requested: "Changes requested", resubmitted: "Resubmitted",
    approved: c.partial ? "Partially approved" : "Approved", rejected: "Rejected", payroll_pending: "Payroll pending", in_payroll: "Included in payroll", paid: "Paid" };
  const seen = [];
  for (const e of events) if (e.status && e.status !== "draft" && L[e.status]) { const last = seen[seen.length - 1]; if (!last || last.status !== e.status) seen.push({ status: e.status, label: L[e.status], at: e.at }); }
  const steps = seen.map((x) => ({ ...x, state: "done" }));
  if (c.status === "rejected") { if (steps.length) steps[steps.length - 1].state = "bad"; return steps; }
  const flow = ["submitted", "under_review", "approved", "payroll_pending", "in_payroll", "paid"];
  const lastFlow = [...seen].reverse().find((x) => flow.includes(x.status));
  const from = lastFlow ? flow.indexOf(lastFlow.status) + 1 : 0;
  if (c.status === "changes_requested") steps.push({ status: "resubmitted", label: "Resubmitted", state: "future" });
  const rest = c.status === "changes_requested" ? flow.slice(1) : flow.slice(from);
  for (const s of rest) steps.push({ status: s, label: L[s], state: "future" });
  if (c.status !== "paid" && c.status !== "draft") { const cur = steps.map((x) => x.state).lastIndexOf("done"); if (cur >= 0) steps[cur].state = "current"; }
  if (c.status === "paid") steps[steps.length - 1].state = "done";
  return steps;
}
const Stepper = ({ c, events }) => (
  <ol className="rb-steps" aria-label="Claim progress">{claimSteps(c, events).map((s, i) => (
    <li key={i} className={s.state} aria-current={s.state === "current" ? "step" : undefined}>
      <span className="dot">{s.state === "bad" ? <Ico k="x" /> : s.state === "future" ? null : <Ico k="check" />}</span>
      <span className="t"><b>{s.label}</b>{s.at && <span>{dtShort(s.at)}</span>}</span></li>))}</ol>
);

const curDocItem = (c, docId) => { const d = (c.items || []).filter((it) => it.document); return d.find((it) => it.document.id === docId) || d[0] || null; };

function DocViewer({ c, docId, zoom, setZoom, onDoc, onBig }) {
  const withDoc = (c.items || []).filter((it) => it.document), nr = (c.items || []).filter((it) => it.noReceipt && !it.document);
  if (!withDoc.length) return <div className="card" id="rb-doc"><div className="card-h"><h3>Receipts</h3></div><div className="empty"><Ico k="doc" /><div>{nr.length ? "Every expense on this claim is a small expense without a receipt, declared by the employee." : "No receipt uploaded."}</div></div></div>;
  const it = curDocItem(c, docId), d = it.document, src = `/api/reimbursements/${c.id}/documents/${d.id}`, isPdf = d.mime === "application/pdf";
  return (
    <div className="card rb-doccard" id="rb-doc"><div className="card-h"><h3>Receipts</h3><span className="muted" title={d.name}>{d.name} · {Math.max(1, Math.round(d.size / 1024))} KB</span></div>
      {(withDoc.length > 1 || nr.length > 0) && <div className="rb-doctabs" role="tablist" aria-label="Receipts">
        {withDoc.map((x) => <button key={x.id} type="button" role="tab" aria-selected={x === it} className={x === it ? "on" : ""} onClick={() => onDoc(x.document.id)}>{x.position}. {c.catName(x.category)} · {money(x.amount)}</button>)}
        {nr.length > 0 && <span className="muted" style={{ alignSelf: "center", fontSize: 13 }}>+ {nr.length} without receipt</span>}</div>}
      <div className={`rb-viewer ${isPdf ? "pdf" : "img"}`}>{isPdf ? <iframe src={`${src}#view=FitH`} title={`Receipt for expense ${it.position}: ${d.name}`} />
        : <div className="rb-imgwrap"><img src={src} alt={`Receipt for expense ${it.position}: ${d.name}`} style={{ width: `${Math.round(zoom * 100)}%` }} /></div>}</div>
      <div className="rb-doctools">
        {isPdf ? <span className="muted">Zoom and page through the PDF with its own toolbar.</span>
          : <><button type="button" className="btn glass sm" aria-label="Zoom out" onClick={() => setZoom(Math.min(3, Math.max(0.5, zoom - 0.25)))}><Ico k="zout" /></button><span className="muted">{Math.round(zoom * 100)}%</span>
            <button type="button" className="btn glass sm" aria-label="Zoom in" onClick={() => setZoom(Math.min(3, Math.max(0.5, zoom + 0.25)))}><Ico k="zin" /></button></>}
        <span className="grow" />
        <button type="button" className="btn glass sm" onClick={() => onBig(it)}><Ico k="open" />Open larger</button>
        <a className="btn glass sm" href={`${src}?download=1`}><Ico k="down" />Download</a>
      </div></div>
  );
}

function Validation({ c, docId }) {
  const v = c.validation || {}, vi = v.items || {}, items = c.items || [];
  const row = (ok, key, txt) => <li key={key} className={ok === true ? "ok" : ok === false ? "bad" : "warn"}>{ok === true ? <Ico k="check" /> : <Ico k="warn" />}<span>{txt}</span></li>;
  const out = [];
  for (const it of items) {
    const x = vi[it.id] || {}, m = x.match || {}, lbl = <b>{it.position}. {c.catName(it.category)} {money(it.amount)}</b>;
    if (it.document) {
      if (m.status === "match") out.push(row(true, it.id, <>{lbl}: amount matches the receipt</>));
      else if (m.status === "mismatch") out.push(row(false, it.id, <>{lbl}: the receipt shows {money(m.invoiceTotal)}. HR review required.</>));
      else out.push(row(null, it.id, <>{lbl}: {x.read && x.read.readable ? "receipt read, but no total found. Compare it by eye." : (x.read && x.read.note) || "the receipt can't be read automatically. Compare it by eye."}</>));
    } else if (it.noReceipt) out.push(row(null, it.id, <>{lbl}: no receipt. Small expense declared by the employee{it.source === "excel" ? " (from their expense sheet)" : ""}.</>));
    else out.push(row(false, it.id, <>{lbl}: receipt missing</>));
  }
  for (const p of (v.policy && v.policy.categories) || []) if (p.limit) out.push(p.over ? row(false, "p" + p.category, <>{p.name}: {money(p.total)} is above the limit of {money(p.limit)}</>) : row(true, "p" + p.category, <>{p.name}: within the limit of {money(p.limit)}</>));
  const cur = curDocItem(c, docId), f = cur && vi[cur.id] && vi[cur.id].read && vi[cur.id].read.fields;
  const cmp = f ? [["Amount", money(cur.amount), f.total != null ? money(f.total) : "—"], ["Vendor", cur.vendor || "—", f.vendor || "—"], ["Invoice no.", cur.invoiceNo || "—", f.invoiceNo || "—"],
    ["Date", fdate(cur.expenseDate), f.invoiceDate ? fdate(f.invoiceDate) : "—"], ["Subtotal", "—", f.subtotal != null ? money(f.subtotal) : "—"], ["Tax", "—", f.tax != null ? money(f.tax) : "—"]] : null;
  const dups = c.duplicates || [];
  return (
    <div className="card"><div className="card-h"><h3>Validation</h3></div><div className="card-b rb-val">
      {dups.length > 0 && <div className="callout bad"><Ico k="warn" /><div><b>Possible duplicate claim.</b> Check before deciding; it is not rejected automatically.
        {dups.map((d) => <div className="rb-dup" key={d.id}><Link className="btn link sm" to={`/app/reimbursements/${d.id}`}>{d.claimNo}</Link> · {money(d.amount)} · {fdate(d.expenseDate)} · {(RB_STATUS[d.status] || [d.status])[0]} — {d.reason}</div>)}</div></div>}
      {out.length ? <ul className="rb-checks">{out}</ul> : <div className="muted">Checks run when receipts are uploaded.</div>}
      {cmp && <><div className="muted" style={{ fontSize: 13 }}>Expense {cur.position} compared with its receipt</div>
        <table className="rb-cmp"><thead><tr><th></th><th>Employee entered</th><th>Read from invoice</th></tr></thead><tbody>{cmp.map(([k, a, b]) => <tr key={k}><th>{k}</th><td>{a}</td><td>{b}</td></tr>)}</tbody></table></>}
    </div></div>
  );
}

function Amounts({ c }) {
  const el = c.eligibility || {}, b = el.budget, req = rbReq(c), elig = rbElig(c);
  const row = (k, v, cls = "") => <div className={`am-row ${cls}`}><span>{k}</span><b>{v}</b></div>;
  return (
    <div className="card"><div className="card-h"><h3>Amount breakdown</h3>{c.partial && <span className="pill p-warn">Partly approved</span>}</div><div className="card-b rb-amounts">
      {row("Requested amount", money(req))}
      {b && <>{row(<>Approved budget <span className="muted mono">{b.requestNo}</span></>, money(b.approvedBudget))}{row("Actual expense", money(b.actual))}{row("Company covers", money(b.covered), "good")}{row("Employee excess", b.excess ? money(b.excess) : "—", b.excess ? "bad" : "")}</>}
      {row("Eligible amount", money(elig), !b && elig < req ? "good" : "")}
      {!b && elig < req && row("Not eligible", money(req - elig), "bad")}
      {c.approvedAmount != null && <>{row("Approved amount", money(c.approvedAmount), "total")}{row("Not approved", c.unapprovedAmount ? money(c.unapprovedAmount) : "—", c.unapprovedAmount ? "bad" : "")}</>}
      {c.paidAmount != null && row("Paid", money(c.paidAmount))}
      {(el.reasons || []).length > 0 && <ul className="am-why">{el.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      {b && <div className="muted" style={{ fontSize: 12.5 }}>Company covers the lower of the actual expense and the approved budget. The excess isn't reimbursed.</div>}
      {c.approvalReason && <InfoCallout><b>HR's reason</b><div>{c.approvalReason}</div></InfoCallout>}
    </div></div>
  );
}

const RdDiff = ({ req, v }) => !(v > 0) ? <span className="ferr">Enter an amount more than zero.</span>
  : v > req ? <span className="ferr">That's more than the {money(req)} requested. HR can approve up to the requested amount.</span>
  : v < req ? <span><Ico k="warn" /> <b>{money(req - v)}</b> of the {money(req)} requested won't be approved. Only {money(v)} goes to payroll.</span>
  : <span><Ico k="check" /> The full amount goes to payroll.</span>;

function Decision({ c, onApprove, onReject, onChanges }) {
  const req = rbReq(c), elig = rbElig(c);
  const [amt, setAmt] = useState(String(elig)), [reason, setReason] = useState("");
  const v = Number(amt);
  return (
    <div className="card rb-decide" id="rb-decide"><div className="card-h"><div><h3>HR decision</h3><span className="muted">Requested {money(req)} · Eligible {money(elig)}</span></div></div>
      <div className="card-b form">
        <Fld id="rd-amt" label="Approved amount (₹)" hint={`Maximum ${money(req)}.${elig < req ? " Pre-filled with the eligible amount." : ""}`}>
          <input className="input" id="rd-amt" type="number" min="1" max={req} step="0.01" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></Fld>
        <Fld id="rd-reason" label="Reason" hint="Needed when you approve less than requested, unless it's the eligible amount.">
          <input className="input" id="rd-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={elig < req ? "e.g. Business class exceeds company travel policy" : "e.g. Approved according to the team event budget"} /></Fld>
        <div className="span rb-diff" id="rd-diff"><RdDiff req={req} v={v} /></div>
      </div>
      <div className="rb-decide-f"><button type="button" className="btn glass" onClick={onChanges}>Request changes</button><button type="button" className="btn danger" onClick={onReject}>Reject</button><span className="grow" />
        {elig < req && <button type="button" className="btn glass" onClick={() => { setAmt(String(req)); onApprove(req, reason, elig); }}>Approve full {money(req)}</button>}
        <button type="button" className="btn primary" id="rd-go" disabled={!(v > 0 && v <= req)} onClick={() => onApprove(v, reason, elig, document.getElementById("rd-reason"))}>Approve {v > 0 ? money(v) : "—"}</button></div></div>
  );
}

export default function ClaimDetail() {
  const { id } = useParams(), nav = useNavigate(), toast = useToast(), [sp] = useSearchParams();
  const { isHr: hr } = useAuth();
  const [meta] = useMeta();
  const [st, setSt] = useState({ state: "loading", claim: null, events: [] });
  const [zoom, setZoom] = useState(1), [docId, setDocId] = useState(null), [dlg, setDlg] = useState(null);
  const wantDoc = useRef(sp.get("doc") === "1");

  const load = useCallback(async (opening) => {
    let r = await api("GET", `/api/reimbursements/${id}`);
    if (opening && r.ok && hr && ["submitted", "resubmitted"].includes(r.data.claim.status)) {   // HR opening it starts the review
      const o = await api("POST", `/api/reimbursements/${id}/open`);
      if (o.ok && o.data.changed) r = await api("GET", `/api/reimbursements/${id}`);
    }
    if (!r.ok) return setSt({ state: r.status === 404 ? "missing" : "error", claim: null, events: [] });
    setSt({ state: "ready", claim: r.data.claim, events: r.data.events });
  }, [id, hr]);
  useEffect(() => { setSt({ state: "loading", claim: null, events: [] }); setZoom(1); setDocId(null); window.scrollTo(0, 0); load(true); }, [load]);
  useEffect(() => { if (st.state === "ready" && wantDoc.current) { wantDoc.current = false; const el = document.getElementById("rb-doc"); if (el) el.scrollIntoView({ block: "start" }); } }, [st.state]);

  const back = <Link className="back" to="/app/reimbursements" style={{ textDecoration: "none" }}>← {hr ? "All reimbursements" : "My reimbursements"}</Link>;
  if (st.state === "loading") return <section className="section" style={{ gap: 20 }}>{back}<div className="card rb-head"><Skel w="30%" /><Skel big w="45%" /><Skel w="60%" /></div><div className="card" style={{ padding: 22 }}><span className="skel" style={{ width: "100%", height: 40 }} /></div>
    <div className="rb-grid"><div className="card" style={{ padding: 22 }}><Skel w="80%" /><Skel w="60%" /></div><div className="card rb-viewer" style={{ height: 420 }} /></div></section>;
  if (st.state === "missing") return <section className="section">{back}<div className="card"><div className="empty">This claim doesn't exist or isn't yours to see.</div></div></section>;
  if (st.state === "error") return <section className="section">{back}<div className="card"><div className="empty"><Ico k="warn" /><div>Unable to load reimbursement details. Please try again.</div><button type="button" className="btn glass sm" onClick={() => { setSt({ state: "loading", claim: null, events: [] }); load(true); }}>Try again</button></div></div></section>;

  const c = { ...st.claim, catName: (k) => catName(meta, k) }, events = st.events;
  const canDecide = hr && ["submitted", "under_review", "resubmitted"].includes(c.status);
  const decide = async (path, body, okMsg) => {
    const r = await api("POST", `/api/reimbursements/${c.id}/${path}`, body);
    if (r.ok) { toast(okMsg); await load(false); }
    return r;
  };
  const approve = (v, reason, elig, reasonEl) => {
    const req = rbReq(c);
    if (!(v > 0) || v > req) return toast(v > req ? `HR can approve up to the ${money(req)} requested.` : "Enter the approved amount.");
    if (v < req && v !== elig && !reason.trim()) { toast("Give a reason for approving less than requested."); if (reasonEl) reasonEl.focus(); return; }
    setDlg({ kind: "approve", v, reason });
  };
  const ownBar = ["draft", "changes_requested"].includes(c.status) && (!hr || c.status === "draft");
  const pay = ["payroll_pending", "in_payroll", "paid"].includes(c.status);
  const nExp = (c.items || []).length;
  const big = dlg && dlg.kind === "big" ? dlg.it : null;

  return (
    <section className="section" style={{ gap: 20 }}>{back}
      <div className="card rb-head">
        <div className="rb-head-l"><div className="eyebrow">Reimbursement <span className="mono">{c.claimNo}</span></div>
          <h2>{c.employee.name}</h2>
          <div className="muted">{c.employee.empNo || "No employee number"}{c.employee.title ? ` · ${c.employee.title}` : ""}{c.submittedAt ? ` · Submitted ${dtShort(c.submittedAt)}` : ""}</div></div>
        <div className="rb-head-r"><b className="rb-amt">{money(c.approvedAmount != null ? c.approvedAmount : rbReq(c))}</b>{c.approvedAmount != null && c.partial && <span className="muted">approved of {money(rbReq(c))}</span>}
          <div className="row" style={{ gap: 6 }}><RbPill status={c.status} />{c.partial && <span className="pill p-warn">Partly approved</span>}</div></div>
      </div>
      <div className="card rb-stepcard"><Stepper c={c} events={events} /></div>
      {c.status === "rejected" ? <div className="callout bad"><Ico k="x" /><div><b>Rejected: {c.rejectionReason}</b>{c.rejectionNote && <div>{c.rejectionNote}</div>}</div></div>
        : c.changeComment && ["changes_requested", "resubmitted", "under_review"].includes(c.status) ? <InfoCallout><b>HR's comment</b><div>{c.changeComment}</div></InfoCallout> : null}
      {c.budget && <InfoCallout>Final bill for budget request <BudgetLink id={c.budget.id}>{c.budget.requestNo}</BudgetLink> · {c.budget.purpose || ""} · approved budget <b>{money(c.budget.approvedBudget)}</b></InfoCallout>}
      {ownBar && <div className="card rb-actions"><div><b>{c.status === "draft" ? "This claim hasn't been sent yet." : "HR asked for changes."}</b><div className="muted">{c.status === "draft" ? "Finish it and submit it for review." : "Update the expenses or invoices, then resubmit."}</div></div>
        <div className="row">{c.status === "draft" && <button type="button" className="btn glass" onClick={() => setDlg({ kind: "delete" })}>Delete draft</button>}
          <button type="button" className="btn primary" onClick={() => nav(`/app/reimbursements/new?edit=${c.id}`)}>{c.status === "draft" ? "Continue" : "Edit and resubmit"}</button></div></div>}
      <div className="card"><div className="card-h"><h3>Expense details</h3><span className="muted">{nExp} expense{nExp === 1 ? "" : "s"} · {money(rbReq(c))} requested</span></div>
        <LinesTable c={c} meta={meta} onDoc={(d) => { setDocId(d); const el = document.getElementById("rb-doc"); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); }} /></div>
      <div className="rb-grid">
        <div className="rb-col">
          <Amounts c={c} />
          {canDecide && <Decision key={`${c.id}-${c.status}-${c.updatedAt}`} c={c} onApprove={approve} onReject={() => setDlg({ kind: "reject" })} onChanges={() => setDlg({ kind: "changes" })} />}
          <Validation c={c} docId={docId} />
          {pay && <div className="card"><div className="card-h"><h3>Payroll</h3></div><div className="card-b"><dl className="rv">
            {[["Payroll month", monthLabel(c.payrollPeriod)], ["Approved", `${money(c.approvedAmount != null ? c.approvedAmount : c.amount)} on ${dtShort(c.approvedAt)}`],
              ["Payroll run", c.payrollRunId ? `#${c.payrollRunId}` : "Not processed yet"], ["Paid", c.paidAt ? `${money(c.paidAmount)} on ${dtShort(c.paidAt)}` : "Not yet"]]
              .map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || "—"}</dd></div>)}</dl></div></div>}
        </div>
        <div className="rb-col rb-sticky"><DocViewer c={c} docId={docId} zoom={zoom} setZoom={setZoom} onDoc={(d) => { setDocId(d); const el = document.getElementById("rb-doc"); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); }} onBig={(it) => setDlg({ kind: "big", it })} /></div>
      </div>
      <div className="card"><div className="card-h"><h3>Audit timeline</h3><span className="muted">{events.length} events</span></div>
        <ol className="rb-tl">{events.slice().reverse().map((e, i) => <li key={i}><span className="dot" /><div><b>{e.kind}</b>{e.note && <div className="muted">{e.note}</div>}<div className="meta">{dtShort(e.at)} · {e.actor || ""}</div></div></li>)}</ol></div>

      {big && <Dlg wide onClose={() => setDlg(null)}>{(() => { const src = `/api/reimbursements/${c.id}/documents/${big.document.id}`; return <>
        <div className="rb-big">{big.document.mime === "application/pdf" ? <iframe src={`${src}#view=FitH`} title="Invoice" /> : <div className="rb-imgwrap"><img src={src} alt="Receipt" /></div>}</div>
        <div className="modal-f"><a className="btn glass" href={`${src}?download=1`}><Ico k="down" />Download</a><button type="button" className="btn primary" onClick={() => setDlg(null)}>Close</button></div></>; })()}</Dlg>}
      {dlg && dlg.kind === "approve" && <ApproveDlg c={c} v={dlg.v} reason={dlg.reason} onClose={() => setDlg(null)} decide={decide} toast={toast} />}
      {dlg && dlg.kind === "reject" && <RejectDlg c={c} reasons={(meta && meta.rejectReasons) || ["Other"]} onClose={() => setDlg(null)} decide={decide} toast={toast} />}
      {dlg && dlg.kind === "changes" && <ChangesDlg c={c} onClose={() => setDlg(null)} decide={decide} />}
      {dlg && dlg.kind === "delete" && <DeleteDlg c={c} onClose={() => setDlg(null)} onDeleted={() => { toast("Draft deleted."); nav("/app/reimbursements"); }} toast={toast} />}
    </section>
  );
}

function ApproveDlg({ c, v, reason, onClose, decide, toast }) {
  const req = rbReq(c), [busy, setBusy] = useState(false);
  const flagged = (c.duplicates || []).length || (c.validation && c.validation.match && c.validation.match.status === "mismatch");
  const nr = c.validation && c.validation.noReceipt;
  const go = async () => {
    setBusy(true);
    const r = await decide("approve", { approvedAmount: v, reason }, v < req ? `Partly approved: ${money(v)} of ${money(req)}.` : "Approved and added to payroll.");
    if (r.ok) return onClose();
    setBusy(false);
    const e = (r.data && r.data.errors) || {};
    toast(e.approvedAmount || e.reason || apiMsg(r));
  };
  return (
    <Dlg onClose={onClose}><div className="card-h" style={{ paddingTop: 24 }}><h3>{v < req ? "Partly approve" : "Approve"} {c.claimNo}?</h3></div><div className="card-b">
      <div className="rb-amounts">{[["Requested", money(req)], ["Approved", money(v)], ["Not approved", v < req ? money(req - v) : "—"]].map(([k, x], i) => <div key={k} className={`am-row ${i === 1 ? "total" : i === 2 && v < req ? "bad" : ""}`}><span>{k}</span><b>{x}</b></div>)}</div>
      <InfoCallout><b>{money(v)}</b> is added to {c.employee.name}'s next payroll, separate from their salary.{reason.trim() && <div className="muted">Reason: {reason.trim()}</div>}</InfoCallout>
      {flagged ? <InfoCallout bad>This claim has open flags (duplicate or amount mismatch). Approve only if you've checked them.</InfoCallout> : null}
      {nr && nr.count ? <div className="muted">Includes {nr.count} small expense{nr.count === 1 ? "" : "s"} without a receipt ({money(nr.total)}), declared by the employee.</div> : null}</div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button><button type="button" className="btn primary" autoFocus disabled={busy} onClick={go}>Approve {money(v)}</button></div></Dlg>
  );
}

function RejectDlg({ c, reasons, onClose, decide, toast }) {
  const [reason, setReason] = useState(""), [note, setNote] = useState(""), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    const r = await decide("reject", { reason, note }, "Claim rejected.");
    if (r.ok) return onClose();
    setBusy(false);
    const er = (r.data && r.data.errors) || {}; setErr(er);
    if (!Object.keys(er).length) toast(apiMsg(r));
  };
  return (
    <Dlg onClose={onClose}><form noValidate onSubmit={submit}><div className="card-h" style={{ paddingTop: 24 }}><h3>Reject {c.claimNo}?</h3></div><div className="card-b">
      <div className="field"><label htmlFor="rj-reason">Reason</label><select className="input" id="rj-reason" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Choose a reason…</option>{reasons.map((x) => <option key={x}>{x}</option>)}</select>{err.reason && <span className="ferr">{err.reason}</span>}</div>
      <div className="field"><label htmlFor="rj-note">Details for the employee</label><textarea className="input" id="rj-note" rows={3} placeholder="Required when the reason is Other" value={note} onChange={(e) => setNote(e.target.value)} />{err.note && <span className="ferr">{err.note}</span>}</div>
      <div className="muted" style={{ fontSize: 13 }}>The employee is told the reason. A rejected claim can't be reopened; they can file a new one.</div></div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button><button type="submit" className="btn danger" disabled={busy}>Reject claim</button></div></form></Dlg>
  );
}

function ChangesDlg({ c, onClose, decide }) {
  const [comment, setComment] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    const r = await decide("request-changes", { comment }, "Changes requested.");
    if (r.ok) return onClose();
    setBusy(false); setErr((r.data && r.data.errors && r.data.errors.comment) || apiMsg(r));
  };
  return (
    <Dlg onClose={onClose}><form noValidate onSubmit={submit}><div className="card-h" style={{ paddingTop: 24 }}><h3>Request changes</h3></div><div className="card-b">
      <div className="field"><label htmlFor="rc-comment">What should {c.employee.name.split(" ")[0]} change?</label><textarea className="input" id="rc-comment" rows={4} placeholder="For example: Please upload the original hotel invoice." value={comment} onChange={(e) => setComment(e.target.value)} />{err && <span className="ferr">{err}</span>}</div></div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>Send to employee</button></div></form></Dlg>
  );
}

function DeleteDlg({ c, onClose, onDeleted, toast }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const r = await api("DELETE", `/api/reimbursements/${c.id}`);
    if (!r.ok) { onClose(); return toast(apiMsg(r)); }
    onDeleted();
  };
  return (
    <Dlg onClose={onClose}><div className="card-h" style={{ paddingTop: 24 }}><h3>Delete this draft?</h3></div><div className="card-b"><div className="muted">{c.claimNo} and its receipts will be removed. This can't be undone.</div></div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button><button type="button" className="btn danger" autoFocus disabled={busy} onClick={go}>Delete draft</button></div></Dlg>
  );
}
