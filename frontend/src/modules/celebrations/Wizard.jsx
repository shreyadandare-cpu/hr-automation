import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { Field } from "../../components/Modal.jsx";
import { Pill } from "../../components/ui.jsx";
import PhotoEditor from "../../components/PhotoEditor.jsx";
import PersonAvatar from "../../components/PersonAvatar.jsx";
import { useToast } from "../../components/toast.jsx";
import { OCCASIONS, canvasToBlob, defaultsFor, loadImage, msgFor, renderPoster } from "./poster.js";

const STEPS = ["Occasion", "Employee photo", "Template", "Customize", "Preview", "Send"];
const THEMES = [["maroon", "Maroon", "Deep maroon with cream text."], ["light", "Warm light", "Warm ivory with maroon text."]];
const ORDER = ["welcome", "birthday", "anniversary", "certified", "newrole"];
const shortDate = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return iso ? new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : ""; };
const SUBJECT = (occ, n) => ({ birthday: `Happy Birthday, ${n}!`, welcome: `Welcome to Wohlig, ${n}!`, anniversary: `Happy work anniversary, ${n}!`,
  certified: `Congratulations, ${n}, on your new certification!`, newrole: `Congratulations, ${n}, on your new role!` }[occ]);
const EMPTY = { heading: "", emphasis: "", name: "", designation: "", detail: "", joiningDate: "", message: "" };

