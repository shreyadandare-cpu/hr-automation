import { useCallback, useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { StatusPill, fileUrl, money, monthLabel, when } from "./util.jsx";

/* Arrears or recoveries for a month that is already approved or processed: the original stays as it was. */
function Adjustments() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [add, setAdd] = useState(null);
  const [er, setEr] = useState({});
  const load = useCallback(async () => { const r = await api("GET", "/api/payroll/adjustments"); setList(r.ok ? r.data : []); }, []);
  useEffect(() => { load(); }, [load]);
  const save = async (e) => {
    e.preventDefault();
    const r = await api("POST", "/api/payroll/adjustments", add);
    if (!r.ok) { setEr((r.data && r.data.errors) || {}); toast(apiMsg(r)); return; }
    toast("Adjustment added. It is paid or recovered in the next payroll that is started or recalculated."); setAdd(null); setEr({}); load();
  };
  const cancel = async (a) => {
    const r = await api("DELETE", `/api/payroll/adjustments/${a.id}`);
    if (!r.ok) return toast(apiMsg(r));
    toast(r.data.recalculate ? "Cancelled. Recalculate the open payroll to remove it there." : "Cancelled."); load();
  };
  const set = (k) => (e) => setAdd({ ...add, [k]: e.target.value });
  return (
    <div className="card">
      <div className="card-h"><div><h3>Adjustments to finalized months</h3><div className="muted">An approved payroll never changes. Missed pay is added as arrears, overpayment recovered, in a later month.</div></div>
        <button type="button" className="btn glass" onClick={() => setAdd({ email: "", sourcePeriod: "", kind: "earning", amount: "", reason: "" })}>Add adjustment</button></div>
      <div className="tbl-wrap"><table><thead><tr><th>Employee</th><th>For</th><th>Type</th><th className="num">Amount</th><th>Reason</th><th>Paid in</th><th /></tr></thead><tbody>
        {list && list.length ? list.map((a) => (
          <tr key={a.id} style={a.cancelledAt ? { opacity: 0.55 } : undefined}><td>{a.name}<div className="muted">{a.createdBy} · {when(a.createdAt)}</div></td><td>{monthLabel(a.sourcePeriod)}</td>
            <td>{a.kind === "earning" ? "Arrears" : "Recovery"}</td><td className="num">{money(a.amount)}</td><td>{a.reason}</td>
            <td>{a.cancelledAt ? "Cancelled" : a.appliedPeriod ? monthLabel(a.appliedPeriod) : "Next payroll"}</td>
            <td className="num">{!a.cancelledAt && <button type="button" className="btn glass sm" onClick={() => cancel(a)}>Cancel</button>}</td></tr>))
          : <tr><td colSpan={7}><div className="empty">{list ? "No adjustments." : "Loading…"}</div></td></tr>}
      </tbody></table></div>
      {add && (
        <Modal onClose={() => setAdd(null)}><form onSubmit={save} noValidate>
          <div className="card-h" style={{ paddingTop: 24 }}><h3>Add an adjustment</h3></div>
          <div className="card-b form">
            <Field id="ad-email" label="Employee work email" error={er.email}><input className="input" id="ad-email" type="email" value={add.email} onChange={set("email")} /></Field>
            <div className="sal-grid">
              <Field id="ad-per" label="Month being corrected" error={er.sourcePeriod}><input className="input" id="ad-per" type="month" value={add.sourcePeriod} onChange={set("sourcePeriod")} /></Field>
              <Field id="ad-kind" label="Type" error={er.kind}><select className="input" id="ad-kind" value={add.kind} onChange={set("kind")}><option value="earning">Arrears (pay the employee)</option><option value="deduction">Recovery (deduct)</option></select></Field>
              <Field id="ad-amt" label="Amount (₹)" error={er.amount}><input className="input" id="ad-amt" type="number" min="0" step="0.01" value={add.amount} onChange={set("amount")} /></Field>
            </div>
            <Field id="ad-why" label="Reason" error={er.reason}><input className="input" id="ad-why" maxLength={300} value={add.reason} onChange={set("reason")} /></Field>
          </div>
          <div className="modal-f"><button type="button" className="btn glass" onClick={() => setAdd(null)}>Cancel</button><button type="submit" className="btn primary">Add adjustment</button></div>
        </form></Modal>)}
    </div>
  );
}

export default function HistoryTab({ you }) {
  const [runs, setRuns] = useState(null);
  useEffect(() => { api("GET", "/api/payroll/runs").then((r) => setRuns(r.ok ? r.data : [])); }, []);
  return (
    <>
      <div className="card">
        <div className="card-h"><h3>Payroll history</h3></div>
        {!you.hr && <div className="card-b" style={{ paddingTop: 0 }}><Callout>Payrolls sent to you for review. Bank transfer files are only available to HR.</Callout></div>}
        <div className="tbl-wrap"><table className="pr-table"><thead><tr><th>Month</th><th>Status</th><th className="num">Employees</th><th className="num">Gross</th><th className="num hide-sm">Deductions</th><th className="num hide-sm">TDS</th>
          <th className="num">Net payable</th><th>Approval</th><th>Files</th></tr></thead><tbody>
          {runs && runs.length ? runs.map((r) => {
            const t = r.totals || {}, wb = r.files.filter((f) => f.kind === "workbook"), bank = r.files.filter((f) => f.kind === "bank");
            return (
              <tr key={r.id}>
                <td><b>{monthLabel(r.period)}</b><div className="muted">FY {r.fy}</div></td>
                <td><StatusPill run={r} />{r.paidAt && <div className="muted">{when(r.paidAt)}{r.bankReference ? ` · ${r.bankReference}` : ""}</div>}</td>
                <td className="num">{r.people}</td><td className="num">{money(t.gross)}</td><td className="num hide-sm">{money(t.totalDeductions)}</td><td className="num hide-sm">{money(t.tds)}</td>
                <td className="num"><b>{money(r.netTotal)}</b></td>
                <td style={{ whiteSpace: "normal", minWidth: 180 }}>{r.reviewedBy ? <>{r.statusLabel === "Rejected" || r.status === "changes_requested" ? "Returned" : "Reviewed"} by {r.reviewedBy}<div className="muted">{when(r.reviewedAt)}{r.reviewNote ? ` · “${r.reviewNote}”` : ""}</div></>
                  : r.workflow ? <span className="muted">{r.submittedBy ? `Sent by ${r.submittedBy}` : "Not reviewed yet"}</span> : <span className="muted">Before review workflow</span>}</td>
                <td><div className="pr-files">
                  {wb.map((f) => <a key={f.id} href={fileUrl(r.id, f.id)} download className={f.superseded ? "muted" : ""}>Excel v{f.version}{f.superseded ? " (old)" : ""}</a>)}
                  {bank.map((f) => <a key={f.id} href={fileUrl(r.id, f.id)} download className={f.superseded ? "muted" : ""}>Bank file v{f.version}</a>)}
                  {!r.files.length && <span className="muted">—</span>}</div></td>
              </tr>);
          }) : <tr><td colSpan={9}><div className="empty">{runs ? "No payroll yet." : "Loading…"}</div></td></tr>}
        </tbody></table></div>
      </div>
      {you.hr && <Adjustments />}
    </>
  );
}
