import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import PeoplePicker from "../../components/PeoplePicker.jsx";
import { Callout, PersonCell, Pill, SectionHead, ViewTabs, ListSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { scopeSet } from "../../lib/useLeave.js";
import { problems, useList, usePerson, when } from "../engage/shared.jsx";

const TONE = { "self-pending": "warn", "manager-pending": "warn", "hr-pending": "info", done: "ok" };
const STATUS = { "self-pending": "Waiting for self-review", "manager-pending": "Waiting for manager", "hr-pending": "Waiting for HR", done: "Finished" };
const RATINGS = [[1, "1, needs to improve"], [2, "2, below expectations"], [3, "3, meets expectations"], [4, "4, exceeds expectations"], [5, "5, outstanding"]];
const longDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

/* Reviews. HR opens a review for one person, or a cycle for everyone. The person writes a self-review; their reporting
   manager writes a review and a rating; HR finishes it. HR or the manager can ask colleagues for feedback, which the
   person never sees. People see their own (Me > Reviews), managers their team's, HR everyone's (HR > Reviews). */
export default function Reviews({ all = false }) {
  const [params, setParams] = useSearchParams();
  const { data: mine } = useList("/api/reviews");
  const { data: asks } = useList("/api/feedback-requests");
  const isLead = !!(mine && mine.isLead);
  // The server says who reviews others (maybe only a team) and who runs cycles (whole company).
  const hrView = all && !!(mine && mine.canReviewOthers);
  const views = hrView ? [["all", "All reviews"], mine.canManage && ["cycles", "Cycles"]].filter(Boolean)
    : [["mine", "My reviews"], isLead && ["team", "My team"], asks && asks.requests && asks.requests.length > 0 && ["feedback", "Feedback asked of you"]].filter(Boolean);
  const view = views.some(([k]) => k === params.get("view")) ? params.get("view") : views[0][0];
  const setView = (v) => { const n = new URLSearchParams(params); n.set("view", v); setParams(n, { replace: true }); };
  return (
    <section className="section">
      <SectionHead title={hrView ? "Reviews" : "My reviews"}
        sub={hrView ? "Open a cycle for everyone, or a review for one person. Read the self-review and the manager's review, then finish it." : "Write your self-review when a review opens. You see your manager's and HR's review once it is finished."}
        tabs={views.length > 1 ? <ViewTabs label="Reviews" view={view} onView={setView} views={views} /> : null} />
      {view === "cycles" ? <Cycles /> : view === "feedback" ? <Asked /> : <List scope={view === "all" ? "all" : view === "team" ? "team" : ""} />}
    </section>
  );
}

function List({ scope }) {
  const { user } = useAuth();
  const { data, error, reload } = useList(`/api/reviews${scope ? `?scope=${scope}` : ""}`);
  const toast = useToast(), person = usePerson();
  const [starting, setStarting] = useState(false), [writing, setWriting] = useState(null), [asking, setAsking] = useState(null);
  const list = (data && data.reviews) || [];
  const as = scope === "all" ? "hr" : scope === "team" ? "manager" : "self";
  const ownReview = (x) => String(x.person.email).toLowerCase() === String(user.email).toLowerCase();   // nobody finishes their own review
  return (
    <>
      {scope === "all" && <div className="flex justify-end"><button type="button" className="btn glass" onClick={() => setStarting(true)}>Open a review for one person</button></div>}
      {error && <Callout>{error}</Callout>}
      {!data ? <ListSkeleton /> : list.length ? <div className="eg-grid">{list.map((x) => (
        <article className="card gl-card" key={x.id}>
          <div className="row"><h3>{x.period}</h3><Pill tone={TONE[x.status]}>{STATUS[x.status] || x.status}</Pill></div>
          {as !== "self" && <PersonCell person={person(x.person)} />}
          {x.selfText ? <><b>Self-review</b><p className="whitespace-pre-wrap">{x.selfText}</p></> : <p>{as === "self" ? "Please write your self-review." : "No self-review yet."}</p>}
          {x.managerText && <><b>{as === "manager" ? "Your review" : `${x.manager ? x.manager.name : "Manager"}'s review`}{x.managerRating ? `, rating ${x.managerRating} of 5` : ""}</b><p className="whitespace-pre-wrap">{x.managerText}</p></>}
          {x.hrText && <><b>HR's review{x.rating ? `, rating ${x.rating} of 5` : ""}</b><p className="whitespace-pre-wrap">{x.hrText}</p></>}
          {x.feedback && x.feedback.length > 0 && <><b>Colleague feedback ({x.feedback.filter((f) => f.submittedAt).length} of {x.feedback.length} written)</b>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">{x.feedback.map((f) => <li key={f.from.email} className="text-[15px]"><span className="font-bold">{f.from.name}:</span> <span className="whitespace-pre-wrap text-ink-dim">{f.text || "Not written yet."}</span></li>)}</ul></>}
          <div className="row"><span className="muted">Updated {when(x.updatedAt)}</span>
            <div className="flex flex-wrap justify-end gap-2">
              {as !== "self" && !ownReview(x) && x.status !== "done" && (as === "hr" || x.manager) && <button type="button" className="btn glass sm" onClick={() => setAsking(x)}>Ask colleagues</button>}
              {as === "hr" && !ownReview(x) && <button type="button" className="btn glass sm" onClick={() => setWriting({ x, as })}>{x.status === "done" ? "Edit review" : "Finish review"}</button>}
              {as === "manager" && x.status !== "done" && <button type="button" className="btn primary sm" onClick={() => setWriting({ x, as })}>{x.managerText ? "Edit your review" : "Write your review"}</button>}
              {as === "self" && x.status !== "done" && <button type="button" className="btn primary sm" onClick={() => setWriting({ x, as })}>{x.selfText ? "Edit self-review" : "Write self-review"}</button>}
            </div></div>
        </article>))}</div>
        : <div className="card"><div className="empty">{scope === "all" ? "No reviews yet. Open a cycle to start." : scope === "team" ? "No reviews for your team yet." : "You have no reviews yet. HR will open one when a review period starts."}</div></div>}
      {starting && <Start onClose={() => setStarting(false)} onDone={() => { setStarting(false); toast("The review is open, and the person has been told."); reload(); }} />}
      {writing && <Write {...writing} onClose={() => setWriting(null)} onDone={() => { setWriting(null); toast("The review was saved."); reload(); }} />}
      {asking && <Ask x={asking} onClose={() => setAsking(null)} onDone={(n) => { setAsking(null); toast(n ? `${n} ${n === 1 ? "colleague was" : "colleagues were"} asked.` : "Those colleagues were already asked."); reload(); }} />}
    </>
  );
}

function Start({ onClose, onDone }) {
  const { people } = useData(), auth = useAuth();
  const scope = scopeSet(auth, "reviews.manage", people), self = String(auth.user.email).toLowerCase();
  const list = (people || []).filter((p) => p.status !== "offboarded" && p.email.toLowerCase() !== self && (!scope || scope.has(p.email.toLowerCase())))
    .sort((a, b) => a.name.localeCompare(b.name));
  const [email, setEmail] = useState(""), [period, setPeriod] = useState(String(new Date().getFullYear())), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await api("POST", "/api/reviews", { email, period });
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone();
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Open a review</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <Field id="rv-p" label="Who" error={err.email}><PeoplePicker id="rv-p" people={list} value={email} onChange={(v) => setEmail(v || "")} /></Field>
        <Field id="rv-d" label="Period" hint="For example: 2026, or H1 2026." error={err.period}><input id="rv-d" className="input" maxLength={40} value={period} onChange={(e) => setPeriod(e.target.value)} aria-invalid={!!err.period} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Opening…" : "Open review"}</button></div>
    </Modal>
  );
}

function Write({ x, as, onClose, onDone }) {
  const start = as === "hr" ? x.hrText : as === "manager" ? x.managerText : x.selfText;
  const [text, setText] = useState(start || ""), [rating, setRating] = useState((as === "hr" ? x.rating || x.managerRating : x.managerRating) || 3), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const rated = as !== "self";
  const save = async () => {
    setBusy(true);
    const r = await api("PUT", `/api/reviews/${x.id}/${as}`, rated ? { text, rating } : { text });
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone();
  };
  const Quote = ({ label, children }) => <div className="field"><span className="lab">{label}</span><p className="m-0 whitespace-pre-wrap text-ink-dim">{children}</p></div>;
  return (
    <Modal wide onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>{as === "self" ? `My self-review, ${x.period}` : `Review for ${x.person.name}, ${x.period}`}</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        {as !== "self" && x.selfText && <Quote label="Their self-review">{x.selfText}</Quote>}
        {as === "hr" && x.managerText && <Quote label={`${x.manager ? x.manager.name : "Manager"}'s review${x.managerRating ? `, rating ${x.managerRating} of 5` : ""}`}>{x.managerText}</Quote>}
        <Field id="rw-t" label={as === "self" ? "What went well, what did not, and what you want to work on" : "Your review"} error={err.text}><textarea id="rw-t" className="input" rows={10} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!err.text} /></Field>
        {rated && <Field id="rw-r" label="Rating" hint={as === "hr" ? "The person sees the reviews and the rating once you finish." : "HR reads your review before it is finished. The person sees it then."} error={err.rating}><select id="rw-r" className="input" value={rating} onChange={(e) => setRating(Number(e.target.value))}>{RATINGS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>}
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : as === "hr" ? "Finish review" : as === "manager" ? "Send to HR" : "Send"}</button></div>
    </Modal>
  );
}

function Ask({ x, onClose, onDone }) {
  const { people } = useData();
  const staff = (people || []).filter((p) => p.status !== "offboarded" && p.email.toLowerCase() !== x.person.email.toLowerCase());
  const [emails, setEmails] = useState([]), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); const r = await api("POST", `/api/reviews/${x.id}/feedback-requests`, { emails }); setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone(r.data.asked);
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Ask colleagues about {x.person.name}</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <Field id="fb-p" label="Colleagues, up to eight" hint={`They write a few lines for the ${x.period} review. ${x.person.name.split(" ")[0]} never sees who wrote what, or the feedback itself.`} error={err.emails}>
          <PeoplePicker id="fb-p" multi people={staff} value={emails} onChange={setEmails} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy || !emails.length}>{busy ? "Asking…" : "Ask for feedback"}</button></div>
    </Modal>
  );
}

