import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiMsg } from "../../api.js";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout, Pill, CardSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { when } from "./util.jsx";

const API = "/api/payroll/master";
const ACCEPT = ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
const FIELD = { bankName: "Bank name", holder: "Account holder name", account: "Account number", ifsc: "IFSC code", branch: "Branch name", aadhaar: "Aadhaar number", pan: "PAN number" };
const SECRET = ["account", "aadhaar", "pan"];
const STATUS_TONE = { Active: "ok", Onboarding: "info", Inactive: "mute" };
const SAVED = { bankName: "bankName", holder: "holder", account: "account", ifsc: "ifsc", branch: "branch", aadhaar: "aadhaar", pan: "pan" };

/* A full number is fetched only when HR asks for it (the server writes that to the audit trail) and is dropped from the page after 20 seconds. It is kept in memory only. */
function RevealModal({ person, onClose }) {
  const [vals, setVals] = useState(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const out = {};
      for (const f of SECRET) { const r = await api("POST", `${API}/${encodeURIComponent(person.email)}/reveal`, { field: f }); out[f] = r.ok ? r.data.value : apiMsg(r); }
      if (live) setVals(out);
    })();
    const t = setTimeout(onClose, 20000);
    return () => { live = false; clearTimeout(t); };
  }, [person.email]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal onClose={onClose}>
      <div className="card-h"><h3>Full numbers: {person.name}</h3></div>
      <div className="card-b">
        {!vals ? <CardSkeleton lines={3} /> : SECRET.map((f) => <div key={f} className="field"><span className="lab">{FIELD[f]}</span><div style={{ fontFamily: "var(--font-mono, monospace)", userSelect: "all" }}>{vals[f]}</div></div>)}
        <p className="muted" style={{ margin: 0 }}>Viewing these is recorded in the audit log. This closes by itself after 20 seconds.</p>
      </div>
      <div className="modal-f"><button type="button" className="btn primary" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

