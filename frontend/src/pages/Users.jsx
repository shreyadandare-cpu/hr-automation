import BackButton from "../components/BackButton.jsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Callout, SectionHead } from "../components/ui.jsx";
import { useToast } from "../components/toast.jsx";
import Pager, { usePaged } from "../components/Pager.jsx";
import { byEmployeeNo } from "../lib/people.js";

const COMPANY = /^[^@\s]+@wohlig\.com$/i;
const hrConfirm = (who) => confirm(`Give ${who} full HR rights?\n\nHR can see and change everything in the app: onboarding, offboarding, leave, the audit log and everyone's logins. Only do this for someone who works in HR.`);

export default function Users() {
  const { user, isHr } = useAuth();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [create, setCreate] = useState({ email: "", role: "employee" });
  const [defaultPw, setDefaultPw] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testNote, setTestNote] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const r = await api("GET", "/api/users");
    if (r.ok) { setD(r.data); setDefaultPw(r.data.defaultPassword || ""); }
    else { toast(apiMsg(r)); setD({ users: [], withoutAccount: 0, defaultPassword: "" }); }
  }, [toast]);
  useEffect(() => { if (isHr) load(); }, [isHr, load]);

  const everyone = useMemo(() => {
    if (!d) return [];
    const s = q.trim().toLowerCase();
    const all = [...d.users.map((u) => ({ ...u, login: true })), ...(d.noLogin || []).map((p) => ({ ...p, login: false }))];
    return all.filter((r) => !s || `${r.no} ${r.name} ${r.email} ${r.title}`.toLowerCase().includes(s)).sort(byEmployeeNo);
  }, [d, q]);
  const { rows: pageRows, pager } = usePaged(everyone, q);

  if (!isHr) return <section className="section"><SectionHead eyebrow="People" title="Logins and" accent="roles." /><div className="empty">Only HR can manage logins.</div></section>;

  const act = async (p, ok, after = load) => { const r = await p; toast(r.ok ? ok : apiMsg(r)); if (r.ok) after(); return r; };
  const createAccount = async (e) => {
    e.preventDefault();
    const email = create.email.trim();
    if (!email) { toast("Enter the work email first."); return; }
    if (!COMPANY.test(email)) { toast("Only @wohlig.com addresses can have an account."); return; }
    if (create.role === "hr" && !hrConfirm(email)) return;
    const r = await api("POST", "/api/users", { email, role: create.role, sendInvite: true });
    if (!r.ok) { toast(apiMsg(r)); return; }
    const sent = r.data.invite && r.data.invite.mode === "email";
    toast(sent ? "Employee created successfully. Invitation email sent." : "Employee created, but the invitation email could not be sent. Use “Resend invite” on their row to try again.");
    setCreate({ email: "", role: "employee" });
    load();
  };
  const makeLogin = async (p) => {
    const r = await api("POST", "/api/users", { email: p.email, role: "employee", sendInvite: true });
    if (!r.ok) { toast(apiMsg(r)); return; }
    toast(r.data.invite && r.data.invite.mode === "email" ? `Login created for ${p.name}. Invitation email sent.` : `Login created for ${p.name}, but the invitation email could not be sent. Use "Send invite" to try again.`);
    load();
  };
  const resend = async (u) => {
    const r = await api("POST", "/api/auth/resend-invitation", { email: u.email });
    toast(r.ok ? `Invitation sent to ${u.email}. Earlier links no longer work.` : apiMsg(r));
    if (r.ok) load();
  };
  const changeRole = async (u, role) => {
    if (role === "hr" && !hrConfirm(u.name || u.email)) { load(); return; }
    const r = await api("PUT", `/api/users/${encodeURIComponent(u.email)}/role`, { role });
    toast(r.ok ? "Role updated." : apiMsg(r)); if (!r.ok) load(); else load();
  };
  const sendTest = async (e) => {
    e.preventDefault();
    const to = testTo.trim();
    if (!to) { toast("Enter the address to send the test to."); return; }
    setTestBusy(true); setTestNote("");
    const r = await api("POST", "/api/users/test-email", { to });
    setTestNote(r.ok ? `Test email sent to ${to}. Ask them to check their inbox (and spam).` : apiMsg(r));
    setTestBusy(false);
  };

  return (
    <section className="section">
      <BackButton />
      <SectionHead eyebrow="People" title="Logins and" accent="roles." sub="HR creates every account. New accounts start with the default password, and people can change it on their Account page." />
      {!d ? <div className="card"><div className="card-b muted">Loading…</div></div> : (
        <>
          <div className="card"><div className="card-h"><h3>Default password</h3><span className="muted">Given to every new account and every reset</span></div><div className="card-b">
            <form className="row" onSubmit={(e) => { e.preventDefault(); act(api("PUT", "/api/users/default-password", { value: defaultPw }), "Default password changed. It applies to new accounts and resets."); }}>
              <input className="input mono" value={defaultPw} onChange={(e) => setDefaultPw(e.target.value)} style={{ maxWidth: 280 }} aria-label="Default password" autoComplete="off" />
              <button type="submit" className="btn glass sm">Change default</button>
            </form>
            <p className="muted" style={{ margin: "12px 0 0", fontSize: "12.5px" }}>Anyone who knows this password can sign in as a person who has not changed theirs yet. Share it only with the person it is for, and tell everyone to change it.</p>
          </div></div>

          <div className="card"><div className="card-h"><h3>Create an account</h3></div><div className="card-b">
            <form className="row" onSubmit={createAccount} noValidate>
              <input className="input" type="email" placeholder="name.surname@wohlig.com" style={{ maxWidth: 300 }} aria-label="Work email" autoComplete="off" value={create.email} onChange={(e) => setCreate({ ...create, email: e.target.value })} />
              <select className="input" style={{ maxWidth: 150 }} aria-label="Role" value={create.role} onChange={(e) => setCreate({ ...create, role: e.target.value })}><option value="employee">Employee</option><option value="hr">HR</option></select>
              <button type="submit" className="btn primary sm">Create account</button>
              <button type="button" className="btn glass sm" disabled={!d.withoutAccount}
                onClick={async () => { const r = await api("POST", "/api/users/bulk"); toast(r.ok ? `${r.data.created} account${r.data.created === 1 ? "" : "s"} created.` : apiMsg(r)); if (r.ok) load(); }}>
                Create for everyone without one ({d.withoutAccount})
              </button>
            </form>
          </div></div>

          <div className="card"><div className="card-h"><h3>Send a test email</h3><span className="muted">Check that email works</span></div><div className="card-b">
            <form className="row" onSubmit={sendTest} noValidate>
              <input className="input" type="email" placeholder="name@wohlig.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} style={{ maxWidth: 300 }} aria-label="Send the test email to" autoComplete="off" />
              <button type="submit" className="btn primary sm" disabled={testBusy}>{testBusy ? "Sending…" : "Send test email"}</button>
            </form>
            {testNote && <div style={{ marginTop: 14 }}><Callout>{testNote}</Callout></div>}
            {!d.mailConfigured && <p className="muted" style={{ margin: "12px 0 0", fontSize: "12.5px" }}>Email isn't set up on the server yet. Add the SMTP settings to <span className="mono">backend/.env</span> and restart, then this will send for real.</p>}
          </div></div>

          <div className="card"><div className="card-h"><h3>Everyone</h3>
              <div className="row"><span className="muted">{d.users.length} with a login · {(d.noLogin || []).length} without</span>
                <input className="input" placeholder="Search by name, ID or email" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} /></div></div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>ID</th><th>Person</th><th>Role</th><th className="hide-sm">Last sign-in</th><th></th></tr></thead>
              <tbody>
                {pageRows.length === 0 && <tr><td colSpan="5"><div className="empty">{q ? `No one matches “${q}”.` : "No people yet."}</div></td></tr>}
                {pageRows.map((u) => u.login ? (
                  <tr key={u.email}>
                    <td className="num-cell"><span className="emp-no">{u.no}</span></td>
                    <td><b>{u.name || u.email}</b><div className="muted">{u.email}</div></td>
                    <td><select className="input" style={{ maxWidth: 140 }} aria-label={`Role for ${u.email}`} value={u.role} onChange={(e) => changeRole(u, e.target.value)}><option value="employee">Employee</option><option value="hr">HR</option></select></td>
                    <td className="hide-sm">{u.lastLogin ? new Date(u.lastLogin).toLocaleString() : "Never"}</td>
                    <td><div className="row">
                      <button type="button" className="btn glass sm" onClick={() => resend(u)}>{u.inviteExpires ? "Resend invite" : "Send invite"}</button>
                      <button type="button" className="btn glass sm" onClick={() => confirm(`Reset ${u.email} to the default password? They will be signed out.`) && act(api("POST", `/api/users/${encodeURIComponent(u.email)}/reset`), `${u.email} was reset to the default password.`, () => {})}>Reset password</button>
                      <button type="button" className="btn glass sm" disabled={u.email.toLowerCase() === user.email.toLowerCase()}
                        onClick={() => confirm(`Delete the account for ${u.email}? They will no longer be able to sign in.`) && act(api("DELETE", `/api/users/${encodeURIComponent(u.email)}`), "Account deleted.")}>Delete</button>
                    </div></td>
                  </tr>
                ) : (
                  <tr key={u.email}>
                    <td className="num-cell"><span className="emp-no">{u.no}</span></td>
                    <td><b>{u.name}</b><div className="muted">{u.email}</div></td>
                    <td><span className="muted">No login yet</span></td>
                    <td className="hide-sm"><span className="muted">—</span></td>
                    <td><button type="button" className="btn primary sm" onClick={() => makeLogin(u)}>Create login &amp; send invite</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <Pager {...pager} />
          </div>
        </>
      )}
    </section>
  );
}