/* Feedback colleagues asked you to write. */
function Asked() {
  const { data, error, reload } = useList("/api/feedback-requests");
  const toast = useToast(), person = usePerson();
  const [writing, setWriting] = useState(null), [text, setText] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const list = (data && data.requests) || [];
  const save = async () => {
    setBusy(true); const r = await api("PUT", `/api/feedback-requests/${writing.id}`, { text }); setBusy(false);
    if (!r.ok) { setErr((r.data && r.data.errors && r.data.errors.text) || apiMsg(r)); return; }
    setWriting(null); toast("Thank you. Your feedback was saved."); reload();
  };
  return (
    <>
      {error && <Callout>{error}</Callout>}
      {!data ? <ListSkeleton /> : <div className="eg-grid">{list.map((x) => (
        <article className="card gl-card" key={x.id}>
          <div className="row"><h3>{x.period}</h3>{x.submittedAt ? <Pill tone="ok">Written</Pill> : x.open ? <Pill tone="warn">Waiting for you</Pill> : <Pill>Closed</Pill>}</div>
          <PersonCell person={person(x.about)} />
          {x.text ? <p className="whitespace-pre-wrap">{x.text}</p> : <p>What does {x.about.name.split(" ")[0]} do well, and what could they do better?</p>}
          {x.open && <div className="row"><span className="muted">{x.about.name.split(" ")[0]} does not see your name or your words.</span><button type="button" className="btn primary sm" onClick={() => { setWriting(x); setText(x.text); setErr(""); }}>{x.text ? "Edit" : "Write feedback"}</button></div>}
        </article>))}</div>}
      {writing && <Modal wide onClose={busy ? () => {} : () => setWriting(null)}>
        <div className="card-h"><h3>Feedback on {writing.about.name}</h3></div>
        <div className="card-b"><Field id="fb-t" label="Your feedback" hint="The HR team and their manager read it." error={err}><textarea id="fb-t" className="input" rows={8} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!err} /></Field></div>
        <div className="modal-f"><button type="button" className="btn glass" onClick={() => setWriting(null)} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save feedback"}</button></div>
      </Modal>}
    </>
  );
}

