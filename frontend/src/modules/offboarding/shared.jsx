import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth.jsx";
import { Pill, shortDate } from "../../components/ui.jsx";
import { STATUS, leaving } from "../../lib/people.js";

export function StatusPill({ person }) {
  if (person.status === "active" && person.lastDay) { const [w, tone] = leaving(person); return <Pill tone={tone}>{w} {shortDate(person.lastDay)}</Pill>; }
  const [label, tone] = STATUS[person.status];
  return <Pill tone={tone}>{label}</Pill>;
}

export function OffTabs({ cur }) {
  const nav = useNavigate();
  const { isHr } = useAuth();
  if (!isHr) return null;
  return (
    <div className="subtabs" role="tablist">
      <button type="button" role="tab" className={cur === "new" ? "on" : ""} aria-selected={cur === "new"} onClick={() => nav("/app/offboarding")}>Offboard someone</button>
      <button type="button" role="tab" className={cur === "leavers" ? "on" : ""} aria-selected={cur === "leavers"} onClick={() => nav("/app/offboarding/leavers")}>Leaving and left</button>
    </div>
  );
}
