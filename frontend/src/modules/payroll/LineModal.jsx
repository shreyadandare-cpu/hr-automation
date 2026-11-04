import { useState } from "react";
import { api, apiMsg } from "../../api.js";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { LinePill, money } from "./util.jsx";

const AMOUNTS = [["incentives", "Incentives"], ["bonus", "Bonus"], ["overtime", "Overtime"], ["reimbursements", "Reimbursements (not taxed)"]];
const toForm = (i = {}) => {
  const f = {};
  for (const k of ["incentives", "bonus", "overtime", "otherEarnings", "otherEarningsReason", "reimbursements", "adjustment", "adjustmentReason", "additionalDeductions",
    "additionalDeductionsReason", "lopDays", "tdsOverride", "tdsOverrideReason", "holdReason", "note"]) f[k] = i[k] ?? "";
  f.hold = !!i.hold;
  f.overrideOn = i.tdsOverride !== undefined;
  return f;
};

function Rows({ list, total, label }) {
  return (
    <table className="ln-tbl"><tbody>
      {list.map((x, i) => <tr key={i}><td>{x.name}</td><td className="num">{money(x.amount)}</td></tr>)}
      {total !== undefined && <tr className="rb-total"><td><b>{label}</b></td><td className="num"><b>{money(total)}</b></td></tr>}
    </tbody></table>
  );
}

function TdsWorking({ b }) {
  const r = [["Salary paid this year so far", b.salaryPaidSoFar], ["This month's taxable salary", b.salaryThisMonth], [`Rest of the year (${b.monthsAfter} × ${money(b.regularMonthly)})`, b.regularMonthly * b.monthsAfter],
    ["Previous employer and other income", b.previousEmployerIncome + b.otherIncome], ["Gross total income", b.grossTotalIncome],
    ...b.deductions.map((d) => [`Less: ${d.name}${d.capped ? ` (capped at ${money(d.capped)})` : ""}`, -d.amount]), ["Taxable income", b.taxableIncome],
    ...b.slabs.map((s) => [`${money(s.from)} – ${s.to ? money(s.to) : "above"} @ ${s.rate}%`, s.tax]), ["Tax on slabs", b.slabTax], ["Less: rebate 87A", -b.rebate],
    ...(b.surcharge ? [[`Surcharge @ ${b.surchargeRate}%`, b.surcharge]] : []), ["Health & education cess", b.cess], ["Tax for the year", b.annualTax],
    ["Less: TDS already deducted", -(b.tdsDeductedSoFar + b.previousEmployerTds)], ["Remaining", b.remainingTax], [`This month (÷ ${b.monthsIncludingThis})`, b.monthlyTds]];
  const bold = new Set(["Gross total income", "Taxable income", "Tax for the year", "Remaining"]);
  return (
    <details className="ln-det"><summary>TDS working · {b.regime} regime · FY {b.fy}</summary>
      <table className="ln-tbl"><tbody>{r.map(([k, v], i) => <tr key={i} className={bold.has(k) ? "rb-total" : ""}><td>{k}</td><td className="num">{v < 0 ? `− ${money(-v)}` : money(v)}</td></tr>)}</tbody></table>
    </details>
  );
}