/* One employee's bank and identity details. Used under the table and in the Bank button on Salary & bank. Everything shows what is saved (masked numbers); leave a number box blank to keep it. */
export function MasterForm({ email, onSaved }) {
  const toast = useToast();
  const [data, setData] = useState(null), [f, setF] = useState({}), [er, setEr] = useState({}), [busy, setBusy] = useState(false), [reveal, setReveal] = useState(false);
  const load = useCallback(async () => {
    const r = await api("GET", `${API}/${encodeURIComponent(email)}`);
    if (!r.ok) { toast(apiMsg(r)); return; }
    setData(r.data); const p = r.data.person;
    setF({ bankName: p.bankName, holder: p.holder || p.name, ifsc: p.ifsc, branch: p.branch, account: "", accountConfirm: "", aadhaar: "", pan: "" }); setEr({});
  }, [email]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setData(null); load(); }, [load]);
  if (!data) return <CardSkeleton lines={5} />;
  const p = data.person, set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    if (f.account && f.account.replace(/\D/g, "") !== f.accountConfirm.replace(/\D/g, "")) return setEr({ accountConfirm: "The two account numbers don't match." });
    const body = {};
    for (const k of Object.keys(FIELD)) if (String(f[k] || "").trim() && String(f[k]).trim() !== String(p[k] || "").trim()) body[k] = f[k];
    if (!Object.keys(body).length) return toast("Nothing has changed.");
    setBusy(true);
    const r = await api("PATCH", `${API}/${encodeURIComponent(email)}`, body);
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors) || {}); toast(apiMsg(r)); return; }
    toast(`Saved for ${p.name}.`); await load(); if (onSaved) onSaved(r.data.person);
  };
  return (
    <form onSubmit={save} noValidate autoComplete="off" className="form">
      {!data.encryptionReady && <Callout>The server has no <code>PAYROLL_ENCRYPTION_KEY</code>, so these details can't be saved yet.</Callout>}
      <div className="muted"><b>{p.empNo || "No employee number"}</b> · {p.name} · {[p.department, p.designation].filter(Boolean).join(" · ") || "—"} · {p.status}{p.updatedAt ? ` · last updated ${when(p.updatedAt)}` : ""}</div>
      <div className="sal-grid">
        <Field id="mf-bank" label="Bank name" error={er.bankName}><input className="input" id="mf-bank" maxLength={80} value={f.bankName} onChange={set("bankName")} /></Field>
        <Field id="mf-holder" label="Account holder name" error={er.holder}><input className="input" id="mf-holder" maxLength={80} value={f.holder} onChange={set("holder")} /></Field>
        <Field id="mf-acct" label="Account number" error={er.account}><input className="input" id="mf-acct" inputMode="numeric" maxLength={18} value={f.account} placeholder={p.account || "9 to 18 digits"} onChange={set("account")} /></Field>
        <Field id="mf-acct2" label="Account number again" error={er.accountConfirm}><input className="input" id="mf-acct2" inputMode="numeric" maxLength={18} value={f.accountConfirm} placeholder={f.account ? "" : "Only to change it"} onChange={set("accountConfirm")} /></Field>
        <Field id="mf-ifsc" label="IFSC code" error={er.ifsc}><input className="input" id="mf-ifsc" maxLength={11} value={f.ifsc} onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} /></Field>
        <Field id="mf-branch" label="Branch name" error={er.branch}><input className="input" id="mf-branch" maxLength={80} value={f.branch} onChange={set("branch")} /></Field>
        <Field id="mf-aadhaar" label="Aadhaar number" error={er.aadhaar}><input className="input" id="mf-aadhaar" inputMode="numeric" maxLength={14} value={f.aadhaar} placeholder={p.aadhaar || "12 digits"} onChange={set("aadhaar")} /></Field>
        <Field id="mf-pan" label="PAN number" error={er.pan}><input className="input" id="mf-pan" maxLength={10} value={f.pan} placeholder={p.pan || "ABCDE1234F"} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} /></Field>
      </div>
      {p.partial && <Callout>The bank account is not complete yet. It reaches payroll once the bank name, account holder, account number and IFSC are all saved.</Callout>}
      <div className="muted">Stored encrypted. Screens show only the masked numbers. Leave an account number, Aadhaar or PAN box empty to keep what is saved.</div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="submit" className="btn primary" disabled={busy || !data.encryptionReady}>{busy ? "Saving…" : "Save changes"}</button>
        <button type="button" className="btn glass" onClick={() => setReveal(true)}>Show full numbers</button>
      </div>
      {reveal && <RevealModal person={p} onClose={() => setReveal(false)} />}
    </form>
  );
}

