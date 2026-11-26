import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout, PersonCell, Pill, SectionHead, ViewTabs, shortDate, ListSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { problems, useList, usePerson, when } from "./shared.jsx";

const KINDS = [["missed-punch", "Missed punch"], ["work-from-home", "Work from home"], ["on-duty", "On duty elsewhere"]];
const kindName = (k) => (KINDS.find(([x]) => x === k) || ["", k])[1];
const TONE = { pending: "warn", approved: "ok", declined: "bad" };
const STATUS = { pending: "Waiting for approval", approved: "Approved", declined: "Declined" };
/** "6:45 pm" from "18:45". */
const clock12 = (t) => { const [h, m] = String(t).split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
/** "Missed punch out at 6:45 pm" for a missed punch with a time, otherwise the kind's name. */
/** What to tell the person after sending: a missed punch within the month's allowance is added at once, otherwise it waits. */
export const sentMessage = (d) => (d && d.selfFix ? `Your punch was added to your day.${d.selfFixesLeft ? ` You can add ${d.selfFixesLeft} more this month without approval.` : " Further corrections this month go to your manager and HR for approval."}` : "Your correction was sent to your manager and the HR team for approval.");
export const aboutOf = (x) => (x.kind === "missed-punch" && x.time ? `Missed punch ${x.direction === "IN" ? "in" : "out"} at ${clock12(x.time)}` : kindName(x.kind));
const inr = (n) => `₹${Number(n).toLocaleString("en-IN")}`;

/* Requests: attendance requests (a missed punch, working from home, on duty elsewhere) and salary advance requests.
   Everyone raises and follows their own. Attendance requests go to the person's reporting manager (HR when they have none), as
   Keka's attendance regularisation does: approving a missed punch with a time adds that punch, so the day is counted from the
   real times. Advances are decided by HR, who records the advance and its recovery on the person's page. */
/* `only` fixes the kind of request and `embedded` leaves out the page head, for the tab inside My attendance. `team` is a
   reporting manager's list: their team's attendance requests. */
export default function Requests({ all = false, only = null, embedded = false, team = false }) {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [type, setType] = useState(only || (sp.get("type") === "advance" ? "advance" : "attendance"));
  // Everyone's requests (or a team's) for those who decide this kind; the server marks each row they may decide.
  const scope = team || (all && can(type === "advance" ? "advances.approve" : "attendance.edit")) ? "?scope=all" : "";
  // ?new=missed-punch&date=2026-11-26 (from a reminder or a day in My attendance) opens the form for that day.
  const asked = sp.get("new") === "missed-punch" ? { kind: "missed-punch", date: sp.get("date") || "", direction: "OUT" } : null;
  const { data, error, reload } = useList(`/api/requests/${type}${scope}`);
  const toast = useToast();
  const person = usePerson();
  const [adding, setAdding] = useState(!scope && asked ? asked : false);
  useEffect(() => { if (asked) setSp((x) => { x.delete("new"); x.delete("date"); return x; }, { replace: true }); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const [deciding, setDeciding] = useState(null);
  const list = (data && data.requests) || [];
  const cancel = async (x) => { const r = await api("POST", `/api/requests/${type}/${x.id}/cancel`); if (!r.ok) toast(apiMsg(r)); else { toast("The request was cancelled."); reload(); } };
  const decide = scope && data && data.canDecide;
  return (
    <section className="section">
      {embedded ? <div className="row" style={{ justifyContent: "flex-end" }}><button type="button" className="btn primary" onClick={() => setAdding(true)}>New attendance request</button></div> :
      <SectionHead title={team ? "Attendance corrections" : scope ? "Requests" : "My requests"} sub={team ? "Missed punches and other attendance requests from your team. Approving a missed punch adds it to their day." : scope ? "Attendance and advance requests from everyone. Approve or decline each one." : "Fix a missed punch, note a day working from home or on duty, or request a salary advance."}
        actions={!scope ? <button type="button" className="btn primary" onClick={() => setAdding(true)}>{type === "attendance" ? "New attendance request" : "Request an advance"}</button> : null}
        tabs={only ? null : <ViewTabs label="Request type" view={type} onView={setType} views={[["attendance", "Attendance requests"], ["advance", "Advance requests"]]} />} />}
      {error && <Callout>{error}</Callout>}
      <div className="card">
        {!data ? <ListSkeleton /> : list.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr>{scope && <th>Employee</th>}<th>{type === "attendance" ? "Date" : "Amount"}</th><th>{type === "attendance" ? "About" : "Reason"}</th><th>Asked on</th><th>Status</th><th aria-label="Actions" /></tr></thead>
            <tbody>{list.map((x) => (
              <tr key={x.id}>
                {scope && <td><PersonCell person={person(x.person)} /></td>}
                <td className="num-cell">{type === "attendance" ? shortDate(x.date) : inr(x.amount)}</td>
                <td>{type === "attendance" ? <><b style={{ fontWeight: 700 }}>{aboutOf(x)}</b><div className="muted">{x.note}</div></> : x.reason}{x.decisionNote && <div className="muted">Note: {x.decisionNote}</div>}</td>
                <td>{when(x.createdAt)}</td>
                <td><Pill tone={TONE[x.status] || "mute"}>{x.selfFix && x.status === "approved" ? "Added, no approval needed" : STATUS[x.status] || x.status}</Pill></td>
                <td>{x.status === "pending" && (decide && x.canDecide ? <button type="button" className="btn glass sm" onClick={() => setDeciding(x)}>Decide</button> : !scope ? <button type="button" className="btn glass sm" onClick={() => cancel(x)}>Cancel</button> : null)}</td>
              </tr>))}</tbody>
          </table></div>)
          : <div className="empty">{scope ? "No requests yet." : "You have not made any requests yet."}</div>}
      </div>
      {adding && <NewRequest type={type} initial={typeof adding === "object" ? adding : null} onClose={() => setAdding(false)} onDone={(d) => { setAdding(false); toast(type === "attendance" ? (d && d.kind === "missed-punch" ? sentMessage(d) : "Your request was sent to your manager and the HR team.") : "Your request was sent to HR."); reload(); }} />}
      {deciding && <Decide type={type} x={deciding} name={deciding.person.name} onClose={() => setDeciding(null)} onDone={(d) => { setDeciding(null); toast(`The request was ${d}.`); reload(); }} />}
    </section>
  );
}

/* A new request. For a missed punch it asks which punch and the real time; `initial` fills in a day (from My attendance or a reminder). */
export function NewRequest({ type, initial = null, onClose, onDone }) {
  const [f, setF] = useState(type === "attendance" ? { date: "", kind: "missed-punch", direction: "OUT", time: "", note: "", ...(initial || {}) } : { amount: "", reason: "" });
  const [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    const r = await api("POST", `/api/requests/${type}`, f);
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone({ ...(r.data || {}), kind: f.kind });
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>{type === "attendance" ? "New attendance request" : "Request an advance"}</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        {type === "attendance" ? <>
          <Field id="rq-k" label="What is it about" error={err.kind}><select id="rq-k" className="input" value={f.kind} onChange={set("kind")}>{KINDS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
          <Field id="rq-d" label="Date" error={err.date}><input id="rq-d" type="date" className="input" value={f.date} onChange={set("date")} aria-invalid={!!err.date} /></Field>
          {f.kind === "missed-punch" && <>
            <Field id="rq-p" label="Which punch is missing" error={err.direction}><select id="rq-p" className="input" value={f.direction} onChange={set("direction")}><option value="OUT">Punch out (when I left)</option><option value="IN">Punch in (when I arrived)</option></select></Field>
            <Field id="rq-t" label={f.direction === "IN" ? "The time you arrived" : "The time you left"} hint="The first few each month are added straight away; after that your manager or HR approves it." error={err.time}><input id="rq-t" type="time" className="input" value={f.time} onChange={set("time")} aria-invalid={!!err.time} /></Field>
          </>}
          <Field id="rq-n" label="Note for your manager" error={err.note}><textarea id="rq-n" className="input" rows={3} maxLength={500} value={f.note} onChange={set("note")} placeholder={f.kind === "missed-punch" ? "For example: I forgot to punch out before leaving." : "For example: working from home for a delivery."} aria-invalid={!!err.note} /></Field>
        </> : <>
          <Field id="rq-a" label="Amount in rupees" error={err.amount}><input id="rq-a" className="input" inputMode="decimal" value={f.amount} onChange={set("amount")} placeholder="For example: 25,000" aria-invalid={!!err.amount} /></Field>
          <Field id="rq-r" label="What it is for" hint="HR decides the amount and how it is recovered from salary." error={err.reason}><textarea id="rq-r" className="input" rows={3} maxLength={500} value={f.reason} onChange={set("reason")} aria-invalid={!!err.reason} /></Field>
        </>}
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Sending…" : type === "attendance" ? "Send for approval" : "Send to HR"}</button></div>
    </Modal>
  );
}

function Decide({ type, x, name, onClose, onDone }) {
  const [note, setNote] = useState(""), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const go = async (decision) => {
    setBusy(true);
    const r = await api("POST", `/api/requests/${type}/${x.id}/decide`, { decision, note });
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone(decision === "approve" ? "approved" : "declined");
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Decide {name}'s request</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <p style={{ margin: 0, color: "var(--ink-dim)" }}>{type === "attendance" ? `${aboutOf(x)} on ${shortDate(x.date)}. ${x.note}` : `${inr(x.amount)}. ${x.reason}`}</p>
        <Callout>{type === "attendance" ? (x.kind === "missed-punch" && x.time ? `Approving adds the punch ${x.direction === "IN" ? "in" : "out"} at ${clock12(x.time)} to ${name}'s day on ${shortDate(x.date)}, and the day is counted from it.` : "Approving records your decision.") : "Approving records your decision. Please record the advance and its recovery on the person's page."}</Callout>
        <Field id="dc-n" label="Note to the person" hint="Needed when you decline." error={err.note}><textarea id="dc-n" className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!err.note} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn danger" onClick={() => go("decline")} disabled={busy}>Decline</button><button type="button" className="btn primary" onClick={() => go("approve")} disabled={busy}>Approve</button></div>
    </Modal>
  );
}
