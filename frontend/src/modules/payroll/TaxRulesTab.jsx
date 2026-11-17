import { useCallback, useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { money, when } from "./util.jsx";

const nextFy = (fy) => { const y = Number(fy.slice(0, 4)) + 1; return `${y}-${String((y + 1) % 100).padStart(2, "0")}`; };
const n = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

/* Edits one financial year and regime: slabs, standard deduction, 87A rebate, surcharge, cess, deduction caps. */
function RulesModal({ row, onClose }) {
  const toast = useToast();
  const r = row.rules;
  const [f, setF] = useState({
    standardDeduction: r.standardDeduction, cessRate: r.cessRate, slabs: r.slabs.map((s) => ({ upTo: s.upTo ?? "", rate: s.rate })),
    rebateMax: r.rebate ? r.rebate.maxIncome : "", rebateAmt: r.rebate ? r.rebate.maxRebate : "", marginal: !!(r.rebate && r.rebate.marginalRelief),
    surcharge: (r.surcharge || []).map((s) => ({ above: s.above, rate: s.rate })), caps: { ...(r.caps || {}) }, source: "",
  });
  const [busy, setBusy] = useState(false);
  const setSlab = (i, k, v) => setF({ ...f, slabs: f.slabs.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });
  const setSur = (i, k, v) => setF({ ...f, surcharge: f.surcharge.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });
  const save = async (e) => {
    e.preventDefault();
    const rules = { ...r, standardDeduction: n(f.standardDeduction) ?? 0, cessRate: n(f.cessRate) ?? 0,
      slabs: f.slabs.map((s, i) => ({ upTo: i === f.slabs.length - 1 ? null : n(s.upTo), rate: n(s.rate) })),
      rebate: f.rebateMax === "" ? null : { maxIncome: n(f.rebateMax), maxRebate: n(f.rebateAmt) ?? 0, marginalRelief: f.marginal },
      surcharge: f.surcharge.filter((s) => s.above !== "").map((s) => ({ above: n(s.above), rate: n(s.rate) })),
      caps: Object.fromEntries(Object.entries(f.caps).map(([k, v]) => [k, n(v)]).filter(([, v]) => v !== null)) };
    setBusy(true);
    const res = await api("PUT", `/api/payroll/tax-rules/${row.fy}/${row.regime}`, { rules, source: f.source });
    setBusy(false);
    if (!res.ok) return toast(apiMsg(res));
    toast(`Tax rules for FY ${row.fy} (${row.regime} regime) saved. Recalculate any open payroll to apply them.`); onClose(true);
  };
  return (
    <Modal wide onClose={() => onClose()}><form onSubmit={save} noValidate>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>{row.copy ? "New: " : ""}FY {row.fy} · {row.regime === "new" ? "New regime" : "Old regime"}</h3></div>
      <div className="card-b form">
        <Callout>Have your CA confirm these against the Finance Act for the year before the first payroll of the year. Every change is kept in the audit log.</Callout>
        <div className="sal-grid">
          <Field id="tr-std" label="Standard deduction (₹)"><input className="input" id="tr-std" type="number" min="0" value={f.standardDeduction} onChange={(e) => setF({ ...f, standardDeduction: e.target.value })} /></Field>
          <Field id="tr-cess" label="Health & education cess (%)"><input className="input" id="tr-cess" type="number" min="0" step="0.1" value={f.cessRate} onChange={(e) => setF({ ...f, cessRate: e.target.value })} /></Field>
        </div>
        <h4 className="lv-h" style={{ margin: "6px 0 8px" }}>Slabs</h4>
        <div className="sal-lines">{f.slabs.map((s, i) => (
          <div className="sal-line" key={i}>
            {i === f.slabs.length - 1 ? <span className="muted">Above {money(f.slabs[i - 1] ? f.slabs[i - 1].upTo : 0)}</span>
              : <input className="input" type="number" min="0" aria-label={`Slab ${i + 1} up to`} placeholder="Up to ₹" value={s.upTo} onChange={(e) => setSlab(i, "upTo", e.target.value)} />}
            <input className="input" type="number" min="0" max="100" step="0.1" aria-label={`Slab ${i + 1} rate`} placeholder="Rate %" value={s.rate} onChange={(e) => setSlab(i, "rate", e.target.value)} />
            <button type="button" className="btn glass sm" aria-label="Remove slab" disabled={f.slabs.length < 2} onClick={() => setF({ ...f, slabs: f.slabs.filter((_, j) => j !== i) })}>×</button>
          </div>))}
          <div><button type="button" className="btn link" onClick={() => setF({ ...f, slabs: [...f.slabs.slice(0, -1), { upTo: "", rate: "" }, f.slabs[f.slabs.length - 1]] })}>+ Add a slab</button></div></div>
        <h4 className="lv-h" style={{ margin: "12px 0 8px" }}>Rebate under 87A</h4>
        <div className="sal-grid">
          <Field id="tr-rbm" label="Taxable income up to (₹)" hint="Empty = no rebate."><input className="input" id="tr-rbm" type="number" min="0" value={f.rebateMax} onChange={(e) => setF({ ...f, rebateMax: e.target.value })} /></Field>
          <Field id="tr-rba" label="Rebate up to (₹)"><input className="input" id="tr-rba" type="number" min="0" value={f.rebateAmt} onChange={(e) => setF({ ...f, rebateAmt: e.target.value })} /></Field>
        </div>
        <label className="check" style={{ padding: 0 }}><input type="checkbox" checked={f.marginal} onChange={(e) => setF({ ...f, marginal: e.target.checked })} /> Marginal relief just above the rebate limit</label>
        <h4 className="lv-h" style={{ margin: "12px 0 8px" }}>Surcharge</h4>
        <div className="sal-lines">{f.surcharge.map((s, i) => (
          <div className="sal-line" key={i}>
            <input className="input" type="number" min="0" aria-label="Income above" placeholder="Income above ₹" value={s.above} onChange={(e) => setSur(i, "above", e.target.value)} />
            <input className="input" type="number" min="0" max="100" aria-label="Surcharge rate" placeholder="Rate %" value={s.rate} onChange={(e) => setSur(i, "rate", e.target.value)} />
            <button type="button" className="btn glass sm" aria-label="Remove surcharge band" onClick={() => setF({ ...f, surcharge: f.surcharge.filter((_, j) => j !== i) })}>×</button>
          </div>))}
          <div><button type="button" className="btn link" onClick={() => setF({ ...f, surcharge: [...f.surcharge, { above: "", rate: "" }] })}>+ Add a band</button></div></div>
        {Object.keys(f.caps).length > 0 && <><h4 className="lv-h" style={{ margin: "12px 0 8px" }}>Deduction caps (₹ a year)</h4>
          <div className="sal-grid">{Object.keys(f.caps).map((k) => <Field key={k} id={`tr-c-${k}`} label={k}><input className="input" id={`tr-c-${k}`} type="number" min="0" value={f.caps[k] ?? ""} onChange={(e) => setF({ ...f, caps: { ...f.caps, [k]: e.target.value } })} /></Field>)}</div></>}
        <Field id="tr-src" label="Source of this change (required)" hint="e.g. Finance Act 2026, or the CA's note of 2 April 2026."><input className="input" id="tr-src" maxLength={200} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose()}>Cancel</button><button type="submit" className="btn primary" disabled={busy || f.source.trim().length < 3}>{busy ? "Saving…" : "Save rules"}</button></div>
    </form></Modal>
  );
}

