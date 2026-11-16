import { useEffect, useState } from "react";
import { api } from "../../api.js";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* The dashboard's Festival Wishes card: the next festival, and a way in to make a greeting. Shown to everyone. */
export default function FestivalTile() {
  const [next, setNext] = useState(undefined);
  useEffect(() => { api("GET", "/api/festivals").then((r) => setNext(r.ok ? (r.data.items.find((f) => f.next) || null) : null)); }, []);
  const [, m, d] = next ? next.next.split("-").map(Number) : [];
  return (
    <div className="card">
      <div className="card-h"><h3>Festival wishes</h3><a className="btn link" href="/app/festivals">All festivals</a></div>
      {next ? (
        <div className="q-item"><div className="dtile"><b>{d}</b><span>{MON[m - 1]}</span></div>
          <div className="grow"><b>{next.name}</b><div className="meta" style={{ fontSize: 13, color: "var(--ink-faint)" }}>{next.inDays === 0 ? "Today" : next.inDays === 1 ? "Tomorrow" : `In ${next.inDays} days`}</div></div>
          <a className="btn primary sm" href="/app/festivals">Create a greeting</a></div>
      ) : <div className="card-b" style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}><span className="muted">Make a Wohlig-branded greeting for any festival.</span><a className="btn primary sm" href="/app/festivals">Open</a></div>}
    </div>
  );
}
