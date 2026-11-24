import { useEffect, useState } from "react";
import PeoplePicker from "../../components/PeoplePicker.jsx";
import { useData } from "../../data.jsx";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { Callout, CardSkeleton, PersonCell, Pill, SectionHead, Stat, ViewTabs, ListSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { useList, usePerson, when } from "./shared.jsx";

const PREVIOUS = ["Previous employer salary", "Previous employer TDS", "Income from other sources", "Let-out property"];   // kept under both regimes
const SECTIONS = ["80C", "80D", "80D parents", "HRA", "80GG", "Leave travel", "Home loan interest", "NPS", "80E", "80EEA", "80G", "80TTA", "80DD", "80DDB", "80U", "Other", ...PREVIOUS];
const INCOME_LINES = ["Previous employer salary", "Income from other sources", "Let-out property"];   // income always counts: nothing to approve
/* What each section is, in the list: the section and what it is for. */
const LABEL = { "80C": "80C: PPF, ELSS, LIC, tuition fees", "80D": "80D: health insurance, self and family", "80D parents": "80D: health insurance, parents",
  HRA: "HRA: rent paid", "80GG": "80GG: rent paid, no HRA in salary", "Leave travel": "Leave travel (LTA)", "Home loan interest": "Home loan interest, own house",
  NPS: "80CCD(1B): own NPS", "80E": "80E: education loan interest", "80EEA": "80EEA: first home loan interest", "80G": "80G: donations",
  "80TTA": "80TTA/80TTB: savings or deposit interest", "80DD": "80DD: dependant with a disability", "80DDB": "80DDB: treatment of a specified illness", "80U": "80U: own disability",
  Other: "Other deductions", "Let-out property": "Let-out house: rent received" };
/* The tick that changes a section's limit. */
const FLAG = { "80D": ["senior", "Someone covered is 60 or older (limit ₹50,000 instead of ₹25,000)"], "80D parents": ["senior", "A parent covered is 60 or older (limit ₹50,000 instead of ₹25,000)"],
  "80DDB": ["senior", "The patient is 60 or older (limit ₹1,00,000 instead of ₹40,000)"], "80DD": ["severe", "Severe disability, 80% or more (₹1,25,000 instead of ₹75,000)"],
  "80U": ["severe", "Severe disability, 80% or more (₹1,25,000 instead of ₹75,000)"] };
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
/* What HR has noted about the proof for a line: the words staff see, and the pill's tone. */
const PROOF = { received: ["Proof received", "info"], verified: ["Proof verified", "ok"], rejected: ["Proof needs another look", "bad"] };
const NUM = "num-cell text-right";
const TOTAL_ROW = "font-bold [&>td]:border-t-2 [&>td]:border-line";
const monthName = (p) => new Date(`${p}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const toNum = (v) => { const n = Number(String(v == null ? "" : v).replace(/[₹,\s]/g, "")); return Number.isFinite(n) ? n : 0; };

/* Pay > Tax declaration, as in Keka: choose the regime, declare claims (old regime) and income from a previous employer or
   other sources (either regime), add proofs, download Form 124, and see the year's tax under both regimes. Payroll uses the
   submitted declaration in the monthly TDS until it enters its own tax details, with its proof decisions applied. Payroll
   checks proofs (approving the full amount, a lower amount, or sending it back), sets the due dates, reopens them for one person and
   answers requests for a late change. "For your return" gives the year's figures for filing the income tax return. */
export default function Tax() {
  const { can, canAll } = useAuth();
  const seesOthers = can("payroll.view");   // others' declarations, for the people in scope
  const sets = canAll("payroll.prepare");   // the regime policy: payroll sets the default regime and uploads the policy document
  const [tab, setTab] = useState("mine");
  const views = [["mine", "My declaration"], ["return", "For your return"], ...(seesOthers ? [["all", "Submitted by everyone"]] : []), ...(sets ? [["policy", "Policy and dates"]] : [])];
  return (
    <section className="section">
      <SectionHead title="Tax declaration" sub="Choose your tax regime for the year and declare what you plan to claim. Payroll reads this when it works out your tax."
        tabs={<ViewTabs label="Tax" view={tab} onView={setTab} views={views} />} />
      {tab === "all" && seesOthers ? <Everyone /> : tab === "policy" && sets ? <Policy /> : tab === "return" ? <YearSummary /> : <Mine />}
    </section>
  );
}

/* What to write in a line's description, by section. */
const HINT = { "80C": "For example: PPF, ELSS, LIC (your salary PF is added for you)", "80D": "For example: family floater policy", "80D parents": "For example: parents' health insurance", "80GG": "For example: flat rent, no HRA in my salary",
  "80E": "For example: education loan interest", "80EEA": "For example: first home loan interest", "80G": "For example: PM CARES Fund", "80TTA": "For example: savings account interest",
  "80DD": "For example: care of a dependant", "80DDB": "For example: treatment for a specified illness", "80U": "For example: own disability", "Let-out property": "For example: flat in Pune, let out", HRA: "For example: flat rent, April to March",
  "Leave travel": "For example: family trip to Jaipur", "Home loan interest": "For example: home loan for my flat", NPS: "For example: NPS Tier 1, own contribution",
  Other: "For example: 80E education loan interest", "Income from other sources": "For example: savings interest" };
const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

/* Lines that name someone on Form 124: the landlord for rent, the lender for home loan interest. */
const PARTY = { HRA: { who: "landlord", rel: true }, "80GG": { who: "landlord" }, "Home loan interest": { who: "lender" } };
const METROS = "Delhi, Mumbai, Kolkata, Chennai, Bengaluru, Hyderabad, Pune or Ahmedabad";
const proofPill = (it) => {
  if (!it.proof) return null;
  if (it.proof.status === "verified" && it.proof.approved != null) return <Pill tone="warn">{`Approved ${inr(it.proof.approved)} of ${inr(it.amount)}`}</Pill>;
  return <Pill tone={PROOF[it.proof.status][1]}>{PROOF[it.proof.status][0]}</Pill>;
};
/* When declarations and proofs close, in words, from the window the server sent. */
function WindowNote({ w }) {
  if (!w) return null;
  const say = (x, what) => {
    if (!x.due && !x.unlockedUntil) return null;
    if (x.unlockedUntil && x.open && (!x.due || w.today > x.due)) return `The payroll team reopened your ${what} until ${when(x.unlockedUntil)}.`;
    if (x.joinerUntil && x.open && x.due && w.today > x.due) return `As a new joiner, you can complete your ${what} until ${when(x.joinerUntil)}.`;
    return x.open ? `Please complete your ${what} by ${when(x.due)}.` : `${what[0].toUpperCase()}${what.slice(1)} closed on ${when(x.due)}. Please ask the payroll team if something needs to change.`;
  };
  const lines = [say(w.declaration, "declaration"), say(w.proof, "proofs")].filter(Boolean);
  return lines.length ? <p className="m-0 text-[15px] text-ink-dim">{lines.join(" ")}</p> : null;
}

/* A leave travel line: the journey, as Form 124 and the proof check need it. */
const MODES = [["air", "Air, economy class"], ["rail", "Rail, AC first class"], ["road", "Road, first class or deluxe bus"]];
function Journey({ it, i, fy, setParty }) {
  const p = it.party, n = i + 1, min = fy ? `${fy}-04-01` : undefined, max = fy ? `${fy + 1}-03-31` : undefined;
  const label = "flex min-w-0 flex-col gap-1 text-[14px] text-ink-dim";
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 max-sm:grid-cols-1">
      <input className="input" aria-label={`Journey started from, line ${n}`} placeholder="From (city)" maxLength={80} value={p.from || ""} onChange={setParty(i, "from")} />
      <input className="input" aria-label={`Journey went to, line ${n}`} placeholder="To (a place in India)" maxLength={80} value={p.to || ""} onChange={setParty(i, "to")} />
      <label className={label}>Journey started<input className="input" type="date" min={min} max={max} value={p.startOn || ""} onChange={setParty(i, "startOn")} /></label>
      <label className={label}>Journey ended<input className="input" type="date" min={p.startOn || min} value={p.endOn || ""} onChange={setParty(i, "endOn")} /></label>
      <select className="input" aria-label={`How you travelled, line ${n}`} value={p.mode || ""} onChange={setParty(i, "mode")}><option value="">How you travelled</option>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <input className="input" aria-label={`Who travelled, line ${n}`} placeholder="Who travelled, for example: self, spouse, two children" maxLength={160} value={p.travellers || ""} onChange={setParty(i, "travellers")} />
      <label className="col-span-2 flex min-h-11 items-center gap-2 text-[15px] max-sm:col-span-1"><input type="checkbox" checked={!!p.carryForward} onChange={setParty(i, "carryForward")} />This journey is carried over from the previous block of four years</label>
      <span className="col-span-2 text-[14px] text-ink-dim max-sm:col-span-1">Enter the fare by the shortest route, up to the economy air or AC first class rail fare. Hotels, food and travel abroad do not count. Two journeys are exempt in each block of four calendar years (now 2026 to 2029), and one carried over from 2022 to 2025 can be added in 2026 only. The exemption is up to the leave travel allowance in your salary.</span>
    </div>
  );
}

/* A let-out house: the rent is the line's amount; the municipal tax and the home loan interest reduce it, and 30% is allowed for repairs. */
function LetOut({ it, i, setParty }) {
  const p = it.party, n = i + 1;
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 max-sm:grid-cols-1">
      <input className="input col-span-2 max-sm:col-span-1" aria-label={`Address of the house, line ${n}`} placeholder="Address of the house" maxLength={300} value={p.address || ""} onChange={setParty(i, "address")} />
      <label className="flex min-w-0 flex-col gap-1 text-[14px] text-ink-dim">Municipal tax paid for the year (₹)<input className="input" inputMode="decimal" placeholder="0" value={p.municipalTax ?? (p.municipalTaxMinor ? p.municipalTaxMinor / 100 : "")} onChange={setParty(i, "municipalTax")} /></label>
      <label className="flex min-w-0 flex-col gap-1 text-[14px] text-ink-dim">Home loan interest for the year (₹)<input className="input" inputMode="decimal" placeholder="0" value={p.interest ?? (p.interestMinor ? p.interestMinor / 100 : "")} onChange={setParty(i, "interest")} /></label>
      <input className="input" aria-label={`Name of the lender, line ${n}`} placeholder="Name of the lender (if there is a loan)" maxLength={120} value={p.lender || ""} onChange={setParty(i, "lender")} />
      <input className="input" aria-label={`PAN of the lender, line ${n}`} placeholder="PAN of the lender" maxLength={10} value={p.lenderPan || ""} onChange={setParty(i, "lenderPan")} />
      <input className="input col-span-2 max-sm:col-span-1" aria-label={`Address of the lender, line ${n}`} placeholder="Address of the lender" maxLength={300} value={p.lenderAddress || ""} onChange={setParty(i, "lenderAddress")} />
      <span className="col-span-2 text-[14px] text-ink-dim max-sm:col-span-1">Enter the rent you receive for the year as the amount. Payroll takes off the municipal tax, 30% for repairs and the loan interest. Under the old regime a loss reduces your other income by up to ₹2,00,000; the new regime counts only a profit.</span>
    </div>
  );
}

/* After the due date: ask payroll to reopen the declaration or the proofs, with a reason. */
function LateAsk({ w, requests, onSent }) {
  const toast = useToast();
  const closed = w ? ["declaration", "proof"].filter((k) => !w[k].open) : [];
  const [kind, setKind] = useState(closed[0] || "declaration"), [reason, setReason] = useState(""), [er, setEr] = useState({}), [busy, setBusy] = useState(false);
  if (!closed.length) return null;
  const k = closed.includes(kind) ? kind : closed[0];
  const asked = requests.find((x) => x.kind === k);
  const what = k === "proof" ? "proofs" : "declaration";
  const send = async () => {
    setBusy(true);
    const r = await api("POST", "/api/tax-declaration/late-requests", { kind: k, reason });
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors) || { reason: apiMsg(r) }); return; }
    setEr({}); setReason(""); onSent(r.data); toast("Your request was sent to the payroll team.");
  };
  return (
    <div className="rounded-card border border-line bg-tint p-4">
      <h4 className="m-0 font-display text-[17px]">Need to change something after the due date?</h4>
      {asked && asked.status === "pending" ? <p className="m-0 mt-2">You asked on {when(asked.createdAt)} to change your {what}. The payroll team will reply, and you will get a notification.</p> : <>
        {asked && asked.status === "declined" && <p className="m-0 mt-2">Your last request was declined{asked.note ? `: ${asked.note}` : "."}</p>}
        <p className="m-0 mt-2 text-[15px] text-ink-dim">Tell the payroll team what you need to change and why. If they agree, they reopen it for you until a date.</p>
        <div className="mt-3 flex flex-col gap-3">
          {closed.length > 1 && <div className="field m-0"><label htmlFor="tx-late-kind">What you need to change</label><select id="tx-late-kind" className="input" value={k} onChange={(e) => setKind(e.target.value)}><option value="declaration">My declaration</option><option value="proof">My proofs</option></select></div>}
          <div className="field m-0"><label htmlFor="tx-late-reason">What needs to change, and why</label>
            <textarea id="tx-late-reason" className="input min-h-24" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!er.reason} placeholder="For example: my rent receipts for January to March arrived after the due date." />
            {er.reason && <span className="ferr" role="alert">{er.reason}</span>}</div>
          <div><button type="button" className="btn glass" disabled={busy} onClick={send}>{busy ? "Sending…" : "Ask the payroll team"}</button></div>
        </div></>}
    </div>
  );
}

function Mine() {
  const toast = useToast();
  const { user } = useAuth();
  const [up, setUp] = useState(-1);
  const fileUrl = (i) => `/api/tax-declarations/${encodeURIComponent(user.email)}/proofs/${i}/file`;
  const reloadFiles = async () => { const r = await api("GET", "/api/tax-declaration"); if (r.ok) setD((cur) => ({ ...cur, window: r.data.window, items: cur.items.map((x, j) => ({ ...x, file: (r.data.items[j] || {}).file || null, proof: (r.data.items[j] || {}).proof || null })) })); };
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
  const load = (data) => setD({ ...data, saved: data.items.length, items: data.items.map((i) => ({ ...i, amount: String(i.amount), party: i.party || {} })) });
  useEffect(() => { api("GET", "/api/tax-declaration").then((r) => { if (r.ok) load(r.data); else { setError(apiMsg(r)); setD({ regime: "new", items: [], status: "draft" }); } }); }, []);
  if (!d) return <ListSkeleton />;
  const set = (i, k) => (e) => setD({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) });
  const setParty = (i, k) => (e) => setD({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, party: { ...x.party, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value } } : x)) });
  const old = d.regime === "old";
  const sections = old ? SECTIONS : PREVIOUS;
  const canEdit = !d.window || d.window.declaration.open, canProve = !d.window || d.window.proof.open;
  const form = (d.financialYear || 0) >= 2026 ? "Form 124" : "Form 12BB";
  const total = d.items.filter((i) => !PREVIOUS.includes(i.section)).reduce((n, i) => n + toNum(i.amount), 0);   // deductions only, not salary or TDS
  const save = async (submit) => {
    setBusy(true);
    const r = await api("PUT", "/api/tax-declaration", { regime: d.regime, items: d.items, submit });
    setBusy(false);
    if (!r.ok) { setErr((r.data && r.data.errors) || {}); setError(r.data && r.data.errors ? "Please check the lines marked below." : apiMsg(r)); return; }
    setErr({}); setError(""); load({ ...r.data, policy: d.policy, lateRequests: d.lateRequests });
    toast(submit ? "Your declaration was sent to payroll." : "Your draft was saved.");
  };
  return (
    <>
      {error && <Callout>{error}</Callout>}
      <div className="card"><div className="card-h"><h3>Financial year {d.financialYear} to {d.financialYear + 1}</h3>{d.status === "submitted" ? <Pill tone="ok">Submitted {when(d.submittedAt)}</Pill> : <Pill tone="warn">Draft</Pill>}</div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <WindowNote w={d.window} />
          <LateAsk w={d.window} requests={d.lateRequests || []} onSent={(x) => setD({ ...d, lateRequests: [...(d.lateRequests || []).filter((y) => y.kind !== x.kind), x] })} />
          {d.policy && d.policy.set && (
            <p className="muted" style={{ margin: 0 }}>
              Your company&rsquo;s policy makes the <b>{d.policy.defaultRegime === "old" ? "Old" : "New"} regime</b> the default.{d.regime === d.policy.defaultRegime ? " It is selected for you, and you can change it." : ` You have chosen the ${d.regime === "old" ? "Old" : "New"} regime instead.`}
              {d.policy.document && <> <a className="btn link nolink" href="/api/tax-declaration/policy/document" target="_blank" rel="noreferrer">Read the policy document</a></>}
            </p>)}
          <fieldset disabled={!canEdit} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
          <div className="tx-regime" role="radiogroup" aria-label="Tax regime">
            <label><input type="radio" name="regime" checked={d.regime === "new"} onChange={() => setD({ ...d, regime: "new" })} /><span><b>New regime</b>Lower rates, with no deductions to declare.{(d.policy ? d.policy.defaultRegime : "new") === "new" && " This is the company default."}</span></label>
            <label><input type="radio" name="regime" checked={d.regime === "old"} onChange={() => setD({ ...d, regime: "old" })} /><span><b>Old regime</b>Higher rates, with deductions for investments, insurance, rent and home loans.{d.policy && d.policy.defaultRegime === "old" && " This is the company default."}</span></label>
          </div>
            <div className="field"><span className="lab">{old ? "What you plan to claim" : "Income from a previous employer or other sources this year"}</span>
              <span className="text-[14px] text-ink-dim">If you joined during this financial year, add the salary your previous employer paid you and the TDS they deducted (from Form 122, earlier Form 12B, or their Form 16). Add interest, rent you receive or other income under Income from other sources. Payroll then works out your tax on the whole year.</span>
              {d.items.map((it, i) => {
                const party = old && PARTY[it.section];
                return (
                <div key={i}><div className="tx-line">
                  <select className="input" aria-label={`Section, line ${i + 1}`} value={it.section} onChange={set(i, "section")}>{(sections.includes(it.section) ? sections : [it.section, ...sections]).map((s) => <option key={s} value={s}>{LABEL[s] || s}</option>)}</select>
                  <input className="input" aria-label={`Description, line ${i + 1}`} placeholder={HINT[it.section] || "The previous employer's name"} maxLength={120} value={it.description} onChange={set(i, "description")} />
                  <input className="input" aria-label={`Amount in rupees for the year, line ${i + 1}`} inputMode="decimal" placeholder="Amount for the year" value={it.amount} onChange={set(i, "amount")} aria-invalid={!!err[`item${i}`]} />
                  <button type="button" className="btn glass sm" onClick={() => setD({ ...d, items: d.items.filter((_, j) => j !== i) })} aria-label={`Remove line ${i + 1}`}>Remove</button>
                </div>{err[`item${i}`] && <span className="ferr" role="alert">{err[`item${i}`]}</span>}
                  {party && <div className="mt-2 grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                    <input className="input" aria-label={`Name of the ${party.who}, line ${i + 1}`} placeholder={`Name of the ${party.who}`} maxLength={120} value={it.party.name || ""} onChange={setParty(i, "name")} />
                    <input className="input" aria-label={`PAN of the ${party.who}, line ${i + 1}`} placeholder={`PAN of the ${party.who}${it.section === "HRA" ? " (needed above ₹1,00,000 a year)" : ""}`} maxLength={10} value={it.party.pan || ""} onChange={setParty(i, "pan")} />
                    <input className="input col-span-2 max-sm:col-span-1" aria-label={`Address of the ${party.who}, line ${i + 1}`} placeholder={`Address of the ${party.who}`} maxLength={300} value={it.party.address || ""} onChange={setParty(i, "address")} />
                    {party.rel && <input className="input" aria-label={`Your relationship with the landlord, line ${i + 1}`} placeholder="Your relationship with the landlord, if any" maxLength={60} value={it.party.relationship || ""} onChange={setParty(i, "relationship")} />}
                    {party.rel && <label className="flex min-h-11 items-center gap-2 text-[15px]"><input type="checkbox" checked={!!it.party.metro} onChange={setParty(i, "metro")} />I live in {METROS}</label>}
                  </div>}
                  {old && it.section === "Leave travel" && <Journey it={it} i={i} fy={d.financialYear} setParty={setParty} />}
                  {old && FLAG[it.section] && <label className="mt-2 flex min-h-11 items-center gap-2 text-[15px]"><input type="checkbox" checked={!!it.party[FLAG[it.section][0]]} onChange={setParty(i, FLAG[it.section][0])} />{FLAG[it.section][1]}</label>}
                  {it.section === "Let-out property" && <LetOut it={it} i={i} setParty={setParty} />}
                  {err[`party${i}`] && <span className="ferr" role="alert">{err[`party${i}`]}</span>}
                  {!old && !PREVIOUS.includes(it.section) && <span className="text-[14px] text-ink-dim">The new regime has no deductions, so this line is removed when you save.</span>}
                  {it.proof && <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[14px] text-ink-dim">{proofPill(it)}{it.proof.note}</div>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[14px] text-ink-dim">
                    {i >= (d.saved || 0) ? <span>Save your declaration, then add the proof for this line.</span> : !canProve ? (it.file ? <a className="btn link nolink" href={fileUrl(i)} target="_blank" rel="noreferrer">{it.file.name}</a> : <span>Proofs are closed for this year.</span>) : it.file ? <>
                      <a className="btn link nolink" href={fileUrl(i)} target="_blank" rel="noreferrer">{it.file.name}</a>
                      <label className="btn glass sm">{up === i ? "Uploading…" : "Replace"}<input type="file" className="sr-only" accept={ACCEPT} disabled={up >= 0} aria-label={`Replace the proof for line ${i + 1}`} onChange={(e) => { upload(i, e.target.files[0]); e.target.value = ""; }} /></label>
                      <button type="button" className="btn glass sm" onClick={() => removeFile(i)} aria-label={`Remove the proof for line ${i + 1}`}>Remove proof</button></> :
                      <label className="btn glass sm">{up === i ? "Uploading…" : "Add proof"}<input type="file" className="sr-only" accept={ACCEPT} disabled={up >= 0} aria-label={`Proof for line ${i + 1}, as a PDF, JPG or PNG`} onChange={(e) => { upload(i, e.target.files[0]); e.target.value = ""; }} /></label>}
                  </div></div>);
              })}
              {err.journeys && <span className="ferr" role="alert">{err.journeys}</span>}
              {canEdit && d.items.length < 30 && <button type="button" className="btn link nolink" style={{ alignSelf: "flex-start" }} onClick={() => setD({ ...d, items: [...d.items, { section: old ? "80C" : PREVIOUS[0], description: "", amount: "", party: {} }] })}>Add a line</button>}
            </div>
            {old && <div className="tx-total"><span>Total deductions declared</span><span className="num-cell">{inr(total)}</span></div>}
          </fieldset>
          <Callout>Payroll uses what you declare when it works out your tax each month, until it checks your proofs. A claim payroll does not accept, or approves for less, then counts for what was accepted, and after the proof date only proven claims count. Please add each proof to its line as a PDF, JPG or PNG of up to 10 MB. Saving here does not change a payslip that is already published.</Callout>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {d.saved > 0 && <a className="btn glass" href="/api/tax-declaration/form-124">Download {form}</a>}
            {canEdit && <><button type="button" className="btn glass" disabled={busy} onClick={() => save(false)}>Save draft</button><button type="button" className="btn primary" disabled={busy} onClick={() => save(true)}>{busy ? "Saving…" : "Submit to payroll"}</button></>}
          </div>
        </div>
      </div>
      <Estimate items={d.items} regime={d.regime} />
    </>
  );
}

/* "Work out my tax": the year's tax under both regimes from the person's salary in payroll and the lines on the page. */
function Estimate({ items, regime }) {
  const [e, setE] = useState(null), [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await api("POST", "/api/tax-declaration/estimate", { items });
    setBusy(false);
    setE(r.ok ? r.data : { available: false, message: apiMsg(r) });
  };
  const side = (k, title) => {
    const x = e.regimes[k];
    if (!x) return <div className="rounded-card border border-line p-4"><h4 className="m-0 font-display text-[17px]">{title}</h4><p className="m-0 mt-2 text-ink-dim">Not available for this year.</p></div>;
    const rows = [["Income for the year", x.grossIncome], ["Deductions", -x.totalDeductions], ["Taxable income", x.taxableIncome], ["Tax for the year", x.annualTax], ["Already deducted", -x.alreadyDeducted], ["Still to pay", x.remaining]];
    return (
      <div className={`rounded-card border p-4 ${e.better === k ? "border-maroon" : "border-line"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="m-0 font-display text-[17px]">{title}</h4>{e.better === k && <Pill tone="ok">Lower tax</Pill>}</div>
        <dl className="m-0 mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[15px]">
          {rows.map(([l, v]) => [<dt key={`${l}-l`} className="text-ink-dim">{l}</dt>, <dd key={`${l}-v`} className="m-0 text-right tabular-nums">{v < 0 ? `− ${inr(-v)}` : inr(v)}</dd>])}
          <dt className="font-bold">TDS each month from now</dt><dd className="m-0 text-right font-bold tabular-nums">{inr(x.monthly)}</dd>
        </dl>
        {x.noTdsRule && <p className="m-0 mt-2 text-[14px] text-ink-dim">Taxable income up to ₹12,00,000 carries no tax under the new regime.</p>}
        {k === "old" && x.age >= 60 && <p className="m-0 mt-2 text-[14px] text-ink-dim">As a senior citizen, nothing is taxed up to {x.age >= 80 ? "₹5,00,000" : "₹3,00,000"} under the old regime.</p>}
        {x.hra && x.hra.exemption > 0 && <p className="m-0 mt-2 text-[14px] text-ink-dim">Includes an HRA exemption of {inr(x.hra.exemption)} from your rent.</p>}
        {x.lta && x.lta.fares > 0 && <p className="m-0 mt-2 text-[14px] text-ink-dim">{x.lta.exemption > 0 ? `Includes a leave travel exemption of ${inr(x.lta.exemption)}, up to your leave travel allowance for the year.` : "Your salary has no leave travel allowance, so your travel fares give no exemption."}</p>}
      </div>);
  };
  return (
    <div className="card"><div className="card-h"><h3>Your tax for the year</h3><button type="button" className="btn glass sm" disabled={busy} onClick={run}>{busy ? "Working it out…" : e ? "Work it out again" : "Work out my tax"}</button></div>
      <div className="card-b flex flex-col gap-4">
        {!e ? <p className="m-0 text-ink-dim">See your tax for the year under both regimes, from your salary in payroll and the lines above (saved or not), before you choose.</p>
          : !e.available ? <Callout>{e.message}</Callout> : <>
            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">{side("new", "New regime")}{side("old", "Old regime")}</div>
            {e.regimes.new && e.regimes.old && <p className="m-0">{e.saving > 0 ? <>The <b>{e.better === "old" ? "Old" : "New"} regime</b> saves you about {inr(e.saving)} this year.</> : "Both regimes come to the same tax this year."}</p>}
            {e.fixedTds !== null && <p className="m-0 text-[14px] text-ink-dim">Payroll deducts a fixed TDS of {inr(e.fixedTds)} a month for you, agreed with the accountant, so your payslip may differ from this.</p>}
            {e.payrollEntered && <p className="m-0 text-[14px] text-ink-dim">The payroll team has entered your tax details for this year, and your payslip uses those.</p>}
            {e.regimes[regime] && <Computation x={e.regimes[regime]} regime={regime} />}
            <p className="m-0 text-[14px] text-ink-dim">An estimate from your monthly salary of {inr(e.monthlyGross)}. Your payslip each month is what counts.</p>
          </>}
      </div>
    </div>
  );
}

