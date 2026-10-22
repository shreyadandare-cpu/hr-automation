import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { Callout, Person, Pill, SectionHead } from "../../components/ui.jsx";
import Modal from "../../components/Modal.jsx";
import { PayModal } from "../../components/leaveParts.jsx";
import { useToast } from "../../components/toast.jsx";
import { useLeave } from "../../lib/useLeave.js";

const money = (n) => (n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }));
const monthLabel = (p) => (p ? new Date(p + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "—");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dtShort = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getDate()} ${MON[d.getMonth()]}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function defaultPeriod(runs) {
  let p = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
  const done = new Set(runs.map((r) => r.period));
  while (done.has(p)) { const [y, m] = p.split("-").map(Number); p = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; }
  return p;
}

function PayTable({ lines, editable, onSetSalary }) {
  const lv = useLeave();
  const rows = lines.slice().sort((a, b) => (b.reimbursementTotal - a.reimbursementTotal) || (a.name < b.name ? -1 : 1));
  if (!rows.length) return <div className="empty">Nobody has a salary set or a reimbursement for this month. Set salaries under Leave → Pay &amp; balance.</div>;
  const sum = (k) => rows.reduce((n, l) => n + (l[k] || 0), 0);
  return (
    <div className="tbl-wrap"><table className="pay-table"><thead><tr><th>Employee</th><th className="num">Salary</th><th className="num">Reimbursements</th><th className="num">Loss of pay</th><th className="num">Total to pay</th></tr></thead><tbody>
      {rows.map((l) => {
        const e = lv.empBy(l.email) || { name: l.name, color: "var(--purple)" };
        return (
          <tr key={l.email}>
            <td><Person name={e.name} sub={l.empNo || l.email} color={e.color} /></td>
            <td className="num">{l.baseSalary ? money(l.baseSalary) : <><span className="muted">Not set</span>{editable && <div><button type="button" className="btn link sm nolink" onClick={() => onSetSalary(l.email)}>Set salary</button></div>}</>}</td>
            <td className="num">{l.reimbursementTotal ? <>
              <b>{money(l.reimbursementTotal)}</b>
              <div className="pay-claims">{l.claims.map((c, i) => <span key={c.id}>{i > 0 && <span>+</span>}<Link className="btn link sm nolink" to={`/app/reimbursements/${c.id}`} title={c.claimNo}>{money(c.amount)}</Link></span>)}</div>
              <div className="muted">{plural(l.claims.length, "claim")} added up</div></> : "—"}</td>
            <td className="num">{l.lopDeduction ? <>−{money(l.lopDeduction)}<div className="muted">{plural(l.lopDays, "day")}</div></> : "—"}</td>
            <td className="num"><b className="pay-total">{money(l.payable)}</b><div className="muted">{money(l.baseSalary || 0)} + {money(l.reimbursementTotal)}{l.lopDeduction ? ` − ${money(l.lopDeduction)}` : ""}</div></td>
          </tr>
        );
      })}
      <tr className="rb-total"><td><b>Total</b></td><td className="num"><b>{money(sum("baseSalary"))}</b></td><td className="num"><b>{money(sum("reimbursementTotal"))}</b></td><td className="num">{money(sum("lopDeduction"))}</td><td className="num"><b>{money(sum("payable"))}</b></td></tr>
    </tbody></table></div>
  );
}