/* Choose the sheet, read the preview (nothing is saved), then confirm. The same file is sent again to save, and is never kept. */
export function BankUpload({ onClose }) {
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [file, setFile] = useState(null), [prev, setPrev] = useState(null), [done, setDone] = useState(null);
  const send = async (path, f) => {
    let r;
    try { r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: f }); } catch { return { error: "The file could not be sent. Please check your connection and try again." }; }
    if (r.status === 401) { location.href = "/login"; return {}; }
    const body = await r.json().catch(() => ({}));
    return r.ok ? { body } : { error: body.error || "The file could not be read. Please try again." };
  };
  const save = async (f = file) => { setBusy("save"); setError(""); const { body, error: e } = await send(`${API}/import/apply`, f); setBusy(""); if (e) return setError(e); setDone(body); };
  // The sheet is read and, when it only adds details (nothing saved is replaced), saved straight away. When it would replace something saved, the preview waits for a confirmation.
  const read = async (f) => {
    if (!f) return;
    setBusy("read"); setError(""); setFile(f);
    const { body, error: e } = await send(`${API}/import`, f);
    setBusy("");
    if (e) return setError(e);
    setPrev(body);
    if (body.counts.change > 0 && !body.rows.some((x) => x.changes.some((c) => c.state === "replaces"))) save(f);
  };
  const list = (title, rows, tone) => rows.length > 0 && (
    <Callout><b>{title} ({rows.length})</b><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{rows.slice(0, 12).map((x, i) => <li key={i}>Row {x.row}{x.empNo ? `, ${x.empNo}` : ""}{x.name ? ` ${x.name}` : ""}{x.reason ? `: ${x.reason}` : ""}</li>)}{rows.length > 12 && <li>and {rows.length - 12} more.</li>}</ul></Callout>);
  return (
    <Modal wide onClose={() => { if (!busy) onClose(!!done); }}>
      <div className="card-h"><h3>Upload bank details</h3></div>
      <div className="card-b">
        {error && <Callout>{error}</Callout>}
        {done ? <>
          <p style={{ margin: 0 }}><b>{done.saved.length}</b> saved, <b>{done.failed.length}</b> failed, <b>{done.skipped.length}</b> skipped.</p>
          {list("Failed", done.failed)}{list("Skipped (nothing new)", done.skipped)}
          <p className="muted" style={{ margin: 0 }}>The bank details are saved for each person and show under Bank on this page. The file was not kept: please delete your copy, because it holds account numbers.</p>
        </> : !prev ? <>
          <p className="muted" style={{ margin: 0 }}>Download the sheet: it lists every employee with what is saved so far. Open it in Excel, fill in or correct the bank details (No., Account Holder Name, Bank Name, Account Number, IFSC Code, Branch Name), save it and upload it here. Nobody is added twice, someone missing from the sheet is left as they are, and blank cells change nothing.</p>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}><a className="btn glass" download href={`${API}/export`}>Download the sheet</a></div>
          <div className="field"><span className="lab">Your sheet</span>
            <label className="btn primary" style={{ cursor: "pointer", justifySelf: "start" }}>{busy === "read" ? "Reading…" : "Choose the Excel file"}
              <input type="file" hidden accept={ACCEPT} disabled={busy === "read"} onChange={(e) => { read(e.target.files[0]); e.target.value = ""; }} /></label>
            <span className="hint">Excel (.xlsx) or CSV, up to 4 MB. The details are saved as soon as the file is read. If a row would replace something already saved, you are asked first.</span></div>
        </> : <>
          <p style={{ margin: 0 }}><b>{prev.counts.change}</b> will be saved{prev.counts.failed ? `, ${prev.counts.failed} cannot be saved` : ""}{prev.counts.skipped ? `, ${prev.counts.skipped} have nothing new` : ""}.</p>
          {prev.ignored.length > 0 && <div className="muted">Read-only columns in the sheet are ignored: {prev.ignored.join(", ")}.</div>}
          {!prev.encryptionReady && <Callout>The server's encryption key is not set, so saving will fail.</Callout>}
          <div className="tbl-wrap" style={{ maxHeight: 380, overflow: "auto" }}><table>
            <thead><tr><th>Row</th><th>Employee</th><th>What changes</th><th>Result</th></tr></thead>
            <tbody>{prev.rows.map((x) => (
              <tr key={x.row}><td>{x.row}</td><td><b>{x.name || "Not found"}</b><div className="muted">{x.empNo}</div></td>
                <td style={{ whiteSpace: "normal" }}>{x.changes.length ? x.changes.map((c) => <div key={c.key}><span className="muted">{c.label}:</span> {c.value}{c.state === "replaces" && <span className="muted"> (replaces the saved one)</span>}{c.state === "same" && <span className="muted"> (already saved)</span>}</div>) : <span className="muted">—</span>}</td>
                <td style={{ whiteSpace: "normal" }}>{x.status === "change" ? <Pill tone="ok">Will save</Pill> : x.status === "failed" ? <Pill tone="bad">Cannot save</Pill> : <Pill tone="mute">Skipped</Pill>}
                  {x.problems.map((m, i) => <div key={i} className="muted" style={{ color: "var(--bad)" }}>{m}</div>)}{x.why && <div className="muted">{x.why}</div>}</td></tr>))}</tbody>
          </table></div>
        </>}
      </div>
      <div className="modal-f">
        <button type="button" className="btn glass" disabled={!!busy} onClick={() => onClose(!!done)}>{done ? "Close" : "Cancel"}</button>
        {prev && !done && <button type="button" className="btn glass" disabled={!!busy} onClick={() => { setPrev(null); setFile(null); setError(""); }}>Choose another file</button>}
        {prev && !done && <button type="button" className="btn primary" disabled={!!busy || !prev.counts.change} onClick={() => save()}>{busy === "save" ? "Saving…" : prev.counts.change ? `Save ${prev.counts.change} change${prev.counts.change === 1 ? "" : "s"}` : "Nothing to save"}</button>}
      </div>
    </Modal>
  );
}

