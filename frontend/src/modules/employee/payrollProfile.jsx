import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import { useToast } from "../../components/toast.jsx";
import { Callout, Pill } from "../../components/ui.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import { splitGross } from "../../lib/salarySplit.js";
import SalaryModal from "../payroll/SalaryModal.jsx";
import { BankModal } from "../payroll/EmployeesTab.jsx";
import { money, monthLabel } from "../payroll/util.jsx";

/* An intern is taken on as an employee: the date they join as an employee and their salary from that month. Their bank account stays as it is (they already work here),
   so it is not asked for. The lines follow HR's salary breakup format; PF, professional tax and TDS are deducted from that month on. */
function ConvertInternModal({ email, name, onClose }) {
  const toast = useToast();
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const [f, setF] = useState({ joinDate: today, annualCtc: "", gross: "" });
  const [er, setEr] = useState({}), [busy, setBusy] = useState(false);
  const g = Math.round(Number(f.gross)), lines = splitGross(g);
  const first = name.split(" ")[0];
  const submit = async (e) => {
    e.preventDefault();
    if (!f.joinDate) return setEr({ joinDate: "Enter the date they join as an employee." });
    if (!(g > 0)) return setEr({ gross: "Enter the annual CTC or the monthly gross." });
    setBusy(true);
    const r = await api("PUT" === "" ? "PUT" : "POST", "/api/payroll/convert-intern", { email, joinDate: f.joinDate, annualCtc: f.annualCtc, monthlyGross: g });
    setBusy(false);
    if (!r.ok) { toast((r.data && r.data.error) || "The change could not be saved. Please try again."); return; }
    toast(`${name} is now an employee, with a salary from ${monthLabel(r.data.salaryFrom)}.`);
    onClose(true);
  };
  return (
    <Modal onClose={() => onClose(false)}><form onSubmit={submit} noValidate>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Intern to employee: {name}</h3></div>
      <div className="card-b form">
        <Callout>{first}'s stipend keeps applying to the months before the date below. From that month, the salary below applies, with PF, professional tax and TDS. Their bank account stays as it is.</Callout>
        <Field id="cv-date" label="Date they join as an employee" hint="The salary applies from this month." error={er.joinDate}>
          <input className="input" id="cv-date" type="date" value={f.joinDate} onChange={(e) => setF({ ...f, joinDate: e.target.value })} /></Field>
        <div className="sal-grid">
          <Field id="cv-ctc" label="Annual CTC (₹)" hint="The monthly gross is filled as this divided by 12.">
            <input className="input" id="cv-ctc" type="number" min="0" step="1" value={f.annualCtc} onChange={(e) => { const c = Math.round(Number(e.target.value) / 12); setF({ ...f, annualCtc: e.target.value, gross: c > 0 ? String(c) : "" }); }} /></Field>
          <Field id="cv-gross" label="Monthly gross (₹)" error={er.gross}>
            <input className="input" id="cv-gross" type="number" min="0" step="1" value={f.gross} onChange={(e) => setF({ ...f, gross: e.target.value })} /></Field>
        </div>
        {lines.length > 0 && <div>
          <h4 className="lv-h" style={{ margin: "6px 0 8px" }}>Salary lines (a month)</h4>
          <dl className="facts" style={{ padding: 0 }}>{lines.map((l) => <div key={l.name}><dt>{l.name}</dt><dd>{money(l.amount)}</dd></div>)}</dl>
          <div className="muted">Following HR's salary breakup format for this size of salary. You can adjust any line afterwards under Salary and revisions.</div>
        </div>}
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose(false)}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : "Convert to employee"}</button></div>
    </form></Modal>
  );
}

/* One labelled fact on the card: the label, the value (or a quiet "empty" text), and an optional smaller line under it. */
function Fact({ label, value, empty, note, mono }) {
  return (
    <div className="min-w-0">
      <dt className="m-0 text-sm font-bold text-ink-dim">{label}</dt>
      <dd className={`m-0 mt-1 text-base font-medium text-ink${mono ? " font-mono" : ""}`}>{value || <span className="font-normal text-ink-dim">{empty || "—"}</span>}</dd>
      {note && <dd className="m-0 mt-0.5 text-sm text-ink-dim">{note}</dd>}
    </div>
  );
}

/* HR, on a person's profile: whether their payroll profile is ready. The person is one record shared with onboarding, so they are on the payroll list from their
   joining month; what is still needed is a salary structure and a salary bank account. Shortcuts open the usual salary and bank forms. For payroll.prepare holders only
   (the server decides); there is no bank number or tax figure on this card. */
