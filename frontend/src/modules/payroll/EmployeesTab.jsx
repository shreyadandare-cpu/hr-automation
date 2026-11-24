import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout, Person, Pill, CardSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import SalaryModal from "./SalaryModal.jsx";
import ImportModal from "./ImportModal.jsx";
import { BankSheetView, MasterForm } from "./Master.jsx";
import { fyOf, money, monthLabel, thisMonth, when } from "./util.jsx";

/* Salary bank account and identity details of one person: the same form as under the payroll master table. The full numbers are only sent to the server (stored encrypted). */
export function BankModal({ email, onClose }) {
  const [saved, setSaved] = useState(false);
  return (
    <Modal onClose={() => onClose(saved)}>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Bank and identity details</h3></div>
      <div className="card-b"><MasterForm email={email} onSaved={() => setSaved(true)} /></div>
      <div className="modal-f"><button type="button" className="btn primary" onClick={() => onClose(saved)}>Done</button></div>
    </Modal>
  );
}

const DECL = [["openingTaxable", "Taxable salary we paid this year before payroll moved here", "both"], ["openingTds", "TDS we deducted this year before payroll moved here", "both"],
  ["openingPt", "Professional tax deducted before payroll moved here", "both"], ["hraExemption", "HRA exemption 10(13A)", "old"], ["ltaExemption", "Leave travel exemption 10(5)", "old"], ["section80C", "80C investments, not salary PF (PPF, ELSS, LIC…). Payroll adds the employee PF itself", "old"], ["section80D", "80D health insurance, self and parents", "old"], ["homeLoanInterest", "Home loan interest 24(b)", "old"],
  ["nps80CCD1B", "80CCD(1B) own NPS", "old"], ["employerNps", "80CCD(2) employer NPS (up to 14% of Basic, 10% old regime)", "both"],
  ["rentWithoutHra", "Rent paid with no HRA in the salary (80GG is worked out)", "old"], ["savingsInterest", "Savings interest (80TTA, or 80TTB from 60)", "old"],
  ["educationLoan80E", "80E education loan interest", "old"], ["homeLoan80EEA", "80EEA first home loan interest", "old"], ["donations80G", "80G donations, the amount that qualifies", "old"],
  ["disability80DD", "80DD dependant with a disability", "old"], ["medical80DDB", "80DDB treatment of a specified illness", "old"], ["disability80U", "80U own disability", "old"],
  ["otherDeductions", "Other Chapter VI-A", "old"], ["housePropertyIncome", "Income from a let-out house, after 30% and interest (a loss is negative)", "both"],
  ["otherIncome", "Other income declared", "both"], ["previousEmployerIncome", "Salary from a previous employer this year", "both"], ["previousEmployerTds", "TDS by the previous employer", "both"]];

