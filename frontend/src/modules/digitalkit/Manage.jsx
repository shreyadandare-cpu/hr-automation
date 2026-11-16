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

/* HR: manage the shared resources and the details used to personalise each person's kit. Employees never reach these screens or routes. */
export default function Manage({ onChanged }) {
  const [sub, setSub] = useState("resources");
  return (
    <div className="dk-stack">
      <div className="subtabs" role="tablist" aria-label="Manage">
        <button type="button" role="tab" className={sub === "resources" ? "on" : ""} aria-selected={sub === "resources"} onClick={() => setSub("resources")}>Shared resources</button>
        <button type="button" role="tab" className={sub === "people" ? "on" : ""} aria-selected={sub === "people"} onClick={() => setSub("people")}>People</button>
      </div>
      {sub === "resources" ? <Resources onChanged={onChanged} /> : <People onChanged={onChanged} />}
    </div>
  );
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
        <div className="tbl-wrap"><table>
          <thead><tr><th>Title</th><th>Section</th><th>For</th><th>Status</th><th>File</th><th>Version</th><th>Updated</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {rows === null ? <tr><td colSpan="8"><div className="empty">Loading…</div></td></tr>
              : list.length ? list.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.title}</b>{r.category && <div className="muted" style={{ fontSize: 12.5 }}>{r.category}</div>}</td>
                  <td>{LABEL[r.module]}</td>
                  <td>{r.audience && r.audience.length ? <span className="dk-tags" style={{ justifyContent: "flex-start" }}>{r.audience.slice(0, 3).map((w) => <i key={w}>{w}</i>)}{r.audience.length > 3 && <i>+{r.audience.length - 3}</i>}</span> : <span className="muted">Everyone</span>}</td>
                  <td><Pill tone={r.published ? "ok" : "mute"}>{r.published ? "Published" : "Draft"}</Pill></td>
                  <td>{r.hasFile ? <span title={r.filename}>{(r.filename || "").split(".").pop().toUpperCase()} · {kb(r.size)}</span> : WITH_BODY.has(r.module) ? "Text" : <span className="muted">None</span>}</td>
                  <td>v{r.version}</td><td>{day(r.updatedAt)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button type="button" className="btn glass sm" onClick={() => setEdit(r)}>Edit</button>{" "}
                    <button type="button" className="btn glass sm" onClick={() => pick(r)}>{r.hasFile ? "Replace file" : "Upload file"}</button>{" "}
                    <button type="button" className="btn glass sm" onClick={() => toggle(r)}>{r.published ? "Unpublish" : "Publish"}</button>{" "}
                    <button type="button" className="btn link sm" onClick={() => setDel(r)}>Delete</button>
                  </td></tr>))
                : <tr><td colSpan="8"><div className="empty">Nothing here yet. Add the first resource.</div></td></tr>}
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

function People({ onChanged }) {
  const toast = useToast();
  const [rows, setRows] = useState(null), [q, setQ] = useState(""), [edit, setEdit] = useState(null), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await api("GET", "/api/digital-kit/admin/employees"); if (r.ok) setRows(r.data); else toast(apiMsg(r)); }, [toast]);
  useEffect(() => { load(); }, [load]);
  const without = (rows || []).filter((r) => !r.hasKit).length;
  const init = async () => { setBusy(true); const r = await api("POST", "/api/digital-kit/admin/init"); setBusy(false); if (!r.ok) return toast(apiMsg(r)); toast(r.data.created ? `Created ${r.data.created} kit${r.data.created === 1 ? "" : "s"}.` : "Everyone already has a kit."); load(); };
  const list = (rows || []).filter((r) => !q.trim() || `${r.name} ${r.email} ${r.empNo}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <div className="card">
        <div className="card-h"><h3>People</h3>{rows && <span className="muted">{rows.length - without} of {rows.length} have a kit{without ? `, ${without} without` : ""}</span>}</div>
        <div className="filters">
          <input className="input grow" type="search" placeholder="Search name, email or employee number" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
          {without > 0 && <button type="button" className="btn glass sm" disabled={busy} onClick={init}>Create missing kits</button>}
        </div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Employee</th><th>Designation</th><th>Phone</th><th>Kit</th><th>Missing</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {rows === null ? <tr><td colSpan="6"><div className="empty">Loading…</div></td></tr>
              : list.length ? list.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b><div className="muted" style={{ fontSize: 12.5 }}>{r.email}{r.empNo ? ` · ${r.empNo}` : ""}</div></td>
                  <td>{r.title || <span className="muted">—</span>}{r.overrides.title && <span className="dk-tag">set by HR</span>}</td>
                  <td>{r.phone || <span className="muted">—</span>}</td>
                  <td><Pill tone={r.hasKit ? "ok" : "warn"}>{r.hasKit ? "Ready" : "Not created"}</Pill></td>
                  <td>{r.missing.length ? <Pill tone="warn">{r.missing.join(", ")}</Pill> : <span className="muted">Complete</span>}</td>
                  <td style={{ textAlign: "right" }}><button type="button" className="btn glass sm" onClick={() => setEdit(r)}>Edit details</button></td>
                </tr>)) : <tr><td colSpan="6"><div className="empty">No one matches.</div></td></tr>}
          </tbody></table></div>
      </div>
      {edit && <PersonModal person={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); toast("Saved."); load(); onChanged && onChanged(); }} />}
    </>
  );
}

function PersonModal({ person, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ ...person.overrides }), [errors, setErrors] = useState({}), [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); const r = await api("PUT", `/api/digital-kit/admin/employees/${person.id}`, f); setBusy(false);
    if (r.ok) return onSaved();
    if (r.status === 400 && r.data && r.data.errors) return setErrors(r.data.errors);
    toast(apiMsg(r));
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Details for {person.name}</h3></div>
      <div className="card-b form">
        <p className="muted dk-hint" style={{ margin: 0 }}>These are used in this person's signature, card, badge and LinkedIn kit instead of what is on their record. Leave a box empty to use the record.</p>
        <Field id="pm-t" label="Designation"><input className="input" id="pm-t" value={f.title} maxLength={120} placeholder={person.title || "Not on record"} onChange={set("title")} /></Field>
        <Field id="pm-p" label="Phone" error={errors.phone}><input className="input" id="pm-p" value={f.phone} maxLength={20} placeholder={person.phone || "Not on record"} onChange={set("phone")} /></Field>
        <Field id="pm-l" label="Location"><input className="input" id="pm-l" value={f.location} maxLength={80} placeholder={person.location || "Not on record"} onChange={set("location")} /></Field>
        <Field id="pm-h" label="LinkedIn headline" hint="Shown first in their LinkedIn kit."><input className="input" id="pm-h" value={f.linkedinHeadline} maxLength={220} onChange={set("linkedinHeadline")} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    </Modal>
  );
}
