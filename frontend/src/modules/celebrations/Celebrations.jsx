import { useCallback, useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import BackButton from "../../components/BackButton.jsx";
import Modal from "../../components/Modal.jsx";
import PersonAvatar from "../../components/PersonAvatar.jsx";
import { Pill, SectionHead } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import Wizard from "./Wizard.jsx";
import "./cel.css";

const day = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }); };
const when = (t) => (t ? new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const STATUS = { sent: ["ok", "Sent"], partial: ["warn", "Partly sent"], failed: ["bad", "Failed"], sending: ["info", "Sending…"] };

/* Celebrations (HR): today's birthdays, upcoming birthdays, new joiners and the posters already sent, with a six-step wizard to make a new one. */
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

  const row = (e, occasion, note) => (
    <div className="cel-row" key={e.email}>
      <PersonAvatar email={e.email} name={e.name} />
      <span className="who"><b>{e.name}</b><span>{note}</span></span>
      {e.announced ? <Pill tone="ok">Sent</Pill> : <button type="button" className="btn glass sm" onClick={() => setWizard({ occasion, email: e.email })}>Create poster</button>}
    </div>
  );
  const none = (t) => <div className="empty">{t}</div>;

  return (
    <div className="cel">
      <BackButton />
      <SectionHead eyebrow="HR" title="Celebrations &" accent="announcements" sub="Birthdays come from the dates of birth on file and new joiners from their start date. Nothing is emailed until you approve the poster."
        actions={<button type="button" className="btn primary" onClick={() => setWizard({})}>New announcement</button>} big={false} />
      {!ov.mailReady && <div className="cel-warn">Email is not set up on this server. You can make posters, but sending needs <code>SENDGRID_API_KEY</code> and <code>MAIL_FROM</code> in the backend settings.</div>}

      <div className="cel-grid">
        <div className="card"><div className="card-h"><h3>Today's birthdays</h3></div>
          <div className="cel-list">{ov.birthdaysToday.length ? ov.birthdaysToday.map((e) => row(e, "birthday", e.title || "Birthday today")) : none("Nobody has a birthday today.")}</div></div>
        <div className="card"><div className="card-h"><h3>Upcoming birthdays</h3><span className="muted">next 30 days</span></div>
          <div className="cel-list">{ov.upcoming.length ? ov.upcoming.slice(0, 8).map((e) => (
            <div className="cel-row" key={e.email}><PersonAvatar email={e.email} name={e.name} /><span className="who"><b>{e.name}</b><span>{day(e.date)}{e.title ? ` · ${e.title}` : ""}</span></span></div>)) : none("No birthdays in the next 30 days.")}</div></div>
        <div className="card"><div className="card-h"><h3>Recently joined</h3><span className="muted">last 30 days</span></div>
          <div className="cel-list">{ov.joiners.length ? ov.joiners.map((e) => row(e, "welcome", `${e.title || "New joiner"} · joined ${day(e.start)}`)) : none("Nobody joined recently. Use New announcement to welcome someone else.")}</div></div>
      </div>

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