/* One person's salary for the month: every earning and deduction, how each was worked out, and HR's inputs. */
export default function LineModal({ runId, line, editable, onClose }) {
  const toast = useToast();
  const [f, setF] = useState(toForm(line.inputs));
  const [er, setEr] = useState({});
  const [busy, setBusy] = useState(false);
  const s = line.summary;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const save = async (e) => {
    e.preventDefault();
    const body = { ...f };
    if (!f.overrideOn) { body.tdsOverride = ""; body.tdsOverrideReason = ""; }
    if (!f.hold) body.holdReason = "";
    delete body.overrideOn;
    setBusy(true);
    const r = await api("PUT", `/api/payroll/runs/${runId}/lines/${line.id}`, body);
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors) || {}); toast(apiMsg(r)); return; }
    toast(`Saved and recalculated for ${line.name}.`);
    onClose(true);
  };

  const money2 = (k, label, hint) => (
    <Field id={`ln-${k}`} label={label} hint={hint} error={er[k]}><input className="input" id={`ln-${k}`} type="number" min={k === "adjustment" ? undefined : "0"} step="0.01" inputMode="decimal" value={f[k]} onChange={set(k)} /></Field>
  );
  const reason = (k, label) => <Field id={`ln-${k}`} label={label} error={er[k]}><input className="input" id={`ln-${k}`} maxLength={200} value={f[k]} onChange={set(k)} /></Field>;

  return (
    <Modal wide onClose={() => onClose()}>
      <div className="card-h" style={{ paddingTop: 24 }}>
        <div><h3>{line.name}</h3><div className="muted">{[line.empNo, line.title, line.dept].filter(Boolean).join(" · ")}</div></div>
        <LinePill status={line.status} />
      </div>
      <div className="card-b">
        {line.incomplete.length > 0 && <Callout><b>Incomplete:</b> {line.incomplete.join(" ")}</Callout>}
        {line.warnings.length > 0 && <Callout>{line.warnings.join(" ")}</Callout>}
        <div className="rb-stats four">
          <div className="rb-stat"><span className="lbl">Gross earnings</span><b>{money(s.gross)}</b><span className="sub">{line.days ? `${line.days.actual} of ${line.days.total} days employed` : ""}</span></div>
          <div className="rb-stat"><span className="lbl">Total deductions</span><b>{money(s.totalDeductions)}</b><span className="sub">PF, PT, TDS, loss of pay, other</span></div>
          <div className="rb-stat"><span className="lbl">TDS</span><b>{money(s.tds)}</b><span className="sub">{line.tds && line.tds.override ? `Overridden (calculated ${money(line.tds.calculated)})` : line.tds && line.tds.mode === "manual" ? "Entered on the salary" : "Calculated"}</span></div>
          <div className="rb-stat"><span className="lbl">Net payable</span><b>{money(s.net)}</b><span className="sub">{line.bank.onFile ? `To ${line.bank.bankName} ••${line.bank.last4}` : "No bank account on file"}</span></div>
        </div>
        <div className="ln-cols">
          <section><h4>Earnings</h4><Rows list={line.earnings} total={s.gross} label="Gross earnings (A)" /></section>
          <section><h4>Deductions</h4><Rows list={[...line.contributions, ...line.deductions]} total={s.totalDeductions} label="Total deductions (B)" />
            {line.employer.length > 0 && <><h4 style={{ marginTop: 14 }}>Paid by the company (not deducted)</h4><Rows list={line.employer} /></>}</section>
        </div>
        <div className="ln-net"><span>Net payable (A − B)</span><b>{money(s.net)}</b></div>
        <details className="ln-det" open><summary>How this was calculated</summary><ol className="ln-calc">{line.calc.map((c, i) => <li key={i}>{c}</li>)}</ol></details>
        {line.tds && line.tds.breakdown && <TdsWorking b={line.tds.breakdown} />}
      </div>
      {editable ? (
        <form onSubmit={save} noValidate>
          <div className="card-b form" style={{ borderTop: "1px solid var(--line)" }}>
            <h4 className="lv-h" style={{ margin: "4px 0 0" }}>This month's inputs</h4>
            <div className="muted">Saving recalculates the whole month on the server and moves the payroll back to draft, so the report has to be generated again.</div>
            <div className="sal-grid">
              {AMOUNTS.map(([k, label]) => <div key={k}>{money2(k, `${label} (₹)`)}</div>)}
              {money2("otherEarnings", "Other earnings (₹)")}{reason("otherEarningsReason", "Other earnings: what for")}
              {money2("adjustment", "Salary adjustment (₹, − to reduce)")}{reason("adjustmentReason", "Adjustment: reason")}
              {money2("additionalDeductions", "Additional deductions (₹)")}{reason("additionalDeductionsReason", "Deduction: what for")}
              <Field id="ln-lop" label="Extra loss-of-pay days" hint={`Approved unpaid leave is already counted (${line.days ? line.days.lop - (Number(line.inputs.lopDays) || 0) : 0} days). Half days allowed.`} error={er.lopDays}>
                <input className="input" id="ln-lop" type="number" min="0" step="0.5" value={f.lopDays} onChange={set("lopDays")} /></Field>
            </div>
            <label className="check" style={{ padding: 0 }}><input type="checkbox" checked={f.overrideOn} onChange={set("overrideOn")} /> Override the calculated TDS ({money(line.tds ? line.tds.calculated : 0)})</label>
            {f.overrideOn && <div className="sal-grid">{money2("tdsOverride", "TDS this month (₹)")}{reason("tdsOverrideReason", "Reason (required, recorded in the audit log)")}</div>}
            <label className="check" style={{ padding: 0 }}><input type="checkbox" checked={f.hold} onChange={set("hold")} /> Hold this salary (not paid this month)</label>
            {f.hold && reason("holdReason", "Why it is on hold")}
            <Field id="ln-note" label="Note (optional)" error={er.note}><input className="input" id="ln-note" maxLength={500} value={f.note} onChange={set("note")} /></Field>
          </div>
          <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose()}>Close</button><button type="submit" className="btn primary" disabled={busy}>{busy ? "Recalculating…" : "Save and recalculate"}</button></div>
        </form>
      ) : <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose()}>Close</button></div>}
    </Modal>
  );
}
