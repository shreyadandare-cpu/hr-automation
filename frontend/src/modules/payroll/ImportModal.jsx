import { useState } from "react";
import { api, apiMsg } from "../../api.js";
import Modal from "../../components/Modal.jsx";
import { Callout } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";

/* The columns HR's sheet should have. Any other column with an amount is read as an earning named by its header;
   a column named "Deduction: <name>" is another deduction. backend/src/payroll-calc.js structureFromRow reads them. */
const HEADERS = ["Email", "Employee Name", "Applies From", "Basic", "HRA", "Medical Allowance", "Conveyance Allowance", "Special Allowance",
  "Statutory Bonus", "PF Employee", "Professional Tax", "Monthly TDS", "PF Number"];

/** CSV text as rows of cells. Handles quoted cells with commas, quotes ("") and line breaks, as Excel and Google Sheets save them. */
function parseCsv(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

function template() {
  const blob = new Blob([HEADERS.join(",") + "\n"], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "salary-breakdowns.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* HR uploads everyone's salary breakdown at once. Nothing is saved unless every row is correct. */
export default function ImportModal({ onClose }) {
  const toast = useToast();
  const [file, setFile] = useState(null);   // { name, rows: [{header: value}] }
  const [err, setErr] = useState("");
  const [problems, setProblems] = useState([]);
  const [busy, setBusy] = useState(false);

  const pick = async (f) => {
    setErr(""); setProblems([]); setFile(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) return setErr("Choose a .csv file. In Excel or Google Sheets, save or download the sheet as CSV first.");
    const cells = parseCsv((await f.text()).replace(/^﻿/, ""));
    if (cells.length < 2) return setErr("The file needs a header row and at least one person.");
    const [head, ...body] = cells;
    if (!head.some((h) => /e-?mail/i.test(h))) return setErr("The header row needs an Email column.");
    setFile({ name: f.name, rows: body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || "").trim()]))) });
  };

  const upload = async () => {
    setBusy(true); setErr(""); setProblems([]);
    const r = await api("POST", "/api/payroll/structures/import", { rows: file.rows });
    setBusy(false);
    if (!r.ok) { setErr(apiMsg(r)); setProblems((r.data && r.data.problems) || []); return; }
    toast(`Salary breakdowns saved for ${r.data.saved} ${r.data.saved === 1 ? "person" : "people"}.`);
    onClose(true);
  };

  return (
    <Modal onClose={() => onClose(false)}>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Upload salary breakdowns</h3></div>
      <div className="card-b">
        <p className="muted" style={{ marginTop: 0 }}>One row per person. <b>Applies From</b> is the first month the salary counts for (for example 2026-11).
          Every other column with an amount is an earning; name a column <b>Deduction: Canteen</b> for another deduction. Fill <b>Monthly TDS</b> for anyone above ₹12,00,000 a year.</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <button type="button" className="btn glass sm" onClick={template}>Download the template</button>
        </div>
        <label className="lv-fsel" style={{ display: "block" }}><span>CSV file</span>
          <input className="input" type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files[0])} /></label>
        {file && <div className="muted" style={{ marginTop: 8 }}>{file.name}: {file.rows.length} {file.rows.length === 1 ? "person" : "people"} found.</div>}
        {err && <div style={{ marginTop: 12 }}><Callout>{err}</Callout></div>}
        {problems.length > 0 && (
          <div className="tbl-wrap" style={{ marginTop: 8, maxHeight: 240, overflow: "auto" }}><table><thead><tr><th>Row</th><th>Email</th><th>Problem</th></tr></thead><tbody>
            {problems.map((p, i) => <tr key={i}><td>{p.row}</td><td>{p.email || "—"}</td><td>{p.error}</td></tr>)}
          </tbody></table></div>)}
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose(false)}>Cancel</button>
        <button type="button" className="btn primary" disabled={!file || busy} onClick={upload}>{busy ? "Saving…" : "Save breakdowns"}</button></div>
    </Modal>
  );
}
