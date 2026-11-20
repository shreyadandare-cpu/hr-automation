import { useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { Callout, PersonCell, Pill, SectionHead, ViewTabs, ListSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { useList, usePerson, when } from "./shared.jsx";

const SECTIONS = ["80C", "80D", "HRA", "Home loan interest", "NPS", "Other"];
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
/* What HR has noted about the proof for a line: the words staff see, and the pill's tone. */
const PROOF = { received: ["Proof received", "info"], verified: ["Proof verified", "ok"], rejected: ["Proof needs another look", "bad"] };
const toNum = (v) => { const n = Number(String(v == null ? "" : v).replace(/[₹,\s]/g, "")); return Number.isFinite(n) ? n : 0; };

/* Pay > Tax declaration: tell payroll which tax regime you choose for the financial year and, under the old regime,
   what you plan to claim. It is a record for the payroll team; it does not change any payslip by itself. HR also sees
   what everyone has submitted. */
export default function Tax() {
  const { can, canAll } = useAuth();
  const seesOthers = can("payroll.view");   // others' declarations, for the people in scope
  const sets = canAll("payroll.prepare");   // the regime policy: payroll sets the default regime and uploads the policy document
  const [tab, setTab] = useState("mine");
  const views = [["mine", "My declaration"], ...(seesOthers ? [["all", "Submitted by everyone"]] : []), ...(sets ? [["policy", "Regime policy"]] : [])];
  return (
    <section className="section">
      <SectionHead title="Tax declaration" sub="Choose your tax regime for the year and declare what you plan to claim. Payroll reads this when it works out your tax."
        tabs={views.length > 1 ? <ViewTabs label="Tax" view={tab} onView={setTab} views={views} /> : null} />
      {tab === "all" && seesOthers ? <Everyone /> : tab === "policy" && sets ? <Policy /> : <Mine />}
    </section>
  );
}

const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

function Mine() {
  const toast = useToast();
  const { user } = useAuth();
  const [up, setUp] = useState(-1);
  const fileUrl = (i) => `/api/tax-declarations/${encodeURIComponent(user.email)}/proofs/${i}/file`;
  const reloadFiles = async () => { const r = await api("GET", "/api/tax-declaration"); if (r.ok) setD((cur) => ({ ...cur, items: cur.items.map((x, j) => ({ ...x, file: (r.data.items[j] || {}).file || null, proof: (r.data.items[j] || {}).proof || null })) })); };
  const upload = async (i, file) => {
    if (!file) return;
    setUp(i);
    const r = await fetch(`/api/tax-declaration/proofs/${i}/file?name=${encodeURIComponent(file.name)}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file });
    const body = await r.json().catch(() => ({}));
    setUp(-1);
    if (!r.ok) { toast(body.error || "The document could not be uploaded. Please try again."); return; }
    toast("Your proof was uploaded."); reloadFiles();
  };
  const removeFile = async (i) => { const r = await api("DELETE", `/api/tax-declaration/proofs/${i}/file`); if (!r.ok) { toast(apiMsg(r)); return; } toast("The document was removed."); reloadFiles(); };
  const [d, setD] = useState(null), [error, setError] = useState(""), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  useEffect(() => { api("GET", "/api/tax-declaration").then((r) => { if (r.ok) setD({ ...r.data, saved: r.data.items.length, items: r.data.items.map((i) => ({ ...i, amount: String(i.amount) })) }); else { setError(apiMsg(r)); setD({ regime: "new", items: [], status: "draft" }); } }); }, []);
  if (!d) return <ListSkeleton />;
  const set = (i, k) => (e) => setD({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) });
  const total = d.items.reduce((n, i) => n + toNum(i.amount), 0);
  const save = async (submit) => {
    setBusy(true);
    const r = await api("PUT", "/api/tax-declaration", { regime: d.regime, items: d.items, submit });
    setBusy(false);
    if (!r.ok) { setErr((r.data && r.data.errors) || {}); setError(r.data && r.data.errors ? "Please check the lines marked below." : apiMsg(r)); return; }
    setErr({}); setError(""); setD({ ...r.data, saved: r.data.items.length, items: r.data.items.map((i) => ({ ...i, amount: String(i.amount) })) });
    toast(submit ? "Your declaration was sent to payroll." : "Your draft was saved.");
  };
  return (
    <>
      {error && <Callout>{error}</Callout>}
      <div className="card"><div className="card-h"><h3>Financial year {d.financialYear} to {d.financialYear + 1}</h3>{d.status === "submitted" ? <Pill tone="ok">Submitted {when(d.submittedAt)}</Pill> : <Pill tone="warn">Draft</Pill>}</div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {d.policy && d.policy.set && (
            <p className="muted" style={{ margin: 0 }}>
              Your company&rsquo;s policy makes the <b>{d.policy.defaultRegime === "old" ? "Old" : "New"} regime</b> the default, so it is selected for you. You can change it.
              {d.policy.document && <> <a className="btn link nolink" href="/api/tax-declaration/policy/document" target="_blank" rel="noreferrer">Read the policy document</a></>}
            </p>)}
          <div className="tx-regime" role="radiogroup" aria-label="Tax regime">
            <label><input type="radio" name="regime" checked={d.regime === "new"} onChange={() => setD({ ...d, regime: "new" })} /><span><b>New regime</b>Lower rates, with no deductions to declare.{(d.policy ? d.policy.defaultRegime : "new") === "new" && " This is the company default."}</span></label>
            <label><input type="radio" name="regime" checked={d.regime === "old"} onChange={() => setD({ ...d, regime: "old" })} /><span><b>Old regime</b>Higher rates, with deductions for investments, insurance, rent and home loans.{d.policy && d.policy.defaultRegime === "old" && " This is the company default."}</span></label>
          </div>
          {d.regime === "old" && <>
            <div className="field"><span className="lab">What you plan to claim</span>
              {d.items.map((it, i) => (
                <div key={i}><div className="tx-line">
                  <select className="input" aria-label={`Section, line ${i + 1}`} value={it.section} onChange={set(i, "section")}>{SECTIONS.map((s) => <option key={s}>{s}</option>)}</select>
                  <input className="input" aria-label={`Description, line ${i + 1}`} placeholder="For example: PPF, health insurance" maxLength={120} value={it.description} onChange={set(i, "description")} />
                  <input className="input" aria-label={`Amount in rupees, line ${i + 1}`} inputMode="decimal" placeholder="Amount" value={it.amount} onChange={set(i, "amount")} aria-invalid={!!err[`item${i}`]} />
                  <button type="button" className="btn glass sm" onClick={() => setD({ ...d, items: d.items.filter((_, j) => j !== i) })} aria-label={`Remove line ${i + 1}`}>Remove</button>
                </div>{err[`item${i}`] && <span className="ferr" role="alert">{err[`item${i}`]}</span>}
                  {it.proof && <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-ink-dim"><Pill tone={PROOF[it.proof.status][1]}>{PROOF[it.proof.status][0]}</Pill>{it.proof.note}</div>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[14px] text-ink-dim">
                    {i >= (d.saved || 0) ? <span>Save your declaration, then add the proof for this line.</span> : it.file ? <>
                      <a className="btn link nolink" href={fileUrl(i)} target="_blank" rel="noreferrer">{it.file.name}</a>
                      <label className="btn glass sm">{up === i ? "Uploading…" : "Replace"}<input type="file" className="sr-only" accept={ACCEPT} disabled={up >= 0} aria-label={`Replace the proof for line ${i + 1}`} onChange={(e) => { upload(i, e.target.files[0]); e.target.value = ""; }} /></label>
                      <button type="button" className="btn glass sm" onClick={() => removeFile(i)} aria-label={`Remove the proof for line ${i + 1}`}>Remove proof</button></> :
                      <label className="btn glass sm">{up === i ? "Uploading…" : "Add proof"}<input type="file" className="sr-only" accept={ACCEPT} disabled={up >= 0} aria-label={`Proof for line ${i + 1}, as a PDF, JPG or PNG`} onChange={(e) => { upload(i, e.target.files[0]); e.target.value = ""; }} /></label>}
                  </div></div>))}
              {d.items.length < 30 && <button type="button" className="btn link nolink" style={{ alignSelf: "flex-start" }} onClick={() => setD({ ...d, items: [...d.items, { section: "80C", description: "", amount: "" }] })}>Add a line</button>}
            </div>
            <div className="tx-total"><span>Total declared</span><span className="num-cell">{inr(total)}</span></div>
          </>}
          <Callout>Payroll works out your tax from this declaration and asks for proof before the year ends. Please add each proof to its line as a PDF, JPG or PNG of up to 10 MB; its status shows under the line. Changing a line asks payroll to check its proof again. Saving here does not change a payslip that is already published.</Callout>
          <div className="row" style={{ justifyContent: "flex-end" }}><button type="button" className="btn glass" disabled={busy} onClick={() => save(false)}>Save draft</button><button type="button" className="btn primary" disabled={busy} onClick={() => save(true)}>{busy ? "Saving…" : "Submit to payroll"}</button></div>
        </div>
      </div>
    </>
  );
}

/* HR (payroll.prepare): the default regime for the year and the policy document. When the policy changes, upload the new document and choose again. */
function Policy() {
  const toast = useToast();
  const [p, setP] = useState(null), [pick, setPick] = useState("new"), [busy, setBusy] = useState(""), [error, setError] = useState("");
  useEffect(() => { api("GET", "/api/tax-declaration/policy").then((r) => { if (r.ok) { setP(r.data); setPick(r.data.defaultRegime); } else setError(apiMsg(r)); }); }, []);
  if (error && !p) return <Callout>{error}</Callout>;
  if (!p) return <ListSkeleton />;
  const year = `${p.financialYear}-${String(p.financialYear + 1).slice(2)}`;
  const save = async () => {
    setBusy("save"); setError("");
    const r = await api("PUT", "/api/tax-declaration/policy", { defaultRegime: pick });
    setBusy("");
    if (!r.ok) return setError(apiMsg(r));
    setP(r.data); toast(`The ${pick === "old" ? "Old" : "New"} regime is now the default for ${year}.`);
  };
  const upload = async (file) => {
    if (!file) return;
    setBusy("file"); setError("");
    const r = await fetch(`/api/tax-declaration/policy/document?name=${encodeURIComponent(file.name)}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file });
    const body = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok) return setError(body.error || "The document could not be uploaded. Please try again.");
    setP(body); toast("The policy document was uploaded.");
  };
  const remove = async () => {
    setBusy("file"); setError("");
    const r = await api("DELETE", "/api/tax-declaration/policy/document");
    setBusy("");
    if (!r.ok) return setError(apiMsg(r));
    setP(r.data); toast("The policy document was removed.");
  };
  const changed = pick !== p.defaultRegime;
  return (
    <>
      {error && <Callout>{error}</Callout>}
      <div className="card"><div className="card-h"><h3>Tax regime policy for {year}</h3>{p.set ? <Pill tone="ok">{p.defaultRegime === "old" ? "Old" : "New"} regime is the default</Pill> : <Pill tone="warn">Not set yet: the New regime is used</Pill>}</div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <p className="muted" style={{ margin: 0 }}>Choose the regime every declaration starts on, and keep the policy document here. Employees see it on their declaration and can still change their choice. When the policy changes, upload the new document and choose the regime again. It applies to declarations that are not saved yet; ones people have already saved keep their choice.</p>
          <div className="tx-regime" role="radiogroup" aria-label="Default tax regime">
            <label><input type="radio" name="default-regime" checked={pick === "new"} onChange={() => setPick("new")} /><span><b>New regime</b>Lower rates, with no deductions to declare.</span></label>
            <label><input type="radio" name="default-regime" checked={pick === "old"} onChange={() => setPick("old")} /><span><b>Old regime</b>Higher rates, with deductions for investments, insurance, rent and home loans.</span></label>
          </div>
          <div><button type="button" className="btn primary" disabled={busy === "save" || (p.set && !changed)} onClick={save}>{busy === "save" ? "Saving…" : "Save default regime"}</button></div>
          <div className="field"><span className="lab">Policy document</span>
            {p.document
              ? <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                  <a className="btn link nolink" href="/api/tax-declaration/policy/document" target="_blank" rel="noreferrer">{p.document.name}</a>
                  <span className="muted">{Math.max(1, Math.round(p.document.size / 1024))} KB</span>
                  <label className="btn glass sm" style={{ cursor: "pointer" }}>{busy === "file" ? "Uploading…" : "Replace"}<input type="file" hidden accept={ACCEPT} disabled={busy === "file"} onChange={(e) => { upload(e.target.files[0]); e.target.value = ""; }} /></label>
                  <button type="button" className="btn glass sm" disabled={busy === "file"} onClick={remove}>Remove</button>
                </div>
              : <div><label className="btn glass" style={{ cursor: "pointer" }}>{busy === "file" ? "Uploading…" : "Upload the policy document"}<input type="file" hidden accept={ACCEPT} disabled={busy === "file"} onChange={(e) => { upload(e.target.files[0]); e.target.value = ""; }} /></label></div>}
            <span className="hint">PDF, JPG or PNG, up to 10 MB.{p.updatedBy ? ` Last changed by ${p.updatedBy}.` : ""}</span>
          </div>
        </div>
      </div>
    </>
  );
}

