import { useState } from "react";
import { api, apiMsg } from "../../api.js";
import Modal from "../../components/Modal.jsx";
import PersonAvatar from "../../components/PersonAvatar.jsx";
import { useToast } from "../../components/toast.jsx";
import { BRAND } from "../../brand.js";
import { canvasToBlob, defaultsFor, loadImage, renderPoster } from "./poster.js";

/* Scheduling: HR picks a date and a time (India time) and the server emails the poster then, on any day of the week, holidays
   included. A birthday starts on the person's birthday at 9:00 am. Used by the wizard (one poster) and by "Schedule birthdays"
   (the coming birthdays at once: each poster is drawn here, saved, and scheduled). */
export const DEFAULT_TIME = "09:00";
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const at = (date, time) => new Date(`${date}T${time}:00+05:30`);
export const passed = (date, time) => !date || !time || at(date, time).getTime() < Date.now() - 60_000;
export const whenText = (t) => (t ? new Date(t).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "");
const dateText = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); };

/** Says plainly when the chosen day is a weekend or a company holiday, so HR knows the wish still goes out. */
export function dayNote(date, holidays = {}) {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number), dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (holidays[date]) return `${holidays[date]} is a company holiday. It will still be sent.`;
  if (dow === 0 || dow === 6) return `This is a ${DAYS[dow]}. It will still be sent.`;
  return "";
}

/** The date and time inputs. */
export function WhenFields({ date, time, onDate, onTime, holidays, idPrefix = "cel-when" }) {
  const note = dayNote(date, holidays), late = passed(date, time);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-3">
        <div className="field"><label htmlFor={`${idPrefix}-d`}>Date</label><input id={`${idPrefix}-d`} type="date" className="input" value={date} onChange={(e) => onDate(e.target.value)} /></div>
        <div className="field"><label htmlFor={`${idPrefix}-t`}>Time (India time)</label><input id={`${idPrefix}-t`} type="time" className="input" value={time} onChange={(e) => onTime(e.target.value)} /></div>
      </div>
      {late ? <p role="alert" className="m-0 text-sm text-bad">That time has already passed. Please choose a time that is still to come.</p>
        : note && <p className="m-0 text-sm text-ink-dim">{note}</p>}
    </div>
  );
}

let cache = null;
async function brandAssets() {
  if (!cache) {
    const [dark, light, mark] = await Promise.all([BRAND.logos.dark, BRAND.logos.light, "/google-cloud-mark.png"].map((u) => loadImage(u).catch(() => null)));
    cache = { logos: { dark, light }, mark };
  }
  return cache;
}

/** Draws the "Wohlig birthday" poster with the person's profile photo, saves it as a draft and schedules it. Returns an error text or "". */
async function scheduleBirthday(p, today, date, time) {
  try {
    const f = defaultsFor("birthday", p, today);
    const photo = p.photoV ? await loadImage(`/api/profile/photo?email=${encodeURIComponent(p.email)}&v=${p.photoV}`).catch(() => null) : null;
    const blob = await canvasToBlob(await renderPoster({ occasion: "birthday", theme: "polaroid", ...f, photo, ...(await brandAssets()) }));
    const made = await api("POST", "/api/celebrations", { occasion: "birthday", email: p.email, theme: "polaroid", ...f });
    if (!made.ok) return apiMsg(made);
    const id = made.data.id;
    const up = await fetch(`/api/celebrations/${id}/poster`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: blob });
    if (!up.ok) return (await up.json().catch(() => null))?.error || "The poster could not be saved.";
    const s = await api("POST", `/api/celebrations/${id}/schedule`, { date, time, audience: "all" });
    return s.ok ? "" : apiMsg(s);
  } catch (e) { return e.message || "The poster could not be made."; }
}

