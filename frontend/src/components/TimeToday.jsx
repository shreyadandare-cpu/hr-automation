import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiMsg } from "../api.js";
import { useToast } from "./toast.jsx";
import { confirmWithPasskey, deviceName, setUpPasskey } from "../lib/passkey.js";

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
   offices), unless the phone is on an office's internet that HR listed. When HR asks for it, the phone's own fingerprint, face or
   screen lock confirms the punch (a passkey, set up once on the first punch). No selfie is ever asked for. The time is the
   server's. With web clock-in off it only shows what the office machine recorded. */
export default function TimeToday() {
  const toast = useToast();
  const [t, setT] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await api("GET", "/api/attendance/today"); setT(r.ok ? r.data : { missing: true }); }, []);
  useEffect(() => { load(); }, [load]);
  if (!t || t.missing) return null;   // no employee record: nothing to show
  const inNow = t.state === "in";
  const first = t.punches.find((p) => p.direction === "IN");
  /** Fingerprint or face (when HR asks for it), location (when asked), then the punch. Returns an error message, or "" when it worked. */
  const send = async () => {
    let where = {}, confirm;
    if (t.confirm === "setup") { const e = await setUpPasskey(deviceName()); if (e) return e; }
    if (t.confirm === "yes" || t.confirm === "setup") { const c = await confirmWithPasskey(); if (c.error) return c.error; confirm = c.answer; }
    if (t.needLocation) { try { where = await locate(); } catch (e) { return e.message; } }
    const r = await api("POST", "/api/attendance/punch", { ...where, confirm });
    if (!r.ok) { if (r.data && r.data.code === "passkey_setup") load(); return apiMsg(r); }
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
  const where = [t.officeNetwork ? `On the ${t.officeNetwork} internet.` : t.needLocation ? "Uses your location." : "",
    t.confirm === "yes" ? "Confirmed with your fingerprint or face." : t.confirm === "setup" ? "Your first punch sets up fingerprint or face unlock on this phone." : ""].filter(Boolean).join(" ");
  /** Optional fingerprint or face: set it up on this phone (or another phone) without punching. */
  const setUp = async () => {
    setBusy(true);
    const e = await setUpPasskey(deviceName());
    setBusy(false);
    if (e) toast(e); else { toast("Fingerprint or face unlock is set up on this phone. It will be asked for when you punch."); load(); }
  };
  // A recent day with no punch-out and no correction yet: no hours are counted for it until the person sends one (as in Keka).
  const missing = (t.missingOut || [])[0];
  const dayName = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <div className="card db-time">
      <div className="db-time-t">
        <span className="lbl">Time today</span>
        <b>{hm(t.minutes)}</b>
        <span className="sub">{inNow ? `In since ${first ? first.time : t.time}` : t.punches.length ? "You are punched out" : t.canPunch ? "You have not punched in today" : "No punches yet today"}</span>
        {t.canPunch && where && <span className="sub">{where}</span>}
        {t.canPunch && t.canConfirm && t.confirm !== "setup" && <button type="button" className="m-0 min-h-11 cursor-pointer self-start border-0 bg-transparent p-0 text-left font-bold text-accent underline" disabled={busy} onClick={setUp}>
          {t.passkeys ? "Set up fingerprint or face on this phone too" : "Use fingerprint or face unlock to punch"}</button>}
        {missing && <span className="sub text-warn">Your punch-out on {dayName(missing.date)} is missing, so that day has no hours yet.{" "}
          <Link className="font-bold text-accent underline" to={`/app/requests?new=missed-punch&date=${missing.date}`}>Request correction</Link></span>}
      </div>
      {t.canPunch
        ? <button type="button" className={`btn ${inNow ? "glass" : "primary"}`} disabled={busy} onClick={punch}>{busy ? (t.confirm !== "no" ? "Checking…" : t.needLocation ? "Finding you…" : "Saving…") : inNow ? "Punch out" : "Punch in"}</button>
        : <Link className="btn link" to="/app/my-attendance">My attendance</Link>}
    </div>
  );
}
