import { useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout, CardSkeleton, Pill } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { LoanPill, Progress, STATUS, fdate, money, monthName, monthlyOf, nextMonth, today } from "./util.jsx";

const dt = (s) => new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const Facts = ({ pairs, cols }) => <dl className="facts" style={{ border: 0, padding: 0, ...(cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : {}) }}>{pairs.filter((p) => p).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v === "" || v == null ? "—" : v}</dd></div>)}</dl>;

/* The employee's request form: who they are is filled in, the instalment is worked out as they type. */
export function RequestDialog({ profile, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ amount: "", months: "", reason: "" }), [er, setEr] = useState({}), [busy, setBusy] = useState(false);
  const monthly = monthlyOf(f.amount, f.months);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    const r = await api("POST", "/api/loans", { amount: f.amount, months: f.months, reason: f.reason });
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors) || {}); toast(apiMsg(r)); return; }
    toast("Your loan request has been sent to HR."); onClose(true);
  };
  return (
    <Modal onClose={() => onClose()}><form onSubmit={submit} noValidate>
      <div className="card-h"><h3>Request a loan</h3></div>
      <div className="card-b form">
        <Facts pairs={[["Employee number", profile.empNo], ["Employee name", profile.name], ["Department", profile.dept], ["Designation", profile.title]]} cols={2} />
        <div className="sal-grid">
          <Field id="ln-amt" label="Loan amount requested (₹)" error={er.amount}><input className="input" id="ln-amt" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
          <Field id="ln-mo" label="Preferred repayment duration (months)" error={er.months}><input className="input" id="ln-mo" inputMode="numeric" maxLength={2} value={f.months} onChange={(e) => setF({ ...f, months: e.target.value.replace(/\D/g, "") })} /></Field>
        </div>
        <Field id="ln-why" label="Reason for taking the loan" error={er.reason}><textarea className="input" id="ln-why" rows={3} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <div className="rb-stat"><span className="lbl">Monthly installment estimate</span><b>{monthly ? money(monthly) : "—"}</b>
          <span className="sub">{monthly ? `${money(f.amount)} over ${f.months} month${Number(f.months) === 1 ? "" : "s"}. HR may change the amount and the months before approving.` : "Enter the amount and the months."}</span></div>
        <div className="muted">Nothing is deducted from your salary until HR approves and activates the loan.</div>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose()}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>{busy ? "Sending…" : "Send to HR"}</button></div>
    </form></Modal>
  );
}

/* HR rejects, with a reason the employee will read. */
function RejectDialog({ loan, onClose }) {
  const toast = useToast();
  const [reason, setReason] = useState(""), [er, setEr] = useState(""), [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const r = await api("POST", `/api/loans/${loan.id}/reject`, { reason });
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors && r.data.errors.reason) || apiMsg(r)); return; }
    toast("The request was rejected."); onClose(true);
  };
  return (
    <Modal onClose={() => onClose()}>
      <div className="card-h"><h3>Reject {loan.loanNo}</h3></div>
      <div className="card-b form"><Field id="ln-rj" label={`Reason (${loan.employee.name} will see this)`} error={er}><textarea className="input" id="ln-rj" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose()}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={go}>{busy ? "Rejecting…" : "Reject request"}</button></div>
    </Modal>
  );
}

