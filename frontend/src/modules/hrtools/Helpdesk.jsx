import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import BackButton from "../../components/BackButton.jsx";
import { Callout, PersonCell, Pill, SectionHead, ListSkeleton, PageSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { problems, useList, usePerson, when } from "../engage/shared.jsx";

const CATS = [["payroll", "Pay and payslips"], ["leave", "Leave"], ["attendance", "Attendance"], ["it", "IT and access"], ["documents", "Letters and documents"], ["other", "Something else"]];
const catName = (k) => (CATS.find(([x]) => x === k) || ["", k])[1];
const TONE = { open: "warn", answered: "info", closed: "mute" };
const STATUS = { open: "Waiting for HR", answered: "HR has replied", closed: "Closed" };

/* Helpdesk: ask HR or IT a question and follow the answer. Everyone sees their own; HR (all = true) sees everyone's. */
export default function Helpdesk({ all = false }) {
  const { canAll } = useAuth();
  const scope = all && canAll("helpdesk.answer") ? "?scope=all" : "";
  const { data, error, reload } = useList(`/api/tickets${scope}`);
  const toast = useToast();
  const person = usePerson();
  const [adding, setAdding] = useState(false);
  const base = scope ? "/app/hr-helpdesk" : "/app/helpdesk";
  const list = (data && data.tickets) || [];
  const waiting = list.filter((t) => t.status === "open").length;
  return (
    <section className="section">
      <SectionHead title={scope ? "Helpdesk" : "My helpdesk"} sub={scope ? `Questions from everyone. ${waiting} waiting for a reply.` : "Ask HR or IT a question and follow the answer here."}
        actions={!scope ? <button type="button" className="btn primary" onClick={() => setAdding(true)}>Ask a question</button> : null} />
      {error && <Callout>{error}</Callout>}
      <div className="card">{!data ? <ListSkeleton /> : list.length ? (
        <div className="tbl-wrap"><table>
          <thead><tr>{scope && <th>From</th>}<th>Subject</th><th>About</th><th>Last update</th><th>Status</th><th aria-label="Open" /></tr></thead>
          <tbody>{list.map((t) => (
            <tr key={t.id}>{scope && <td><PersonCell person={person(t.person)} /></td>}<td><b style={{ fontWeight: 700 }}>{t.subject}</b></td><td>{catName(t.category)}</td><td>{when(t.updatedAt)}</td>
              <td><Pill tone={TONE[t.status]}>{STATUS[t.status]}</Pill></td><td><Link className="btn glass sm" to={`${base}/${t.id}`}>Open</Link></td></tr>))}</tbody>
        </table></div>) : <div className="empty">{scope ? "No questions yet." : "You have not asked anything yet."}</div>}
      </div>
      {adding && <NewTicket onClose={() => setAdding(false)} onDone={() => { setAdding(false); toast("Your question was sent to HR."); reload(); }} />}
    </section>
  );
}

function NewTicket({ onClose, onDone }) {
  const [f, setF] = useState({ category: "payroll", subject: "", body: "" }), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    const r = await api("POST", "/api/tickets", f);
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone();
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Ask a question</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <Field id="tk-c" label="What is it about" error={err.category}><select id="tk-c" className="input" value={f.category} onChange={set("category")}>{CATS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
        <Field id="tk-s" label="Subject" error={err.subject}><input id="tk-s" className="input" maxLength={140} value={f.subject} onChange={set("subject")} aria-invalid={!!err.subject} /></Field>
        <Field id="tk-b" label="What do you need" error={err.body}><textarea id="tk-b" className="input" rows={5} maxLength={4000} value={f.body} onChange={set("body")} aria-invalid={!!err.body} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Sending…" : "Send to HR"}</button></div>
    </Modal>
  );
}

export function TicketPage({ all = false }) {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [d, setD] = useState(null), [error, setError] = useState(""), [body, setBody] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const back = all ? "/app/hr-helpdesk" : "/app/helpdesk";
  const load = () => api("GET", `/api/tickets/${encodeURIComponent(id)}`).then((r) => { if (r.ok) { setD(r.data); setError(""); } else { setError(apiMsg(r)); setD({}); } });
  useEffect(() => { setD(null); load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <PageSkeleton />;
  const t = d.ticket;
  const reply = async () => {
    setBusy(true);
    const r = await api("POST", `/api/tickets/${t.id}/reply`, { body });
    setBusy(false);
    if (!r.ok) { setErr((r.data && r.data.errors && r.data.errors.body) || apiMsg(r)); return; }
    setBody(""); setErr(""); toast("Your reply was sent."); load();
  };
  const close = async () => { const r = await api("POST", `/api/tickets/${t.id}/close`); if (!r.ok) toast(apiMsg(r)); else { toast("The question was closed."); nav(back); } };
  return (
    <section className="section">
      <BackButton to={back} label="Helpdesk" />
      {error || !t ? <Callout>{error || "This question is not available."}</Callout> : <>
        <SectionHead title={t.subject} sub={`${catName(t.category)}. Asked by ${t.person.name} on ${when(t.createdAt)}.`}
          actions={<><Pill tone={TONE[t.status]}>{STATUS[t.status]}</Pill>{t.status !== "closed" && <button type="button" className="btn glass" onClick={close}>Close question</button>}</>} />
        <div className="card"><div className="li"><div className="grow"><b>{t.person.name}</b><div className="meta">{when(t.createdAt)}</div><p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{t.body}</p></div></div>
          {d.replies.map((x) => <div className="li" key={x.id}><div className="grow"><b>{x.author.name}</b><div className="meta">{when(x.createdAt)}</div><p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{x.body}</p></div></div>)}
        </div>
        {t.status !== "closed" && <div className="card"><div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 20 }}>
          <div className="field"><label htmlFor="tk-r">Your reply</label><textarea id="tk-r" className="input" rows={4} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} aria-invalid={!!err} />{err && <span className="ferr" role="alert">{err}</span>}</div>
          <div className="row" style={{ justifyContent: "flex-end" }}><button type="button" className="btn primary" disabled={busy} onClick={reply}>{busy ? "Sending…" : "Send reply"}</button></div>
        </div></div>}
      </>}
    </section>
  );
}
