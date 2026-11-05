import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiMsg } from "../../api.js";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout, Person } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import LineModal from "./LineModal.jsx";
import { LinePill, STEPS, StatusPill, fileUrl, money, monthLabel, plural, thisMonth, when } from "./util.jsx";

/* What each workflow button says and asks. note: a reason box (required when `need`). */
const ACT = {
  calculate: { label: "Mark as calculated", tone: "primary", title: "Mark the payroll as calculated?", text: "Every line is checked: nobody may be incomplete (complete them or put them on hold)." },
  generate: { label: "Generate Excel report", tone: "primary", title: "Generate the payroll report?", text: "A new version of the workbook is stored with this month. Earlier versions stay downloadable but no longer count." },
  submit: { label: "Send for review", tone: "primary", title: "Send this payroll for review?", text: "The reviewer is told and can approve, reject or ask for changes. Download the report to send it to them as well.", note: true },
  approve: { label: "Approve", tone: "primary", title: "Approve this payroll?", text: "The figures are final from now on: payslips are published to employees and HR can make the bank file. Corrections then need an adjustment in a later month.", note: true },
  request_changes: { label: "Request changes", tone: "glass", title: "Ask HR for changes?", text: "HR corrects the payroll and sends it again.", note: true, need: true },
  reject: { label: "Reject", tone: "danger", title: "Reject this payroll?", text: "It goes back to HR with your reason.", note: true, need: true },
  bank_file: { label: "Generate bank file", tone: "primary", title: "Generate the bank transfer file?", text: "A CSV for upload to corporate banking, with full account numbers. It does not move any money: an authorised person uploads it in the bank's portal, where the bank's own approval applies." },
  mark_paid: { label: "Mark as processed", tone: "primary", title: "Confirm the salary transfer?", text: "Only after the bank has processed the transfer. Reimbursements in this payroll are marked paid.", ref: true },
};

function Stepper({ status }) {
  const at = status === "rejected" || status === "changes_requested" ? 0 : STEPS.findIndex(([k]) => k === status);
  return (
    <ol className="pr-steps" aria-label="Payroll status">
      {STEPS.map(([k, label], i) => <li key={k} className={i < at ? "done" : i === at ? "on" : ""} aria-current={i === at ? "step" : undefined}><span>{i + 1}</span>{label}</li>)}
    </ol>
  );
}

