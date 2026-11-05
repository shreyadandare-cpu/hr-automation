import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { useToast } from "../components/toast.jsx";
import { Pill, SectionHead, Stat, shortDate } from "../components/ui.jsx";
import Pager, { Paged } from "../components/Pager.jsx";
import Modal, { Field } from "../components/Modal.jsx";

const dash = <span className="muted">—</span>;
const TONE = { "In stock": "ok", Assigned: "info", "In repair": "warn", Retired: "mute" };
const today = () => new Date().toISOString().slice(0, 10);

/* Add a new asset, or edit the details of one. */
function AssetModal({ asset, categories, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState(asset ? { tag: asset.tag, category: asset.category, name: asset.name, serial: asset.serial, purchasedOn: asset.purchasedOn ? String(asset.purchasedOn).slice(0, 10) : "", warrantyUntil: asset.warrantyUntil ? String(asset.warrantyUntil).slice(0, 10) : "", notes: asset.notes }
    : { tag: "", category: categories[0], name: "", serial: "", purchasedOn: "", warrantyUntil: "", notes: "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setError("");
    const r = asset ? await api("PUT", `/api/assets/${asset.id}`, f) : await api("POST", "/api/assets", f);
    setBusy(false);
    if (!r.ok) { setError(apiMsg(r)); return; }
    toast(asset ? "Asset updated." : `${r.data.asset.tag} added.`);
    await onDone(); onClose();
  };
  return (
    <Modal onClose={onClose}>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>{asset ? `Edit ${asset.tag}` : "Add an asset"}</h3></div>
      <div className="card-b">
        <Field id="as-name" label="Asset name" hint="Make and model, for example MacBook Air M2."><input id="as-name" className="input" autoFocus maxLength={160} value={f.name} onChange={set("name")} /></Field>
        <Field id="as-cat" label="Category"><select id="as-cat" className="input" value={f.category} onChange={set("category")}>{categories.map((c) => <option key={c}>{c}</option>)}</select></Field>
        {!asset && <Field id="as-tag" label="Asset tag (optional)" hint="Leave blank to number it automatically."><input id="as-tag" className="input" maxLength={30} value={f.tag} onChange={set("tag")} /></Field>}
        <Field id="as-serial" label="Serial number (optional)"><input id="as-serial" className="input" maxLength={80} value={f.serial} onChange={set("serial")} /></Field>
        <Field id="as-bought" label="Purchase date (optional)"><input id="as-bought" type="date" className="input" value={f.purchasedOn} onChange={set("purchasedOn")} /></Field>
        <Field id="as-warr" label="Warranty until (optional)"><input id="as-warr" type="date" className="input" value={f.warrantyUntil} onChange={set("warrantyUntil")} /></Field>
        <Field id="as-notes" label="Notes (optional)"><input id="as-notes" className="input" maxLength={500} value={f.notes} onChange={set("notes")} /></Field>
        {error && <p className="ferr" role="alert" style={{ marginTop: 12 }}>{error}</p>}
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={!f.name.trim() || busy} onClick={save}>{busy ? "Saving…" : asset ? "Save" : "Add asset"}</button></div>
    </Modal>
  );
}

function AssignModal({ asset, onClose, onDone }) {
  const { people } = useData();
  const toast = useToast();
  const [who, setWho] = useState(""), [on, setOn] = useState(today());
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const staff = (people || []).filter((p) => p.status !== "offboarded").sort((a, b) => a.name.localeCompare(b.name));
  const save = async () => {
    setBusy(true); setError("");
    const r = await api("POST", `/api/assets/${asset.id}/assign`, { employeeId: Number(who), date: on });
    setBusy(false);
    if (!r.ok) { setError(apiMsg(r)); return; }
    toast(`${asset.tag} given to ${r.data.asset.assignee.name}.`);
    await onDone(); onClose();
  };
  return (
    <Modal onClose={onClose}>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Give {asset.tag} to someone</h3></div>
      <div className="card-b">
        <p className="muted" style={{ margin: 0 }}>{asset.name}</p>
        <Field id="ag-who" label="Employee"><select id="ag-who" className="input" autoFocus value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Choose an employee</option>{staff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field id="ag-on" label="Given on"><input id="ag-on" type="date" className="input" value={on} max={today()} onChange={(e) => setOn(e.target.value)} /></Field>
        {error && <p className="ferr" role="alert" style={{ marginTop: 12 }}>{error}</p>}
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={!who || busy} onClick={save}>{busy ? "Saving…" : "Give asset"}</button></div>
    </Modal>
  );
}

function ReturnModal({ asset, onClose, onDone }) {
  const toast = useToast();
  const [next, setNext] = useState("In stock");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    const r = await api("POST", `/api/assets/${asset.id}/return`, { status: next });
    setBusy(false);
    if (!r.ok) { setError(apiMsg(r)); return; }
    toast(`${asset.tag} is now ${next}.`);
    await onDone(); onClose();
  };
  return (
    <Modal onClose={onClose}>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>{asset.assignee ? `Take back ${asset.tag}` : `Change status of ${asset.tag}`}</h3></div>
      <div className="card-b">
        {asset.assignee && <p className="muted" style={{ margin: 0 }}>Currently with {asset.assignee.name}.</p>}
        <Field id="rt-next" label="It is now"><select id="rt-next" className="input" value={next} onChange={(e) => setNext(e.target.value)}>
          <option>In stock</option><option>In repair</option><option>Retired</option></select></Field>
        {error && <p className="ferr" role="alert" style={{ marginTop: 12 }}>{error}</p>}
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></div>
    </Modal>
  );
}

function HistoryModal({ asset, onClose }) {
  const [events, setEvents] = useState(null);
  useEffect(() => { api("GET", `/api/assets/${asset.id}/history`).then((r) => setEvents(r.ok ? r.data.events : [])); }, [asset.id]);
  return (
    <Modal onClose={onClose}>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>History of {asset.tag}</h3></div>
      <div className="card-b">
        {events === null ? <p className="muted">Loading…</p> : !events.length ? <p className="muted">Nothing recorded yet.</p> : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
            {events.map((e, i) => <li key={i}><b>{e.action}</b><div className="muted" style={{ fontSize: "12.5px" }}>{new Date(e.at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}{e.by ? ` · ${e.by}` : ""}</div></li>)}
          </ul>)}
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

export default function Assets() {
  const { user, itAdmin } = useAuth();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [q, setQ] = useState(""), [cat, setCat] = useState(""), [st, setSt] = useState("");
  const [dlg, setDlg] = useState(null);   // { kind: "add" | "edit" | "assign" | "return" | "history", asset }
  const load = useCallback(async () => {
    const r = await api("GET", "/api/assets");
    if (r.ok) setD(r.data); else { toast(apiMsg(r)); setD({ categories: [], statuses: [], assets: [] }); }
  }, [toast]);
  useEffect(() => { if (itAdmin) load(); }, [itAdmin, load]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ((d && d.assets) || []).filter((a) => (!cat || a.category === cat) && (!st || a.status === st)
      && (!s || `${a.tag} ${a.name} ${a.serial} ${a.category} ${a.assignee ? a.assignee.name : ""}`.toLowerCase().includes(s)));
  }, [d, q, cat, st]);

  if (!itAdmin) return <section className="section"><SectionHead eyebrow="IT" title="Company" accent="assets." /><div className="empty">Only IT admins and HR can see assets.</div></section>;
  const all = (d && d.assets) || [];
  const n = (s) => all.filter((a) => a.status === s).length;
  const close = () => setDlg(null);

  return (
    <section className="section">
      <SectionHead eyebrow="IT" title="Company" accent="assets." sub="Laptops, phones and other equipment, and who has each one. Only IT admins and HR can see this page."
        actions={<button type="button" className="btn primary" onClick={() => setDlg({ kind: "add" })}>+ Add asset</button>} />
      <div className="rb-stats four" style={{ marginBottom: 18 }}>
        <Stat value={all.length} label="Total assets" /><Stat value={n("Assigned")} label="Assigned" /><Stat value={n("In stock")} label="In stock" /><Stat value={n("In repair")} label="In repair" />
      </div>
      <Paged items={shown} resetKey={`${q}|${cat}|${st}`}>{(page, pager) => (
        <div className="card">
          <div className="filters">
            <input className="input grow" placeholder="Search tag, name, serial or person…" aria-label="Search assets" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{((d && d.categories) || []).map((c) => <option key={c}>{c}</option>)}</select>
            <select className="input" aria-label="Status" value={st} onChange={(e) => setSt(e.target.value)}><option value="">All status</option>{((d && d.statuses) || []).map((s) => <option key={s}>{s}</option>)}</select>
          </div>
          <div className="tbl-wrap"><table className="alloc-table">
            <thead><tr><th>Tag</th><th>Asset</th><th>Serial</th><th>With</th><th>Status</th><th>Warranty</th><th></th></tr></thead>
            <tbody>
              {d === null && <tr><td colSpan="7"><div className="empty">Loading…</div></td></tr>}
              {d && !page.length && <tr><td colSpan="7"><div className="empty">{all.length ? "No assets match." : "No assets yet. Add the first one."}</div></td></tr>}
              {page.map((a) => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: "nowrap" }}><b>{a.tag}</b></td>
                  <td>{a.name}<div className="muted">{a.category}</div></td>
                  <td>{a.serial || dash}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{a.assignee ? <>{a.assignee.name}{a.assignee.left && <div><Pill tone="bad">Left the company, collect it</Pill></div>}<div className="muted">since {shortDate(a.assignedOn)}</div></> : dash}</td>
                  <td><Pill tone={TONE[a.status] || "mute"}>{a.status}</Pill></td>
                  <td style={{ whiteSpace: "nowrap" }}>{a.warrantyUntil ? shortDate(a.warrantyUntil) : dash}</td>
                  <td><div className="u-actions">
                    {a.status === "Assigned"
                      ? <button type="button" className="btn glass sm" onClick={() => setDlg({ kind: "return", asset: a })}>Take back</button>
                      : a.status !== "Retired" && <button type="button" className="btn glass sm" onClick={() => setDlg({ kind: "assign", asset: a })}>Give to…</button>}
                    {a.status !== "Assigned" && a.status !== "Retired" && a.status !== "In stock" && <button type="button" className="btn glass sm" onClick={() => setDlg({ kind: "return", asset: a })}>Set status</button>}
                    <button type="button" className="btn glass sm" onClick={() => setDlg({ kind: "edit", asset: a })}>Edit</button>
                    <button type="button" className="btn glass sm" onClick={() => setDlg({ kind: "history", asset: a })}>History</button>
                  </div></td>
                </tr>))}
            </tbody>
          </table></div>
          {d && <Pager {...pager} />}
        </div>)}</Paged>
      {dlg && (dlg.kind === "add" || dlg.kind === "edit") && <AssetModal asset={dlg.asset} categories={d.categories} onClose={close} onDone={load} />}
      {dlg && dlg.kind === "assign" && <AssignModal asset={dlg.asset} onClose={close} onDone={load} />}
      {dlg && dlg.kind === "return" && <ReturnModal asset={dlg.asset} onClose={close} onDone={load} />}
      {dlg && dlg.kind === "history" && <HistoryModal asset={dlg.asset} onClose={close} />}
    </section>
  );
}
