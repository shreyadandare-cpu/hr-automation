import { useEffect, useRef, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useData } from "../../data.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout, Pill } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { fyOf, money, monthLabel, thisMonth } from "./util.jsx";

const STANDARD = ["Basic", "HRA", "Medical Allowance", "Conveyance Allowance", "Special Allowance", "Statutory Bonus"];
const blank = () => ({ effectiveFrom: thisMonth(), earnings: STANDARD.map((name) => ({ name, amount: "" })), otherDeductions: [], annualCtc: "",
  pfApplicable: true, pfEmployee: "", employerPf: "", esicEmployee: "", ptApplicable: true, professionalTax: "200", ptFebruary: "300", tdsApplicable: true, tdsMode: "auto", tdsMonthly: "", pfNumber: "", reason: "" });
/* For someone already working here: April of this financial year, or their joining month if that is later, so months already worked are covered. */
const firstMonth = (start) => { const apr = `${fyOf(thisMonth()).slice(0, 4)}-04`, joined = String(start || "").slice(0, 7); return joined > apr ? joined : apr; };
const total = (list) => list.reduce((n, x) => n + (Number(x.amount) || 0), 0);
const opt = (v) => (v === null || v === undefined ? "" : v);

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

const Toggle = ({ id, label, checked, onChange }) => <label className="check" style={{ padding: 0 }} htmlFor={id}><input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}</label>;

