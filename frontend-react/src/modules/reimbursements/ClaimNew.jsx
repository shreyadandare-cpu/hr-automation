import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import { useToast } from "../../components/toast.jsx";
import { Dlg, Fld, Head, Ico, InfoCallout, LinesTable, catName, fdate, lc, money, todayIso, useMeta } from "./util.jsx";

const STEPS = ["Upload invoices", "Review details", "Submit"];
const FIELDS = ["vendor", "invoiceNo", "expenseDate", "category", "amount", "paymentMethod", "description", "travelClass", "policyFare"];
const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
const MAXB = 10 * 1024 * 1024;
let lineKey = 0;
const mkLine = (x = {}) => ({ key: ++lineKey, id: x.id || null, category: x.category || "", amount: x.amount != null && x.amount !== "" ? String(x.amount) : "", expenseDate: x.expenseDate || "",
  paymentMethod: x.paymentMethod || "", description: x.description || "", noReceipt: !!x.noReceipt, source: x.source || "form", document: x.document || null, position: x.position,
  vendor: x.vendor || "", invoiceNo: x.invoiceNo || "", extracted: x.extracted || null, travelClass: x.travelClass || "", policyFare: x.policyFare != null ? String(x.policyFare) : "" });
const blank = (it) => !it.id && !it.category && !it.amount && !it.description && !it.vendor;
const total = (w) => w.items.reduce((n, it) => n + (Number(it.amount) || 0), 0);
const xSame = (it, k) => { const x = it.extracted && it.extracted[k]; if (x == null) return null; return k === "amount" ? Number(it.amount) === Number(x) : String(it[k] || "") === String(x); };
const Xb = ({ it, k }) => { const s = xSame(it, k); return s === null ? null : <span className={`xb ${s ? "ok" : "ed"}`}>{s ? "From invoice" : "Edited"}</span>; };
const Lab = ({ t, it, k }) => <>{t}<Xb it={it} k={k} /></>;
const rawPut = async (method, url, file) => {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/octet-stream" }, body: file });
  return { ok: r.ok, data: await r.json().catch(() => null) };
};

function DocPreview({ claimId, it }) {
  const d = it.document;
  if (!d || !claimId) return null;
  const src = `/api/reimbursements/${claimId}/documents/${d.id}`, pdf = d.mime === "application/pdf";
  return (
    <div className="cw-doc"><div className="cw-doc-h"><Ico k="doc" /><span title={d.name}>{d.name}</span><span className="grow" />
      <a className="btn link sm nolink" href={src} target="_blank" rel="noopener noreferrer"><Ico k="open" />Open</a><a className="btn link sm nolink" href={`${src}?download=1`}><Ico k="down" />Download</a></div>
      <div className={`rb-viewer ${pdf ? "pdf" : "img"} small`}>{pdf ? <iframe src={`${src}#view=FitH`} title={`Invoice for expense ${it.position || ""}: ${d.name}`} /> : <div className="rb-imgwrap"><img src={src} alt={`Invoice: ${d.name}`} /></div>}</div></div>
  );
}

function Receipt({ it, i, w, nrMax, onUpload, onCall }) {
  const busy = w.busyItem === it.id, small = Number(it.amount) <= nrMax, err = w.errors["up-" + it.id];
  const bad = err ? <div className="callout bad"><Ico k="warn" /><div>{err}</div></div> : null;
  if (it.document) return <><div className="rc-doc"><Ico k="doc" /><span>Invoice attached</span><span className="grow" />
    <label className="btn glass sm cw-file">{busy ? "Uploading…" : "Replace"}<input type="file" accept={ACCEPT} disabled={busy} aria-label={`Replace the invoice for expense ${i + 1}`} onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) onUpload(it.id, f); }} /></label>
    <button type="button" className="btn link sm nolink" onClick={() => onCall(it.id, "DELETE", "/document")}>Remove</button></div>{bad}</>;
  if (!it.id) return <div className="muted" style={{ fontSize: 13 }}><Ico k="doc" /> Attach the receipt after you continue, or it's saved as a small expense without one.</div>;
  if (it.noReceipt) return <div className="rc-nr"><Ico k="check" /><span className="grow">Small expense without a receipt. You'll confirm a declaration before submitting.</span>
    <button type="button" className="btn link sm nolink" onClick={() => onCall(it.id, "PATCH", "", { noReceipt: false })}>Upload a receipt instead</button></div>;
  return <>
    <label className={`rb-drop ${busy ? "busy" : ""}`}><input type="file" accept={ACCEPT} disabled={busy} aria-label={`Receipt for expense ${i + 1}`} onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) onUpload(it.id, f); }} />
      <Ico k="doc" /><b>{busy ? "Uploading and checking…" : "Attach the receipt"}</b><span className="muted">PDF, JPG or PNG · up to 10 MB</span></label>
    {small ? <button type="button" className="btn link sm nolink" style={{ alignSelf: "flex-start" }} onClick={() => onCall(it.id, "PATCH", "", { noReceipt: true })}>No bill for this (auto, bus, parking…)? Mark it as a small expense without a receipt</button>
      : <span className="muted" style={{ fontSize: 13 }}>Expenses over {money(nrMax)} need a receipt.</span>}{bad}</>;
}

