import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiMsg } from "../api.js";
import { useToast } from "./toast.jsx";

const hm = (m) => `${Math.floor((m || 0) / 60)}h ${String((m || 0) % 60).padStart(2, "0")}m`;

/** The phone's location, once, as precisely as it can. Rejects with a message the person can act on. */
const locate = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) { reject(new Error("This browser cannot share your location. Please use a phone or another browser.")); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
    (err) => reject(new Error(err.code === 1 ? "Please allow location access in your browser settings, then punch again." : "Your location could not be found. Please try again in a moment.")),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
});

/* "Time today" on Home: how long you have worked today and, when HR switched web clock-in on (Shifts > Clock-in, or
   WEB_CLOCK_IN), the button to punch in or out. When HR asks for it, the punch carries your location (checked against the
   offices). One tap: no selfie is ever asked for. The time is the server's. With web clock-in off it only shows what the office machine recorded. */
export default function TimeToday() {
  const toast = useToast();
  const [t, setT] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await api("GET", "/api/attendance/today"); setT(r.ok ? r.data : { missing: true }); }, []);
  useEffect(() => { load(); }, [load]);
  if (!t || t.missing) return null;   // no employee record: nothing to show
  const inNow = t.state === "in";
  const first = t.punches.find((p) => p.direction === "IN");
  /** Location (when HR asks for it), then the punch. Returns an error message, or "" when it worked. One tap; never a selfie. */
  const send = async () => {
    let where = {};
    if (t.needLocation) { try { where = await locate(); } catch (e) { return e.message; } }
    const r = await api("POST", "/api/attendance/punch", where);
    if (!r.ok) return apiMsg(r);
    toast(`${r.data.direction === "IN" ? "You are punched in" : "You are punched out"}${r.data.place && !r.data.place.outside ? ` at ${r.data.place.site}` : ""}.${r.data.note ? ` ${r.data.note}` : ""}`);
    load();
    return "";
  };
  const punch = async () => {
    setBusy(true);
    const err = await send();
    setBusy(false);
    if (err) toast(err);
  };
  const where = t.needLocation ? "Uses your location." : "";
  return (
    <div className="card db-time">
      <div className="db-time-t">
        <span className="lbl">Time today</span>
        <b>{hm(t.minutes)}</b>
        <span className="sub">{inNow ? `In since ${first ? first.time : t.time}` : t.punches.length ? "You are punched out" : t.canPunch ? "You have not punched in today" : "No punches yet today"}</span>
        {t.canPunch && where && <span className="sub">{where}</span>}
      </div>
      {t.canPunch
        ? <button type="button" className={`btn ${inNow ? "glass" : "primary"}`} disabled={busy} onClick={punch}>{busy ? (t.needLocation ? "Finding you…" : "Saving…") : inNow ? "Punch out" : "Punch in"}</button>
        : <Link className="btn link" to="/app/my-attendance">My attendance</Link>}
    </div>
  );
}