/** "Schedule birthdays": every coming birthday that has no poster yet, each on its own birthday (change the date if you like) at one time. */
export function BulkSchedule({ overview, onClose, onDone }) {
  const toast = useToast();
  const todo = [...overview.birthdaysToday, ...overview.upcoming].filter((p) => !p.announced && !p.scheduled);
  const [time, setTime] = useState(DEFAULT_TIME);
  const [dates, setDates] = useState(() => Object.fromEntries(todo.map((p) => [p.email, p.date])));
  const [off, setOff] = useState(() => new Set());
  const [busy, setBusy] = useState(0);        // how many are done, while working
  const [failed, setFailed] = useState([]);
  const holidays = overview.holidays || {};
  const usable = (p) => !passed(dates[p.email], time);
  const chosen = todo.filter((p) => !off.has(p.email) && usable(p));
  const run = async () => {
    setFailed([]); setBusy(1);
    const bad = [];
    for (let i = 0; i < chosen.length; i++) {
      setBusy(i + 1);
      const err = await scheduleBirthday(chosen[i], overview.today, dates[chosen[i].email], time);
      if (err) bad.push({ name: chosen[i].name, error: err });
    }
    setBusy(0); setFailed(bad);
    const ok = chosen.length - bad.length;
    if (ok) toast(`${ok} birthday ${ok === 1 ? "wish is" : "wishes are"} scheduled.`);
    if (ok) onDone();
    if (!bad.length) onClose();
  };
  return (
    <Modal wide onClose={() => !busy && onClose()}>
      <div className="card-h"><h3>Schedule birthday wishes</h3></div>
      <div className="card-b grid gap-3">
        <p className="m-0 text-ink-dim">Each wish is emailed to everyone on the person's birthday at the time you choose, even on a weekend or a company holiday, so nothing depends on someone remembering. The poster uses their profile photo. You can change a date, or untick a person.</p>
        {!overview.mailReady && <div className="cel-warn">Email is not set up on this server, so nothing can be scheduled yet.</div>}
        <div className="field max-w-48"><label htmlFor="cel-bulk-time">Time to send (India time)</label><input id="cel-bulk-time" type="time" className="input" value={time} disabled={!!busy} onChange={(e) => setTime(e.target.value)} /></div>
        {!todo.length ? <div className="empty">Every birthday in the next 30 days already has a poster, sent or scheduled.</div> : (
          <div className="max-h-96 overflow-auto rounded-card border border-line">
            {todo.map((p) => {
              const note = dayNote(dates[p.email], holidays), gone = !usable(p);
              return (
                <label key={p.email} className={`cel-row max-sm:flex-wrap ${gone ? "opacity-60" : ""}`}>
                  <input type="checkbox" checked={!off.has(p.email) && !gone} disabled={!!busy || gone}
                    onChange={() => setOff((s) => { const n = new Set(s); if (n.has(p.email)) n.delete(p.email); else n.add(p.email); return n; })} />
                  <PersonAvatar email={p.email} name={p.name} />
                  <span className="who"><b>{p.name}</b>
                    <span>{p.title || "—"} · birthday {dateText(p.date)}{gone ? " · that time has passed" : ""}</span>
                    {note && !gone && <span>{note}</span>}</span>
                  <input type="date" className="input w-auto max-sm:w-full" aria-label={`Send date for ${p.name}`} value={dates[p.email]} disabled={!!busy}
                    onChange={(e) => setDates((d) => ({ ...d, [p.email]: e.target.value }))} />
                </label>);
            })}
          </div>)}
        {failed.length > 0 && <div role="alert" className="rounded-field bg-bad-soft p-3 text-bad"><b>{failed.length === 1 ? "One wish" : `${failed.length} wishes`} could not be scheduled.</b>
          <ul className="m-0 mt-1 pl-5">{failed.map((x) => <li key={x.name}>{x.name}: {x.error}</li>)}</ul></div>}
      </div>
      <div className="modal-f">
        <button type="button" className="btn glass" disabled={!!busy} onClick={onClose}>Close</button>
        <button type="button" className="btn primary" disabled={!!busy || !chosen.length || !overview.mailReady} onClick={run}>
          {busy ? `Preparing ${busy} of ${chosen.length}…` : `Schedule ${chosen.length} ${chosen.length === 1 ? "wish" : "wishes"}`}</button>
      </div>
    </Modal>
  );
}