/* The six-step poster wizard: occasion -> photo -> template -> customize -> preview -> send. */
export default function Wizard({ overview, start, onClose, onDone }) {
  const toast = useToast();
  const [step, setStep] = useState(start.email ? 1 : 0);
  const [occasion, setOccasion] = useState(start.occasion || "");
  const [emp, setEmp] = useState(start.email ? overview.employees.find((e) => e.email === start.email) || null : null);
  const [f, setF] = useState(EMPTY);
  const [theme, setTheme] = useState("maroon");
  const [msgEdited, setMsgEdited] = useState(false);
  const [photo, setPhoto] = useState(null);        // { url, label }, optional
  const [poster, setPoster] = useState(null);      // { blob, url }
  const [thumbs, setThumbs] = useState(null);      // both looks, for the template step
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState(0);
  const [job, setJob] = useState(null);            // the sent poster with its delivery progress
  const [adjust, setAdjust] = useState(false);     // the photo crop dialog
  const [list, setList] = useState(null);          // recipients, when HR asks to review them
  const assets = useRef(null);

  const profilePhoto = emp && emp.photoV ? `/api/profile/photo?email=${encodeURIComponent(emp.email)}&v=${emp.photoV}` : "";

  // Picking a person fills in everything from the employee record.
  const choose = useCallback((occ, e) => {
    setOccasion(occ); setEmp(e); setErr(""); setDraft(0); setPoster(null); setMsgEdited(false);
    setF(defaultsFor(occ, e, overview.today));
    setPhoto(e.photoV ? { url: `/api/profile/photo?email=${encodeURIComponent(e.email)}&v=${e.photoV}`, label: "Profile photo" } : null);
  }, [overview.today]);
  useEffect(() => { if (start.email && emp && !f.name) choose(start.occasion, emp); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (k, v) => {
    setF((p) => {
      const n = { ...p, [k]: v };
      if (!msgEdited && ["name", "designation", "detail"].includes(k)) n.message = msgFor(occasion, n);
      return n;
    });
    if (k === "message") setMsgEdited(true);
    setPoster(null);
  };

  /* ---- drawing ---- */
  const draw = useCallback(async (look = theme) => {
    if (!assets.current) {
      const [dark, light, mark] = await Promise.all(["/wohlig-logo-dark.svg", "/wohlig-logo.svg", "/google-cloud-mark.png"].map((u) => loadImage(u).catch(() => null)));
      assets.current = { logos: { dark, light }, mark };
    }
    const img = photo ? await loadImage(photo.url).catch(() => null) : null;
    return renderPoster({ occasion, theme: look, ...f, photo: img, ...assets.current });
  }, [occasion, theme, f, photo]);
  const make = useCallback(async () => {
    setBusy(true); setErr("");
    try {
      const blob = await canvasToBlob(await draw());
      setPoster((old) => { if (old) URL.revokeObjectURL(old.url); return { blob, url: URL.createObjectURL(blob) }; });
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }, [draw]);
  // live pictures on the template, customize and preview steps
  useEffect(() => {
    if (step < 2 || step > 4 || !occasion || !emp) return;
    const t = setTimeout(async () => {
      if (step === 2) {   // both looks side by side
        try {
          const made = await Promise.all(THEMES.map(async ([k]) => [k, URL.createObjectURL(await canvasToBlob(await draw(k)))]));
          setThumbs((old) => { if (old) Object.values(old).forEach(URL.revokeObjectURL); return Object.fromEntries(made); });
        } catch (e) { setErr(e.message); }
      } else make();
    }, step === 3 ? 350 : 0);
    return () => clearTimeout(t);
  }, [step, f, photo, theme]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (poster) URL.revokeObjectURL(poster.url); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- photo: the person's profile photo from My profile; HR can only crop it or leave it out ---- */
  const adjusted = (url) => {
    if (photo && photo.url.startsWith("blob:")) URL.revokeObjectURL(photo.url);
    setPhoto({ url, label: "Adjusted photo" }); setPoster(null); setAdjust(false);
  };
  
  /* ---- steps 5 -> 6: save the draft and its poster ---- */
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const blob = poster ? poster.blob : await canvasToBlob(await draw());
      const body = { occasion, email: emp.email, theme, ...f };
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
  const fieldsOk = (f.heading.trim() || f.emphasis.trim()) && f.name.trim()
    && (occasion !== "certified" || f.detail.trim()) && (occasion !== "newrole" || f.designation.trim())
    && ((occasion !== "welcome" && occasion !== "anniversary") || f.joiningDate);
  const ready = [!!emp, true, true, !!fieldsOk, !!poster, false][step];
  const sending = job && job.status === "sending";
  const finished = job && job.status !== "sending" && job.status !== "draft";
  const pct = job && job.counts.total ? Math.round(((job.counts.sent + job.counts.failed + job.counts.skipped) / job.counts.total) * 100) : 0;

  const NEW_ONLY = occasion === "certified" || occasion === "newrole";
  const candidates = { birthday: overview.birthdaysToday, welcome: overview.joiners, anniversary: overview.anniversariesToday }[occasion] || [];
  const taken = (e) => ({ birthday: e.birthdayAnnounced || e.announced, welcome: e.welcomeAnnounced || e.announced, anniversary: e.anniversaryAnnounced || e.announced }[occasion] || null);
  const others = overview.employees.filter((e) => !candidates.some((c) => c.email === e.email));
  const heading = { birthday: "Today's birthdays", welcome: "Recently joined (last 30 days)", anniversary: "Work anniversaries today" }[occasion];
  const none = { birthday: "Nobody has a birthday today.", welcome: "Nobody joined in the last 30 days.", anniversary: "Nobody has a work anniversary today." }[occasion];
  const roleLabel = occasion === "newrole" ? "New role" : "Designation";

  return (
    <div className="cel-page">
      <ol className="cel-steps" aria-label="Progress">
        {STEPS.map((s, i) => <li key={s} className={i === step ? "on" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}><i>{i < step ? "✓" : i + 1}</i>{s}</li>)}
      </ol>

      <div className="card"><div className="card-b" style={{ paddingTop: 22 }}>
        {err && <div className="err" role="alert" style={{ marginBottom: 16, background: "var(--bad-soft)", color: "var(--bad)", padding: "10px 14px", borderRadius: 12 }}>{err}</div>}

        {step === 0 && (
          <div style={{ display: "grid", gap: 22 }}>
            <div className="cel-occ">
              {ORDER.map((k) => (
                <button key={k} type="button" className={occasion === k ? "on" : ""} onClick={() => { setOccasion(k); setEmp(null); }}>
                  <span className="em">{OCCASIONS[k].emoji}</span><b>{OCCASIONS[k].name}</b><span>{OCCASIONS[k].note}</span></button>))}
            </div>
            {occasion && (
              <div>
                {!NEW_ONLY && <>
                  <h3 style={{ margin: "0 0 4px" }}>{heading}</h3>
                  <div className="cel-pick card" style={{ marginTop: 10 }}>
                    {!candidates.length && <div className="empty">{none} Pick someone from the list below.</div>}
                    {candidates.map((e) => <PickRow key={e.email} e={e} occasion={occasion} on={emp && emp.email === e.email} taken={taken(e)} onPick={() => choose(occasion, overview.employees.find((x) => x.email === e.email) || e)} />)}
                  </div></>}
                <div className="field" style={{ marginTop: NEW_ONLY ? 0 : 16, maxWidth: 420 }}>
                  <label htmlFor="cel-other">{NEW_ONLY ? "Who is it for?" : "Someone else"}</label>
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
            <p style={{ margin: 0, color: "var(--ink-dim)" }}>The photo comes from <b>{emp.name}</b>'s profile in this platform. You can crop it or leave it out.</p>
            {photo ? (
              <div className="cel-photo">
                <img src={photo.url} alt={`${emp.name}'s photo`} />
                <div style={{ display: "grid", gap: 10 }}>
                  <span className="muted">{photo.label}</span>
                  <button type="button" className="btn glass sm" onClick={() => setAdjust(true)}>Adjust or crop</button>
                  <button type="button" className="btn glass sm" onClick={() => setPhoto(null)}>Leave the photo out</button>
                  {profilePhoto && photo.url !== profilePhoto && <button type="button" className="btn glass sm" onClick={() => { setPhoto({ url: profilePhoto, label: "Profile photo" }); setPoster(null); }}>Back to the original</button>}
                </div>
              </div>
            ) : profilePhoto ? (
              <div className="cel-photo">
                <div className="cel-drop" style={{ width: 280, cursor: "default" }}><b>No photo on the poster</b><span>It will be text only.</span></div>
                <button type="button" className="btn glass sm" onClick={() => { setPhoto({ url: profilePhoto, label: "Profile photo" }); setPoster(null); }}>Use their profile photo</button>
              </div>
            ) : (
              <div className="cel-drop" style={{ cursor: "default", maxWidth: 480 }}>
                <b>{emp.name} has not added a profile photo yet</b>
                <span>They can add one under My profile. Until then the poster is text only, and you can carry on.</span>
              </div>
            )}
          </div>)}

        {step === 2 && occasion && (
          <div style={{ display: "grid", gap: 14 }}>
            <p style={{ margin: 0, color: "var(--ink-dim)" }}>Choose the look. Your details are filled in from the employee record.</p>
            <div className="cel-tpl">
              {THEMES.map(([k, name, note]) => (
                <button key={k} type="button" className={theme === k ? "on" : ""} aria-pressed={theme === k} onClick={() => { setTheme(k); setPoster(null); }}>
                  {thumbs && thumbs[k] ? <img className="cel-thumb" src={thumbs[k]} alt="" /> : <div className="cel-thumb" />}
                  <b>{name}</b><span className="muted">{note}</span>
                </button>))}
            </div>
          </div>)}

        {step === 3 && (
          <div className="cel-body">
            <div className="cel-form">
              <div className="wide"><div className="cel-seg" role="group" aria-label="Look">{THEMES.map(([k, name]) => <button key={k} type="button" className={theme === k ? "on" : ""} onClick={() => { setTheme(k); setPoster(null); }}>{name}</button>)}</div></div>
              <Field id="cel-h" label="Headline"><input id="cel-h" className="input" maxLength={60} value={f.heading} onChange={(e) => edit("heading", e.target.value)} /></Field>
              <Field id="cel-e" label="Emphasis, in italic"><input id="cel-e" className="input" maxLength={40} value={f.emphasis} onChange={(e) => edit("emphasis", e.target.value)} /></Field>
              <Field id="cel-n" label="Employee name"><input id="cel-n" className="input" maxLength={80} value={f.name} onChange={(e) => edit("name", e.target.value)} /></Field>
              <Field id="cel-d" label={roleLabel}><input id="cel-d" className="input" maxLength={80} value={f.designation} onChange={(e) => edit("designation", e.target.value)} /></Field>
              {occasion === "certified" && <div className="wide"><Field id="cel-c" label="Certification"><input id="cel-c" className="input" maxLength={80} placeholder="e.g. Google Cloud Professional Cloud Architect" value={f.detail} onChange={(e) => edit("detail", e.target.value)} /></Field></div>}
              {(occasion === "welcome" || occasion === "anniversary") && <Field id="cel-j" label="Joining date"><input id="cel-j" type="date" className="input" value={f.joiningDate} onChange={(e) => edit("joiningDate", e.target.value)} /></Field>}
              <div className="wide"><Field id="cel-m" label="Greeting message" hint={`${f.message.length}/300. Optional. Edit it only if you need to.`}>
                <textarea id="cel-m" className="input" rows={3} maxLength={300} value={f.message} onChange={(e) => edit("message", e.target.value)} />
              </Field></div>
            </div>
            <div className="cel-thumb-box">{poster ? <img className="cel-thumb" src={poster.url} alt="Live preview" /> : <div className="cel-thumb" />}</div>
          </div>)}

        {step === 4 && (
          <div style={{ display: "grid", gap: 18 }}>
            <p style={{ margin: 0, color: "var(--ink-dim)" }}>This is exactly what everyone will receive.</p>
            <div className="cel-preview">{poster ? <img src={poster.url} alt={`${OCCASIONS[occasion].name} poster for ${f.name}`} /> : <div className="empty">{busy ? "Drawing the poster…" : "No poster yet."}</div>}</div>
          </div>)}

        {step === 5 && (
          <div className="cel-body">
            <div style={{ display: "grid", gap: 18 }}>
              <dl className="cel-facts">
                <dt>Announcement</dt><dd>{OCCASIONS[occasion].name}</dd>
                <dt>Employee</dt><dd>{f.name}{f.designation ? ` — ${f.designation}` : ""}</dd>
                {f.detail && <><dt>Certification</dt><dd>{f.detail}</dd></>}
                {f.joiningDate && <><dt>Joining date</dt><dd>{shortDate(f.joiningDate)}</dd></>}
                <dt>Subject</dt><dd>{SUBJECT(occasion, emp.name)}</dd>
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
  const note = occasion === "welcome" && e.start ? ` · joined ${shortDate(e.start)}` : occasion === "anniversary" && e.years ? ` · ${e.years} year${e.years === 1 ? "" : "s"}` : "";
  return (
    <label className={`cel-row${taken ? " off" : ""}`}>
      <input type="radio" name="cel-who" checked={!!on} disabled={!!taken} onChange={onPick} />
      <PersonAvatar email={e.email} name={e.name} />
      <span className="who"><b>{e.name}</b><span>{e.title || "—"}{note}{e.employmentType && e.employmentType !== "Employee" ? ` · ${e.employmentType}` : ""}</span></span>
      {taken && <Pill tone="ok">Already announced</Pill>}
    </label>
  );
}