/* HR's final approval: the amount, months and first month, the whole repayment breakdown and the checks, then Activate. Nothing is deducted before this is confirmed. */
function ApproveDialog({ loan, existing, focusAmount, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ amount: String(loan.requestedAmount), months: String(loan.requestedMonths), firstMonth: nextMonth(), disbursedOn: today(), remarks: "", confirmPaid: false, ack: false });
  const [rv, setRv] = useState(null), [er, setEr] = useState({}), [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await api("GET", `/api/loans/${loan.id}/review?amount=${encodeURIComponent(f.amount)}&months=${encodeURIComponent(f.months)}&first=${encodeURIComponent(f.firstMonth)}`);
      if (r.ok) setRv(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [loan.id, f.amount, f.months, f.firstMonth]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const p = rv && rv.plan, total = p && p.count ? Math.round(Number(f.amount) * 100) / 100 : 0;
  const changed = Number(f.amount) !== loan.requestedAmount;
  const needsAck = rv && rv.existing.length > 0;
  const stop = !rv || !p || !p.count || !!rv.blocked || !!rv.firstMonthError || !f.confirmPaid || (needsAck && !f.ack);
  const go = async () => {
    setBusy(true);
    const r = await api("POST", `/api/loans/${loan.id}/activate`, { amount: f.amount, months: f.months, firstMonth: f.firstMonth, disbursedOn: f.disbursedOn, remarks: f.remarks, confirmPaid: f.confirmPaid, ack: f.ack });
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors) || {}); toast(apiMsg(r)); return; }
    toast(`Loan ${loan.loanNo} is active. Deductions start in ${monthName(f.firstMonth)}.`); onClose(true);
  };
  return (
    <Modal wide onClose={() => onClose()}>
      <div className="card-h"><div><h3>Final approval: {loan.loanNo}</h3><div className="muted">{loan.employee.name} · {loan.employee.empNo} · asked for {money(loan.requestedAmount)} over {loan.requestedMonths} month{loan.requestedMonths === 1 ? "" : "s"}</div></div></div>
      <div className="card-b form">
        {needsAck && <Callout><b>{loan.employee.name} already has {rv.existing.length === 1 ? "a loan or advance" : "loans or advances"} that {rv.existing.length === 1 ? "is" : "are"} not repaid:</b>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{rv.existing.map((x) => <li key={x.id}>{x.reason}: {money(x.outstanding)} left{x.monthly ? `, ${money(x.monthly)} a month` : ""}</li>)}</ul></Callout>}
        {existing && existing.length > 0 && !needsAck && null}
        <div className="sal-grid">
          <Field id="ap-amt" label="Approved loan amount (₹)" error={er.amount} hint={changed ? `Asked for ${money(loan.requestedAmount)}` : "As requested"}><input className="input" id="ap-amt" data-autofocus={focusAmount ? "" : undefined} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
          <Field id="ap-mo" label="Repayment duration (months)" error={er.months}><input className="input" id="ap-mo" inputMode="numeric" maxLength={2} value={f.months} onChange={(e) => setF({ ...f, months: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field id="ap-first" label="First deduction month" error={er.firstMonth}><input className="input" id="ap-first" type="month" value={f.firstMonth} onChange={set("firstMonth")} /></Field>
          <Field id="ap-date" label="Loan disbursement date" error={er.disbursedOn}><input className="input" id="ap-date" type="date" max={today()} value={f.disbursedOn} onChange={set("disbursedOn")} /></Field>
        </div>
        <Field id="ap-rem" label="HR remarks (optional)"><textarea className="input" id="ap-rem" rows={2} maxLength={500} value={f.remarks} onChange={set("remarks")} /></Field>
        {rv && rv.blocked && <Callout><b>This cannot be activated.</b> {rv.blocked}</Callout>}
        {rv && rv.firstMonthError && <Callout><b>First deduction month.</b> {rv.firstMonthError}</Callout>}
        {rv && rv.warnings.map((w, i) => <Callout key={i}>{w}</Callout>)}
        <div className="rb-stats four">
          <div className="rb-stat"><span className="lbl">Approved amount</span><b>{money(total)}</b></div>
          <div className="rb-stat"><span className="lbl">Monthly deduction</span><b>{p && p.count ? money(p.monthly) : "—"}</b></div>
          <div className="rb-stat"><span className="lbl">Duration</span><b>{p && p.count ? `${p.count} month${p.count === 1 ? "" : "s"}` : "—"}</b></div>
          <div className="rb-stat"><span className="lbl">Total repayment</span><b>{money(total)}</b>{p && p.count > 1 && p.last !== p.monthly && <span className="sub">Last instalment {money(p.last)}</span>}</div>
        </div>
        {rv && rv.gross != null && <div className="muted">Monthly salary {money(rv.gross)}{rv.committed ? `, already deducted for other loans and advances ${money(rv.committed)}` : ""}; left after this deduction: {money(rv.available - (p ? p.monthly : 0))}.</div>}
        {rv && rv.schedule.length > 0 && (
          <div className="tbl-wrap" style={{ maxHeight: 220, overflow: "auto" }}><table className="pr-table"><thead><tr><th>Instalment</th><th>Salary month</th><th className="num">Deduction</th><th className="num">Balance after</th></tr></thead>
            <tbody>{rv.schedule.map((r, i) => <tr key={r.n}><td>{r.n}</td><td>{monthName(r.month)}</td><td className="num">{money(r.amount)}</td><td className="num">{money(Math.round((total - rv.schedule.slice(0, i + 1).reduce((n, x) => n + x.amount, 0)) * 100) / 100)}</td></tr>)}</tbody></table></div>)}
        <label className="row" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" checked={f.confirmPaid} onChange={(e) => setF({ ...f, confirmPaid: e.target.checked })} /><span>I confirm that {money(total)} has been paid to {loan.employee.name}. Salary deductions start only after this.</span></label>
        {er.confirmPaid && <span className="ferr" role="alert">{er.confirmPaid}</span>}
        {needsAck && <label className="row" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" checked={f.ack} onChange={(e) => setF({ ...f, ack: e.target.checked })} /><span>I have seen the loan or advance above that is not repaid yet.</span></label>}
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose()}>Back</button><button type="button" className="btn primary" disabled={stop || busy} onClick={go}>{busy ? "Activating…" : "Confirm and activate loan"}</button></div>
    </Modal>
  );
}

/* One loan: the request, the repayment progress and history, and (for HR, on a waiting request) the three decisions. */
export function LoanDetail({ id, hr, me, onClose }) {
  const toast = useToast();
  const [d, setD] = useState(null), [err, setErr] = useState(""), [step, setStep] = useState(null), [busy, setBusy] = useState(false);
  const load = async () => { const r = await api("GET", `/api/loans/${id}`); if (r.ok) setD(r.data); else setErr(apiMsg(r)); };
  useEffect(() => { load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Modal onClose={() => onClose()}><div className="card-b"><Callout>{err}</Callout></div></Modal>;
  if (!d) return <Modal onClose={() => onClose()}><div className="card-b"><CardSkeleton lines={5} /></div></Modal>;
  const l = d.loan, own = l.email.toLowerCase() === me.toLowerCase(), decides = hr && !own && l.status === "pending", live = l.status === "active" || l.status === "completed";
  const done = (changed) => { setStep(null); if (changed) { load(); onClose(true, false); } };
  const cancel = async () => { setBusy(true); const r = await api("POST", `/api/loans/${l.id}/cancel`); setBusy(false); if (r.ok) { toast("Your request was cancelled."); onClose(true); } else toast(apiMsg(r)); };
  return (
    <>
      <Modal wide onClose={() => onClose()}>
        <div className="card-h"><div><h3>{l.loanNo}</h3><div className="muted">{hr ? `${l.employee.name} · ${l.employee.empNo} · ${l.employee.dept}` : l.reason}</div></div><LoanPill status={l.status} /></div>
        <div className="card-b">
          <Facts pairs={[
            hr ? ["Employee", `${l.employee.name} (${l.employee.empNo || "no number"}), ${l.employee.title || "—"}`] : null, hr ? ["Department", l.employee.dept] : null,
            ["Requested amount", money(l.requestedAmount)], ["Reason", l.reason], ["Requested duration", `${l.requestedMonths} month${l.requestedMonths === 1 ? "" : "s"}`], ["Estimated monthly installment", money(l.estimatedMonthly)],
            ["Requested on", dt(l.createdAt)],
            live ? ["Approved amount", money(l.approvedAmount)] : null, live ? ["Monthly deduction", money(l.monthly)] : null, live ? ["Duration", `${l.months} month${l.months === 1 ? "" : "s"}`] : null,
            live ? ["First deduction month", monthName(l.firstMonth)] : null, live ? ["Disbursed on", fdate(String(l.disbursedOn).slice(0, 10))] : null,
            live ? ["Expected completion", monthName(d.expectedCompletion)] : null, l.completedOn ? ["Completed on", fdate(String(l.completedOn).slice(0, 10))] : null,
            l.hrRemarks ? ["HR remarks", l.hrRemarks] : null, l.rejectionReason ? ["Reason for rejection", l.rejectionReason] : null, l.decidedBy && l.status !== "pending" ? ["Decided by", l.decidedBy] : null,
          ]} />
          {live && <div className="rb-stats four">
            <div className="rb-stat"><span className="lbl">Repaid</span><b>{money(l.repaid)}</b></div>
            <div className="rb-stat"><span className="lbl">Outstanding</span><b>{money(l.outstanding)}</b></div>
            <div className="rb-stat"><span className="lbl">Installments paid</span><b>{d.paidCount} of {d.schedule.length}</b></div>
            <div className="rb-stat"><span className="lbl">Installments remaining</span><b>{d.remainingCount}</b></div>
          </div>}
          {live && <Progress percent={l.percent} />}
          {l.status === "completed" && <Callout><b>Loan completed.</b> The loan is fully repaid{l.completedOn ? ` (${fdate(String(l.completedOn).slice(0, 10))})` : ""}. No more instalments are deducted.</Callout>}
          {hr && d.others && d.others.length > 0 && <Callout><b>Other loans of {l.employee.name}:</b><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{d.others.map((o) => <li key={o.id}>{o.loanNo}: {(STATUS[o.status] || [o.status])[0]}, {o.approvedAmount ? `${money(o.approvedAmount)} approved, ${money(o.outstanding)} outstanding` : `${money(o.requestedAmount)} requested`}</li>)}</ul></Callout>}
          {hr && l.status === "pending" && d.existing && d.existing.length > 0 && <Callout><b>Not repaid yet:</b><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{d.existing.map((x) => <li key={x.id}>{x.reason}: {money(x.outstanding)} left</li>)}</ul></Callout>}
          {hr && own && l.status === "pending" && <Callout>This is your own request, so another HR user has to decide it.</Callout>}
          {d.schedule.length > 0 && <>
            <h4 style={{ margin: "8px 0 0" }}>Repayment history</h4>
            <div className="tbl-wrap"><table className="pr-table"><thead><tr><th>Installment</th><th>Salary month</th><th className="num">Amount</th><th>Status</th></tr></thead>
              <tbody>{d.schedule.map((r) => <tr key={r.n}><td>{r.n}</td><td>{monthName(r.month)}</td><td className="num">{money(r.paid != null ? r.paid : r.amount)}</td>
                <td>{r.status === "paid" ? <Pill tone="ok">Paid</Pill> : r.status === "due" ? <Pill tone="warn">Due in payroll</Pill> : <Pill tone="mute">Pending</Pill>}</td></tr>)}</tbody></table></div></>}
          <h4 style={{ margin: "8px 0 0" }}>History</h4>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{d.events.map((e, i) => <li key={i}><b>{e.action}</b> <span className="muted">· {e.actor} · {dt(e.ts)}</span></li>)}</ul>
        </div>
        <div className="modal-f">
          <button type="button" className="btn glass" onClick={() => onClose()}>Close</button>
          {own && l.status === "pending" && <button type="button" className="btn glass" disabled={busy} onClick={cancel}>Cancel request</button>}
          {decides && <button type="button" className="btn glass" onClick={() => setStep("reject")}>Reject</button>}
          {decides && <button type="button" className="btn glass" onClick={() => setStep("change")}>Change amount and approve</button>}
          {decides && <button type="button" className="btn primary" onClick={() => setStep("approve")}>Approve requested amount</button>}
        </div>
      </Modal>
      {step === "reject" && <RejectDialog loan={l} onClose={done} />}
      {(step === "approve" || step === "change") && <ApproveDialog loan={l} existing={d.existing} focusAmount={step === "change"} onClose={done} />}
    </>
  );
}