function Table({ data, onOpen }) {
  const [q, setQ] = useState(""), [dept, setDept] = useState(""), [title, setTitle] = useState(""), [status, setStatus] = useState(""), [sort, setSort] = useState("name");
  const opts = (k) => [...new Set(data.lines.map((l) => l[k]).filter(Boolean))].sort();
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = data.lines.filter((l) => (!s || `${l.name} ${l.empNo || ""} ${l.email}`.toLowerCase().includes(s)) && (!dept || l.dept === dept) && (!title || l.title === title) && (!status || l.status === status));
    const by = { name: (a, b) => (a.name < b.name ? -1 : 1), "net-desc": (a, b) => b.summary.net - a.summary.net, "net-asc": (a, b) => a.summary.net - b.summary.net, "gross-desc": (a, b) => b.summary.gross - a.summary.gross };
    return list.slice().sort(by[sort]);
  }, [data.lines, q, dept, title, status, sort]);
  const t = data.totals;
  return (
    <>
      <div className="filters">
        <input className="input grow" type="search" placeholder="Search name or employee ID" aria-label="Search employees" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{opts("dept").map((d) => <option key={d}>{d}</option>)}</select>
        <select className="input" aria-label="Designation" value={title} onChange={(e) => setTitle(e.target.value)}><option value="">All designations</option>{opts("title").map((d) => <option key={d}>{d}</option>)}</select>
        <select className="input" aria-label="Payroll status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All status</option><option value="ready">Ready</option><option value="incomplete">Incomplete</option><option value="hold">On hold</option></select>
        <select className="input" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}><option value="name">Sort: name</option><option value="net-desc">Net pay, high to low</option><option value="net-asc">Net pay, low to high</option><option value="gross-desc">Gross, high to low</option></select>
      </div>
      <div className="tbl-wrap"><table className="pr-table pr-run"><thead><tr>
        <th>Employee</th><th className="num">Basic</th><th className="num">HRA</th><th className="num">Allowances</th><th className="num hide-sm">Other earnings</th><th className="num">Gross</th>
        <th className="num">PF</th><th className="num">PT</th><th className="num">TDS</th><th className="num">Other ded.</th><th className="num">Net payable</th></tr></thead><tbody>
        {rows.length ? rows.map((l) => {
          const s = l.summary;
          return (
            <tr key={l.id} className="pr-row" tabIndex={0} onClick={() => onOpen(l)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(l); }}>
              <td><Person name={l.name} sub={[l.empNo, l.title].filter(Boolean).join(" · ") || l.email} />
                {l.status !== "ready" && <div className="pr-flag"><LinePill status={l.status} /> <span className="muted">{l.status === "hold" ? l.inputs.holdReason : l.incomplete[0]}</span></div>}</td>
              <td className="num">{money(s.basic)}</td><td className="num">{money(s.hra)}</td><td className="num">{money(s.allowances)}</td><td className="num hide-sm">{money(s.otherEarnings)}</td>
              <td className="num"><b>{money(s.gross)}</b></td><td className="num">{money(s.pf)}</td><td className="num">{money(s.pt)}</td>
              <td className="num">{money(s.tds)}{l.tds && l.tds.override && <div className="muted">overridden</div>}</td>
              <td className="num">{money(s.lop + s.otherDeductions)}{s.lop > 0 && <div className="muted">incl. LOP {money(s.lop)}</div>}</td>
              <td className="num"><b className="pay-total">{l.status === "ready" ? money(s.net) : "—"}</b></td>
            </tr>);
        }) : <tr><td colSpan={11}><div className="empty">Nobody matches these filters.</div></td></tr>}
        <tr className="rb-total"><td><b>Total paid · {plural(t.people, "person", "people")}</b></td><td className="num">{money(t.basic)}</td><td className="num">{money(t.hra)}</td><td className="num">{money(t.allowances)}</td>
          <td className="num hide-sm">{money(t.otherEarnings)}</td><td className="num"><b>{money(t.gross)}</b></td><td className="num">{money(t.pf)}</td><td className="num">{money(t.pt)}</td><td className="num">{money(t.tds)}</td>
          <td className="num">{money(t.lop + t.otherDeductions)}</td><td className="num"><b>{money(t.net)}</b></td></tr>
      </tbody></table></div>
    </>
  );
}

