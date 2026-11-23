import { useEffect, useState } from "react";
import { api } from "../../api.js";

/* HR, on a person's profile: which months have a payslip, each with a View button that opens it. No amounts are shown here. Only for people
   the signed-in person may see pay for (payroll.view); the server decides, and the card stays out of the way when it answers no. */
const monthName = (p) => new Date(`${p}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

export function PayslipsCard({ email, name }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    let live = true;
    api("GET", `/api/payslips?email=${encodeURIComponent(email)}`).then((r) => { if (live) setList(r.ok ? r.data.payslips : false); });
    return () => { live = false; };
  }, [email]);
  if (list === false) return null;   // not allowed to see this person's pay, or nothing to show
  return (
    <div className="card">
      <div className="card-h"><h3>Payslips</h3><span className="muted">{list ? `${list.length} month${list.length === 1 ? "" : "s"}` : ""}</span></div>
      {!list ? <div className="card-b"><span className="skel" style={{ width: "50%" }} /></div>
        : !list.length ? <div className="card-b muted">No payslip has been made for {name} yet.</div>
        : list.map((x) => (
          <div className="access-row" key={x.period}>
            <div className="grow"><b>{monthName(x.period)}</b>{x.draft && <span>Not published to {name.split(" ")[0]} yet</span>}{!x.available && <span>{x.message || "Incomplete"}</span>}</div>
            {x.available
              ? <a className="btn glass sm" href={`/api/payslips/${x.period}/pdf?email=${encodeURIComponent(email)}&view=1`} target="_blank" rel="noreferrer">View payslip</a>
              : <span className="muted">Not available</span>}
          </div>))}
    </div>
  );
}
