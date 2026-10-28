import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import { TOOLS } from "../../lib/people.js";
import { Callout, SectionHead, ToolIcon } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { ACCESS_HELP, ACCESS_LABEL, DEPTS, DOMAIN, DocRows, ObTabs, ON_TOOLS, V, docCount, fdate, groupDocs, hrConfirm, makeWorkEmail, nameSplit } from "./shared.jsx";

const OB_STEPS = ["Details and work email", "Create login", "Tools and review"];
const OB_DRAFT_KEY = "hr_ob_draft";
const newDetails = () => ({ first: "", last: "", pemail: "", phone: "", address: "", dept: "Engineering", kind: "Employee", title: "", mgr: "", start: "" });
const newOb = () => ({ step: 1, fromReview: false, email: null, d: newDetails(), work: null, login: null, busy: false, apps: null, reviewed: false, errors: {}, role: null, sendInvite: true });

/* Step 1 asks only for personal and job details. Documents come from the employee, so none are required here. */
function step1Errors(d) {
  const e = {};
  if (!d.first.trim()) e.first = "Enter the first name.";
  if (!d.last.trim()) e.last = "Enter the surname.";
  if (!V.email(d.pemail)) e.pemail = "Enter a valid personal email.";
  else if (/@wohlig\.com$/i.test(d.pemail.trim())) e.pemail = "Use a personal email, not a @wohlig.com address.";
  if (!V.phone(d.phone)) e.phone = "Enter a 10-digit mobile number.";
  if (!d.address.trim()) e.address = "Enter the address.";
  if (!d.title.trim()) e.title = "Enter the job title.";
  if (!d.start) e.start = "Pick the start date.";
  return e;
}

function Fld({ label, id, value, onChange, err, type = "text", hint, ph, rows = 0, full, dis }) {
  return (
    <div className="field" style={full ? { gridColumn: "1/-1" } : undefined}>
      <label htmlFor={"ob-" + id}>{label}</label>
      {rows ? <textarea className="input" id={"ob-" + id} rows={rows} placeholder={ph} disabled={dis} value={value} onChange={(e) => onChange(e.target.value)} />
        : <input className="input" id={"ob-" + id} type={type} value={value} placeholder={ph} autoComplete="off" disabled={dis} onChange={(e) => onChange(e.target.value)} />}
      {hint && <span className="hint">{hint}</span>}
      {err && <span className="ferr" role="alert">{err}</span>}
    </div>
  );
}

const Stepper = ({ step }) => (
  <div className="stepper" role="list">{OB_STEPS.map((s, i) => (
    <div key={s} className={`stp ${step === i + 1 ? "on" : step > i + 1 ? "done" : ""}`} role="listitem"><b>{step > i + 1 ? "✓" : i + 1}</b>{s}</div>
  ))}</div>
);

/* What the chosen person has uploaded. HR can open and save every file. */
function DocsCard({ person, docs }) {
  if (!person) return null;
  const m = groupDocs(docs)[person.email.toLowerCase()] || {}, n = docCount(m);
  return (
    <div className="card"><div className="card-h"><h3>Documents uploaded by {person.name}</h3><span className="muted">{n ? `${n} file${n === 1 ? "" : "s"}` : "Nothing uploaded yet"}</span></div>
      {n ? <DocRows m={m} /> : <div className="card-b muted">The employee uploads documents after signing in. They will show here.</div>}</div>
  );
}

