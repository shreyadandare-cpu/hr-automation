import { useEffect, useState } from "react";
import { apiShared } from "../api.js";

/* Who is in the office today: { email: { state: "in" | "out" | "notin" | "leave", since } }. Left empty until it arrives or if it fails. */
export function usePresence() {
  const [map, setMap] = useState({});
  useEffect(() => {
    let live = true;
    apiShared("/api/attendance/presence").then((r) => { if (live && r.ok) setMap(r.data.people || {}); });
    return () => { live = false; };
  }, []);
  return map;
}

/* [label, pill tone] for one person, or null when nothing should show. */
export function presenceLabel(p) {
  if (!p) return null;
  if (p.state === "in") return ["In", "ok"];
  if (p.state === "out") return ["Out", "mute"];
  if (p.state === "leave") return ["On leave", "info"];
  return ["Not in yet", "warn"];
}
