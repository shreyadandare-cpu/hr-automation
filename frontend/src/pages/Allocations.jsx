import { useEffect, useMemo, useState } from "react";
import { api, apiMsg } from "../api.js";
import { Callout, Pill, SectionHead, shortDate } from "../components/ui.jsx";
import Pager, { Paged } from "../components/Pager.jsx";

const dash = <span className="muted">—</span>;
const tone = (s) => (s === "Active" ? "ok" : s === "Completed" ? "info" : "mute");

/* Who works on which project: one row per employee per project, from the company database. */
export default function Allocations() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [view, setView] = useState("current");
  useEffect(() => {
    api("GET", "/api/allocations").then((r) => { if (r.ok) setRows(r.data); else { setError(apiMsg(r)); setRows([]); } });
  }, []);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows || []).filter((a) => (view === "all" || (view === "current") === (a.status === "Active"))
      && (!s || `${a.project} ${a.employee} ${a.lead || ""} ${a.location || ""}`.toLowerCase().includes(s)));
  }, [rows, q, view]);
  return (
    <section className="section">
      <SectionHead eyebrow="Projects" title="Project" accent="allocations." sub={rows ? `${rows.length} allocations · one row per employee per project` : "Loading…"} />
      {error && <Callout>{error}</Callout>}
      <Paged items={shown} resetKey={`${q}|${view}`}>{(page, pager) => (
        <div className="card">
          <div className="filters">
            <input className="input grow" placeholder="Search employee, project or lead…" aria-label="Search allocations" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" aria-label="Show" value={view} onChange={(e) => setView(e.target.value)}>
              <option value="current">Current allocations</option><option value="ended">Ended allocations</option><option value="all">All allocations</option>
            </select>
          </div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Project</th><th>Employee</th><th>Start</th><th>End</th><th>Project lead</th><th>Location</th><th>Status</th><th>Handed over to</th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan="8"><div className="empty">Loading…</div></td></tr>}
              {rows && !page.length && <tr><td colSpan="8"><div className="empty">No allocations match.</div></td></tr>}
              {page.map((a) => (
                <tr key={a.id}>
                  <td><b>{a.project}</b></td>
                  <td style={{ whiteSpace: "nowrap" }}>{a.employee}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{a.start ? shortDate(a.start) : dash}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{a.end ? shortDate(a.end) : dash}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{a.lead || dash}</td>
                  <td>{a.location || dash}</td>
                  <td><Pill tone={tone(a.status)}>{a.status}</Pill></td>
                  <td style={{ whiteSpace: "nowrap" }}>{a.handedOverTo || dash}</td>
                </tr>))}
            </tbody>
          </table></div>
          {rows && <Pager {...pager} />}
        </div>)}
      </Paged>
    </section>
  );
}
