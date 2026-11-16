import { useCallback, useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import BackButton from "../../components/BackButton.jsx";
import Modal from "../../components/Modal.jsx";
import { Pill, SectionHead } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import Wizard from "./Wizard.jsx";
import "./cel.css";

const when = (t) => (t ? new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const STATUS = { sent: ["ok", "Sent"], partial: ["warn", "Partly sent"], failed: ["bad", "Failed"], sending: ["info", "Sending…"] };

/* Celebrations (HR): a six-step wizard to make a new announcement poster, and the posters already sent. */
export default function Celebrations() {
  const toast = useToast();
  const [ov, setOv] = useState(null);
  const [history, setHistory] = useState(null);
  const [wizard, setWizard] = useState(null);   // { occasion?, email? }
  const [view, setView] = useState(null);       // a poster in a dialog
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const [o, h] = await Promise.all([api("GET", "/api/celebrations/overview"), api("GET", "/api/celebrations")]);
    if (!o.ok || !h.ok) { setFailed(true); return; }
    setFailed(false); setOv(o.data); setHistory(h.data.items);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {   // a poster still going out refreshes itself
    if (!history || !history.some((h) => h.status === "sending")) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [history, load]);

  const retry = async (h) => {
    const r = await api("POST", `/api/celebrations/${h.id}/retry`);
    if (!r.ok) return toast(apiMsg(r));
    toast("Retrying the emails that failed…"); load();
  };

  if (failed) return <div className="cel"><div className="card"><div className="empty">Celebrations could not be loaded. <button type="button" className="btn link" onClick={load}>Try again</button></div></div></div>;
  if (!ov) return <div className="cel"><div className="card"><div className="empty">Loading…</div></div></div>;

  if (wizard) {
    return (
      <div className="cel">
        <SectionHead eyebrow="Celebrations" title="New" accent="announcement" sub="Pick the occasion, add a photo, check the poster and send it to everyone." big={false} />
        <Wizard overview={ov} start={wizard} onClose={() => { setWizard(null); load(); }} onDone={load} />
      </div>
    );
  }

  return (
    <div className="cel">
      <BackButton />
      <SectionHead eyebrow="HR" title="Celebrations &" accent="announcements" sub="Make a birthday or welcome poster and send it to everyone. Nothing is emailed until you approve the poster."
        actions={<button type="button" className="btn primary" onClick={() => setWizard({})}>New announcement</button>} big={false} />
      {!ov.mailReady && <div className="cel-warn">Email is not set up on this server. You can make posters, but sending needs <code>SENDGRID_API_KEY</code> and <code>MAIL_FROM</code> in the backend settings.</div>}

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
                  <td>{h.occasion === "birthday" ? "Birthday" : "Welcome"}</td>
                  <td>{when(h.createdAt)}</td>
                  <td>{h.createdBy.split("@")[0]}</td>
                  <td>{h.counts.sent} of {h.counts.total - h.counts.skipped}</td>
                  <td><Pill tone={tone}>{label}</Pill>{h.counts.failed > 0 && <span className="muted"> {h.counts.failed} failed</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn link" onClick={() => setView(h)}>View poster</button>
                    {(h.status === "partial" || h.status === "failed") && <button type="button" className="btn glass sm" onClick={() => retry(h)}>Retry failed</button>}
                  </td>
                </tr>);
            })}
          </tbody>
        </table></div>
      </div>

      {view && (
        <Modal onClose={() => setView(null)}>
          <div className="cel-poster-modal">
            <h3 style={{ margin: 0 }}>{view.employee.name} · {view.occasion === "birthday" ? "Birthday" : "Welcome"}</h3>
            <img src={`/api/celebrations/${view.id}/poster`} alt={`Poster for ${view.employee.name}`} />
            <span className="muted">Sent {when(view.sentAt || view.createdAt)} · {view.counts.sent} delivered{view.counts.failed ? `, ${view.counts.failed} failed` : ""}</span>
            <button type="button" className="btn glass" onClick={() => setView(null)}>Close</button>
          </div>
        </Modal>)}
    </div>
  );
}
