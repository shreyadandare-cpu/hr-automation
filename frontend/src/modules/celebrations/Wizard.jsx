import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { Field } from "../../components/Modal.jsx";
import { Pill } from "../../components/ui.jsx";
import PhotoEditor from "./PhotoEditor.jsx";
import PersonAvatar from "../../components/PersonAvatar.jsx";
import { useToast } from "../../components/toast.jsx";
import { DEFAULTS, canvasToBlob, loadImage, renderPoster, welcomeMessage } from "./poster.js";

const STEPS = ["Occasion", "Employee photo", "Template", "Customize", "Preview", "Send"];
const MAX_PHOTO = 5 * 1024 * 1024;
const TEMPLATE = { birthday: { id: "birthday-classic", name: "Classic birthday", note: "Soft beige with a framed photo and a handwritten name." },
  welcome: { id: "welcome-blue", name: "Welcome blue", note: "Blue and navy with a round photo and a joining-date badge." } };
const shortDate = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return iso ? new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : ""; };

/* The six-step poster wizard: occasion -> photo -> template -> customize -> preview -> send. */
export default function Wizard({ overview, start, onClose, onDone }) {
  const toast = useToast();
  const [step, setStep] = useState(start.email ? 1 : 0);
  const [occasion, setOccasion] = useState(start.occasion || "");
  const [emp, setEmp] = useState(start.email ? overview.employees.find((e) => e.email === start.email) || null : null);
  const [f, setF] = useState({ heading: "", name: "", designation: "", joiningDate: "", message: "" });
  const [msgEdited, setMsgEdited] = useState(false);
  const [photo, setPhoto] = useState(null);        // { url, label }
  const [poster, setPoster] = useState(null);      // { blob, url }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState(0);
  const [job, setJob] = useState(null);            // the sent poster with its delivery progress
  const [adjust, setAdjust] = useState(false);   // the photo crop dialog
  const [list, setList] = useState(null);          // recipients, when HR asks to review them
  const logo = useRef(null);

  const profilePhoto = emp && emp.photoV ? `/api/profile/photo?email=${encodeURIComponent(emp.email)}&v=${emp.photoV}` : "";

  // Picking a person fills in everything from the employee record.
  const choose = useCallback((occ, e) => {
    setOccasion(occ); setEmp(e); setErr(""); setDraft(0); setPoster(null); setMsgEdited(false);
    const d = DEFAULTS[occ];
    setF(occ === "birthday"
      ? { heading: d.heading, name: e.name, designation: "", joiningDate: "", message: d.message }
      : { heading: d.heading, name: e.name, designation: e.title || "", joiningDate: e.start || overview.today, message: welcomeMessage(e.name, e.title) });
    setPhoto(e.photoV ? { url: `/api/profile/photo?email=${encodeURIComponent(e.email)}&v=${e.photoV}`, label: "Profile photo" } : null);
  }, [overview.today]);
  useEffect(() => { if (start.email && emp && !f.name) choose(start.occasion, emp); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (k, v) => {
    setF((p) => {
      const n = { ...p, [k]: v };
      if (occasion === "welcome" && !msgEdited && (k === "name" || k === "designation")) n.message = welcomeMessage(n.name, n.designation);
      return n;
    });
    if (k === "message") setMsgEdited(true);
    setPoster(null);
  };

  /* ---- drawing ---- */
  const draw = useCallback(async () => {
    if (!logo.current) logo.current = await loadImage("/wohlig-logo.png").catch(() => null);
    const img = photo ? await loadImage(photo.url).catch(() => null) : null;
    return renderPoster({ template: TEMPLATE[occasion].id, ...f, category: emp ? emp.employmentType : "", photo: img, logo: logo.current });
  }, [occasion, f, photo, emp]);
  const make = useCallback(async () => {
    setBusy(true); setErr("");
    try {
      const blob = await canvasToBlob(await draw());
      setPoster((old) => { if (old) URL.revokeObjectURL(old.url); return { blob, url: URL.createObjectURL(blob) }; });
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }, [draw]);
  // small live pictures on the template, customize and preview steps
  useEffect(() => { if (step >= 2 && step <= 4 && occasion && emp) { const t = setTimeout(make, step === 3 ? 350 : 0); return () => clearTimeout(t); } }, [step, f, photo]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (poster) URL.revokeObjectURL(poster.url); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- photo ---- */
  const upload = async (file) => {
    setErr("");
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type) || !/\.(jpe?g|png)$/i.test(file.name)) return setErr("Use a JPG, JPEG or PNG picture.");
    if (file.size > MAX_PHOTO) return setErr("The picture is larger than 5 MB. Choose a smaller one.");
    const url = URL.createObjectURL(file);
    try { await loadImage(url); } catch { URL.revokeObjectURL(url); return setErr("That file could not be read as a picture."); }
    if (photo && photo.url.startsWith("blob:")) URL.revokeObjectURL(photo.url);
    setPhoto({ url, label: file.name }); setPoster(null);
  };

  const adjusted = (url) => {
    if (photo && photo.url.startsWith("blob:")) URL.revokeObjectURL(photo.url);
    setPhoto({ url, label: "Adjusted photo" }); setPoster(null); setAdjust(false);
  };

  /* ---- steps 5 -> 6: save the draft and its poster ---- */
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const blob = poster ? poster.blob : await canvasToBlob(await draw());
      const body = { occasion, email: emp.email, ...f };
      const r = draft ? await api("PUT", `/api/celebrations/${draft}`, body) : await api("POST", "/api/celebrations", body);
      if (!r.ok) throw new Error(apiMsg(r));
      const id = draft || r.data.id;
      const up = await fetch(`/api/celebrations/${id}/poster`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: blob });
      if (!up.ok) throw new Error((await up.json().catch(() => null))?.error || "The poster could not be saved.");
      setDraft(id); setStep(5);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  /* ---- step 6: send, then watch the delivery ---- */
  const watch = useCallback(async (id) => {
    const r = await api("GET", `/api/celebrations/${id}`);
    if (r.ok) { setJob(r.data); return r.data.status; }
    return null;
  }, []);
  useEffect(() => {
    if (!job || job.status !== "sending") return;
    const t = setInterval(() => watch(job.id), 2000);
    return () => clearInterval(t);
  }, [job, watch]);
  useEffect(() => { if (job && job.status !== "sending") onDone(); }, [job && job.status]);   // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (retry) => {
    setBusy(true); setErr("");
    const r = await api("POST", `/api/celebrations/${draft}/${retry ? "retry" : "send"}`);
    setBusy(false);
    if (!r.ok) return setErr(apiMsg(r));
    await watch(draft);
    toast(retry ? "Retrying the emails that failed…" : "Sending to everyone…");
  };
  const review = async () => {
    if (list) return setList(null);
    const r = await api("GET", "/api/celebrations/recipients");
    if (r.ok) setList(r.data.people); else setErr(apiMsg(r));
  };

  /* ---- what each step needs before Next ---- */
  const ready = [!!emp, !!photo, true, f.heading.trim() && f.name.trim() && f.message.trim() && (occasion !== "welcome" || f.joiningDate), !!poster, false][step];
  const sending = job && job.status === "sending";
  const finished = job && job.status !== "sending" && job.status !== "draft";
  const pct = job && job.counts.total ? Math.round(((job.counts.sent + job.counts.failed + job.counts.skipped) / job.counts.total) * 100) : 0;

  const candidates = occasion === "birthday" ? overview.birthdaysToday : overview.joiners;
  const taken = (e) => (occasion === "birthday" ? e.birthdayAnnounced || e.announced : e.welcomeAnnounced || e.announced);
  const others = overview.employees.filter((e) => !candidates.some((c) => c.email === e.email));

  return (
    <div className="cel">
      <ol className="cel-steps" aria-label="Progress">
        {STEPS.map((s, i) => <li key={s} className={i === step ? "on" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}><i>{i < step ? "✓" : i + 1}</i>{s}</li>)}
      </ol>

      <div className="card"><div className="card-b" style={{ paddingTop: 22 }}>
        {err && <div className="err" role="alert" style={{ marginBottom: 16, background: "var(--bad-soft)", color: "var(--bad)", padding: "10px 14px", borderRadius: 12 }}>{err}</div>}

        {step === 0 && (
          <div style={{ display: "grid", gap: 22 }}>
            <div className="cel-occ">
              {[["birthday", "🎂", "Birthday wishes", "A birthday poster for a colleague."], ["welcome", "🎉", "Welcome a new employee or intern", "Announce someone who has just joined."]].map(([k, em, t, d]) => (
                <button key={k} type="button" className={occasion === k ? "on" : ""} onClick={() => { setOccasion(k); setEmp(null); }}><span className="em">{em}</span><b>{t}</b><span>{d}</span></button>))}
            </div>
            {occasion && (
              <div>
                <h3 style={{ margin: "0 0 4px" }}>{occasion === "birthday" ? "Today's birthdays" : "Recently joined (last 30 days)"}</h3>
                <div className="cel-pick card" style={{ marginTop: 10 }}>
                  {!candidates.length && <div className="empty">{occasion === "birthday" ? "Nobody has a birthday today." : "Nobody joined in the last 30 days."} Pick someone from the list below.</div>}
                  {candidates.map((e) => <PickRow key={e.email} e={e} occasion={occasion} on={emp && emp.email === e.email} taken={taken(e)} onPick={() => choose(occasion, overview.employees.find((x) => x.email === e.email) || e)} />)}
                </div>
                <div className="field" style={{ marginTop: 16, maxWidth: 420 }}>
                  <label htmlFor="cel-other">Someone else</label>
                  <select id="cel-other" className="input" value={emp && !candidates.some((c) => c.email === emp.email) ? emp.email : ""}
                    onChange={(ev) => { const e = overview.employees.find((x) => x.email === ev.target.value); if (e) choose(occasion, e); }}>
                    <option value="">Choose an employee…</option>
                    {others.map((e) => <option key={e.email} value={e.email} disabled={!!taken(e)}>{e.name}{e.title ? ` — ${e.title}` : ""}{taken(e) ? " (already announced)" : ""}</option>)}
                  </select>
                </div>
              </div>)}
          </div>)}

        {step === 1 && emp && (
          <div style={{ display: "grid", gap: 18 }}>
            <p style={{ margin: 0, color: "var(--ink-dim)" }}>Photo for <b>{emp.name}</b>. JPG, JPEG or PNG, up to 5 MB. A clear, front-facing picture works best.</p>
            <div className="cel-photo">
              {photo ? <img src={photo.url} alt={`${emp.name}'s photo`} /> : <label className="cel-drop" style={{ width: 280 }}><input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={(e) => upload(e.target.files[0])} /><b>Upload a photo</b><span>Click to choose a file</span></label>}
              <div style={{ display: "grid", gap: 10 }}>
                {photo && <span className="muted">{photo.label}</span>}
                <label className="btn glass sm" style={{ cursor: "pointer" }}>{photo ? "Replace photo" : "Choose a file"}<input type="file" hidden accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={(e) => { upload(e.target.files[0]); e.target.value = ""; }} /></label>
                {photo && <button type="button" className="btn glass sm" onClick={() => setAdjust(true)}>Adjust or crop</button>}
                {profilePhoto && (!photo || photo.url !== profilePhoto) && <button type="button" className="btn glass sm" onClick={() => { setPhoto({ url: profilePhoto, label: "Profile photo" }); setPoster(null); }}>Use their profile photo</button>}
              </div>
            </div>
          </div>)}

        {step === 2 && occasion && (
          <div style={{ display: "grid", gap: 14 }}>
            <p style={{ margin: 0, color: "var(--ink-dim)" }}>The design for this occasion. Your details are filled in from the employee record.</p>
            <div className="cel-tpl">
              <button type="button" className="on" aria-pressed="true">
                {poster ? <img className="cel-thumb" src={poster.url} alt="" /> : <div className="cel-thumb" />}
                <b>{TEMPLATE[occasion].name}</b><span className="muted">{TEMPLATE[occasion].note}</span>
              </button>
            </div>
          </div>)}

        {step === 3 && (
          <div className="cel-body">
            <div className="cel-form">
              <Field id="cel-h" label="Announcement heading"><input id="cel-h" className="input" maxLength={60} value={f.heading} onChange={(e) => edit("heading", e.target.value)} /></Field>
              <Field id="cel-n" label="Employee name"><input id="cel-n" className="input" maxLength={80} value={f.name} onChange={(e) => edit("name", e.target.value)} /></Field>
              {occasion === "welcome" && <>
                <Field id="cel-d" label="Designation"><input id="cel-d" className="input" maxLength={80} value={f.designation} onChange={(e) => edit("designation", e.target.value)} /></Field>
                <Field id="cel-j" label="Joining date"><input id="cel-j" type="date" className="input" value={f.joiningDate} onChange={(e) => edit("joiningDate", e.target.value)} /></Field>
              </>}
              <div className="wide"><Field id="cel-m" label="Greeting message" hint={`${f.message.length}/300. Edit it only if you need to.`}>
                <textarea id="cel-m" className="input" rows={3} maxLength={300} value={f.message} onChange={(e) => edit("message", e.target.value)} />
              </Field></div>
            </div>
            <div className="cel-thumb-box">{poster ? <img className="cel-thumb" src={poster.url} alt="Live preview" /> : <div className="cel-thumb" />}</div>
          </div>)}

        {step === 4 && (
          <div style={{ display: "grid", gap: 18 }}>
            <p style={{ margin: 0, color: "var(--ink-dim)" }}>This is exactly what everyone will receive.</p>
            <div className="cel-preview">{poster ? <img src={poster.url} alt={`${occasion} poster for ${f.name}`} /> : <div className="empty">{busy ? "Drawing the poster…" : "No poster yet."}</div>}</div>
          </div>)}

        {step === 5 && (
          <div className="cel-body">
            <div style={{ display: "grid", gap: 18 }}>
              <dl className="cel-facts">
                <dt>Announcement</dt><dd>{occasion === "birthday" ? "Birthday wishes" : "Welcome new employee"}</dd>
                <dt>Employee</dt><dd>{f.name}{occasion === "welcome" && f.designation ? ` — ${f.designation}` : ""}</dd>
                {occasion === "welcome" && <><dt>Joining date</dt><dd>{shortDate(f.joiningDate)}</dd></>}
                <dt>Subject</dt><dd>{occasion === "birthday" ? `Happy Birthday, ${emp.name}! 🎂` : `Welcome to Wohlig, ${emp.name}! 🎉`}</dd>
                <dt>Recipients</dt><dd>{overview.recipients} people · all active employees</dd>
              </dl>
              {!overview.mailReady && !job && <div className="cel-warn">Email is not set up on this server, so nothing can be sent yet. Add <code>SENDGRID_API_KEY</code> and <code>MAIL_FROM</code> to the backend settings and restart.</div>}
              {!job && <button type="button" className="btn link" style={{ justifySelf: "start" }} onClick={review}>{list ? "Hide recipient list" : "Review recipient list"}</button>}
              {list && !job && (
                <div className="cel-problems" aria-label="Recipients">
                  {list.map((p) => <div key={p.email}><b style={{ fontWeight: 600 }}>{p.name}</b><span style={{ color: p.skipped ? "var(--ink-faint)" : "var(--ink-dim)" }}>{p.skipped ? "no email sent" : p.email}</span></div>)}
                </div>)}
              {job && (
                <div style={{ display: "grid", gap: 12 }} aria-live="polite">
                  <div className="row" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <Pill tone={job.status === "sent" ? "ok" : job.status === "sending" ? "info" : "bad"}>{{ sending: "Sending…", sent: "Sent to everyone", partial: "Partly sent", failed: "Not sent" }[job.status]}</Pill>
                    <span className="muted">{job.counts.sent} sent{job.counts.failed ? ` · ${job.counts.failed} failed` : ""}{job.counts.skipped ? ` · ${job.counts.skipped} skipped` : ""} of {job.counts.total}</span>
                  </div>
                  <div className="cel-bar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100"><i style={{ width: `${pct}%` }} /></div>
                  {finished && job.problems.length > 0 && (
                    <>
                      <b>These {job.problems.length} could not be reached</b>
                      <div className="cel-problems">{job.problems.map((p) => <div key={p.email}><span style={{ color: "var(--ink)" }}>{p.name || p.email}</span><span>{p.error || "Not sent"}</span></div>)}</div>
                      <button type="button" className="btn primary sm" style={{ justifySelf: "start" }} disabled={busy} onClick={() => send(true)}>Retry the failed ones</button>
                    </>)}
                </div>)}
            </div>
            <div className="cel-thumb-box"><img className="cel-thumb" src={poster ? poster.url : `/api/celebrations/${draft}/poster`} alt="Poster to send" /></div>
          </div>)}
      </div></div>

      <div className="cel-actions">
        <button type="button" className="btn glass" onClick={onClose} disabled={sending}>{finished ? "Close" : "Cancel"}</button>
        <div className="grp">
          {step > 0 && step < 5 && <button type="button" className="btn glass" onClick={() => { setErr(""); setStep(step - 1); }}>Back</button>}
          {step === 4 && <>
            <button type="button" className="btn glass" onClick={() => setStep(3)}>Edit text</button>
            <button type="button" className="btn glass" disabled={!photo} onClick={() => setAdjust(true)}>Adjust photo</button>
            <button type="button" className="btn glass" disabled={busy} onClick={make}>{busy ? "Drawing…" : "Regenerate"}</button>
          </>}
          {step === 4 && <button type="button" className="btn primary" disabled={!ready || busy} onClick={save}>{busy ? "Saving…" : "Continue"}</button>}
          {step < 4 && <button type="button" className="btn primary" disabled={!ready} onClick={() => { setErr(""); setStep(step + 1); }}>Next</button>}
          {step === 5 && !job && <>
            <button type="button" className="btn glass" onClick={() => setStep(4)}>Back</button>
            <button type="button" className="btn primary" disabled={busy || !overview.mailReady} onClick={() => send(false)}>{busy ? "Starting…" : "Send announcement"}</button>
          </>}
        </div>
      </div>
      {adjust && photo && <PhotoEditor src={photo.url} onApply={adjusted} onClose={() => setAdjust(false)} />}
    </div>
  );
}

function PickRow({ e, occasion, on, taken, onPick }) {
  return (
    <label className={`cel-row${taken ? " off" : ""}`}>
      <input type="radio" name="cel-who" checked={!!on} disabled={!!taken} onChange={onPick} />
      <PersonAvatar email={e.email} name={e.name} />
      <span className="who"><b>{e.name}</b><span>{e.title || "—"}{occasion === "welcome" && e.start ? ` · joined ${shortDate(e.start)}` : ""}{e.employmentType && e.employmentType !== "Employee" ? ` · ${e.employmentType}` : ""}</span></span>
      {taken && <Pill tone="ok">Already announced</Pill>}
    </label>
  );
}