const COLS = [["holder", "Account Holder Name"], ["bankName", "Bank Name"], ["account", "Account Number"], ["ifsc", "IFSC Code"], ["branch", "Branch Name"]];
const CELL = "block w-full min-w-0 border-0 bg-transparent px-2.5 py-2 text-[14px] text-ink outline-none placeholder:text-ink-faint focus:bg-tint focus:outline-2 focus:-outline-offset-2 focus:outline-accent";

/* "View the sheet": HR's Bank Details Format as a sheet you type straight into. Every employee is a row. A cell saves by itself when you leave it (Enter or the arrow keys move
   to the next row), anything still unsaved is saved when you close the sheet, and what is saved is what payroll (the bank file) and the profiles use. A saved account number
   shows masked: type the full number to replace it. Download as Excel and Upload Excel are there for bulk work. */
export function BankSheetView({ onClose }) {
  const [people, setPeople] = useState(null), [err, setErr] = useState(""), [enc, setEnc] = useState(true), [q, setQ] = useState(""), [draft, setDraft] = useState({}), [row, setRow] = useState({}), [upload, setUpload] = useState(false), [closing, setClosing] = useState(false);
  const live = useRef({ draft: {}, people: [] });
  live.current = { draft, people: people || [] };
  const load = useCallback(async () => {
    const all = [];
    for (let page = 1; page <= 10; page++) {
      const r = await api("GET", `${API}?status=active&sort=empNo&dir=asc&size=100&page=${page}`);
      if (!r.ok) { setErr(apiMsg(r)); return; }
      all.push(...r.data.people); setEnc(r.data.encryptionReady);
      if (all.length >= r.data.total) break;
    }
    setPeople(all); setDraft({});
  }, []);
  useEffect(() => { load(); }, [load]);
  const edit = (p, k, v) => setDraft((d) => ({ ...d, [p.email]: { ...(d[p.email] || {}), [k]: v } }));
  const save = async (p, body) => {
    setRow((s) => ({ ...s, [p.email]: { s: "saving", body } }));
    const r = await api("PATCH", `${API}/${encodeURIComponent(p.email)}`, body);
    if (!r.ok) { const errs = r.data && r.data.errors; setRow((s) => ({ ...s, [p.email]: { s: "error", body, msg: errs ? Object.values(errs) : [apiMsg(r)] } })); return false; }
    setPeople((x) => x.map((y) => (y.email === p.email ? r.data.person : y)));
    setDraft((d) => { const { [p.email]: _g, ...rest } = d; return rest; });
    setRow((s) => ({ ...s, [p.email]: { s: "saved" } }));
    return true;
  };
  const pending = (p) => { const d = live.current.draft[p.email], body = {}; if (d) for (const k of Object.keys(d)) if (String(d[k]).trim() && String(d[k]).trim() !== String(p[k] || "").trim()) body[k] = d[k]; return body; };
  const blur = (p) => { const body = pending(p); if (Object.keys(body).length) return save(p, body); setDraft((x) => { const { [p.email]: _g, ...rest } = x; return rest; }); return Promise.resolve(true); };
  const close = async () => {
    if (closing) return;
    setClosing(true);
    const results = await Promise.all(live.current.people.map((p) => (Object.keys(pending(p)).length ? save(p, pending(p)) : true)));
    if (results.includes(false)) { setClosing(false); return; }   // stay open: a row failed and says why
    onClose(true);
  };
  const move = (e, r, c) => {
    const step = e.key === "Enter" || e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    const next = e.currentTarget.closest("table").querySelector(`[data-cell="${r + step}-${c}"]`);
    if (next) { e.preventDefault(); next.focus(); next.select(); }
  };
  const s = q.trim().toLowerCase(), list = (people || []).filter((p) => !s || `${p.name} ${p.empNo}`.toLowerCase().includes(s));
  return (
    <Modal wide onClose={close}>
      <div className="card-h"><div><h3>Bank details sheet</h3><div className="muted">Click a cell and type. It saves when you leave the cell, and the details are used in payroll and on the profiles.</div></div>
        <input className="input" style={{ maxWidth: 240 }} type="search" placeholder="Search number or name" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="card-b">
        {err && <Callout>{err}</Callout>}
        {!enc && <Callout>The server has no <code>PAYROLL_ENCRYPTION_KEY</code>, so nothing can be saved yet.</Callout>}
        {!people && !err ? <CardSkeleton lines={6} /> : people && (
          <div className="max-h-[58vh] overflow-auto rounded-field border border-edge"><table className="w-full table-fixed border-collapse text-[14px]">
            <colgroup><col style={{ width: 84 }} /><col style={{ width: "17%" }} />{COLS.map(([k]) => <col key={k} />)}<col style={{ width: 120 }} /></colgroup>
            <thead className="sticky top-0 z-1 bg-tint"><tr>{["No.", "Employee", ...COLS.map((c) => c[1]), "Saved"].map((h) => <th key={h} className="border border-line px-2.5 py-2 text-left font-bold text-ink">{h}</th>)}</tr></thead>
            <tbody>{list.length ? list.map((p, r) => { const st = row[p.email], d = draft[p.email] || {}; return (
              <tr key={p.email} className="odd:bg-surface">
                <td className="border border-line px-2.5 py-2 text-ink-dim">{p.empNo || "—"}</td><td className="border border-line px-2.5 py-2 font-bold text-ink">{p.name}</td>
                {COLS.map(([k, h], c) => (
                  <td key={k} className="border border-line p-0"><input className={CELL} data-cell={`${r}-${c}`} aria-label={`${h} for ${p.name}`} autoComplete="off" spellCheck={false} inputMode={k === "account" ? "numeric" : undefined}
                    value={d[k] !== undefined ? d[k] : k === "account" ? "" : p[k]} placeholder={k === "account" ? p.account : k === "holder" ? p.name : ""}
                    onChange={(e) => edit(p, k, k === "ifsc" ? e.target.value.toUpperCase() : e.target.value)} onBlur={() => blur(p)} onKeyDown={(e) => move(e, r, c)} /></td>))}
                <td className="border border-line px-2.5 py-1.5 align-top" aria-live="polite">
                  {st && st.s === "saving" && <span className="muted">Saving…</span>}
                  {st && st.s === "saved" && <Pill tone="ok">Saved</Pill>}
                  {st && st.s === "error" && <><Pill tone="bad">Failed</Pill> <button type="button" className="btn glass sm" onClick={() => save(p, st.body)}>Retry</button>{st.msg.map((m, i) => <div key={i} role="alert" className="text-bad text-[13px]">{m}</div>)}</>}
                  {!st && (p.inPayroll ? <Pill tone="ok">In payroll</Pill> : p.partial ? <span className="muted">Incomplete</span> : null)}</td>
              </tr>); }) : <tr><td colSpan={8} className="border border-line p-4 text-center text-ink-dim">Nobody matches.</td></tr>}</tbody>
          </table></div>)}
      </div>
      <div className="modal-f">
        <a className="btn glass" download href={`${API}/export`}>Download as Excel</a>
        <button type="button" className="btn glass" disabled={closing} onClick={() => setUpload(true)}>Upload Excel</button>
        <button type="button" className="btn primary" disabled={closing} onClick={close}>{closing ? "Saving…" : "Done"}</button>
      </div>
      {upload && <BankUpload onClose={(changed) => { setUpload(false); if (changed) load(); }} />}
    </Modal>
  );
}
