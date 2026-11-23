import { useState } from "react";
import { PolicyExplain, Ring } from "./leaveSummary.jsx";
import { LTYPE, dd, useLeave } from "../lib/useLeave.js";
import { R } from "../lib/leave.js";

/* The four balance cards (casual, comp off, sick, unpaid) for one person and year: how many days are available, how many were consumed, what is waiting for
   approval, and the quota. One component for the employee's own My leave page and for the same view on an employee's profile (HR), so both read alike.
   "View details" opens the explanation and the day-by-day ledger for that person. */
export default function LeaveBalanceCards({ email, year }) {
  const lv = useLeave(), [open, setOpen] = useState(false);
  const e = lv.empBy(email);
  if (!e) return null;
  const thisYear = Number(lv.today.slice(0, 4)), future = year > thisYear, b = lv.bal(e, year);
  const pend = lv.reqsOf(email).filter((r) => r.status === "pending" && Number(r.from.slice(0, 4)) === year);
  const pendOf = (t) => pend.filter((r) => r.type === t).reduce((n, r) => n + Number(r.days || 0), 0);
  const cTot = b.casual.carried + b.casual.quota;
  const card = (title, pct, color, label, cells, sub) => (
    <div className="card lv-bal"><div className="card-h"><h3>{title}</h3><button type="button" className="btn link" onClick={() => setOpen(true)}>View details</button></div>
      <div className="card-b"><Ring pct={pct} color={color} label={label} sub={sub} />
        <dl className="lv-cells">{cells.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div></div>
  );
  return (
    <>
      <div className="grid g4 lv-bals">
        {card(LTYPE.casual, cTot ? b.casual.left / cTot * 100 : 0, "var(--lv-casual)", dd(b.casual.left), [["Available", dd(b.casual.left)], ["Consumed", dd(b.consumed.casual)], ["Pending approval", dd(pendOf("casual"))], ["Annual quota", dd(b.casual.quota)], ["Carried over", dd(b.casual.carried)]])}
        {card(LTYPE.compoff, b.compoff.earned ? b.compoff.left / b.compoff.earned * 100 : 0, "var(--lv-comp)", b.compoff.earned ? dd(b.compoff.left) : "None", [["Available", dd(b.compoff.left)], ["Consumed", dd(b.consumed.compoff)], ["Pending approval", dd(pendOf("compoff"))], ["Earned", dd(b.compoff.earned)], ["Lapses", "31 Dec"]])}
        {card(LTYPE.sick, b.sick.quota ? b.sick.left / b.sick.quota * 100 : 0, "var(--lv-sick)", dd(b.sick.left), [["Available", dd(b.sick.left)], ["Consumed", dd(b.consumed.sick)], ["Pending approval", dd(pendOf("sick"))], ["Annual quota", dd(b.sick.quota)], ["Lapses", "31 Dec"]])}
        {card(LTYPE.unpaid, b.lopDays ? 100 : 0, "var(--lv-unpaid)", dd(b.lopDays), [["Loss-of-pay days", dd(b.lopDays)], ["Unpaid leave taken", dd(b.consumed.unpaid)], ["Pending approval", dd(pendOf("unpaid"))], ["Annual quota", "No limit"]], future ? `Loss of pay in ${year}` : "Loss of pay")}
      </div>
      {open && <PolicyExplain email={email} year={year} onClose={() => setOpen(false)} />}
    </>
  );
}
