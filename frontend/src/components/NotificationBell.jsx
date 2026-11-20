import { useCallback, useEffect, useState } from "react";
import { Popover } from "radix-ui";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { ICON_BTN } from "./ui.jsx";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dtShort = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getDate()} ${MON[d.getMonth()]}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/* Notification links: "claim:<id>", "budget:<id>", or a plain path. */
export function pathFor(link) {
  if (!link) return null;
  if (link.startsWith("claim:")) return `/app/reimbursements/${Number(link.slice(6))}`;
  if (link.startsWith("budget:")) return `/app/budgets/${Number(link.slice(7))}`;
  if (link.startsWith("/")) return link;
  return null;
}

/* The bell and its panel, on Radix UI's Popover: it places itself under the bell, closes on Escape or a click outside,
   and returns focus to the bell. */
export default function NotificationBell() {
  const nav = useNavigate();
  const [nt, setNt] = useState({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await api("GET", "/api/notifications");
    if (r.ok) setNt({ unread: r.data.unread, items: r.data.items });
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const pick = async (n) => {
    await api("POST", "/api/notifications/read", { id: n.id });
    setOpen(false);
    const to = pathFor(n.link);
    if (to) nav(to);
    load();
  };
  const readAll = async () => { await api("POST", "/api/notifications/read", {}); load(); };

  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <Popover.Trigger className={`relative inline-grid ${ICON_BTN}`} id="bell" aria-label={`Notifications${nt.unread ? `, ${nt.unread} unread` : ""}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
        {nt.unread > 0 && <span className="bell-n">{nt.unread > 9 ? "9+" : nt.unread}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="bell-panel" id="bell-panel" align="end" sideOffset={8} collisionPadding={12} aria-label="Notifications">
          <div className="bell-h"><b>Notifications</b>{nt.unread > 0 && <button type="button" className="btn link sm nolink" onClick={readAll}>Mark all as read</button>}</div>
          {nt.items.length ? nt.items.map((n) => (
            <button key={n.id} type="button" className={`bell-i ${n.read ? "" : "unread"}`} onClick={() => pick(n)}>
              <b>{n.title}</b>{n.body && <span>{n.body}</span>}<span className="meta">{dtShort(n.at)}</span>
            </button>
          )) : <div className="empty">You are all caught up.</div>}
          <button type="button" className="bell-all" onClick={() => { setOpen(false); nav("/app/inbox"); }}>Open Inbox</button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
