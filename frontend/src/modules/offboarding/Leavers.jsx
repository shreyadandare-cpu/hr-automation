import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import Modal from "../../components/Modal.jsx";
import { Pill, Person, SectionHead } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { lc } from "../../lib/useLeave.js";
import { OffTabs, StatusPill } from "./shared.jsx";

const CLAUDE = {
  active: ["Has Claude access", "bad"],
  invited: ["Invite not accepted yet", "warn"],
  failed: ["Last attempt failed", "bad"],
  revoked: ["Removed", "ok"],
};
const live = (p) => ["active", "invited", "failed"].includes((p.grants || {}).claude);

/* Everyone leaving or gone, and whether they still have Claude. HR removes it here, one person or all at once. */
export default function Leavers() {
  const { isHr } = useAuth();
  const { people, reload } = useData();
  const toast = useToast();
  const [offs, setOffs] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [ask, setAsk] = useState(null);       // the people HR is asked to confirm removing
  const [busy, setBusy] = useState(null);     // { done, total } while removing
  useEffect(() => { if (isHr) api("GET", "/api/offboarding").then((r) => setOffs(r.ok && Array.isArray(r.data) ? r.data : [])); }, [isHr]);

  if (!isHr) return <section className="section"><SectionHead eyebrow="Offboarding" title="Leaving and" accent="left." /><div className="empty">Only HR can see this.</div></section>;
  if (!people || !offs) return <section className="section"><div className="empty">Loading…</div></section>;
  const isLeaving = (p) => ["offboarding", "offboarded"].includes(p.status) || p.lastDay || offs.some((o) => lc(o.email) === lc(p.email));
  // Still on Claude first, then by name.
  const list = people.filter(isLeaving).sort((a, b) => live(b) - live(a) || a.name.localeCompare(b.name));
  const onClaude = list.filter(live);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const r = await api("POST", "/api/tool-access/claude/refresh");
    setRefreshing(false);
    if (!r.ok) { toast(apiMsg(r)); return; }
    if (r.data.mode === "simulated") { toast("Claude is not connected yet (no admin key), so there is nothing to refresh."); return; }
    await reload();
    toast(r.data.changed ? `Claude status updated for ${r.data.changed} ${r.data.changed === 1 ? "person" : "people"}.` : "Already up to date with the Claude organization.");
  };
  const remove = async () => {
    let ok = 0, failed = 0, test = false, firstError = "";
    setBusy({ done: 0, total: ask.length });
    for (const p of ask) {
      const r = await api("POST", "/api/tool-access/claude", { email: p.email, action: "remove" });
      if (r.ok) { ok++; if (r.data && r.data.mode === "simulated") test = true; } else { failed++; firstError = firstError || apiMsg(r); }
      setBusy({ done: ok + failed, total: ask.length });
    }
    const one = ask.length === 1 ? ask[0].name : null;
    setBusy(null); setAsk(null);
    await reload();
    toast(test ? "Done as a test only: Claude is not connected yet (no admin key)."
      : failed ? `Claude access: ${ok} removed, ${failed} failed. ${firstError}` : one ? `Claude access removed for ${one}.` : `Claude access removed for ${ok} people.`);
  };

  return (
    <section className="section">
      <OffTabs cur="leavers" />
      <SectionHead eyebrow="Offboarding" title="Leaving and" accent="left." sub="Everyone leaving or gone, and whether they still have Claude. Remove it here, or offboard them fully from the first tab."
        actions={<div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn glass sm" disabled={refreshing} onClick={refresh}>{refreshing ? "Checking…" : "Refresh Claude status"}</button>
          {onClaude.length > 1 && <button type="button" className="btn danger sm" disabled={!!busy} onClick={() => setAsk(onClaude)}>Remove Claude for all ({onClaude.length})</button>}</div>} />
      <div className="card"><div className="tbl-wrap"><table>
        <thead><tr><th>Employee</th><th>Status</th><th>Claude access</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {list.length ? list.map((p) => {
            const st = (p.grants && p.grants.claude) || "none", [label, tone] = CLAUDE[st] || ["No Claude access", "mute"];
            return (
              <tr key={p.id}>
                <td><Person name={p.name} sub={p.title} color={p.color} /></td>
                <td><StatusPill person={p} /></td>
                <td><Pill tone={tone}>{label}</Pill></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {live(p) && <button type="button" className="btn danger sm" disabled={!!busy} onClick={() => setAsk([p])} style={{ marginRight: 8 }}>Remove access</button>}
                  <Link className="btn glass sm" to={`/app/employees/${encodeURIComponent(p.email)}`}>Open profile</Link></td>
              </tr>);
          }) : <tr><td colSpan="4"><div className="empty">No one is leaving right now.</div></td></tr>}
        </tbody>
      </table></div></div>
      {ask && <Modal onClose={() => !busy && setAsk(null)}>
        <div className="card-h" style={{ paddingTop: 24 }}><h3>Remove Claude access?</h3></div>
        <div className="card-b">{ask.length === 1 ? `Are you sure you want to remove ${ask[0].name}'s Claude access?` : `Are you sure you want to remove Claude access for ${ask.length} people?`} They are taken out of the Claude organization right away, and any pending invite is cancelled.</div>
        <div className="modal-f"><button type="button" className="btn glass" disabled={!!busy} onClick={() => setAsk(null)}>Cancel</button>
          <button type="button" className="btn danger" disabled={!!busy} onClick={remove}>{busy ? `Removing… ${busy.done}/${busy.total}` : "Yes, remove"}</button></div>
      </Modal>}
    </section>
  );
}
