import { useState } from "react";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { SectionHead } from "../components/ui.jsx";
import { useToast } from "../components/toast.jsx";

export default function Account() {
  const { user, isHr } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (f.next !== f.again) { toast("The two new passwords do not match."); return; }
    const r = await api("POST", "/api/password", { current: f.current, next: f.next });
    toast(r.ok ? "Password changed." : apiMsg(r));
    if (r.ok) setF({ current: "", next: "", again: "" });
  };
  const signOut = async () => { await api("POST", "/api/logout"); location.href = "/login"; };
  return (
    <section className="section">
      <SectionHead eyebrow="Account" title="Your" accent="account." sub={`${user.email} · ${isHr ? "HR" : "Employee"}`} />
      <div className="card"><div className="card-h"><h3>Change password</h3></div><div className="card-b">
        <form className="form" onSubmit={submit} noValidate>
          <div className="field" style={{ gridColumn: "1/-1" }}><label htmlFor="pw-cur">Current password</label>
            <input className="input" id="pw-cur" type="password" autoComplete="current-password" value={f.current} onChange={set("current")} /></div>
          <div className="field"><label htmlFor="pw-new">New password</label>
            <input className="input" id="pw-new" type="password" autoComplete="new-password" value={f.next} onChange={set("next")} /><span className="hint">At least 8 characters.</span></div>
          <div className="field"><label htmlFor="pw-new2">New password again</label>
            <input className="input" id="pw-new2" type="password" autoComplete="new-password" value={f.again} onChange={set("again")} /></div>
          <div className="row" style={{ gridColumn: "1/-1" }}><button type="submit" className="btn primary sm">Change password</button></div>
        </form>
      </div></div>
      {isHr && (
        <div className="card"><div className="card-h"><h3>Logins and roles</h3></div><div className="card-b">
          <p className="muted" style={{ margin: "0 0 12px" }}>Create accounts, change roles, reset passwords and set the default password.</p>
          <a className="btn glass" href="/app/users">Manage users</a>
        </div></div>
      )}
      <div className="card"><div className="card-b"><button type="button" className="btn glass" onClick={signOut}>Sign out</button></div></div>
    </section>
  );
}
