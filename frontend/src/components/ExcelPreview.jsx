import { useState } from "react";
import { api, apiMsg } from "../api.js";
import Modal from "./Modal.jsx";
import { CardSkeleton } from "./ui.jsx";

/* "Preview and download" for an Excel export. The button opens a window that shows the file as it will be (every sheet, its headings and its first rows, read back from the
   file the server builds), and the Download button in the window saves the same file. `url` is the export's address; the preview asks for it with ?preview=1 and the
   download is the address itself. Nothing is saved or sent until the person presses Download. */
export default function ExcelPreview({ url, title, label = "Preview and download", className = "btn glass sm" }) {
  const [open, setOpen] = useState(false), [data, setData] = useState(null), [problem, setProblem] = useState(""), [tab, setTab] = useState(0);
  const join = url.includes("?") ? "&" : "?";
  const show = async () => {
    setOpen(true); setData(null); setProblem(""); setTab(0);
    const r = await api("GET", `${url}${join}preview=1`);
    if (r.ok) setData(r.data); else setProblem(apiMsg(r));
  };
  const sheet = data && data.sheets[Math.min(tab, data.sheets.length - 1)];
  return (
    <>
      <button type="button" className={className} onClick={show}>{label}</button>
      {open && (
        <Modal wide onClose={() => setOpen(false)}>
          <div className="card-h"><h3>{title || "Preview"}</h3></div>
          <div className="card-b">
            {problem ? <div className="ferr" role="alert">{problem}</div> : !data ? <CardSkeleton lines={6} /> : <>
              {data.sheets.length > 1 && <div className="flex flex-wrap gap-2" role="tablist" aria-label="Sheets in this file">
                {data.sheets.map((s, i) => <button key={s.name} type="button" role="tab" aria-selected={i === tab} onClick={() => setTab(i)}
                  className={`btn sm ${i === tab ? "primary" : "glass"}`}>{s.name}</button>)}
              </div>}
              {sheet && <>
                <div className="text-sm text-ink-dim">{sheet.note}{sheet.total > sheet.rows.length ? ` Showing the first ${sheet.rows.length} of ${sheet.total} rows here; the file has all of them.` : ` ${sheet.total} row${sheet.total === 1 ? "" : "s"}.`}</div>
                <div className="max-h-[55vh] overflow-auto rounded-field border border-line">
                  <table className="w-max min-w-full border-collapse text-sm">
                    <thead><tr>{sheet.columns.map((c, i) => <th key={i} scope="col" className="sticky top-0 whitespace-nowrap border-b border-line bg-tint px-3 py-2 text-left font-bold text-ink">{c}</th>)}</tr></thead>
                    <tbody>{sheet.rows.length ? sheet.rows.map((r, i) => <tr key={i} className="odd:bg-surface">{r.map((c, j) => <td key={j} className="whitespace-nowrap border-b border-line px-3 py-2 text-ink">{c}</td>)}</tr>)
                      : <tr><td className="px-3 py-6 text-center text-ink-dim" colSpan={Math.max(1, sheet.columns.length)}>Nothing to show.</td></tr>}</tbody>
                  </table>
                </div>
              </>}
            </>}
          </div>
          <div className="modal-f">
            <button type="button" className="btn glass" onClick={() => setOpen(false)}>Close</button>
            {data && <a className="btn primary" href={url} download onClick={() => setOpen(false)}>Download Excel</a>}
          </div>
        </Modal>
      )}
    </>
  );
}
