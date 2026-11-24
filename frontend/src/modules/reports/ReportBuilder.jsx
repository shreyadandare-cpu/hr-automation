import { useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import ConfirmDialog from "../../components/ConfirmDialog.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout, CardSkeleton, PageSkeleton, SectionHead, TableSkeletonRow } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { problems, useList, when } from "../engage/shared.jsx";

/* Custom reports, as Keka has them: choose what the report is about, tick the columns, narrow it with filters, look at the
   first rows, then download the whole report as a spreadsheet or save it to run again. Only the data your access allows is
   offered, and a team permission limits the rows to your team. Downloads are recorded in the audit log. */
export default function ReportBuilder() {
  const { data, error, reload } = useList("/api/report-builder");
  const toast = useToast();
  const [r, setR] = useState(null);   // { dataset, columns, filters }
  const [out, setOut] = useState(null), [err, setErr] = useState({}), [busy, setBusy] = useState(""), [saving, setSaving] = useState(false), [removing, setRemoving] = useState(null);
  const sets = (data && data.datasets) || [];
  useEffect(() => { if (!r && sets.length) pick(sets[0].key); }, [sets.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (error && !data?.datasets) return <section className="section"><SectionHead title="Report builder" /><Callout>{error}</Callout></section>;
  if (!data) return <section className="section"><PageSkeleton stats={0} /></section>;
  if (!sets.length) return <section className="section"><SectionHead title="Report builder" /><div className="card"><div className="empty">Your access does not include any data for reports. Please ask a super admin if you need it.</div></div></section>;
  const ds = r && sets.find((x) => x.key === r.dataset);
  function pick(key, from) {
    const d = sets.find((x) => x.key === key);
    setR(from || { dataset: key, columns: d.defaults, filters: {} }); setOut(null); setErr({});
  }
  const body = () => ({ dataset: r.dataset, columns: ds.columns.map((c) => c.key).filter((k) => r.columns.includes(k)), filters: r.filters });
  const show = async (what = body()) => {
    setBusy("run"); setErr({});
    const res = await api("POST", "/api/report-builder/run", what);
    setBusy("");
    if (!res.ok) { setErr({ ...problems(res), form: res.data && res.data.errors ? "" : apiMsg(res) }); setOut(null); return; }
    setOut(res.data);
  };
  const download = async () => {
    setBusy("csv"); setErr({});
    const res = await fetch("/api/report-builder/csv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()), credentials: "same-origin" });
    setBusy("");
    if (!res.ok) { const b = await res.json().catch(() => ({})); setErr({ ...(b.errors || {}), form: b.errors ? "" : b.error || "The report could not be downloaded. Please try again." }); return; }
    const name = (/filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "") || [])[1] || "report.csv";
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(res.headers.get("X-Rows-Cut") === "1" ? `The report was downloaded. It has the first ${data.maxRows.toLocaleString("en-IN")} rows; please narrow the filters for the rest.` : "The report was downloaded.");
  };
  const runSaved = (s) => { const next = { dataset: s.dataset, columns: s.columns, filters: s.filters || {} }; pick(s.dataset, next); show(next); };
  const remove = async (s) => {
    const res = await api("DELETE", `/api/report-builder/saved/${s.id}`);
    setRemoving(null);
    if (!res.ok) toast(apiMsg(res)); else { toast(`${s.name} was removed.`); reload(); }
  };
  const setFilter = (k, v) => setR({ ...r, filters: { ...r.filters, [k]: v } });
  const toggle = (k) => setR({ ...r, columns: r.columns.includes(k) ? r.columns.filter((x) => x !== k) : [...r.columns, k] });
  return (
    <section className="section">
      <SectionHead title="Report builder" sub="Choose what the report is about, its columns and filters. Look at the first rows, then download it as a spreadsheet or save it to run again." />
      {data.saved.length > 0 && (
        <div className="card">
          <div className="card-h"><h3>Saved reports</h3></div>
          <ul className="m-0 flex list-none flex-col p-0">{data.saved.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-3 first:border-t-0 max-sm:px-4">
              <span className="min-w-0"><b className="font-bold">{s.name}</b><span className="block text-[14px] text-ink-dim">{(sets.find((x) => x.key === s.dataset) || {}).label || "No longer available to you"} · saved {when(s.savedAt)}</span></span>
              <span className="inline-flex gap-2">{s.available && <button type="button" className="btn glass sm" onClick={() => runSaved(s)}>Run</button>}
                <button type="button" className="btn glass sm" onClick={() => setRemoving(s)}>Remove</button></span>
            </li>))}</ul>
        </div>)}
      {!ds ? <CardSkeleton lines={5} /> : (
        <div className="card">
          <div className="card-h"><h3>Build a report</h3></div>
          <div className="card-b flex flex-col gap-5">
            {err.form && <Callout><span role="alert">{err.form}</span></Callout>}
            <Field id="rb-ds" label="What is the report about?" hint={ds.hint} error={err.dataset}>
              <select id="rb-ds" className="input" value={r.dataset} onChange={(e) => pick(e.target.value)}>{sets.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
            </Field>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 p-0 font-bold">Columns <span className="font-normal text-ink-dim">({r.columns.length} chosen)</span></legend>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1 max-lg:grid-cols-2 max-sm:grid-cols-1">{ds.columns.map((c) => (
                <label key={c.key} className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 flex-none accent-accent" checked={r.columns.includes(c.key)} onChange={() => toggle(c.key)} />{c.label}</label>))}</div>
              {err.columns && <span className="ferr" role="alert">{err.columns}</span>}
            </fieldset>
            <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
              <legend className="mb-2 p-0 font-bold">Filters</legend>
              <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">{ds.filters.map((f) => f.type === "select" ? (
                <Field key={f.key} id={`rb-f-${f.key}`} label={f.label} error={err[f.key]}>
                  <select id={`rb-f-${f.key}`} className="input" value={r.filters[f.key] || ""} onChange={(e) => setFilter(f.key, e.target.value)}>
                    <option value="">All</option>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                </Field>) : (
                <div key={f.key} className="field m-0">
                  <span className="lab">{f.label}{ds.needsDates === f.key ? " (needed)" : ""}</span>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 text-[14px] text-ink-dim">From<input type="date" className="input" value={(r.filters[f.key] || {}).from || ""} onChange={(e) => setFilter(f.key, { ...(r.filters[f.key] || {}), from: e.target.value })} aria-invalid={!!err[f.key]} /></label>
                    <label className="flex flex-col gap-1 text-[14px] text-ink-dim">To<input type="date" className="input" value={(r.filters[f.key] || {}).to || ""} onChange={(e) => setFilter(f.key, { ...(r.filters[f.key] || {}), to: e.target.value })} aria-invalid={!!err[f.key]} /></label>
                  </div>
                  {err[f.key] && <span className="ferr" role="alert">{err[f.key]}</span>}
                </div>))}</div>
            </fieldset>
          </div>
          <div className="flex flex-wrap justify-end gap-3 border-t border-line px-6 py-4 max-sm:flex-col-reverse max-sm:items-stretch max-sm:px-4">
            <button type="button" className="btn glass" onClick={() => setSaving(true)} disabled={!!busy || !r.columns.length}>Save report</button>
            <button type="button" className="btn glass" onClick={download} disabled={!!busy}>{busy === "csv" ? "Preparing…" : "Download spreadsheet"}</button>
            <button type="button" className="btn primary" onClick={() => show()} disabled={!!busy}>{busy === "run" ? "Building…" : "Show the report"}</button>
          </div>
        </div>)}
      {(busy === "run" || out) && (
        <div className="card">
          <div className="card-h"><h3>{ds ? ds.label : "Report"}</h3>{out && <span className="text-[14px] text-ink-dim">{out.rows.length ? `${out.rows.length}${out.more ? "+" : ""} rows` : ""}</span>}</div>
          <div className="tbl-wrap"><table>
            <thead><tr>{(out ? out.header : ds.columns.filter((c) => r.columns.includes(c.key)).map((c) => c.label)).map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{busy === "run" ? <TableSkeletonRow cols={r.columns.length || 1} rows={5} />
              : out.rows.length ? out.rows.map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j} className={typeof v === "number" ? "num-cell" : ""}>{v === "" ? "—" : String(v)}</td>)}</tr>)
              : <tr><td colSpan={out.header.length}><div className="empty">Nothing matches these filters.</div></td></tr>}</tbody>
          </table></div>
          {out && out.more && <div className="card-b"><Callout>This shows the first {data.previewRows} rows. The spreadsheet has all of them, up to {data.maxRows.toLocaleString("en-IN")}.</Callout></div>}
        </div>)}
      {saving && <SaveDialog report={body()} onClose={(ok) => { setSaving(false); if (ok) reload(); }} />}
      {removing && <ConfirmDialog title={`Remove ${removing.name}?`} confirmLabel="Remove report" onConfirm={() => remove(removing)} onClose={() => setRemoving(null)}>
        The saved report is removed for you. The data itself does not change.</ConfirmDialog>}
    </section>
  );
}

function SaveDialog({ report, onClose }) {
  const toast = useToast();
  const [name, setName] = useState(""), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const res = await api("POST", "/api/report-builder/saved", { ...report, name });
    setBusy(false);
    if (!res.ok) { setErr({ ...problems(res), form: res.data && res.data.errors ? "" : apiMsg(res) }); return; }
    toast(`${name.trim()} was saved.`); onClose(true);
  };
  const other = Object.entries(err).filter(([k, v]) => k !== "name" && k !== "form" && v).map(([, v]) => v);
  return (
    <Modal onClose={busy ? () => {} : () => onClose(false)}>
      <form onSubmit={save} noValidate>
        <div className="card-h"><h3>Save this report</h3></div>
        <div className="card-b">
          {(err.form || other.length > 0) && <Callout><span role="alert">{err.form || other.join(" ")}</span></Callout>}
          <Field id="rb-name" label="Name" hint="For example: Joiners this quarter. Only you see your saved reports." error={err.name}>
            <input id="rb-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!err.name} autoFocus />
          </Field>
        </div>
        <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose(false)} disabled={busy}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save report"}</button></div>
      </form>
    </Modal>
  );
}
