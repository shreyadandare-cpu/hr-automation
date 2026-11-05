import { useCallback, useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import { Pill, Person, SectionHead, shortDate } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { ObTabs } from "./shared.jsx";

const daysSince = (s) => Math.max(0, Math.floor((Date.now() - new Date(s)) / 864e5));
const waited = (n) => (n === 0 ? "Today" : n === 1 ? "1 day" : `${n} days`);

/* Who is waiting to be invited to Claude. HR asks for access; the Claude admin invites the person in Claude and clicks Done here. */
export default function ClaudeRequests() {
  const { isHr, itAdmin } = useAuth();
  const { reload, claudeMode } = useData();
  const toast = useToast();
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const r = await api("GET", "/api/claude-requests");
    if (r.ok) setList(r.data); else setList({ error: apiMsg(r) });
  }, []);
  useEffect(() => { if (itAdmin) load(); }, [itAdmin, load]);

  const tabs = isHr ? <ObTabs cur="claude" /> : null;
  if (!itAdmin) return <section className="section"><SectionHead eyebrow="Claude" title="Claude access" accent="requests." /><div className="empty">Only HR and IT admins can see Claude requests.</div></section>;
  if (!list) return <section className="section">{tabs}<div className="empty">Loading…</div></section>;
  if (list.error) return <section className="section">{tabs}<div className="empty">{list.error}</div></section>;

  const act = async (what, p, okText) => {
    setBusy(p.email + what);
    const r = await api("POST", `/api/claude-requests/${what}`, { email: p.email });
    setBusy(null);
    if (!r.ok) { toast(apiMsg(r)); await load(); return; }
    toast(okText);
    await Promise.all([load(), reload()]);
  };
  const copy = async (email) => {
    try { await navigator.clipboard.writeText(email); toast("Email copied."); } catch { toast("Could not copy. Select the email and copy it."); }
  };
  const mail = (p) => <><span className="mono">{p.email}</span> <button type="button" className="btn link sm" onClick={() => copy(p.email)}>Copy</button></>;

  return (
    <section className="section">
      {tabs}
      <SectionHead eyebrow="Claude" title="Claude access" accent="requests."
        sub="Invite each person below from Claude (Settings, Members, Invite), then click Done here. Once they accept the email from Claude, mark them as accepted." />
      {claudeMode !== "simulated" && <div className="empty" style={{ marginBottom: 16 }}>Claude is connected to this app, so invites are sent automatically. This list only shows requests made before that.</div>}

      <div className="card"><div className="card-h"><h3>To invite</h3><span className="muted">{list.toInvite.length} waiting</span></div><div className="tbl-wrap"><table>
        <thead><tr><th>Employee</th><th>Work email</th><th>Waiting</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {list.toInvite.length ? list.toInvite.map((p) => {
            const n = daysSince(p.since);
            return (
              <tr key={p.email}>
                <td><Person name={p.name} sub={p.title} /></td>
                <td>{mail(p)}</td>
                <td><Pill tone={n >= list.remindDays ? "warn" : "mute"}>{waited(n)}</Pill></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button type="button" className="btn primary sm" disabled={!!busy} onClick={() => act("done", p, `${p.name} is marked as invited.`)}>Done</button>{" "}
                  <button type="button" className="btn glass sm" disabled={!!busy} onClick={() => act("cancel", p, `The request for ${p.name} was cancelled.`)}>Cancel request</button>
                </td>
              </tr>);
          }) : <tr><td colSpan="4"><div className="empty">Nobody is waiting to be invited.</div></td></tr>}
        </tbody>
      </table></div></div>

      <div className="card" style={{ marginTop: 22 }}><div className="card-h"><h3>Invited, waiting to accept</h3><span className="muted">{list.invited.length} waiting</span></div><div className="tbl-wrap"><table>
        <thead><tr><th>Employee</th><th>Work email</th><th>Invited on</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {list.invited.length ? list.invited.map((p) => (
            <tr key={p.email}>
              <td><Person name={p.name} sub={p.title} /></td>
              <td>{mail(p)}</td>
              <td>{shortDate(String(p.since).slice(0, 10))}</td>
              <td style={{ textAlign: "right" }}><button type="button" className="btn glass sm" disabled={!!busy} onClick={() => act("active", p, `${p.name} is marked as having Claude access.`)}>Mark as accepted</button></td>
            </tr>)) : <tr><td colSpan="4"><div className="empty">No invites are waiting.</div></td></tr>}
        </tbody>
      </table></div></div>
    </section>
  );
}
