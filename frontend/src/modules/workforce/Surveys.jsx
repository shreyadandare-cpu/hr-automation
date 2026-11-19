import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import BackButton from "../../components/BackButton.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout, PersonCell, Pill, SectionHead, ListSkeleton, PageSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { problems, useList, usePerson, when } from "../engage/shared.jsx";

const KINDS = [["enps", "Recommend, 0 to 10 (eNPS)"], ["scale", "Agree, 1 to 5"], ["choice", "Pick one"], ["text", "Written answer"]];
const SCALE = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
const longDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

/* Engage > Surveys: HR asks everyone a few questions; people answer once. Anonymous by default: answers carry no name,
   and results stay hidden until three people have answered. */
export default function Surveys() {
  const { data, error, reload } = useList("/api/surveys");
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const list = (data && data.surveys) || [];
  const can = data && data.canManage;
  return (
    <section className="section">
      <SectionHead title="Surveys" sub={can ? "Ask everyone a few questions. Anonymous surveys show results only once three people answer." : "Short questions from the HR team. Anonymous surveys never show your name."}
        actions={can ? <button type="button" className="btn primary" onClick={() => setCreating(true)}>Create a survey</button> : null} />
      {error && <Callout>{error}</Callout>}
      {!data ? <ListSkeleton /> : list.length ? <div className="eg-grid">{list.map((s) => (
        <article className="card gl-card" key={s.id}>
          <div className="row"><h3>{s.title}</h3>{s.answered ? <Pill tone="ok">Answered</Pill> : s.open ? <Pill tone="warn">Open</Pill> : <Pill>Closed</Pill>}</div>
          <p>{s.questions.length} {s.questions.length === 1 ? "question" : "questions"}, {s.anonymous ? "anonymous" : "with your name"}. {s.open ? `Closes ${longDate(s.closesOn)}.` : `Closed ${longDate(s.closesOn)}.`}</p>
          <div className="row">{can ? <span className="muted">{s.answers} {s.answers === 1 ? "answer" : "answers"}</span> : <span />}
            <div className="flex flex-wrap gap-2">
              {can && <Link className="btn glass sm" to={`/app/surveys/${s.id}/results`}>Results</Link>}
              {s.open && !s.answered && <Link className="btn primary sm" to={`/app/surveys/${s.id}`}>Answer</Link>}
            </div></div>
        </article>))}</div>
        : <div className="card"><div className="empty">{can ? "No surveys yet. Create the first one." : "There are no surveys right now."}</div></div>}
      {creating && <Create onClose={() => setCreating(false)} onDone={() => { setCreating(false); toast("The survey is open, and everyone has been told."); reload(); }} />}
    </section>
  );
}

