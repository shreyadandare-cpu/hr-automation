import { useEffect, useMemo, useState } from "react";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Callout, SectionHead } from "../components/ui.jsx";

/* Every recorded action, newest first, straight from the server's audit log. */
export default function Audit() {
  const { isHr } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!isHr) return;
    api("GET", "/api/audit?limit=500").then((r) => { if (r.ok) setRows(r.data); else { setError(apiMsg(r)); setRows([]); } });
  }, [isHr]);
  const shown = useMemo(() => {
    const s = q.toLowerCase();
    return (rows || []).filter((a) => !s || `${a.name || ""} ${a.email || ""} ${a.action}`.toLowerCase().includes(s));
  }, [rows, q]);
  if (!isHr) return <section className="section"><SectionHead eyebrow="Compliance" title="Audit" accent="log." /><div className="empty">Only HR can see the audit log.</div></section>;
  return (
    <section className="section">
      <SectionHead eyebrow="Compliance" title="Audit" accent="log." sub="Every action recorded by the server and who it was about. Entries can't be edited or deleted." />
      {error && <Callout>{error}</Callout>}
      <div className="card">
        <div className="filters"><input className="input grow" placeholder="Filter by person or action" aria-label="Filter by person or action" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>When</th><th>Person</th><th>Action</th></tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan="3"><div className="empty">Loading…</div></td></tr>}
            {rows && !shown.length && <tr><td colSpan="3"><div className="empty">No entries match.</div></td></tr>}
            {shown.map((a) => (
              <tr key={a.id}>
                <td className="num-cell mono" style={{ whiteSpace: "nowrap" }}>{new Date(a.ts).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                <td style={{ whiteSpace: "nowrap" }}>{a.name || a.email || <span className="muted">System</span>}</td>
                <td>{a.action}</td>
              </tr>))}
          </tbody>
        </table></div>
      </div>
    </section>
  );
}
