import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";
import Modal from "../../components/Modal.jsx";
import { PayModal } from "../../components/leaveParts.jsx";
import { Pill, shortDate } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { inr } from "../../lib/useLeave.js";

/*
 * Offboarding financial clearance, worked out by the server from the app's own records (GET .../clearance):
 * final salary for the exit month, reimbursements the company still owes (added), advances still outstanding (recovered),
 * and the net. Exits on the 26th-30th get a warning; HR confirms before the offboarding can close.
 */
const money = (v) => (v === null || v === undefined ? "—" : inr(v));
const Warn = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></svg>;
const Check = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
const Info = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;

/** Loads the clearance: { offboardingId } for a started offboarding, or { email, lastDay } as a preview in the wizard. */
export function useClearance({ offboardingId, email, lastDay }) {
  const [c, setC] = useState(null);
  const [error, setError] = useState("");
  const url = offboardingId ? `/api/offboarding/${offboardingId}/clearance`
    : email && /^\d{4}-\d{2}-\d{2}$/.test(lastDay || "") ? `/api/offboarding/clearance/preview?email=${encodeURIComponent(email)}&lastDay=${lastDay}` : null;
  const load = useCallback(async () => {
    if (!url) { setC(null); return; }
    setError("");
    const r = await api("GET", url);
    if (r.ok) setC(r.data); else { setC(null); setError((r.data && r.data.error) || "The financial clearance could not be loaded."); }
  }, [url]);
  useEffect(() => { setC(null); load(); }, [load]);
  return { c, error, reload: load };
}

export const windowText = (c) => `Exit on the ${c.window[0]}th–${c.window[1]}th of the month`;

