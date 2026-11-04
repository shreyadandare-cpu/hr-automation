import { useState } from "react";
import { Link } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import { Pill, Person, SectionHead } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { ObTabs } from "./shared.jsx";

const CLAUDE = {
  active: ["Has Claude access", "ok"],
  invited: ["Invite sent", "info"],
  failed: ["Invite failed", "bad"],
};

/* Everyone whose onboarding is not finished, and whether they have Claude. Access itself is given from the person's profile. */
export default function Progress() {
  const { isHr } = useAuth();
  const { people, reload } = useData();
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  if (!isHr) return <section className="section"><SectionHead eyebrow="Onboarding" title="In" accent="onboarding." /><div className="empty">Only HR can see who is being onboarded.</div></section>;
  if (!people) return <section className="section"><div className="empty">Loading…</div></section>;
  const waiting = people.filter((x) => x.status === "onboarding").sort((a, b) => a.name.localeCompare(b.name));

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

  return (
    <section className="section">
      <ObTabs cur="progress" />
      <SectionHead eyebrow="Onboarding" title="Who is" accent="joining." sub="People whose onboarding is not finished, and whether they have Claude. Open a profile to give Claude access."
        actions={<button type="button" className="btn glass sm" disabled={refreshing} onClick={refresh}>{refreshing ? "Checking…" : "Refresh Claude status"}</button>} />
      <div className="card"><div className="tbl-wrap"><table>
        <thead><tr><th>Employee</th><th>Claude access</th><th aria-label="Open" /></tr></thead>
        <tbody>
          {waiting.length ? waiting.map((x) => {
            const st = (x.grants && x.grants.claude) || "none", [label, tone] = CLAUDE[st] || ["No Claude access yet", "mute"];
            return (
              <tr key={x.id}>
                <td><Person name={x.name} sub={x.title} /></td>
                <td><Pill tone={tone}>{label}</Pill></td>
                <td style={{ textAlign: "right" }}><Link className="btn glass sm" to={`/app/employees/${encodeURIComponent(x.email)}`}>Open profile</Link></td>
              </tr>);
          }) : <tr><td colSpan="3"><div className="empty">No one is being onboarded right now.</div></td></tr>}
        </tbody>
      </table></div></div>
    </section>
  );
}
