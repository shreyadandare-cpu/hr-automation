import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Icon } from "./ui.jsx";

/* "Working remotely" on Home: the people whose work-from-home request for today HR has approved. */
export default function RemoteToday() {
  const [people, setPeople] = useState(null);
  useEffect(() => { api("GET", "/api/remote-today").then((r) => setPeople(r.ok ? r.data.people : [])); }, []);
  if (!people) return null;
  return (
    <div className="card"><div className="card-h"><h3>Working remotely</h3><span className="muted">{people.length}</span></div>
      {people.length ? <div className="chips" style={{ padding: "0 24px 20px" }}>{people.map((p) => <span className="chip plain" key={p.email}>{p.name}</span>)}</div>
        : <div className="lv-hurray"><span aria-hidden="true"><Icon name="briefcase" /></span><div><b>Everyone is at the office</b><span>No one is working remotely today.</span></div></div>}
    </div>
  );
}
