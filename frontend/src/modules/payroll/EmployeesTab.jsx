import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiMsg } from "../../api.js";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout, Person, Pill } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import SalaryModal from "./SalaryModal.jsx";
import ImportModal from "./ImportModal.jsx";
import { fyOf, money, monthLabel, thisMonth, when } from "./util.jsx";

/* Salary bank account. The full number is only sent to the server (stored encrypted); it never comes back. */
export function BankModal({ email, onClose }) {
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [f, setF] = useState({ holder: "", bankName: "", ifsc: "", account: "", accountConfirm: "" });
  const [er, setEr] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("GET", `/api/payroll/bank/${encodeURIComponent(email)}`).then((r) => {
      if (!r.ok) { toast(apiMsg(r)); onClose(); return; }
      setInfo(r.data);
      const b = r.data.bank;
      setF({ holder: b ? b.holder : r.data.name, bankName: b ? b.bankName : "", ifsc: b ? b.ifsc : r.data.onboarding.ifsc || "", account: "", accountConfirm: "" });
    });
  }, [email]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!info) return <Modal onClose={onClose}><div className="card-b"><span className="skel" style={{ width: "60%" }} /></div></Modal>;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await api("PUT", `/api/payroll/bank/${encodeURIComponent(email)}`, f);
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors) || {}); toast(apiMsg(r)); return; }
    toast(`Bank account saved for ${info.name}.`); onClose(true);
  };
  return (
    <Modal onClose={() => onClose()}><form onSubmit={save} noValidate autoComplete="off">
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Salary bank account: {info.name}</h3>{info.bank && <Pill tone="ok">On file ••{info.bank.last4}</Pill>}</div>
      <div className="card-b form">
        {!info.encryptionReady && <Callout>The server has no <code>PAYROLL_ENCRYPTION_KEY</code>, so bank details can't be saved yet.</Callout>}
        {info.bank ? <div className="muted">Last changed by {info.bank.updatedBy} on {when(info.bank.updatedAt)}. Enter the full number again to change it.</div>
          : info.onboarding.acctMasked && <div className="muted">Onboarding has account {info.onboarding.acctMasked} (masked). Enter the full number from the cancelled cheque or bank letter.</div>}
        <Field id="bk-holder" label="Account holder name" error={er.holder}><input className="input" id="bk-holder" maxLength={80} value={f.holder} onChange={set("holder")} /></Field>
        <div className="sal-grid">
          <Field id="bk-bank" label="Bank name" error={er.bankName}><input className="input" id="bk-bank" maxLength={80} value={f.bankName} onChange={set("bankName")} /></Field>
          <Field id="bk-ifsc" label="IFSC" error={er.ifsc}><input className="input" id="bk-ifsc" maxLength={11} value={f.ifsc} onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} /></Field>
          <Field id="bk-acct" label="Account number" error={er.account}><input className="input" id="bk-acct" inputMode="numeric" maxLength={18} value={f.account} onChange={set("account")} /></Field>
          <Field id="bk-acct2" label="Account number again" error={er.accountConfirm}><input className="input" id="bk-acct2" inputMode="numeric" maxLength={18} value={f.accountConfirm} onChange={set("accountConfirm")} onPaste={(e) => e.preventDefault()} /></Field>
        </div>
        <div className="muted">Stored encrypted. Only HR's bank transfer file contains the full number; screens and the review report show the last four digits.</div>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose()}>Cancel</button><button type="submit" className="btn primary" disabled={busy || !info.encryptionReady}>{busy ? "Saving…" : "Save bank account"}</button></div>
    </form></Modal>
  );
}

const DECL = [["openingTaxable", "Taxable salary we paid this year before payroll moved here", "both"], ["openingTds", "TDS we deducted this year before payroll moved here", "both"],
  ["openingPt", "Professional tax deducted before payroll moved here", "both"], ["hraExemption", "HRA exemption 10(13A)", "old"], ["section80C", "80C (PF, PPF, ELSS, LIC…)", "old"], ["section80D", "80D health insurance", "old"], ["homeLoanInterest", "Home loan interest 24(b)", "old"],
  ["nps80CCD1B", "80CCD(1B) own NPS", "old"], ["employerNps", "80CCD(2) employer NPS", "both"], ["otherDeductions", "Other Chapter VI-A", "old"],
  ["otherIncome", "Other income declared", "both"], ["previousEmployerIncome", "Salary from a previous employer this year", "both"], ["previousEmployerTds", "TDS by the previous employer", "both"]];