export default function Payroll() {
  const { isHr } = useAuth();
  const toast = useToast();
  const [state, setState] = useState("idle");   // idle | loading | ready | error
  const [runs, setRuns] = useState([]);
  const [period, setPeriod] = useState("");
  const [preview, setPreview] = useState(null);
  const [run, setRun] = useState(null);
  const [dlg, setDlg] = useState(null);   // { kind: "process" } | { kind: "pay", run } | { kind: "salary", email }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (per) => {
    setState("loading");
    const rr = await api("GET", "/api/payroll/runs");
    if (!rr.ok) { setState("error"); return; }
    setRuns(rr.data);
    const p = per || defaultPeriod(rr.data);
    setPeriod(p);
    const pv = await api("GET", "/api/payroll/preview?period=" + p);
    setPreview(pv.ok ? pv.data : null);
    setState("ready");
  }, []);

  useEffect(() => { if (isHr) load(""); }, [isHr, load]);

  if (!isHr) return <section className="section"><SectionHead eyebrow="Finance" title={<>Pay<span className="grad">roll.</span></>} /><div className="empty">Only HR can manage payroll.</div></section>;

  const viewRun = async (id) => {
    const r = await api("GET", "/api/payroll/runs/" + id);
    if (!r.ok) return toast(apiMsg(r));
    setRun(r.data);
    setTimeout(() => { const el = document.getElementById("pr-run"); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); });
  };

  const process = async () => {
    setBusy(true);
    const r = await api("POST", "/api/payroll/runs", { period });
    setBusy(false); setDlg(null);
    if (!r.ok) return toast(apiMsg(r));
    toast(`Payroll processed. ${plural(r.data.included, "reimbursement")} included.`);
    load(period);
  };
  const pay = async (id) => {
    setBusy(true);
    const r = await api("POST", `/api/payroll/runs/${id}/pay`);
    setBusy(false); setDlg(null);
    if (!r.ok) return toast(apiMsg(r));
    toast(`Marked as paid. ${plural(r.data.paid, "reimbursement")} paid.`);
    load(period);
  };

  if (state === "error") return (
    <section className="section"><SectionHead eyebrow="Finance" title={<>Pay<span className="grad">roll.</span></>} />
      <div className="card"><div className="empty">Unable to load payroll. Please try again. <button type="button" className="btn glass sm" onClick={() => load(period)}>Try again</button></div></div></section>
  );

  const t = preview && preview.totals, done = preview && preview.existing;
  const lines = preview ? preview.lines.filter((l) => l.baseSalary || l.reimbursementTotal) : [];

  return (
    <section className="section">
      <SectionHead eyebrow="Finance" title={<>Pay<span className="grad">roll.</span></>}
        sub="Approved reimbursements are added to the month's payroll on top of salary. Processing the month includes them; marking it paid marks them paid."
        actions={<input className="input" type="month" value={period} aria-label="Payroll month" style={{ width: "auto" }} onChange={(e) => { if (e.target.value) load(e.target.value); }} />} />
      <div className="card">
        <div className="card-h"><h3>{monthLabel(period)}</h3>{done ? <Pill tone={done.status === "paid" ? "ok" : "info"}>{done.status === "paid" ? "Paid" : "Processed"}</Pill> : <Pill>Not processed</Pill>}</div>
        {state !== "ready" && !preview ? <div className="card-b"><span className="skel" style={{ width: "60%" }} /><span className="skel" style={{ width: "40%" }} /></div> : t && <>
          <div className="rb-stats four" style={{ padding: "0 24px 18px" }}>
            <div className="rb-stat"><span className="lbl">People</span><b>{t.people}</b><span className="sub">{t.withSalary} with salary set</span></div>
            <div className="rb-stat"><span className="lbl">Reimbursements</span><b>{money(t.reimbursementTotal)}</b><span className="sub">{t.claims} approved claim{t.claims === 1 ? "" : "s"}</span></div>
            <div className="rb-stat"><span className="lbl">Loss-of-pay deductions</span><b>{money(t.lopTotal)}</b><span className="sub">From approved leave</span></div>
            <div className="rb-stat"><span className="lbl">Total payable</span><b>{money(t.payableTotal)}</b><span className="sub">Salary − deductions + reimbursements</span></div>
          </div>
          <PayTable lines={lines} editable onSetSalary={(email) => setDlg({ kind: "salary", email })} />
          <div className="card-b row" style={{ justifyContent: "flex-end", paddingTop: 18 }}>
            {done ? <span className="muted">Processed. See the run below.</span> : <button type="button" className="btn primary" onClick={() => setDlg({ kind: "process" })}>Process payroll for {monthLabel(period)}</button>}
          </div>
        </>}
      </div>
      <div className="card"><div className="card-h"><h3>Payroll runs</h3></div><div className="tbl-wrap"><table><thead><tr><th>Month</th><th>Status</th><th className="num">People</th><th className="num">Reimbursements</th><th className="num">Payable</th><th className="hide-sm">Processed</th><th></th></tr></thead><tbody>
        {runs.length ? runs.map((r) => (
          <tr key={r.id}><td><b>{monthLabel(r.period)}</b></td><td>{r.status === "paid" ? <Pill tone="ok">Paid</Pill> : <Pill tone="info">Processed</Pill>}</td>
            <td className="num">{r.people}</td><td className="num">{money(r.reimbursementTotal)}</td><td className="num">{money(r.payableTotal)}</td>
            <td className="hide-sm">{dtShort(r.processedAt)}{r.paidAt && <div className="muted">Paid {dtShort(r.paidAt)}</div>}</td>
            <td className="num"><div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn glass sm" onClick={() => viewRun(r.id)}>View</button>
              {r.status !== "paid" && <button type="button" className="btn primary sm" onClick={() => setDlg({ kind: "pay", run: r })}>Mark as paid</button>}
            </div></td></tr>
        )) : <tr><td colSpan={7}><div className="empty">No payroll processed yet.</div></td></tr>}
      </tbody></table></div></div>
      {run && (
        <div className="card" id="pr-run"><div className="card-h"><h3>{monthLabel(run.run.period)} payroll · per person</h3>
          <div className="row" style={{ gap: 8 }}>{run.run.status === "paid" ? <Pill tone="ok">Paid {dtShort(run.run.paidAt)}</Pill> : <Pill tone="info">Processed</Pill>}<button type="button" className="btn glass sm" onClick={() => setRun(null)}>Close</button></div></div>
          <PayTable lines={run.items.filter((l) => l.baseSalary || l.reimbursementTotal)} editable={false} /></div>
      )}
      {dlg && dlg.kind === "process" && t && (
        <Modal onClose={() => setDlg(null)}>
          <div className="card-h" style={{ paddingTop: 24 }}><h3>Process payroll for {monthLabel(period)}?</h3></div>
          <div className="card-b">
            <Callout>{t.people} people · {plural(t.claims, "reimbursement")} ({money(t.reimbursementTotal)}) · total payable {money(t.payableTotal)}. The reimbursements move to <b>Included in payroll</b> and employees are told.</Callout>
            <div className="muted">A month can only be processed once.</div>
          </div>
          <div className="modal-f"><button type="button" className="btn glass" onClick={() => setDlg(null)}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={process}>Process payroll</button></div>
        </Modal>
      )}
      {dlg && dlg.kind === "pay" && (
        <Modal onClose={() => setDlg(null)}>
          <div className="card-h" style={{ paddingTop: 24 }}><h3>Mark {monthLabel(dlg.run.period)} payroll as paid?</h3></div>
          <div className="card-b"><Callout>Every reimbursement in this run becomes <b>Paid</b> with today's date, and employees are told. This can't be undone.</Callout></div>
          <div className="modal-f"><button type="button" className="btn glass" onClick={() => setDlg(null)}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={() => pay(dlg.run.id)}>Mark as paid</button></div>
        </Modal>
      )}
      {dlg && dlg.kind === "salary" && <PayModal email={dlg.email} onClose={() => { setDlg(null); load(period); }} />}
    </section>
  );
}
