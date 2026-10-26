import { useCallback, useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useToast } from "../../components/toast.jsx";

/* What each app role can do. HR is "all rights": everything in the app. */
export const ACCESS_LABEL = { employee: "Employee", hr: "HR (full rights)" };   // there is no separate manager role: whoever HR sets as someone's reporting manager is a manager
export const ACCESS_HELP = {
  employee: "Sees the site and uses their own pages: documents, profile and leave.",
  manager: "Like an employee, and also approves leave for the people who report to them.",
  hr: "Full rights: can see and change everything, including onboarding, offboarding, leave, the audit log and everyone's logins.",
};
export const accessOptions = () => ["employee", "hr"].map((r) => <option key={r} value={r}>{ACCESS_LABEL[r]}</option>);
/* Handing out HR rights is a big step, so it always asks first. */
export const hrConfirm = (name) => confirm(`Give ${name} full HR rights?\n\nHR can see and change everything in the app: onboarding, offboarding, leave, the audit log and everyone's logins. Only do this for someone who works in HR.`);
export const maskMail = (v) => { const [a, b] = String(v || "").split("@"); return b ? a.slice(0, 2) + "•••@" + b : ""; };

const InfoIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>;

/* What happened to an invite: emailed, or (when the server has no mail set up) a link for HR to share. */
export function InviteBox({ note, copyId }) {
  const toast = useToast();
  if (!note) return null;
  const copy = async () => {
    const el = document.getElementById(copyId); if (!el) return;
    el.select();
    try { await navigator.clipboard.writeText(el.value); toast("Link copied."); } catch { toast("Press Ctrl+C to copy the link."); }
  };
  return (
    <div className="callout"><InfoIcon /><div style={{ minWidth: 0, flex: 1 }}>
      {note.mode === "email"
        ? <>Invite emailed to <b>{note.to}</b>. The link works once and is cancelled if it is not opened within 30 minutes.</>
        : <>{note.error || "Email isn't set up on the server yet, so no email was sent."} Share this invite link with {note.email || "them"}:</>}
      {note.link && <div className="row" style={{ marginTop: 8, flexWrap: "nowrap" }}>
        <input className="input mono" id={copyId} readOnly value={note.link} aria-label="Invite link" style={{ minWidth: 0 }} />
        <button type="button" className="btn glass sm" onClick={copy}>Copy</button></div>}
    </div></div>
  );
}

/* On a person's page, HR can give them a login and email them a one-time link that opens the app. */
export function AppLoginCard({ person, personalEmail }) {
  const toast = useToast();
  const [d, setD] = useState(null);   // the users list; { failed: true } when it can't be read
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [newRole, setNewRole] = useState((person.dept || "") === "HR" ? "hr" : "employee");
  const lc = (s) => String(s || "").toLowerCase();
  const load = useCallback(async () => {
    try { const r = await api("GET", "/api/users"); setD(r.ok ? r.data : { failed: true }); } catch { setD({ failed: true }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const wrap = (body) => (
    <div className="card"><div className="card-h"><h3>App login</h3><span className="muted">Who can sign in to this app</span></div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>{body}</div></div>
  );
  if (!d) return wrap(<span className="muted">Loading…</span>);
  if (d.failed) return null;   // no server, so no logins to manage

  const u = d.users.find((x) => lc(x.email) === lc(person.email));
  const where = <>The invite goes to {personalEmail ? <><b>{maskMail(personalEmail)}</b> (their personal email)</> : "their personal email if HR has one on record, otherwise their work email"}. It holds a one-time link that opens the app, works once and is cancelled if it is not opened within 30 minutes.</>;
  const dept = (person.dept || "") === "HR" ? "hr" : "employee";
  const hint = d.mailConfigured ? null : <span className="muted" style={{ fontSize: 12.5 }}>Email isn't set up on the server yet, so you'll get the link to share instead.</span>;
  const noteEl = note && lc(note.email) === lc(person.email) ? <InviteBox note={note} copyId="inv-link" /> : null;

  const changeRole = async (role) => {
    if (role === u.role) return;
    if (role === "hr" && !hrConfirm(person.name || person.email)) return;
    const r = await api("PUT", `/api/users/${encodeURIComponent(person.email)}/role`, { role });
    if (!r.ok) { toast(apiMsg(r)); load(); return; }
    toast(role === "hr" ? `${person.name || person.email} now has full HR rights.` : `${person.name || person.email} is now ${ACCESS_LABEL[role].toLowerCase()}.`);
    load();
  };
  const invite = async (create, send) => {
    if (create && newRole === "hr" && !hrConfirm(person.name || person.email)) return;
    setBusy(true); setNote(null);
    try {
      if (create) {
        const r = await api("POST", "/api/users", { email: person.email, role: newRole, sendInvite: send });
        if (!r.ok && r.status !== 409) toast(apiMsg(r));
        else if (r.ok && r.data.invite) setNote({ ...r.data.invite, email: person.email });
        if (r.ok) toast(!send ? `Login created for ${person.email}.` : r.data.invite && r.data.invite.mode === "email" ? `Login created. Invite sent to ${r.data.invite.to}.` : "Login created. Copy the invite link below.");
      } else {
        const r = await api("POST", `/api/users/${encodeURIComponent(person.email)}/invite`);
        if (!r.ok) toast(apiMsg(r));
        else { setNote({ ...r.data.invite, email: person.email }); toast(r.data.invite.mode === "email" ? `Invite sent to ${r.data.invite.to}.` : "Copy the invite link below."); }
      }
    } catch { toast("The server can't be reached. Try again."); }
    setBusy(false); load();
  };

  return wrap(u ? <>
    <dl className="rv">
      <div><dt>Signs in with</dt><dd><span className="mono">{u.email}</span></dd></div>
      <div><dt>Last signed in</dt><dd>{u.lastLogin ? new Date(u.lastLogin).toLocaleString() : "Never"}</dd></div>
      <div style={{ gridColumn: "1/-1" }}><dt>App access</dt><dd>
        <select className="input" value={u.role} onChange={(ev) => changeRole(ev.target.value)} style={{ maxWidth: 260 }} aria-label={`App access for ${person.name}`}>{accessOptions()}</select>
        <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>{ACCESS_HELP[u.role] || ""}</div></dd></div>
      {u.inviteExpires && <div><dt>Invite waiting</dt><dd>Open until {new Date(u.inviteExpires).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd></div>}
    </dl>
    <p style={{ margin: 0, color: "var(--ink-dim)" }}>{where}</p>
    <div className="row"><button type="button" className="btn primary sm" disabled={busy} onClick={() => invite(false)}>{busy ? "Sending…" : u.lastLogin ? "Send invite again" : "Send invite email"}</button></div>{hint}{noteEl}
  </> : <>
    <p style={{ margin: 0, color: "var(--ink-dim)" }}>{person.name} has no login yet. {where}</p>
    <div className="field"><label htmlFor="app-role-new">App access level</label>
      <select className="input" id="app-role-new" style={{ maxWidth: 320 }} value={newRole} onChange={(ev) => setNewRole(ev.target.value)}>{accessOptions()}</select>
      <span className="hint">{ACCESS_HELP[newRole]}{dept === "hr" && newRole === "hr" ? " This person is in HR, so HR rights are preselected." : ""}</span></div>
    <div className="row"><button type="button" className="btn primary sm" disabled={busy} onClick={() => invite(true, true)}>{busy ? "Working…" : "Create login and send invite"}</button>
      <button type="button" className="btn glass sm" disabled={busy} onClick={() => invite(true, false)}>Create login only</button></div>{hint}{noteEl}
  </>);
}
