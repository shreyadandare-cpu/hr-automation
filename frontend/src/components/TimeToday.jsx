import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiMsg } from "../api.js";
import { useToast } from "./toast.jsx";

const hm = (m) => `${Math.floor((m || 0) / 60)}h ${String((m || 0) % 60).padStart(2, "0")}m`;

/* "Time today" on Home: how long you have worked today and, when web clock-in is switched on (WEB_CLOCK_IN), the button
   to punch in or out. The time is the server's. With web clock-in off it only shows what the office machine recorded. */
export default function TimeToday() {
  const toast = useToast();
  const [t, setT] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await api("GET", "/api/attendance/today"); setT(r.ok ? r.data : { missing: true }); }, []);
  useEffect(() => { load(); }, [load]);
  if (!t || t.missing) return null;   // no employee record: nothing to show
  const inNow = t.state === "in";
  const first = t.punches.find((p) => p.direction === "IN");
  const punch = async () => {
    setBusy(true);
    const r = await api("POST", "/api/attendance/punch");
    setBusy(false);
    if (!r.ok) { toast(apiMsg(r)); return; }
    toast(r.data.direction === "IN" ? "You are punched in." : "You are punched out."); load();
  };
  return (
    <div className="card db-time">
      <div className="db-time-t">
        <span className="lbl">Time today</span>
        <b>{hm(t.minutes)}</b>
        <span className="sub">{inNow ? `In since ${first ? first.time : t.time}` : t.punches.length ? "You are punched out" : t.canPunch ? "You have not punched in today" : "No punches yet today"}</span>
      </div>
      {t.canPunch
        ? <button type="button" className={`btn ${inNow ? "glass" : "primary"}`} disabled={busy} onClick={punch}>{busy ? "Saving…" : inNow ? "Punch out" : "Punch in"}</button>
        : <Link className="btn link" to="/app/my-attendance">My attendance</Link>}
    </div>
  );
}
