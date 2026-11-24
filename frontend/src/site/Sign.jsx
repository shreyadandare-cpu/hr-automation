import { useEffect, useState } from "react";
import { BRAND } from "../brand.js";
import { Skeleton } from "../components/ui.jsx";
import SiteShell from "./SiteShell.jsx";

/* Signing an offer letter through the private link the candidate was emailed (/sign/<key>), as Keka Sign: read the letter, type
   your full name and confirm to accept, or decline with a reason. The signed copy can be downloaded as a PDF. */
const stamp = (t) => new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function Sign() {
  const key = location.pathname.split("/")[2] || "";
  const [d, setD] = useState(null), [err, setErr] = useState("");
  const load = () => fetch(`/api/sign/${encodeURIComponent(key)}`).then(async (r) => { const b = await r.json().catch(() => ({})); if (r.ok) setD(b); else setErr(b.error || "This link is not valid."); });
  useEffect(() => { document.title = `Offer letter | ${BRAND.company.name}`; load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SiteShell title="Offer letter">
      {err ? <div className="callout" role="alert">{err}</div>
        : !d ? <div role="status" aria-label="Loading" className="flex flex-col gap-3"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-80 w-full rounded-card" /></div>
        : <>
          <section className="flex flex-col gap-1"><h1 className="m-0 font-display text-[clamp(28px,4.5vw,40px)] leading-[1.15] font-medium">{d.title}</h1>
            <p className="m-0 text-ink-dim">An offer from {d.company} for {d.candidate}</p></section>
          <div className="grid grid-cols-[3fr_2fr] items-start gap-6 max-lg:grid-cols-1">
            <article className="card p-8 text-[16px] leading-relaxed whitespace-pre-line max-sm:p-5" aria-label="The offer letter">{d.text}</article>
            <Decide d={d} k={key} onDone={load} />
          </div>
        </>}
    </SiteShell>
  );
}

function Decide({ d, k, onDone }) {
  const [f, setF] = useState({ name: "", accept: false }), [er, setEr] = useState({}), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const [declining, setDeclining] = useState(false), [reason, setReason] = useState("");
  const pdf = <a className="btn glass flex w-full" href={`/api/sign/${encodeURIComponent(k)}/pdf`}>Download the letter (PDF)</a>;
  if (d.status === "signed") return <div className="card flex flex-col gap-3 p-6" role="status"><h2 className="m-0 font-display text-[22px] font-medium">You have accepted this offer</h2>
    <p className="m-0 text-ink-dim">Signed by {d.signedName} on {stamp(d.signedAt)}. Welcome to {d.company}; the HR team will be in touch about your first day.</p>{pdf}</div>;
  if (d.status === "declined") return <div className="card flex flex-col gap-2 p-6" role="status"><h2 className="m-0 font-display text-[22px] font-medium">You declined this offer</h2><p className="m-0 text-ink-dim">Thank you for letting us know.</p></div>;
  if (d.status !== "sent" || d.expired) return <div className="card flex flex-col gap-2 p-6"><h2 className="m-0 font-display text-[22px] font-medium">This offer can no longer be signed</h2><p className="m-0 text-ink-dim">Please contact the hiring team.</p></div>;
  const post = async (path, body) => { setBusy(true); setMsg(""); const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const b = await r.json().catch(() => ({})); setBusy(false); return { r, b }; };
  const sign = async (e) => {
    e.preventDefault();
    const { r, b } = await post(`/api/sign/${encodeURIComponent(k)}`, f);
    if (!r.ok) { setEr(b.errors || {}); if (!b.errors) setMsg(b.error || "The offer could not be signed. Please try again."); return; }
    onDone();
  };
  const decline = async () => { const { r, b } = await post(`/api/sign/${encodeURIComponent(k)}/decline`, { reason }); if (!r.ok) return setMsg(b.error || "Please try again."); onDone(); };
  return (
    <form className="card flex flex-col gap-4 p-6 max-sm:p-5" onSubmit={sign} noValidate aria-label="Sign the offer">
      <h2 className="m-0 font-display text-[22px] font-medium">Accept and sign</h2>
      <p className="m-0 text-[15px] text-ink-dim">Please sign by {stamp(d.signUntil)}. Typing your name below is your signature.</p>
      {msg && <div className="callout" role="alert">{msg}</div>}
      <div className="field m-0"><label htmlFor="sg-name">Your full name</label>
        <input id="sg-name" className="input font-display text-[20px]" autoComplete="name" maxLength={120} placeholder={d.candidate} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-invalid={!!er.name} />
        {er.name && <span className="ferr" role="alert">{er.name}</span>}</div>
      <label className="flex min-h-11 items-start gap-3 text-[15px]"><input type="checkbox" className="mt-1" checked={f.accept} onChange={(e) => setF({ ...f, accept: e.target.checked })} aria-invalid={!!er.accept} /><span>I have read this letter and I accept the offer from {d.company}.</span></label>
      {er.accept && <span className="ferr" role="alert">{er.accept}</span>}
      <button type="submit" className="btn primary lg flex w-full" disabled={busy}>{busy ? "Signing…" : "Sign and accept"}</button>
      {pdf}
      {!declining ? <button type="button" className="btn link self-center" onClick={() => setDeclining(true)}>I want to decline this offer</button> : (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <label htmlFor="sg-why" className="text-[15px] font-bold">Would you tell us why? (optional)</label>
          <textarea id="sg-why" className="input min-h-20" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="btn glass" disabled={busy} onClick={decline}>Decline the offer</button>
        </div>)}
    </form>
  );
}
