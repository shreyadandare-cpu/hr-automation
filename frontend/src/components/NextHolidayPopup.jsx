import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { useLeave } from "../lib/useLeave.js";
import { Icon } from "./ui.jsx";

/* A small pop-up that names the next company holiday. It appears once a day (the first time the app is opened that day),
   for everyone, and closes by itself after a while or when dismissed. */
const SHOW_MS = 15000;
const dayNumber = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };

/** The first holiday today or later, with how many days away it is. */
export function nextHoliday(holidays, today) {
  const h = [...(holidays || [])].filter((x) => x.day >= today).sort((a, b) => (a.day < b.day ? -1 : 1))[0];
  return h ? { ...h, inDays: dayNumber(h.day) - dayNumber(today) } : null;
}
const when = (n) => (n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`);

/** The card itself. */
export function HolidayCard({ next, isHr, onClose }) {
  const date = new Date(next.day + "T00:00:00");
  const weekend = [0, 6].includes(date.getDay());
  return (
    <aside className="hol-pop" role="status" aria-live="polite" aria-label="Next holiday">
      <span className="hol-pop-ic"><Icon name="calendar" /></span>
      <div className="hol-pop-body">
        <div className="hol-pop-eyebrow">Next holiday · {when(next.inDays)}</div>
        <b>{next.name}</b>
        <div className="hol-pop-date">{date.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}{weekend && <span className="muted"> · falls on a weekend</span>}</div>
        <Link className="hol-pop-link" to={isHr ? "/app/leave" : "/app/my-leave"} onClick={onClose}>See the holiday calendar</Link>
      </div>
      <button type="button" className="hol-pop-x" aria-label="Close" onClick={onClose}>×</button>
    </aside>
  );
}

export default function NextHolidayPopup() {
  const { user, isHr } = useAuth();
  const lv = useLeave();
  const next = useMemo(() => nextHoliday(lv.holidays, lv.today), [lv.holidays, lv.today]);
  const [open, setOpen] = useState(false);
  const key = `holiday-popup:${user && user.email}`;

  useEffect(() => {
    if (!next || !user) return;
    try { if (localStorage.getItem(key) === lv.today) return; } catch { /* no storage: show it each visit */ }
    const show = setTimeout(() => { setOpen(true); try { localStorage.setItem(key, lv.today); } catch { /* ignore */ } }, 800);
    return () => clearTimeout(show);
  }, [next && next.day, lv.today, key]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!open) return; const t = setTimeout(() => setOpen(false), SHOW_MS); return () => clearTimeout(t); }, [open]);
  if (!open || !next) return null;

  return <HolidayCard next={next} isHr={isHr} onClose={() => setOpen(false)} />;
}