function Line({ it, i, w, meta, nrMax, onField, onRemove, onUpload, onCall }) {
  const er = w.errors, id = (k) => `cw-${i}-${k}`, e = (k) => er[`${i}-${k}`];
  const cats = ((meta && meta.categories) || []).filter((c) => c.active || c.key === it.category), pm = (meta && meta.paymentMethods) || [], CLS = (meta && meta.travelClasses) || ["Economy", "Premium economy", "Business", "First"];
  const cat = ((meta && meta.categories) || []).find((c) => c.key === it.category) || null;
  const over = !!(cat && cat.allowedClass && it.travelClass && CLS.indexOf(it.travelClass) > CLS.indexOf(cat.allowedClass));
  const inp = (k, extra) => ({ id: id(k), value: it[k], onChange: (ev) => onField(i, k, ev.target.value), ...extra });
  const xAmt = it.extracted && it.extracted.amount;
  return (
    <div className="cw-rev" data-line={i}>
      <div className="cw-line">
        <div className="cw-line-h"><b>Expense {i + 1}</b>{it.source === "document" ? <span className="pill p-info">Read from invoice</span> : it.source === "excel" ? <span className="pill p-info">From sheet</span> : null}<span className="grow" />
          {w.items.length > 1 && <button type="button" className="btn link sm nolink" aria-label={`Remove expense ${i + 1}`} onClick={() => onRemove(i)}><Ico k="x" />Remove</button>}</div>
        {it.extracted ? <div className="span cw-x"><Ico k="check" /> Details extracted from the invoice. Check each one; anything you change is marked <b>Edited</b>.</div>
          : it.source === "document" ? <div className="span cw-x warn"><Ico k="warn" /> This invoice couldn't be read automatically. Fill in the details from it.</div> : null}
        <div className="span"><Fld id={id("vendor")} label={<Lab t="Vendor" it={it} k="vendor" />} error={e("vendor")}><input className="input" {...inp("vendor", { maxLength: 120, placeholder: "e.g. ABC Hotel" })} /></Fld></div>
        <Fld id={id("invoiceNo")} label={<Lab t="Invoice number" it={it} k="invoiceNo" />} error={e("invoiceNo")}><input className="input mono" {...inp("invoiceNo", { maxLength: 60, placeholder: "Optional" })} /></Fld>
        <Fld id={id("expenseDate")} label={<Lab t="Expense date" it={it} k="expenseDate" />} error={e("expenseDate")}><input className="input" type="date" max={todayIso()} {...inp("expenseDate")} /></Fld>
        <Fld id={id("category")} label={<Lab t="Category" it={it} k="category" />} error={e("category")}><select className="input" {...inp("category")}><option value="">Choose…</option>{cats.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select></Fld>
        <Fld id={id("amount")} label={<Lab t="Amount (₹)" it={it} k="amount" />} error={e("amount")}><input className="input" type="number" min="0" step="0.01" inputMode="decimal" {...inp("amount", { placeholder: "2500" })} /></Fld>
        <Fld id={id("paymentMethod")} label="Payment method" error={e("paymentMethod")}><select className="input" {...inp("paymentMethod")}><option value="">Choose…</option>{pm.map((p) => <option key={p}>{p}</option>)}</select></Fld>
        {cat && cat.allowedClass && <Fld id={id("travelClass")} label={<Lab t="Travel class" it={it} k="travelClass" />} error={e("travelClass")} hint={`Policy allows ${cat.allowedClass}.`}>
          <select className="input" {...inp("travelClass")}><option value="">Not applicable</option>{CLS.map((x) => <option key={x}>{x}</option>)}</select></Fld>}
        {over && <Fld id={id("policyFare")} label={`${cat.allowedClass} fare for the same trip (₹)`} error={e("policyFare")} hint={`You booked ${it.travelClass}. Up to the ${cat.allowedClass} fare is reimbursed; the rest isn't.`}>
          <input className="input" type="number" min="0" step="0.01" placeholder="e.g. 8000" {...inp("policyFare")} /></Fld>}
        <div className="span"><Fld id={id("description")} label="What was it for?" error={e("description")}><input className="input" maxLength={500} placeholder={i ? "Dinner with the client team" : "Hotel stay during client visit"} {...inp("description")} /></Fld></div>
        <div className="span">{xAmt != null && !xSame(it, "amount") && <div className="callout warn-c"><Ico k="warn" /><div>The invoice shows <b>{money(xAmt)}</b>, you entered <b>{money(Number(it.amount) || 0)}</b>. You'll be asked to confirm this before submitting.</div></div>}</div>
        <div className="span" style={{ display: "flex", flexDirection: "column", gap: 8 }}><Receipt it={it} i={i} w={w} nrMax={nrMax} onUpload={onUpload} onCall={onCall} /></div>
      </div>
      <DocPreview claimId={w.id} it={it} />
    </div>
  );
}

function ImportDlg({ data, name, meta, nrMax, onClose, onAdd }) {
  const rows = data.rows, good = rows.filter((x) => !Object.keys(x.errors).length), bad = rows.length - good.length;
  return (
    <Dlg wide onClose={onClose}><div className="card-h" style={{ paddingTop: 24 }}><div><h3>Check the expenses</h3><span className="muted">{name} · {rows.length} row{rows.length === 1 ? "" : "s"}</span></div></div>
      <div className="tbl-wrap"><table className="imp-table"><thead><tr><th>Row</th><th>Date</th><th>Category</th><th>What for</th><th className="hide-sm">Paid with</th><th className="num">Amount</th><th>Status</th></tr></thead><tbody>
        {rows.map((x) => { const e = Object.values(x.errors); return (
          <tr key={x.row} className={e.length ? "bad" : ""}><td className="muted">{x.row}</td><td className="num-cell">{x.errors.expenseDate ? x.expenseDate || "—" : fdate(x.expenseDate)}</td><td>{x.category ? catName(meta, x.category) : "—"}</td>
            <td>{x.description || "—"}</td><td className="hide-sm">{x.paymentMethod || "—"}</td><td className="num">{x.amount !== "" ? money(x.amount) : "—"}</td>
            <td>{e.length ? <span className="flag"><Ico k="warn" />{e[0]}</span> : x.noReceipt ? <span className="pill p-mute">No receipt</span> : <span className="pill p-warn">Needs receipt</span>}</td></tr>); })}</tbody></table></div>
      <div className="card-b">{bad > 0 && <div className="callout bad"><Ico k="warn" /><div>{bad} row{bad === 1 ? " has a problem and" : "s have problems and"} will be skipped. Fix {bad === 1 ? "it" : "them"} in the sheet and upload again, or add {bad === 1 ? "it" : "them"} by hand.</div></div>}
        <div className="muted">Rows up to {money(nrMax)} come in as small expenses without a receipt. Larger ones need their receipt in the next step.</div></div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose}>Cancel</button><button type="button" className="btn primary" autoFocus disabled={!good.length} onClick={() => onAdd(good)}>Add {good.length} expense{good.length === 1 ? "" : "s"}</button></div></Dlg>
  );
}

export default function ClaimNew() {
  const { isHr: hr } = useAuth();
  const { people } = useData();
  const nav = useNavigate(), toast = useToast(), [sp] = useSearchParams(), loc = useLocation();
  const stateBudget = (loc.state && loc.state.budget) || null;
  const editId = Number(sp.get("edit")) || null, budgetId = Number(sp.get("budget")) || null;
  const [meta] = useMeta();
  const [boot, setBoot] = useState(editId || (budgetId && !stateBudget) ? "loading" : "ready");
  const [w, setW] = useState({ step: 1, id: null, status: "draft", claimNo: "", email: "", budget: stateBudget, items: [], validation: null, duplicates: [], eligibility: null, comment: "",
    errors: {}, busy: false, busyItem: null, importing: false, uploads: [], confirm: false, confirmAmounts: false });
  const wr = useRef(w); wr.current = w;
  const [imp, setImp] = useState(null);
  const set = (patch) => setW((x) => ({ ...x, ...patch }));
  const nrMax = (meta && meta.noReceiptMax) || 2000;

  // Edit or resubmit an existing claim, or start the final bill for an approved budget.
  useEffect(() => {
    let live = true;
    (async () => {
      if (editId) {
        const r = await api("GET", `/api/reimbursements/${editId}`);
        if (!live) return;
        if (!r.ok || !["draft", "changes_requested"].includes(r.data.claim.status)) return nav(`/app/reimbursements/${editId}`, { replace: true });
        const c = r.data.claim;
        setW((x) => ({ ...x, step: 2, id: c.id, status: c.status, claimNo: c.claimNo, email: c.email, budget: c.budget, items: (c.items || []).map(mkLine), validation: c.validation, duplicates: c.duplicates,
          eligibility: c.eligibility, comment: c.changeComment || "" }));
      } else if (budgetId && !stateBudget) {
        const r = await api("GET", `/api/budget-requests/${budgetId}`);
        if (!live) return;
        if (!r.ok) { toast(apiMsg(r)); return nav("/app/budgets", { replace: true }); }
        const b = r.data.request;
        setW((x) => ({ ...x, budget: { id: b.id, requestNo: b.requestNo, purpose: b.purpose, approvedBudget: b.approvedBudget } }));
      }
      setBoot("ready");
    })();
    return () => { live = false; };
  }, [editId, budgetId, nav, toast]);

  // After a failed save, take the person to the first error.
  useEffect(() => {
    if (!Object.keys(w.errors).length) return;
    const el = document.querySelector(".ferr,.derr");
    if (el) { el.scrollIntoView({ block: "center" }); const f = el.closest(".field"); const i = f && f.querySelector("input:not([type=file]),textarea,select"); if (i) i.focus(); }
  }, [w.errors]);

  const field = (i, k, v) => setW((x) => ({ ...x, items: x.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) }));
  const remove = (i) => setW((x) => ({ ...x, items: x.items.filter((_, j) => j !== i), errors: {} }));

  async function reload() {
    const id = wr.current.id, g = await api("GET", `/api/reimbursements/${id}`);
    if (!g.ok) return;
    const c = g.data.claim;
    setW((x) => ({ ...x, items: c.items.map(mkLine), validation: c.validation, duplicates: c.duplicates, claimNo: c.claimNo, eligibility: c.eligibility, budget: c.budget || x.budget }));
  }

  async function uploadInvoices(files) {
    const cur = wr.current;
    if (!files.length) return;
    if (hr && !cur.id && !cur.email) return set({ errors: { email: "Choose the employee first." } });
    set({ errors: {} });
    let claimId = cur.id;
    for (const f of files) {
      const u = { key: Math.random(), name: f.name, state: "busy", msg: "Uploading and reading…" };
      const upd = (p) => setW((x) => ({ ...x, uploads: x.uploads.map((q) => (q.key === u.key ? { ...q, ...p } : q)) }));
      setW((x) => ({ ...x, uploads: [...x.uploads, u] }));
      if (f.size > MAXB) { upd({ state: "bad", msg: "Larger than 10 MB. Not uploaded." }); continue; }
      const qs = new URLSearchParams({ name: f.name });
      if (claimId) qs.set("claim", claimId); else { if (cur.budget) qs.set("budget", cur.budget.id); if (hr && cur.email) qs.set("email", cur.email); }
      try {
        const r = await rawPut("POST", "/api/reimbursements/from-document?" + qs, f), d = r.data;
        if (!r.ok) { upd({ state: "bad", msg: (d && (d.error || (d.errors && Object.values(d.errors)[0]))) || "The server refused the file." }); continue; }
        if (!claimId) { claimId = d.claimId; wr.current = { ...wr.current, id: claimId }; setW((x) => ({ ...x, id: d.claimId, claimNo: d.claimNo })); }
        setW((x) => ({ ...x, items: [...x.items, mkLine(d.item)] }));
        upd(d.read.found.length ? { state: "ok", msg: `Read ${d.read.found.join(", ")}${d.item.amount != null ? ` · ${money(d.item.amount)}` : ""}` } : { state: "warn", msg: d.read.note || "Couldn't read it automatically. You'll fill in the details." });
      } catch { upd({ state: "bad", msg: "The server can't be reached." }); }
    }
    if (claimId) { wr.current = { ...wr.current, id: claimId }; await reload(); }
  }

  async function next() {
    const cur = wr.current;
    set({ errors: {} });
    if (cur.step === 1) {
      if (hr && !cur.id && !cur.email) return set({ errors: { email: "Choose the employee first." } });
      if (!cur.items.length) return set({ errors: { file: "Upload an invoice, or add an expense by hand." } });
      set({ step: 2 }); window.scrollTo(0, 0); return;
    }
    if (cur.step === 2) {
      let items = cur.items;
      if (items.length > 1) items = items.filter((it) => !blank(it));
      set({ items, busy: true });
      const body = { items: items.map((it) => ({ id: it.id, category: it.category, amount: it.amount, expenseDate: it.expenseDate, paymentMethod: it.paymentMethod, description: it.description,
        noReceipt: it.id ? it.noReceipt : (!it.document && Number(it.amount) <= nrMax), source: it.source === "document" ? "form" : it.source, vendor: it.vendor, invoiceNo: it.invoiceNo, travelClass: it.travelClass, policyFare: it.policyFare })) };
      if (!cur.id) { if (hr) body.email = cur.email; if (cur.budget) body.budgetId = cur.budget.id; }
      const r = cur.id ? await api("PUT", `/api/reimbursements/${cur.id}`, body) : await api("POST", "/api/reimbursements", body);
      if (!r.ok) { const errors = (r.data && r.data.errors) || {}; set({ busy: false, errors: Object.keys(errors).length ? errors : { form: apiMsg(r) } }); return; }
      if (!cur.id) { wr.current = { ...wr.current, id: r.data.id }; set({ id: r.data.id, claimNo: r.data.claimNo }); }
      await reload(); set({ busy: false });
      const gaps = wr.current.items.map((it, i) => (!it.document && !it.noReceipt ? i + 1 : 0)).filter(Boolean);
      if (gaps.length) { set({ errors: { file: `Attach the receipt for expense ${gaps.join(", ")}, or mark ${gaps.length === 1 ? "it" : "them"} as a small expense without a receipt.` } }); window.scrollTo(0, 0); return; }
    }
    setW((x) => ({ ...x, step: x.step + 1 })); window.scrollTo(0, 0);
  }

  async function upload(itemId, file) {
    if (!wr.current.id) return;
    if (file.size > MAXB) return set({ errors: { ["up-" + itemId]: "The file is larger than 10 MB." } });
    set({ busyItem: itemId, errors: {} });
    try {
      const r = await rawPut("PUT", `/api/reimbursements/${wr.current.id}/items/${itemId}/document?name=${encodeURIComponent(file.name)}`, file);
      if (!r.ok) set({ errors: { ["up-" + itemId]: (r.data && r.data.error) || "The server refused the file." } });
      else setW((x) => ({ ...x, items: x.items.map((it) => (it.id === itemId ? { ...it, document: r.data.document, noReceipt: false } : it)), validation: r.data.validation, duplicates: r.data.duplicates }));
    } catch { set({ errors: { ["up-" + itemId]: "The server can't be reached." } }); }
    set({ busyItem: null });
  }

  async function itemCall(itemId, method, path, body) {
    const r = await api(method, `/api/reimbursements/${wr.current.id}/items/${itemId}${path}`, body);
    if (!r.ok) return set({ errors: { ["up-" + itemId]: apiMsg(r) } });
    const keep = wr.current.items.map((it) => ({ ...it }));
    set({ errors: {} }); await reload();
    setW((x) => ({ ...x, items: x.items.map((it) => { const o = keep.find((k) => k.id === it.id); if (!o) return it; const n = { ...it }; FIELDS.forEach((k) => { n[k] = o[k]; }); return n; }) }));   // keep unsaved edits
  }

  async function importSheet(file) {
    if (file.size > 2 * 1024 * 1024) return toast("The sheet is larger than 2 MB.");
    set({ importing: true });
    let r;
    try { r = await rawPut("POST", "/api/reimbursements/import?name=" + encodeURIComponent(file.name), file); }
    catch { set({ importing: false }); return toast("The server can't be reached."); }
    set({ importing: false });
    setImp({ ok: r.ok, data: r.data, name: file.name });
  }

  async function submit() {
    const cur = wr.current;
    if (!cur.confirm) return;
    set({ busy: true });
    const resub = cur.status === "changes_requested";
    const r = await api("POST", `/api/reimbursements/${cur.id}/${resub ? "resubmit" : "submit"}`, { declaration: true, confirmAmounts: !!cur.confirmAmounts });
    if (!r.ok) { set({ busy: false }); return toast(apiMsg(r)); }
    toast(resub ? "Claim resubmitted for review." : "Claim submitted. HR has been notified.");
    nav(`/app/reimbursements/${cur.id}`);
  }

  const cancel = () => nav(w.id ? `/app/reimbursements/${w.id}` : "/app/reimbursements");
  if (boot === "loading" || !meta || (hr && !people)) return <section className="section"><div className="empty">Loading…</div></section>;

  const er = w.errors, busyUp = w.uploads.some((u) => u.state === "busy");
  const budgetNote = w.budget && <InfoCallout><b>Final bill for {w.budget.requestNo}</b> · {w.budget.purpose || ""}<div>Approved budget <b>{money(w.budget.approvedBudget)}</b>. If the bill is higher, only the approved budget is reimbursed.</div></InfoCallout>;
  const empName = (e) => ((people || []).find((p) => lc(p.email) === lc(e)) || { name: e }).name;
  const goStep = (n) => set({ step: n });
  const resub = w.status === "changes_requested", last = w.step === 3;
  const mism = w.items.filter((it) => it.extracted && it.extracted.amount != null && !xSame(it, "amount"));
  const canSubmit = w.confirm && (!(last && mism.length) || w.confirmAmounts) && !w.busy;
  let body = null;

  if (w.step === 1) body = <>
    {budgetNote}
    {hr && !w.id && <div className="card"><div className="card-b"><Fld id="cw-email" label="Filing for" error={er.email} hint="HR can file a claim for someone. It is reviewed like any other claim.">
      <select className="input" id="cw-email" value={w.email} onChange={(e) => set({ email: e.target.value })}><option value="">Choose the employee…</option>
        {people.filter((e) => e.status !== "offboarded").sort((a, b) => (a.name < b.name ? -1 : 1)).map((e) => <option key={e.email} value={e.email}>{e.name}</option>)}</select></Fld></div></div>}
    <div className="card"><div className="card-h"><div><h3>{w.budget ? "Upload the final bill" : "Upload your invoice or receipt"}</h3><span className="muted">PDF, JPG or PNG, up to 10 MB each. The details are read for you, and you check them next.</span></div>{w.claimNo && <span className="muted mono">{w.claimNo}</span>}</div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label className={`rb-drop big ${busyUp ? "busy" : ""}`}><input type="file" id="cw-inv" multiple accept={ACCEPT} disabled={busyUp} onChange={(e) => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) uploadInvoices(fs); }} />
          <Ico k="doc" /><b>{busyUp ? "Reading your invoice…" : w.items.length ? "Upload another invoice" : "Choose invoices or receipts"}</b><span className="muted">You can pick several at once. Each becomes one expense.</span></label>
        {er.file && <div className="callout bad"><Ico k="warn" /><div>{er.file}</div></div>}
        {w.uploads.length > 0 && <ul className="up-list">{w.uploads.map((u) => <li key={u.key} className={u.state}>{u.state === "busy" ? <span className="spin" aria-hidden="true" /> : u.state === "ok" ? <Ico k="check" /> : <Ico k="warn" />}<div className="grow"><b>{u.name}</b><span className="muted">{u.msg || ""}</span></div></li>)}</ul>}
        {w.items.length > 0 && <div className="cw-sum"><div className="muted" style={{ fontSize: 13 }}>In this claim</div>
          {w.items.map((it, i) => <div className="li" key={it.key}><div className="grow"><b style={{ fontWeight: 600 }}>{i + 1}. {it.vendor || it.description || catName(meta, it.category) || "Expense"}</b>
            <div className="meta">{it.amount ? money(Number(it.amount)) : "Amount to fill in"}{it.document ? " · invoice attached" : it.source === "excel" ? " · from sheet" : " · added by hand"}</div></div>
            <button type="button" className="btn link sm nolink" aria-label={`Remove expense ${i + 1}`} onClick={() => remove(i)}>Remove</button></div>)}
          <div className="cw-total"><span>Claim total · {w.items.length} expense{w.items.length === 1 ? "" : "s"}</span><b>{money(total(w))}</b></div></div>}
      </div></div>
    {!w.budget && <div className="card cw-import"><div className="cw-import-t"><b>No bill?</b><span className="muted">For autos, buses, parking and other small expenses up to {money(nrMax)} each, add them by hand or list them in an Excel sheet.</span></div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}><button type="button" className="btn glass sm" onClick={() => {
        if (hr && !w.id && !w.email) return set({ errors: { email: "Choose the employee first." } });
        setW((x) => ({ ...x, items: [...x.items, mkLine({})], step: 2 })); window.scrollTo(0, 0); setTimeout(() => { const n = document.getElementById(`cw-${wr.current.items.length - 1}-vendor`); if (n) n.focus(); });
      }}><Ico k="plus" />Add an expense by hand</button>
        <a className="btn glass sm" href="/api/reimbursements/import/template" download><Ico k="down" />Excel template</a>
        <label className="btn glass sm cw-file"><Ico k="doc" />{w.importing ? "Reading the sheet…" : "Upload Excel or CSV"}<input type="file" id="cw-sheet" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={w.importing}
          onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importSheet(f); }} /></label></div></div>}
  </>;

  if (w.step === 2) body = <>
    {budgetNote}
    {w.comment && <InfoCallout><b>HR asked for changes</b><div>{w.comment}</div></InfoCallout>}
    <div className="card"><div className="card-h"><div><h3>Review expense details</h3><span className="muted">Check what was read from each invoice and correct anything that's wrong. Every field can be edited.</span></div>{w.claimNo && <span className="muted mono">{w.claimNo}</span>}</div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {er.form && <div className="callout bad"><Ico k="warn" /><div>{er.form}</div></div>}
        {er.file && <div className="callout bad"><Ico k="warn" /><div>{er.file}</div></div>}
        {(w.duplicates || []).length > 0 && <div className="callout bad"><Ico k="warn" /><div>Looks like an earlier claim: {w.duplicates.map((d) => d.claimNo).join(", ")}. HR will check.</div></div>}
        {w.items.map((it, i) => <Line key={it.key} it={it} i={i} w={w} meta={meta} nrMax={nrMax} onField={field} onRemove={remove} onUpload={upload} onCall={itemCall} />)}
        <button type="button" className="cw-add" onClick={() => {
          const lastIt = w.items[w.items.length - 1] || {};
          setW((x) => ({ ...x, items: [...x.items, mkLine({ expenseDate: lastIt.expenseDate, paymentMethod: lastIt.paymentMethod })] }));
          setTimeout(() => { const n = document.getElementById(`cw-${wr.current.items.length - 1}-vendor`); if (n) { n.focus(); n.scrollIntoView({ block: "center", behavior: "smooth" }); } });
        }}><Ico k="plus" />Add another expense</button>
        <div className="cw-total"><span>Claim total · {w.items.length} expense{w.items.length === 1 ? "" : "s"}</span><b id="cw-total">{money(total(w))}</b></div>
      </div></div>
  </>;

  if (w.step === 3) {
    const v = w.validation || {}, el = w.eligibility || {}, nr = w.items.filter((it) => it.noReceipt && !it.document), nrSum = nr.reduce((n, it) => n + Number(it.amount), 0), withDoc = w.items.filter((it) => it.document).length;
    const req = el.requested != null ? el.requested : total(w), elig = el.eligible != null ? el.eligible : req;
    const row = (k, x, cls = "") => <div className={`am-row ${cls}`}><span>{k}</span><b>{x}</b></div>;
    const sec = (title, step, kids) => <div className="card"><div className="card-h"><h3>{title}</h3><button type="button" className="btn link" onClick={() => goStep(step)}>Edit</button></div><div className="card-b">{kids}</div></div>;
    const kv = (pairs) => <dl className="rv">{pairs.map(([k, x]) => <div key={k}><dt>{k}</dt><dd>{x || "—"}</dd></div>)}</dl>;
    body = <>
      {budgetNote}
      {sec("Expense details", 2, <>{hr && w.email && <div className="muted" style={{ marginBottom: 10 }}>For {empName(w.email)}</div>}
        <LinesTable meta={meta} c={{ id: w.id, items: w.items.map((it, i) => ({ ...it, position: i + 1, amount: Number(it.amount) })), validation: v, eligibility: el }} /></>)}
      <div className="card"><div className="card-h"><h3>Amounts</h3></div><div className="card-b rb-amounts">
        {row("Requested amount", money(req))}
        {el.budget && <>{row(<>Approved budget <span className="muted mono">{el.budget.requestNo}</span></>, money(el.budget.approvedBudget))}{row("Company covers", money(el.budget.covered), "good")}{row("Employee excess", el.budget.excess ? money(el.budget.excess) : "—", el.budget.excess ? "bad" : "")}</>}
        {row("Eligible amount", money(elig), elig < req ? "good" : "")}{elig < req && !el.budget && row("Not eligible", money(req - elig), "bad")}
        {(el.reasons || []).length > 0 && <ul className="am-why">{el.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        <div className="muted" style={{ fontSize: 12.5 }}>HR reviews the claim and can approve the full amount or less. Only the approved amount is paid with your salary.</div></div></div>
      {sec("Receipts", 2, kv([["Invoices attached", `${withDoc} of ${w.items.length}`], ["Without a receipt", nr.length ? `${nr.length} small expense${nr.length === 1 ? "" : "s"}, ${money(nrSum)}` : "None"],
        ["Amount check", mism.length ? <span style={{ color: "var(--warn)" }}>{mism.length} amount{mism.length === 1 ? "" : "s"} differ from the invoice</span> : v.match && v.match.status === "match" ? "Matches the invoices" : "Checked by HR"]]))}
      {mism.length > 0 && <label className="check confirm-box"><input type="checkbox" id="cw-amt-ok" checked={w.confirmAmounts} onChange={(e) => set({ confirmAmounts: e.target.checked })} />
        <div className="grow"><div className="lbl">I confirm the amounts I entered. {mism.map((it) => `Expense ${w.items.indexOf(it) + 1}: invoice ${money(it.extracted.amount)}, claimed ${money(Number(it.amount))}`).join("; ")}.</div></div></label>}
      <label className="check confirm-box"><input type="checkbox" id="cw-confirm" checked={w.confirm} onChange={(e) => set({ confirm: e.target.checked })} />
        <div className="grow"><div className="lbl">These are genuine business expenses{withDoc ? ` and the invoice${withDoc === 1 ? " is" : "s are"} original` : ""}.{nr.length ? ` I declare that the ${nr.length} expense${nr.length === 1 ? "" : "s"} without a receipt (${money(nrSum)}) ${nr.length === 1 ? "was" : "were"} actually spent for work.` : ""}</div></div></label>
    </>;
  }

  return (
    <section className="section">
      <Head eyebrow={hr && !resub ? "Finance" : "Me"} title={resub ? "Update and " : w.budget ? "Final " : "New "} accent={resub ? "resubmit." : w.budget ? "bill." : "claim."}
        sub={resub ? "Make the changes HR asked for, check the details, then send it back." : "Upload the invoice, check the details read from it, then submit. HR reviews every claim."} />
      <div className="stepper" role="list">{STEPS.map((s, i) => <div key={s} className={`stp ${w.step === i + 1 ? "on" : w.step > i + 1 ? "done" : ""}`} role="listitem"><b>{w.step > i + 1 ? "✓" : i + 1}</b>{s}</div>)}</div>
      <form id="cwf" className="grid" style={{ gap: 22 }} noValidate onSubmit={(e) => { e.preventDefault(); if (last) submit(); else next(); }}>{body}
        <div className="row" style={{ justifyContent: "space-between" }}><div className="row">
          {w.step > 1 ? <button type="button" className="btn glass" onClick={() => setW((x) => ({ ...x, errors: {}, step: x.step - 1, uploads: [] }))}>Back</button> : <button type="button" className="btn glass" onClick={cancel}>Cancel</button>}</div>
          {last ? <button type="submit" className="btn primary" id="cw-submit" disabled={!canSubmit}>{resub ? "Resubmit claim" : "Submit claim"}</button>
            : <button type="button" className="btn primary" disabled={w.busy || !!w.busyItem || busyUp} onClick={next}>{w.busy ? "Saving…" : "Continue"}</button>}</div></form>
      {imp && (imp.ok
        ? <ImportDlg data={imp.data} name={imp.name} meta={meta} nrMax={nrMax} onClose={() => setImp(null)} onAdd={(good) => {
          setW((x) => ({ ...x, items: [...x.items.filter((it) => !blank(it)), ...good.map((r) => mkLine(r))], errors: {} })); setImp(null);
          toast(`${good.length} expense${good.length === 1 ? "" : "s"} added from the sheet.`); }} />
        : <Dlg onClose={() => setImp(null)}><div className="card-h" style={{ paddingTop: 24 }}><h3>This sheet can't be imported</h3></div><div className="card-b"><div className="callout bad"><Ico k="warn" /><div>{(imp.data && imp.data.error) || "The server refused the file."}</div></div>
          <div className="muted">Download the template, fill one row per expense, and upload it again.</div></div>
          <div className="modal-f"><a className="btn glass" href="/api/reimbursements/import/template" download><Ico k="down" />Download template</a><button type="button" className="btn primary" autoFocus onClick={() => setImp(null)}>OK</button></div></Dlg>)}
    </section>
  );
}
