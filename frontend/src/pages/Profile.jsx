import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { useToast } from "../components/toast.jsx";
import { Avatar, Icon, Person, Pill, Smile, ToolIcon, initials, shortDate } from "../components/ui.jsx";
import { STATUS, TOOLS, chainOf, docCount, mgrOf, toolIds } from "../lib/people.js";

const OPTS = {
  gender: ["", "Female", "Male", "Other", "Prefer not to say"],
  marital: ["", "Single", "Married", "Divorced", "Widowed"],
  blood: ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
  handicapped: ["", "No", "Yes"],
};
const addr = (w) => [[`addresses.${w}.line`, "Address", "textarea"], [`addresses.${w}.city`, "City"], [`addresses.${w}.state`, "State"], [`addresses.${w}.country`, "Country"], [`addresses.${w}.pin`, "PIN code"]];
const SECTIONS = {
  about: { title: "About", fields: [["about", "About me", "textarea"], ["loveJob", "What I love about my job?", "textarea"], ["hobbies", "My interests and hobbies", "textarea"]] },
  primary: { title: "Primary details", fields: [["primary.first", "First name"], ["primary.middle", "Middle name"], ["primary.last", "Last name"], ["primary.gender", "Gender", "select", "gender"], ["primary.dob", "Date of birth", "date"], ["primary.marital", "Marital status", "select", "marital"], ["primary.blood", "Blood group", "select", "blood"], ["primary.handicapped", "Physically handicapped", "select", "handicapped"], ["primary.nationality", "Nationality"]] },
  contact: { title: "Contact details", fields: [["contact.personalEmail", "Personal email", "email"], ["contact.phone", "Phone", "tel"]] },
  current: { title: "Current address", fields: addr("current") },
  permanent: { title: "Permanent address", fields: addr("permanent") },
  edu: { title: "Add education", fields: [["degree", "Degree"], ["branch", "Branch / specialisation"], ["college", "University / college"], ["cgpa", "CGPA / percentage"], ["joining", "Year of joining", "date"], ["completion", "Year of completion", "date"]] },
};
const getPath = (o, k) => k.split(".").reduce((a, x) => (a == null ? a : a[x]), o);
const setPath = (o, k, v) => { const ks = k.split("."), last = ks.pop(); ks.reduce((a, x) => (a[x] = a[x] || {}), o)[last] = v; };
const nameSplit = (full) => { const p = String(full || "").trim().split(/\s+/); return { first: p[0] || "", last: p.slice(1).join(" ") }; };
const diffDays = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const todayIso = () => new Date().toISOString().slice(0, 10);

/* What the page shows: the saved answers, with what is already known about the person filling the gaps. */
function profileData(me, p, record) {
  const { first, last } = nameSplit(me.name), ad = p.addresses || {};
  const a = (x, line) => ({ line: line || "", city: "", state: "", country: "", pin: "", ...(x || {}) });
  return {
    about: p.about || "", loveJob: p.loveJob || "", hobbies: p.hobbies || "", education: (p.education || []).map((x) => ({ ...x })),
    primary: { first, middle: "", last, gender: "", dob: (record && record.ids && record.ids.dob) || "", marital: "", blood: "", handicapped: "", nationality: "", ...(p.primary || {}) },
    contact: { personalEmail: (record && record.personalEmail) || "", phone: (record && record.phone) || "", ...(p.contact || {}) },
    addresses: { current: a(ad.current, record && record.address), permanent: a(ad.permanent, "") },
  };
}

function Field({ k, label, type, opt, value, error, onChange }) {
  const id = "pf-" + k.replace(/\./g, "-");
  const ctl = type === "textarea" ? <textarea className="input" id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
    : type === "select" ? <select className="input" id={id} value={value} onChange={(e) => onChange(e.target.value)}>{OPTS[opt].map((o) => <option key={o} value={o}>{o || "Select"}</option>)}</select>
    : <input className="input" id={id} type={type || "text"} value={value} autoComplete="off" onChange={(e) => onChange(e.target.value)} />;
  return <div className="field" style={type === "textarea" ? { gridColumn: "1/-1" } : undefined}><label htmlFor={id}>{label}</label>{ctl}{error && <span className="ferr" role="alert">{error}</span>}</div>;
}