/* The employee's tax regime and declarations for a financial year, used by the TDS calculation. */
function TaxModal({ email, name, fixedTds, onClose }) {
  const toast = useToast();
  const [fy, setFy] = useState(fyOf(thisMonth()));
  const [f, setF] = useState(null);
  const [er, setEr] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF(null);
    api("GET", `/api/payroll/declarations/${encodeURIComponent(email)}?fy=${fy}`).then((r) => {
      if (!r.ok) { toast(apiMsg(r)); onClose(); return; }
      setF({ regime: r.data.regime, declaration: Object.fromEntries(DECL.map(([k]) => [k, r.data.declaration[k] ?? ""])), updatedBy: r.data.updatedBy, updatedAt: r.data.updatedAt, submitted: r.data.submitted || null });
    });
  }, [email, fy]);   // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await api("PUT", `/api/payroll/declarations/${encodeURIComponent(email)}`, { fy, regime: f.regime, declaration: f.declaration });
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors) || {}); toast(apiMsg(r)); return; }
    toast(`Tax details saved for ${name}. Recalculate any open payroll to apply them.`); onClose(true);
  };
  const y = Number(fy.slice(0, 4));
  // What the employee submitted on Pay > Tax declaration: copied into this form for payroll to check before saving.
  const useSubmitted = () => {
    const sub = f.submitted;
    setF({ ...f, regime: sub.regime, declaration: { ...f.declaration, ...Object.fromEntries(DECL.filter(([k]) => !k.startsWith("opening")).map(([k]) => [k, sub.fields[k] ?? ""])) } });
    toast("The employee's declaration is filled in. Please check it and save.");
  };
  const priorDeclared = f && ["previousEmployerIncome", "previousEmployerTds", "openingTaxable", "openingTds"].some((k) => Number(f.declaration[k]) > 0);
  return (
    <Modal wide onClose={() => onClose()}><form onSubmit={save} noValidate>
      {/* Inside a form, so the dialog's own title-row spacing does not reach it: room for the close button is set here. */}
      <div className="card-h flex-wrap gap-3 pt-6! pr-16! pl-7!"><h3>Tax regime and declarations: {name}</h3>
        <select className="input w-auto min-w-36" aria-label="Financial year" value={fy} onChange={(e) => setFy(e.target.value)}>
          {[y - 1, y, y + 1].map((s) => { const v = `${s}-${String((s + 1) % 100).padStart(2, "0")}`; return <option key={v} value={v}>FY {v}</option>; })}</select></div>
      {!f ? <div className="card-b"><span className="skel" style={{ width: "60%" }} /></div> : <>
        <div className="card-b form">
          {f.submitted && <Callout>{name} submitted a declaration on {when(f.submitted.submittedAt)} under the {f.submitted.regime === "old" ? "Old" : "New"} regime.
            {f.submitted.hra && f.submitted.hra.exemption > 0 && <> Their rent of ₹{Number(f.submitted.hra.rent).toLocaleString("en-IN")} gives an HRA exemption of ₹{Number(f.submitted.hra.exemption).toLocaleString("en-IN")} ({f.submitted.hra.metro ? "50" : "40"}% city).</>}
            {f.submitted.lta && f.submitted.lta.exemption > 0 && <> Their travel fares of ₹{Number(f.submitted.lta.fares).toLocaleString("en-IN")} give a leave travel exemption of ₹{Number(f.submitted.lta.exemption).toLocaleString("en-IN")}, up to the allowance for the year.</>}
            {" "}Until you save tax details here, payroll uses their declaration, with your proof decisions applied.
            {" "}<button type="button" className="btn glass sm" onClick={useSubmitted}>Fill from their declaration</button></Callout>}
          {fixedTds && priorDeclared && <Callout>This person&rsquo;s salary structure uses a fixed monthly TDS, so the previous employer&rsquo;s salary and TDS and the opening figures are not used. Please change the structure to calculated TDS to use them.</Callout>}
          <div className="field"><span className="lab">Regime</span><div className="seg" role="radiogroup">
            {[["new", "New regime (default)"], ["old", "Old regime"]].map(([k, l]) => <label key={k}><input type="radio" name="regime" checked={f.regime === k} onChange={() => setF({ ...f, regime: k })} />{l}</label>)}</div></div>
          <div className="muted">{f.regime === "new" ? "The new regime allows the standard deduction and employer NPS only; other investments are ignored." : "Deductions are capped as the year's tax rules say (e.g. 80C ₹1,50,000)."} Amounts are for the whole financial year.</div>
          <div className="sal-grid">
            {DECL.filter(([, , r]) => r === "both" || f.regime === "old").map(([k, label]) => (
              <Field key={k} id={`dc-${k}`} label={`${label} (₹)`} error={er[k]}><input className="input" id={`dc-${k}`} type="number" min={k === "housePropertyIncome" ? undefined : "0"} step="1" value={f.declaration[k]} onChange={(e) => setF({ ...f, declaration: { ...f.declaration, [k]: e.target.value } })} /></Field>))}
          </div>
          {f.updatedBy && <div className="muted">Last saved by {f.updatedBy} on {when(f.updatedAt)}.</div>}
        </div>
        <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose()}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
      </>}
    </form></Modal>
  );
}

