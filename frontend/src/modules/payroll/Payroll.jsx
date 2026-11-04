import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { SectionHead } from "../../components/ui.jsx";
import RunTab from "./RunTab.jsx";
import EmployeesTab from "./EmployeesTab.jsx";
import HistoryTab from "./HistoryTab.jsx";
import TaxRulesTab from "./TaxRulesTab.jsx";
import { when } from "./util.jsx";

/* The payroll audit trail: salary and bank changes, calculations, overrides, review decisions, files and downloads. */
function AuditTab() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  useEffect(() => { api("GET", "/api/payroll/audit").then((r) => setRows(r.ok ? r.data : [])); }, []);
  const s = q.trim().toLowerCase();
  const list = (rows || []).filter((e) => !s || `${e.action} ${e.actor} ${e.email || ""} ${e.period || ""}`.toLowerCase().includes(s));
  const detail = (e) => {
    const d = e.detail || {};
    if (d.reason) return d.reason;
    if (d.note) return `“${d.note}”`;
    if (d.from && d.to) return `${d.from} → ${d.to}`;
    if (d.after && d.after.last4) return `••${d.after.last4} ${d.after.ifsc}`;
    if (d.bankReference) return d.bankReference;
    if (d.version) return `version ${d.version}`;
    return "";
  };
  return (
    <div className="card">
      <div className="card-h"><div><h3>Audit log</h3><div className="muted">Append-only: entries can't be changed or deleted.</div></div></div>
      <div className="filters"><input className="input grow" type="search" placeholder="Filter by action, person or month" aria-label="Filter the audit log" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="tbl-wrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Employee</th><th className="hide-sm">Details</th></tr></thead><tbody>
        {list.length ? list.map((e) => <tr key={e.id}><td style={{ whiteSpace: "nowrap" }}>{when(e.ts)}</td><td>{e.actor}</td><td><b>{e.action}</b>{e.period && <div className="muted">{e.period}</div>}</td><td>{e.email || "—"}</td><td className="hide-sm muted">{detail(e)}</td></tr>)
          : <tr><td colSpan={5}><div className="empty">{rows ? "Nothing yet." : "Loading…"}</div></td></tr>}
      </tbody></table></div>
    </div>
  );
}

/* Payroll: HR prepares each month and sends it for review; the payroll reviewer (PAYROLL_REVIEWERS on the server) approves it. */
export default function Payroll() {
  const { isHr, payrollReviewer } = useAuth();
  const you = { hr: isHr, reviewer: payrollReviewer };
  const tabs = isHr ? [["run", "Monthly payroll"], ["employees", "Salary & bank"], ["history", "History"], ["tax", "Tax rules"], ["audit", "Audit log"]] : [["run", "Monthly payroll"], ["history", "History"]];
  const [tab, setTab] = useState("run");
  const head = <SectionHead eyebrow="Finance" title={<>Pay<span className="grad">roll.</span></>}
    sub={isHr ? "Pick a month, check each person's inputs, generate the Excel report and send it for review. After approval, make the bank file for corporate banking and mark the month processed once the bank confirms."
      : "Payrolls sent to you for review. Check the totals and each person's calculation, download the report, then approve, reject or ask for changes."} />;
  if (!isHr && !payrollReviewer) return <section className="section">{head}<div className="empty">Only HR and the payroll reviewer can open payroll.</div></section>;
  return (
    <section className="section">
      {head}
      <div className="subtabs" role="tablist" style={{ marginBottom: 18 }}>
        {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === "run" && <RunTab you={you} />}
      {tab === "employees" && <EmployeesTab />}
      {tab === "history" && <HistoryTab you={you} />}
      {tab === "tax" && <TaxRulesTab />}
      {tab === "audit" && <AuditTab />}
    </section>
  );
}
