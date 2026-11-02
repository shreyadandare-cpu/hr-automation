import { useEffect, useState } from "react";
import { api } from "../../api.js";
import Modal, { Field } from "../../components/Modal.jsx";
import ConfirmDialog from "../../components/ConfirmDialog.jsx";
import { Pill, shortDate } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { inr } from "../../lib/useLeave.js";

const TONE = { Outstanding: "bad", "Partially recovered": "warn", "Fully recovered": "ok" };
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

/* Money paid to the employee ahead of time and what has been recovered. The offboarding financial clearance deducts
   whatever is still outstanding from the final salary. HR only (the server checks too). */
export function AdvancesCard({ email, name }) {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [form, setForm] = useState(null);   // { kind: "advance" } | { kind: "recovery", a }
  const [remove, setRemove] = useState(null);
  const load = () => api("GET", `/api/advances?email=${encodeURIComponent(email)}`).then((r) => setList(r.ok ? r.data : []));
  useEffect(() => { load(); }, [email]);   // eslint-disable-line react-hooks/exhaustive-deps
  const outstanding = (list || []).reduce((t, a) => t + a.outstanding, 0);
  return (
    <div className="card">
      <div className="card-h"><h3>Advances</h3>
        <div className="row" style={{ gap: 10 }}>{outstanding > 0 && <Pill tone="bad">{inr(outstanding)} outstanding</Pill>}
          <button type="button" className="btn glass sm" onClick={() => setForm({ kind: "advance" })}>Record advance</button></div></div>
      {!list ? <div className="card-b"><span className="skel" /><span className="skel" style={{ width: "60%" }} /></div>
        : !list.length ? <div className="card-b muted">No advances recorded for {name.split(" ")[0]}. Record one when money is paid ahead of time (a travel or salary advance); it is recovered at offboarding if still outstanding.</div>
        : <div className="tbl-wrap"><table>
            <thead><tr><th>Date</th><th>Reason</th><th className="num">Amount</th><th className="num">Recovered</th><th className="num">Outstanding</th><th>Status</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>{list.map((a) => (
              <tr key={a.id}><td>{shortDate(a.date)}</td><td>{a.reason}</td><td className="num">{inr(a.amount)}</td><td className="num">{inr(a.recovered)}</td>
                <td className="num"><b>{inr(a.outstanding)}</b></td><td><Pill tone={TONE[a.status]}>{a.status}</Pill></td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  {a.outstanding > 0 && <button type="button" className="btn link" onClick={() => setForm({ kind: "recovery", a })}>Record recovery</button>}
                  {a.recovered === 0 && <button type="button" className="btn glass sm" style={{ marginLeft: 8 }} onClick={() => setRemove(a)}>Remove</button>}
                </td></tr>))}</tbody>
          </table></div>}
      {form && <AdvanceForm email={email} kind={form.kind} a={form.a} onClose={() => setForm(null)} onSaved={(d) => { setList(d); setForm(null); toast(form.kind === "advance" ? "Advance recorded." : "Recovery recorded."); }} />}
      {remove && <ConfirmDialog danger title="Remove this advance?" confirmLabel="Remove" onClose={() => setRemove(null)} onConfirm={async () => {
        const r = await api("DELETE", `/api/advances/${remove.id}`);
        if (!r.ok) { toast((r.data && r.data.error) || "Could not remove it."); } else { setList(r.data); toast("Advance removed."); }
        setRemove(null);
      }}>{inr(remove.amount)} for “{remove.reason}”. Only remove an entry that was recorded by mistake; the removal is written to the audit log.</ConfirmDialog>}
    </div>
  );
}

function AdvanceForm({ email, kind, a, onClose, onSaved }) {
  const [v, setV] = useState({ date: todayIst(), reason: "", amount: kind === "recovery" ? String(a.outstanding) : "", note: "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setV({ ...v, [k]: e.target.value }); setErrors({}); };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = kind === "advance"
      ? await api("POST", "/api/advances", { email, date: v.date, reason: v.reason, amount: Number(v.amount) })
      : await api("POST", `/api/advances/${a.id}/recoveries`, { date: v.date, amount: Number(v.amount), note: v.note });
    setBusy(false);
    if (!r.ok) { setErrors((r.data && r.data.errors) || { amount: (r.data && r.data.error) || "Could not save." }); return; }
    onSaved(r.data);
  };
  return (
    <Modal onClose={onClose}>
      <form onSubmit={save} noValidate>
        <div className="card-h"><h3>{kind === "advance" ? "Record an advance" : `Record a recovery · ${a.reason}`}</h3></div>
        <div className="card-b">
          {kind === "recovery" && <p className="muted" style={{ margin: 0 }}>{inr(a.outstanding)} outstanding of {inr(a.amount)}.</p>}
          <Field id="adv-date" label={kind === "advance" ? "Date paid" : "Date recovered"} error={errors.date}><input className="input" type="date" id="adv-date" max={todayIst()} value={v.date} onChange={set("date")} /></Field>
          {kind === "advance" && <Field id="adv-reason" label="Reason" error={errors.reason}><input className="input" id="adv-reason" maxLength={200} placeholder="e.g. Travel advance for client visit" value={v.reason} onChange={set("reason")} /></Field>}
          <Field id="adv-amount" label="Amount (₹)" error={errors.amount}><input className="input" id="adv-amount" type="number" min="0.01" step="0.01" inputMode="decimal" value={v.amount} onChange={set("amount")} /></Field>
          {kind === "recovery" && <Field id="adv-note" label="Note (optional)" error={errors.note}><input className="input" id="adv-note" maxLength={200} placeholder="e.g. Deducted from October salary" value={v.note} onChange={set("note")} /></Field>}
        </div>
        <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
      </form>
    </Modal>
  );
}