/* Everyone on this month's payroll and whether their salary, bank account and tax details are ready. */
export default function EmployeesTab() {
  const { canAll } = useAuth();
  const bankAccess = canAll("payroll.bank");   // salary bank accounts are their own permission
  const [data, setData] = useState(null);
  const [q, setQ] = useState(""), [only, setOnly] = useState("");
  const [dlg, setDlg] = useState(null);
  const load = useCallback(async () => { const r = await api("GET", `/api/payroll/employees?period=${thisMonth()}`); setData(r.ok ? r.data : { error: apiMsg(r) }); }, []);
  useEffect(() => { load(); }, [load]);
  const rows = useMemo(() => {
    if (!data || !data.employees) return [];
    const s = q.trim().toLowerCase();
    return data.employees.filter((e) => (!s || `${e.name} ${e.empNo || ""} ${e.email}`.toLowerCase().includes(s))
      && (!only || (only === "salary" && !e.salary) || (only === "bank" && !e.bank) || (only === "incomplete" && e.missing && e.missing.length > 0)));
  }, [data, q, only]);
  if (!data) return <div className="card"><div className="card-b"><span className="skel" style={{ width: "60%" }} /></div></div>;
  if (data.error) return <div className="card"><div className="empty">{data.error}</div></div>;
  const missingSalary = data.employees.filter((e) => !e.salary).length, missingBank = data.employees.filter((e) => !e.bank).length;
  const close = (saved) => { setDlg(null); if (saved) load(); };
  return (
    <div className="card">
      <div className="card-h"><div><h3>Salary, bank and tax details</h3><div className="muted">{data.employees.filter((e) => !e.joinsLater).length} on the payroll for {monthLabel(data.period)}{data.employees.some((e) => e.joinsLater) && <> · {data.employees.filter((e) => e.joinsLater).length} joining later</>} · FY {data.fy}</div></div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {bankAccess && <button type="button" className="btn glass" onClick={() => setDlg({ kind: "bankSheet" })}>View the sheet</button>}
          <button type="button" className="btn glass" onClick={() => setDlg({ kind: "import" })}>Upload salaries (CSV)</button></div></div>
      {(missingSalary > 0 || missingBank > 0) && <div className="card-b" style={{ paddingTop: 0 }}><Callout>{missingSalary > 0 && <>{missingSalary} without a salary structure (their payroll line is incomplete). </>}{missingBank > 0 && <>{missingBank} without a salary bank account (they can't be in the bank file).</>}</Callout></div>}
      <div className="filters">
        <input className="input grow" type="search" placeholder="Search name or employee ID" aria-label="Search employees" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" aria-label="Show" value={only} onChange={(e) => setOnly(e.target.value)}><option value="">Everyone</option><option value="salary">Salary not set</option><option value="bank">Bank account missing</option><option value="incomplete">Incomplete profile</option></select>
      </div>
      <div className="tbl-wrap"><table className="pr-table"><thead><tr><th>Employee</th><th className="hide-sm">Department</th><th className="num">Monthly gross</th><th className="num hide-sm">Annual CTC</th><th>Bank account</th><th>Tax</th><th /></tr></thead><tbody>
        {rows.length ? rows.map((e) => (
          <tr key={e.email}>
            <td><Person name={e.name} sub={[e.empNo, e.title, e.employmentType === "Intern" ? "Intern" : ""].filter(Boolean).join(" · ") || e.email} />{e.lastDay && <div className="muted">Last day {e.lastDay}</div>}{e.missing && e.missing.length > 0 && <div title={`Missing: ${e.missing.join(", ")}`}><Pill tone="warn">Incomplete payroll profile</Pill><div className="muted">Missing: {e.missing.join(", ")}</div></div>}{e.onboarding && <div><Pill tone="info" title="Their onboarding is not finished yet. They are on the payroll list from the moment their work email is created.">Onboarding in progress</Pill></div>}{e.joinsLater && <div><Pill tone="info">Joins {new Date(`${e.start}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</Pill></div>}</td>
            <td className="hide-sm">{e.dept}</td>
            <td className="num">{e.salary ? <>{money(e.salary.monthlyGross)}<div className="muted">from {monthLabel(e.salary.effectiveFrom)}</div></> : <Pill tone="bad">Not set</Pill>}</td>
            <td className="num hide-sm">{e.salary && e.salary.annualCtc ? money(e.salary.annualCtc) : "—"}</td>
            <td>{e.bank ? <>{e.bank.bankName} ••{e.bank.last4}<div className="muted">{e.bank.ifsc}</div></> : <Pill tone="warn">Missing</Pill>}</td>
            <td>{e.regime === "old" ? "Old regime" : "New regime"}<div className="muted">{e.salary && e.salary.tdsMode === "manual" ? "Fixed TDS" : e.declared ? "Entered by payroll" : e.declaredBy === "employee" ? "From their declaration" : "No declaration"}</div></td>
            <td className="num"><div className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" }}>
              <button type="button" className="btn glass sm" onClick={() => setDlg({ kind: "salary", email: e.email })}>Salary</button>
              {bankAccess && <button type="button" className="btn glass sm" onClick={() => setDlg({ kind: "bank", email: e.email })}>Bank</button>}
              <button type="button" className="btn glass sm" onClick={() => setDlg({ kind: "tax", email: e.email, name: e.name, fixedTds: !!(e.salary && e.salary.tdsMode === "manual") })}>Tax</button></div></td>
          </tr>)) : <tr><td colSpan={7}><div className="empty">Nobody matches.</div></td></tr>}
      </tbody></table></div>
      {dlg && dlg.kind === "salary" && <SalaryModal email={dlg.email} onClose={close} />}
      {dlg && dlg.kind === "bank" && <BankModal email={dlg.email} onClose={close} />}
      {dlg && dlg.kind === "tax" && <TaxModal email={dlg.email} name={dlg.name} fixedTds={dlg.fixedTds} onClose={close} />}
      {dlg && dlg.kind === "import" && <ImportModal onClose={close} />}
      {dlg && dlg.kind === "bankSheet" && <BankSheetView onClose={close} />}
    </div>
  );
}

/* "Bank details" without preparing payroll: everyone's salary bank account, with no salary figures. */
export function BankPeopleTab() {
  const [data, setData] = useState(null), [err, setErr] = useState(""), [q, setQ] = useState(""), [dlg, setDlg] = useState(null);
  const load = useCallback(async () => {
    const r = await api("GET", "/api/payroll/bank-people");
    if (r.ok) { setData(r.data); setErr(""); } else setErr(apiMsg(r));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="card"><div className="card-b"><Callout>{err}</Callout></div></div>;
  if (!data) return <CardSkeleton lines={4} />;
  const s = q.trim().toLowerCase(), list = data.employees.filter((e) => !s || `${e.name} ${e.no} ${e.title} ${e.email}`.toLowerCase().includes(s));
  const missing = data.employees.filter((e) => !e.bank).length;
  return (
    <div className="card">
      <div className="card-h"><h3>Bank accounts</h3><div className="row" style={{ gap: 8, flexWrap: "wrap" }}><input className="input" style={{ maxWidth: 280 }} type="search" placeholder="Search people…" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      {missing > 0 && <div className="card-b" style={{ paddingTop: 0 }}><Callout>{missing} without a salary bank account (they can&rsquo;t be in the bank file).</Callout></div>}
      <div className="tbl-wrap"><table className="pr-table"><thead><tr><th>Employee</th><th>Bank account</th><th /></tr></thead><tbody>
        {list.map((e) => (
          <tr key={e.email}>
            <td><Person name={e.name} sub={[e.no, e.title].filter(Boolean).join(" · ")} /></td>
            <td>{e.bank ? <span>{e.bank.bankName || "Bank"} ····{e.bank.last4}</span> : <Pill tone="warn">Missing</Pill>}</td>
            <td><button type="button" className="btn glass sm" onClick={() => setDlg(e.email)}>Bank</button></td>
          </tr>))}
      </tbody></table></div>
      {dlg && <BankModal email={dlg} onClose={(saved) => { setDlg(null); if (saved) load(); }} />}
    </div>
  );
}
