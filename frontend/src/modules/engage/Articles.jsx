import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import Modal, { Field } from "../../components/Modal.jsx";
import BackButton from "../../components/BackButton.jsx";
import { Callout, Pill, SectionHead, PageSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { problems, useList, when } from "./shared.jsx";

/* Engage > Articles: longer pieces from HR (guides, policies explained, news). Drafts are seen by HR only. */
export default function Articles() {
  const { data, error, reload } = useList("/api/articles");
  const toast = useToast();
  const [editing, setEditing] = useState(null);   // {} for a new article, or the article being edited
  if (!data) return <PageSkeleton />;
  const list = data.articles || [];
  return (
    <section className="section">
      <SectionHead title="Articles" sub="Guides, policies explained and company news, written by HR."
        actions={data.canManage ? <button type="button" className="btn primary" onClick={() => setEditing({})}>Write an article</button> : null} />
      {error && <Callout>{error}</Callout>}
      {list.length ? <div className="eg-grid">{list.map((a) => (
        <Link className="card eg-article" key={a.id} to={`/app/articles/${a.id}`}>
          <div className="eg-article-h"><h3>{a.title}</h3>{a.status !== "live" && <Pill tone="warn">Draft</Pill>}</div>
          <p>{a.excerpt}{a.excerpt.length >= 220 ? "…" : ""}</p>
          <span className="muted">{a.author.name}, {when(a.publishedAt || a.updatedAt)}</span>
        </Link>))}</div>
        : <div className="card"><div className="empty">{data.canManage ? "No articles yet. Write the first one." : "There are no articles yet."}</div></div>}
      {editing && <ArticleEditor article={editing} onClose={() => setEditing(null)} onDone={(live) => { setEditing(null); toast(live ? "The article is published." : "The draft was saved."); reload(); }} />}
    </section>
  );
}

export function ArticlePage() {
  const { id } = useParams();
  const toast = useToast();
  const [d, setD] = useState(null), [error, setError] = useState(""), [editing, setEditing] = useState(false);
  const load = () => api("GET", `/api/articles/${encodeURIComponent(id)}`).then((r) => { if (r.ok) { setD(r.data); setError(""); } else { setError(apiMsg(r)); setD({}); } });
  useEffect(() => { setD(null); load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <PageSkeleton />;
  const a = d.article;
  return (
    <section className="section">
      <BackButton to="/app/articles" label="Articles" />
      {error || !a ? <Callout>{error || "This article is not available."}</Callout> : <>
        <SectionHead title={a.title} sub={`${a.author.name}, ${when(a.publishedAt || a.updatedAt)}${a.status !== "live" ? ". Draft, visible to HR only." : ""}`}
          actions={d.canManage ? <button type="button" className="btn glass" onClick={() => setEditing(true)}>Edit</button> : null} />
        <article className="card eg-read">{a.body.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}</article>
        {a.requiresAck && a.status === "live" && <div className="card"><div className="row" style={{ padding: "16px 24px", justifyContent: "space-between" }}>
          <span>{a.ackedAt ? `You confirmed you have read this on ${when(a.ackedAt)}.` : "HR has asked everyone to confirm they have read this."}</span>
          {!a.ackedAt && <button type="button" className="btn primary" onClick={async () => { const r = await api("POST", `/api/articles/${a.id}/ack`); if (!r.ok) toast(apiMsg(r)); else { toast("Thank you. Your confirmation is recorded."); load(); } }}>I have read this</button>}
        </div></div>}
        {d.canManage && a.requiresAck && <Acks id={a.id} />}
        {editing && <ArticleEditor article={a} onClose={() => setEditing(false)} onDone={(live) => { setEditing(false); toast(live ? "The article is published." : "The draft was saved."); load(); }} />}
      </>}
    </section>
  );
}

/* HR: who has confirmed they read the article, and who has not yet. */
function Acks({ id }) {
  const { data } = useList(`/api/articles/${id}/acks`);
  if (!data || !data.people) return null;
  const waiting = data.people.filter((p) => !p.ackedAt);
  return (
    <div className="card"><div className="card-h"><h3>Who has read it</h3><span className="muted">{data.done} of {data.total} confirmed</span></div>
      <div className="card-b"><div className="progress" role="progressbar" aria-valuenow={data.done} aria-valuemin={0} aria-valuemax={data.total} aria-label="People who have confirmed"><i style={{ width: `${data.total ? data.done / data.total * 100 : 0}%` }} /></div>
        <p style={{ margin: "12px 0 0", color: "var(--ink-dim)" }}>{waiting.length ? `Still to confirm: ${waiting.slice(0, 40).map((p) => p.name).join(", ")}${waiting.length > 40 ? ` and ${waiting.length - 40} more` : ""}.` : "Everyone has confirmed."}</p></div>
    </div>
  );
}

function ArticleEditor({ article, onClose, onDone }) {
  const [title, setTitle] = useState(article.title || ""), [body, setBody] = useState(article.body || "");
  const [requiresAck, setRequiresAck] = useState(!!article.requiresAck);
  const [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const [full, setFull] = useState(article.id && article.body === undefined ? null : true);   // editing from the list: load the full text first
  useEffect(() => { if (full === null) api("GET", `/api/articles/${article.id}`).then((r) => { if (r.ok) { setBody(r.data.article.body); setFull(true); } else { setErr({ form: apiMsg(r) }); setFull(true); } }); }, [full, article.id]);
  const save = async (status) => {
    setBusy(true);
    const r = article.id ? await api("PUT", `/api/articles/${article.id}`, { title, body, status, requiresAck }) : await api("POST", "/api/articles", { title, body, status, requiresAck });
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone(status === "live");
  };
  return (
    <Modal wide onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>{article.id ? "Edit article" : "Write an article"}</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <Field id="ar-t" label="Title" error={err.title}><input id="ar-t" className="input" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!err.title} /></Field>
        <Field id="ar-b" label="Article" hint="Plain text. Leave an empty line between paragraphs." error={err.body}><textarea id="ar-b" className="input" rows={14} value={body} onChange={(e) => setBody(e.target.value)} aria-invalid={!!err.body} disabled={full === null} /></Field>
        <label className="former-toggle" style={{ fontSize: 15 }}><input type="checkbox" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} />Ask everyone to confirm they have read it (for policies)</label>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn glass" onClick={() => save("draft")} disabled={busy}>Save as draft</button><button type="button" className="btn primary" onClick={() => save("live")} disabled={busy}>{busy ? "Saving…" : "Publish"}</button></div>
    </Modal>
  );
}
