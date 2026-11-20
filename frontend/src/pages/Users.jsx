import { useCallback, useEffect, useMemo, useState } from "react";
import { DropdownMenu } from "radix-ui";
import { useNavigate } from "react-router-dom";
import Modal from "../components/Modal.jsx";
import { useData } from "../data.jsx";
import { Card as IdCardPreview } from "../modules/idcard/IdCard.jsx";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Icon, SectionHead, pill, ListSkeleton } from "../components/ui.jsx";
import { useToast } from "../components/toast.jsx";
import Pager, { usePaged } from "../components/Pager.jsx";
import { byEmployeeNo } from "../lib/people.js";

const hrConfirm = (who) => confirm(`Give ${who} full HR rights?\n\nHR can see and change everything in the app: onboarding, offboarding, leave, the audit log and everyone's logins. Only do this for someone who works in HR.`);

/* Directors and the Vice President get a label next to their name; everyone shows their designation under it. */
const leadership = (title) => (/\bvice president\b/i.test(title || "") ? "Vice President" : /\bdirector\b/i.test(title || "") ? "Director" : "");
function WhoCell({ name, title, email, flag }) {
  const lead = leadership(title);
  return (
    <td>
      <b>{name || email}</b>{lead && <span className={pill("info")} style={{ marginLeft: 8, verticalAlign: "middle" }}>{lead}</span>}{flag && <span className={pill("bad")} style={{ marginLeft: 8, verticalAlign: "middle" }}>{flag}</span>}
      <div className="muted">{title && title !== "—" && !lead ? `${title} · ` : ""}{email}</div>
    </td>
  );
}

