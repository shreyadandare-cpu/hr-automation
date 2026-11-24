import { useState } from "react";
import { api, apiMsg } from "../../api.js";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout, ListSkeleton, Pill, SectionHead } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { useList, when } from "../engage/shared.jsx";

/* Open roles and referrals, as Keka's internal job board: every open role, referring someone you know (with their CV), and how
   far the people you referred have got. The hiring team's notes are never shown here. */
const TONE = { Received: "mute", "In process": "info", Hired: "ok", "Not selected": "mute" };

export default function Jobs() {
  const { data, error } = useList("/api/jobs");
  const { data: mine, reload } = useList("/api/jobs/my-referrals");
  const [refer, setRefer] = useState(null), [open, setOpen] = useState(null);
  const toast = useToast();
  return (
    <section className="section">
      <SectionHead title="Open roles" sub="Roles we are hiring for. If you know someone who would be good, refer them: the hiring team sees who referred them." />
      {error && <Callout>{error}</Callout>}
      <div className="card">{!data ? <ListSkeleton rows={3} faces={false} /> : !(data.jobs || []).length ? <div className="empty">No roles are open right now.</div> :
        <ul className="m-0 flex list-none flex-col p-0">{data.jobs.map((j) => (
          <li key={j.id} className="flex flex-col gap-2 border-t border-line px-6 py-4 first:border-t-0 max-sm:px-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0"><b className="block font-display text-[18px] font-medium">{j.title}</b><span className="text-[14px] text-ink-dim">{[j.dept, j.location, j.kind, j.experience].filter(Boolean).join(" · ") || "Details from the hiring team"}</span></span>
              <span className="flex flex-wrap gap-2">
                {j.description && <button type="button" className="btn glass sm" aria-expanded={open === j.id} onClick={() => setOpen(open === j.id ? null : j.id)}>{open === j.id ? "Hide details" : "Details"}</button>}
                <button type="button" className="btn primary sm" onClick={() => setRefer(j)}>Refer someone</button></span>
            </div>
            {open === j.id && <p className="m-0 text-[15px] whitespace-pre-line text-ink-dim">{j.description}</p>}
          </li>))}</ul>}</div>
      <div className="card"><div className="card-h"><h3>People you referred</h3></div>
        {!mine ? <ListSkeleton rows={2} faces={false} /> : !(mine.referrals || []).length ? <div className="empty">You have not referred anyone yet.</div> :
          <ul className="m-0 flex list-none flex-col p-0">{mine.referrals.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-3 first:border-t-0 max-sm:px-4">
              <span><b className="font-bold">{x.name}</b><span className="block text-[14px] text-ink-dim">{x.role}, referred {when(x.referredAt)}</span></span><Pill tone={TONE[x.status]}>{x.status}</Pill></li>))}</ul>}
      </div>
      {refer && <Refer job={refer} onClose={(done) => { setRefer(null); if (done) { toast("Thank you. The hiring team has your referral."); reload(); } }} />}
    </section>
  );
}

function Refer({ job, onClose }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", link: "", note: "" }), [file, setFile] = useState(null), [er, setEr] = useState({}), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const send = async () => {
    if (file && file.size > 5 * 1024 * 1024) return setEr({ file: "Please keep the CV under 5 MB." });
    setBusy(true); setMsg("");
    const r = await api("POST", `/api/jobs/${job.id}/refer`, f);
    if (!r.ok) { setBusy(false); setEr((r.data && r.data.errors) || {}); if (!(r.data && r.data.errors)) setMsg(apiMsg(r)); return; }
    if (file) {
      const u = await fetch(`/api/jobs/referrals/${r.data.uploadKey}/resume?name=${encodeURIComponent(file.name)}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file });
      if (!u.ok) { const b = await u.json().catch(() => ({})); setBusy(false); setMsg(`The referral was sent, but the CV was not: ${b.error || "please send it to the hiring team."}`); return; }
    }
    setBusy(false); onClose(true);
  };
  return (
    <Modal onClose={busy ? () => {} : () => onClose(false)}>
      <div className="card-h"><h3>Refer someone for {job.title}</h3></div>
      <div className="card-b">
        {msg && <Callout>{msg}</Callout>}
        <Field id="rf-n" label="Their name" error={er.name}><input id="rf-n" className="input" maxLength={120} value={f.name} onChange={set("name")} aria-invalid={!!er.name} /></Field>
        <div className="grid grid-cols-2 gap-4 max-xs:grid-cols-1">
          <Field id="rf-e" label="Their email" error={er.email}><input id="rf-e" type="email" className="input" maxLength={200} value={f.email} onChange={set("email")} aria-invalid={!!er.email} /></Field>
          <Field id="rf-p" label="Phone (optional)" error={er.phone}><input id="rf-p" type="tel" className="input" maxLength={30} value={f.phone} onChange={set("phone")} aria-invalid={!!er.phone} /></Field>
        </div>
        <Field id="rf-l" label="LinkedIn or portfolio link (optional)" error={er.link}><input id="rf-l" type="url" className="input" placeholder="https://" maxLength={300} value={f.link} onChange={set("link")} aria-invalid={!!er.link} /></Field>
        <Field id="rf-t" label="Why they would be good (optional)"><textarea id="rf-t" className="input" rows={3} maxLength={2000} value={f.note} onChange={set("note")} /></Field>
        <Field id="rf-f" label="Their CV (optional, PDF or Word, up to 5 MB)" error={er.file}><input id="rf-f" type="file" className="input" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files[0] || null)} /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose(false)} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={send} disabled={busy}>{busy ? "Sending…" : "Send referral"}</button></div>
    </Modal>
  );
}