/* As Keka's income tax computation: the deductions, the tax slab by slab, and the TDS month by month, for the regime chosen. */
function Computation({ x, regime }) {
  const band = (b) => `${inr(b.from)} to ${b.to == null ? "above" : inr(b.to)}`;
  return (
    <details className="rounded-card border border-line p-4">
      <summary className="min-h-11 cursor-pointer content-center font-bold">How your tax is worked out ({regime === "old" ? "Old" : "New"} regime)</summary>
      <div className="mt-3 flex flex-col gap-4">
        <div><h4 className="m-0 mb-2 font-display text-[16px]">Deductions and exemptions</h4>
          {x.deductions.length ? <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[15px]">{x.deductions.map((l) => [<dt key={`${l.name}-l`} className="text-ink-dim">{l.name}{l.capped ? " (limit reached)" : ""}</dt>, <dd key={`${l.name}-v`} className="m-0 text-right tabular-nums">{inr(l.amount)}</dd>])}</dl> : <p className="m-0 text-ink-dim">None.</p>}
          {x.housePropertyIncome ? <p className="m-0 mt-2 text-[14px] text-ink-dim">Income from your let-out house: {x.housePropertyIncome < 0 ? `a loss of ${inr(-x.housePropertyIncome)}` : inr(x.housePropertyIncome)}, already in the income for the year.</p> : null}</div>
        <div><h4 className="m-0 mb-2 font-display text-[16px]">Tax by slab</h4>
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[15px]">
            {x.slabs.map((b) => [<dt key={`${b.from}-l`} className="text-ink-dim">{band(b)} at {b.rate}%</dt>, <dd key={`${b.from}-v`} className="m-0 text-right tabular-nums">{inr(b.tax)}</dd>])}
            {x.rebate > 0 && [<dt key="rb-l" className="text-ink-dim">Rebate (87A)</dt>, <dd key="rb-v" className="m-0 text-right tabular-nums">− {inr(x.rebate)}</dd>]}
            {x.surcharge > 0 && [<dt key="sc-l" className="text-ink-dim">Surcharge</dt>, <dd key="sc-v" className="m-0 text-right tabular-nums">{inr(x.surcharge)}</dd>]}
            <dt className="text-ink-dim">Health and education cess, 4%</dt><dd className="m-0 text-right tabular-nums">{inr(x.cess)}</dd>
            <dt className="border-t border-line pt-2 font-bold">Tax for the year</dt><dd className="m-0 border-t border-line pt-2 text-right font-bold tabular-nums">{inr(x.annualTax)}</dd>
          </dl></div>
        <div><h4 className="m-0 mb-2 font-display text-[16px]">TDS month by month</h4>
          <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0 max-sm:grid-cols-2">{x.schedule.map((m) => (
            <li key={m.period} className="rounded-field bg-tint px-3 py-2"><span className="block text-[13px] text-ink-dim">{monthName(m.period)}{m.paid ? ", deducted" : ""}</span><span className="tabular-nums">{inr(m.tds)}</span></li>))}</ul></div>
      </div>
    </details>
  );
}