function Create({ onClose, onDone }) {
  const inTwoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const [f, setF] = useState({ title: "", intro: "", closesOn: inTwoWeeks, anonymous: true, questions: [{ type: "enps", text: "How likely are you to recommend Wohlig as a place to work?", options: [] }] });
  const [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const setQ = (i, p) => setF({ ...f, questions: f.questions.map((q, j) => (j === i ? { ...q, ...p } : q)) });
  const save = async () => {
    setBusy(true);
    const r = await api("POST", "/api/surveys", { ...f, questions: f.questions.map((q) => ({ ...q, options: q.type === "choice" ? q.options : [] })) });
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone();
  };
  return (
    <Modal wide onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Create a survey</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <Field id="sv-t" label="Title" error={err.title}><input id="sv-t" className="input" maxLength={140} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-invalid={!!err.title} /></Field>
        <Field id="sv-i" label="A line to explain it (optional)"><textarea id="sv-i" className="input" rows={2} maxLength={1000} value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <Field id="sv-c" label="Closes on" error={err.closesOn}><input id="sv-c" type="date" className="input" value={f.closesOn} onChange={(e) => setF({ ...f, closesOn: e.target.value })} aria-invalid={!!err.closesOn} /></Field>
          <Field id="sv-a" label="Names"><select id="sv-a" className="input" value={f.anonymous ? "yes" : "no"} onChange={(e) => setF({ ...f, anonymous: e.target.value === "yes" })}><option value="yes">Anonymous (recommended)</option><option value="no">Show who answered</option></select></Field>
        </div>
        <div className="field"><span className="lab">Questions</span>
          {err.questions && <span className="ferr" role="alert">{err.questions}</span>}
          <ol className="m-0 flex list-none flex-col gap-4 p-0">{f.questions.map((q, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-field p-4 shadow-[inset_0_0_0_1px_var(--line-2)]">
              <div className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] items-start gap-2 max-sm:grid-cols-1">
                <select className="input" aria-label={`Kind of question ${i + 1}`} value={q.type} onChange={(e) => setQ(i, { type: e.target.value })}>{KINDS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
                <input className="input" aria-label={`Question ${i + 1}`} maxLength={300} placeholder="The question" value={q.text} onChange={(e) => setQ(i, { text: e.target.value })} aria-invalid={!!err[`q${i}`]} />
                <button type="button" className="btn glass sm" disabled={f.questions.length === 1} onClick={() => setF({ ...f, questions: f.questions.filter((_, j) => j !== i) })} aria-label={`Remove question ${i + 1}`}>Remove</button>
              </div>
              {q.type === "choice" && <input className="input" aria-label={`Choices for question ${i + 1}, separated by commas`} placeholder="Choices, separated by commas" value={q.options.join(", ")} onChange={(e) => setQ(i, { options: e.target.value.split(",").map((x) => x.trimStart()) })} />}
              {err[`q${i}`] && <span className="ferr" role="alert">{err[`q${i}`]}</span>}
            </li>))}</ol>
          {f.questions.length < 20 && <button type="button" className="btn link nolink self-start" onClick={() => setF({ ...f, questions: [...f.questions, { type: "scale", text: "", options: [] }] })}>Add a question</button>}
        </div>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Opening…" : "Open the survey"}</button></div>
    </Modal>
  );
}

/* One survey, to answer. */
export function SurveyPage() {
  const { id } = useParams();
  const nav = useNavigate(), toast = useToast();
  const { data, error } = useList(`/api/surveys/${encodeURIComponent(id)}`);
  const [a, setA] = useState({}), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const back = <BackButton to="/app/surveys" label="Surveys" />;
  if (!data) return <PageSkeleton />;
  if (error || !data.questions) return <section className="section">{back}<Callout>{error || "This survey was not found."}</Callout></section>;
  const send = async () => {
    setBusy(true);
    const r = await api("POST", `/api/surveys/${data.id}/answers`, { answers: data.questions.map((_, i) => (a[i] == null ? "" : a[i])) });
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "Please answer the questions marked below." : apiMsg(r) }); return; }
    toast("Thank you. Your answers were sent."); nav("/app/surveys");
  };
  return (
    <section className="section">
      {back}
      <SectionHead title={data.title} sub={[data.intro, data.anonymous ? "This survey is anonymous: your name is not kept with your answers." : "Your name is kept with your answers."].filter(Boolean).join(" ")} />
      {data.answered ? <Callout>You have already answered this survey. Thank you.</Callout> : !data.open ? <Callout>This survey has closed.</Callout> : <>
        {err.form && <Callout>{err.form}</Callout>}
        <ol className="m-0 flex list-none flex-col gap-4 p-0">{data.questions.map((q, i) => (
          <li key={i} className="card"><fieldset className="card-b m-0 flex flex-col gap-3 border-0">
            <legend className="float-left mb-2 w-full p-0 font-display text-[18px] font-medium">{i + 1}. {q.text}</legend>
            {q.type === "text" ? <textarea className="input" rows={4} maxLength={2000} aria-label={q.text} value={a[i] || ""} onChange={(e) => setA({ ...a, [i]: e.target.value })} />
              : <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.text}>
                {(q.type === "enps" ? Array.from({ length: 11 }, (_, k) => [k, String(k)]) : q.type === "scale" ? SCALE.map((n, k) => [k + 1, n]) : q.options.map((n, k) => [k, n])).map(([v, n]) => (
                  <label key={v} className={`btn glass sm cursor-pointer ${a[i] === v ? "ring-2 ring-accent" : ""}`}>
                    <input type="radio" className="sr-only" name={`q${i}`} checked={a[i] === v} onChange={() => setA({ ...a, [i]: v })} />{n}</label>))}
              </div>}
            {q.type === "enps" && <span className="text-[13px] text-ink-faint">0 is not at all likely, 10 is extremely likely.</span>}
            {err[`q${i}`] && <span className="ferr" role="alert">{err[`q${i}`]}</span>}
          </fieldset></li>))}</ol>
        <div className="flex justify-end"><button type="button" className="btn primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send answers"}</button></div>
      </>}
    </section>
  );
}

