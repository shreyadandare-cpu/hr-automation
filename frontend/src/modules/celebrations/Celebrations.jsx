import { useCallback, useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import Modal from "../../components/Modal.jsx";
import PersonAvatar from "../../components/PersonAvatar.jsx";
import { Pill, SectionHead, CardSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import Wizard from "./Wizard.jsx";
import { OCCASIONS } from "./poster.js";

const when = (t) => (t ? new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const STATUS = { sent: ["ok", "Sent"], partial: ["warn", "Partly sent"], failed: ["bad", "Failed"], sending: ["info", "Sending…"] };

const day = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }); };

/* Celebrations (celebrations.manage, company-wide): today's and coming birthdays, work anniversaries and new joiners, each with a button to make
   its poster (the wizard: occasion, the person's profile photo, template, wording, preview, send), and the posters already sent. */
export default function Celebrations() {
  const manages = useAuth().canAll("celebrations.manage");   // "Celebrations", company-wide
  const toast = useToast();
  const [ov, setOv] = useState(null);
  const [wizard, setWizard] = useState(null);   // { occasion?, email? }
  const [history, setHistory] = useState(null);
  const [view, setView] = useState(null);       // a poster in a dialog
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!manages) return;
    const [o, h] = await Promise.all([api("GET", "/api/celebrations/overview"), api("GET", "/api/celebrations")]);
    if (!o.ok || !h.ok) { setFailed(true); return; }
    setFailed(false); setOv(o.data); setHistory(h.data.items);
  }, [manages]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {   // a poster still going out refreshes itself
    if (!history || !history.some((h) => h.status === "sending")) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [history, load]);

  if (!manages) return <div className="cel-page"><SectionHead title="Celebrations" /><div className="card"><div className="empty">Only the people who run celebrations can see this.</div></div></div>;
  if (failed) return <div className="cel-page"><div className="card"><div className="empty">Celebrations could not be loaded. <button type="button" className="btn link" onClick={load}>Try again</button></div></div></div>;
  if (!history || !ov) return <div className="cel-page"><CardSkeleton lines={4} /></div>;
  if (wizard) {
    return (
      <div className="cel-page">
        <SectionHead eyebrow="Celebrations" title="New announcement" sub="Pick the occasion, check the photo, choose a template and send the poster to everyone." />
        <Wizard overview={ov} start={wizard} onClose={() => { setWizard(null); load(); }} onDone={load} />
      </div>
    );
  }
  const retry = async (h) => {
    const r = await api("POST", `/api/celebrations/${h.id}/retry`);
    if (!r.ok) return toast(apiMsg(r));
    toast("Retrying the emails that failed."); load();
  };
  const Row = ({ p, occasion, note }) => (
    <div className="cel-row">
      <PersonAvatar email={p.email} name={p.name} />
      <div className="who"><b>{p.name}</b><span className="muted">{[p.title, note].filter(Boolean).join(" · ")}</span></div>
      {p.announced ? <Pill tone="ok">Poster sent</Pill> : <button type="button" className="btn glass sm" onClick={() => setWizard({ occasion, email: p.email })}>Create poster</button>}
    </div>
  );
  const Block = ({ title, rows, empty }) => (
    <div className="card"><div className="card-h"><h3>{title}</h3></div>
      {rows.length ? rows.map((r) => <Row key={`${r.p.email}${r.occasion}${r.p.date || ""}`} {...r} />) : <div className="empty">{empty}</div>}
    </div>
  );

  return (
    <div className="cel-page">
      <SectionHead eyebrow="HR" title="Celebrations" sub="Make a birthday, anniversary or welcome poster with the person's profile photo and send it to everyone. Nothing is emailed until you approve it."
        actions={<button type="button" className="btn primary" onClick={() => setWizard({})}>New announcement</button>} />
      {!ov.mailReady && <div className="cel-warn">Email is not set up on this server. You can make posters, but sending needs <code>SENDGRID_API_KEY</code> and <code>MAIL_FROM</code> in the backend settings.</div>}
      <Block title="Birthdays" empty="No birthdays in the next two weeks."
        rows={[...ov.birthdaysToday.map((p) => ({ p, occasion: "birthday", note: "Today" })), ...ov.upcoming.map((p) => ({ p, occasion: "birthday", note: day(p.date) }))]} />
      <Block title="Work anniversaries" empty="No work anniversaries in the next two weeks."
        rows={[...ov.anniversariesToday.map((p) => ({ p, occasion: "anniversary", note: `Today · ${p.years} year${p.years === 1 ? "" : "s"}` })), ...ov.anniversariesUpcoming.map((p) => ({ p, occasion: "anniversary", note: `${day(p.date)} · ${p.years} year${p.years === 1 ? "" : "s"}` }))]} />
      <Block title="New joiners" empty="No new joiners in the last 30 days." rows={ov.joiners.map((p) => ({ p, occasion: "welcome", note: `Joined ${day(p.start)}` }))} />
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
                  <td style={{ whiteSpace: "nowrap" }}><button type="button" className="btn link" onClick={() => setView(h)}>View poster</button>{(h.status === "partial" || h.status === "failed") && <button type="button" className="btn glass sm" onClick={() => retry(h)}>Retry failed</button>}</td>
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