/* The work email is created in Google Workspace and active straight away. Only HR can do this. */
function WorkEmailCard({ ob, taken, onCreate }) {
  const w = ob.work, d = ob.d;
  if (!w) {
    const preview = makeWorkEmail(d.first, d.last, taken);
    return (
      <div className="card"><div className="card-h"><h3>Work email</h3><span className="muted">Created in Google and active straight away</span></div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="input mono" style={{ background: "var(--paper-2)", fontSize: 18 }}>{preview || "Add a first name and surname above"}</div>
          <p style={{ margin: 0, color: "var(--ink-dim)" }}>Built as <span className="mono">name.surname@{DOMAIN}</span>, in lowercase. If the address is taken, a number is added. Fill in the details above, then create it. The name cannot be changed afterwards.</p>
          <Callout>A different password is generated for each person and emailed to their personal email. They must choose a new one at first sign-in.</Callout>
          <div className="row"><button type="button" className="btn primary" disabled={ob.busy} onClick={onCreate}>{ob.busy ? "Creating…" : "Create work email"}</button></div>
        </div></div>
    );
  }
  const label = { active: "Active in Google Workspace", simulated: "Created (simulated)", existing: "Already in the employee list", failed: "Google could not create it" }[w.google] || w.google;
  const ok = w.google !== "failed";
  return (
    <div className="card"><div className="card-h"><h3>Work email</h3><span className={`pill ${ok ? "p-ok" : "p-bad"}`}>{label}</span></div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="input mono" style={{ background: "var(--paper-2)", fontSize: 18 }}>{w.email}</div>
        {w.google === "failed" ? <Callout>{w.error || "Google returned an error."} The address is reserved for this person. Retry when the problem is fixed.</Callout>
          : w.google === "simulated" ? <Callout>Google is not connected yet, so this account was only simulated. Add the Google credentials in backend/.env to create real accounts.</Callout>
          : w.google === "existing" ? <Callout>This person already has a work email, so none is created.</Callout> : null}
        {w.account && (w.account.emailed
          ? <Callout>The email address and its password were sent to the employee's personal email.</Callout>
          : <Callout>Email is not set up, so the password was not sent. Give it to the employee yourself: <b className="mono">{w.account.password}</b>. It is shown only now.</Callout>)}
        {w.google === "failed" && <div className="row"><button type="button" className="btn primary" disabled={ob.busy} onClick={onCreate}>{ob.busy ? "Retrying…" : "Retry"}</button></div>}
      </div></div>
  );
}