/* Squares the picture and shrinks it, so what is sent and stored is small. */
function squareJpeg(file, size) {
  return new Promise((res) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const side = Math.min(img.width, img.height), c = document.createElement("canvas");
      c.width = c.height = size;
      c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url); c.toBlob((b) => res(b), "image/jpeg", 0.9);
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(null); };
    img.src = url;
  });
}

export default function Profile() {
  const { user } = useAuth();
  const { people, docs, profile, records, setProfile } = useData();
  const toast = useToast();
  const [editing, setEditing] = useState(null);   // a section key, or "edu"
  const [vals, setVals] = useState({});
  const [errors, setErrors] = useState({});
  const fileRef = useRef(null);

  const me = useMemo(() => (people || []).find((p) => p.email.toLowerCase() === user.email.toLowerCase())
    || { id: -1, name: user.name, email: user.email, title: "—", dept: "—", status: "active", grants: {}, color: "#4254d4", no: "", start: "" }, [people, user]);
  const record = (records || []).find((r) => String(r.email).toLowerCase() === user.email.toLowerCase());
  if (!people || !profile) return <section className="section"><div className="empty">Loading…</div></section>;

  const d = profileData(me, profile, record);
  const photo = profile.photoV ? `/api/profile/photo?v=${profile.photoV}` : "";
  const nDocs = docCount(docs, me.email);
  const steps = [!!photo, !!d.about, !!d.primary.dob, !!d.addresses.current.line, d.education.length > 0, nDocs > 0];
  const pct = Math.round(steps.filter(Boolean).length / steps.length * 100);
  const city = [d.addresses.current.city, d.addresses.current.state].filter(Boolean).join(", ");
  const phone = d.contact.phone || "";
  const chain = chainOf(me, people), team = people.filter((x) => x.id !== me.id && mgrOf(x) === me.name && x.status !== "offboarded");
  const R = 70, C = 2 * Math.PI * R, arc = C * pct / 100;
  const years = me.start ? Math.floor(diffDays(me.start, todayIso()) / 365.25) : 0;
  const live = toolIds(me).filter((k) => me.grants[k] === "active");
  const [statusLabel, statusTone] = me.status === "active" && me.lastDay ? [`Leaving ${shortDate(me.lastDay)}`, "warn"] : STATUS[me.status];

  const startEdit = (sec) => {
    setErrors({});
    const v = {};
    if (sec === "edu") SECTIONS.edu.fields.forEach(([k]) => { v[k] = ""; });
    else SECTIONS[sec].fields.forEach(([k]) => { v[k] = getPath(d, k) || ""; });
    setVals(v); setEditing(sec);
  };
  const cancel = () => { setEditing(null); setErrors({}); };
  const save = async (sec) => {
    const next = JSON.parse(JSON.stringify(d));
    if (sec.startsWith("rm:")) next.education.splice(Number(sec.slice(3)), 1);
    else if (sec === "edu") next.education.push({ ...vals });
    else SECTIONS[sec].fields.forEach(([k]) => setPath(next, k, vals[k] ?? ""));
    const r = await api("PUT", "/api/profile", next);
    if (r.status === 400) { setErrors((r.data && r.data.errors) || {}); toast(Object.values((r.data && r.data.errors) || {})[0] || "Check the highlighted fields."); return; }
    if (!r.ok) { toast(apiMsg(r)); return; }
    setProfile(r.data); toast("Saved."); cancel();
  };

  const changePhoto = async (file) => {
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) { toast("Choose a JPG or PNG picture."); return; }
    if (file.size > 8 * 1048576) { toast("That picture is larger than 8 MB."); return; }
    const blob = await squareJpeg(file, 512);
    if (!blob) { toast("Could not read that picture."); return; }
    const r = await fetch("/api/profile/photo", { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
    if (r.status === 401) { location.href = "/login"; return; }
    const data = await r.json().catch(() => null);
    if (!r.ok) { toast((data && data.error) || "Could not save the photo."); return; }
    setProfile({ ...profile, photoV: data.photoV }); toast("Photo updated.");
  };
  const removePhoto = async () => {
    if (!confirm("Remove your profile photo? Your initials will show instead.")) return;
    const r = await fetch("/api/profile/photo", { method: "DELETE" });
    if (r.status === 401) { location.href = "/login"; return; }
    if (!r.ok) { toast("Could not remove the photo. Try again."); return; }
    setProfile({ ...profile, photoV: null }); toast("Photo removed.");
  };

  const edit = (sec) => <button type="button" className="btn link" onClick={() => startEdit(sec)}>Edit</button>;
  const buttons = (sec) => <div className="row" style={{ gridColumn: "1/-1" }}><button type="button" className="btn primary sm" onClick={() => save(sec)}>Save</button><button type="button" className="btn glass sm" onClick={cancel}>Cancel</button></div>;
  const form = (sec, errKeyOf = (k) => k) => (
    <div className="card-b form">
      {SECTIONS[sec].fields.map(([k, l, t, o]) => <Field key={k} k={k} label={l} type={t} opt={o} value={vals[k] ?? ""} error={errors[errKeyOf(k)]} onChange={(v) => setVals({ ...vals, [k]: v })} />)}
      {buttons(sec)}
    </div>
  );
  const section = (sec) => {
    const c = SECTIONS[sec];
    if (editing === sec) return <div className="card"><div className="card-h"><h3>{c.title}</h3></div>{form(sec)}</div>;
    return (
      <div className="card"><div className="card-h"><h3>{c.title}</h3>{edit(sec)}</div><div className="card-b"><dl className="rv">
        {c.fields.map(([k, l]) => <div key={k} style={c.fields.length === 5 && k.endsWith(".line") ? { gridColumn: "1/-1" } : undefined}><dt>{l}</dt><dd>{getPath(d, k) || "—"}</dd></div>)}
      </dl></div></div>
    );
  };
  const jump = (id) => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const step = (x, tag, isMe) => (
    <div key={x.id} className={`rl-step${isMe ? " me" : ""}`}>
      <Person name={x.name} sub={x.title && x.title !== "—" ? x.title : x.email} color={x.color} />{tag && <span className="rl-tag">{tag}</span>}
    </div>
  );

  return (
    <section className="section" style={{ gap: 18 }}>
      <div className="sec-head"><div><div className="eyebrow">Me</div><h2>My <span className="grad">profile.</span></h2><Smile /></div></div>
      <div className="pf2">
        <aside className="pf2-rail">
          <div className="card pf2-id">
            <div className="pf2-photo">
              <svg viewBox="0 0 156 156" aria-hidden="true"><circle cx="78" cy="78" r={R} fill="none" stroke="var(--paper-2)" strokeWidth="6" />
                {arc > 0.5 && <circle cx="78" cy="78" r={R} fill="none" stroke="var(--purple)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${arc} ${C - arc}`} transform="rotate(-90 78 78)" />}</svg>
              <span className="pf2-face" style={{ background: photo ? "transparent" : me.color }}>{photo ? <img src={photo} alt="" /> : initials(me.name)}</span>
              <label className="pf-cam" title={photo ? "Change photo" : "Add your photo"}><Icon name="camera" />
                <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{photo ? "Change photo" : "Add your photo"}</span>
                <input type="file" ref={fileRef} accept="image/png,image/jpeg" hidden onChange={(e) => { changePhoto(e.target.files[0]); e.target.value = ""; }} /></label>
              {photo && <button type="button" className="pf-trash" title="Remove photo" aria-label="Remove photo" onClick={removePhoto}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" /></svg></button>}
            </div>
            <h2>{me.name}</h2>
            <p className="pf2-role">{me.title && me.title !== "—" ? me.title : ""}{me.dept && me.dept !== "—" && !String(me.title || "").toLowerCase().includes(me.dept.toLowerCase()) ? ` · ${me.dept}` : ""}</p>
            <Pill tone={statusTone}>{statusLabel}</Pill>
            <div><span className={`pill ${pct === 100 ? "p-ok" : "p-info"}`} style={{ marginTop: 8 }} title="Parts of your profile that are filled in">Profile {pct}% complete</span></div>
            {photo && <div><button type="button" className="btn glass sm" style={{ marginTop: 12 }} onClick={removePhoto}>Remove photo</button></div>}
            <ul className="pf2-facts">
              <li><Icon name="mail" />{me.email}</li><li><Icon name="phone" />{phone || "Add a phone number"}</li>
              <li><Icon name="pin" />{city || "Add your city"}</li><li><Icon name="idcard" />{me.no || "No employee number yet"}</li>
            </ul>
            {me.start && <p className="pf2-since">{years >= 1 ? `${years} year${years === 1 ? "" : "s"} at Wohlig` : `Joined ${shortDate(me.start)}`}</p>}
          </div>
          <nav className="card pf2-nav" aria-label="On this page"><h3>On this page</h3>
            {[["pf-sec-story", "Your story"], ["pf-sec-line", "Reporting line"], ["pf-sec-personal", "Personal details"], ["pf-sec-education", "Education"], ["pf-sec-contact", "Contact and addresses"], ["pf-sec-work", "Work and documents"]]
              .map(([id, l]) => <button key={id} type="button" onClick={() => jump(id)}>{l}</button>)}
          </nav>
        </aside>
        <div className="pf2-main">
          {editing === "about" ? <div className="card" id="pf-sec-story"><div className="card-h"><h3>About</h3></div>{form("about")}</div> : (
            <div className="card" id="pf-sec-story"><div className="card-h"><h3>Your story</h3>{edit("about")}</div><div className="q-tiles">
              {SECTIONS.about.fields.map(([k, l]) => { const v = getPath(d, k); return v
                ? <div key={k} className="q-tile"><h4>{l}</h4><p>{v}</p></div>
                : <div key={k} className="q-tile is-empty"><h4>{l}</h4><p>Nothing here yet.</p><button type="button" className="btn glass sm" style={{ alignSelf: "flex-start" }} onClick={() => startEdit("about")}>Add your answer</button></div>; })}
            </div></div>
          )}
          <div className="card" id="pf-sec-line"><div className="card-h"><h3>Reporting line</h3><span className="muted">{mgrOf(me) ? `Reports to ${mgrOf(me)}` : "No manager set"}</span></div>
            <div className="rl">{chain.map((x, i) => step(x, i === chain.length - 1 ? "Manager" : ""))}{step(me, "You", true)}</div>
            {team.length > 0 && <div className="rl-team"><h4>Your team ({team.length})</h4><div className="chips">{team.map((x) => <span key={x.id} className="chip"><Avatar person={x} />{x.name}</span>)}</div></div>}
          </div>
          <div id="pf-sec-personal">{section("primary")}</div>
          <div className="card" id="pf-sec-education"><div className="card-h"><h3>Education</h3>{editing !== "edu" && <button type="button" className="btn link" onClick={() => startEdit("edu")}>Add</button>}</div>
            {d.education.length ? <div className="edu-line">{d.education.map((x, i) => (
              <div key={i} className="edu-item"><b>{x.degree || "Education"}{x.branch ? ` · ${x.branch}` : ""}</b><span>{x.college || "—"}</span>
                <small>{[x.joining ? shortDate(x.joining) : "", x.completion ? shortDate(x.completion) : ""].filter(Boolean).join(" to ")}{x.cgpa ? ` · ${x.cgpa}` : ""}</small>
                <button type="button" className="btn link" style={{ paddingLeft: 0 }} onClick={() => save(`rm:${i}`)}>Remove</button></div>))}</div>
              : editing !== "edu" && <div className="card-b muted">No education added yet.</div>}
            {editing === "edu" && <div style={{ borderTop: "1px solid var(--line)", paddingTop: 18 }}>{form("edu", (k) => `education.${d.education.length}.${k}`)}</div>}
          </div>
          <div id="pf-sec-contact" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {section("contact")}<div className="pf2-pair">{section("current")}{section("permanent")}</div>
          </div>
          <div className="card" id="pf-sec-work"><div className="card-h"><h3>Work</h3><span className="muted">Set by HR</span></div><div className="card-b">
            <dl className="rv"><div><dt>Employee no.</dt><dd className="mono">{me.no || "Not assigned"}</dd></div><div><dt>Work email</dt><dd className="mono">{me.email}</dd></div>
              <div><dt>Department</dt><dd>{me.dept || "—"}</dd></div><div><dt>Date of joining</dt><dd>{me.start ? shortDate(me.start) : "—"}</dd></div></dl>
            <div style={{ marginTop: 18 }}><div className="muted" style={{ marginBottom: 8 }}>Tools you have</div>
              {live.length ? <div className="chips">{live.map((id) => <span key={id} className="chip"><ToolIcon tool={TOOLS[id]} state="active" />{TOOLS[id].name}</span>)}</div> : <span className="muted">No tools yet.</span>}</div>
            <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span className="muted">{nDocs ? `${nDocs} document${nDocs === 1 ? "" : "s"} uploaded` : "No documents uploaded yet"}</span>
              <a className="btn glass sm" href="/app/documents">{nDocs ? "Manage documents" : "Upload documents"}</a></div>
          </div></div>
        </div>
      </div>
    </section>
  );
}