function Everyone() {
  const { user, canAll } = useAuth();
  const verifies = canAll("payroll.prepare");   // noting proofs is payroll work, never on your own declaration
  const { data, error, reload } = useList("/api/tax-declarations");
  const person = usePerson(), toast = useToast();
  const [open, setOpen] = useState(null), [note, setNote] = useState({}), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  if (!data) return <ListSkeleton />;
  const list = data.declarations || [];
  const mark = async (email, index, status) => {
    const key = `${email}:${index}`;
    setBusy(true);
    const r = await api("PUT", `/api/tax-declarations/${encodeURIComponent(email)}/proofs`, { index, status, note: note[key] || "" });
    setBusy(false);
    if (!r.ok) { setErr({ ...err, [key]: (r.data && r.data.errors && (r.data.errors.note || r.data.errors.status || r.data.errors.index)) || apiMsg(r) }); return; }
    setErr({ ...err, [key]: "" }); setNote({ ...note, [key]: "" });
    toast(status === "waiting" ? "The proof note was cleared." : "The proof status was saved."); reload();
  };
  const count = (x) => { const n = x.items.filter((i) => i.proof && i.proof.status === "verified").length; return x.items.length ? `${n} of ${x.items.length} verified` : "Nothing to prove"; };
  return (
    <>
      {error && <Callout>{error}</Callout>}
      <div className="card">{list.length ? (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Employee</th><th>Regime</th><th>Total declared</th><th>Proofs</th><th>Submitted</th><th><span className="sr-only">Proofs</span></th></tr></thead>
          <tbody>{list.map((x) => {
            const on = open === x.person.email;
            return [
              <tr key={x.person.email}><td><PersonCell person={person(x.person)} /></td><td>{x.regime === "old" ? "Old" : "New"}</td><td className="num-cell">{inr(x.total)}</td>
                <td>{count(x)}</td><td>{when(x.submittedAt)}</td>
                <td className="text-right">{x.items.length > 0 && <button type="button" className="btn glass sm" aria-expanded={on} onClick={() => setOpen(on ? null : x.person.email)}>{on ? "Close" : verifies ? "Check proofs" : "See proofs"}</button>}</td></tr>,
              on && <tr key={`${x.person.email}-proofs`}><td colSpan={6} className="bg-tint">
                <ul className="m-0 flex list-none flex-col gap-4 p-0 py-2">{x.items.map((it, i) => {
                  const key = `${x.person.email}:${i}`, id = `proof-note-${i}`;
                  return (
                    <li key={i} className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><b className="font-bold">{it.section}</b><span>{it.description || "No description"}</span><span className="num-cell">{inr(it.amount)}</span>
                        {it.proof ? <Pill tone={PROOF[it.proof.status][1]}>{PROOF[it.proof.status][0]}</Pill> : <Pill>{it.file ? "Proof to check" : "Waiting for proof"}</Pill>}
                        {it.file && <a className="btn link nolink" href={`/api/tax-declarations/${encodeURIComponent(x.person.email)}/proofs/${i}/file`} target="_blank" rel="noreferrer">Open {it.file.name}</a>}{it.proof && it.proof.note && <span className="text-[13px] text-ink-dim">{it.proof.note}</span>}</div>
                      {verifies && x.person.email.toLowerCase() !== user.email.toLowerCase() && <div className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={id}>Note for {it.section}, line {i + 1}</label>
                        <input id={id} className="input max-w-[420px] min-w-0 flex-1 basis-[220px]" maxLength={300} placeholder="Note for the person (needed when a proof is sent back)" value={note[key] || ""} onChange={(e) => setNote({ ...note, [key]: e.target.value })} aria-invalid={!!err[key]} />
                        <button type="button" className="btn glass sm" disabled={busy} onClick={() => mark(x.person.email, i, "received")}>Received</button>
                        <button type="button" className="btn primary sm" disabled={busy} onClick={() => mark(x.person.email, i, "verified")}>Verified</button>
                        <button type="button" className="btn glass sm" disabled={busy} onClick={() => mark(x.person.email, i, "rejected")}>Send back</button>
                        {it.proof && <button type="button" className="btn link nolink" disabled={busy} onClick={() => mark(x.person.email, i, "waiting")}>Clear</button>}
                      </div>}
                      {err[key] && <span className="ferr" role="alert">{err[key]}</span>}
                    </li>);
                })}</ul>
              </td></tr>,
            ];
          })}</tbody>
        </table></div>) : <div className="empty">No one has submitted a declaration for this financial year yet.</div>}
      </div>
    </>
  );
}
