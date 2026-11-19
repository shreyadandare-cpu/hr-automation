import { useState } from "react";
import { api, apiMsg } from "../../api.js";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout, Icon, SectionHead, PageSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { problems, useList } from "./shared.jsx";

const hostOf = (u) => { try { return new URL(u).host; } catch { return u; } };

/* Me > Apps: the other tools the company uses, one click away. HR keeps the list. Links open in a new tab. */
export default function Apps() {
  const { data, error, reload } = useList("/api/apps");
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  if (!data) return <PageSkeleton />;
  const apps = data.apps || [];
  const remove = async (a) => { const r = await api("DELETE", `/api/apps/${a.id}`); if (!r.ok) toast(apiMsg(r)); else { toast(`${a.title} was removed.`); reload(); } };
  return (
    <section className="section">
      <SectionHead title="Apps" sub="The other tools Wohlig uses. Each opens in a new tab."
        actions={data.canManage ? <button type="button" className="btn primary" onClick={() => setAdding(true)}>Add an app</button> : null} />
      {error && <Callout>{error}</Callout>}
      {apps.length ? <div className="eg-grid">{apps.map((a) => (
        <div className="card eg-app" key={a.id}>
          <a href={a.url} target="_blank" rel="noopener noreferrer"><span className="q-ic q-info"><Icon name="layers" /></span>
            <span className="grow"><b>{a.title}</b><span>{a.description || hostOf(a.url)}</span></span></a>
          {data.canManage && <button type="button" className="btn link nolink" onClick={() => remove(a)}>Remove</button>}
        </div>))}</div>
        : <div className="card"><div className="empty">{data.canManage ? "No apps yet. Add the tools your team uses every day." : "HR has not added any apps yet."}</div></div>}
      {adding && <NewApp onClose={() => setAdding(false)} onDone={() => { setAdding(false); toast("The app was added."); reload(); }} />}
    </section>
  );
}

function NewApp({ onClose, onDone }) {
  const [title, setTitle] = useState(""), [url, setUrl] = useState("https://"), [description, setDescription] = useState("");
  const [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await api("POST", "/api/apps", { title, url, description });
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    onDone();
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Add an app</h3></div>
      <div className="card-b">
        {err.form && <Callout>{err.form}</Callout>}
        <Field id="ap-t" label="Name" error={err.title}><input id="ap-t" className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!err.title} /></Field>
        <Field id="ap-u" label="Web address" error={err.url}><input id="ap-u" className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={!!err.url} /></Field>
        <Field id="ap-d" label="What it is for (optional)" error={err.description}><input id="ap-d" className="input" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Add app"}</button></div>
    </Modal>
  );
}
