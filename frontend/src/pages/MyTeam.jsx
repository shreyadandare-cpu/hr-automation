import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useData } from "../data.jsx";
import { PersonCell, Pill, SectionHead, shortDate, PageSkeleton } from "../components/ui.jsx";
import { LTYPE, dd, lc, rangeText, useLeave } from "../lib/useLeave.js";

/* My Team > Summary: the people who report to you at a glance. Who is away today, what is waiting for your decision,
   who is away in the next two weeks, and everyone in the team. Built from the leave data the app already loads. */
export default function MyTeam() {
  const { people } = useData();
  const lv = useLeave();
  // Today's attendance for the team (the server gives it to reporting managers and HR only; anyone else gets nothing).
  const [day, setDay] = useState(null);
  useEffect(() => { api("GET", "/api/attendance/day").then((r) => setDay(r.ok ? r.data : { people: [] })); }, []);
  const [month, setMonth] = useState(0);   // 0 = this month, -1 = last month, 1 = next month
  if (!people) return <PageSkeleton />;
  const { today } = lv;
  const team = people.filter((e) => lv.approvedByMe(e.email) && e.status !== "offboarded").sort((a, b) => a.name.localeCompare(b.name));
  const inTeam = new Set(team.map((e) => lc(e.email)));
  const all = lv.requests.filter((r) => inTeam.has(lc(r.email))).map((r) => ({ ...r, emp: lv.empBy(r.email) })).filter((r) => r.emp);
  const awayToday = all.filter((r) => r.status === "approved" && r.from <= today && r.to >= today);
  const pending = all.filter((r) => r.status === "pending").length + lv.compOffs.filter((c) => c.status === "pending" && inTeam.has(lc(c.email))).length;
  const soonEnd = new Date(Date.parse(today + "T00:00:00Z") + 14 * 86400000).toISOString().slice(0, 10);
  const upcoming = all.filter((r) => r.status === "approved" && r.from > today && r.from <= soonEnd).sort((a, b) => (a.from < b.from ? -1 : 1));
  const awaySet = new Set(awayToday.map((r) => lc(r.email)));
  // Attendance today, for the team only.
  const dayPeople = ((day && day.people) || []).filter((x) => inTeam.has(lc(x.email)));
  const inToday = dayPeople.filter((x) => x.punchCount > 0);
  const notIn = day && !day.off ? dayPeople.filter((x) => x.punchCount === 0 && !awaySet.has(lc(x.email))) : [];
  const late = inToday.filter((x) => x.firstIn && x.firstIn > "09:30");
  // The calendar month being shown, one column per day.
  const base = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + month, 1));
  const calTitle = base.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const days = Array.from({ length: new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate() }, (_, i) => {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), i + 1));
    return { iso: d.toISOString().slice(0, 10), n: i + 1, wd: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d.getUTCDay()], weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6 };
  });
  const holidayOn = Object.fromEntries((lv.holidays || []).map((h) => [h.day, h.name]));
  const cellOf = (e, d) => {
    const r = all.find((x) => lc(x.email) === lc(e.email) && x.from <= d.iso && x.to >= d.iso && (x.status === "approved" || x.status === "pending"));
    if (r) return { kind: r.status === "approved" ? "leave" : "pending", mark: "L", title: `${LTYPE[r.type]}${r.status === "pending" ? ", waiting for approval" : ""}` };
    if (holidayOn[d.iso]) return { kind: "holiday", mark: "H", title: holidayOn[d.iso] };
    if (d.weekend) return { kind: "off", mark: "", title: "Weekly off" };
    return { kind: "none", mark: "" };
  };

  return (
    <section className="section">
      <SectionHead title="My team" sub="The people who report to you: who is away, what needs your decision, and who is away soon."
        actions={<Link className="btn primary" to="/app/team-leave">Review leave requests</Link>} />
      {!team.length ? <div className="card"><div className="empty">No one reports to you yet. HR sets reporting managers on the Employees page.</div></div> : <>
        <div className="rb-stats four db-strip">
          <div className="rb-stat"><span className="lbl">People in my team</span><b>{team.length}</b><span className="sub">report to you</span></div>
          <div className="rb-stat"><span className="lbl">On leave today</span><b>{awayToday.length}</b><span className="sub">{awayToday.length ? "on approved leave" : "everyone is working"}</span></div>
          <Link className={`rb-stat ${pending ? "warn" : ""}`} to="/app/team-leave"><span className="lbl">Waiting for you</span><b>{pending}</b><span className="sub">{pending ? "requests to decide" : "nothing waiting"}</span></Link>
          <div className="rb-stat"><span className="lbl">Away in the next 14 days</span><b>{upcoming.length}</b><span className="sub">approved leave</span></div>
        </div>
        <div className="rb-stats four db-strip">
          <div className="rb-stat"><span className="lbl">In today</span><b>{inToday.length}</b><span className="sub">have punched in</span></div>
          <div className="rb-stat"><span className="lbl">Not in yet today</span><b>{notIn.length}</b><span className="sub">{notIn.length ? notIn.slice(0, 3).map((x) => x.name.split(" ")[0]).join(", ") + (notIn.length > 3 ? ` and ${notIn.length - 3} more` : "") : day && day.off ? `${day.off} today` : "everyone is in"}</span></div>
          <div className="rb-stat"><span className="lbl">Late arrivals today</span><b>{late.length}</b><span className="sub">first punch after 9:30 am</span></div>
          <div className="rb-stat"><span className="lbl">Working now</span><b>{dayPeople.filter((x) => x.in).length}</b><span className="sub">punched in, not yet out</span></div>
        </div>
        <div className="card"><div className="card-h"><h3>Team calendar</h3>
          <div className="row" style={{ gap: 8 }}><button type="button" className="btn glass sm" onClick={() => setMonth(month - 1)} aria-label="Previous month">Previous</button><b style={{ minWidth: 110, textAlign: "center" }}>{calTitle}</b><button type="button" className="btn glass sm" onClick={() => setMonth(month + 1)} aria-label="Next month">Next</button></div></div>
          <div className="tbl-wrap"><table className="tc">
            <thead><tr><th>Employee</th>{days.map((d) => <th key={d.iso} className={d.iso === today ? "now" : ""}><span>{d.wd}</span>{d.n}</th>)}</tr></thead>
            <tbody>{team.map((e) => (
              <tr key={e.email}><td>{e.name}</td>{days.map((d) => { const k = cellOf(e, d); return <td key={d.iso} className={`tc-${k.kind}${d.iso === today ? " now" : ""}`} title={k.title || undefined}>{k.mark}</td>; })}</tr>))}</tbody>
          </table></div>
          <div className="tc-key"><span><i className="tc-leave" />On leave</span><span><i className="tc-pending" />Leave waiting for approval</span><span><i className="tc-holiday" />Holiday</span><span><i className="tc-off" />Weekly off</span></div>
        </div>
        <div className="grid g2">
          <div className="card"><div className="card-h"><h3>Who is on leave today</h3><span className="muted">{awayToday.length}</span></div>
            {awayToday.length ? awayToday.map((r) => (
              <div className="li" key={r.id}><div className="grow"><PersonCell person={r.emp} sub={`${LTYPE[r.type]}, ${rangeText(r, shortDate)}`} /></div><Pill tone="warn">{dd(r.days)}</Pill></div>))
              : <div className="empty">No one in your team is on leave today.</div>}
          </div>
          <div className="card"><div className="card-h"><h3>Away in the next 14 days</h3><span className="muted">{upcoming.length}</span></div>
            {upcoming.length ? upcoming.map((r) => (
              <div className="li" key={r.id}><div className="grow"><PersonCell person={r.emp} sub={`${LTYPE[r.type]}, ${rangeText(r, shortDate)}`} /></div><Pill tone="info">{dd(r.days)}</Pill></div>))
              : <div className="empty">No approved leave is coming up.</div>}
          </div>
        </div>
        <div className="card"><div className="card-h"><h3>Team members</h3><span className="muted">{team.length}</span></div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Employee</th><th>Role</th><th>Today</th><th aria-label="Open" /></tr></thead>
            <tbody>{team.map((e) => (
              <tr key={e.email}>
                <td><PersonCell person={e} /></td>
                <td>{e.title && e.title !== "—" ? e.title : "Not set"}<div className="muted">{e.dept && e.dept !== "—" ? e.dept : ""}</div></td>
                <td>{awaySet.has(lc(e.email)) ? <Pill tone="warn">On leave</Pill> : <Pill tone="ok">Working</Pill>}</td>
                <td><Link className="btn glass sm" to={`/app/employees/${encodeURIComponent(e.email)}`}>Open profile</Link></td>
              </tr>))}</tbody>
          </table></div>
        </div>
      </>}
    </section>
  );
}