/* HR uploads the CA's tax-rules sheet (Excel or CSV). The page shows what would change; nothing is saved until HR confirms. */
function UploadModal({ onClose }) {
  const toast = useToast();
  const [file, setFile] = useState(null);       // { name }
  const [out, setOut] = useState(null);         // { sets, errors }
  const [err, setErr] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const pick = async (f) => {
    setErr(""); setOut(null); setFile(null);
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return setErr("The file is larger than 2 MB.");
    setBusy(true);
    const r = await fetch("/api/payroll/tax-rules/import", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: f });
    const data = await r.json().catch(() => null);
    setBusy(false);
    if (r.status === 401) { location.href = "/login"; return; }
    if (!r.ok) return setErr((data && data.error) || "The file could not be read.");
    setFile({ name: f.name }); setOut(data); setSource(`Uploaded sheet: ${f.name}`);
  };
  const bad = out && (out.errors.length > 0 || out.sets.some((x) => x.problems.length));
  const changed = out ? out.sets.filter((x) => x.isNew || x.changes.length) : [];
  const save = async () => {
    setBusy(true);
    for (const x of changed) {
      const r = await api("PUT", `/api/payroll/tax-rules/${x.fy}/${x.regime}`, { rules: x.rules, source });
      if (!r.ok) { setBusy(false); return toast(`FY ${x.fy} ${x.regime}: ${apiMsg(r)}`); }
    }
    setBusy(false);
    toast(`Saved ${changed.length} rule set${changed.length === 1 ? "" : "s"}. Recalculate any open payroll to apply them.`); onClose(true);
  };
  return (
    <Modal wide onClose={() => onClose()}>
      <div className="card-h" style={{ paddingTop: 24 }}><h3>Upload tax rules</h3></div>
      <div className="card-b form">
        <Callout>Download the template, have your CA fill it in, then upload it here. You see what would change first, and nothing is saved until you confirm.</Callout>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <a className="btn glass sm" href="/api/payroll/tax-rules/template" download>Download template (Excel)</a>
          <a className="btn glass sm" href="/api/payroll/tax-rules/template?format=csv" download>Download template (CSV)</a>
          <label className="btn primary sm" style={{ cursor: "pointer" }}>{busy && !out ? "Reading…" : file ? "Choose another file" : "Choose the filled file"}
            <input type="file" hidden accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { pick(e.target.files[0]); e.target.value = ""; }} /></label>
        </div>
        {err && <div className="ferr" role="alert">{err}</div>}
        {out && <>
          {out.errors.length > 0 && <div className="callout"><div><b>Fix these in the sheet and upload it again</b>
            <ul style={{ margin: "6px 0 0 18px" }}>{out.errors.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}{out.errors.length > 12 && <li>…and {out.errors.length - 12} more</li>}</ul></div></div>}
          {out.sets.map((x) => (
            <div key={`${x.fy}-${x.regime}`} className="card" style={{ padding: "14px 18px" }}>
              <b>FY {x.fy} · {x.regime === "new" ? "New regime" : "Old regime"}</b> <span className="muted">{x.isNew ? (x.copiedFrom ? `new, starting from FY ${x.copiedFrom}` : "new") : x.changes.length ? "changed" : "no change"}</span>
              {x.problems.length > 0 && <ul style={{ margin: "6px 0 0 18px", color: "var(--bad)" }}>{x.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
              {!x.problems.length && x.changes.length > 0 && <ul style={{ margin: "6px 0 0 18px" }}>{x.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
            </div>))}
          {!bad && changed.length === 0 && <div className="muted">The sheet matches the rules already saved. There is nothing to change.</div>}
          {!bad && changed.length > 0 && <Field id="ur-src" label="Source of this change (required)" hint="e.g. the CA's sheet of 2 April 2026."><input className="input" id="ur-src" maxLength={200} value={source} onChange={(e) => setSource(e.target.value)} /></Field>}
        </>}
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose()}>Cancel</button>
        <button type="button" className="btn primary" disabled={busy || !out || bad || !changed.length || source.trim().length < 3} onClick={save}>{busy && out ? "Saving…" : `Save ${changed.length || ""} rule set${changed.length === 1 ? "" : "s"}`}</button></div>
    </Modal>
  );
}

export default function TaxRulesTab() {
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const [upload, setUpload] = useState(false);
  const load = useCallback(async () => { const r = await api("GET", "/api/payroll/tax-rules"); setRows(r.ok ? r.data : []); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="card">
      <div className="card-h"><div><h3>Income-tax rules by financial year</h3><div className="muted">TDS is calculated from the row for the payroll month's financial year and the employee's regime. A year with no row can't be calculated.</div></div><button type="button" className="btn primary sm" onClick={() => setUpload(true)}>Upload rules</button></div>
      <div className="tbl-wrap"><table><thead><tr><th>Year</th><th>Regime</th><th>Slabs</th><th className="num">Std. deduction</th><th>87A rebate</th><th>Source</th><th /></tr></thead><tbody>
        {rows && rows.length ? rows.map((r) => (
          <tr key={`${r.fy}-${r.regime}`}><td><b>FY {r.fy}</b></td><td>{r.regime === "new" ? "New" : "Old"}</td>
            <td style={{ fontSize: 13 }}>{r.rules.slabs.map((s, i, a) => `${s.rate}% ${s.upTo == null ? `above ${money(a[i - 1] ? a[i - 1].upTo : 0)}` : `to ${money(s.upTo)}`}`).join(" · ")}</td>
            <td className="num">{money(r.rules.standardDeduction)}</td><td>{r.rules.rebate ? `${money(r.rules.rebate.maxRebate)} up to ${money(r.rules.rebate.maxIncome)}` : "—"}</td>
            <td>{r.source}<div className="muted">{r.updatedBy} · {when(r.updatedAt)}</div></td>
            <td className="num"><div className="row" style={{ gap: 6, justifyContent: "flex-end" }}><button type="button" className="btn glass sm" onClick={() => setEdit(r)}>Edit</button>
              {!rows.some((x) => x.fy === nextFy(r.fy) && x.regime === r.regime) && <button type="button" className="btn glass sm" onClick={() => setEdit({ ...r, fy: nextFy(r.fy), copy: true })}>Copy to FY {nextFy(r.fy)}</button>}</div></td></tr>))
          : <tr><td colSpan={7}><div className="empty">{rows ? "No tax rules." : "Loading…"}</div></td></tr>}
      </tbody></table></div>
      {upload && <UploadModal onClose={(saved) => { setUpload(false); if (saved) load(); }} />}
      {edit && <RulesModal row={edit} onClose={(saved) => { setEdit(null); if (saved) load(); }} />}
    </div>
  );
}