/* HR: review cycles. Opening one creates a review for everyone (or one department) at once. */
function Cycles() {
  const { data, error, reload } = useList("/api/review-cycles");
  const { people } = useData();
  const toast = useToast();
  const [opening, setOpening] = useState(false), [f, setF] = useState({ name: "", dept: "", selfDue: "", managerDue: "" }), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const depts = [...new Set((people || []).filter((p) => p.status !== "offboarded").map((p) => p.dept).filter((d) => d && d !== "—"))].sort();
  const list = (data && data.cycles) || [];
  const open = async () => {
    setBusy(true); const r = await api("POST", "/api/review-cycles", f); setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    setOpening(false); setErr({}); toast(`${r.data.opened} reviews were opened${r.data.skipped ? `; ${r.data.skipped} people already had one for this period` : ""}. Everyone has been told.`); reload();
  };
  const close = async (c) => { const r = await api("POST", `/api/review-cycles/${c.id}/close`); if (!r.ok) toast(apiMsg(r)); else { toast("The cycle was closed."); reload(); } };
  return (
    <>
      <div className="flex justify-end"><button type="button" className="btn primary" onClick={() => setOpening(true)}>Open a cycle</button></div>
      {error && <Callout>{error}</Callout>}
      <div className="card">{!data ? <ListSkeleton /> : list.length ? (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Cycle</th><th>Who</th><th>Self-reviews due</th><th>Manager reviews due</th><th className="text-right">Waiting for self</th><th className="text-right">Waiting for manager</th><th className="text-right">Waiting for HR</th><th className="text-right">Finished</th><th><span className="sr-only">Close</span></th></tr></thead>
          <tbody>{list.map((c) => (
            <tr key={c.id}><td><b className="font-bold">{c.name}</b>{c.status === "closed" && <div className="text-[13px] text-ink-faint">Closed</div>}</td><td>{c.dept || "Everyone"}</td><td>{longDate(c.selfDue)}</td><td>{longDate(c.managerDue)}</td>
              <td className="num-cell text-right">{c.selfPending}</td><td className="num-cell text-right">{c.managerPending}</td><td className="num-cell text-right">{c.hrPending}</td><td className="num-cell text-right">{c.done} of {c.total}</td>
              <td className="text-right">{c.status === "open" && <button type="button" className="btn glass sm" onClick={() => close(c)}>Close</button>}</td></tr>))}</tbody>
        </table></div>) : <div className="empty">No cycles yet. Open one to start reviews for everyone at once.</div>}
      </div>
      <Callout>Each person's reporting manager reviews after the self-review. People with no manager go straight to HR. Find each review under All reviews.</Callout>
      {opening && <Modal onClose={busy ? () => {} : () => setOpening(false)}>
        <div className="card-h"><h3>Open a review cycle</h3></div>
        <div className="card-b">
          {err.form && <Callout>{err.form}</Callout>}
          <Field id="cy-n" label="Name" hint="For example: 2026 H2. It shows as the review period." error={err.name}><input id="cy-n" className="input" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-invalid={!!err.name} /></Field>
          <Field id="cy-d" label="Who" error={err.dept}><select id="cy-d" className="input" value={f.dept} onChange={(e) => setF({ ...f, dept: e.target.value })}><option value="">Everyone</option>{depts.map((d) => <option key={d}>{d}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <Field id="cy-s" label="Self-reviews due" error={err.selfDue}><input id="cy-s" type="date" className="input" value={f.selfDue} onChange={(e) => setF({ ...f, selfDue: e.target.value })} aria-invalid={!!err.selfDue} /></Field>
            <Field id="cy-m" label="Manager reviews due" error={err.managerDue}><input id="cy-m" type="date" className="input" value={f.managerDue} onChange={(e) => setF({ ...f, managerDue: e.target.value })} aria-invalid={!!err.managerDue} /></Field>
          </div>
        </div>
        <div className="modal-f"><button type="button" className="btn glass" onClick={() => setOpening(false)} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={open} disabled={busy}>{busy ? "Opening…" : "Open cycle"}</button></div>
      </Modal>}
    </>
  );
}
