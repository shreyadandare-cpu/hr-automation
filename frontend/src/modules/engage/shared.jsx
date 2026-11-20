import { useCallback, useEffect, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useData } from "../../data.jsx";

/* Loads one list from the server and gives back { data, error, reload }. */
export function useList(url) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    const r = await api("GET", url);
    if (r.ok) { setData(r.data); setError(""); } else { setError(apiMsg(r)); setData((d) => d || {}); }
  }, [url]);
  useEffect(() => { setData(null); reload(); }, [reload]);
  return { data, error, reload };
}

/* The staff-list record (with its avatar colour) for an email, so a name from the server shows with the usual avatar. */
export function usePerson() {
  const { people } = useData();
  return (p) => (people || []).find((x) => String(x.email).toLowerCase() === String(p.email).toLowerCase()) || { name: p.name, email: p.email, color: "var(--brand-maroon)" };
}

export const when = (s) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); };
/* What the server said about each field (errors) or about the whole request (error). */
export const problems = (r) => (r.data && r.data.errors) || {};
