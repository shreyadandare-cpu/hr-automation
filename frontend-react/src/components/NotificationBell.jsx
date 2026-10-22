import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dtShort = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getDate()} ${MON[d.getMonth()]}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/* Notification links: "claim:<id>", "budget:<id>", or a plain path. */
function pathFor(link) {
  if (!link) return null;
  if (link.startsWith("claim:")) return `/app/reimbursements/${Number(link.slice(6))}`;
  if (link.startsWith("budget:")) return `/app/budgets/${Number(link.slice(7))}`;
  if (link.startsWith("/")) return link;
  return null;
}

export default function NotificationBell() {
  const nav = useNavigate();
  const [nt, setNt] = useState({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 12 });
  const btn = useRef(null), panel = useRef(null);

  const load = useCallback(async () => {
    const r = await api("GET", "/api/notifications");
    if (r.ok) setNt({ unread: r.data.unread, items: r.data.items });
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right - 8) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!(panel.current && panel.current.contains(e.target)) && !(btn.current && btn.current.contains(e.target))) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const toggle = async () => { const o = !open; setOpen(o); if (o) await load(); };
  const pick = async (n) => {
    await api("POST", "/api/notifications/read", { id: n.id });
    setOpen(false);
    const to = pathFor(n.link);
    if (to) nav(to);
    load();
  };
  const readAll = async () => { await api("POST", "/api/notifications/read", {}); load(); };

  return (
    <>
      <button ref={btn} className="bell-btn" id="bell" type="button" aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Notifications${nt.unread ? `, ${nt.unread} unread` : ""}`} onClick={toggle}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
        {nt.unread > 0 && <span className="bell-n">{nt.unread > 9 ? "9+" : nt.unread}</span>}
      </button>
      {open && (
        <div ref={panel} className="bell-panel" id="bell-panel" role="dialog" aria-label="Notifications" style={{ top: pos.top, right: pos.right }}>
          <div className="bell-h"><b>Notifications</b>{nt.unread > 0 && <button type="button" className="btn link sm nolink" onClick={readAll}>Mark all read</button>}</div>
          {nt.items.length ? nt.items.map((n) => (
            <button key={n.id} type="button" className={`bell-i ${n.read ? "" : "unread"}`} onClick={() => pick(n)}>
              <b>{n.title}</b>{n.body && <span>{n.body}</span>}<span className="meta">{dtShort(n.at)}</span>
            </button>
          )) : <div className="empty">You're all caught up.</div>}
        </div>
      )}
    </>
  );
}