/* The three dots at the end of a login row: every action for that person in one drop-down. */
function RowMenu({ u, canExit, canCard, canReward, nav, self, onCard, onInvite, onReset, onExit, onDisable, onDelete }) {
  const item = "row-menu-i flex w-full items-center gap-3";
  const row = (icon, label, fn, disabled) => <DropdownMenu.Item className={item} disabled={disabled} onSelect={() => fn(u)}><span className="size-5 shrink-0 text-ink-dim"><Icon name={icon} /></span>{label}</DropdownMenu.Item>;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="dots-btn" aria-label={`Actions for ${u.name || u.email}`}>⋯</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="row-menu" align="end" sideOffset={6} collisionPadding={8}>
          {row("mail", u.inviteExpires ? "Resend invite" : "Send invite", onInvite)}
          {row("key", "Reset password", onReset)}
          {canReward && row("medal", "Give a reward", (x) => nav(`/app/rewards?to=${encodeURIComponent(x.email)}`))}
          {canCard && row("idcard", "View ID card", onCard)}
          {canExit && row("offboard", "Initiate exit", onExit)}
          {row("lock", u.blocked ? "Enable login" : "Disable login", onDisable, self)}
          {row("trash", "Delete account", onDelete, self)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export default function Users() {
  const { user, can, canAll, superAdmin } = useAuth();
  const nav = useNavigate();
  const { people } = useData();
  const [cardFor, setCardFor] = useState(null);   // the person whose ID card is open
  const manages = canAll("users.manage");   // logins; giving the HR role or IT admin is for super admins only
  const toast = useToast();
  const [d, setD] = useState(null);
  const [defaultPw, setDefaultPw] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const r = await api("GET", "/api/users");
    if (r.ok) { setD(r.data); setDefaultPw(r.data.defaultPassword || ""); }
    else { toast(apiMsg(r)); setD({ users: [], withoutAccount: 0, defaultPassword: "" }); }
  }, [toast]);
  useEffect(() => { if (manages) load(); }, [manages, load]);

  const everyone = useMemo(() => {
    if (!d) return [];
    const s = q.trim().toLowerCase();
    const all = [...d.users.map((u) => ({ ...u, login: true })), ...(d.noLogin || []).map((p) => ({ ...p, login: false }))];
    return all.filter((r) => !s || `${r.no} ${r.name} ${r.email} ${r.title}`.toLowerCase().includes(s)).sort(byEmployeeNo);
  }, [d, q]);
  const { rows: pageRows, pager } = usePaged(everyone, q);

  if (!manages) return <section className="section"><SectionHead eyebrow="People" title="Users" /><div className="empty">You do not have access to logins. Please ask a super admin if you need it.</div></section>;

  const act = async (p, ok, after = load) => { const r = await p; toast(r.ok ? ok : apiMsg(r)); if (r.ok) after(); return r; };
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
  const toggleLogin = async (u) => {
    const off = !u.blocked;
    if (off && !confirm(`Disable the login for ${u.email}? They will be signed out and cannot sign in until you enable it again.`)) return;
    act(api("PUT", `/api/users/${encodeURIComponent(u.email)}/disabled`, { value: off }), off ? `Login disabled for ${u.email}.` : `Login enabled for ${u.email}.`);
  };
  const changeRole = async (u, role) => {
    if (role === "hr" && !hrConfirm(u.name || u.email)) { load(); return; }
    const r = await api("PUT", `/api/users/${encodeURIComponent(u.email)}/role`, { role });
    toast(r.ok ? "Role updated." : apiMsg(r)); if (!r.ok) load(); else load();
  };

  return (
    <section className="section">
      <SectionHead eyebrow="People" title="Users" sub="HR creates every account. New accounts start with the default password, and people can change it on their Account page." />
      {!d ? <div className="card"><ListSkeleton rows={3} faces={false} /></div> : (
        <>
          <div className="card"><div className="card-h"><h3>Default password</h3><span className="muted">Given to every new account and every reset</span></div><div className="card-b">
            <form className="row" onSubmit={(e) => { e.preventDefault(); act(api("PUT", "/api/users/default-password", { value: defaultPw }), "Default password changed. It applies to new accounts and resets."); }}>
              <input className="input mono" value={defaultPw} onChange={(e) => setDefaultPw(e.target.value)} style={{ maxWidth: 280 }} aria-label="Default password" autoComplete="off" />
              <button type="submit" className="btn glass sm">Change default</button>
            </form>
            <p className="muted" style={{ margin: "12px 0 0", fontSize: "12.5px" }}>Anyone who knows this password can sign in as a person who has not changed theirs yet. Share it only with the person it is for, and tell everyone to change it.</p>
          </div></div>

          <div className="card"><div className="card-h"><h3>Everyone</h3>
              <span className="muted">{d.users.length} with a login, {(d.noLogin || []).length} without</span>
              {canAll("people.view") && <a className="btn glass sm" href="/api/id-cards.pdf" download>Download all ID cards</a>}</div>
            <div className="filters"><input className="input grow" placeholder="Search by name, ID or email" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="tbl-wrap"><table className="users-table">
              <thead><tr><th>ID</th><th>Person</th><th>Role</th><th>IT admin</th><th className="hide-sm">Last sign-in</th><th></th></tr></thead>
              <tbody>
                {pageRows.length === 0 && <tr><td colSpan="6"><div className="empty">{q ? `No one matches “${q}”.` : "No people yet."}</div></td></tr>}
                {pageRows.map((u) => u.login ? (
                  <tr key={u.email}>
                    <td className="num-cell"><span className="emp-no">{u.no}</span></td>
                    <WhoCell name={u.name} title={u.title} email={u.email} flag={u.blocked ? "Login disabled" : ""} />
                    <td><select className="input" aria-label={`Role for ${u.email}`} value={u.role} disabled={!superAdmin} title={superAdmin ? undefined : "Only a super admin can change this."} onChange={(e) => changeRole(u, e.target.value)}><option value="employee">Employee</option><option value="hr">HR</option></select></td>
                    <td><label className="row" style={{ gap: 8 }}><input type="checkbox" aria-label={`IT admin: ${u.email}`} checked={!!u.itAdmin} disabled={!superAdmin} title={superAdmin ? undefined : "Only a super admin can change this."} onChange={(e) => act(api("PUT", `/api/users/${encodeURIComponent(u.email)}/it-admin`, { value: e.target.checked }), e.target.checked ? "Made IT admin. They can now see and manage Assets." : "IT admin removed.")} /><span className="muted">Assets</span></label></td>
                    <td className="hide-sm u-last">{u.lastLogin ? new Date(u.lastLogin).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "Never"}</td>
                    <td className="dots-cell"><RowMenu u={u} self={u.email.toLowerCase() === user.email.toLowerCase()} canExit={canAll("offboarding.manage")} canCard={can("people.view")} canReward={canAll("rewards.give")} nav={nav} onCard={setCardFor}
                      onInvite={resend} onDisable={toggleLogin}
                      onReset={(x) => confirm(`Reset ${x.email} to the default password? They will be signed out.`) && act(api("POST", `/api/users/${encodeURIComponent(x.email)}/reset`), `${x.email} was reset to the default password.`, () => {})}
                      onDelete={(x) => confirm(`Delete the account for ${x.email}? They will no longer be able to sign in.`) && act(api("DELETE", `/api/users/${encodeURIComponent(x.email)}`), "Account deleted.")}
                      onExit={(x) => nav(`/app/offboarding?email=${encodeURIComponent(x.email)}`)} /></td>
                  </tr>
                ) : (
                  <tr key={u.email}>
                    <td className="num-cell"><span className="emp-no">{u.no}</span></td>
                    <WhoCell name={u.name} title={u.title} email={u.email} />
                    <td><span className="muted">No login yet</span></td>
                    <td><span className="muted">—</span></td>
                    <td className="hide-sm"><span className="muted">—</span></td>
                    <td><button type="button" className="btn glass sm" onClick={() => makeLogin(u)}>Create login and send invite</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <Pager {...pager} />
          </div>
        </>
      )}
      {cardFor && (() => {
        const p = (people || []).find((x) => x.email.toLowerCase() === cardFor.email.toLowerCase()) || { name: cardFor.name || cardFor.email, email: cardFor.email, title: cardFor.title, no: cardFor.no };
        return (
          <Modal onClose={() => setCardFor(null)}>
            <div className="card-h"><h3>ID card: {p.name}</h3></div>
            <div className="card-b"><IdCardPreview p={p} /></div>
            <div className="modal-f"><button type="button" className="btn glass" onClick={() => setCardFor(null)}>Close</button>
              <a className="btn primary" href={`/api/id-card.pdf?email=${encodeURIComponent(p.email)}`} download>Download PDF</a></div>
          </Modal>);
      })()}
    </section>
  );
}