/* HR enters a person's salary structure from a month on. A raise is a new structure from a later month; months already approved keep theirs. */
export default function SalaryModal({ email, onClose }) {
  const { reloadLeave } = useData(), toast = useToast();
  const [info, setInfo] = useState(null);
  const [f, setF] = useState(null);
  const [er, setEr] = useState({});
  const [gross, setGross] = useState("");
  const [busy, setBusy] = useState(false);
  const [read, setRead] = useState(null);   // what was read from an uploaded payslip, shown for HR to check
  const [reading, setReading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    api("GET", `/api/payroll/structures/${encodeURIComponent(email)}`).then((r) => {
      if (!r.ok) { toast(apiMsg(r)); onClose(); return; }
      setInfo(r.data);
      const c = r.data.structures[0];
      setF(c ? { effectiveFrom: c.effectiveFrom, earnings: c.earnings.map((x) => ({ ...x })), otherDeductions: c.otherDeductions.map((x) => ({ ...x })), annualCtc: opt(c.annualCtc),
        pfApplicable: c.pfApplicable ?? c.pfEmployee > 0, pfEmployee: c.pfEmployee || "", employerPf: opt(c.employerPf), esicEmployee: opt(c.esicEmployee), ptApplicable: c.ptApplicable ?? c.professionalTax > 0,
        professionalTax: c.professionalTax || "", ptFebruary: opt(c.ptFebruary), tdsApplicable: c.tdsApplicable ?? true, tdsMode: c.tdsMode || (c.tdsMonthly != null ? "manual" : "auto"),
        tdsMonthly: opt(c.tdsMonthly), pfNumber: r.data.pfNumber || "", reason: "" }
        : { ...blank(), effectiveFrom: firstMonth(r.data.start), pfNumber: r.data.pfNumber || "" });
      setGross(r.data.monthlyGross || "");
    });
  }, [email]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!f) return <Modal onClose={onClose}><div className="card-b"><span className="skel" style={{ width: "60%" }} /></div></Modal>;
  const set = (k) => (v) => setF({ ...f, [k]: v && v.target ? v.target.value : v });
  const monthly = total(f.earnings);
  const latest = info.structures[0];
  const revision = latest && f.effectiveFrom > latest.effectiveFrom;

  // Fills the usual Wohlig split seen on the company payslips. HR checks it before saving; nothing is saved until then.
  const split = () => {
    const g = Math.round(Number(gross));
    if (!(g > 0)) return setEr({ ...er, gross: "Enter the monthly gross first." });
    const basic = Math.round(g / 2), hra = Math.round(basic / 2), med = 1250, conv = 1600;
    setEr({});
    setF({ ...f, earnings: [{ name: "Basic", amount: basic }, { name: "HRA", amount: hra }, { name: "Medical Allowance", amount: med }, { name: "Conveyance Allowance", amount: conv }, { name: "Special Allowance", amount: Math.max(0, g - basic - hra - med - conv) }] });
  };

 // Reads a payslip PDF on the server and fills the form with what it found. Nothing is saved until HR presses Save.
  const upload = async (file) => {
    if (!file) return;
    setReading(true); setRead(null);
    let r;
    try {
      const res = await fetch(`/api/payroll/payslip-read?email=${encodeURIComponent(email)}`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
      r = { ok: res.ok, data: await res.json().catch(() => null) };
    } catch { r = { ok: false, data: null }; }
    setReading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!r.ok) return toast((r.data && r.data.error) || "The payslip couldn't be read. Enter the salary by hand.");
    const d = r.data;
    const has = (v) => v !== undefined && v !== null && v !== "";
    setEr({});
    setF((cur) => ({ ...cur,
      earnings: d.earnings.map((x) => ({ name: x.name, amount: x.amount })),
      pfApplicable: d.pfEmployee > 0, pfEmployee: d.pfEmployee || "", esicEmployee: d.esicEmployee || "",
      ptApplicable: d.professionalTax > 0, professionalTax: d.professionalTax || "",
      tdsApplicable: true, tdsMode: d.tds > 0 ? "manual" : "auto", tdsMonthly: d.tds > 0 ? d.tds : "",
      otherDeductions: d.otherDeductions.map((x) => ({ name: x.name, amount: x.amount })),
      // The payslip shows the PF number masked (101xxxxxx84): never overwrite the one on file with it.
      pfNumber: has(cur.pfNumber) || !has(d.employee.pfNumber) || /x/i.test(d.employee.pfNumber) ? cur.pfNumber : d.employee.pfNumber }));
    setGross(String(d.earnings.reduce((n, x) => n + Number(x.amount), 0)));
    setRead(d);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (revision && f.reason.trim().length < 3) return setEr({ reason: "Say why the salary is revised (e.g. annual increment)." });
    const body = { ...f, tdsMonthly: f.tdsMode === "manual" ? f.tdsMonthly : "", pfEmployee: f.pfApplicable ? f.pfEmployee : "", employerPf: f.pfApplicable ? f.employerPf : "" };
    setBusy(true);
    const r = await api("PUT", `/api/payroll/structures/${encodeURIComponent(email)}`, body);
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors) || {}); toast(apiMsg(r)); return; }
    toast(`Salary structure saved for ${info.name}.`); reloadLeave(); onClose(true);
  };

  return (
    <Modal wide onClose={() => onClose()}><form onSubmit={submit} noValidate className="sal-form">
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Salary structure: {info.name}</h3>{latest && <Pill tone="info">Current from {monthLabel(latest.effectiveFrom)}</Pill>}</div>
      <div className="card-b form">
        <div className="sal-upload">
          <div><b>Start from a payslip</b><div className="muted">Upload this person's payslip (PDF) and the form below is filled from it. You can then check and edit every line before saving.</div></div>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden aria-label="Payslip PDF" onChange={(ev) => upload(ev.target.files && ev.target.files[0])} />
          <button type="button" className="btn glass" disabled={reading} onClick={() => fileRef.current && fileRef.current.click()}>{reading ? "Reading…" : read ? "Upload another payslip" : "Upload payslip"}</button>
        </div>
        {read && (
          <Callout>
            <b>Filled from the payslip for {monthLabel(read.period)}{read.employee.name ? ` (${read.employee.name})` : ""}.</b>{" "}
            {read.matches ? <>Its totals match: earnings {money(read.printed.earnings)}, net pay {money(read.printed.net)}.</> : <b>Its totals don't match the lines read. {read.warnings.join(" ")}</b>}
            {read.employee.name && info.name && read.employee.name.replace(/\(.*?\)/g, "").trim().toLowerCase() !== info.name.trim().toLowerCase() && <div><b>Check the person:</b> the payslip is for {read.employee.name}, but you are editing {info.name}.</div>}
            {read.left.map((x) => <div key={x.name} className="muted">Left out: {x.name} {money(x.amount)}. {x.why}</div>)}
            <div className="muted">Review everything below, then press Save. "Applies from" is unchanged.</div>
          </Callout>)}
        <div className="sal-grid">
          <Field id="sal-from" label="Applies from" hint="This month and later use it. For someone already working here, pick the first month payroll should use it (April covers this financial year). For a raise, pick the first month of the new salary: earlier months keep theirs." error={er.effectiveFrom}>
            <input className="input" id="sal-from" type="month" value={f.effectiveFrom} onChange={set("effectiveFrom")} /></Field>
          <Field id="sal-ctc" label="Annual CTC (₹)" hint="For records; payroll uses the monthly lines below." error={er.annualCtc}>
            <input className="input" id="sal-ctc" type="number" min="0" step="1" value={f.annualCtc} onChange={set("annualCtc")} /></Field>
        </div>
        {(revision || (latest && f.effectiveFrom === latest.effectiveFrom)) && <Field id="sal-why" label={revision ? "Reason for the revision (required)" : "Reason for the change"} error={er.reason}>
          <input className="input" id="sal-why" maxLength={300} value={f.reason} onChange={set("reason")} placeholder="Annual increment, promotion, correction…" /></Field>}

        <Field id="sal-gross" label="Quick fill from a monthly gross (optional)" hint="Basic 50% of gross, HRA 50% of Basic, Medical ₹1,250, Conveyance ₹1,600, Special Allowance the rest. Check every line before saving." error={er.gross}>
          <div className="row" style={{ gap: 8 }}><input className="input" id="sal-gross" type="number" min="1" step="1" value={gross} onChange={(e) => setGross(e.target.value)} style={{ maxWidth: 200 }} />
            <button type="button" className="btn glass" onClick={split}>Fill the lines</button></div></Field>

        <h4 className="lv-h" style={{ margin: "6px 0 8px" }}>Earnings (a month)</h4>
        {er.earnings && <div className="ferr" role="alert">{er.earnings}</div>}
        <Lines list={f.earnings} onChange={set("earnings")} kind="earnings" errors={er} addLabel="+ Add an earning (LTA, fuel, mobile…)" />

        <h4 className="lv-h" style={{ margin: "18px 0 8px" }}>Statutory deductions</h4>
        <Toggle id="sal-pfon" label="PF applies" checked={f.pfApplicable} onChange={set("pfApplicable")} />
        {f.pfApplicable && <div className="sal-grid">
          <Field id="sal-pf" label="PF employee (₹ a month)" hint="Empty: 12% of Basic, on Basic up to ₹15,000 (₹1,800 at most)." error={er.pfEmployee}><input className="input" id="sal-pf" type="number" min="0" step="1" value={f.pfEmployee} onChange={set("pfEmployee")} /></Field>
          <Field id="sal-epf" label="PF employer (₹ a month)" hint="Company cost; never deducted from pay. Empty: same as the employee's." error={er.employerPf}><input className="input" id="sal-epf" type="number" min="0" step="1" value={f.employerPf} onChange={set("employerPf")} /></Field>
          <Field id="sal-pfno" label="PF number / UAN" hint="Shown masked on the payslip." error={er.pfNumber}><input className="input" id="sal-pfno" maxLength={30} value={f.pfNumber} onChange={set("pfNumber")} /></Field>
        </div>}
        <div className="sal-grid">
          <Field id="sal-esic" label="ESIC employee (₹ a month)" hint="Only if ESIC applies to this person. Leave empty if not; it is deducted as entered, prorated in a part month." error={er.esicEmployee}>
            <input className="input" id="sal-esic" type="number" min="0" step="1" value={f.esicEmployee} onChange={set("esicEmployee")} /></Field>
        </div>
        <Toggle id="sal-pton" label="Professional tax applies" checked={f.ptApplicable} onChange={set("ptApplicable")} />
        {f.ptApplicable && <div className="sal-grid">
          <Field id="sal-pt" label="Professional tax (₹ a month)" hint="Maharashtra: ₹200." error={er.professionalTax}><input className="input" id="sal-pt" type="number" min="0" step="1" value={f.professionalTax} onChange={set("professionalTax")} /></Field>
          <Field id="sal-ptf" label="In February (₹)" hint="Maharashtra: ₹300. Empty: same as other months." error={er.ptFebruary}><input className="input" id="sal-ptf" type="number" min="0" step="1" value={f.ptFebruary} onChange={set("ptFebruary")} /></Field>
        </div>}
        <Toggle id="sal-tdson" label="TDS applies" checked={f.tdsApplicable} onChange={set("tdsApplicable")} />
        {f.tdsApplicable && <div className="sal-grid">
          <Field id="sal-tdsmode" label="How TDS is worked out" hint={f.tdsMode === "auto" ? "From the year's projected salary, the tax rules for the year, the employee's regime and declarations, and TDS already deducted." : "The amount below is deducted every month while income is above ₹12,00,000 a year."} error={er.tdsMode}>
            <select className="input" id="sal-tdsmode" value={f.tdsMode} onChange={set("tdsMode")}><option value="auto">Calculated (recommended)</option><option value="manual">Fixed monthly amount from the CA</option></select></Field>
          {f.tdsMode === "manual" && <Field id="sal-tds" label="Monthly TDS (₹)" error={er.tdsMonthly}><input className="input" id="sal-tds" type="number" min="0" step="1" value={f.tdsMonthly} onChange={set("tdsMonthly")} /></Field>}
        </div>}
        <h4 className="lv-h" style={{ margin: "12px 0 8px" }}>Other monthly deductions</h4>
        <Lines list={f.otherDeductions} onChange={set("otherDeductions")} kind="otherDeductions" errors={er} addLabel="+ Add a deduction" />

        <div className="sal-sum" style={{ marginTop: 16 }}>
          <span>Gross <b>{money(monthly)}</b> a month · <b>{money(monthly * 12)}</b> a year</span>
          {f.annualCtc && Number(f.annualCtc) < monthly * 12 && <Pill tone="warn">CTC is less than 12 × gross</Pill>}
        </div>
        {revision && <Callout>Saved as a revision from {monthLabel(f.effectiveFrom)}. {monthLabel(latest.effectiveFrom)} onwards until then keeps the current structure.</Callout>}
        {info.structures.length > 1 && <div className="muted" style={{ marginTop: 12 }}>History: {info.structures.map((s) => `from ${monthLabel(s.effectiveFrom)} ${money(total(s.earnings))}${s.reason ? ` (${s.reason})` : ""}`).join(" · ")}.</div>}
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose()}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : revision ? "Save revision" : "Save structure"}</button></div>
    </form></Modal>
  );
}
