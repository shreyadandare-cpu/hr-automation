import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import Modal, { Field } from "../../components/Modal.jsx";
import { Icon, shortDate } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { PayModal } from "../../components/leaveParts.jsx";
import { useData } from "../../data.jsx";
import { R } from "../../lib/leave.js";
import { LSTAT, LTYPE, dd, inr, lc, rangeText, useLeave } from "../../lib/useLeave.js";
import { patchLocal } from "./local.js";

export const fdate = (s) => (s ? shortDate(s) : "—");
const InfoIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fts = (d) => `${d.getDate()} ${MON[d.getMonth()]}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/* ---------- laptop record (memory only: no API stores it) ---------- */
export function LaptopCard({ e, isHr }) {
  const toast = useToast();
  const l = e.laptop || { received: false, serial: "", date: "" };
  const [f, setF] = useState({ got: l.received, serial: l.serial, date: l.date });
  const off = e.status === "offboarded", dis = off || !isHr;
  const submit = (ev) => {
    ev.preventDefault();
    if (!isHr) { toast("Only HR can do this."); return; }
    const serial = f.serial.trim();
    if (f.got && !serial) { toast("Enter the laptop serial number."); document.getElementById("lp-serial").focus(); return; }
    if (f.got && !f.date) { toast("Pick the date the laptop was received."); document.getElementById("lp-date").focus(); return; }
    patchLocal(e.baseEmail, { laptop: { received: f.got, serial: f.got ? serial : "", date: f.got ? f.date : "" } });
    toast("Laptop details saved.");
  };
  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="card-h"><h3>Laptop</h3><span className={`pill ${l.received ? "p-ok" : "p-mute"}`}>{l.received ? "Received" : "Not received"}</span></div>
      <div className="card-b form">
        <label className="check" style={{ gridColumn: "1/-1", border: 0, padding: 0 }}><input type="checkbox" id="lp-got" checked={f.got} disabled={dis} onChange={(ev) => setF({ ...f, got: ev.target.checked })} /><div className="grow"><div className="lbl">Laptop received</div></div></label>
        <div className="field"><label htmlFor="lp-serial">Serial number</label><input className="input mono" id="lp-serial" value={f.serial} placeholder="e.g. C02XK1ABJG5H" disabled={dis} onChange={(ev) => setF({ ...f, serial: ev.target.value })} /></div>
        <div className="field"><label htmlFor="lp-date">Date received</label><input className="input" id="lp-date" type="date" value={f.date} disabled={dis} onChange={(ev) => setF({ ...f, date: ev.target.value })} /></div>
        <div className="row" style={{ gridColumn: "1/-1" }}><button type="submit" className="btn primary sm" disabled={dis}>Save laptop details</button><span className="muted">Editable by HR.</span></div>
      </div>
    </form>
  );
}

/* ---------- personal / ID record and uploaded documents ---------- */
const DOCS = [
  { k: "aadhaar", name: "Aadhaar card" }, { k: "pan", name: "PAN card" }, { k: "dl", name: "Driving licence" }, { k: "passport", name: "Passport" },
  { k: "voter", name: "Voter ID" }, { k: "exp", name: "Previous experience letters" }, { k: "edu", name: "Education certificates" },
  { k: "bank", name: "Bank passbook or cancelled cheque" },
];
export function RecordCard({ e, record, docs, isMe, isHr }) {
  if (!isHr && !isMe) return null;   // personal details and documents belong to HR and the person themselves
  const mine = docs.filter((d) => lc(d.email) === lc(e.baseEmail)), by = {};
  for (const d of mine) (by[d.key] = by[d.key] || []).push(d);
  const n = mine.length, r = record || {};
  if (!n && !r.phone && !r.ids) return null;
  const i = r.ids || {};
  const kv = (pairs) => <dl className="rv">{pairs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || "—"}</dd></div>)}</dl>;
  return (
    <div className="card"><div className="card-h"><h3>Onboarding record</h3><span className="muted">ID numbers are masked</span></div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {kv([["Personal email", r.personalEmail], ["Phone", r.phone], ["Address", r.address], ["Date of birth", i.dob ? fdate(i.dob) : ""], ["Aadhaar", i.aadhaar], ["PAN", i.pan], ["Bank account", i.acct], ["IFSC", i.ifsc]])}
        <div><div className="muted" style={{ marginBottom: 6 }}>Documents uploaded by the employee</div>
          {n ? DOCS.filter((d) => (by[d.k] || []).length).map((d) => (
            <div key={d.k} style={{ fontSize: 14 }}><b>{d.name}</b> · {by[d.k].map((f, x) => <span key={f.id}>{x ? ", " : ""}{f.id ? <a href={`/api/documents/${f.id}/file`} target="_blank" rel="noopener">{f.name}</a> : f.name}</span>)}</div>
          )) : <div className="muted">None uploaded yet.</div>}
        </div>
      </div></div>
  );
}

/* ---------- leave ---------- */
export function LeaveCard({ e, isHr }) {
  const lv = useLeave();
  const { leave } = useData();
  const [pay, setPay] = useState(false);
  if (!R || !leave) return null;
  const year = Number(lv.today.slice(0, 4)), b = lv.bal(e, year), p = lv.payOf(e.baseEmail);
  const mine = [...lv.reqsOf(e.baseEmail)].sort((a, c) => (a.from < c.from ? 1 : -1)).slice(0, 5);
  return (
    <div className="card"><div className="card-h"><h3>Leave {year}</h3>{isHr && <button className="btn glass sm" onClick={() => setPay(true)}>Pay &amp; balance</button>}</div>
      <dl className="facts" style={{ borderTop: 0, paddingTop: 0 }}>
        <div><dt>Casual left</dt><dd>{b.casual.left} <span className="muted">({b.casual.carried} carried + {b.casual.quota} − {b.casual.used})</span></dd></div>
        <div><dt>Sick left</dt><dd>{b.sick.left} <span className="muted">of {b.sick.quota}</span></dd></div>
        <div><dt>Comp off left</dt><dd>{b.compoff.left}</dd></div>
        <div><dt>Loss of pay</dt><dd>{dd(b.lopDays)}</dd></div>
        <div><dt>Monthly gross</dt><dd>{p.monthlyGross ? inr(p.monthlyGross) : "Not set"}</dd></div>
      </dl>
      {mine.map((r) => (
        <div className="li" key={r.id}><div className="grow"><b style={{ fontWeight: 600 }}>{LTYPE[r.type]}</b> · {rangeText(r, fdate)}
          <div className="meta">{r.status === "approved" ? <>{dd(r.paidDays)} paid{r.lopDays ? `, ${dd(r.lopDays)} loss of pay` : ""}</> : dd(r.days)}</div></div>
          <span className={`pill p-${LSTAT[r.status][1]}`}>{LSTAT[r.status][0]}</span></div>
      ))}
      {pay && <PayModal email={e.baseEmail} onClose={() => setPay(false)} />}
    </div>
  );
}

/* ---------- offboarding status ---------- */
function SettlementBlock({ e, s, onPay, isHr }) {
  if (!s) return null;
  const mon = fdate(s.month + "-01").replace(/^1 /, "");
  const amt = (v) => (s.monthlyGross ? inr(v) : "—");
  return (
    <div className="field"><span className="lab">Final settlement: leave</span><div className="settle">
      <div><span>Unused casual leave paid out<small>{s.carried} carried + {s.quota} for months worked − {s.used} used</small></span><b>{dd(s.casualLeft)} · {amt(s.encashment)}</b></div>
      <div><span>Loss of pay in {mon}</span><b className="neg">{dd(s.lopDays)} · {s.monthlyGross ? "−" + inr(s.deduction) : "—"}</b></div>
      <div className="tot"><span>Leave adjustment</span><b>{s.monthlyGross ? inr(s.net) : isHr ? <button type="button" className="btn link" onClick={onPay}>Add monthly salary to see amounts</button> : "—"}</b></div>
    </div></div>
  );
}
export function OffCard({ e, rec, scheduled, isHr, onChanged }) {
  const toast = useToast();
  const lv = useLeave();
  const { people, reloadLeave } = useData();
  const [pay, setPay] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!scheduled && e.status !== "offboarding" && e.status !== "offboarded") return null;
  const toName = rec && rec.transferTo ? ((people || []).find((x) => lc(x.email) === lc(rec.transferTo)) || { name: rec.transferTo }).name : "";
  let s = null;
  if (rec && rec.lastDay === e.lastDay && rec.settlement) s = rec.settlement;
  else if (R && R.validDate(e.lastDay || "")) {
    const p = lv.payOf(e.baseEmail);
    s = R.exitSettlement({ emp: { start: e.start, casualOpening: p.casualOpening }, lastDay: e.lastDay, requests: lv.reqsOf(e.baseEmail), compOffs: lv.compsOf(e.baseEmail), monthlyGross: p.monthlyGross, holidays: lv.holDays });
  }
  const call = async (path, okMsg) => {
    setBusy(true);
    const r = await api("POST", `/api/offboarding/${rec.id}/${path}`);
    setBusy(false);
    if (!r.ok) { toast((r.data && (r.data.error || Object.values(r.data.errors || {})[0])) || "Could not save. Try again."); return; }
    toast(okMsg); reloadLeave(); onChanged();
  };
  return (
    <div className="card"><div className="card-h"><h3>Offboarding</h3>{scheduled ? <span className="pill p-warn">Scheduled</span> : e.status === "offboarded" ? <span className="pill p-mute">Completed</span> : <span className="pill p-warn">In progress</span>}</div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {scheduled ? <>
          <div className="callout"><InfoIcon /><div>Access is removed automatically on <b>{fdate(e.lastDay)} at 6:00 pm</b>{toName ? <>. Drive files and email go to <b>{toName}</b></> : ""}.</div></div>
          {isHr && <div className="row"><button className="btn danger sm" disabled={busy} onClick={() => call("run", `Access removed for ${e.name}.`)}>Remove access now</button><button className="btn glass sm" disabled={busy} onClick={() => call("cancel", `Offboarding for ${e.name} called off.`)}>Call off offboarding</button></div>}
        </> : toName ? <div className="muted">Drive files and email moved to <b style={{ color: "var(--ink)" }}>{toName}</b>.</div> : null}
        <SettlementBlock e={e} s={s} isHr={isHr} onPay={() => setPay(true)} />
      </div>
      {pay && <PayModal email={e.baseEmail} onClose={() => setPay(false)} />}
    </div>
  );
}

/* ---------- laptop returned (offboarding checklist) ---------- */
const LP_COND = ["Good", "Minor wear", "Damaged"];
export function LaptopReturnModal({ e, rec, today, serial0, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ serial: serial0 || "", date: today, condition: "Good", note: "" });
  const [er, setEr] = useState({});
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value });
  const submit = async (ev) => {
    ev.preventDefault();
    const r = await api("POST", `/api/offboarding/${rec.id}/steps/laptop`, { done: true, laptop: { ...f, status: "returned" } });
    if (!r.ok) {
      const errs = (r.data && r.data.errors) || {};
      setEr(errs);
      if (!Object.keys(errs).length) toast(apiMsg(r));
      return;
    }
    onDone(r.data); onClose();
    toast(r.data.status === "completed" ? `${e.name} is fully offboarded` : "Laptop marked as returned.");
  };
  return (
    <Modal onClose={onClose}><form onSubmit={submit} noValidate>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Laptop returned</h3><span className="muted">{e.name}</span></div>
      <div className="card-b"><div className="form">
        <Field id="lr-serial" label="Serial number" error={er.laptopSerial}><input className="input mono" id="lr-serial" maxLength={60} value={f.serial} onChange={set("serial")} placeholder="e.g. C02XK1ABJG5H" /></Field>
        <Field id="lr-date" label="Return date" error={er.laptopDate}><input className="input" type="date" id="lr-date" max={today} value={f.date} onChange={set("date")} /></Field>
        <Field id="lr-condition" label="Condition" error={er.laptopCondition}><select className="input" id="lr-condition" value={f.condition} onChange={set("condition")}>{LP_COND.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field id="lr-note" label="Note (optional)" error={er.laptopNote}><input className="input" id="lr-note" maxLength={300} value={f.note} onChange={set("note")} placeholder="Charger returned, scratch on the lid…" /></Field>
      </div></div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button><button type="submit" className="btn primary">Mark as returned</button></div>
    </form></Modal>
  );
}

/* ---------- the person's reimbursements (HR) ---------- */
const money = (n) => (n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }));
const monthLabel = (p) => (p ? new Date(p + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "—");
const RB_STATUS = {
  draft: ["Draft", "p-mute"], submitted: ["Pending review", "p-warn"], under_review: ["Under review", "p-info"], changes_requested: ["Changes requested", "p-warn"],
  resubmitted: ["Resubmitted", "p-info"], approved: ["Approved", "p-ok"], rejected: ["Rejected", "p-bad"], payroll_pending: ["Payroll pending", "p-info"],
  in_payroll: ["In payroll", "p-info"], paid: ["Paid", "p-ok"],
};
const OPEN = ["submitted", "under_review", "resubmitted"];
const rbReq = (c) => (c.requestedAmount != null ? c.requestedAmount : c.amount);
const rbElig = (c) => (c.eligibleAmount != null ? c.eligibleAmount : rbReq(c));
const Warn = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></svg>;
function Flags({ c }) {
  const v = c.validation || {};
  return <>
    {c.duplicates && c.duplicates.length > 0 && <span className="flag" title="Possible duplicate"><Warn />Duplicate?</span>}
    {v.match && v.match.status === "mismatch" && <span className="flag" title="Claimed amount differs from the invoice"><Warn />Mismatch</span>}
    {v.policy && v.policy.over && <span className="flag" title="Above the category limit"><Warn />Over limit</span>}
    {c.partial ? <span className="flag" title="Approved less than requested">Partly approved</span>
      : c.eligibleAmount != null && c.approvedAmount == null && c.eligibleAmount < rbReq(c) ? <span className="flag" title="Travel policy or budget limits what can be reimbursed"><Warn />Policy cap</span> : null}
    {c.budget && <span className="flag ok" title={`Final bill for ${c.budget.requestNo}`}>Budget</span>}
  </>;
}

function QuickApprove({ id, cats, onClose, onDone }) {
  const toast = useToast(), nav = useNavigate();
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api("GET", `/api/reimbursements/${id}`).then((r) => { if (!r.ok) { toast(apiMsg(r)); onClose(); } else setC(r.data.claim); }); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return null;
  const v = c.validation || {}, items = c.items || [];
  const risky = (c.duplicates || []).length || (v.match && v.match.status === "mismatch") || (v.policy && v.policy.over);
  const approve = async () => {
    setBusy(true);
    if (["submitted", "resubmitted"].includes(c.status)) await api("POST", `/api/reimbursements/${c.id}/open`);   // the review is recorded first
    const r = await api("POST", `/api/reimbursements/${c.id}/approve`, { note: "Approved from the employee page" });
    onClose();
    if (!r.ok) { toast(apiMsg(r)); return; }
    toast(`Approved. ${money(r.data.approvedAmount)} goes with the ${monthLabel(r.data.payrollPeriod)} payroll.`);
    onDone();
  };
  return (
    <Modal onClose={onClose}>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Approve {c.claimNo}?</h3></div>
      <div className="card-b">
        <div className="callout"><InfoIcon /><div><b>{money(rbElig(c))}</b>{rbElig(c) < rbReq(c) ? ` of ${money(rbReq(c))} requested (the eligible amount)` : ""} · {items.length} expense{items.length === 1 ? "" : "s"}
          <div className="muted">It is added to {c.employee.name}'s next payroll, on top of salary. To approve a different amount, open the claim.</div></div></div>
        {items.length > 0 && <div className="tbl-wrap"><table className="rb-lines"><thead><tr><th>#</th><th>Category</th><th>What for</th><th className="num">Amount</th><th>Receipt</th></tr></thead><tbody>
          {items.map((it, i) => {
            const m = v.items && v.items[it.id] && v.items[it.id].match, x = c.eligibility && c.eligibility.items && c.eligibility.items[it.id];
            return <tr key={it.id}><td className="muted">{i + 1}</td>
              <td>{cats[it.category] || it.category}{it.travelClass && <div className="muted" style={{ fontSize: 12 }}>{it.travelClass} class</div>}</td>
              <td className="desc">{it.description || ""}</td>
              <td className="num"><b>{money(it.amount)}</b>{x && x.nonEligible > 0 && <div className="muted" style={{ fontSize: 12 }}>eligible {money(x.eligible)}</div>}</td>
              <td>{it.document ? <><a className="btn link sm nolink" href={`/api/reimbursements/${c.id}/documents/${it.document.id}`} target="_blank" rel="noopener"><Icon name="filedoc" />View</a> {m && m.status === "match" ? <span className="flag ok"><Icon name="check" />Matches</span> : m && m.status === "mismatch" ? <span className="flag" title="Amount on the invoice"><Warn />Invoice {money(m.invoiceTotal)}</span> : null}</>
                : it.noReceipt ? <span className="pill p-mute">No receipt</span> : <span className="pill p-warn">Missing</span>}</td></tr>;
          })}
          {items.length > 1 && <tr className="rb-total"><td></td><td colSpan="2"><b>Total</b></td><td className="num"><b>{money(items.reduce((n, it) => n + (it.amount || 0), 0))}</b></td><td></td></tr>}
        </tbody></table></div>}
        {v.noReceipt && v.noReceipt.count ? <div className="muted">{v.noReceipt.count} small expense{v.noReceipt.count === 1 ? "" : "s"} without a receipt ({money(v.noReceipt.total)}), declared by the employee.</div> : null}
        {v.match && v.match.status === "match" && <div className="muted"><Icon name="check" /> Amount matches the invoice.</div>}
        {risky ? <div className="callout bad"><Warn /><div>This claim has open flags (duplicate, amount mismatch or over the limit). Open it and check the invoice first.</div></div> : null}
      </div>
      <div className="modal-f"><button className="btn glass" onClick={onClose}>Cancel</button><button className="btn glass" onClick={() => { onClose(); nav(`/app/reimbursements/${c.id}`); }}>Open claim</button><button className="btn primary" disabled={busy} onClick={approve}>Approve</button></div>
    </Modal>
  );
}

export function ReimbCard({ e }) {
  const [st, setSt] = useState({ state: "loading" });
  const [quick, setQuick] = useState(null);
  const [tick, setTick] = useState(0);
  const period = useMemo(() => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7), []);
  const email = lc(e.baseEmail);
  useEffect(() => {
    let live = true;
    setSt((s) => (s.state === "ready" ? s : { state: "loading" }));
    Promise.all([api("GET", "/api/reimbursements/categories"), api("GET", "/api/reimbursements?email=" + encodeURIComponent(email)),
      api("GET", `/api/reimbursements/monthly?period=${period}&email=${encodeURIComponent(email)}`)]).then(([cat, list, mon]) => {
      if (!live) return;
      const cats = {}; if (cat.ok) for (const c of cat.data.categories) cats[c.key] = c.name;
      setSt(list.ok ? { state: "ready", claims: list.data.claims, month: mon.ok ? mon.data : null, cats } : { state: "error" });
    });
    return () => { live = false; };
  }, [email, period, tick]);
  const head = <div className="card-h"><h3>Reimbursements</h3><Link className="btn link sm" to={`/app/reimbursements?q=${encodeURIComponent(e.name)}`}>All claims</Link></div>;
  if (st.state === "loading") return <div className="card">{head}<div className="card-b"><span className="skel" style={{ width: "70%" }} /><span className="skel" style={{ width: "50%" }} /></div></div>;
  if (st.state === "error") return <div className="card">{head}<div className="empty">Unable to load reimbursements. Please try again.</div></div>;
  const p = st.month && st.month.people[0], waiting = st.claims.filter((c) => OPEN.includes(c.status));
  const catNames = (c) => [...new Set((c.expenses && c.expenses.length ? c.expenses : [{ category: c.category }]).map((x) => st.cats[x.category] || x.category))].join(", ");
  const shown = st.claims.filter((c) => c.status !== "draft");
  return (
    <div className="card">{head}
      <div className="rb-stats four" style={{ padding: "0 24px 16px" }}>
        <div className="rb-stat"><span className="lbl">Approved for {monthLabel(period)}</span><b>{money(p ? p.approvedTotal : 0)}</b><span className="sub">{p ? p.approvedCount : 0} claim{p && p.approvedCount === 1 ? "" : "s"}, added to salary</span></div>
        <div className={`rb-stat ${waiting.length ? "warn" : ""}`}><span className="lbl">Waiting for review</span><b>{waiting.length}</b><span className="sub">{money(waiting.reduce((n, c) => n + c.amount, 0))}</span></div>
        <div className="rb-stat"><span className="lbl">Paid to date</span><b>{money(st.claims.filter((c) => c.status === "paid").reduce((n, c) => n + (c.paidAmount || c.amount), 0))}</b></div>
        <div className="rb-stat"><span className="lbl">Claims filed</span><b>{shown.length}</b></div></div>
      {shown.slice(0, 6).map((c) => (
        <div className="li wrap" key={c.id}><div className="grow"><b style={{ fontWeight: 600 }}>{catNames(c)} · {money(c.amount)}</b> <span className="muted mono">{c.claimNo}</span>
          <div className="meta">{fdate(c.expenseDate)} · {c.description}</div></div>
          <div className="row" style={{ gap: 8 }}><span className={`pill ${(RB_STATUS[c.status] || ["", ""])[1]}`}>{(RB_STATUS[c.status] || [c.status])[0]}</span><Flags c={c} />
            {OPEN.includes(c.status) ? <><Link className="btn glass sm" to={`/app/reimbursements/${c.id}`}>Review</Link><button className="btn primary sm" onClick={() => setQuick(c.id)}>Approve</button></>
              : <Link className="btn glass sm" to={`/app/reimbursements/${c.id}`}>View</Link>}</div></div>
      ))}
      {!shown.length && <div className="empty">No reimbursement claims yet.</div>}
      {quick && <QuickApprove id={quick} cats={st.cats} onClose={() => setQuick(null)} onDone={() => setTick((n) => n + 1)} />}
    </div>
  );
}

/* ---------- history (the real server audit, filtered to this person) ---------- */
export function HistoryCard({ email }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api("GET", "/api/audit?limit=1000").then((r) => setRows(r.ok ? r.data.filter((a) => lc(a.email) === lc(email)) : []));
  }, [email]);
  return (
    <div className="card"><div className="card-h"><h3>History</h3><Link className="btn link" to="/app/audit">Full audit log</Link></div>
      <div style={{ paddingBottom: 12 }}>
        {rows === null ? <div className="empty">Loading…</div> : rows.length ? rows.map((a) => (
          <div className="tl" key={a.id}><span className="dot" style={{ background: /failed/i.test(a.action) ? "var(--bad)" : "var(--ok)" }} /><div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14 }}><b style={{ fontWeight: 600 }}>{a.name || a.email}</b> · {a.action}</div><div className="meta">{fts(new Date(a.ts))}</div></div></div>
        )) : <div className="empty">No recorded actions yet.</div>}
      </div></div>
  );
}
