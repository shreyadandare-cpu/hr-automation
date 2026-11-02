import { useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useData } from "../../data.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout, Pill } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";

const TDS_THRESHOLD = 1200000;   // same rule as backend/src/payroll-calc.js; the server decides, this only explains it
const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const monthLabel = (p) => new Date(p + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const thisMonth = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
const STANDARD = ["Basic", "HRA", "Medical Allowance", "Conveyance Allowance", "Special Allowance", "Statutory Bonus"];
const blank = () => ({ effectiveFrom: thisMonth(), earnings: STANDARD.map((name) => ({ name, amount: "" })), otherDeductions: [], pfEmployee: "", professionalTax: "", tdsMonthly: "", pfNumber: "" });
const total = (list) => list.reduce((n, x) => n + (Number(x.amount) || 0), 0);

function Lines({ list, onChange, kind, errors, addLabel }) {
  const set = (i, k, v) => onChange(list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="sal-lines">
      {list.map((x, i) => (
        <div key={i}>
          <div className="sal-line">
            <input className="input" aria-label={`${kind} ${i + 1} name`} maxLength={60} placeholder="Name" value={x.name} onChange={(e) => set(i, "name", e.target.value)} />
            <input className="input" aria-label={`${x.name || kind} amount`} type="number" min="0" step="1" inputMode="decimal" placeholder="₹ a month" value={x.amount} onChange={(e) => set(i, "amount", e.target.value)} />
            <button type="button" className="btn glass sm" aria-label={`Remove ${x.name || kind}`} onClick={() => onChange(list.filter((_, j) => j !== i))}>×</button>
          </div>
          {errors[`${kind}.${i}`] && <div className="ferr" role="alert">{errors[`${kind}.${i}`]}</div>}
        </div>
      ))}
      <div><button type="button" className="btn link" onClick={() => onChange([...list, { name: "", amount: "" }])}>{addLabel}</button></div>
    </div>
  );
}

/* HR enters a person's salary breakdown from a month on. Payslips are built from it when that month's payroll is processed. */
export default function SalaryModal({ email, onClose }) {
  const { reloadLeave } = useData(), toast = useToast();
  const [info, setInfo] = useState(null);
  const [f, setF] = useState(null);
  const [er, setEr] = useState({});
  const [gross, setGross] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("GET", `/api/payroll/structures/${encodeURIComponent(email)}`).then((r) => {
      if (!r.ok) { toast(apiMsg(r)); onClose(); return; }
      setInfo(r.data);
      const cur = r.data.structures[0];
      setF(cur ? { effectiveFrom: cur.effectiveFrom, earnings: cur.earnings.map((x) => ({ ...x })), otherDeductions: cur.otherDeductions.map((x) => ({ ...x })),
        pfEmployee: cur.pfEmployee || "", professionalTax: cur.professionalTax || "", tdsMonthly: cur.tdsMonthly ?? "", pfNumber: r.data.pfNumber || "" }
        : { ...blank(), pfNumber: r.data.pfNumber || "" });
      setGross(r.data.monthlyGross || "");
    });
  }, [email]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!f) return <Modal onClose={onClose}><div className="card-b"><span className="skel" style={{ width: "60%" }} /></div></Modal>;
  const set = (k) => (v) => setF({ ...f, [k]: v && v.target ? v.target.value : v });
  const monthly = total(f.earnings), annual = monthly * 12, tdsApplies = annual > TDS_THRESHOLD;
  const out = (Number(f.pfEmployee) || 0) + (Number(f.professionalTax) || 0) + (tdsApplies ? Number(f.tdsMonthly) || 0 : 0) + total(f.otherDeductions);

  // Fills the usual Wohlig split seen on the company payslips. HR checks it before saving; nothing is saved until then.
  const split = () => {
    const g = Math.round(Number(gross));
    if (!(g > 0)) return setEr({ ...er, gross: "Enter the monthly gross first." });
    const basic = Math.round(g / 2), hra = Math.round(basic / 2), med = 1250, conv = 1600;
    setEr({});
    setF({ ...f, earnings: [{ name: "Basic", amount: basic }, { name: "HRA", amount: hra }, { name: "Medical Allowance", amount: med }, { name: "Conveyance Allowance", amount: conv }, { name: "Special Allowance", amount: Math.max(0, g - basic - hra - med - conv) }] });
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await api("PUT", `/api/payroll/structures/${encodeURIComponent(email)}`, f);
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors) || {}); toast(apiMsg(r)); return; }
    toast(`Salary breakdown saved for ${info.name}.`); reloadLeave(); onClose(true);
  };

  return (
    <Modal onClose={() => onClose()}><form onSubmit={submit} noValidate className="sal-form">
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Salary breakdown: {info.name}</h3>{info.structures[0] && <Pill tone="info">From {monthLabel(info.structures[0].effectiveFrom)}</Pill>}</div>
      <div className="card-b form">
        <Field id="sal-from" label="Applies from" hint="Payslips for this month and later use this breakdown. Months already processed keep their payslips." error={er.effectiveFrom}>
          <input className="input" id="sal-from" type="month" value={f.effectiveFrom} onChange={set("effectiveFrom")} /></Field>

        <Field id="sal-gross" label="Quick fill from a monthly gross (optional)" hint="Basic 50% of gross, HRA 50% of Basic, Medical ₹1,250, Conveyance ₹1,600, Special Allowance the rest, as on the company payslips. Check every line before saving." error={er.gross}>
          <div className="row" style={{ gap: 8 }}><input className="input" id="sal-gross" type="number" min="1" step="1" value={gross} onChange={(e) => setGross(e.target.value)} style={{ maxWidth: 200 }} />
            <button type="button" className="btn glass" onClick={split}>Fill the lines</button></div></Field>

        <h4 className="lv-h" style={{ margin: "6px 0 8px" }}>Earnings (a month)</h4>
        {er.earnings && <div className="ferr" role="alert">{er.earnings}</div>}
        <Lines list={f.earnings} onChange={set("earnings")} kind="earnings" errors={er} addLabel="+ Add an earning (LTA, fuel, mobile…)" />

        <h4 className="lv-h" style={{ margin: "18px 0 8px" }}>Contributions and deductions (a month)</h4>
        <div className="sal-grid">
          <Field id="sal-pf" label="PF employee (₹)" error={er.pfEmployee}><input className="input" id="sal-pf" type="number" min="0" step="1" value={f.pfEmployee} onChange={set("pfEmployee")} /></Field>
          <Field id="sal-pt" label="Professional tax (₹)" error={er.professionalTax}><input className="input" id="sal-pt" type="number" min="0" step="1" value={f.professionalTax} onChange={set("professionalTax")} /></Field>
          <Field id="sal-pfno" label="PF number" hint="Shown masked on the payslip." error={er.pfNumber}><input className="input" id="sal-pfno" maxLength={30} value={f.pfNumber} onChange={set("pfNumber")} /></Field>
          <Field id="sal-tds" label="Monthly TDS (₹)" error={er.tdsMonthly}
            hint={tdsApplies ? "Required: annual income is above ₹12,00,000. Enter the amount worked out with the CA. Until then this person's payslips are held as incomplete." : "Not needed: annual income is ₹12,00,000 or less, so TDS is ₹0."}>
            <input className="input" id="sal-tds" type="number" min="0" step="1" value={f.tdsMonthly} disabled={!tdsApplies} onChange={set("tdsMonthly")} /></Field>
        </div>
        <Lines list={f.otherDeductions} onChange={set("otherDeductions")} kind="otherDeductions" errors={er} addLabel="+ Add another deduction" />

        <div className="sal-sum" style={{ marginTop: 16 }}>
          <span>Gross <b>{money(monthly)}</b> a month · <b>{money(annual)}</b> a year</span>
          <span>{tdsApplies ? <Pill tone="warn">TDS applies</Pill> : <Pill tone="ok">No TDS</Pill>}</span>
          <span>Net before leave and reimbursements <b>{money(monthly - out)}</b></span>
        </div>
        {tdsApplies && f.tdsMonthly === "" && <Callout>Annual income is above ₹12,00,000 and no monthly TDS is entered. Payslips for this person will show as incomplete until it is.</Callout>}
        {info.structures.length > 1 && <div className="muted" style={{ marginTop: 12 }}>Earlier breakdowns: {info.structures.slice(1).map((s) => `from ${monthLabel(s.effectiveFrom)} (${money(total(s.earnings))})`).join(", ")}.</div>}
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose()}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save breakdown"}</button></div>
    </form></Modal>
  );
}