export default function Onboarding() {
  const { isHr } = useAuth();
  const { people, records, docs, reload } = useData();
  const toast = useToast(), nav = useNavigate();
  const [ob, setOb] = useState(newOb);
  const [pick, setPick] = useState("");
  const [restored, setRestored] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const touched = useRef(false);
  const patch = (p) => setOb((o) => ({ ...o, ...p }));
  const setD = (k, v) => setOb((o) => ({ ...o, d: { ...o.d, [k]: v }, ...(k === "dept" ? { apps: null } : {}) }));

  // A saved draft (server first, then this browser) fills in the details when the page opens.
  useEffect(() => {
    if (!isHr) return;
    let live = true;
    (async () => {
      let saved = null;
      try { const r = await api("GET", "/api/onboarding/draft"); if (r.ok && r.data && Object.keys(r.data).length) saved = r.data; } catch { /* use the browser copy */ }
      if (!saved) { try { saved = JSON.parse(localStorage.getItem(OB_DRAFT_KEY) || "null"); } catch { saved = null; } }
      if (live && saved && !touched.current) { setOb((o) => ({ ...o, d: { ...o.d, ...saved } })); setRestored(true); }
    })();
    return () => { live = false; };
  }, [isHr]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!focusTick) return;
    const el = document.querySelector(".ferr");
    if (el) { el.scrollIntoView({ block: "center" }); const i = el.closest(".field")?.querySelector("input,textarea"); if (i) i.focus(); }
  }, [focusTick]);

  if (!isHr) return <section className="section"><SectionHead eyebrow="Onboarding" title="Add a new" accent="joiner." /><div className="empty">Only HR can onboard people.</div></section>;
  if (!people) return <section className="section"><div className="empty">Loading…</div></section>;

  const lc = (s) => String(s || "").toLowerCase();
  const recOf = (email) => (records || []).find((r) => lc(r.email) === lc(email));
  const waiting = people.filter((e) => e.status === "onboarding").sort((a, b) => a.name.localeCompare(b.name));
  const mgrs = people.filter((e) => e.status !== "offboarded");
  const picked = ob.email && people.find((x) => lc(x.email) === lc(ob.email));
  const taken = (x) => people.some((p) => lc(p.email) === lc(x));
  const { d } = ob, er = ob.errors;
  const role = ob.role || (d.dept === "HR" ? "hr" : "employee");

  const fetchPerson = (e) => {
    const { first, last } = nameSplit(e.name), rec = recOf(e.email) || {};
    const nd = { ...newDetails(), first, last };
    if (e.start) nd.start = e.start;
    if (e.title && e.title !== "—") nd.title = e.title;
    if (e.dept) nd.dept = e.dept;
    if (e.manager && e.manager !== "—") nd.mgr = e.manager;
    if (rec.personalEmail) nd.pemail = rec.personalEmail;
    if (rec.phone) nd.phone = rec.phone;
    if (rec.address) nd.address = rec.address;
    // A person who already has a work email (from the HR sheet, or an earlier attempt) does not get a new one.
    let work = null;
    if (rec.googleStatus) work = { email: e.email, google: rec.googleStatus, error: rec.googleError };
    else if (e.email) work = { email: e.email, google: "existing" };
    touched.current = true;
    setOb((o) => ({ ...o, email: e.email, apps: null, d: nd, work, login: rec.hasLogin ? { created: true, existing: true } : null, errors: {} }));
  };
  const doFetch = () => {
    const e = people.find((x) => String(x.id) === pick);
    if (!e) { toast("Choose a person from the list first."); return; }
    fetchPerson(e); reload();
  };
  const unfetch = () => patch({ email: null, d: newDetails(), work: null, login: null, apps: null });

  const fail = (errors) => { patch({ errors }); setFocusTick((n) => n + 1); toast("Please fix the highlighted fields."); };

  const next = () => {
    const errs = ob.step === 1 ? step1Errors(d) : {};
    if (Object.keys(errs).length) return fail(errs);
    if (ob.step === 1 && (!ob.work || ob.work.google === "failed")) { toast("Create the work email first."); return; }
    if (ob.step === 2 && !ob.login) { toast("Create the login first."); return; }
    patch({ errors: {}, step: ob.fromReview ? 3 : ob.step + 1, fromReview: false });
    window.scrollTo(0, 0);
  };
  const back = () => { patch({ errors: {}, step: Math.max(1, ob.step - 1), fromReview: false }); window.scrollTo(0, 0); };
  const goto = (s) => { patch({ fromReview: ob.step === OB_STEPS.length, errors: {}, step: s }); window.scrollTo(0, 0); };

  const saveDraft = async () => {
    let saved = false;
    try { localStorage.setItem(OB_DRAFT_KEY, JSON.stringify(d)); saved = true; } catch { /* storage blocked */ }
    try { const r = await api("PUT", "/api/onboarding/draft", d); if (r.ok) saved = true; } catch { /* no server */ }
    toast(saved ? "Draft saved: name, contact and job details only." : "Could not save the draft.");
  };
  const clearDraft = () => {
    try { localStorage.removeItem(OB_DRAFT_KEY); } catch { /* storage blocked */ }
    api("DELETE", "/api/onboarding/draft").catch(() => {});
  };
  const cancel = () => { clearDraft(); touched.current = true; setOb(newOb()); setPick(""); setRestored(false); window.scrollTo(0, 0); };

  /* Step 1: save the details, create the work email and activate it in Google. */
  const makeEmail = async () => {
    const errs = step1Errors(d);
    if (Object.keys(errs).length) return fail(errs);
    patch({ busy: true, errors: {} });
    try {
      const r = await api("POST", "/api/onboarding/work-email", { d, existingEmail: (ob.work && ob.work.email) || (picked && picked.email) || undefined });
      if (r.status === 400) {
        const errors = (r.data && r.data.errors) || {};
        toast(Object.values(errors)[0] || (r.data && r.data.error) || "The server rejected the details.");
        patch({ busy: false, errors });
      } else if (r.status === 502) {
        toast("Google could not create the account.");
        patch({ busy: false, work: { email: r.data.email, google: "failed", error: r.data.error } });
      } else if (!r.ok) { toast(apiMsg(r)); patch({ busy: false }); }
      else {
        touched.current = true;
        patch({ busy: false, email: r.data.email, work: { email: r.data.email, google: r.data.googleStatus, account: r.data.workAccount || null }, login: r.data.hasLogin ? { created: true, existing: true } : null });
        toast(`${r.data.email} is ready${r.data.googleStatus === "active" ? " and active in Google" : ""}.`);
        reload();
      }
    } catch { toast("The server can't be reached. Try again."); patch({ busy: false }); }
  };

  /* Step 2: HR creates the app login with the default password. */
  const makeLogin = async () => {
    if (!ob.work) return;
    if (role === "hr" && !hrConfirm((d.first + " " + d.last).trim() || ob.work.email)) return;
    patch({ busy: true });
    try {
      const r = await api("POST", "/api/users", { email: ob.work.email, role, sendInvite: ob.sendInvite !== false });
      if (r.ok) patch({ busy: false, login: { created: true, password: r.data.defaultPassword, role, invite: r.data.invite } });
      else if (r.status === 409) patch({ busy: false, login: { created: true, existing: true } });
      else { toast(apiMsg(r)); patch({ busy: false }); }
    } catch { toast("The server can't be reached. Try again."); patch({ busy: false }); }
  };

  /* Send (or resend) the invitation email for a login that already exists. */
  const resendInvite = async () => {
    patch({ busy: true });
    try {
      const r = await api("POST", `/api/users/${encodeURIComponent(ob.work.email)}/invite`);
      if (r.ok) patch({ busy: false, login: { ...ob.login, invite: r.data.invite } });
      else { toast(apiMsg(r)); patch({ busy: false }); }
    } catch { toast("The server can't be reached. Try again."); patch({ busy: false }); }
  };

  const submit = async (ev) => {
    ev.preventDefault();
    if (ob.step !== OB_STEPS.length) return;
    if (!ob.reviewed) { toast("Tick the review box before submitting."); return; }
    if (!ob.work || !ob.login) { toast("Create the work email and the login first."); return; }
    const apps = (ob.apps || ON_TOOLS).filter((a) => ON_TOOLS.includes(a));
    if (!apps.length) { toast("Tick Claude to give access, or the onboarding can't be saved."); return; }
    const r = await api("POST", "/api/onboarding", { d, apps, existingEmail: ob.work.email });
    if (r.status === 400) { const errors = (r.data && r.data.errors) || {}; patch({ errors }); toast(Object.values(errors)[0] || (r.data && r.data.error) || "The server rejected the details."); return; }
    if (!r.ok) { toast("The server could not save this onboarding. Try again."); return; }
    const email = r.data.email, name = (d.first + " " + d.last).trim();
    clearDraft();
    toast(`HR notified: ${name} was submitted for onboarding.`);
    // Give the tools that were ticked (Claude is a real call when the admin key is set, otherwise a test only).
    if (apps.includes("claude")) {
      const g = await api("POST", "/api/tool-access/claude", { email, action: "grant" });
      toast(g.ok ? (g.data.mode === "simulated" ? "Done as a test only: Claude is not connected yet (no admin key)." : `Claude access for ${name}: ${g.data.detail}.`) : apiMsg(g));
    }
    await reload();
    nav(`/app/employees/${encodeURIComponent(email)}`);
  };

  const sel = ob.apps || ON_TOOLS;
  const reviewCard = (title, step, pairs) => (
    <div className="card"><div className="card-h"><h3>{title}</h3><button type="button" className="btn link" onClick={() => goto(step)}>Edit</button></div>
      <div className="card-b"><dl className="rv">{pairs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || "—"}</dd></div>)}</dl></div></div>
  );
  const last = ob.step === OB_STEPS.length;
  const w = ob.work, l = ob.login;

  return (
    <section className="section">
      <ObTabs cur="onboard" />
      <SectionHead eyebrow="Onboarding" title="Add a new" accent="joiner." sub="HR enters the details and the work email is created in Google. HR then creates the login, and the employee uploads their own documents later." />
      <Stepper step={ob.step} />
      {restored && <Callout>A saved draft was restored. It holds name, contact and job details only. <button type="button" className="btn link" onClick={cancel}>Start over</button></Callout>}
      <form className="grid" style={{ gap: 22 }} noValidate onSubmit={submit}>
        {ob.step === 1 && <>
          <div className="card"><div className="card-h"><h3>Fetch from the employee list</h3><span className="muted">Fills name, joining date, title and department</span></div><div className="card-b">
            {picked && <div className="callout" style={{ marginBottom: 14 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
              <div>Filled from the employee list: <b>{picked.name}</b>, {picked.title}, joining {fdate(picked.start)}. Phone, address and personal email still need to be added. <button type="button" className="btn link" onClick={unfetch}>Clear</button></div></div>}
            {waiting.length
              ? <div className="row"><select className="input" style={{ maxWidth: 360 }} aria-label="Person from the employee list" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose a person waiting for onboarding</option>{waiting.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                <button type="button" className="btn glass" onClick={doFetch}>Fill from list</button></div>
              : <p className="muted" style={{ margin: 0 }}>No one in the employee list is waiting for onboarding. Type the details below to add a new joiner.</p>}
          </div></div>
          <div className="card"><div className="card-h"><h3>Candidate details</h3></div><div className="card-b form">
            <Fld label="First name" id="first" value={d.first} onChange={(v) => setD("first", v)} err={er.first} ph="e.g. Priya" dis={!!ob.work} />
            <Fld label="Surname" id="last" value={d.last} onChange={(v) => setD("last", v)} err={er.last} ph="e.g. Shah" dis={!!ob.work} />
            <Fld label="Personal email" id="pemail" type="email" value={d.pemail} onChange={(v) => setD("pemail", v)} err={er.pemail} hint="The work email and login details are sent here." />
            <Fld label="Phone" id="phone" type="tel" value={d.phone} onChange={(v) => setD("phone", v)} err={er.phone} ph="10-digit mobile number" />
            <Fld label="Address" id="address" rows={3} full value={d.address} onChange={(v) => setD("address", v)} err={er.address} />
          </div></div>
          <div className="card"><div className="card-h"><h3>Job details</h3><span className="muted">Filled in by HR</span></div><div className="card-b form">
            <div className="field"><label htmlFor="ob-dept">Department</label><select className="input" id="ob-dept" value={d.dept} onChange={(e) => setD("dept", e.target.value)}>{DEPTS.map((x) => <option key={x}>{x}</option>)}</select></div>
            <div className="field"><label htmlFor="ob-kind">Joining as</label><select className="input" id="ob-kind" value={d.kind || "Employee"} onChange={(e) => setD("kind", e.target.value)}><option>Employee</option><option>Intern</option></select></div>
            <Fld label="Job title" id="title" value={d.title} onChange={(v) => setD("title", v)} err={er.title} ph="e.g. Software Development Engineer" />
            <div className="field"><label htmlFor="ob-mgr">Reporting manager</label><select className="input" id="ob-mgr" value={d.mgr} onChange={(e) => setD("mgr", e.target.value)}><option value="">None</option>{mgrs.map((m) => <option key={m.id}>{m.name}</option>)}</select></div>
            <Fld label="Start date" id="start" type="date" value={d.start} onChange={(v) => setD("start", v)} err={er.start} />
          </div></div>
          <WorkEmailCard ob={ob} taken={taken} onCreate={makeEmail} />
          <DocsCard person={picked} docs={docs} />
        </>}
        {ob.step === 2 && w && (
          <div className="card"><div className="card-h"><h3>Login for the app</h3><span className="muted">Only HR can create it</span></div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <dl className="rv"><div><dt>Signs in with</dt><dd><span className="mono">{w.email}</span></dd></div><div><dt>App access</dt><dd>{ACCESS_LABEL[(l && l.role) || role] || "Employee"}</dd></div></dl>
              {!l && <div className="field"><label htmlFor="ob-role">App access level</label>
                <select className="input" id="ob-role" style={{ maxWidth: 320 }} value={role} onChange={(e) => patch({ role: e.target.value })}>{["employee", "hr"].map((r) => <option key={r} value={r}>{ACCESS_LABEL[r]}</option>)}</select>
                <span className="hint">{ACCESS_HELP[role]}{d.dept === "HR" ? " This person is joining HR, so HR rights are preselected." : ""}</span></div>}
              <p style={{ margin: 0, color: "var(--ink-dim)" }}>The employee signs in with their work email and the default password, then uploads their own documents. Details from their resume will be added later.</p>
              {!l && <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" checked={ob.sendInvite !== false} onChange={(e) => patch({ sendInvite: e.target.checked })} style={{ marginTop: 4 }} />
                <span>Email them an invitation to sign in{d.pemail ? <> (sent to <b>{d.pemail}</b>)</> : ""}<span className="hint" style={{ display: "block" }}>The link works once and expires after 30 minutes. You can resend it later.</span></span></label>}
              {l ? <>
                  <Callout>{l.existing ? "This person already has a login." : <>Login created{l.role === "hr" ? <> with <b>HR rights</b></> : ""}. Password: <b className="mono">{l.password || "the default password"}</b>. Tell them to change it on their Account page.</>}</Callout>
                  {l.invite && <Callout>{l.invite.mode === "email" ? <>Invitation emailed to <b>{l.invite.to}</b>. The link works for 30 minutes.</> : <>The invitation email could not be sent. Check the email settings, then press the button below to try again.</>}</Callout>}
                  <div className="row"><button type="button" className="btn" disabled={ob.busy} onClick={resendInvite}>{ob.busy ? "Sending…" : l.invite ? "Resend invitation" : "Email invitation"}</button></div>
                </>
                : <div className="row"><button type="button" className="btn primary" disabled={ob.busy} onClick={makeLogin}>{ob.busy ? "Creating…" : ob.sendInvite !== false ? "Create login and send invite" : "Create login"}</button></div>}
            </div></div>
        )}
        {ob.step === 3 && w && <>
          {reviewCard("Personal details", 1, [["Name", d.first + " " + d.last], ["Personal email", d.pemail], ["Phone", d.phone], ["Address", d.address]])}
          {reviewCard("Job details", 1, [["Department", d.dept], ["Joining as", d.kind || "Employee"], ["Job title", d.title], ["Reporting manager", d.mgr], ["Start date", fdate(d.start)]])}
          <div className="card"><div className="card-h"><h3>Work email and login</h3></div><div className="card-b"><dl className="rv">
            <div><dt>Work email</dt><dd><span className="mono">{w.email}</span></dd></div>
            <div><dt>Google</dt><dd>{{ active: "Active in Google Workspace", simulated: "Active (simulated)", existing: "Already in the employee list" }[w.google] || w.google}</dd></div>
            <div><dt>App login</dt><dd>{l && l.role === "hr" ? "Created with HR rights" : `Created, ${(ACCESS_LABEL[l && l.role] || "employee").toLowerCase()} role`}</dd></div></dl></div></div>
          <DocsCard person={picked} docs={docs} />
          <div className="card"><div className="card-h"><h3>Tools to give</h3><span className="muted">Claude</span></div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="tiles">{ON_TOOLS.map((id) => (
                <label className="tile" key={id}><input type="checkbox" value={id} checked={sel.includes(id)} onChange={(e) => patch({ apps: e.target.checked ? [...sel, id] : sel.filter((x) => x !== id) })} />
                  <ToolIcon tool={TOOLS[id]} state="active" /><span className="t"><b>{TOOLS[id].name}</b><span>{TOOLS[id].sub}</span></span></label>
              ))}</div>
              <p className="muted" style={{ margin: 0 }}>Saved as this person's tool access, so offboarding can list it later. The employee uploads documents after signing in, and resume details will be added later.</p>
            </div></div>
          <label className="check" style={{ border: 0, padding: 0 }}><input type="checkbox" checked={ob.reviewed} onChange={(e) => patch({ reviewed: e.target.checked })} /><div className="grow"><div className="lbl">I have reviewed all the details above</div></div></label>
        </>}
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">{ob.step > 1 ? <button type="button" className="btn glass" onClick={back}>Back</button> : <button type="button" className="btn glass" onClick={cancel}>Cancel</button>}
            <button type="button" className="btn glass" onClick={saveDraft}>Save draft</button></div>
          {last ? <button type="submit" className="btn primary" disabled={!ob.reviewed}>Submit onboarding</button>
            : <button type="button" className="btn primary" onClick={next}>{ob.fromReview ? "Back to review" : "Continue"}</button>}
        </div>
      </form>
    </section>
  );
}
