import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { Pill } from "../../components/ui.jsx";
import SalaryModal from "../payroll/SalaryModal.jsx";
import { BankModal } from "../payroll/EmployeesTab.jsx";
import { money, monthLabel } from "../payroll/util.jsx";

/* HR, on a person's profile: whether their payroll profile is ready. The person is one record shared with onboarding, so they are on the payroll list from their
   joining month; what is still needed is a salary structure and a salary bank account. Shortcuts open the usual salary and bank forms. For payroll.prepare holders only
   (the server decides); there is no bank number or tax figure on this card. */
export function PayrollProfileCard({ email, name }) {
  const { canAll } = useAuth();
  const [p, setP] = useState(null), [dlg, setDlg] = useState(null);
  const load = useCallback(async () => { const r = await api("GET", `/api/payroll/profile/${encodeURIComponent(email)}`); setP(r.ok ? r.data : false); }, [email]);
  useEffect(() => { load(); }, [load]);
  if (p === false) return null;   // not allowed to see payroll, or nothing to show
  const close = (saved) => { setDlg(null); if (saved !== false) load(); };
  const first = name.split(" ")[0];
  return (
    <div className="card">
      <div className="card-h"><h3>Payroll profile</h3>{p && <Pill tone={p.profile.complete ? "ok" : "warn"}>{p.profile.complete ? "Ready" : "Incomplete payroll profile"}</Pill>}</div>
      {!p ? <div className="card-b"><span className="skel" style={{ width: "50%" }} /></div> : <>
        {!p.profile.complete && <div className="card-b" style={{ paddingTop: 0 }}><div className="muted">Still needed before {first} is paid correctly: <b>{p.profile.missing.join(" and ")}</b>. Their payroll line stays marked incomplete until then, so no wrong salary is worked out.</div></div>}
        <dl className="facts" style={{ padding: "0 24px 8px" }}>
          <div><dt>Paid from</dt><dd>{p.paidFrom ? monthLabel(p.paidFrom) : "No joining date"}{p.joinsLater ? " (joins later)" : ""}</dd></div>
          <div><dt>Employment type</dt><dd>{p.employmentType}</dd></div>
          <div><dt>Salary</dt><dd>{p.salary ? <>{money(p.salary.monthlyGross)} a month{p.salary.annualCtc ? ` · CTC ${money(p.salary.annualCtc)}` : ""}<span className="muted"> · from {monthLabel(p.salary.effectiveFrom)}{p.salary.revisions > 1 ? ` · ${p.salary.revisions} revisions` : ""}</span></> : <span className="muted">Not set</span>}</dd></div>
          <div><dt>Bank account</dt><dd>{p.bank ? `${p.bank.bankName} ••${p.bank.last4}` : <span className="muted">Not added</span>}</dd></div>
          <div><dt>PAN</dt><dd className="mono">{p.pan || <span className="muted">Not on file</span>}</dd></div>
        </dl>
        <div className="card-b" style={{ paddingTop: 4 }}><div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn glass sm" onClick={() => setDlg("salary")}>{p.salary ? "Salary and revisions" : "Set up salary"}</button>
          {canAll("payroll.bank") && <button type="button" className="btn glass sm" onClick={() => setDlg("bank")}>{p.bank ? "Bank account" : "Add bank account"}</button>}
        </div></div>
      </>}
      {dlg === "salary" && <SalaryModal email={email} onClose={close} />}
      {dlg === "bank" && <BankModal email={email} onClose={close} />}
    </div>
  );
}