/** The figures and the breakdown behind them. */
export function ClearancePanel({ c, onReload }) {
  const [pay, setPay] = useState(false);
  const t = c.totals, s = c.salary, rb = c.reimbursements;
  const due = t.totalRecovery > 0;
  return (
    <div className="fc">
      {c.monthEndWindow && (
        <div className="callout warn-c" role="note"><Warn /><div><b>{windowText(c)}.</b> Check the outstanding reimbursements and advances below before completing this offboarding. Any recovery is taken from the final salary.</div></div>)}
      {due
        ? <div className="callout bad" role="status"><Warn /><div><b>Financial clearance is pending.</b> {inr(t.totalRecovery)} is outstanding on {c.advances.outstanding.length === 1 ? "an advance" : `${c.advances.outstanding.length} advances`} and will be recovered from {c.name.split(" ")[0]}'s final salary.</div></div>
        : <div className="callout ok-c" role="status"><Check /><div><b>No outstanding employee recovery found.</b> {rb.payable.length ? `${inr(rb.payableTotal)} in approved reimbursements is still owed to ${c.name.split(" ")[0]} and is added to the final payout.` : "Nothing is owed either way from reimbursements or advances."}</div></div>}
      {rb.awaiting.length > 0 && (
        <div className="callout warn-c"><Warn /><div><b>{rb.awaiting.length} reimbursement claim{rb.awaiting.length === 1 ? " is" : "s are"} still waiting for a decision</b> ({inr(rb.awaitingTotal)}). {rb.awaiting.length === 1 ? "It isn't" : "They aren't"} counted until approved. <Link className="btn link" to="/app/reimbursements">Review claims</Link></div></div>)}

      <div className="fc-sum">
        <div><span>Final salary</span><b>{money(t.finalSalary)}</b><small>{s.monthlyGross ? `${s.daysWorked} of ${s.daysInMonth} days in ${shortDate(s.month + "-01").replace(/^1 /, "")}` : "Monthly salary not set"}</small></div>
        <div><span>Reimbursements payable</span><b className="pos">+ {inr(t.reimbursementsPayable)}</b><small>{rb.payable.length} approved, not paid</small></div>
        <div className={due ? "hot" : ""}><span>Advance recovery</span><b className={due ? "neg" : ""}>− {inr(t.totalRecovery)}</b><small>{c.advances.outstanding.length ? `${c.advances.outstanding.length} outstanding` : "Nothing outstanding"}</small></div>
        <div className="net"><span>Net salary after recovery</span><b>{money(t.netSalary)}</b><small>Final payout {money(t.finalPayout)} with reimbursements</small></div>
      </div>
      {t.shortfall > 0 && <div className="callout bad"><Warn /><div>The recovery is more than the final salary. <b>{inr(t.shortfall)}</b> stays outstanding on the advance after the final salary is used and has to be collected separately.</div></div>}
      {s.monthlyGross === null && (
        <div className="callout"><Info /><div>{c.name}'s monthly salary isn't on record, so the final salary can't be worked out.{due ? " It's needed before the recovery can be confirmed." : ""} <button type="button" className="btn link" onClick={() => setPay(true)}>Add monthly salary</button></div></div>)}

      <details className="fc-sec" open={due || rb.payable.length > 0}>
        <summary>How the final salary is worked out</summary>
        <div className="settle">
          <div><span>Salary for days worked<small>{s.monthlyGross ? `${inr(s.monthlyGross)} a month × ${s.daysWorked}/${s.daysInMonth} days` : "Monthly salary not set"}</small></span><b>{money(s.earned)}</b></div>
          <div><span>Unused casual leave paid out<small>{s.casualLeft} day{s.casualLeft === 1 ? "" : "s"}</small></span><b>{s.monthlyGross ? `+ ${inr(s.encashment)}` : "—"}</b></div>
          <div><span>Loss of pay<small>{s.lopDays} day{s.lopDays === 1 ? "" : "s"} in the exit month</small></span><b className="neg">{s.monthlyGross ? `− ${inr(s.lopDeduction)}` : "—"}</b></div>
          <div className="tot"><span>Final salary<small>Before PF, professional tax and TDS, which payroll applies</small></span><b>{money(s.finalSalary)}</b></div>
        </div>
      </details>

      <div className="fc-sec">
        <h4>Outstanding advances <span className="muted">{inr(c.advances.total)}</span></h4>
        {c.advances.outstanding.length ? (
          <div className="tbl-wrap fc-tbl"><table>
            <thead><tr><th>Date</th><th>Reason</th><th className="num">Original</th><th className="num">Recovered</th><th className="num">Outstanding</th></tr></thead>
            <tbody>{c.advances.outstanding.map((a) => (
              <tr key={a.id}><td>{shortDate(a.date)}</td><td>{a.reason}</td><td className="num">{inr(a.amount)}</td><td className="num">{inr(a.recovered)}</td><td className="num"><b>{inr(a.outstanding)}</b></td></tr>))}</tbody>
            <tfoot><tr><td colSpan={4}>Total outstanding recovery</td><td className="num"><b>{inr(c.advances.total)}</b></td></tr></tfoot>
          </table></div>
        ) : <p className="muted fc-none">No outstanding advances.{c.advances.settled.length ? ` ${c.advances.settled.length} earlier advance${c.advances.settled.length === 1 ? " is" : "s are"} fully recovered and not counted.` : ""}</p>}
      </div>

      <div className="fc-sec">
        <h4>Reimbursements owed to the employee <span className="muted">{inr(rb.payableTotal)}</span></h4>
        {rb.payable.length || rb.awaiting.length ? (
          <div className="tbl-wrap fc-tbl"><table>
            <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {rb.payable.map((r) => <tr key={r.id}><td>{r.date ? shortDate(r.date) : "—"}</td><td>{r.description}{r.claimNo && <div className="muted mono" style={{ fontSize: 12 }}>{r.claimNo}</div>}</td><td className="num">{inr(r.amount)}</td><td><Pill tone="info">{r.statusLabel}</Pill></td></tr>)}
              {rb.awaiting.map((r) => <tr key={r.id} className="fc-muted"><td>{r.date ? shortDate(r.date) : "—"}</td><td>{r.description}{r.claimNo && <div className="muted mono" style={{ fontSize: 12 }}>{r.claimNo}</div>}</td><td className="num">{inr(r.amount)}</td><td><Pill tone="warn">{r.statusLabel} · not counted</Pill></td></tr>)}
            </tbody>
          </table></div>
        ) : <p className="muted fc-none">No unpaid reimbursements.</p>}
        {(rb.leftOut.paid + rb.leftOut.rejected + rb.leftOut.drafts) > 0 && <p className="muted fc-none">Left out: {[rb.leftOut.paid && `${rb.leftOut.paid} already paid`, rb.leftOut.rejected && `${rb.leftOut.rejected} rejected`, rb.leftOut.drafts && `${rb.leftOut.drafts} draft${rb.leftOut.drafts === 1 ? "" : "s"} never submitted`].filter(Boolean).join(", ")}.</p>}
      </div>
      {pay && <PayModal email={c.email} onClose={() => { setPay(false); onReload && onReload(); }} />}
    </div>
  );
}

/** The confirmation HR gives before the offboarding can close. */
export function ClearanceConfirm({ offboardingId, onClose, onDone, onReview }) {
  const toast = useToast();
  const { c, error, reload } = useClearance({ offboardingId });
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    const r = await api("POST", `/api/offboarding/${offboardingId}/clearance/complete`,
      { confirm: true, expectedRecovery: c.totals.totalRecovery, expectedNet: c.totals.netSalary, acknowledgePending: ack });
    setBusy(false);
    if (!r.ok) { toast((r.data && r.data.error) || "Could not confirm. Try again."); if (r.status === 409) reload(); return; }
    toast(r.data.status === "completed" ? `Financial clearance confirmed. ${c.name} is fully offboarded.` : "Financial clearance confirmed.");
    onDone(r.data);
  };
  const t = c && c.totals, due = t && t.totalRecovery > 0;
  const blocked = c && ((due && t.finalSalary === null) || (c.reimbursements.awaiting.length > 0 && !ack));
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Financial clearance</h3>{c && c.monthEndWindow && <Pill tone="warn">Month-end exit</Pill>}</div>
      <div className="card-b">
        {!c ? <div className="empty">{error || "Working out the clearance…"}</div> : <>
          {due ? <div className="fc-confirm hot"><span>Outstanding amount</span><b>{inr(t.totalRecovery)}</b><p>This amount will be recovered from {c.name}'s final salary.</p></div>
            : <div className="fc-confirm ok"><span>Financial clearance</span><b>Nothing to recover</b><p>No outstanding employee recovery found for {c.name}.</p></div>}
          <div className="settle">
            <div><span>Final salary</span><b>{money(t.finalSalary)}</b></div>
            {due && <div><span>Advance recovery</span><b className="neg">− {inr(t.totalRecovery)}</b></div>}
            <div className="tot"><span>Net salary after recovery</span><b>{money(t.netSalary)}</b></div>
            {t.reimbursementsPayable > 0 && <div><span>Plus reimbursements owed<small>Final payout {money(t.finalPayout)}</small></span><b>+ {inr(t.reimbursementsPayable)}</b></div>}
          </div>
          {t.shortfall > 0 && <div className="callout bad"><Warn /><div>Only the final salary can be recovered now; <b>{inr(t.shortfall)}</b> stays outstanding on the advance.</div></div>}
          {due && t.finalSalary === null && <div className="callout bad"><Warn /><div>Add the monthly salary first: the recovery comes out of the final salary. Use <b>Review details</b>.</div></div>}
          {c.reimbursements.awaiting.length > 0 && <label className="check" style={{ border: 0, padding: 0 }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <div className="grow"><div className="lbl">Clear without the {c.reimbursements.awaiting.length} claim{c.reimbursements.awaiting.length === 1 ? "" : "s"} still waiting for a decision ({inr(c.reimbursements.awaitingTotal)})</div><div className="tag">They stay in Reimbursements and can be paid separately</div></div></label>}
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Confirming records these figures, your name and the time in the audit log{due ? ", and marks the recovered amount against the advance" : ""}. The salary records themselves are not changed.</p>
        </>}
      </div>
      <div className="modal-f">
        <button type="button" className="btn glass" onClick={onReview || onClose} disabled={busy}>Review details</button>
        <button type="button" className="btn primary" onClick={confirm} disabled={!c || busy || blocked}>{busy ? "Confirming…" : due ? "Confirm recovery & complete offboarding" : "Confirm & complete offboarding"}</button>
      </div>
    </Modal>
  );
}

/** The card on the leaver's page: live figures until confirmed, then what was confirmed, by whom and when. */
export function ClearanceCard({ rec, onDone }) {
  const { c, error, reload } = useClearance({ offboardingId: rec.id });
  const [open, setOpen] = useState(false);
  const step = rec.steps.find((s) => s.key === "settlement");
  const done = step && step.status === "done";
  const latest = rec.clearance;
  const closed = ["completed", "cancelled"].includes(rec.status);
  return (
    <div className="card" id="financial-clearance">
      <div className="card-h"><h3>Financial clearance</h3>
        {done && latest ? <Pill tone="ok">{latest.status === "cleared" ? "Cleared" : "Recovery confirmed"}</Pill> : c && c.totals.totalRecovery > 0 ? <Pill tone="bad">Recovery due</Pill> : <Pill tone="warn">To confirm</Pill>}</div>
      <div className="card-b">
        {done && latest ? (
          <>
            <div className="callout ok-c"><Check /><div>Confirmed by <b>{latest.completedBy}</b> on {new Date(latest.completedAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}. {latest.status === "cleared" ? "Nothing was owed to the company." : `${inr(latest.totalRecovery)} recovered from the final salary.`}</div></div>
            <div className="fc-sum">
              <div><span>Final salary</span><b>{money(latest.finalSalary)}</b></div>
              <div><span>Reimbursements payable</span><b className="pos">+ {inr(latest.reimbursementsPayable)}</b></div>
              <div><span>Advance recovery</span><b className={latest.totalRecovery ? "neg" : ""}>− {inr(latest.totalRecovery)}</b></div>
              <div className="net"><span>Net salary after recovery</span><b>{money(latest.netSalary)}</b><small>Final payout {money(latest.finalPayout)}</small></div>
            </div>
          </>
        ) : !c ? <div className="empty">{error || "Working out the clearance…"}</div> : (
          <>
            <ClearancePanel c={c} onReload={reload} />
            {!closed && <div className="row" style={{ justifyContent: "flex-end" }}><button type="button" className="btn primary" onClick={() => setOpen(true)}>{c.totals.totalRecovery > 0 ? "Confirm recovery & complete" : "Confirm clearance"}</button></div>}
          </>
        )}
      </div>
      {open && <ClearanceConfirm offboardingId={rec.id} onClose={() => setOpen(false)}
        onReview={() => { setOpen(false); document.getElementById("financial-clearance")?.scrollIntoView({ behavior: "smooth" }); }}
        onDone={(r) => { setOpen(false); onDone(r); }} />}
    </div>
  );
}