/* The employee's tax regime and declarations for a financial year, used by the TDS calculation. */
function TaxModal({ email, name, onClose }) {
  const toast = useToast();
  const [fy, setFy] = useState(fyOf(thisMonth()));
  const [f, setF] = useState(null);
  const [er, setEr] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF(null);
    api("GET", `/api/payroll/declarations/${encodeURIComponent(email)}?fy=${fy}`).then((r) => {
      if (!r.ok) { toast(apiMsg(r)); onClose(); return; }
      setF({ regime: r.data.regime, declaration: Object.fromEntries(DECL.map(([k]) => [k, r.data.declaration[k] ?? ""])), updatedBy: r.data.updatedBy, updatedAt: r.data.updatedAt });
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
  return (
    <Modal wide onClose={() => onClose()}><form onSubmit={save} noValidate>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Tax regime and declarations: {name}</h3>
        <select className="input" aria-label="Financial year" style={{ width: "auto" }} value={fy} onChange={(e) => setFy(e.target.value)}>
          {[y - 1, y, y + 1].map((s) => { const v = `${s}-${String((s + 1) % 100).padStart(2, "0")}`; return <option key={v} value={v}>FY {v}</option>; })}</select></div>
      {!f ? <div className="card-b"><span className="skel" style={{ width: "60%" }} /></div> : <>
        <div className="card-b form">
          <div className="field"><span className="lab">Regime</span><div className="seg" role="radiogroup">
            {[["new", "New regime (default)"], ["old", "Old regime"]].map(([k, l]) => <label key={k}><input type="radio" name="regime" checked={f.regime === k} onChange={() => setF({ ...f, regime: k })} />{l}</label>)}</div></div>
          <div className="muted">{f.regime === "new" ? "The new regime allows the standard deduction and employer NPS only; other investments are ignored." : "Deductions are capped as the year's tax rules say (e.g. 80C ₹1,50,000)."} Amounts are for the whole financial year.</div>
          <div className="sal-grid">
            {DECL.filter(([, , r]) => r === "both" || f.regime === "old").map(([k, label]) => (
              <Field key={k} id={`dc-${k}`} label={`${label} (₹)`} error={er[k]}><input className="input" id={`dc-${k}`} type="number" min="0" step="1" value={f.declaration[k]} onChange={(e) => setF({ ...f, declaration: { ...f.declaration, [k]: e.target.value } })} /></Field>))}
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
  const [data, setData] = useState(null);
  const [q, setQ] = useState(""), [only, setOnly] = useState("");
  const [dlg, setDlg] = useState(null);
  const load = useCallback(async () => { const r = await api("GET", `/api/payroll/employees?period=${thisMonth()}`); setData(r.ok ? r.data : { error: apiMsg(r) }); }, []);
  useEffect(() => { load(); }, [load]);
  const rows = useMemo(() => {
    if (!data || !data.employees) return [];
    const s = q.trim().toLowerCase();
    return data.employees.filter((e) => (!s || `${e.name} ${e.empNo || ""} ${e.email}`.toLowerCase().includes(s))
      && (!only || (only === "salary" && !e.salary) || (only === "bank" && !e.bank)));
  }, [data, q, only]);
  if (!data) return <div className="card"><div className="card-b"><span className="skel" style={{ width: "60%" }} /></div></div>;
  if (data.error) return <div className="card"><div className="empty">{data.error}</div></div>;
  const missingSalary = data.employees.filter((e) => !e.salary).length, missingBank = data.employees.filter((e) => !e.bank).length;
  const close = (saved) => { setDlg(null); if (saved) load(); };
  return (
    <div className="card">
      <div className="card-h"><div><h3>Salary, bank and tax details</h3><div className="muted">{data.employees.length} on the payroll for {monthLabel(data.period)} · FY {data.fy}</div></div>
        <button type="button" className="btn glass" onClick={() => setDlg({ kind: "import" })}>Upload salaries (CSV)</button></div>
      {(missingSalary > 0 || missingBank > 0) && <div className="card-b" style={{ paddingTop: 0 }}><Callout>{missingSalary > 0 && <>{missingSalary} without a salary structure (their payroll line is incomplete). </>}{missingBank > 0 && <>{missingBank} without a salary bank account (they can't be in the bank file).</>}</Callout></div>}
      <div className="filters">
        <input className="input grow" type="search" placeholder="Search name or employee ID" aria-label="Search employees" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" aria-label="Show" value={only} onChange={(e) => setOnly(e.target.value)}><option value="">Everyone</option><option value="salary">Salary not set</option><option value="bank">Bank account missing</option></select>
      </div>
      <div className="tbl-wrap"><table className="pr-table"><thead><tr><th>Employee</th><th className="hide-sm">Department</th><th className="num">Monthly gross</th><th className="num hide-sm">Annual CTC</th><th>Bank account</th><th>Tax</th><th /></tr></thead><tbody>
        {rows.length ? rows.map((e) => (
          <tr key={e.email}>
            <td><Person name={e.name} sub={[e.empNo, e.title].filter(Boolean).join(" · ") || e.email} />{e.lastDay && <div className="muted">Last day {e.lastDay}</div>}</td>
            <td className="hide-sm">{e.dept}</td>
            <td className="num">{e.salary ? <>{money(e.salary.monthlyGross)}<div className="muted">from {monthLabel(e.salary.effectiveFrom)}</div></> : <Pill tone="bad">Not set</Pill>}</td>
            <td className="num hide-sm">{e.salary && e.salary.annualCtc ? money(e.salary.annualCtc) : "—"}</td>
            <td>{e.bank ? <>{e.bank.bankName} ••{e.bank.last4}<div className="muted">{e.bank.ifsc}</div></> : <Pill tone="warn">Missing</Pill>}</td>
            <td>{e.regime === "old" ? "Old regime" : "New regime"}<div className="muted">{e.salary && e.salary.tdsMode === "manual" ? "Fixed TDS" : e.declared ? "Declared" : "No declaration"}</div></td>
            <td className="num"><div className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" }}>
              <button type="button" className="btn glass sm" onClick={() => setDlg({ kind: "salary", email: e.email })}>Salary</button>
              <button type="button" className="btn glass sm" onClick={() => setDlg({ kind: "bank", email: e.email })}>Bank</button>
              <button type="button" className="btn glass sm" onClick={() => setDlg({ kind: "tax", email: e.email, name: e.name })}>Tax</button></div></td>
          </tr>)) : <tr><td colSpan={7}><div className="empty">Nobody matches.</div></td></tr>}
      </tbody></table></div>
      {dlg && dlg.kind === "salary" && <SalaryModal email={dlg.email} onClose={close} />}
      {dlg && dlg.kind === "bank" && <BankModal email={dlg.email} onClose={close} />}
      {dlg && dlg.kind === "tax" && <TaxModal email={dlg.email} name={dlg.name} onClose={close} />}
      {dlg && dlg.kind === "import" && <ImportModal onClose={close} />}
    </div>
  );
}
