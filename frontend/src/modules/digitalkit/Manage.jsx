import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiMsg } from "../../api.js";
import ConfirmDialog from "../../components/ConfirmDialog.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import { Pill, shortDate } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { kb } from "./kit.js";

const MODULES = [["text", "Ready-to-use text"], ["template", "Templates"], ["download", "Downloads"], ["background", "Call backgrounds"], ["linkedin", "LinkedIn banners"], ["card", "Business card designs"]];
const LABEL = Object.fromEntries(MODULES);
const WITH_BODY = new Set(["text", "template"]);
const day = (t) => (t ? shortDate(String(t).slice(0, 10)) : "—");

/* HR: manage the shared resources. Employees never reach this screen or its routes. */
export default function Manage({ onChanged }) {
  return <div className="dk-stack"><Resources onChanged={onChanged} /></div>;
}

function Resources({ onChanged }) {
  const toast = useToast();
  const [rows, setRows] = useState(null), [filter, setFilter] = useState(""), [edit, setEdit] = useState(null), [del, setDel] = useState(null);
  const fileRef = useRef(null), target = useRef(null);
  const load = useCallback(async () => { const r = await api("GET", "/api/digital-kit/admin/resources"); if (r.ok) setRows(r.data); else toast(apiMsg(r)); }, [toast]);
  useEffect(() => { load(); }, [load]);
  const after = async (msg) => { if (msg) toast(msg); await load(); onChanged && onChanged(); };

  const toggle = async (r) => {
    const x = await api("PUT", `/api/digital-kit/admin/resources/${r.id}`, { published: !r.published });
    if (!x.ok) return toast(apiMsg(x));
    after(r.published ? "Unpublished. Employees no longer see it." : "Published. Everyone sees it now.");
  };
  const upload = async (id, file) => {
    if (!file) return null;
    if (file.size > 25 * 1048576) { toast("That file is larger than 25 MB."); return null; }
    const x = await fetch(`/api/digital-kit/admin/resources/${id}/file?name=${encodeURIComponent(file.name)}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file });
    if (x.status === 401) { location.href = "/login"; return null; }
    const d = await x.json().catch(() => null);
    if (!x.ok) { toast((d && d.error) || "Could not upload the file."); return null; }
    return d;
  };
  const pick = (r) => { target.current = r.id; fileRef.current.value = ""; fileRef.current.click(); };
  const picked = async (e) => { const f = e.target.files[0]; if (!f || !target.current) return; const d = await upload(target.current, f); if (d) after("File uploaded. Employees get the new version."); };

  useEffect(() => {   // a click outside closes the open "More" menu
    const close = (e) => document.querySelectorAll(".dk-menu[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; });
    document.addEventListener("click", close); return () => document.removeEventListener("click", close);
  }, []);
  const list = (rows || []).filter((r) => !filter || r.module === filter);
  return (
    <>
      <input ref={fileRef} type="file" hidden onChange={picked} accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.pptx,.xlsx,.zip" />
      <div className="card">
        <div className="card-h"><h3>Shared resources</h3><button type="button" className="btn primary sm" onClick={() => setEdit({})}>Add resource</button></div>
        <div className="filters">
          <select className="input" aria-label="Section" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All sections</option>{MODULES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <span className="muted">Published items show to every employee straight away. Changing one updates it for everyone; nobody needs to redo their kit.</span>
        </div>
        <div className="tbl-wrap dk-res-wrap"><table className="dk-res">
          <thead><tr><th>Resource</th><th>Status</th><th>File</th><th>Updated</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {rows === null ? <tr><td colSpan="5"><div className="empty">Loading…</div></td></tr>
              : list.length ? list.map((r) => (
                <tr key={r.id}>
                  <td className="dk-res-t"><b>{r.title}</b>
                    <div className="muted dk-res-sub">{LABEL[r.module]}{r.category ? ` · ${r.category}` : ""}
                      {r.audience && r.audience.length > 0 && <span className="dk-tags dk-res-for">{r.audience.slice(0, 3).map((w) => <i key={w}>{w}</i>)}{r.audience.length > 3 && <i>+{r.audience.length - 3}</i>}</span>}</div></td>
                  <td><Pill tone={r.published ? "ok" : "mute"}>{r.published ? "Published" : "Draft"}</Pill></td>
                  <td className="dk-nw">{r.hasFile ? <span title={r.filename}>{(r.filename || "").split(".").pop().toUpperCase()} · {kb(r.size)}</span> : WITH_BODY.has(r.module) ? "Text" : <span className="muted">None</span>}</td>
                  <td className="dk-nw">{day(r.updatedAt)} <span className="muted">· v{r.version}</span></td>
                  <td className="dk-res-act">
                    <button type="button" className="btn glass sm" onClick={() => setEdit(r)}>Edit</button>
                    <button type="button" className="btn glass sm" onClick={() => toggle(r)}>{r.published ? "Unpublish" : "Publish"}</button>
                    <details className="dk-menu" onToggle={(e) => { if (e.currentTarget.open) document.querySelectorAll(".dk-menu[open]").forEach((d) => { if (d !== e.currentTarget) d.open = false; }); }}>
                      <summary className="btn glass sm" aria-label={`More for ${r.title}`}>More</summary>
                      <div className="dk-menu-box">
                        <button type="button" onClick={(e) => { e.currentTarget.closest("details").open = false; pick(r); }}>{r.hasFile ? "Replace file" : "Upload file"}</button>
                        <button type="button" className="danger" onClick={(e) => { e.currentTarget.closest("details").open = false; setDel(r); }}>Delete</button>
                      </div>
                    </details>
                  </td></tr>))
                : <tr><td colSpan="5"><div className="empty">Nothing here yet. Add the first resource.</div></td></tr>}
          </tbody></table></div>
      </div>
      {edit && <ResourceModal item={edit} onClose={() => setEdit(null)} upload={upload} onSaved={(m) => { setEdit(null); after(m); }} />}
      {del && <ConfirmDialog title={`Delete "${del.title}"?`} danger confirmLabel="Delete" onClose={() => setDel(null)}
        onConfirm={async () => { const x = await api("DELETE", `/api/digital-kit/admin/resources/${del.id}`); setDel(null); if (!x.ok) return toast(apiMsg(x)); after("Deleted."); }}>
        Employees will no longer see it. This cannot be undone.</ConfirmDialog>}
    </>
  );
}

function ResourceModal({ item, onClose, onSaved, upload }) {
  const isNew = !item.id;
  const [f, setF] = useState({ module: item.module || "text", category: item.category || "", title: item.title || "", description: item.description || "", body: item.body || "", sortOrder: item.sortOrder ?? 100, published: item.published ?? false, audience: (item.audience || []).join(", ") });
  const [file, setFile] = useState(null), [errors, setErrors] = useState({}), [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const save = async () => {
    setBusy(true);
    const body = { title: f.title, category: f.category, description: f.description, sortOrder: Number(f.sortOrder) || 0, published: f.published, audience: f.audience, ...(WITH_BODY.has(f.module) ? { body: f.body } : {}), ...(isNew ? { module: f.module } : {}) };
    const r = isNew ? await api("POST", "/api/digital-kit/admin/resources", body) : await api("PUT", `/api/digital-kit/admin/resources/${item.id}`, body);
    if (!r.ok) { setBusy(false); if (r.status === 400 && r.data && r.data.errors) { setErrors(r.data.errors); return; } toast(apiMsg(r)); return; }
    if (file) { const d = await upload(r.data.id, file); if (!d) { setBusy(false); onSaved("Saved, but the file was not uploaded. Use Upload file to try again."); return; } }
    setBusy(false); onSaved(isNew ? "Added." : "Saved. Employees see the update.");
  };
  return (
    <Modal onClose={busy ? () => {} : onClose} wide>
      <div className="card-h"><h3>{isNew ? "Add a resource" : "Edit resource"}</h3></div>
      <div className="card-b form">
        <Field id="dk-m" label="Section"><select className="input" id="dk-m" value={f.module} disabled={!isNew} onChange={set("module")}>{MODULES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field id="dk-c" label="Group (optional)" hint="Resources with the same group are shown together, such as Email or Out of office."><input className="input" id="dk-c" value={f.category} maxLength={60} onChange={set("category")} /></Field>
        <Field id="dk-t" label="Title" error={errors.title}><input className="input" id="dk-t" value={f.title} maxLength={120} onChange={set("title")} /></Field>
        <Field id="dk-d" label="Short description (optional)"><input className="input" id="dk-d" value={f.description} maxLength={500} onChange={set("description")} /></Field>
        {WITH_BODY.has(f.module) && <Field id="dk-b" label={f.module === "text" ? "Text" : "Text (optional, for a template without a file)"} hint="Use {{name}}, {{title}}, {{email}} and {{phone}} to fill in each person's details. Use [brackets] for what they write themselves."><textarea className="input" id="dk-b" rows={9} value={f.body} maxLength={20000} onChange={set("body")} /></Field>}
        <Field id="dk-f" label={item.hasFile ? "Replace the file (optional)" : "File (optional)"} hint="PDF, image, Word, PowerPoint, Excel or ZIP, up to 25 MB."><input className="input" id="dk-f" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.pptx,.xlsx,.zip" onChange={(e) => setFile(e.target.files[0] || null)} /></Field>
        <Field id="dk-a" label="Who is it for?" hint="Leave empty for everyone. Or type words such as hr, sales, engineer, designer, separated by commas: only people whose designation or department has one of them will see it. Use hr for the HR team." error={errors.audience}><input className="input" id="dk-a" value={f.audience} maxLength={200} placeholder="Everyone" onChange={set("audience")} /></Field>
        <Field id="dk-o" label="Order" hint="Smaller numbers come first. The official items use 10 to 70." error={errors.sortOrder}><input className="input" id="dk-o" type="number" value={f.sortOrder} onChange={set("sortOrder")} /></Field>
        <label className="check"><input type="checkbox" checked={f.published} onChange={set("published")} /> Published (visible to all employees)</label>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    </Modal>
  );
}
