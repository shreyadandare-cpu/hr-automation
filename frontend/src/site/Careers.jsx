import { useEffect, useState } from "react";
import { BRAND } from "../brand.js";
import { Skeleton } from "../components/ui.jsx";
import SiteShell from "./SiteShell.jsx";

/* The public careers page, as Keka's career portal: the roles HR published, one role in full, and applying with a CV.
   The form sends the details first, then the CV with the key the server returns. A hidden "website" field catches bots. */
const get = async (url) => { const r = await fetch(url); return { ok: r.ok, data: await r.json().catch(() => null) }; };
const posted = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
const Facts = ({ j }) => <p className="m-0 text-[15px] text-ink-dim">{[j.dept, j.location, j.kind, j.experience && `${j.experience} experience`].filter(Boolean).join(" · ")}</p>;

export default function Careers() {
  const id = Number((location.pathname.match(/^\/careers\/(\d+)/) || [])[1]) || null;
  useEffect(() => { document.title = `Careers | ${BRAND.company.name}`; }, []);
  return <SiteShell title="Careers">{id ? <Job id={id} /> : <Jobs />}</SiteShell>;
}

function Jobs() {
  const [d, setD] = useState(null);
  useEffect(() => { get("/api/careers").then((r) => setD(r.ok ? r.data.jobs : [])); }, []);
  return (
    <>
      <section className="flex flex-col gap-3 pt-4">
        <h1 className="m-0 font-display text-[clamp(30px,5vw,44px)] leading-[1.1] font-medium">Work with {BRAND.company.name}</h1>
        <p className="m-0 max-w-2xl text-[17px] text-ink-dim">We build digital products with our clients. If one of these roles fits you, we would like to hear from you.</p>
      </section>
      {!d ? <div className="flex flex-col gap-3" role="status" aria-label="Loading"><Skeleton className="h-24 w-full rounded-card" /><Skeleton className="h-24 w-full rounded-card" /></div>
        : !d.length ? <div className="card"><div className="empty">There are no open roles at the moment. Please check again soon.</div></div>
        : <ul className="m-0 flex list-none flex-col gap-3 p-0">{d.map((j) => (
            <li key={j.id}><a href={`/careers/${j.id}`} className="card flex flex-wrap items-center justify-between gap-3 p-5 text-ink no-underline transition-[border-color] hover:border-maroon focus-visible:outline-2 focus-visible:outline-accent">
              <span className="min-w-0"><span className="block font-display text-[20px] font-medium">{j.title}</span><Facts j={j} /></span>
              <span className="btn glass sm">View role</span></a></li>))}</ul>}
    </>
  );
}

function Job({ id }) {
  const [j, setJ] = useState(null), [err, setErr] = useState("");
  useEffect(() => { get(`/api/careers/${id}`).then((r) => (r.ok ? setJ(r.data) : setErr((r.data && r.data.error) || "This role is no longer open."))); }, [id]);
  if (err) return <><a className="inline-flex min-h-11 items-center gap-2 self-start text-[15px] font-bold text-accent no-underline hover:underline" href="/careers"><span aria-hidden="true">←</span>All open roles</a><div className="callout" role="alert">{err}</div></>;
  if (!j) return <div role="status" aria-label="Loading" className="flex flex-col gap-3"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-40 w-full rounded-card" /></div>;
  return (
    <>
      <a className="inline-flex min-h-11 items-center gap-2 self-start text-[15px] font-bold text-accent no-underline hover:underline" href="/careers"><span aria-hidden="true">←</span>All open roles</a>
      <section className="flex flex-col gap-2"><h1 className="m-0 font-display text-[clamp(28px,4.5vw,40px)] leading-[1.15] font-medium">{j.title}</h1><Facts j={j} /><p className="m-0 text-[14px] text-ink-faint">Posted {posted(j.postedAt)}</p></section>
      <div className="grid grid-cols-[3fr_2fr] items-start gap-6 max-lg:grid-cols-1">
        <article className="card p-6 text-[16px] leading-relaxed whitespace-pre-line max-sm:p-5">{j.description || "Details will follow at the interview."}</article>
        <Apply job={j} />
      </div>
    </>
  );
}