/* HR (payroll.prepare): the default regime for the year and the policy document. When the policy changes, upload the new document and choose again. */
/* HR: the due dates for the year's declarations and proofs. */
function Dates({ p, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ declarationDue: p.declarationDue || "", proofDue: p.proofDue || "", joinerDays: p.joinerDays ?? "" }), [er, setEr] = useState({}), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await api("PUT", "/api/tax-declaration/policy/dates", f);
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors) || {}); if (!(r.data && r.data.errors)) toast(apiMsg(r)); return; }
    setEr({}); onSaved(r.data); toast("The due dates were saved.");
  };
  const fy = p.financialYear;
  return (
    <div className="card"><div className="card-h"><h3>Due dates</h3></div>
      <div className="card-b flex flex-col gap-4">
        <p className="m-0 text-ink-dim">After the declaration date people can no longer change their declaration or regime, and after the proof date they can no longer add proofs. From then on, only claims you have verified count in the tax. Leave a date empty for no limit. You can reopen either for one person below.</p>
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <div className="field"><label htmlFor="tx-ddue">Declarations close after</label><input id="tx-ddue" className="input" type="date" min={`${fy}-04-01`} max={`${fy + 1}-03-31`} value={f.declarationDue} onChange={(e) => setF({ ...f, declarationDue: e.target.value })} aria-invalid={!!er.declarationDue} />{er.declarationDue && <span className="ferr" role="alert">{er.declarationDue}</span>}</div>
          <div className="field"><label htmlFor="tx-pdue">Proofs close after</label><input id="tx-pdue" className="input" type="date" min={`${fy}-04-01`} max={`${fy + 1}-03-31`} value={f.proofDue} onChange={(e) => setF({ ...f, proofDue: e.target.value })} aria-invalid={!!er.proofDue} /><span className="hint">Usually at least 30 days after the declaration date.</span>{er.proofDue && <span className="ferr" role="alert">{er.proofDue}</span>}</div>
          <div className="field"><label htmlFor="tx-jdays">New joiners may declare for this many days after joining</label><input id="tx-jdays" className="input" type="number" min="0" max="180" inputMode="numeric" value={f.joinerDays} onChange={(e) => setF({ ...f, joinerDays: e.target.value })} aria-invalid={!!er.joinerDays} /><span className="hint">Even after the dates above. Leave empty for no extra time.</span>{er.joinerDays && <span className="ferr" role="alert">{er.joinerDays}</span>}</div>
        </div>
        <p className="m-0 text-[14px] text-ink-dim">Everyone who has not finished gets a reminder 7 days before each date and the day before.</p>
        <div><button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save due dates"}</button></div>
      </div>
    </div>
  );
}