/* HR: what people said. */
export function SurveyResults() {
  const { id } = useParams();
  const { data, error } = useList(`/api/surveys/${encodeURIComponent(id)}/results`);
  const person = usePerson();
  const back = <BackButton to="/app/surveys" label="Surveys" />;
  if (!data) return <PageSkeleton />;
  if (error || !data.survey) return <section className="section">{back}<Callout>{error || "This survey was not found."}</Callout></section>;
  const s = data.survey;
  const Bar = ({ n, max }) => <div className="progress min-w-[80px] flex-1" aria-hidden="true"><i style={{ width: `${max ? (n / max) * 100 : 0}%` }} /></div>;
  return (
    <section className="section">
      {back}
      <SectionHead title={`Results: ${s.title}`} sub={`${data.responses} of ${data.staff} people answered. ${s.anonymous ? "Anonymous." : "Named."} Closes ${longDate(s.closesOn)}.`} />
      {data.hidden ? <Callout>Results show once three people have answered, so no one can be picked out. {data.responses} {data.responses === 1 ? "person has" : "people have"} answered so far.</Callout>
        : data.questions.map((q, i) => (
          <div className="card" key={i}><div className="card-h"><h3>{i + 1}. {q.text}</h3>
            {q.type === "enps" && q.score != null && <Pill tone={q.score > 0 ? "ok" : q.score < 0 ? "bad" : "mute"}>eNPS {q.score > 0 ? "+" : ""}{q.score}</Pill>}
            {q.type === "scale" && q.average != null && <Pill tone="info">Average {q.average} of 5</Pill>}</div>
            <div className="card-b">
              {q.type === "text" ? (q.answers.length ? <ul className="m-0 flex list-disc flex-col gap-2 pl-5">{q.answers.map((t, k) => <li key={k} className="whitespace-pre-wrap">{t}</li>)}</ul> : <div className="empty">No written answers.</div>)
                : <ul className="m-0 flex list-none flex-col gap-2 p-0">{q.counts.map((n, k) => {
                  const label = q.type === "scale" ? SCALE[k] : q.type === "enps" ? String(k) : q.options[k];
                  return <li key={k} className="flex items-center gap-3"><span className="w-40 flex-none text-[14px] max-xs:w-24">{label}</span><Bar n={n} max={Math.max(...q.counts)} /><span className="num-cell w-8 text-right">{n}</span></li>;
                })}</ul>}
              {q.type === "enps" && <p className="mt-3 mb-0 text-[14px] text-ink-dim">eNPS is the share who answered 9 or 10, less the share who answered 0 to 6. It runs from -100 to +100.</p>}
            </div>
          </div>))}
      {data.people && data.people.length > 0 && <div className="card"><div className="card-h"><h3>Who answered</h3></div>
        <div className="tbl-wrap"><table><thead><tr><th>Employee</th>{s.questions.map((q, i) => <th key={i}>Q{i + 1}</th>)}</tr></thead>
          <tbody>{data.people.map((p) => <tr key={p.person.email}><td><PersonCell person={person(p.person)} /></td>{p.answers.map((v, i) => <td key={i}>{s.questions[i].type === "choice" ? s.questions[i].options[v] : String(v ?? "")}</td>)}</tr>)}</tbody></table></div></div>}
      <p className="m-0 text-[14px] text-ink-dim">Created {when(s.createdAt)}.</p>
    </section>
  );
}
