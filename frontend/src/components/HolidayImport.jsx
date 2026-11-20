import { useState } from "react";
import { api, apiMsg } from "../api.js";
import Modal from "./Modal.jsx";
import { Callout, Pill } from "./ui.jsx";
import { useToast } from "./toast.jsx";

const ACCEPT = ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
const dateText = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const STATUS = { new: ["New", "ok"], changed: ["Updated", "warn"], same: ["No change", "mute"] };

/* HR: upload the holiday list for any year as an Excel (or CSV) sheet. Download the template, fill it in, choose the file, check the
   preview, then save. Each row becomes a holiday like the 2026 ones. Nothing is saved until the last button. */
export default function HolidayImport({ year, onClose, onSaved }) {
  const toast = useToast();
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [prev, setPrev] = useState(null);
  const read = async (file) => {
    if (!file) return;
    setBusy("read"); setError("");
    let r;
    try { r = await fetch("/api/leave/holidays/import", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file }); }
    catch { setBusy(""); return setError("The file could not be sent. Please check your connection and try again."); }
    const body = await r.json().catch(() => ({}));
    setBusy("");
    if (r.status === 401) { location.href = "/login"; return; }
    if (!r.ok) return setError(body.error || "The file could not be read. Please try again.");
    setPrev(body);
  };
  const todo = prev ? prev.holidays.filter((h) => h.status !== "same") : [];
  const save = async () => {
    setBusy("save"); setError("");
    const r = await api("POST", "/api/leave/holidays/import/apply", { holidays: todo.map(({ day, name, type }) => ({ day, name, type })) });
    setBusy("");
    if (!r.ok) return setError(apiMsg(r));
    const d = r.data;
    toast(`Holidays saved: ${d.added} added${d.updated ? `, ${d.updated} updated` : ""}.`);
    onSaved(d.years[0]);
  };
  return (
    <Modal wide onClose={() => { if (!busy) onClose(); }}>
      <div className="card-h"><h3>Upload the holiday list</h3></div>
      <div className="card-b">
        {error && <Callout>{error}</Callout>}
        {!prev && <>
          <p className="muted" style={{ margin: 0 }}>Fill in one Excel sheet with a row for each holiday: <b>Date</b>, <b>Holiday</b> and, if you like, <b>Type</b>. You can list any year, and several years in one file. Each row is saved like the holidays already on the list. You will see a preview before anything is saved.</p>
          <div><a className="btn glass" href={`/api/leave/holidays/template?year=${year}`}>Download the template for {year}</a>
            <span className="muted" style={{ marginLeft: 10 }}>It already holds the {year} holidays, ready to edit.</span></div>
          <div className="field"><span className="lab">Your filled-in sheet</span>
            <label className="btn primary" style={{ cursor: "pointer", justifySelf: "start" }}>{busy === "read" ? "Reading…" : "Choose the Excel file"}
              <input type="file" hidden accept={ACCEPT} disabled={busy === "read"} onChange={(e) => { read(e.target.files[0]); e.target.value = ""; }} /></label>
            <span className="hint">Excel (.xlsx) or CSV, up to 1 MB.</span></div>
        </>}
        {prev && <>
          <p style={{ margin: 0 }}><b>{prev.holidays.length}</b> holiday{prev.holidays.length === 1 ? "" : "s"} found for {prev.years.join(", ") || "no year"}: {prev.counts.new} new, {prev.counts.changed} updated, {prev.counts.same} unchanged.</p>
          {prev.errors.length > 0 && (
            <div role="alert" className="rounded-field bg-warn-soft px-3.5 py-2.5 text-[14px] text-warn"><b>{prev.errors.length} row{prev.errors.length === 1 ? "" : "s"} will not be saved.</b> Please correct {prev.errors.length === 1 ? "it" : "them"} in the sheet and upload again if they matter.
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{prev.errors.slice(0, 8).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}{prev.errors.length > 8 && <li>and {prev.errors.length - 8} more.</li>}</ul></div>)}
          {prev.holidays.length > 0 && (
            <div className="tbl-wrap" style={{ maxHeight: 320, overflow: "auto" }}><table>
              <thead><tr><th>Date</th><th>Holiday</th><th>Type</th><th>What happens</th></tr></thead>
              <tbody>{prev.holidays.map((h) => { const [label, tone] = STATUS[h.status]; return (
                <tr key={h.day}><td>{dateText(h.day)}</td><td><b>{h.name}</b></td><td>{h.type || "—"}</td>
                  <td><Pill tone={tone}>{label}</Pill>{h.status === "changed" && <span className="muted"> was “{h.was.name}”</span>}</td></tr>); })}</tbody>
            </table></div>)}
          <p className="muted" style={{ margin: 0 }}>Holidays that are not in the sheet stay as they are. A holiday already on the list for the same date takes the name and type from the sheet.</p>
        </>}
      </div>
      <div className="modal-f">
        <button type="button" className="btn glass" disabled={!!busy} onClick={onClose}>Cancel</button>
        {prev && <button type="button" className="btn glass" disabled={!!busy} onClick={() => { setPrev(null); setError(""); }}>Choose another file</button>}
        {prev && <button type="button" className="btn primary" disabled={!!busy || !todo.length} onClick={save}>{busy === "save" ? "Saving…" : todo.length ? `Save ${todo.length} holiday${todo.length === 1 ? "" : "s"}` : "Nothing to save"}</button>}
      </div>
    </Modal>
  );
}