export function PayrollProfileCard({ email, name }) {
  const { canAll, can } = useAuth();
  const { reload } = useData(), toast = useToast();
  const [p, setP] = useState(null), [dlg, setDlg] = useState(null), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await api("GET", `/api/payroll/profile/${encodeURIComponent(email)}`); setP(r.ok ? r.data : false); }, [email]);
  useEffect(() => { load(); }, [load]);
  if (p === false) return null;   // not allowed to see payroll, or nothing to show
  const close = (saved) => { setDlg(null); if (saved !== false) load(); };
  const first = name.split(" ")[0];
  // An intern becomes an employee when they are taken on: the type changes, then the full salary (with PF, professional tax and TDS) is set from that month.
  const changeType = async (type) => {
    if (!window.confirm(`Mark ${name} as an intern? An intern is paid one stipend with nothing deducted.`)) return;
    setBusy(true);
    const r = await api("PUT", "/api/employees/type", { email, type });
    setBusy(false);
    if (!r.ok) { toast((r.data && r.data.error) || "The change could not be saved. Please try again."); return; }
    toast(`${name} is now an intern.`);
    await reload(); await load(); setDlg("salary");
  };
  return (
    <div className="card">
      <div className="card-h"><h3>Employment and pay</h3>{p && <div className="row" style={{ gap: 8 }}>{p.onboarding && <Pill tone="info">Onboarding in progress</Pill>}<Pill tone={p.profile.complete ? "ok" : "warn"}>{p.profile.complete ? "Ready" : "Incomplete payroll profile"}</Pill></div>}</div>
      {!p ? <div className="card-b"><span className="skel" style={{ width: "50%" }} /></div> : <>
        {!p.profile.complete && <div className="px-6 pb-4"><Callout>Still needed before {first} is paid correctly: <b>{p.profile.missing.join(" and ")}</b>. Their payroll line stays marked incomplete until then, so no wrong salary is worked out.</Callout></div>}
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-x-8 gap-y-5 px-6 pb-5 max-xs:grid-cols-1">
          <Fact label="Paid from" value={p.paidFrom ? monthLabel(p.paidFrom) : "No joining date"} note={p.joinsLater ? "Joins later" : null} />
          <Fact label="Employment type" value={<span className="inline-flex flex-wrap items-center gap-2">{p.employmentType}{p.employmentType === "Intern" && <Pill tone="info">Stipend</Pill>}</span>}
            note={p.employmentType === "Intern" ? "Nothing is deducted" : p.convertedOn ? `Employee since ${p.convertedOn.split("-").reverse().join("/")}` : null} />
          <Fact label={p.employmentType === "Intern" ? "Stipend" : "Salary"} value={p.salary ? `${money(p.salary.monthlyGross)} a month` : null} empty="Not set"
            note={p.salary ? [`From ${monthLabel(p.salary.effectiveFrom)}`, p.salary.annualCtc ? `CTC ${money(p.salary.annualCtc)}` : null, p.salary.revisions > 1 ? `${p.salary.revisions} revisions` : null].filter(Boolean).join(" · ") : null} />
          <Fact label="Bank account" value={p.bank ? `${p.bank.bankName} ••${p.bank.last4}` : null} empty="Not added" />
          <Fact label="PAN" value={p.pan} empty="Not on file" mono />
        </dl>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-4">
          <button type="button" className="btn glass sm" onClick={() => setDlg("salary")}>{p.employmentType === "Intern" ? (p.salary ? "Stipend and revisions" : "Set up stipend") : p.salary ? "Salary and revisions" : "Set up salary"}</button>
          {canAll("payroll.bank") && <button type="button" className="btn glass sm" onClick={() => setDlg("bank")}>{p.bank ? "Bank account" : "Add bank account"}</button>}
          {can("people.edit") && <button type="button" className="btn glass sm ml-auto max-xs:ml-0" disabled={busy} onClick={() => (p.employmentType === "Intern" ? setDlg("convert") : changeType("Intern"))}>{busy ? "Saving…" : p.employmentType === "Intern" ? "Convert to employee" : "Mark as intern"}</button>}
        </div>
      </>}
      {dlg === "salary" && <SalaryModal email={email} onClose={close} />}
      {dlg === "convert" && <ConvertInternModal email={email} name={name} onClose={async (saved) => { setDlg(null); if (saved) { await reload(); await load(); } }} />}
      {dlg === "bank" && <BankModal email={email} onClose={close} />}
    </div>
  );
}
