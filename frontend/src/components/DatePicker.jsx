import { useEffect, useRef, useState } from "react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const parts = (s) => { const [y, m, d] = String(s).split("-").map(Number); return { y, m: m - 1, d }; };
const label = (s) => { const { y, m, d } = parts(s); return `${WEEK[new Date(Date.UTC(y, m, d)).getUTCDay()]}, ${d} ${MONTHS[m].slice(0, 3)} ${y}`; };

/* A date field that opens a month calendar. Days for which `isOff(iso)` is true (weekends, holidays) or that fall outside min..max
   can't be picked. `notes` maps an off day to the reason, shown when hovering it. `from` shades the days from that date up to the value. */
export default function DatePicker({ id, value, onChange, min, max, isOff = () => false, notes = {}, today, from, placeholder = "Select date", invalid }) {
  const [open, setOpen] = useState(false);
  const start = parts(value || min || today);
  const [view, setView] = useState({ y: start.y, m: start.m });
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const toggle = () => {
    if (!open) { const p = parts(value || min || today); setView({ y: p.y, m: p.m }); }
    setOpen(!open);
  };
  const step = (n) => setView(({ y, m }) => { const t = m + n; return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 }; });

  const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const inMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < 42; i++) {   // always six rows, so the calendar doesn't jump in height from month to month
    const day = i - first + 1;
    const d = new Date(Date.UTC(view.y, view.m, day));
    cells.push({ s: iso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), n: d.getUTCDate(), out: day < 1 || day > inMonth });
  }
  const off = (s) => isOff(s) || (min && s < min) || (max && s > max);

  return (
    <div className="dp" ref={box}>
      <button type="button" id={id} className="input dp-btn" aria-haspopup="dialog" aria-expanded={open} aria-invalid={invalid ? "true" : undefined} onClick={toggle}>
        <span className={value ? "" : "ph"}>{value ? label(value) : placeholder}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
      </button>
      {open && (
        <div className="dp-pop" role="dialog" aria-label="Choose a date">
          <div className="dp-head">
            <button type="button" className="dp-nav" aria-label="Previous month" onClick={() => step(-1)}>‹</button>
            <b>{MONTHS[view.m]} {view.y}</b>
            <button type="button" className="dp-nav" aria-label="Next month" onClick={() => step(1)}>›</button>
          </div>
          <div className="dp-grid" role="grid">
            {WEEK.map((w) => <span key={w} className="dp-w" role="columnheader">{w}</span>)}
            {cells.map((c) => {
              const bad = c.out || off(c.s);
              const cls = ["dp-d", c.out ? "out" : "", !c.out && bad ? "off" : "", c.s === today ? "today" : "", c.s === value ? "sel" : "",
                from && value && c.s > from && c.s < value ? "in" : ""].filter(Boolean).join(" ");
              return <button key={c.s} type="button" className={cls} disabled={bad} aria-pressed={c.s === value} title={!c.out ? notes[c.s] : undefined}
                onClick={() => { onChange(c.s); setOpen(false); }}>{c.n}</button>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
