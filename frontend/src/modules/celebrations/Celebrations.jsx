import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.js";
import BackButton from "../../components/BackButton.jsx";
import Modal from "../../components/Modal.jsx";
import { Pill, SectionHead } from "../../components/ui.jsx";
import { OCCASIONS } from "./poster.js";

const when = (t) => (t ? new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const STATUS = { sent: ["ok", "Sent"], partial: ["warn", "Partly sent"], failed: ["bad", "Failed"], sending: ["info", "Sending…"] };

/* Celebrations (HR): the posters already sent. Viewing only: the page offers no way to create or send a poster
   (today's birthdays, anniversaries and new joiners are on the dashboard). */
export default function Celebrations() {
  const [history, setHistory] = useState(null);
  const [view, setView] = useState(null);       // a poster in a dialog
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const h = await api("GET", "/api/celebrations");
    if (!h.ok) { setFailed(true); return; }
    setFailed(false); setHistory(h.data.items);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {   // a poster still going out refreshes itself
    if (!history || !history.some((h) => h.status === "sending")) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [history, load]);

  if (failed) return <div className="cel-page"><div className="card"><div className="empty">Celebrations could not be loaded. <button type="button" className="btn link" onClick={load}>Try again</button></div></div></div>;
  if (!history) return <div className="cel-page"><div className="card"><div className="empty">Loading…</div></div></div>;

  return (
    <div className="cel-page">
      <BackButton />
      <SectionHead eyebrow="HR" title="Celebrations &" accent="announcements" sub="The birthday and welcome posters that have already gone out." big={false} />
      <div className="card">
        <div className="card-h"><h3>Announcement history</h3></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Employee</th><th>Occasion</th><th>Created</th><th>Created by</th><th>Recipients</th><th>Delivery</th><th /></tr></thead>
          <tbody>
            {!history.length && <tr><td colSpan="7"><div className="empty">No posters sent yet.</div></td></tr>}
            {history.map((h) => {
              const [tone, label] = STATUS[h.status] || ["mute", h.status];
              return (
                <tr key={h.id}>
                  <td><b>{h.employee.name}</b></td>
                  <td>{(OCCASIONS[h.occasion] || {}).name || h.occasion}</td>
                  <td>{when(h.createdAt)}</td>
                  <td>{h.createdBy.split("@")[0]}</td>
                  <td>{h.counts.sent} of {h.counts.total - h.counts.skipped}</td>
                  <td><Pill tone={tone}>{label}</Pill>{h.counts.failed > 0 && <span className="muted"> {h.counts.failed} failed</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}><button type="button" className="btn link" onClick={() => setView(h)}>View poster</button></td>
                </tr>);
            })}
          </tbody>
        </table></div>
      </div>

      {view && (
        <Modal onClose={() => setView(null)}>
          <div className="cel-poster-modal">
            <h3 style={{ margin: 0 }}>{view.employee.name} · {(OCCASIONS[view.occasion] || {}).name || view.occasion}</h3>
            <img src={`/api/celebrations/${view.id}/poster`} alt={`Poster for ${view.employee.name}`} />
            <span className="muted">Sent {when(view.sentAt || view.createdAt)} · {view.counts.sent} delivered{view.counts.failed ? `, ${view.counts.failed} failed` : ""}</span>
            <button type="button" className="btn glass" onClick={() => setView(null)}>Close</button>
          </div>
        </Modal>)}
    </div>
  );
}