export default function RunTab({ you }) {
  const toast = useToast();
  const [period, setPeriod] = useState(null);
  const [ov, setOv] = useState(null);
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [line, setLine] = useState(null);
  const [dlg, setDlg] = useState(null);   // { action } | { start: true }
  const [note, setNote] = useState(""), [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (p) => {
    setState("loading");
    const o = await api("GET", `/api/payroll/overview?period=${p}`);
    if (!o.ok) { setState("error"); return; }
    setOv(o.data);
    if (o.data.run) {
      const r = await api("GET", `/api/payroll/runs/${o.data.run.id}`);
      if (!r.ok) { setState("error"); return; }
      setData(r.data);
    } else setData(null);
    setState("ready");
  }, []);
  // Opens the most recent payroll still in progress; otherwise last month if it isn't started (payroll is run after the month ends).
  useEffect(() => {
    api("GET", "/api/payroll/runs").then((r) => {
      const runs = r.ok ? r.data : [], open = runs.find((x) => x.workflow && x.status !== "paid");
      const [y, m] = thisMonth().split("-").map(Number), last = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
      setPeriod(open ? open.period : runs.some((x) => x.period === last) ? thisMonth() : last);
    });
  }, []);
  useEffect(() => { if (period) load(period); }, [period, load]);

  const start = async () => {
    setBusy(true);
    const r = await api("POST", "/api/payroll/runs", { period });
    setBusy(false); setDlg(null);
    if (!r.ok) return toast(apiMsg(r));
    toast(`Payroll for ${monthLabel(period)} started and calculated.`);
    load(period);
  };
  const act = async (action) => {
    setBusy(true);
    const r = await api("POST", `/api/payroll/runs/${data.run.id}/actions/${action}`, { note, bankReference: ref });
    setBusy(false);
    if (!r.ok) {
      const p = r.data && r.data.problems;
      toast(p && p.length ? `${apiMsg(r)} ${p.slice(0, 3).map((x) => x.name).join(", ")}${p.length > 3 ? "…" : ""}` : apiMsg(r));
      return;
    }
    setDlg(null); setNote(""); setRef("");
    toast({ calculate: "Marked as calculated.", generate: "Report generated. Download it to send it for review.", submit: "Sent for review.", approve: "Payroll approved.",
      reject: "Payroll rejected and sent back to HR.", request_changes: "Sent back to HR for changes.", bank_file: "Bank file generated.", mark_paid: "Payroll marked as processed." }[action]);
    load(period);
  };
  const recalc = async () => {
    setBusy(true);
    const r = await api("POST", `/api/payroll/runs/${data.run.id}/recalculate`);
    setBusy(false);
    if (!r.ok) return toast(apiMsg(r));
    toast("Recalculated from the latest salaries, leave, claims and tax rules.");
    load(period);
  };

  const run = data && data.run, t = (data && data.totals) || (ov && ov.totals);
  const workbook = data && data.files.find((f) => f.kind === "workbook" && !f.superseded);
  const bank = data && data.files.find((f) => f.kind === "bank" && !f.superseded);
  const d = dlg && dlg.action && ACT[dlg.action];

  return (
    <>
      <div className="card">
        <div className="card-h pr-head">
          <div><h3>{monthLabel(period)}</h3><div className="muted">Financial year {ov ? ov.fy : "—"}</div></div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            {run ? <StatusPill run={run} /> : ov && <StatusPill run={null} />}
            <input className="input" type="month" value={period || ""} max={thisMonth()} aria-label="Payroll month" style={{ width: "auto" }} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
          </div>
        </div>
        {state === "error" ? <div className="empty">Unable to load payroll. <button type="button" className="btn glass sm" onClick={() => load(period)}>Try again</button></div>
          : !ov ? <div className="card-b"><span className="skel" style={{ width: "60%" }} /><span className="skel" style={{ width: "40%" }} /></div> : <>
            <div className="rb-stats six pr-stats" style={{ padding: "0 24px 18px" }}>
              <div className="rb-stat"><span className="lbl">Total employees</span><b>{ov.headcount}</b><span className="sub">On the staff list</span></div>
              <div className="rb-stat"><span className="lbl">In this payroll</span><b>{t ? t.people : "—"}</b><span className="sub">{t ? `${t.incomplete} incomplete · ${t.onHold} on hold` : ov.source === "none" ? "Not sent for review yet" : ""}</span></div>
              <div className="rb-stat"><span className="lbl">Gross salary</span><b>{money(t && t.gross)}</b><span className="sub">Before deductions</span></div>
              <div className="rb-stat"><span className="lbl">Total deductions</span><b>{money(t && t.totalDeductions)}</b><span className="sub">PF {money(t && t.pf)} · PT {money(t && t.pt)}</span></div>
              <div className="rb-stat"><span className="lbl">Total TDS</span><b>{money(t && t.tds)}</b><span className="sub">{t && t.overridden ? `${t.overridden} overridden` : "Income tax"}</span></div>
              <div className={`rb-stat ${t && t.incomplete ? "warn" : ""}`}><span className="lbl">Net payable</span><b>{money(t && t.net)}</b><span className="sub">Employer PF {money(t && t.employerPf)} on top</span></div>
            </div>
            {ov.source === "preview" && <div className="card-b" style={{ paddingTop: 0 }}><Callout>A preview: nothing is saved until you start this month's payroll.</Callout></div>}
            {run && <div className="card-b" style={{ paddingTop: 0 }}><Stepper status={run.status} /></div>}
            {run && (run.status === "rejected" || run.status === "changes_requested") && <div className="card-b" style={{ paddingTop: 0 }}><Callout><b>{run.statusLabel} by {run.reviewedBy}</b> on {when(run.reviewedAt)}: {run.reviewNote}. Correct the lines below, then calculate, generate and send it again.</Callout></div>}
            {run && run.status === "pending_review" && <div className="card-b" style={{ paddingTop: 0 }}><Callout>Sent for review by {run.submittedBy} on {when(run.submittedAt)}.{you.reviewer ? " Check the lines and the report, then approve, reject or request changes." : ""}</Callout></div>}
            {run && run.status === "paid" && <div className="card-b" style={{ paddingTop: 0 }}><Callout>Processed by {run.paidBy} on {when(run.paidAt)}. Bank reference <b>{run.bankReference}</b>. Approved by {run.reviewedBy}.</Callout></div>}
            {!ov.encryptionReady && you.hr && <div className="card-b" style={{ paddingTop: 0 }}><Callout>Bank details can't be saved or used until the server has <code>PAYROLL_ENCRYPTION_KEY</code> set.</Callout></div>}
            <div className="card-b row pr-actions">
              {!run && you.hr && <button type="button" className="btn primary" onClick={() => setDlg({ start: true })}>Start payroll for {monthLabel(period)}</button>}
              {!run && !you.hr && <span className="muted">No payroll has been sent for review for this month.</span>}
              {run && run.editable && <button type="button" className="btn glass" disabled={busy} onClick={recalc}>Recalculate</button>}
              {workbook && <a className="btn glass" href={fileUrl(run.id, workbook.id)} download>Download Excel (v{workbook.version})</a>}
              {bank && you.hr && <a className="btn glass" href={fileUrl(run.id, bank.id)} download>Download bank file</a>}
              {run && run.actions.map((a) => <button key={a} type="button" className={`btn ${ACT[a].tone}`} onClick={() => { setNote(""); setRef(""); setDlg({ action: a }); }}>{ACT[a].label}</button>)}
            </div>
          </>}
      </div>

      {data && <div className="card"><div className="card-h"><h3>Employee-wise payroll</h3><span className="muted">Select a row for the full calculation{run.editable ? " and to edit inputs" : ""}.</span></div><Table data={data} onOpen={setLine} /></div>}

      {data && data.events.length > 0 && (
        <div className="card"><details className="ln-det" style={{ padding: "16px 24px" }}><summary>Activity ({data.events.length})</summary>
          <ul className="pr-log">{data.events.map((e) => <li key={e.id}><b>{e.action}</b>{e.email ? ` · ${e.email}` : ""}<span className="muted"> {e.actor} · {when(e.ts)}</span>{e.detail && e.detail.note ? <div className="muted">“{e.detail.note}”</div> : null}</li>)}</ul>
        </details></div>)}

      {line && <LineModal runId={run.id} line={line} editable={run.editable} onClose={(saved) => { setLine(null); if (saved) load(period); }} />}
      {dlg && dlg.start && (
        <Modal onClose={() => setDlg(null)}>
          <div className="card-h" style={{ paddingTop: 24 }}><h3>Start payroll for {monthLabel(period)}?</h3></div>
          <div className="card-b"><Callout>Salaries, approved unpaid leave, approved reimbursements, adjustments and tax declarations are read now and every line is calculated. You can then edit each person's inputs. A month can only be started once.</Callout></div>
          <div className="modal-f"><button type="button" className="btn glass" onClick={() => setDlg(null)}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={start}>Start payroll</button></div>
        </Modal>)}
      {d && (
        <Modal onClose={() => setDlg(null)}>
          <div className="card-h" style={{ paddingTop: 24 }}><h3>{d.title}</h3></div>
          <div className="card-b">
            <Callout>{d.text}</Callout>
            {t && <div className="sal-sum"><span>{plural(t.people, "person", "people")}</span><span>Gross <b>{money(t.gross)}</b></span><span>Net <b>{money(t.net)}</b></span></div>}
            {d.note && <Field id="pr-note" label={d.need ? "Reason (required)" : "Note (optional)"}><textarea className="input" id="pr-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
            {d.ref && <Field id="pr-ref" label="Bank batch or transaction reference" hint="As shown by the bank once the transfer is processed."><input className="input" id="pr-ref" maxLength={100} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>}
          </div>
          <div className="modal-f"><button type="button" className="btn glass" onClick={() => setDlg(null)}>Cancel</button>
            <button type="button" className={`btn ${d.tone === "glass" ? "primary" : d.tone}`} disabled={busy || (d.need && note.trim().length < 5) || (d.ref && ref.trim().length < 3)} onClick={() => act(dlg.action)}>{d.label}</button></div>
        </Modal>)}
    </>
  );
}
