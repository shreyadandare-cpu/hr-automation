import { useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import PeoplePicker from "../../components/PeoplePicker.jsx";
import { Callout, PersonCell, Pill, SectionHead, ListSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { useData } from "../../data.jsx";
import { scopeSet } from "../../lib/useLeave.js";
import { problems, useList, usePerson, when } from "../engage/shared.jsx";

const longDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const useStaff = () => { const { people } = useData(); return (people || []).filter((p) => p.status !== "offboarded").sort((a, b) => a.name.localeCompare(b.name)); };

/* HR > Notice periods: who has resigned, how much notice they owe, and whether their last day leaves it short. */
export function NoticePeriods() {
  const { can } = useAuth();
  const { data, error, reload } = useList("/api/hr/resignations");
  const person = usePerson(), toast = useToast();
  const [editing, setEditing] = useState(null);
  if (!can("exit.manage")) return <section className="section"><SectionHead title="Notice periods" /><div className="empty">Only the people who handle notice periods can see them.</div></section>;
  const list = (data && data.resignations) || [];
  const withdraw = async (x) => { const r = await api("POST", `/api/hr/resignations/${encodeURIComponent(x.person.email)}/withdraw`); if (!r.ok) toast(apiMsg(r)); else { toast(`${x.person.name}'s resignation was marked as withdrawn.`); reload(); } };
  return (
    <section className="section">
      <SectionHead title="Notice periods" sub={`Record a resignation to track the notice owed. The usual notice is ${data ? data.noticeDefault : 30} days; you can change it for a person.`}
        actions={<button type="button" className="btn primary" onClick={() => setEditing({})}>Record a resignation</button>} />
      {error && <Callout>{error}</Callout>}
      <div className="card">{!data ? <ListSkeleton /> : list.length ? (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Employee</th><th>Resigned</th><th>Notice</th><th>Notice ends</th><th>Last day</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{list.map((x) => (
            <tr key={x.person.email}><td><PersonCell person={person(x.person)} /></td><td>{longDate(x.resignedOn)}</td><td>{plural(x.noticeDays, "day")}</td><td>{longDate(x.expected)}</td>
              <td>{x.actual ? longDate(x.actual) : "Not set"}{x.agreedLastDay ? <div className="text-[13px] text-ink-faint">agreed by HR</div> : null}</td>
              <td>{x.shortBy ? <Pill tone="bad">{plural(x.shortBy, "day")} short</Pill> : x.over ? <Pill>Notice served</Pill> : <Pill tone="info">{plural(x.left, "day")} left</Pill>}</td>
              <td className="text-right"><div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn glass sm" onClick={() => setEditing(x)}>Edit</button><button type="button" className="btn glass sm" onClick={() => withdraw(x)}>Withdrawn</button></div></td></tr>))}</tbody>
        </table></div>) : <div className="empty">No open resignations.</div>}
      </div>
      <Callout>The notice ends on the resignation date plus the notice days. A last day before that is marked short; agree any notice pay or waiver with the person before their full and final settlement. The last day comes from Offboarding unless you agree one here.</Callout>
      {editing && <Resign x={editing} noticeDefault={data ? data.noticeDefault : 30} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toast("The resignation was saved."); reload(); }} />}
    </section>
  );
}

function Resign({ x, noticeDefault, onClose, onDone }) {
  const auth = useAuth(), { people } = useData();
  const scope = scopeSet(auth, "exit.manage", people);   // null = everyone; otherwise only the teams this person looks after
  const staff = useStaff().filter((p) => !scope || scope.has(String(p.email).toLowerCase()));
  const [f, setF] = useState({ email: x.person ? x.person.email : "", resignedOn: x.resignedOn || "", noticeDays: String(x.noticeDays ?? noticeDefault), agreedLastDay: x.agreedLastDay || "", note: x.note || "" });
  const [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); const r = await api("PUT", "/api/hr/resignations", f); setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone();
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>{x.person ? `Resignation of ${x.person.name}` : "Record a resignation"}</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        {!x.person && <Field id="rs-p" label="Who" error={err.email}><PeoplePicker id="rs-p" people={staff} value={f.email} onChange={(v) => setF({ ...f, email: v || "" })} /></Field>}
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <Field id="rs-d" label="Date of resignation" error={err.resignedOn}><input id="rs-d" type="date" className="input" value={f.resignedOn} onChange={(e) => setF({ ...f, resignedOn: e.target.value })} aria-invalid={!!err.resignedOn} /></Field>
          <Field id="rs-n" label="Notice, in days" error={err.noticeDays}><input id="rs-n" className="input" inputMode="numeric" maxLength={3} value={f.noticeDays} onChange={(e) => setF({ ...f, noticeDays: e.target.value })} aria-invalid={!!err.noticeDays} /></Field>
        </div>
        <Field id="rs-l" label="Agreed last day (optional)" hint="Leave empty to use the last day set in Offboarding." error={err.agreedLastDay}><input id="rs-l" type="date" className="input" value={f.agreedLastDay} onChange={(e) => setF({ ...f, agreedLastDay: e.target.value })} aria-invalid={!!err.agreedLastDay} /></Field>
        <Field id="rs-t" label="Note (optional)" hint="For example, notice pay agreed or waived."><textarea id="rs-t" className="input" rows={3} maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    </Modal>
  );
}

/* My Team > Approval cover: who decides your team's leave while you are away. HR can set it for any manager. */
export function StandIns() {
  const { user, canAll } = useAuth();
  const { data, error, reload } = useList(`/api/stand-ins${canAll("leave.approve") ? "?scope=all" : ""}`);
  const staff = useStaff(), person = usePerson(), toast = useToast();
  const forOthers = !!(data && data.canSetForOthers);   // the server says who may name cover for any manager
  const [f, setF] = useState({ for: "", standIn: "", from: "", to: "" }), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const list = (data && data.standIns) || [];
  const add = async (e) => {
    e.preventDefault(); setBusy(true);
    const r = await api("POST", "/api/stand-ins", { ...f, for: f.for || user.email }); setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    setErr({}); setF({ for: "", standIn: "", from: "", to: "" }); toast("The stand-in was saved, and they have been told."); reload();
  };
  const cancel = async (x) => { const r = await api("DELETE", `/api/stand-ins/${x.id}`); if (!r.ok) toast(apiMsg(r)); else { toast("The stand-in was cancelled."); reload(); } };
  return (
    <section className="section">
      <SectionHead title="Approval cover" sub="Name someone to approve or decline your team's leave while you are away. You can still decide yourself, and it ends on the last day you choose." />
      {error && <Callout>{error}</Callout>}
      <form className="card" onSubmit={add} noValidate><div className="card-h"><h3>Add cover</h3></div>
        <div className="card-b">
          {err.form && <Callout>{err.form}</Callout>}
          <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
            {forOthers && <Field id="si-f" label="Whose approvals (empty: yours)" error={err.for}><PeoplePicker id="si-f" people={staff} value={f.for} onChange={(v) => setF({ ...f, for: v || "" })} /></Field>}
            <Field id="si-s" label="Who covers" error={err.standIn}><PeoplePicker id="si-s" people={staff} value={f.standIn} onChange={(v) => setF({ ...f, standIn: v || "" })} /></Field>
            <Field id="si-a" label="First day" error={err.from}><input id="si-a" type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-invalid={!!err.from} /></Field>
            <Field id="si-b" label="Last day" hint="At most 90 days." error={err.to}><input id="si-b" type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-invalid={!!err.to} /></Field>
          </div>
          <div className="flex justify-end"><button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save cover"}</button></div>
        </div>
      </form>
      <div className="card"><div className="card-h"><h3>Current and coming cover</h3></div>{!data ? <ListSkeleton /> : list.length ? (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Approvals of</th><th>Covered by</th><th>From</th><th>To</th><th>Status</th><th><span className="sr-only">Cancel</span></th></tr></thead>
          <tbody>{list.map((x) => (
            <tr key={x.id}><td><PersonCell person={person(x.for)} /></td><td><PersonCell person={person(x.standIn)} /></td><td>{longDate(x.from)}</td><td>{longDate(x.to)}</td>
              <td>{x.active ? <Pill tone="ok">Active</Pill> : <Pill tone="info">Starts {longDate(x.from)}</Pill>}</td>
              <td className="text-right">{(forOthers || x.mine) && <button type="button" className="btn glass sm" onClick={() => cancel(x)}>Cancel</button>}</td></tr>))}</tbody>
        </table></div>) : <div className="empty">No cover is set.</div>}
      </div>
      <Callout>Cover applies to leave and comp off requests. The stand-in sees them under Team leave and gets the same emails while the cover lasts.</Callout>
    </section>
  );
}

const VERDICTS = [["strong-yes", "Strong yes", "ok"], ["yes", "Yes", "ok"], ["no", "No", "bad"], ["strong-no", "Strong no", "bad"]];
const MODE = { video: "Video call", "in-person": "In person", phone: "Phone" };
export const ivTime = (iso) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export { VERDICTS, MODE };

/* Me > Interviews: interviews you are on. Add each to your calendar, then leave your recommendation. */
export function Interviews() {
  const { data, error, reload } = useList("/api/interviews");
  const toast = useToast();
  const [writing, setWriting] = useState(null);
  const list = (data && data.interviews) || [];
  const now = Date.now();
  const upcoming = list.filter((x) => !x.cancelled && Date.parse(x.at) > now).reverse(), past = list.filter((x) => x.cancelled || Date.parse(x.at) <= now);
  const Card = ({ x }) => (
    <article className="card gl-card">
      <div className="row"><h3>{x.candidate}</h3>{x.cancelled ? <Pill>Cancelled</Pill> : x.mine ? <Pill tone={VERDICTS.find((v) => v[0] === x.mine.verdict)[2]}>{VERDICTS.find((v) => v[0] === x.mine.verdict)[1]}</Pill> : Date.parse(x.at) <= now ? <Pill tone="warn">Waiting for you</Pill> : <Pill tone="info">Coming up</Pill>}</div>
      <p>{x.role}. {ivTime(x.at)}, {x.minutes} minutes, {MODE[x.mode] || x.mode}.</p>
      {x.place && (/^https:/.test(x.place) ? <a className="btn link nolink self-start" href={x.place} target="_blank" rel="noreferrer">Join the call</a> : <p>{x.place}</p>)}
      {x.note && <p className="whitespace-pre-wrap">{x.note}</p>}
      <p>With {x.interviewers.map((i) => i.name).join(", ")}.</p>
      {!x.cancelled && <div className="row">
        <a className="btn glass sm" href={`/api/interviews/${x.id}/calendar`} download>Add to calendar</a>
        <button type="button" className={`btn ${x.mine ? "glass" : "primary"} sm`} onClick={() => setWriting(x)}>{x.mine ? "Change recommendation" : "Give recommendation"}</button>
      </div>}
    </article>
  );
  return (
    <section className="section">
      <SectionHead title="Interviews" sub="Interviews the HR team has asked you to take. After each one, please leave your recommendation." />
      {error && <Callout>{error}</Callout>}
      {!data ? <ListSkeleton /> : !list.length ? <div className="card"><div className="empty">You have no interviews.</div></div> : <>
        {upcoming.length > 0 && <><h2 className="lv-h">Coming up</h2><div className="eg-grid">{upcoming.map((x) => <Card key={x.id} x={x} />)}</div></>}
        {past.length > 0 && <><h2 className="lv-h">Earlier</h2><div className="eg-grid">{past.map((x) => <Card key={x.id} x={x} />)}</div></>}
      </>}
      {writing && <Verdict x={writing} onClose={() => setWriting(null)} onDone={() => { setWriting(null); toast("Your recommendation was saved."); reload(); }} />}
    </section>
  );
}

function Verdict({ x, onClose, onDone }) {
  const [f, setF] = useState({ verdict: x.mine ? x.mine.verdict : "", notes: x.mine ? x.mine.notes : "" }), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); const r = await api("PUT", `/api/interviews/${x.id}/verdict`, f); setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone();
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Your recommendation for {x.candidate}</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <Field id="iv-v" label="Recommendation" error={err.verdict}><select id="iv-v" className="input" value={f.verdict} onChange={(e) => setF({ ...f, verdict: e.target.value })} aria-invalid={!!err.verdict}><option value="">Choose one</option>{VERDICTS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
        <Field id="iv-n" label="Why" hint="The HR team and other interviewers read this. The candidate never does." error={err.notes}><textarea id="iv-n" className="input" rows={6} maxLength={3000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} aria-invalid={!!err.notes} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save recommendation"}</button></div>
    </Modal>
  );
}
export { when };