/* HR: reopen the declaration or the proofs for one person after the due date (a new joiner, a proof sent back). */
function Reopen() {
  const toast = useToast();
  const { people } = useData();
  const staff = (people || []).map((x) => ({ email: x.email, name: x.name, title: x.title }));
  const { data, reload } = useList("/api/tax-declaration/unlocks");
  const [f, setF] = useState({ email: "", kind: "declaration", until: "" }), [er, setEr] = useState({}), [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    const r = await api("POST", "/api/tax-declaration/unlocks", f);
    setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors) || {}); if (!(r.data && r.data.errors)) toast(apiMsg(r)); return; }
    setEr({}); setF({ email: "", kind: f.kind, until: "" }); toast("It is reopened, and the person was told."); reload();
  };
  const close = async (u) => {
    const r = await api("DELETE", `/api/tax-declaration/unlocks/${encodeURIComponent(u.person.email)}/${u.kind}`);
    if (!r.ok) return toast(apiMsg(r));
    toast("It is closed again."); reload();
  };
  const list = (data && data.unlocks) || [];
  return (
    <div className="card"><div className="card-h"><h3>Reopen for one person</h3></div>
      <div className="card-b flex flex-col gap-4">
        <div className="grid grid-cols-[2fr_1fr_1fr] items-start gap-4 max-md:grid-cols-1">
          <div className="field"><label htmlFor="tx-who">Person</label><PeoplePicker id="tx-who" people={staff} value={f.email} onChange={(v) => setF({ ...f, email: v || "" })} />{er.email && <span className="ferr" role="alert">{er.email}</span>}</div>
          <div className="field"><label htmlFor="tx-kind">What to reopen</label><select id="tx-kind" className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="declaration">Declaration</option><option value="proof">Proofs</option></select></div>
          <div className="field"><label htmlFor="tx-until">Open until</label><input id="tx-until" className="input" type="date" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} aria-invalid={!!er.until} />{er.until && <span className="ferr" role="alert">{er.until}</span>}</div>
        </div>
        <div><button type="button" className="btn glass" disabled={busy} onClick={add}>{busy ? "Reopening…" : "Reopen"}</button></div>
        {!data ? <ListSkeleton rows={2} /> : list.length ? <ul className="m-0 flex list-none flex-col gap-2 p-0">{list.map((u) => (
          <li key={`${u.person.email}-${u.kind}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
            <span><b className="font-bold">{u.person.name}</b>: {u.kind === "proof" ? "proofs" : "declaration"} open until {when(u.until)}</span>
            <button type="button" className="btn glass sm" onClick={() => close(u)}>Close now</button></li>))}</ul>
          : <p className="m-0 text-ink-dim">Nothing is reopened at the moment.</p>}
      </div>
    </div>
  );
}

/* HR: requests to change a declaration or proofs after the due date. Approving reopens it for the person until the date chosen. */
function LateRequests({ onChanged }) {
  const toast = useToast();
  const { user } = useAuth();
  const { data, reload } = useList("/api/tax-declaration/late-requests");
  const [f, setF] = useState({}), [er, setEr] = useState({}), [busy, setBusy] = useState(false);
  const list = (data && data.requests) || [];
  const answer = async (x, decision) => {
    const v = f[x.id] || {};
    setBusy(true);
    const r = await api("PUT", `/api/tax-declaration/late-requests/${x.id}`, { decision, until: v.until || "", note: v.note || "" });
    setBusy(false);
    if (!r.ok) { setEr({ ...er, [x.id]: (r.data && r.data.errors && (r.data.errors.until || r.data.errors.note || r.data.errors.decision)) || apiMsg(r) }); return; }
    setEr({ ...er, [x.id]: "" }); toast(decision === "approved" ? "It is reopened, and the person was told." : "The request was declined, and the person was told."); reload(); if (decision === "approved") onChanged();
  };
  const set = (id, k) => (e) => setF({ ...f, [id]: { ...(f[id] || {}), [k]: e.target.value } });
  return (
    <div className="card"><div className="card-h"><h3>Requests for a late change</h3>{list.some((x) => x.status === "pending") && <Pill tone="warn">{list.filter((x) => x.status === "pending").length} waiting</Pill>}</div>
      <div className="card-b flex flex-col gap-4">
        {!data ? <ListSkeleton rows={2} /> : !list.length ? <p className="m-0 text-ink-dim">No one has asked for a late change this year.</p> :
          <ul className="m-0 flex list-none flex-col gap-4 p-0">{list.map((x) => (
            <li key={x.id} className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><b className="font-bold">{x.person.name}</b><span>{x.kind === "proof" ? "Proofs" : "Declaration"}, asked {when(x.createdAt)}</span>
                {x.status === "approved" ? <Pill tone="ok">{`Reopened until ${when(x.until)}`}</Pill> : x.status === "declined" ? <Pill tone="bad">Declined</Pill> : <Pill tone="warn">Waiting</Pill>}</div>
              <p className="m-0 text-[15px]">{x.reason}</p>
              {x.status !== "pending" && x.note && <p className="m-0 text-[14px] text-ink-dim">Note: {x.note}</p>}
              {x.status === "pending" && x.person.email.toLowerCase() !== user.email.toLowerCase() && <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-[14px] text-ink-dim">Open until<input className="input" type="date" value={(f[x.id] || {}).until || ""} onChange={set(x.id, "until")} /></label>
                <label className="sr-only" htmlFor={`late-note-${x.id}`}>Note for {x.person.name}</label>
                <input id={`late-note-${x.id}`} className="input min-w-0 flex-1 basis-[220px] max-sm:basis-full" maxLength={300} placeholder="Note for the person (needed to decline)" value={(f[x.id] || {}).note || ""} onChange={set(x.id, "note")} />
                <button type="button" className="btn primary sm" disabled={busy} onClick={() => answer(x, "approved")}>Approve</button>
                <button type="button" className="btn glass sm" disabled={busy} onClick={() => answer(x, "declined")}>Decline</button>
              </div>}
              {er[x.id] && <span className="ferr" role="alert">{er[x.id]}</span>}
            </li>))}</ul>}
      </div>
    </div>
  );
}

/* For your return: the year's figures from approved payslips, to file the income tax return with, and the steps to file. */
function YearSummary() {
  const [fy, setFy] = useState(null), [d, setD] = useState(null);
  useEffect(() => {
    setD(null);
    api("GET", `/api/tax-declaration/year-summary${fy ? `?fy=${fy}` : ""}`).then((r) => setD(r.ok ? r.data : { available: false, message: apiMsg(r) }));
  }, [fy]);
  if (!d) return <><div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2"><CardSkeleton lines={1} /><CardSkeleton lines={1} /><CardSkeleton lines={1} /><CardSkeleton lines={1} /></div><CardSkeleton lines={8} /></>;
  const year = d.financialYear || d.current, modern = year >= 2026;
  const cert = modern ? "Form 130" : "Form 16", credit = modern ? "Form 168" : "Form 26AS";
  const years = d.current ? [0, 1, 2, 3].map((n) => d.current - n) : [];
  const signed = (v) => (v < 0 ? `− ${inr(-v)}` : inr(v));
  const rows = d.available ? [
    ["Salary from this employer (taxable)", d.taxableSalary], ...(d.previousEmployerIncome ? [["Salary from a previous employer", d.previousEmployerIncome]] : []), ...(d.otherIncome ? [["Income from other sources", d.otherIncome]] : []), ...(d.housePropertyIncome ? [["Income from a let-out house (a loss is negative)", d.housePropertyIncome]] : []),
    ["Gross total income", d.grossIncome, true], ...d.deductions.map((l) => [l.name, -l.amount]), ["Taxable income", d.taxableIncome, true], ["Tax for the year, with cess", d.annualTax, true],
    ["TDS deducted by this employer", -d.tdsHere], ...(d.previousEmployerTds ? [["TDS deducted by a previous employer", -d.previousEmployerTds]] : []),
  ] : [];
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="field m-0"><label htmlFor="tx-ret-year">Financial year</label>
          <select id="tx-ret-year" className="input min-w-48" value={year || ""} onChange={(e) => setFy(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y} to {y + 1}</option>)}</select></div>
        {d.available && <button type="button" className="btn glass" onClick={() => window.print()}>Print or save as PDF</button>}
      </div>
      {!d.available ? <Callout>{d.message}</Callout> : <>
        {d.monthsLeft > 0 && <Callout>The year is not over yet: {d.monthsLeft === 1 ? "one more month is" : `${d.monthsLeft} more months are`} still to be paid, so these figures cover only the months paid so far and will change. Deductions count for the whole year, so the tax can look low until March. Please file with the figures after March, and see your tax for the whole year under My declaration.</Callout>}
        <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-xs:grid-cols-1">
          <Stat value={inr(d.taxableIncome)} label="Taxable income" /><Stat value={inr(d.annualTax)} label="Tax for the year" /><Stat value={inr(d.tdsTotal)} label="TDS already deducted" />
          {d.monthsLeft > 0 ? <Stat value={signed(d.balance)} label="Tax less TDS so far" />
            : <Stat value={inr(Math.abs(d.balance))} label={d.balance > 0 ? "Still to pay when you file" : d.balance < 0 ? "To be refunded when you file" : "Nothing more to pay"} alert={d.balance > 0} />}
        </div>
        <div className="card"><div className="card-h"><h3>How the tax is worked out</h3><Pill>{d.regime === "old" ? "Old regime" : "New regime"}</Pill></div>
          <div className="card-b flex flex-col gap-3">
            <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-[15px]">
              {rows.map(([l, v, strong]) => [<dt key={`${l}-l`} className={strong ? "font-bold" : "text-ink-dim"}>{l}</dt>, <dd key={`${l}-v`} className={`m-0 text-right tabular-nums ${strong ? "font-bold" : ""}`}>{signed(v)}</dd>])}
              <dt className="border-t border-line pt-2 font-bold">{d.monthsLeft > 0 ? "Tax less TDS so far" : d.balance > 0 ? "Still to pay" : d.balance < 0 ? "To be refunded" : "Balance"}</dt><dd className="m-0 border-t border-line pt-2 text-right font-bold tabular-nums">{d.monthsLeft > 0 ? signed(d.balance) : inr(Math.abs(d.balance))}</dd>
            </dl>
            <p className="m-0 text-[14px] text-ink-dim">{d.source === "payroll" ? "Uses the tax details the payroll team entered for you." : d.source === "employee" ? "Uses your submitted declaration, with the payroll team's proof decisions." : "No declaration was used, so only the standard deduction is counted."} Interest, rent or gains you did not declare here must still be added when you file. You may choose the other regime when you file if it gives lower tax.</p>
          </div>
        </div>
        <div className="card"><div className="card-h"><h3>Salary and TDS by month</h3></div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Month</th><th className="text-right">Salary</th><th className="text-right">Taxable salary</th><th className="text-right">Professional tax</th><th className="text-right">TDS</th></tr></thead>
            <tbody>{d.months.map((m) => <tr key={m.period}><td>{monthName(m.period)}</td><td className={NUM}>{inr(m.salary)}</td><td className={NUM}>{inr(m.taxable)}</td><td className={NUM}>{inr(m.pt)}</td><td className={NUM}>{inr(m.tds)}</td></tr>)}
              <tr className={TOTAL_ROW}><td>Total</td><td className={NUM}>{inr(d.totals.salary)}</td><td className={NUM}>{inr(d.totals.taxable)}</td><td className={NUM}>{inr(d.totals.pt)}</td><td className={NUM}>{inr(d.totals.tds)}</td></tr></tbody>
          </table></div>
          {(d.tdsChanges || []).length > 0 && <div className="border-t border-line px-6 py-4 max-sm:px-4">
            <h4 className="m-0 mb-2 font-display text-[16px]">Why your TDS changed</h4>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">{d.tdsChanges.map((c) => (
              <li key={c.period}><b className="font-bold">{monthName(c.period)}</b>: {inr(c.from)} to {inr(c.to)} ({c.to > c.from ? "up" : "down"} {inr(Math.abs(c.to - c.from))})
                <ul className="m-0 mt-1 pl-5 text-[15px] text-ink-dim">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul></li>))}</ul>
          </div>}
        </div></>}
      <div className="card print:hidden"><div className="card-h"><h3>Filing your return</h3></div>
        <div className="card-b">
          <ol className="m-0 flex flex-col gap-2 pl-5 text-[15px]">
            <li>After the year ends, the payroll team gives you {cert}{modern ? " (earlier Form 16)" : ""}, the official certificate of the tax deducted, by 15 June. It comes from the tax department&rsquo;s TRACES portal; this page is a working copy to check it against.</li>
            <li>Sign in to the <a href="https://www.incometax.gov.in/iec/foportal/" target="_blank" rel="noreferrer">income tax e-filing portal</a> and check that {credit}{modern ? " (earlier Form 26AS)" : ""} and the Annual Information Statement show the same TDS as above.</li>
            <li>Add any other income: savings and deposit interest, rent you receive, gains on shares or property.</li>
            <li>File by the due date, usually 31 July for salaried people, then verify the return online within 30 days.</li>
          </ol>
        </div>
      </div>
    </>
  );
}

function Policy() {
  const toast = useToast();
  const [p, setP] = useState(null), [pick, setPick] = useState("new"), [busy, setBusy] = useState(""), [error, setError] = useState(""), [tick, setTick] = useState(0);
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
      <Dates key={`${p.declarationDue}-${p.proofDue}-${p.joinerDays}`} p={p} onSaved={setP} />
      <LateRequests onChanged={() => setTick((t) => t + 1)} />
      <Reopen key={tick} />
    </>
  );
}

function Everyone() {
  const { user, canAll } = useAuth();
  const verifies = canAll("payroll.prepare");   // noting proofs is payroll work, never on your own declaration
  const { data, error, reload } = useList("/api/tax-declarations");
  const person = usePerson(), toast = useToast();
  const [open, setOpen] = useState(null), [note, setNote] = useState({}), [amt, setAmt] = useState({}), [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  if (!data) return <ListSkeleton />;
  const list = data.declarations || [];
  const mark = async (email, index, status) => {
    const key = `${email}:${index}`;
    setBusy(true);
    const r = await api("PUT", `/api/tax-declarations/${encodeURIComponent(email)}/proofs`, { index, status, note: note[key] || "", approved: status === "verified" ? amt[key] || "" : "" });
    setBusy(false);
    if (!r.ok) { setErr({ ...err, [key]: (r.data && r.data.errors && (r.data.errors.approved || r.data.errors.note || r.data.errors.status || r.data.errors.index)) || apiMsg(r) }); return; }
    setErr({ ...err, [key]: "" }); setNote({ ...note, [key]: "" }); setAmt({ ...amt, [key]: "" });
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
                <td>{count(x)}</td><td>{when(x.submittedAt)}<div><a className="btn link nolink" href={`/api/tax-declaration/form-124?email=${encodeURIComponent(x.person.email)}`}>{x.financialYear >= 2026 ? "Form 124" : "Form 12BB"}</a></div></td>
                <td className="text-right">{x.items.length > 0 && <button type="button" className="btn glass sm" aria-expanded={on} onClick={() => setOpen(on ? null : x.person.email)}>{on ? "Close" : verifies ? "Check proofs" : "See proofs"}</button>}</td></tr>,
              on && <tr key={`${x.person.email}-proofs`}><td colSpan={6} className="bg-tint">
                <ul className="sticky left-0 m-0 flex max-w-[calc(100vw-4rem)] list-none flex-col gap-4 p-0 py-2">{x.items.map((it, i) => {
                  const key = `${x.person.email}:${i}`, id = `proof-note-${i}`;
                  return (
                    <li key={i} className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><b className="font-bold">{it.section}</b><span>{it.description || "No description"}</span><span className="num-cell">{inr(it.amount)}</span>
                        {it.proof ? proofPill(it) : <Pill>{it.file ? "Proof to check" : "Waiting for proof"}</Pill>}
                        {it.file && <a className="btn link nolink" href={`/api/tax-declarations/${encodeURIComponent(x.person.email)}/proofs/${i}/file`} target="_blank" rel="noreferrer">Open {it.file.name}</a>}{it.proof && it.proof.note && <span className="text-[13px] text-ink-dim">{it.proof.note}</span>}</div>
                      {verifies && x.person.email.toLowerCase() !== user.email.toLowerCase() && <div className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={id}>Note for {it.section}, line {i + 1}</label>
                        <input id={id} className="input max-w-[420px] min-w-0 flex-1 basis-[220px] max-sm:max-w-none max-sm:basis-full" maxLength={300} placeholder="Note for the person (needed when a proof is sent back or a lower amount approved)" value={note[key] || ""} onChange={(e) => setNote({ ...note, [key]: e.target.value })} aria-invalid={!!err[key]} />
                        {!INCOME_LINES.includes(it.section) && <><label className="sr-only" htmlFor={`${id}-amt`}>Amount to approve for {it.section}, line {i + 1}</label>
                        <input id={`${id}-amt`} className="input w-40 min-w-0" inputMode="decimal" placeholder={`Approve ${inr(it.amount)}`} value={amt[key] || ""} onChange={(e) => setAmt({ ...amt, [key]: e.target.value })} /></>}
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
