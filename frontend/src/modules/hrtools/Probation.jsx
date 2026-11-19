import { useState } from "react";
import { Link } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout, PersonCell, Pill, SectionHead, shortDate, PageSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { problems, useList, usePerson } from "../engage/shared.jsx";

const daysTo = (iso) => Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z")) / 86400000);

/* HR > Probation: everyone still in probation, soonest end date first. Probation ends six months after joining unless
   HR extends it. HR confirms a person or extends their probation here; the person is told either way. */
export default function Probation() {
  const { data, error, reload } = useList("/api/hr/probations");
  const toast = useToast();
  const person = usePerson();
  const [acting, setActing] = useState(null);
  const { can } = useAuth();
  if (!can("probation.manage")) return <section className="section"><SectionHead title="Probation" /><div className="empty">Only the people who decide probation can see this.</div></section>;
  if (!data) return <PageSkeleton />;
  const list = data.people || [];
  const open = list.filter((p) => p.status !== "confirmed");
  const due = open.filter((p) => daysTo(p.endsOn) <= 30);
  return (
    <section className="section">
      <SectionHead title="Probation" sub="Probation ends six months after joining unless you extend it. Confirm people here when it ends." />
      {error && <Callout>{error}</Callout>}
      <div className="rb-stats four db-strip">
        <div className="rb-stat"><span className="lbl">In probation</span><b>{open.length}</b><span className="sub">not yet confirmed</span></div>
        <div className={`rb-stat ${due.length ? "warn" : ""}`}><span className="lbl">Ending within 30 days</span><b>{due.length}</b><span className="sub">{due.length ? "need a decision soon" : "nothing due"}</span></div>
        <div className="rb-stat"><span className="lbl">Overdue</span><b>{open.filter((p) => daysTo(p.endsOn) < 0).length}</b><span className="sub">end date has passed</span></div>
        <div className="rb-stat"><span className="lbl">Extended</span><b>{open.filter((p) => p.status === "extended").length}</b><span className="sub">given more time</span></div>
      </div>
      <div className="card">{list.length ? (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Employee</th><th>Joined</th><th>Probation ends</th><th>Status</th><th aria-label="Actions" /></tr></thead>
          <tbody>{list.map((p) => { const d = daysTo(p.endsOn); return (
            <tr key={p.email}>
              <td><Link to={`/app/employees/${encodeURIComponent(p.email)}`} style={{ textDecoration: "none", color: "inherit" }}><PersonCell person={person(p)} sub={p.title || p.email} /></Link></td>
              <td>{shortDate(p.start)}</td>
              <td>{shortDate(p.endsOn)}{p.status !== "confirmed" && <div className="muted">{d < 0 ? `${-d} days overdue` : d === 0 ? "today" : `in ${d} days`}</div>}</td>
              <td>{p.status === "confirmed" ? <Pill tone="ok">Confirmed</Pill> : p.status === "extended" ? <Pill tone="warn">Extended</Pill> : d < 0 ? <Pill tone="bad">Overdue</Pill> : <Pill tone="info">In probation</Pill>}{p.note && <div className="muted">{p.note}</div>}</td>
              <td>{p.status !== "confirmed" && <button type="button" className="btn glass sm" onClick={() => setActing(p)}>Decide</button>}</td>
            </tr>); })}</tbody>
        </table></div>) : <div className="empty">No one is in probation right now.</div>}
      </div>
      {acting && <Decide p={acting} onClose={() => setActing(null)} onDone={(m) => { setActing(null); toast(m); reload(); }} />}
    </section>
  );
}

function Decide({ p, onClose, onDone }) {
  const [endsOn, setEndsOn] = useState(""), [note, setNote] = useState(""), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const go = async (action) => {
    setBusy(true);
    const r = await api("POST", "/api/hr/probations", { email: p.email, action, endsOn, note });
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone(action === "confirm" ? `${p.name} is confirmed.` : `${p.name}'s probation was extended.`);
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>{p.name}'s probation</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <p style={{ margin: 0, color: "var(--ink-dim)" }}>Joined {shortDate(p.start)}. Probation ends {shortDate(p.endsOn)}.</p>
        <Field id="pb-d" label="To extend: new end date" error={err.endsOn}><input id="pb-d" type="date" className="input" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} aria-invalid={!!err.endsOn} /></Field>
        <Field id="pb-n" label="Reason" hint="Needed when you extend. The person sees it." error={err.note}><textarea id="pb-n" className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!err.note} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn glass" onClick={() => go("extend")} disabled={busy}>Extend probation</button><button type="button" className="btn primary" onClick={() => go("confirm")} disabled={busy}>Confirm employment</button></div>
    </Modal>
  );
}
