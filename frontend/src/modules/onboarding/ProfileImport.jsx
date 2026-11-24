import { useState } from "react";
import { useData } from "../../data.jsx";
import Modal from "../../components/Modal.jsx";
import { Callout, Pill } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";

const ACCEPT = ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
const STATUS = { ok: ["Ready", "ok"], error: ["Has a problem", "bad"], nothing: ["Nothing to add", "mute"] };
const dateText = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const BANK = { payroll: "The bank account goes to payroll too (encrypted).", profile: "Only the masked bank account goes on the profile. Payroll needs someone with the bank permission.", incomplete: "Add the account holder name and bank name to add it to payroll too." };

/* HR: fill in the employee details for many people at once. Download the sheet (blank, or with the people who still lack details already listed), fill it in, choose
   the file, check the preview, then add the details to the profiles. Aadhaar, PAN and the bank account are shown masked, here and on the profile. The file is sent to
   the server twice (to check, then to save) and is never kept. */
export default function ProfileImport({ onClose, base = "/api/onboarding/import", bank = false }) {
  const toast = useToast(), { reload } = useData();
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [file, setFile] = useState(null), [prev, setPrev] = useState(null), [done, setDone] = useState(null);
  const send = async (path, f) => {
    let r;
    try { r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: f }); }
    catch { return { error: "The file could not be sent. Please check your connection and try again." }; }
    if (r.status === 401) { location.href = "/login"; return {}; }
    const body = await r.json().catch(() => ({}));
    return r.ok ? { body } : { error: body.error || "The file could not be read. Please try again." };
  };
  const read = async (f) => {
    if (!f) return;
    setBusy("read"); setError(""); setFile(f);
    const { body, error: err } = await send(base, f);
    setBusy("");
    if (err) return setError(err);
    setPrev(body);
  };
  const save = async () => {
    setBusy("save"); setError("");
    const { body, error: err } = await send(`${base}/apply`, file);
    setBusy("");
    if (err) return setError(err);
    toast(`Details added to ${body.saved} profile${body.saved === 1 ? "" : "s"}.`);
    reload();
    setDone(body);
  };
  const ready = prev ? prev.rows.filter((x) => x.status === "ok") : [];
  return (
    <Modal wide onClose={() => { if (!busy) onClose(!!done); }}>
      <div className="card-h"><h3>{bank ? "Upload bank details from Excel" : "Fill in employee details from Excel"}</h3></div>
      <div className="card-b">
        {error && <Callout>{error}</Callout>}
        {done ? <>
          <p style={{ margin: 0 }}><b>{done.saved}</b> profile{done.saved === 1 ? "" : "s"} updated{done.bankAdded ? `, ${done.bankAdded} bank account${done.bankAdded === 1 ? "" : "s"} added to payroll` : ""}.{done.nothing ? ` ${done.nothing} row${done.nothing === 1 ? " had" : "s had"} nothing to add.` : ""}</p>
          {done.notes.length > 0 && <Callout><b>Please note:</b><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{done.notes.map((n, i) => <li key={i}>Row {n.row}, {n.name}: {n.message}</li>)}</ul></Callout>}
          {done.skipped.length > 0 && <Callout><b>{done.skipped.length} row{done.skipped.length === 1 ? " was" : "s were"} not saved.</b> Correct {done.skipped.length === 1 ? "it" : "them"} in the sheet and upload again.
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{done.skipped.slice(0, 8).map((s, i) => <li key={i}>Row {s.row}: {s.problems.join(" ")}</li>)}{done.skipped.length > 8 && <li>and {done.skipped.length - 8} more.</li>}</ul></Callout>}
          <p className="muted" style={{ margin: 0 }}>The details are on each person's profile, under Onboarding record. The file you uploaded was not kept: delete your copy, because it holds personal numbers.</p>
        </> : !prev ? <>
          <p className="muted" style={{ margin: 0 }}>{bank ? "Download the sheet (everyone who works here is already listed, and new joiners appear in it automatically), fill in one row per person (account holder, bank name, account number, IFSC, PAN and PF/UAN number), upload it and each person's bank account is filled in below." : "Download the sheet (everyone who works here is already listed, and new joiners appear in it automatically), fill in one row per person (Aadhaar, PAN, bank account, IFSC, date of birth and so on), upload it and the details are added to each person's profile."} A blank cell leaves what is already saved as it is.</p>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <a className="btn glass" download href={`${base}/template`}>Download the sheet with everyone's name</a>
          </div>
          <div className="field"><span className="lab">Your filled-in sheet</span>
            <label className="btn primary" style={{ cursor: "pointer", justifySelf: "start" }}>{busy === "read" ? "Reading…" : "Choose the Excel file"}
              <input type="file" hidden accept={ACCEPT} disabled={busy === "read"} onChange={(e) => { read(e.target.files[0]); e.target.value = ""; }} /></label>
            <span className="hint">Excel (.xlsx) or CSV, up to 2 MB. Nothing is saved until you confirm.</span></div>
        </> : <>
          <p style={{ margin: 0 }}><b>{prev.counts.ready}</b> ready to add{prev.counts.problems ? `, ${prev.counts.problems} with a problem (not saved)` : ""}{prev.counts.nothing ? `, ${prev.counts.nothing} with nothing to add` : ""}.</p>
          {prev.errors.length > 0 && <Callout><b>{prev.errors.length} problem{prev.errors.length === 1 ? "" : "s"} with the sheet:</b><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{prev.errors.slice(0, 6).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul></Callout>}
          {prev.rows.length > 0 && (
            <div className="tbl-wrap" style={{ maxHeight: 380, overflow: "auto" }}><table>
              <thead><tr><th>Row</th><th>Employee</th><th>What is added</th><th>Status</th></tr></thead>
              <tbody>{prev.rows.map((x) => { const [label, tone] = STATUS[x.status]; return (
                <tr key={x.row}><td>{x.row}</td>
                  <td><b>{x.name || "Not found"}</b>{x.empNo ? <div className="muted">{x.empNo}</div> : null}</td>
                  <td style={{ whiteSpace: "normal" }}>{x.adds.length ? x.adds.map((a) => (
                    <div key={a.key}><span className="muted">{a.label}:</span> {a.key === "dob" ? dateText(a.value) : a.value}{a.status === "replaces" && <span className="muted"> (replaces the saved one)</span>}{a.status === "same" && <span className="muted"> (already saved)</span>}</div>)) : <span className="muted">—</span>}
                    {x.bank && <div className="muted" style={{ marginTop: 4 }}>{BANK[x.bank]}</div>}
                    {x.ignored && x.ignored.length > 0 && <div className="muted" style={{ marginTop: 4 }}>Not saved here: {x.ignored.join(", ")}.</div>}</td>
                  <td style={{ whiteSpace: "normal" }}><Pill tone={tone}>{label}</Pill>{x.problems.map((p, i) => <div key={i} className="muted" style={{ color: "var(--bad)" }}>{p}</div>)}</td></tr>); })}</tbody>
            </table></div>)}
          <p className="muted" style={{ margin: 0 }}>Aadhaar, PAN and the bank account are saved masked (only the last digits stay readable). People not in the sheet, and cells left blank, stay as they are.</p>
        </>}
      </div>
      <div className="modal-f">
        <button type="button" className="btn glass" disabled={!!busy} onClick={() => onClose(!!done)}>{done ? "Close" : "Cancel"}</button>
        {prev && !done && <button type="button" className="btn glass" disabled={!!busy} onClick={() => { setPrev(null); setFile(null); setError(""); }}>Choose another file</button>}
        {prev && !done && <button type="button" className="btn primary" disabled={!!busy || !ready.length} onClick={save}>{busy === "save" ? "Saving…" : ready.length ? `Add details to ${ready.length} profile${ready.length === 1 ? "" : "s"}` : "Nothing to save"}</button>}
      </div>
    </Modal>
  );
}
