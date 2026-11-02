import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import PersonAvatar from "./PersonAvatar.jsx";
import { lc } from "../lib/useLeave.js";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nextDay = (d) => new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10);
const dayMonth = (d) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
const firstName = (n) => String(n || "").split(/\s+/)[0];

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

/* Who is on leave today and the birthdays today and in the next 30 days, for everyone at the company. */
// bare: just the two cards, for a layout (like the dashboard's columns) that places each card itself.
export default function TodayCards({ bare = false }) {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  useEffect(() => { api("GET", "/api/leave/today").then((r) => setD(r.ok ? r.data : { failed: true })); }, []);
  const Wrap = bare ? Bare : Pair;
  if (!d) return <Wrap><div className="card"><div className="empty">Loading…</div></div><div className="card"><div className="empty">Loading…</div></div></Wrap>;
  if (d.failed) return null;

  const bToday = d.birthdays.filter((b) => b.date === d.today);
  const upcoming = d.birthdays.filter((b) => b.date !== d.today).slice(0, 8);
  const mine = bToday.find((b) => lc(b.email) === lc(user.email));
  const others = bToday.filter((b) => lc(b.email) !== lc(user.email));

  return (
    <Wrap>
      <div className="card"><div className="card-h"><h3>Who is on leave today</h3><span className="muted">{d.onLeave.length ? `${d.onLeave.length} away` : ""}</span></div>
        {d.onLeave.length
          ? <div className="td-faces">{d.onLeave.map((p) => <Face key={p.email} p={p} sub={p.half ? "Half day" : "On leave"} />)}</div>
          : <Empty icon="✅" title="Everyone is working today!" sub="No one is on leave today." />}
      </div>
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
    </Wrap>
  );
}
