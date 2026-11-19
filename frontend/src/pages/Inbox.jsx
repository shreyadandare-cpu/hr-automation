import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { Icon, SectionHead, ViewTabs, ListSkeleton } from "../components/ui.jsx";
import { dtShort, pathFor } from "../components/NotificationBell.jsx";
import { useLeave } from "../lib/useLeave.js";

/* Inbox: everything waiting for this person in one place. Approvals that need a decision come first, then the
   notifications the bell shows, newest first. */
export default function Inbox() {
  const { can, isManager } = useAuth();
  const decides = can("leave.approve");   // leave approval for the company or a team: the Leave management page
  const { leave } = useData();
  const lv = useLeave();
  const nav = useNavigate();
  const [nt, setNt] = useState(null);
  const [tab, setTab] = useState("action");
  const load = useCallback(async () => {
    const r = await api("GET", "/api/notifications");
    setNt(r.ok ? { unread: r.data.unread, items: r.data.items } : { unread: 0, items: [], failed: true });
  }, []);
  useEffect(() => { load(); }, [load]);

  // Only what this person may decide, by the server's approvers map (the same answer the leave pages use).
  const pending = leave ? leave.requests.filter((r) => r.status === "pending" && lv.canDecide(r.email)).length + leave.compOffs.filter((c) => c.status === "pending" && lv.canDecide(c.email)).length : 0;
  const open = async (n) => { await api("POST", "/api/notifications/read", { id: n.id }); const to = pathFor(n.link); if (to) nav(to); else load(); };
  const readAll = async () => { await api("POST", "/api/notifications/read", {}); load(); };

  const unread = nt ? nt.items.filter((n) => !n.read) : [], read = nt ? nt.items.filter((n) => n.read) : [];
  const actions = (decides ? 1 : 0) + (isManager ? 1 : 0);
  const row = (n) => (
    <button key={n.id} type="button" className={`q-item ib-row ${n.read ? "" : "unread"}`} onClick={() => open(n)}>
      <span className="q-ic q-info"><Icon name="mail" /></span>
      <span className="grow"><b>{n.title}</b>{n.body && <span className="muted">{n.body}</span>}</span>
      <span className="muted">{dtShort(n.at)}</span>
    </button>);
  const list = (items, none) => (!nt ? <ListSkeleton />
    : nt.failed ? <div className="empty">Notifications could not be loaded. Please reload the page.</div>
    : items.length ? items.map(row) : <div className="empty">{none}</div>);

  return (
    <section className="section">
      <SectionHead title="To do" sub="What is waiting for you, and what has happened since you last looked."
        actions={tab === "notifications" && unread.length > 0 ? <button type="button" className="btn glass" onClick={readAll}>Mark all as read</button> : null}
        tabs={<ViewTabs label="To do" view={tab} onView={setTab} views={[["action", `Waiting for you${pending ? ` (${pending})` : ""}`], ["notifications", `Notifications${unread.length ? ` (${unread.length})` : ""}`], ["archive", "Done"]]} />} />
      {tab === "action" && (
        <div className="card">
          {decides && <Link className="q-item ib-row first" to="/app/leave"><span className="q-ic q-warn"><Icon name="calendar" /></span>
            <span className="grow"><b>Leave requests</b><span className="muted">{pending ? `${pending} waiting for a decision` : "Nothing is waiting for a decision."}</span></span><span className="btn link">Review</span></Link>}
          {isManager && <Link className="q-item ib-row" to="/app/team-leave"><span className="q-ic q-info"><Icon name="team" /></span>
            <span className="grow"><b>Team leave</b><span className="muted">Requests from the people who report to you.</span></span><span className="btn link">Open</span></Link>}
          {!actions && <div className="empty">You have no pending requests.</div>}
        </div>)}
      {tab === "notifications" && <div className="card ib-list">{list(unread, "You are all caught up.")}</div>}
      {tab === "archive" && <div className="card ib-list">{list(read, "Notifications you have read are kept here.")}</div>}
    </section>
  );
}
