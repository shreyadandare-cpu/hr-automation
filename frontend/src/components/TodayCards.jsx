import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import PersonAvatar from "./PersonAvatar.jsx";
import { lc } from "../lib/useLeave.js";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nextDay = (d) => new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10);
const dayMonth = (d) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
const firstName = (n) => String(n || "").split(/\s+/)[0];
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (d) => WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()];
// "Tomorrow", "Wed 5 Nov", or "Wed 5 Nov – 7 Nov" for leave over several days.
const when = (l, today) => {
  const start = l.from === nextDay(today) ? "Tomorrow" : `${weekday(l.from)} ${dayMonth(l.from)}`;
  return l.to && l.to !== l.from ? `${start} – ${dayMonth(l.to)}` : start;
};
const span = (l) => (l.half ? "Half day" : `${l.days} day${l.days === 1 ? "" : "s"}`);

/* One face with a name under it, using the person's profile photo when they have one. */
function Face({ p, sub }) {
  return (
    <div className="td-face" title={`${p.name}${p.title ? ` · ${p.title}` : ""}`}>
      <PersonAvatar email={p.email} name={p.name} />
      <b>{firstName(p.name)}</b>{sub && <small>{sub}</small>}
    </div>
  );
}

const Empty = ({ icon, title, sub }) => (
  <div className="lv-hurray"><span aria-hidden="true">{icon}</span><div><b>{title}</b><span>{sub}</span></div></div>
);

const Bare = ({ children }) => <>{children}</>;
const Pair = ({ children }) => <div className="grid g2">{children}</div>;

/* Who is on leave today and in the next two weeks, and the birthdays today and in the next 30 days, for everyone at the company. */
// bare: just the cards, for a layout (like the dashboard's columns) that places each card itself.
// only: "leave" or "birthdays" shows that one card alone.
export default function TodayCards({ bare = false, only = null }) {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  useEffect(() => { api("GET", "/api/leave/today").then((r) => setD(r.ok ? r.data : { failed: true })); }, []);
  const Wrap = bare ? Bare : Pair;
  const loading = <div className="card"><div className="empty">Loading…</div></div>;
  if (!d) return only ? loading : <Wrap>{loading}{loading}</Wrap>;
  if (d.failed) return null;

  const bToday = d.birthdays.filter((b) => b.date === d.today);
  const upcoming = d.birthdays.filter((b) => b.date !== d.today).slice(0, 8);
  const mine = bToday.find((b) => lc(b.email) === lc(user.email));
  const others = bToday.filter((b) => lc(b.email) !== lc(user.email));

  const soon = d.upcomingLeave || [];
  const leaveCard = (
      <div className="card"><div className="card-h"><h3>Who is on leave today</h3><span className="muted">{d.onLeave.length ? `${d.onLeave.length} away` : ""}</span></div>
        {d.onLeave.length
          ? <div className="td-faces">{d.onLeave.map((p) => <Face key={p.email} p={p} sub={p.half ? "Half day" : "On leave"} />)}</div>
          : <Empty icon="✅" title="Everyone is working today!" sub="No one is on leave today." />}
        <details className="td-more">
          <summary>Upcoming leave <span className="muted">· next {d.upcomingDays || 14} days{soon.length ? ` · ${soon.length}` : ""}</span></summary>
        {soon.length
          ? <div className="td-up">{soon.map((l, i) => (
              <div key={`${l.email}-${l.from}-${i}`} className="td-up-row">
                <PersonAvatar email={l.email} name={l.name} />
                <div className="grow"><b>{l.name}</b>{l.title && <small>{l.title}</small>}</div>
                <div className="td-up-when"><b>{when(l, d.today)}</b><small>{span(l)}</small></div>
              </div>))}</div>
          : <div className="td-none muted">No approved leave coming up.</div>}
        </details>
      </div>
  );
  const birthdayCard = (
      <div className="card"><div className="card-h"><h3>Birthdays</h3><span className="muted">{bToday.length ? `${bToday.length} today` : ""}</span></div>
        <div className="td-sub">Birthdays today</div>
        {mine && <Empty icon="🎉" title={`Happy birthday, ${firstName(mine.name)}!`} sub="Wishing you a wonderful year ahead." />}
        {others.length > 0 && <div className="td-faces">{others.map((p) => <Face key={p.email} p={p} sub="🎂 Today" />)}</div>}
        {!bToday.length && <Empty icon="🎂" title="No birthdays today." sub={upcoming.length ? "Upcoming ones are below." : "None in the next 30 days either."} />}
        {upcoming.length > 0 && <>
          <div className="td-sub">Upcoming birthdays</div>
          <div className="td-faces">{upcoming.map((p) => <Face key={p.email} p={p} sub={p.date === nextDay(d.today) ? "Tomorrow" : dayMonth(p.date)} />)}</div>
        </>}
      </div>
  );
  if (only === "leave") return leaveCard;
  if (only === "birthdays") return birthdayCard;
  return <Wrap>{leaveCard}{birthdayCard}</Wrap>;
}