function Apply({ job }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", link: "", note: "", consent: false, website: "" }), [file, setFile] = useState(null);
  const [er, setEr] = useState({}), [busy, setBusy] = useState(false), [done, setDone] = useState(false), [msg, setMsg] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const send = async (e) => {
    e.preventDefault();
    const local = {};   // the same checks the server makes, so every missing answer shows at once
    if (!f.name.trim()) local.name = "Please enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) local.email = "Please enter your email address.";
    if (!f.consent) local.consent = "Please agree that we may keep your details for this role.";
    if (!file) local.file = "Please attach your CV as a PDF or Word file.";
    else if (file.size > 5 * 1024 * 1024) local.file = "Please keep the CV under 5 MB.";
    if (Object.keys(local).length) { setEr(local); return; }   // nothing is sent until the CV is attached
    setBusy(true); setMsg("");
    const r = await fetch(`/api/careers/${job.id}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); setEr((body && body.errors) || {}); if (!(body && body.errors)) setMsg(body.error || "Your application could not be sent. Please try again."); return; }
    if (body.uploadKey && file) {
      const u = await fetch(`/api/careers/applications/${body.uploadKey}/resume?name=${encodeURIComponent(file.name)}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file });
      if (!u.ok) { const b = await u.json().catch(() => ({})); setBusy(false); setEr({ file: b.error || "Your CV could not be sent. Please email it to the hiring team." }); return; }
    }
    setBusy(false); setDone(true);
  };
  if (done) return <div className="card flex flex-col gap-2 p-6" role="status"><h2 className="m-0 font-display text-[22px] font-medium">Thank you for applying</h2><p className="m-0 text-ink-dim">We have your application for {job.title}. Our hiring team reads every one and will contact you by email if your profile fits.</p></div>;
  const field = (k, label, props = {}) => (
    <div className="field m-0"><label htmlFor={`ap-${k}`}>{label}</label><input id={`ap-${k}`} className="input" value={f[k]} onChange={set(k)} aria-invalid={!!er[k]} {...props} />{er[k] && <span className="ferr" role="alert">{er[k]}</span>}</div>);
  return (
    <form className="card flex flex-col gap-4 p-6 max-sm:p-5" onSubmit={send} noValidate aria-label={`Apply for ${job.title}`}>
      <h2 className="m-0 font-display text-[22px] font-medium">Apply for this role</h2>
      {msg && <div className="callout" role="alert">{msg}</div>}
      {field("name", "Full name", { autoComplete: "name", maxLength: 120 })}
      {field("email", "Email", { type: "email", autoComplete: "email", maxLength: 200 })}
      {field("phone", "Phone (optional)", { type: "tel", autoComplete: "tel", maxLength: 30 })}
      {field("link", "LinkedIn or portfolio link (optional)", { type: "url", placeholder: "https://", maxLength: 300 })}
      <div className="field m-0"><label htmlFor="ap-note">Why this role? (optional)</label><textarea id="ap-note" className="input min-h-24" maxLength={2000} value={f.note} onChange={set("note")} /></div>
      <div className="field m-0"><label htmlFor="ap-file">CV (PDF or Word, up to 5 MB)</label>
        <input id="ap-file" className="input" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files[0] || null)} aria-invalid={!!er.file} />
        {er.file && <span className="ferr" role="alert">{er.file}</span>}</div>
      <div className="absolute -left-[9999px]" aria-hidden="true"><label htmlFor="ap-website">Website</label><input id="ap-website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} /></div>
      <label className="flex min-h-11 items-start gap-3 text-[15px]"><input type="checkbox" className="mt-1" checked={f.consent} onChange={set("consent")} aria-invalid={!!er.consent} /><span>I agree that {BRAND.company.name} may keep my details and CV to consider me for this role.</span></label>
      {er.consent && <span className="ferr" role="alert">{er.consent}</span>}
      <button type="submit" className="btn primary lg flex w-full" disabled={busy}>{busy ? "Sending…" : "Send application"}</button>
    </form>
  );
}
