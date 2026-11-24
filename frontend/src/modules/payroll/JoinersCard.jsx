import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";
import { Person, Pill } from "../../components/ui.jsx";
import { monthLabel } from "./util.jsx";

/* On the Monthly payroll page (payroll.prepare): people being onboarded and people who join in the shown month or later. They show up here as soon as their work email is
   created in onboarding, with whether they are in this month's payroll and what their payroll profile still needs. `again` changes when the run does (recalculated, started). */
export default function JoinersCard({ period, again }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let live = true;
    setD(null);
    api("GET", `/api/payroll/joiners?period=${period}`).then((r) => { if (live) setD(r.ok ? r.data : false); });
    return () => { live = false; };
  }, [period, again]);
  if (!d || !d.joiners.length) return null;
  const date = (s) => new Date(`${s}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="card">
      <div className="card-h"><div><h3>New joiners</h3><div className="muted">Being onboarded, or joining from {monthLabel(period)} on. They are listed from the moment their work email is created.</div></div><span className="muted">{d.joiners.length}</span></div>
      <div className="tbl-wrap"><table className="pr-table"><thead><tr><th>Employee</th><th>Joining</th><th>This payroll</th><th>Payroll profile</th><th /></tr></thead><tbody>
        {d.joiners.map((e) => (
          <tr key={e.email}>
            <td><Person name={e.name} sub={[e.empNo, e.title, e.employmentType === "Intern" ? "Intern" : ""].filter(Boolean).join(" · ") || e.email} />{e.onboarding && <div><Pill tone="info">Onboarding in progress</Pill></div>}</td>
            <td>{e.start ? date(e.start) : "No date yet"}</td>
            <td>{!e.inThisPayroll ? <span className="muted">Joins after {monthLabel(period)}</span>
              : d.runStarted && !e.inRun ? <><Pill tone="warn">Not in the run yet</Pill><div className="muted">Recalculate to add them</div></>
              : d.runStarted && e.missing && e.missing.includes("Salary structure") ? <><Pill tone="warn">In the run, not paid yet</Pill><div className="muted">Add a salary structure to pay them</div></>
              : <Pill tone="ok">{d.runStarted ? "In the run" : "Will be included"}</Pill>}</td>
            <td>{e.missing.length ? <><Pill tone="warn">Incomplete</Pill><div className="muted">Needs: {e.missing.join(", ")}</div></> : <Pill tone="ok">Ready</Pill>}</td>
            <td className="num"><Link className="btn glass sm" to={`/app/employees/${encodeURIComponent(e.email)}`}>Open profile</Link></td>
          </tr>))}
      </tbody></table></div>
    </div>
  );
}
