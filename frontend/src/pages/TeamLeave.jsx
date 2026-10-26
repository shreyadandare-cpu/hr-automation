import { useData } from "../data.jsx";
import { PersonCell, Pill, SectionHead, Stat, shortDate } from "../components/ui.jsx";
import { DecideButtons } from "../components/leaveParts.jsx";
import { LSTAT, LTYPE, dd, lc, rangeText, useLeave } from "../lib/useLeave.js";

/* A reporting manager approves their own team's leave and comp-off requests; the directors also approve HR staff's. */
export default function TeamLeave() {
  const { people } = useData();
  const lv = useLeave();
  if (!people) return <section className="section"><div className="empty">Loading…</div></section>;
  const { today } = lv, year = Number(today.slice(0, 4));
  const team = people.filter((e) => lv.approvedByMe(e.email)).sort((a, b) => a.name.localeCompare(b.name));
  const approvesHr = team.some((e) => lv.approverOf(e.email) === "directors");
  const inTeam = new Set(team.map((e) => lc(e.email)));
  const all = lv.requests.filter((r) => inTeam.has(lc(r.email))).map((r) => ({ ...r, emp: lv.empBy(r.email) })).filter((r) => r.emp);
  const pend = all.filter((r) => r.status === "pending").sort((a, b) => (a.from < b.from ? -1 : 1));
  const compPend = lv.compOffs.filter((c) => c.status === "pending" && inTeam.has(lc(c.email))).map((c) => ({ ...c, emp: lv.empBy(c.email) })).filter((c) => c.emp);
  const away = all.filter((r) => r.status === "approved" && r.to >= today).sort((a, b) => (a.from < b.from ? -1 : 1));
  const done = all.filter((r) => r.status === "approved" || r.status === "declined").sort((a, b) => (a.from < b.from ? 1 : -1)).slice(0, 15);
  const pendDays = (e) => all.filter((r) => r.status === "pending" && lc(r.email) === lc(e.email)).reduce((n, r) => n + Number(r.days || 0), 0);
  return (
    <section className="section">
      <SectionHead eyebrow="Team" title="Team" accent="leave." sub={`Leave and comp-off requests from the people who report to you${approvesHr ? ", and from the HR team" : ""}. You approve them.${approvesHr ? ` HR's leave can be approved by ${lv.approverName(team.find((e) => lv.approverOf(e.email) === "directors").email)}; whoever acts first decides.` : ""} Your own leave goes to your reporting manager, or to HR if you have none.`} />
      <div className="grid g4">
        <Stat value={team.length} label="People in your team" />
        <Stat value={pend.length + compPend.length} label="Waiting for you" alert={pend.length + compPend.length > 0} />
        <Stat value={away.filter((r) => r.from <= today).length} label="Away today" />
        <Stat value={away.filter((r) => r.from > today).length} label="Upcoming leave" />
      </div>
      <div className="grid g-main">
        <div className="card"><div className="card-h"><h3>Requests waiting</h3><span className="muted">{pend.length + compPend.length} open</span></div>
          {compPend.map((c) => (
            <div key={`c${c.id}`} className="li wrap"><div className="grow"><PersonCell person={c.emp} sub={`Comp off credit · worked on ${shortDate(c.workedOn)}`} /><div className="meta" style={{ margin: "6px 0 0 48px" }}>“{c.reason}”</div></div>
              <DecideButtons kind="comp-offs" id={c.id} email={c.email} /></div>))}
          {pend.map((r) => { const a = lv.preview(r);
            return (
              <div key={r.id} className="li wrap"><div className="grow"><PersonCell person={r.emp} sub={`${LTYPE[r.type]} · ${rangeText(r, shortDate)} · ${dd(a.paid + a.lop)}`} />
                <div className="meta" style={{ margin: "6px 0 0 48px" }}>“{r.reason}”</div>
                <div className="meta" style={{ margin: "4px 0 0 48px" }}>If approved now: <b style={{ color: "var(--ink)" }}>{dd(a.paid)} paid</b>{a.lop > 0 && <> · <b style={{ color: "var(--bad)" }}>{dd(a.lop)} loss of pay</b></>}</div></div>
                <DecideButtons kind="requests" id={r.id} email={r.email} /></div>); })}
          {!pend.length && !compPend.length && <div className="empty">Nothing waiting. New requests from your team show up here.</div>}
        </div>
        <div className="card"><div className="card-h"><h3>Away now &amp; coming up</h3></div>
          {away.length ? away.map((r) => <div key={r.id} className="li"><PersonCell person={r.emp} sub={`${LTYPE[r.type]} · ${rangeText(r, shortDate)}`} /></div>) : <div className="empty">No one in your team is on approved leave.</div>}
        </div>
      </div>
      <div className="card"><div className="card-h"><h3>Team balances {year}</h3></div><div className="tbl-wrap"><table>
        <thead><tr><th>Employee</th><th>Casual left</th><th>Sick left</th><th>Comp off left</th><th>Waiting</th></tr></thead>
        <tbody>{team.length ? team.map((e) => { const b = lv.bal(e, year);
          return <tr key={e.id}><td><PersonCell person={e} sub={e.title} /></td><td className="num-cell">{b.casual.left}</td><td className="num-cell">{b.sick.left}</td><td className="num-cell">{b.compoff.left}</td><td className="num-cell">{pendDays(e) ? dd(pendDays(e)) : "—"}</td></tr>; })
          : <tr><td colSpan="5"><div className="empty">No one reports to you yet.</div></td></tr>}</tbody>
      </table></div></div>
      <div className="card"><div className="card-h"><h3>Decided recently</h3></div><div className="tbl-wrap"><table>
        <thead><tr><th>Employee</th><th>Type</th><th className="hide-sm">Dates</th><th>Days</th><th>Status</th></tr></thead>
        <tbody>{done.length ? done.map((r) => (
          <tr key={r.id}><td><PersonCell person={r.emp} sub={r.emp.title} /></td><td>{LTYPE[r.type]}</td><td className="num-cell hide-sm">{rangeText(r, shortDate)}</td>
            <td className="num-cell">{r.status === "approved" ? <>{r.paidDays} paid{r.lopDays ? ` · ${r.lopDays} loss of pay` : ""}</> : dd(r.days)}</td><td><Pill tone={LSTAT[r.status][1]}>{LSTAT[r.status][0]}</Pill></td></tr>))
          : <tr><td colSpan="5"><div className="empty">Nothing decided yet.</div></td></tr>}</tbody>
      </table></div></div>
    </section>
  );
}
