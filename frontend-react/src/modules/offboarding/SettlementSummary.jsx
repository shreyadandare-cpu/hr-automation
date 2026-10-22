import { useState } from "react";
import { PayModal } from "../../components/leaveParts.jsx";
import { shortDate } from "../../components/ui.jsx";
import { R } from "../../lib/leave.js";
import { dd, inr, useLeave } from "../../lib/useLeave.js";

/**
 * Final settlement leave figures: unused casual leave is paid out, loss-of-pay days in the leaving month are deducted.
 * `record` (optional) is the server's offboarding record: when its last day matches, its figures are used as they are.
 * `open` adds the note about leave after the last working day that will be cancelled (while the wizard is open).
 */
export function settlementFor(lv, person, lastDay, record) {
  if (!R || !R.validDate(lastDay || "")) return null;
  if (record && record.lastDay === lastDay && record.settlement) return record.settlement;
  const p = lv.payOf(person.email);
  return R.exitSettlement({ emp: { start: person.start, casualOpening: p.casualOpening }, lastDay, requests: lv.reqsOf(person.email), compOffs: lv.compsOf(person.email), monthlyGross: p.monthlyGross, holidays: lv.holDays });
}

export const leaveAfter = (lv, person, day) => lv.reqsOf(person.email).filter((r) => (r.status === "pending" || r.status === "approved") && r.from > day);

export default function SettlementSummary({ person, lastDay, open, record }) {
  const lv = useLeave();
  const [pay, setPay] = useState(false);
  const s = settlementFor(lv, person, lastDay, record);
  if (!s) return null;
  const after = open ? leaveAfter(lv, person, lastDay).length : 0;
  const mon = shortDate(s.month + "-01").replace(/^1 /, "");
  const amt = (v) => (s.monthlyGross ? inr(v) : "—");
  return (
    <div className="field"><span className="lab">Final settlement: leave</span>
      <div className="settle">
        <div><span>Unused casual leave paid out<small>{s.carried} carried + {s.quota} for months worked − {s.used} used</small></span><b>{dd(s.casualLeft)} · {amt(s.encashment)}</b></div>
        <div><span>Loss of pay in {mon}</span><b className="neg">{dd(s.lopDays)} · {s.monthlyGross ? "−" + inr(s.deduction) : "—"}</b></div>
        <div className="tot"><span>Leave adjustment</span>
          <b>{s.monthlyGross ? inr(s.net) : <button type="button" className="btn link" onClick={() => setPay(true)}>Add monthly salary to see amounts</button>}</b></div>
      </div>
      {after > 0 && <span className="hint">{after} leave request{after === 1 ? "" : "s"} after the last working day will be cancelled.</span>}
      {pay && <PayModal email={person.email} onClose={() => setPay(false)} />}
    </div>
  );
}
