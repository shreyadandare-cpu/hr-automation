import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiMsg } from "../api.js";
import Modal from "./Modal.jsx";
import { Callout } from "./ui.jsx";
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
   WEB_CLOCK_IN), the button to punch in or out. When HR asks for them, the punch carries your location (checked against the
   offices) and a selfie. The time is the server's. With web clock-in off it only shows what the office machine recorded. */
export default function TimeToday() {
  const toast = useToast();
  const [t, setT] = useState(null);
  const [busy, setBusy] = useState(false), [selfie, setSelfie] = useState(false);
  const load = useCallback(async () => { const r = await api("GET", "/api/attendance/today"); setT(r.ok ? r.data : { missing: true }); }, []);
  useEffect(() => { load(); }, [load]);
  if (!t || t.missing) return null;   // no employee record: nothing to show
  const inNow = t.state === "in";
  const first = t.punches.find((p) => p.direction === "IN");
  /** Location (when needed), the selfie (when taken), then the punch. Returns an error message, or "" when it worked. */
  const send = async (picture) => {
    let where = {};
    if (t.needLocation) { try { where = await locate(); } catch (e) { return e.message; } }
    let selfieKey;
    if (picture) {
      const u = await fetch("/api/attendance/selfie", { method: "POST", headers: { "Content-Type": picture.type }, body: picture, credentials: "same-origin" });
      const b = await u.json().catch(() => ({}));
      if (!u.ok) return b.error || "Your selfie could not be sent. Please try again.";
      selfieKey = b.key;
    }
    const r = await api("POST", "/api/attendance/punch", { ...where, ...(selfieKey ? { selfieKey } : {}) });
    if (!r.ok) return apiMsg(r);
    toast(`${r.data.direction === "IN" ? "You are punched in" : "You are punched out"}${r.data.place && !r.data.place.outside ? ` at ${r.data.place.site}` : ""}.${r.data.note ? ` ${r.data.note}` : ""}`);
    load();
    return "";
  };
  const punch = async () => {
    if (t.needSelfie) { setSelfie(true); return; }
    setBusy(true);
    const err = await send(null);
    setBusy(false);
    if (err) toast(err);
  };
  const where = t.needLocation && t.needSelfie ? "Uses your location and a selfie." : t.needLocation ? "Uses your location." : t.needSelfie ? "Asks for a selfie." : "";
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
      {selfie && <SelfieDialog verb={inNow ? "Punch out" : "Punch in"} onClose={() => setSelfie(false)} onSend={send} />}
    </div>
  );
}

/* The camera for a punch selfie. The picture is made small here (480 px wide, JPEG) before it is sent. */
function SelfieDialog({ verb, onClose, onSend }) {
  const video = useRef(null), stream = useRef(null);
  const [shot, setShot] = useState(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const stop = () => { if (stream.current) { stream.current.getTracks().forEach((x) => x.stop()); stream.current = null; } };
  const start = useCallback(async () => {
    setErr(""); setReady(false);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } }, audio: false });
      if (video.current) { video.current.srcObject = stream.current; await video.current.play().catch(() => {}); setReady(true); }
    } catch { setErr("Your camera could not be opened. Please allow camera access in your browser settings, then try again."); }
  }, []);
  useEffect(() => { if (shot) return undefined; start(); return stop; }, [shot === null, start]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);
  const take = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const w = 480, h = Math.round((v.videoHeight / v.videoWidth) * w);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(v, 0, 0, w, h);   // as a mirror, the way people see themselves
    c.toBlob((b) => { if (b) { setShot({ blob: b, url: URL.createObjectURL(b) }); stop(); } else setErr("The selfie could not be taken. Please try again."); }, "image/jpeg", 0.8);
  };
  const retake = () => setShot(null);   // the camera starts again once the preview is back
  const go = async () => { setBusy(true); const e = await onSend(shot.blob); setBusy(false); if (e) setErr(e); else onClose(); };
  return (
    <Modal onClose={busy ? () => {} : () => { stop(); onClose(); }}>
      <div className="card-h"><h3>{verb} with a selfie</h3></div>
      <div className="card-b">
        {err && <Callout><span role="alert">{err}</span></Callout>}
        <div className="mx-auto aspect-square w-full max-w-80 overflow-hidden rounded-card bg-tint">
          {shot ? <img src={shot.url} alt="Your selfie" className="size-full object-cover" />
            : <video ref={video} playsInline muted className="size-full -scale-x-100 object-cover" aria-label="Camera preview" />}
        </div>
        <p className="m-0 text-[14px] text-ink-dim">HR and your manager can see this picture with your punch. It is deleted after 90 days.</p>
      </div>
      <div className="modal-f">
        {shot ? <><button type="button" className="btn glass" onClick={retake} disabled={busy}>Retake</button>
          <button type="button" className="btn primary" onClick={go} disabled={busy}>{busy ? "Punching…" : `Use this and ${verb.toLowerCase()}`}</button></>
          : <><button type="button" className="btn glass" onClick={() => { stop(); onClose(); }}>Cancel</button>
            {err && !ready ? <button type="button" className="btn primary" onClick={start}>Try again</button>
              : <button type="button" className="btn primary" onClick={take} disabled={!ready}>Take selfie</button>}</>}
      </div>
    </Modal>
  );
}
