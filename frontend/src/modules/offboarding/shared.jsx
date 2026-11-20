import { Pill, shortDate } from "../../components/ui.jsx";
import { STATUS, leaving } from "../../lib/people.js";

export function StatusPill({ person }) {
  if (person.status === "active" && person.lastDay) { const [w, tone] = leaving(person); return <Pill tone={tone}>{w} {shortDate(person.lastDay)}</Pill>; }
  const [label, tone] = STATUS[person.status];
  return <Pill tone={tone}>{label}</Pill>;
}

